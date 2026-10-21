from itertools import pairwise

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.models import Event, Match

# Shot outcomes where the keeper had to deal with it, or it went in
ON_TARGET = {"Goal", "Saved", "Saved to Post"}

# Periods 1-4 are open play (incl. extra time); 5 is the penalty shootout
IN_PLAY_PERIODS = {1, 2, 3, 4}


def _details(event: Event) -> dict:
    """The type-specific JSON, or an empty dict when the event has none."""
    return event.details or {}


def _card(event: Event) -> str | None:
    """'Yellow Card', 'Second Yellow', 'Red Card' or None.
    Cards sit in the details of fouls and of 'Bad Behaviour' (e.g. dissent, or from the bench)."""
    if event.event_type not in ("Foul Committed", "Bad Behaviour"):
        return None
    return _details(event).get("card", {}).get("name")


def _team_stats(events: list[Event], team_id: int) -> dict:
    """Counting stats for one team."""
    stats = {
        "xg": 0.0,
        "shots": 0,
        "shots_on_target": 0,
        "passes": 0,
        "completed_passes": 0,
        "corners": 0,
        "fouls": 0,
        "yellow_cards": 0,
        "red_cards": 0,
    }

    for event in events:
        if event.team_id != team_id:
            continue

        # Cards count in every period, shootout included (they're part of the official tally)
        card = _card(event)
        if card == "Yellow Card":
            stats["yellow_cards"] += 1
        elif card in ("Second Yellow", "Red Card"):  # a second yellow is a sending-off
            stats["red_cards"] += 1

        if event.period not in IN_PLAY_PERIODS:
            continue  # shootout kicks aren't shots in the match stats

        if event.event_type == "Shot":
            stats["shots"] += 1
            stats["xg"] += _details(event).get("statsbomb_xg", 0)
            if event.outcome in ON_TARGET:
                stats["shots_on_target"] += 1

        elif event.event_type == "Pass":
            stats["passes"] += 1
            if event.outcome is None:  # StatsBomb leaves completed passes without an outcome
                stats["completed_passes"] += 1
            if _details(event).get("type", {}).get("name") == "Corner":
                stats["corners"] += 1

        elif event.event_type == "Foul Committed":
            stats["fouls"] += 1

    passes = stats.pop("completed_passes"), stats["passes"]
    stats["pass_accuracy"] = round(passes[0] / passes[1] * 100, 1) if passes[1] else 0.0
    stats["xg"] = round(stats["xg"], 2)
    return stats


# A gap this long between two events means the ball was dead (injury, substitution,
# goal celebration, keeper holding the ball), so nobody is credited with possession.
DEAD_BALL_SECONDS = 30


def _possession_seconds(events: list[Event]) -> dict[int, int]:
    """Seconds on the ball per team: the time from each event to the next one is
    credited to the team in possession at that moment."""
    seconds: dict[int, int] = {}
    # Sort by match clock, not event_index: around period boundaries event_index isn't
    # strictly chronological (e.g. a 'Half End' indexed straight after the kick-off).
    in_play = sorted(
        (e for e in events if e.period in IN_PLAY_PERIODS and e.possession_team_id),
        key=lambda e: (e.period, e.minute, e.second, e.event_index),
    )
    for current, following in pairwise(in_play):
        if following.period != current.period:
            continue  # don't count half-time or the break before extra time
        gap = (following.minute * 60 + following.second) - (current.minute * 60 + current.second)
        if 0 < gap < DEAD_BALL_SECONDS:
            seconds[current.possession_team_id] = seconds.get(current.possession_team_id, 0) + gap
    return seconds


def calculate_stats(events: list[Event], home_team: int, away_team: int):
    """Team stats for one match. Pass in ALL of the match's events (every period):
    shootout kicks are excluded here, but shootout cards still count."""
    home_team_stats = _team_stats(events, home_team)
    away_team_stats = _team_stats(events, away_team)

    # Possession is a PlayIQ estimate: each team's share of time on the ball
    seconds = _possession_seconds(events)
    home_s, away_s = seconds.get(home_team, 0), seconds.get(away_team, 0)
    total = home_s + away_s
    home_team_stats["possession"] = round(home_s / total * 100, 1) if total else 50.0
    away_team_stats["possession"] = round(100 - home_team_stats["possession"], 1)

    return home_team_stats, away_team_stats


def get_match_team_stats(db: Session, match_id: int) -> tuple[dict, dict]:
    """(home_stats, away_stats) for a match: the numbers the Overview card shows.
    Used by the /team_stats route and by the AI summary, so both always agree."""
    match = db.get(Match, match_id)
    # all periods: calculate_stats leaves out shootout kicks itself, but shootout cards still count
    events = db.scalars(select(Event).where(Event.match_id == match_id)).all()
    return calculate_stats(events, match.home_team_id, match.away_team_id)
