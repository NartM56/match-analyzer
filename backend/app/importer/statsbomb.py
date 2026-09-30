import json
from pathlib import Path

from app.models.models import League, Season
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
    
def main():
    with SessionLocal() as session:
        import_competitions(session, load_competitions())
        session.commit()

if __name__ == "__main__":
    main()