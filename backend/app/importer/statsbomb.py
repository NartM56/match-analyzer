import json
import uuid
from datetime import date
from pathlib import Path

from app.models.models import Event, League, Lineup, Season, Team, Match, Player
from app.db.database import SessionLocal

DATA_DIR = Path(__file__).resolve().parents[3] / "data-sample"

def load_competitions():
    with open(DATA_DIR / "competitions.json", "r", encoding="utf-8" ) as f:
        competitions = json.load(f)
    return competitions

def import_competitions(session, competitions):
    for competition in competitions:
        league_id = competition["competition_id"]
        name = competition["competition_name"]
        gender = competition["competition_gender"]
        country = competition["country_name"]
        
        league = League(
            id = league_id,
            name = name,
            gender = gender,
            country = country
        )
        
        year = competition["season_name"]
        season_id = competition["season_id"]
        
        season = Season(
            league_id = league_id,
            id = season_id,
            year = year
        )
        session.merge(league)
        session.merge(season)
        session.flush()

def import_matches(session, competitions):
    for competition in competitions:
        league_id = competition["competition_id"]
        season_id = competition["season_id"]

        matches_file = DATA_DIR / "matches" / str(league_id) / f"{season_id}.json"
        if not matches_file.exists():
            continue

        with open(matches_file, "r", encoding="utf-8") as f:
            matches = json.load(f)

        for match in matches:

            home_team_id = match["home_team"]["home_team_id"]
            away_team_id = match["away_team"]["away_team_id"]

            home_team_name = match["home_team"]["home_team_name"]
            home_team_country = match["home_team"]["country"]["name"]
            home_team_gender = match["home_team"]["home_team_gender"]
            home_team = Team(
                id = home_team_id,
                name = home_team_name,
                country = home_team_country,
                gender = home_team_gender
            )
            session.merge(home_team)

            away_team_name = match["away_team"]["away_team_name"]
            away_team_country = match["away_team"]["country"]["name"]
            away_team_gender = match["away_team"]["away_team_gender"]
            away_team = Team(
                id = away_team_id,
                name = away_team_name,
                country = away_team_country,
                gender = away_team_gender
            )
            session.merge(away_team)
            session.flush()  # teams must exist before the match that references them

            match_id = match["match_id"]
            match_date = date.fromisoformat(match["match_date"])
            home_team_score = match["home_score"]
            away_team_score = match["away_score"]
            kick_off = match.get("kick_off")
            competition_stage = (match.get("competition_stage") or {}).get("name")
            match_week = match.get("match_week")  # missing in some older competitions
            # the group is stored per team; one World Cup match only has it on the away team
            group_name = (match["home_team"].get("home_team_group")
                          or match["away_team"].get("away_team_group"))

            match_obj = Match(
                id = match_id,
                match_date = match_date,
                home_team_id = home_team_id,
                away_team_id = away_team_id,
                home_team_score = home_team_score,
                away_team_score = away_team_score,
                league_id = league_id,
                season_id = season_id,
                kick_off = kick_off,
                competition_stage = competition_stage,
                match_week = match_week,
                group_name = group_name
            )
            session.merge(match_obj)
            session.flush()

            events = load_events(match_id)
            import_lineups(session, match_id, events)
            import_events(session, match_id, events)  # after lineups: events reference players


def load_events(match_id):
    events_file = DATA_DIR / "events" / f"{match_id}.json"
    if not events_file.exists():
        return []

    with open(events_file, "r", encoding="utf-8") as f:
        return json.load(f)


def to_minutes(t):
    """'64:10' -> 64.17, '105:45' -> 105.75"""
    minutes, seconds = t.split(":")
    return int(minutes) + int(seconds) / 60


def get_match_end(events):
    """Minute the last half ended before penalties (e.g. 124.1 for a match with extra time)."""
    half_ends = [
        event["minute"] + event["second"] / 60
        for event in events
        if event["type"]["name"] == "Half End" and event["period"] <= 4
    ]
    return max(half_ends, default=90)


