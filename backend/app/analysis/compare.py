"""Compare page: one team's performance in one match, from that team's point of view.

The match functions in match_events.py and team_stats.py describe a match as "home" and "away".
Compare thinks in "this team" and "the opponent" (the same team can be home in one match and
away in the other), so get_team_match_summary gathers everything into one summary for one team,
and per_90 puts two matches of different lengths on the same footing.
"""

import json
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.match_events import (
    get_attack_area,
    get_passes,
    get_penalties,
    get_period_ends,
    get_periods,
    get_xg,
)
from app.analysis.team_stats import get_match_team_stats
from app.models.models import Event, Match, Team

# A shot this likely to go in counts as a big chance
BIG_CHANCE_XG = 0.3

# Stats that grow with time on the pitch; per_90 scales only these. Goals, percentages and
# cards stay as they are (a 3-3 is a 3-3; possession is already a share).
PER_90_STATS = {
    "xg",
    "xg_against",
    "shots",
    "shots_against",
    "shots_on_target",
    "shots_on_target_against",
    "big_chances",
    "big_chances_against",
    "final_third_entries",
    "progressive_passes",
    "passes",
    "corners",
    "fouls",
}


def _match_minutes(db: Session, match: Match) -> int:
    """How long the match lasted including stoppage time: when the last period (before any
    shootout) ended, e.g. 103 for a 90-minute match, 124 for one with extra time."""
    ends = get_period_ends(db, match.id)
    return max((p["end_minute"] for p in ends), default=90) or 90


def get_team_match_summary(db: Session, match: Match, team_id: int) -> dict:
    """Everything the Compare page needs about one team in one match: who they played, the
    result, how long it lasted, and their stats next to what they conceded."""
    if team_id not in (match.home_team_id, match.away_team_id):
        raise ValueError(f"Team {team_id} didn't play in match {match.id}")

    is_home = team_id == match.home_team_id
    side, opp_side = ("home", "away") if is_home else ("away", "home")
    opponent_id = match.away_team_id if is_home else match.home_team_id

    # the team's numbers and the opponent's, from the functions the match pages already use
    home_stats, away_stats = get_match_team_stats(db, match.id)
    mine, theirs = (home_stats, away_stats) if is_home else (away_stats, home_stats)

    attack = get_attack_area(db, match)["all"]  # whole match
    my_attack = attack[side]
    attacking_touches = sum(z["count"] for z in my_attack["zones"] if z["third"] == "attacking")

    progressive = sum(1 for p in get_passes(db, match) if p["team_id"] == team_id and p["is_progressive"])

    shots = [s for s in get_xg(db, match)["shots"] if not s["own_goal"]]
    big_chances = sum(1 for s in shots if s["team_id"] == team_id and s["xg"] >= BIG_CHANCE_XG)
    big_chances_against = sum(1 for s in shots if s["team_id"] == opponent_id and s["xg"] >= BIG_CHANCE_XG)

    # result (the shootout decides who goes through, but the match itself was a draw)
    goals_for = match.home_team_score if is_home else match.away_team_score
    goals_against = match.away_team_score if is_home else match.home_team_score
    result = "W" if goals_for > goals_against else "L" if goals_for < goals_against else "D"
    periods = get_periods(db, match.id)
    pens = get_penalties(db, match, periods)
    penalties = {"for": pens[side], "against": pens[opp_side]} if pens else None

    opponent = db.get(Team, opponent_id)
    return {
        "match_id": match.id,
        "team_id": team_id,
        "opponent_id": opponent_id,
        "opponent_name": opponent.name if opponent else "Unknown",
        "is_home": is_home,
        "match_date": match.match_date.isoformat(),
        "competition_stage": match.competition_stage,
        "group_name": match.group_name,
        "minutes": _match_minutes(db, match),
        "extra_time": 3 in periods,
        "result": result,  # "W" / "D" / "L" over 90 or 120 minutes
        "penalties": penalties,  # {"for": 4, "against": 2}, or None without a shootout
        "stats": {
            "goals_for": goals_for,
            "goals_against": goals_against,
            "xg": mine["xg"],
            "xg_against": theirs["xg"],
            "shots": mine["shots"],
            "shots_against": theirs["shots"],
            "shots_on_target": mine["shots_on_target"],
            "shots_on_target_against": theirs["shots_on_target"],
            "big_chances": big_chances,
            "big_chances_against": big_chances_against,
            "final_third_entries": my_attack["entries_total"],
            "progressive_passes": progressive,
            "possession": mine["possession"],
            "passes": mine["passes"],
            "pass_accuracy": mine["pass_accuracy"],
            "attacking_third_pct": (
                round(attacking_touches / my_attack["total"] * 100, 1) if my_attack["total"] else 0.0
            ),
            "corners": mine["corners"],
            "fouls": mine["fouls"],
            "yellow_cards": mine["yellow_cards"],
            "red_cards": mine["red_cards"],
        },
    }


