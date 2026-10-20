from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.db.database import get_db
from app.models.models import Event, League, Match, Season, Team

router = APIRouter()


class CompetitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # lets Pydantic read SQLAlchemy objects

    id: int
    name: str
    country: str
    gender: str


class SeasonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    league_id: int
    year: str


class ShootoutOut(BaseModel):
    home: int
    away: int


class MatchSummaryOut(BaseModel):
    id: int
    match_date: date
    kick_off: Optional[time]
    home_team_id: int
    home_team_name: str
    away_team_id: int
    away_team_name: str
    home_team_score: int
    away_team_score: int
    competition_stage: Optional[str]
    match_week: Optional[int]
    group_name: Optional[str]
    penalties: Optional[ShootoutOut] = None  # shootout score, only for matches decided on penalties


@router.get("", response_model=list[CompetitionOut])
def get_competitions(db: Session = Depends(get_db)):
    return db.scalars(select(League).order_by(League.name)).all()


@router.get("/{competition_id}", response_model=CompetitionOut)
def get_competition(competition_id: int, db: Session = Depends(get_db)):
    competition = db.get(League, competition_id)
    if competition is None:
        raise HTTPException(status_code=404, detail="Competition not found")
    return competition


@router.get("/{competition_id}/seasons", response_model=list[SeasonOut])
def get_competition_seasons(competition_id: int, db: Session = Depends(get_db)):
    if db.get(League, competition_id) is None:
        raise HTTPException(status_code=404, detail="Competition not found")
    return db.scalars(
        select(Season)
        .where(Season.league_id == competition_id)
        .order_by(Season.year.desc())
    ).all()


@router.get(
    "/{competition_id}/seasons/{season_id}/matches",
    response_model=list[MatchSummaryOut],
)
def get_season_matches(competition_id: int, season_id: int, db: Session = Depends(get_db)):
    # season ids are only unique together with the competition id
    if db.get(Season, (competition_id, season_id)) is None:
        raise HTTPException(status_code=404, detail="Season not found")

    home = aliased(Team)
    away = aliased(Team)
    rows = db.execute(
        select(
            Match,
            home.name.label("home_team_name"),
            away.name.label("away_team_name"),
        )
        .join(home, home.id == Match.home_team_id)
        .join(away, away.id == Match.away_team_id)
        .where(Match.league_id == competition_id, Match.season_id == season_id)
        .order_by(Match.match_date, Match.kick_off)
    ).all()

    # shootout goals per match and team, in one query for the whole season (period 5 = shootout)
    shootout_rows = db.execute(
        select(Event.match_id, Event.team_id, func.count())
        .join(Match, Match.id == Event.match_id)
        .where(Match.league_id == competition_id, Match.season_id == season_id,
               Event.period == 5, Event.event_type == "Shot", Event.outcome == "Goal")
        .group_by(Event.match_id, Event.team_id)
    ).all()
    shootout_goals: dict[int, dict[int, int]] = {}
    for match_id, team_id, goals in shootout_rows:
        shootout_goals.setdefault(match_id, {})[team_id] = goals

    def penalties(match: Match) -> Optional[ShootoutOut]:
        goals = shootout_goals.get(match.id)
        if goals is None:
            return None
        return ShootoutOut(home=goals.get(match.home_team_id, 0), away=goals.get(match.away_team_id, 0))

    return [
        MatchSummaryOut(
            id=match.id,
            match_date=match.match_date,
            kick_off=match.kick_off,
            home_team_id=match.home_team_id,
            home_team_name=home_team_name,
            away_team_id=match.away_team_id,
            away_team_name=away_team_name,
            home_team_score=match.home_team_score,
            away_team_score=match.away_team_score,
            competition_stage=match.competition_stage,
            match_week=match.match_week,
            group_name=match.group_name,
            penalties=penalties(match),
        )
        for match, home_team_name, away_team_name in rows
    ]
