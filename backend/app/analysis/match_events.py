"""Match events: goals, shootout, extra time, cards, substitutions and the timeline.
Shared by the match routes and the AI summary, so they always describe a match the same way.
"""

import math
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.models import Event, Lineup, Match, Player
from app.analysis.team_stats import ON_TARGET

# minute at which each period's normal time ends; anything later is stoppage time
PERIOD_END = {1: 45, 2: 90, 3: 105, 4: 120}

GOAL = (120, 40)


def minute_label(minute: int, period: int) -> str:
    """StatsBomb minutes count from 0 (22 = the 23rd minute); stoppage time shows as 45+3'."""
    end = PERIOD_END.get(period)
    if end is not None and minute >= end:
        return f"{end}+{minute - end + 1}'"
    return f"{minute + 1}'"


def display_name(player: Player) -> str:
    return player.nickname or player.name


def get_goals(db: Session, match: Match) -> list[dict]:
    """Goals in match order (shootout kicks excluded). An own goal counts for the other
    team; its player_name is the player who put it in his own net."""
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.period <= 4,
            ((Event.event_type == "Shot") & (Event.outcome == "Goal"))
            | (Event.event_type == "Own Goal Against"),
        )
        .order_by(Event.event_index)
    ).all()

    goals = []
    for event, player in rows:
        own_goal = event.event_type == "Own Goal Against"
        if own_goal:
            team_id = (
                match.away_team_id
                if event.team_id == match.home_team_id
                else match.home_team_id
            )
        else:
            team_id = event.team_id
        goals.append(
            {
                "type": "goal",
                "event_index": event.event_index,
                "team_id": team_id,
                "player_name": display_name(player) if player else "Unknown",
                "player_id": event.player_id,
                "minute": event.minute,
                "second": event.second,
                "minute_label": minute_label(event.minute, event.period),
                "period": event.period,
                "penalty": (event.details or {}).get("type", {}).get("name")
                == "Penalty",
                "own_goal": own_goal,
            }
        )
    return goals


def get_periods(db: Session, match_id: int) -> set[int]:
    """Which periods were played: {1, 2}, plus 3/4 for extra time, plus 5 for a shootout."""
    return set(
        db.scalars(select(Event.period).where(Event.match_id == match_id).distinct())
    )


def get_period_ends(db: Session, match_id: int) -> list[dict]:
    """When each period ended (its 'Half End' event), e.g. [{"period": 1, "end_minute": 52}, ...].
    Stoppage time means these aren't simply 45/90: the frontend uses them to place the dividers.
    """
    rows = db.execute(
        select(Event.period, func.max(Event.minute))
        .where(
            Event.match_id == match_id,
            Event.period <= 4,
            Event.event_type == "Half End",
        )
        .group_by(Event.period)
        .order_by(Event.period)
    ).all()
    return [{"period": period, "end_minute": end} for period, end in rows]


def get_penalties(db: Session, match: Match, periods: set[int]) -> dict | None:
    """Shootout score {"home": 4, "away": 2}, or None if there was no shootout."""
    if 5 not in periods:
        return None
    scorers = db.scalars(
        select(Event.team_id).where(
            Event.match_id == match.id,
            Event.period == 5,
            Event.event_type == "Shot",
            Event.outcome == "Goal",
        )
    ).all()
    return {
        "home": sum(1 for t in scorers if t == match.home_team_id),
        "away": sum(1 for t in scorers if t == match.away_team_id),
    }


def get_yellow_red_cards(
    db: Session, match: Match, include_shootout: bool = False
) -> list[dict]:
    """Cards shown in periods 1-4, plus the penalty shootout when include_shootout=True
    (the timeline leaves those out; lineups include them). A card is stored in details["card"] of a 'Foul Committed'
    or 'Bad Behaviour' event (e.g. dissent, or shown on the bench): "Yellow Card",
    "Second Yellow" (a sending-off) or "Red Card"."""
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.period <= 4 if not include_shootout else Event.period <= 5,
            Event.event_type.in_(["Foul Committed", "Bad Behaviour"]),
        )
        .order_by(Event.event_index)
    ).all()
    cards = []
    for event, player in rows:
        card = (event.details or {}).get("card", {}).get("name")
        if not card:
            continue  # most fouls aren't booked
        cards.append(
            {
                "type": "card",
                "event_index": event.event_index,
                "team_id": event.team_id,
                "player_name": display_name(player) if player else "Unknown",
                "player_id": event.player_id,
                "minute_label": minute_label(event.minute, event.period),
                "period": event.period,
                "minute": event.minute,
                "second": event.second,
                "card": card,
                "second_yellow": card == "Second Yellow",
                "yellow_card": card == "Yellow Card",
                "red_card": card == "Red Card",
            }
        )
    return cards


