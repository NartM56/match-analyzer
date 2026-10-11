"""Match events: goals, shootout, extra time, cards, substitutions and the timeline.
Shared by the match routes and the AI summary, so they always describe a match the same way."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.models import Event, Lineup, Match, Player

# minute at which each period's normal time ends; anything later is stoppage time
PERIOD_END = {1: 45, 2: 90, 3: 105, 4: 120}


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
            team_id = match.away_team_id if event.team_id == match.home_team_id else match.home_team_id
        else:
            team_id = event.team_id
        goals.append({
            "type": "goal",
            "event_index": event.event_index,
            "team_id": team_id,
            "player_name": display_name(player) if player else "Unknown",
            "minute": event.minute,
            "second": event.second,
            "minute_label": minute_label(event.minute, event.period),
            "period": event.period,
            "penalty": (event.details or {}).get("type", {}).get("name") == "Penalty",
            "own_goal": own_goal,
        })
    return goals


def get_periods(db: Session, match_id: int) -> set[int]:    
    """Which periods were played: {1, 2}, plus 3/4 for extra time, plus 5 for a shootout."""
    return set(db.scalars(select(Event.period).where(Event.match_id == match_id).distinct()))

def get_period_ends(db: Session, match_id: int) -> list[dict]:
    """When each period ended (its 'Half End' event), e.g. [{"period": 1, "end_minute": 52}, ...].
    Stoppage time means these aren't simply 45/90: the frontend uses them to place the dividers."""
    rows = db.execute(
        select(Event.period, func.max(Event.minute))
        .where(Event.match_id == match_id, Event.period <= 4, Event.event_type == "Half End")
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
    
def get_yellow_red_cards(db: Session, match: Match) -> list[dict]:
    """Cards shown in periods 1-4. A card is stored in details["card"] of a 'Foul Committed'
    or 'Bad Behaviour' event (e.g. dissent, or shown on the bench): "Yellow Card",
    "Second Yellow" (a sending-off) or "Red Card"."""
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match.id,
            Event.period <= 4,
            Event.event_type.in_(["Foul Committed", "Bad Behaviour"]),
        )
        .order_by(Event.event_index)
    ).all()
    cards = []
    for event, player in rows:
        card = (event.details or {}).get("card", {}).get("name")
        if not card:
            continue  # most fouls aren't booked
        cards.append({
            "type": "card",
            "event_index": event.event_index,
            "team_id": event.team_id,
            "player_name": display_name(player) if player else "Unknown",
            "minute_label": minute_label(event.minute, event.period),
            "period": event.period,
            "minute": event.minute,
            "second": event.second,
            "card": card,
            "second_yellow": card == "Second Yellow",
            "yellow_card": card == "Yellow Card",
            "red_card": card == "Red Card",
        })
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
        substitutions.append({
            "type": "substitution",
            "event_index": event.event_index,
            "team_id": event.team_id,
            "period": event.period,
            "minute": event.minute,
            "second": event.second,
            "minute_label": minute_label(event.minute, event.period),
            "player_off": display_name(player_off) if player_off else "Unknown",
            "player_on": display_name(player_on) if player_on else replacement.get("name", "Unknown"),
            "reason": details.get("outcome", {}).get("name"),  # "Tactical" / "Injury"
        })
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
    Own goals have no xG (they aren't shots) but are included so goal dots match the score."""
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
            team_id = match.away_team_id if event.team_id == match.home_team_id else match.home_team_id
        else:
            team_id = event.team_id
        shots.append({
            "event_index": event.event_index,
            "team_id": team_id,
            "player_name": display_name(player) if player else "Unknown",
            "period": event.period,
            "minute": event.minute,
            "second": event.second,
            "minute_label": minute_label(event.minute, event.period),
            "xg": 0.0 if own_goal else details.get("statsbomb_xg", 0.0),
            "outcome": "Own Goal" if own_goal else event.outcome,  # "Goal", "Saved", "Off T", ...
            "goal": own_goal or event.outcome == "Goal",
            "penalty": details.get("type", {}).get("name") == "Penalty",
            "own_goal": own_goal,
        })

    shots.sort(key=lambda e: (e["period"], e["minute"], e["second"], e["event_index"]))
    return {"shots": shots, "periods": get_period_ends(db, match.id)}
    

# How a missed shootout kick is described (StatsBomb shot outcomes)
MISS_LABELS = {"Saved": "Saved", "Saved to Post": "Saved", "Post": "Hit the post", "Off T": "Missed", "Wayward": "Missed"}


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
        kicks.append({
            "order": order,                      # 1, 2, 3, ... across both teams
            "taken": taken[event.team_id],       # this team's 1st, 2nd, ... kick
            "team_id": event.team_id,
            "player_name": display_name(player) if player else "Unknown",
            "goal": goal,
            "result": "Scored" if goal else MISS_LABELS.get(event.outcome, "Missed"),
        })

    home_score = sum(1 for k in kicks if k["team_id"] == match.home_team_id and k["goal"])
    away_score = sum(1 for k in kicks if k["team_id"] == match.away_team_id and k["goal"])
    return {
        "home_score": home_score,
        "away_score": away_score,
        "winner_team_id": match.home_team_id if home_score > away_score else match.away_team_id,
        "first_team_id": kicks[0]["team_id"],  # e.g. "France kicked first"
        "kicks": kicks,
    }
    

def get_lineups(db: Session, match: Match) -> dict:
    """Both squads for a match, keyed by team id: starters first, then by shirt number.
    Each player includes their display name (nickname when StatsBomb has one)."""
    rows = db.execute(
        select(Lineup, Player)
        .join(Player, Player.id == Lineup.player_id)
        .where(Lineup.match_id == match.id)
        .order_by(Lineup.starter.desc(), Lineup.jersey_number)
    ).all()
    lineups = {match.home_team_id: [], match.away_team_id: []}
    for row, player in rows:
        if row.team_id not in lineups:
            continue
        lineups[row.team_id].append({
            "player_id": row.player_id,
            "player_name": display_name(player),
            "team_id": row.team_id,
            "jersey_number": row.jersey_number,
            "position": row.position,          # starting position; None for unused substitutes
            "starter": row.starter,
            "minutes_played": row.minutes_played,
        })
    return lineups