def import_lineups(session, match_id, events):
    match_end = get_match_end(events)

    lineups_file = DATA_DIR / "lineups" / f"{match_id}.json"
    if not lineups_file.exists():
        return

    with open(lineups_file, "r", encoding="utf-8") as f:
        lineups = json.load(f)

    for lineup in lineups:
        team_id = lineup["team_id"]
        for player in lineup["lineup"]:
            player_id = player["player_id"]
            player_name = player["player_name"]
            player_country = (player.get("country") or {}).get("name")
            player_obj = Player(
                id = player_id,
                name = player_name,
                nickname = player.get("player_nickname"),
                country = player_country
            )
            session.merge(player_obj)
            session.flush()  # player must exist before its lineup row

            positions = player["positions"]
            if positions:
                first, last = positions[0], positions[-1]
                start = to_minutes(first["from"])
                # no "to" means until the final whistle; period 5 (penalties) restarts the clock
                if last["to"] and last["to_period"] != 5:
                    end = to_minutes(last["to"])
                else:
                    end = match_end
                minutes_played = round(end - start)
                starter = first["start_reason"] == "Starting XI"
                position = first["position"]
            else:  # unused substitute
                minutes_played = None
                starter = False
                position = None
            jersey_number = player["jersey_number"]

            lineup_obj = Lineup(
                match_id = match_id,
                team_id = team_id,
                player_id = player_id,
                minutes_played = minutes_played,
                position = position,
                jersey_number = jersey_number,
                starter = starter
            )
            session.merge(lineup_obj)
            session.flush()


# The type-specific data lives under a key named after the type ("Pass" -> "pass").
# These two don't follow that rule.
DETAIL_KEYS = {"Goal Keeper": "goalkeeper", "50/50": "50_50"}


def get_detail_key(event_type):
    return DETAIL_KEYS.get(event_type, event_type.lower().replace(" ", "_").replace("*", ""))


def import_events(session, match_id, events):
    for event in events:
        event_id = uuid.UUID(event["id"])
        event_index = event["index"]
        event_period = event["period"]
        event_type = event["type"]["name"]
        player_id = event["player"]["id"] if "player" in event else None
        team_id = event["team"]["id"] if "team" in event else None
        minute = event["minute"]
        second = event["second"]
        possession = event.get("possession")
        possession_team_id = event["possession_team"]["id"] if "possession_team" in event else None
        play_pattern = event["play_pattern"]["name"] if "play_pattern" in event else None
        under_pressure = event.get("under_pressure", False)  # only present when True

        location = event.get("location") or [None, None]
        start_x, start_y = location[0], location[1]

        details = event.get(get_detail_key(event_type))
        if not isinstance(details, dict):  # most types have no details at all
            details = None

        # shots have [x, y, height], so only take the first two
        end_location = (details or {}).get("end_location") or [None, None]
        end_x, end_y = end_location[0], end_location[1]

        # StatsBomb only records an outcome when it isn't the default,
        # e.g. a completed pass has no outcome
        outcome = (details or {}).get("outcome", {}).get("name")

        event_obj = Event(
            id = event_id,
            match_id = match_id,
            event_index = event_index,
            period = event_period,
            event_type = event_type,
            minute = minute,
            second = second,
            x = start_x,
            y = start_y,
            end_x = end_x,
            end_y = end_y,
            outcome = outcome,
            player_id = player_id,
            team_id = team_id,
            possession = possession,
            possession_team_id = possession_team_id,
            play_pattern = play_pattern,
            under_pressure = under_pressure,
            details = details
        )

        session.merge(event_obj)

    session.flush()  # once per match: events don't reference each other
        


def main():
    competitions = load_competitions()
    with SessionLocal() as session:
        import_competitions(session, competitions)
        import_matches(session, competitions)
        session.commit()

if __name__ == "__main__":
    main()