def per_90(stats: dict, minutes: int) -> dict:
    """The same stats scaled to 90 minutes, so a 124-minute final and a 103-minute group game
    can be compared fairly. Only PER_90_STATS change; everything else is copied as it is."""
    if not minutes:
        return dict(stats)
    return {
        key: round(value * 90 / minutes, 2) if key in PER_90_STATS else value
        for key, value in stats.items()
    }


# ── PlayIQ performance score ──────────────────────────────────────────────────────────────
# A custom 0-100 rating of how well a team played in one match. Each part is worth a share of
# the 100 points and is measured with one or more stats. A stat earns 0 at or below a bottom-10%
# performance (p10 of every team in every match) and full marks at or above a top-10% one (p90),
# in a straight line between. The anchors are built by build_baselines.py and saved here:
BASELINES_FILE = Path(__file__).with_name("score_baselines.json")

# (part, max points, [(stat, share of the part, lower_is_better)]) — shares in a part add up to 1
SCORE_PARTS = [
    ("Chance creation", 30, [
        ("xg", 0.6, False),                      # how good the chances were
        ("shots_on_target", 0.2, False),         # how often they tested the keeper
        ("big_chances", 0.2, False),             # clear-cut chances (xG >= 0.3)
    ]),
    ("Defending", 25, [
        ("xg_against", 0.6, True),               # how good the opponent's chances were
        ("shots_on_target_against", 0.2, True),
        ("big_chances_against", 0.2, True),
    ]),
    ("Control", 20, [
        ("possession", 0.4, False),
        ("pass_accuracy", 0.3, False),
        ("progressive_passes", 0.3, False),      # passes that moved the ball well forward
    ]),
    ("Territory", 10, [
        ("attacking_third_pct", 0.5, False),     # share of touches in the attacking third
        ("final_third_entries", 0.5, False),     # passes into the final third
    ]),
]
RESULT_POINTS = 15
# A draw is worth half; winning the shootout adds a little on top (the match itself was a draw)
RESULT_SHARE = {"W": 1.0, "D": 0.5, "L": 0.0}
SHOOTOUT_WIN_SHARE = 0.2

SCORED_STATS = [stat for _, _, stats in SCORE_PARTS for stat, _, _ in stats]

BANDS = [(85, "Outstanding"), (70, "Strong"), (55, "Good"), (40, "Average"), (0, "Poor")]


@lru_cache(maxsize=1)
def load_baselines() -> dict:
    """The p10 / p90 anchors per stat (read once, then kept in memory)."""
    if not BASELINES_FILE.exists():
        raise RuntimeError("No score baselines yet: run  python -m app.analysis.build_baselines")
    return json.loads(BASELINES_FILE.read_text())["stats"]


def scale(value: float, low: float, high: float, lower_is_better: bool = False) -> float:
    """0 at `low`, 1 at `high`, a straight line in between, clamped to 0-1.
    For "lower is better" stats the line is flipped: low values get the most."""
    if high == low:
        return 0.5
    fraction = (value - low) / (high - low)
    if lower_is_better:
        fraction = 1 - fraction
    return max(0.0, min(1.0, fraction))