def get_substitutions(db: Session, match: Match) -> list[dict]:
    subs = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.event_type == "Substitution",
        )
        .order_by(Event.event_index)
    ).all()
    substitutions = []
    for event, player_off in subs:
        details = event.details or {}
        replacement = details.get("replacement", {})
        player_on = db.get(Player, replacement.get("id"))
        substitutions.append(
            {
                "type": "substitution",
                "event_index": event.event_index,
                "team_id": event.team_id,
                "period": event.period,
                "minute": event.minute,
                "second": event.second,
                "minute_label": minute_label(event.minute, event.period),
                "player_off": display_name(player_off) if player_off else "Unknown",
                "player_on": (
                    display_name(player_on)
                    if player_on
                    else replacement.get("name", "Unknown")
                ),
                "player_off_id": event.player_id,
                "player_on_id": replacement.get("id"),
                "reason": details.get("outcome", {}).get(
                    "name"
                ),  # "Tactical" / "Injury"
            }
        )
    return substitutions


def get_timeline(db: Session, match: Match) -> tuple[list[dict], list[dict]]:
    """(events, periods): goals, cards and substitutions in match order, plus when each
    period ended. Every event has a "type": "goal", "card" or "substitution"."""
    events = (
        get_goals(db, match)
        + get_yellow_red_cards(db, match)
        + get_substitutions(db, match)
    )
    # match clock first; event_index only breaks ties within the same second
    events.sort(key=lambda e: (e["period"], e["minute"], e["second"], e["event_index"]))
    return events, get_period_ends(db, match.id)


def get_xg(db: Session, match: Match) -> dict:
    """Data for the xG race: every shot in periods 1-4 (the shootout isn't counted) plus
    own goals, in match order, and when each period ended.
    Own goals have no xG (they aren't shots) but are included so goal dots match the score.
    """
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.period <= 4,
            Event.event_type.in_(["Shot", "Own Goal Against"]),
        )
    ).all()

    shots = []
    for event, player in rows:
        details = event.details or {}
        own_goal = event.event_type == "Own Goal Against"
        if own_goal:
            # counts for the other team, like in get_goals
            team_id = (
                match.away_team_id
                if event.team_id == match.home_team_id
                else match.home_team_id
            )
        else:
            team_id = event.team_id
        shots.append(
            {
                "event_index": event.event_index,
                "team_id": team_id,
                "player_name": display_name(player) if player else "Unknown",
                "player_id": player.id if player else None,
                "period": event.period,
                "minute": event.minute,
                "second": event.second,
                "minute_label": minute_label(event.minute, event.period),
                "xg": 0.0 if own_goal else details.get("statsbomb_xg", 0.0),
                "outcome": (
                    "Own Goal" if own_goal else event.outcome
                ),  # "Goal", "Saved", "Off T", ...
                "goal": own_goal or event.outcome == "Goal",
                "penalty": details.get("type", {}).get("name") == "Penalty",
                "own_goal": own_goal,
                **build_shots(event),
            }
        )

    shots.sort(key=lambda e: (e["period"], e["minute"], e["second"], e["event_index"]))
    return {"shots": shots, "periods": get_period_ends(db, match.id)}


# How a missed shootout kick is described (StatsBomb shot outcomes)
MISS_LABELS = {
    "Saved": "Saved",
    "Saved to Post": "Saved",
    "Post": "Hit the post",
    "Off T": "Missed",
    "Wayward": "Missed",
}


