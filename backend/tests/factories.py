"""Small matches built straight into the test database.

    match = add_match(db, events=[goal(HOME, minute=22, player=10), half_end(1, 47), half_end(2, 94)])
"""

import itertools
import uuid
from datetime import date

from app.models.models import Event, League, Lineup, Match, Player, Season, Team

LEAGUE, SEASON = 43, 106
HOME, AWAY = 771, 772
MATCH_ID = 1000

_index = itertools.count(1)


def event(event_type, team=HOME, period=1, minute=0, second=0, player=None, outcome=None, details=None,
          x=None, y=None, end_x=None, end_y=None):
    """Event fields for add_match (match_id and event_index are filled in there)."""
    return {
        "x": x,
        "y": y,
        "end_x": end_x,
        "end_y": end_y,
        "event_type": event_type,
        "team_id": team,
        "period": period,
        "minute": minute,
        "second": second,
        "player_id": player,
        "outcome": outcome,
        "details": details,
        "possession_team_id": team,
    }


def shot(team=HOME, outcome="Off T", xg=0.1, penalty=False, **kwargs):
    details = {"statsbomb_xg": xg}
    if penalty:
        details["type"] = {"name": "Penalty"}
    return event("Shot", team=team, outcome=outcome, details=details, **kwargs)


def goal(team=HOME, **kwargs):
    return shot(team=team, outcome="Goal", **kwargs)


def pass_(x, y, end_x, end_y, team=HOME, completed=True, **kwargs):
    return event("Pass", team=team, x=x, y=y, end_x=end_x, end_y=end_y,
                 outcome=None if completed else "Incomplete", **kwargs)


def card(name, team=HOME, event_type="Foul Committed", **kwargs):
    return event(event_type, team=team, details={"card": {"name": name}}, **kwargs)


def substitution(player_off, player_on, team=HOME, on_name="Unknown sub", reason="Tactical", **kwargs):
    details = {"replacement": {"id": player_on, "name": on_name}, "outcome": {"name": reason}}
    return event("Substitution", team=team, player=player_off, details=details, **kwargs)


def own_goal(by_team, **kwargs):
    """An own goal put in by a player of `by_team` (it counts for the other team)."""
    return event("Own Goal Against", team=by_team, **kwargs)


def half_end(period, minute, team=HOME):
    return event("Half End", team=team, period=period, minute=minute)


def add_match(db, match_id=MATCH_ID, home_score=0, away_score=0, events=(), players=(),
              home_name="Argentina", away_name="France", stage="Final", match_date=date(2022, 12, 18)):
    """Insert a match (and its league, season, teams and players when missing) with these events.
    players: (id, name, nickname) tuples."""
    if not db.get(League, LEAGUE):
        db.add(League(id=LEAGUE, name="FIFA World Cup", country="International", gender="male"))
        db.flush()
        db.add(Season(league_id=LEAGUE, id=SEASON, year="2022"))
    for team_id, name in ((HOME, home_name), (AWAY, away_name)):
        if not db.get(Team, team_id):
            db.add(Team(id=team_id, name=name, country=name, gender="male"))
    for player_id, name, nickname in players:
        if not db.get(Player, player_id):
            db.add(Player(id=player_id, name=name, nickname=nickname))
    db.flush()

    match = Match(
        id=match_id, league_id=LEAGUE, season_id=SEASON, home_team_id=HOME, away_team_id=AWAY,
        match_date=match_date, home_team_score=home_score, away_team_score=away_score,
        competition_stage=stage,
    )
    db.add(match)
    db.flush()
    for fields in events:
        db.add(Event(id=uuid.uuid4(), match_id=match_id, event_index=next(_index), **fields))
    db.flush()
    return match


def add_events(db, match_id=MATCH_ID, events=()):
    """More events for a match that already exists."""
    for fields in events:
        db.add(Event(id=uuid.uuid4(), match_id=match_id, event_index=next(_index), **fields))
    db.flush()


def add_lineup(db, player_id, team=HOME, match_id=MATCH_ID, jersey=10, starter=True, minutes=90):
    db.add(Lineup(match_id=match_id, player_id=player_id, team_id=team, jersey_number=jersey,
                  starter=starter, minutes_played=minutes, position="Center Forward" if starter else None))
    db.flush()