def round_half_up(value: float) -> int:
    """Nearest whole number, with .5 always going up (84.5 -> 85). Python's round() sends .5 to the
    even number (84.5 -> 84). The parts are already to one decimal, so the sum is first tidied to
    one decimal: adding floats can turn 84.5 into 84.49999..."""
    return int(Decimal(str(round(value, 1))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def performance_score(summary: dict, stats_90: dict) -> dict:
    """The PlayIQ performance score for one team in one match: the total out of 100, the points
    in each part (for the breakdown on the Compare page) and a band ("Strong", "Average", ...).
    `summary` is from get_team_match_summary, `stats_90` is per_90 of its stats."""
    baselines = load_baselines()
    parts = []
    for name, max_points, stats in SCORE_PARTS:
        fraction = sum(
            share * scale(stats_90[stat], baselines[stat]["p10"], baselines[stat]["p90"], lower_is_better)
            for stat, share, lower_is_better in stats
        )
        parts.append({"name": name, "points": round(fraction * max_points, 1), "max": max_points})

    result_share = RESULT_SHARE[summary["result"]]
    pens = summary["penalties"]
    if pens and pens["for"] > pens["against"]:
        result_share += SHOOTOUT_WIN_SHARE
    parts.insert(2, {"name": "Result", "points": round(result_share * RESULT_POINTS, 1), "max": RESULT_POINTS})

    total = round_half_up(sum(p["points"] for p in parts))
    band = next(label for floor, label in BANDS if total >= floor)
    return {"total": total, "band": band, "parts": parts}


# ── Key differences ───────────────────────────────────────────────────────────────────────
# The parts of the score where the two matches differ most, explained in plain English.
# Each part names the stat that best shows the gap (per 90 where that applies).
KEY_STAT = {
    "Chance creation": ("xg", "xG per 90", "{:.2f}"),
    "Defending": ("xg_against", "xG conceded per 90", "{:.2f}"),
    "Control": ("possession", "possession", "{:.0f}%"),
    "Territory": ("attacking_third_pct", "touches in the attacking third", "{:.0f}%"),
}


def _result_text(side: dict) -> str:
    """'a 3-3 draw with France (won 4-2 on penalties)', 'a 1-2 defeat to Saudi Arabia', ..."""
    gf, ga = side["stats"]["goals_for"], side["stats"]["goals_against"]
    opp = side["opponent_name"]
    text = {
        "W": f"a {gf}-{ga} win over {opp}",
        "D": f"a {gf}-{ga} draw with {opp}",
        "L": f"a {gf}-{ga} defeat to {opp}",
    }[side["result"]]
    pens = side["penalties"]
    if pens:
        won = pens["for"] > pens["against"]
        text += f" ({'won' if won else 'lost'} {pens['for']}-{pens['against']} on penalties)"
    return text


def _difference_text(part: str, winner: dict, loser: dict, letter: str) -> str:
    """One sentence on why the winning match did better in this part."""
    w90, l90 = winner["stats_per_90"], loser["stats_per_90"]
    if part == "Chance creation":
        return (f"Created better chances against {winner['opponent_name']}: {w90['xg']:.2f} xG and "
                f"{w90['shots_on_target']:.1f} shots on target per 90, against {l90['xg']:.2f} and "
                f"{l90['shots_on_target']:.1f} versus {loser['opponent_name']}.")
    if part == "Defending":
        return (f"Gave away less in Match {letter}: {winner['opponent_name']} made "
                f"{w90['xg_against']:.2f} xG per 90, {loser['opponent_name']} made {l90['xg_against']:.2f}.")
    if part == "Result":
        text = _result_text(winner)
        # not .capitalize(): it lowercases team names
        return f"{text[0].upper()}{text[1:]}, against {_result_text(loser)}."
    if part == "Control":
        return (f"Had more control against {winner['opponent_name']}: {w90['possession']:.0f}% possession and "
                f"{w90['pass_accuracy']:.0f}% pass accuracy, against {l90['possession']:.0f}% and "
                f"{l90['pass_accuracy']:.0f}%.")
    return (f"Played further up the pitch against {winner['opponent_name']}: "
            f"{w90['attacking_third_pct']:.0f}% of touches in the attacking third and "
            f"{w90['final_third_entries']:.1f} final-third entries per 90.")


def key_differences(a: dict, b: dict, limit: int = 3) -> list[dict]:
    """The parts of the score with the biggest gap between match A and match B, biggest first.
    a and b are the sides built in get_comparison (summary + stats_per_90 + score)."""
    diffs = []
    for part_a, part_b in zip(a["score"]["parts"], b["score"]["parts"], strict=True):
        gap = round(part_a["points"] - part_b["points"], 1)
        if gap == 0:
            continue
        letter = "A" if gap > 0 else "B"
        winner, loser = (a, b) if gap > 0 else (b, a)
        name = part_a["name"]
        if name == "Result":
            values = {"a": f"{a['stats']['goals_for']}-{a['stats']['goals_against']}",
                      "b": f"{b['stats']['goals_for']}-{b['stats']['goals_against']}"}
            unit = "score"
        else:
            stat, unit, fmt = KEY_STAT[name]
            values = {"a": fmt.format(a["stats_per_90"][stat]), "b": fmt.format(b["stats_per_90"][stat])}
        diffs.append({
            "part": name,
            "better": letter,                # which match did better in this part
            "points_gap": abs(gap),          # how many score points the gap is worth
            "text": _difference_text(name, winner, loser, letter),
            "values": values,                # the key stat for A and B, ready to show
            "unit": unit,
        })
    diffs.sort(key=lambda d: d["points_gap"], reverse=True)
    return diffs[:limit]


# ── Opponent strength ─────────────────────────────────────────────────────────────────────
def season_xg_difference(db: Session, league_id: int, season_id: int) -> dict[int, dict]:
    """Every team's xG difference over a whole season (xG created minus xG conceded, shootouts
    left out) and its rank, best first: {team_id: {"xg_difference": 4.12, "rank": 3, "teams": 32}}.
    Not in the score yet; the Compare page shows it on each card so opponents can be judged."""
    matches = db.scalars(select(Match).where(Match.league_id == league_id, Match.season_id == season_id)).all()
    shots = db.execute(
        select(Event.match_id, Event.team_id, Event.details)
        .join(Match, Match.id == Event.match_id)
        .where(Match.league_id == league_id, Match.season_id == season_id,
               Event.event_type == "Shot", Event.period <= 4)
    ).all()
    xg = {}  # (match_id, team_id) -> xG created in that match
    for match_id, team_id, details in shots:
        xg[(match_id, team_id)] = xg.get((match_id, team_id), 0) + (details or {}).get("statsbomb_xg", 0)

    difference = {}
    for m in matches:
        home, away = xg.get((m.id, m.home_team_id), 0), xg.get((m.id, m.away_team_id), 0)
        difference[m.home_team_id] = difference.get(m.home_team_id, 0) + home - away
        difference[m.away_team_id] = difference.get(m.away_team_id, 0) + away - home

    ranked = sorted(difference.items(), key=lambda item: item[1], reverse=True)
    return {team_id: {"xg_difference": round(value, 2), "rank": i + 1, "teams": len(ranked)}
            for i, (team_id, value) in enumerate(ranked)}


# ── The whole comparison ──────────────────────────────────────────────────────────────────
def get_comparison(db: Session, match_a: Match, match_b: Match, team_id: int) -> dict:
    """Everything the Compare page shows for one team in two matches: each match's summary,
    stats per 90 and performance score, the verdict, and the key differences.
    Raises ValueError if the team didn't play in one of the matches."""
    sides = {}
    for key, match in (("a", match_a), ("b", match_b)):
        summary = get_team_match_summary(db, match, team_id)
        stats_90 = per_90(summary["stats"], summary["minutes"])
        strength = season_xg_difference(db, match.league_id, match.season_id).get(summary["opponent_id"])
        sides[key] = {**summary, "stats_per_90": stats_90, "score": performance_score(summary, stats_90),
                      "opponent_strength": strength}

    a_total, b_total = sides["a"]["score"]["total"], sides["b"]["score"]["total"]
    team = db.get(Team, team_id)
    return {
        "team_id": team_id,
        "team_name": team.name if team else "Unknown",
        "a": sides["a"],
        "b": sides["b"],
        "verdict": {
            "better": None if a_total == b_total else ("A" if a_total > b_total else "B"),
            "points_gap": abs(a_total - b_total),
        },
        "key_differences": key_differences(sides["a"], sides["b"]),
    }