def get_shootout(db: Session, match: Match) -> dict | None:
    """The penalty shootout kick by kick, or None if the match didn't have one."""
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.period == 5,
            Event.event_type == "Shot",
        )
        .order_by(Event.event_index)  # kick order
    ).all()
    if not rows:
        return None

    kicks, taken = [], {match.home_team_id: 0, match.away_team_id: 0}
    for order, (event, player) in enumerate(rows, start=1):
        taken[event.team_id] += 1
        goal = event.outcome == "Goal"
        kicks.append(
            {
                "order": order,  # 1, 2, 3, ... across both teams
                "taken": taken[event.team_id],  # this team's 1st, 2nd, ... kick
                "team_id": event.team_id,
                "player_name": display_name(player) if player else "Unknown",
                "goal": goal,
                "result": (
                    "Scored" if goal else MISS_LABELS.get(event.outcome, "Missed")
                ),
            }
        )

    home_score = sum(
        1 for k in kicks if k["team_id"] == match.home_team_id and k["goal"]
    )
    away_score = sum(
        1 for k in kicks if k["team_id"] == match.away_team_id and k["goal"]
    )
    return {
        "home_score": home_score,
        "away_score": away_score,
        "winner_team_id": (
            match.home_team_id if home_score > away_score else match.away_team_id
        ),
        "first_team_id": kicks[0]["team_id"],  # e.g. "France kicked first"
        "kicks": kicks,
    }


def format_formation(formation: int | str | None) -> str | None:
    """StatsBomb stores formations as numbers: 433 -> "4-3-3", 41212 -> "4-1-2-1-2"."""
    return "-".join(str(formation)) if formation else None


def get_formations(db: Session, match: Match) -> dict[int, str | None]:
    """Each team's starting formation, from its 'Starting XI' event."""
    rows = db.execute(
        select(Event.team_id, Event.details)
        .where(Event.match_id == match.id, Event.event_type == "Starting XI")
    ).all()
    formations = {match.home_team_id: None, match.away_team_id: None}
    for team_id, details in rows:
        formations[team_id] = format_formation((details or {}).get("formation"))
    return formations


def _substitutions_by_player(db: Session, match: Match) -> tuple[dict, dict]:
    """(came_off, came_on): each substitution looked up by the player it involved,
    so a player's own substitution can be found with one dictionary lookup."""
    came_off, came_on = {}, {}
    for sub in get_substitutions(db, match):
        came_off[sub["player_off_id"]] = sub
        came_on[sub["player_on_id"]] = sub
    return came_off, came_on


def _sub_facts(player_id: int, came_off: dict, came_on: dict) -> dict:
    """{"subbed_off": {...} | None, "subbed_on": {...} | None} for one player."""
    off, on = came_off.get(player_id), came_on.get(player_id)
    return {
        # e.g. Di María: off at 64', replaced by Marcos Acuña
        "subbed_off": {"minute_label": off["minute_label"], "replaced_by": off["player_on"], "reason": off["reason"]} if off else None,
        # e.g. Acuña: on at 64', for Ángel Di María
        "subbed_on": {"minute_label": on["minute_label"], "replaced": on["player_off"], "reason": on["reason"]} if on else None,
    }


def get_lineups(db: Session, match: Match) -> dict:
    """Both squads for a match: {"players": {team_id: [...]}, "formations": {team_id: "4-3-3"}}.
    Players are listed starters first, then by shirt number, each with their goals, cards and
    substitution (if any) attached by player_id."""
    rows = db.execute(
        select(Lineup, Player)
        .join(Player, Player.id == Lineup.player_id)
        .where(Lineup.match_id == match.id)
        .order_by(Lineup.starter.desc(), Lineup.jersey_number)
    ).all()
    goals = get_goals(db, match)
    yellow_red_cards = get_yellow_red_cards(db, match, include_shootout=True)
    came_off, came_on = _substitutions_by_player(db, match)

    players = {match.home_team_id: [], match.away_team_id: []}
    for row, player in rows:
        if row.team_id not in players:
            continue
        players[row.team_id].append({
            "player_id": row.player_id,
            "player_name": display_name(player),
            "team_id": row.team_id,
            "jersey_number": row.jersey_number,
            "position": row.position,  # starting position; None for unused substitutes
            "starter": row.starter,
            "minutes_played": row.minutes_played,
            "goals": [g for g in goals if g["player_id"] == row.player_id],
            "yellow_red_cards": [c for c in yellow_red_cards if c["player_id"] == row.player_id],
            **_sub_facts(row.player_id, came_off, came_on),
        })
    return {"players": players, "formations": get_formations(db, match)}


def is_progressive(e: Event) -> bool:
    if e.outcome is not None or e.x is None or e.end_x is None or e.x < 40:
        return False
    before = math.dist((e.x, e.y), GOAL)
    after = math.dist((e.end_x, e.end_y), GOAL)
    return after <= 0.75 * before


def get_passes(db: Session, match: Match, player_id: int | None = None) -> list[dict]:
    """One player's passes in a match, in match order. details holds the pass flags
    (goal_assist, shot_assist, cross, ...) and assisted_shot_id for key passes."""
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            (Event.player_id == player_id if player_id is not None else True),
            Event.event_type == "Pass",
        )
        .order_by(Event.event_index)
    ).all()
    passes = []
    for event, player in rows:
        passes.append(
            {
                "event_id": event.id,
                "team_id": event.team_id,
                "player_id": event.player_id,
                "player_name": display_name(player) if player else "Unknown",
                "event_type": event.event_type,
                "event_index": event.event_index,
                "period": event.period,
                "details": event.details or {},  # pass flags for the player stats; left out of /passes by PassOut
                "recipient_id": (event.details or {}).get("recipient", {}).get("id"),
                "is_progressive": is_progressive(event),
                "into_final_third": event.outcome is None and event.x < 80 and event.end_x >= 80,
                "into_box": event.outcome is None and event.end_x >= 102 and 18 <= event.end_y <= 62,
                **build_passes(event),
            }
        )
    return passes


def _expected_assists(db: Session, passes: list[dict]) -> float:
    """xA: the total xG of the shots this player's passes set up. A key pass stores the
    shot it led to in details["assisted_shot_id"] (a string; Event.id is a UUID)."""
    shot_ids = [
        uuid.UUID(p["details"]["assisted_shot_id"])
        for p in passes
        if "assisted_shot_id" in p["details"]
    ]
    if not shot_ids:
        return 0.0
    shots = db.scalars(select(Event).where(Event.id.in_(shot_ids))).all()
    return round(sum((shot.details or {}).get("statsbomb_xg", 0) for shot in shots), 2)


def get_dribbles(db: Session, match: Match, player_id: int):
    """Get all dribbles by a player in a match, in match order."""
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.player_id == player_id,
            Event.event_type == "Dribble",
        )
        .order_by(Event.event_index)
    ).all()
    dribbles = []
    for event, player in rows:
        dribbles.append(
            {
                "event_id": event.id,
                "team_id": event.team_id,
                "player_id": event.player_id,
                "player_name": display_name(player) if player else "Unknown",
                "event_type": event.event_type,
                "outcome": event.outcome,
                "event_index": event.event_index,
                "details": event.details or {},
            }
        )
    return dribbles


# On-ball actions that count as a touch. Left out: Pressure (made without the ball),
# Carry (starts exactly where the Ball Receipt was, so it would count the same moment twice),
# and Duel / Foul events (contact with a player, not the ball).
TOUCH_TYPES = {
    "Pass",
    "Ball Receipt*",
    "Shot",
    "Dribble",
    "Clearance",
    "Interception",
    "Ball Recovery",
    "Block",
    "Miscontrol",
    "Goal Keeper",
}

# Duel and Interception outcomes where the defender came away with the ball (or put it out safely)
WON_OUTCOMES = {"Won", "Success In Play", "Success Out"}


def _is_touch(event: Event) -> bool:
    if event.event_type not in TOUCH_TYPES or event.period > 4:
        return False
    details = event.details or {}
    if event.event_type == "Ball Receipt*" and event.outcome is not None:
        return False  # "Incomplete": the pass never actually reached him
    if event.event_type == "Ball Recovery" and details.get("recovery_failure"):
        return False  # tried to win the ball back and didn't
    return True


def _count_actions(events: list[Event]) -> dict:
    """Touches, defending and discipline/losses, counted from one player's events."""

    def count(event_type: str, condition=lambda e: True) -> int:
        return sum(1 for e in events if e.event_type == event_type and condition(e))

    def duel_type(e: Event) -> str | None:
        return (e.details or {}).get("type", {}).get("name")

    return {
        "touches": sum(1 for e in events if _is_touch(e)),
        # defending
        "tackles": count("Duel", lambda e: duel_type(e) == "Tackle"),
        "tackles_won": count(
            "Duel", lambda e: duel_type(e) == "Tackle" and e.outcome in WON_OUTCOMES
        ),
        "interceptions": count("Interception"),
        "interceptions_won": count("Interception", lambda e: e.outcome in WON_OUTCOMES),
        "clearances": count("Clearance"),
        "blocks": count("Block"),
        "ball_recoveries": count(
            "Ball Recovery", lambda e: not (e.details or {}).get("recovery_failure")
        ),
        "pressures": count("Pressure"),
        "aerials_lost": count("Duel", lambda e: duel_type(e) == "Aerial Lost"),
        # discipline and losses
        "fouls_committed": count("Foul Committed"),
        "fouls_won": count("Foul Won"),
        "dispossessed": count("Dispossessed"),  # lost the ball to a tackle
        "miscontrols": count("Miscontrol"),  # lost the ball through a bad touch
        "dribbled_past": count("Dribbled Past"),  # an opponent dribbled past him
    }
    
def build_shots(e: Event) -> dict:
    details = e.details or {}
    return {
        "x": e.x,
        "y": e.y,
        "end_x": e.end_x,
        "end_y": e.end_y,
        "body_part": details.get("body_part", {}).get("name"),
        "shot_type": details.get("type", {}).get("name"),
    }
    
def build_passes(e: Event) -> dict:
    return {
        "x": e.x,
        "y": e.y,
        "end_x": e.end_x,
        "end_y": e.end_y,
        "completed": e.outcome is None,
    }


def build_maps(events: list[Event]) -> dict:
    """Builds maps of various event types for a player's events."""
    in_play = [e for e in events if e.period <= 4]
    return {
        "shots": [
            {
                **build_shots(e),
                "minute_label": minute_label(e.minute, e.period),
                "xg": round((e.details or {}).get("statsbomb_xg", 0), 2),
                "outcome": e.outcome,
            }
            for e in in_play
            if e.event_type == "Shot"
        ],
        "passes": [
            {
                **build_passes(e)
            }
            for e in in_play
            if e.event_type == "Pass"
        ],
        "touches": [
            {"x": e.x, "y": e.y} for e in in_play if _is_touch(e) and e.x is not None
        ],
    }


def _map_stats(maps: dict) -> dict:
    """The numbers shown above the pass and touch maps (StatsBomb: x = 120 is the opponent's goal line,
    so the final/attacking third is x >= 80)."""
    passes, touches = maps["passes"], maps["touches"]
    in_attacking_third = sum(1 for t in touches if t["x"] >= 80)
    return {
        # completed passes that started outside the final third and ended inside it
        "passes_into_final_third": sum(
            1 for p in passes if p["completed"] and p["x"] < 80 and (p["end_x"] or 0) >= 80
        ),
        "touches_in_attacking_third_pct": round(in_attacking_third / len(touches) * 100) if touches else 0,
    }


def _team_ranks(db: Session, match: Match, team_id: int, player_id: int) -> dict:
    """Where the player ranks in his team for xG, passes and touches,
    e.g. {"passes": {"rank": 2, "of": 14, "joint": False}}. Only players who played are compared,
    and a rank is None when the player has none of that stat (the panel then hides it)."""
    played = db.scalars(
        select(Lineup.player_id).where(
            Lineup.match_id == match.id, Lineup.team_id == team_id, Lineup.minutes_played > 0
        )
    ).all()
    events = db.scalars(
        select(Event).where(
            Event.match_id == match.id, Event.team_id == team_id,
            Event.player_id.in_(played), Event.period <= 4,
        )
    ).all()

    totals = {pid: {"xg": 0.0, "passes": 0, "touches": 0} for pid in played}
    for e in events:
        t = totals[e.player_id]
        if e.event_type == "Shot":
            t["xg"] += (e.details or {}).get("statsbomb_xg", 0)
        elif e.event_type == "Pass":
            t["passes"] += 1
        if _is_touch(e):
            t["touches"] += 1

    ranks = {}
    for stat in ("xg", "passes", "touches"):
        mine = totals.get(player_id, {}).get(stat, 0)
        if not mine:
            ranks[stat] = None
            continue
        values = [t[stat] for t in totals.values()]
        ranks[stat] = {
            "rank": 1 + sum(1 for v in values if v > mine + 1e-9),           # how many teammates did better, + 1
            "of": len(values),
            "joint": sum(1 for v in values if abs(v - mine) <= 1e-9) > 1,     # someone else has exactly the same
        }
    return ranks


def get_player_events(db: Session, match: Match, player_id: int) -> dict:
    """One player's match for the player panel: who they are and what happened to them (player),
    their numbers (summary), coordinates for the three maps (maps), and team ranks (ranks)."""
    rows = db.execute(
        select(Event)
        .where(Event.match_id == match.id, Event.player_id == player_id)
        .order_by(Event.event_index)
    ).all()
    player_events = [event for (event,) in rows]

    lineup = db.get(Lineup, (match.id, player_id))  # this player's row in this match
    player = db.get(Player, player_id)

    shots = [s for s in get_xg(db, match)["shots"] if s["player_id"] == player_id and not s["own_goal"]]
    goals = [g for g in get_goals(db, match) if g["player_id"] == player_id and not g["own_goal"]]
    passes = get_passes(db, match, player_id)
    completed = sum(1 for p in passes if p["completed"])
    dribbles = get_dribbles(db, match, player_id)
    cards = [c for c in get_yellow_red_cards(db, match, include_shootout=True) if c["player_id"] == player_id]
    came_off, came_on = _substitutions_by_player(db, match)

    info = {
        "player_id": player_id,
        "player_name": display_name(player),
        "full_name": player.name,
        "team_id": lineup.team_id,
        "jersey_number": lineup.jersey_number,
        "position": lineup.position,
        "starter": lineup.starter,
        "minutes_played": lineup.minutes_played or 0,  # 0 = unused substitute ("Didn't play")
        # for the facts list: "Goals: 23' (pen), 108'", "Yellow card: 45+7'", "Came on 64', for ..."
        "goals": [{"minute_label": g["minute_label"], "penalty": g["penalty"]} for g in goals],
        "cards": [{"minute_label": c["minute_label"], "card": c["card"], "period": c["period"]} for c in cards],
        **_sub_facts(player_id, came_off, came_on),
    }

    summary = {
        "goals": len(goals),
        "xg": round(sum(s["xg"] for s in shots), 2),
        "shots": len(shots),
        "shots_on_target": sum(1 for s in shots if s["outcome"] in ON_TARGET),
        "passes": len(passes),
        "assists": sum(1 for p in passes if p["details"].get("goal_assist")),
        # any pass that led to a shot (an assist is also a key pass)
        "key_passes": sum(1 for p in passes if p["details"].get("goal_assist") or p["details"].get("shot_assist")),
        "xa": _expected_assists(db, passes),
        "passes_completed": completed,
        "pass_accuracy": round(completed / len(passes) * 100, 1) if passes else 0,
        "crosses": sum(1 for p in passes if p["details"].get("cross")),
        "through_balls": sum(1 for p in passes if p["details"].get("through_ball")),
        "dribbles": len(dribbles),
        # outcome is the plain text column: "Complete" / "Incomplete"
        "dribbles_completed": sum(1 for d in dribbles if d["outcome"] == "Complete"),
        **_count_actions(player_events),
        "yellow_cards": sum(1 for c in cards if c["card"] == "Yellow Card"),
        "red_cards": sum(1 for c in cards if c["card"] in ("Second Yellow", "Red Card")),
    }

    maps = build_maps(player_events)
    summary.update(_map_stats(maps))

    return {
        "player": info,
        "summary": summary,
        "maps": maps,
        "ranks": _team_ranks(db, match, lineup.team_id, player_id),
    }