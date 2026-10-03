from datetime import date, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import Event, League, Match, Player, Season, Team

router = APIRouter()


class TeamOut(BaseModel):
    id: int
    name: str


class GoalOut(BaseModel):
    team_id: int          # team the goal counts for
    player_name: str      # for an own goal, the player who put it in his own net
    minute_label: str     # "23'", "45+3'", "118'"
    period: int
    penalty: bool
    own_goal: bool


class PenaltiesOut(BaseModel):
    home: int
    away: int


class MatchDetailOut(BaseModel):
    id: int
    competition_id: int
    competition_name: str
    season_id: int
    season_name: str
    competition_stage: Optional[str]
    match_date: date
    kick_off: Optional[time]
    home_team: TeamOut
    away_team: TeamOut
    home_score: int
    away_score: int
    extra_time: bool
    penalties: Optional[PenaltiesOut]  # only when there was a shootout
    goals: list[GoalOut]               # in match order, shootout kicks excluded


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


@router.get("/{match_id}", response_model=MatchDetailOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")

    league = db.get(League, match.league_id)
    season = db.get(Season, (match.league_id, match.season_id))
    home = db.get(Team, match.home_team_id)
    away = db.get(Team, match.away_team_id)

    # Goals: scored shots in periods 1-4, plus own goals ("Own Goal Against" carries the
    # player who scored it; the goal counts for the other team).
    rows = db.execute(
        select(Event, Player)
        .outerjoin(Player, Player.id == Event.player_id)
        .where(
            Event.match_id == match_id,
            Event.period <= 4,
            (
                (Event.event_type == "Shot") & (Event.outcome == "Goal")
            ) | (Event.event_type == "Own Goal Against"),
        )
        .order_by(Event.event_index)
    ).all()

    goals = []
    for event, player in rows:
        own_goal = event.event_type == "Own Goal Against"
        scoring_team = (
            (away.id if event.team_id == home.id else home.id) if own_goal else event.team_id
        )
        goals.append(GoalOut(
            team_id=scoring_team,
            player_name=display_name(player) if player else "Unknown",
            minute_label=minute_label(event.minute, event.period),
            period=event.period,
            penalty=(event.details or {}).get("type", {}).get("name") == "Penalty",
            own_goal=own_goal,
        ))

    # Extra time / shootout come from which periods have events.
    periods = set(db.scalars(select(Event.period).where(Event.match_id == match_id).distinct()))
    penalties = None
    if 5 in periods:
        shootout_goals = db.scalars(
            select(Event.team_id).where(
                Event.match_id == match_id,
                Event.period == 5,
                Event.event_type == "Shot",
                Event.outcome == "Goal",
            )
        ).all()
        penalties = PenaltiesOut(
            home=sum(1 for t in shootout_goals if t == home.id),
            away=sum(1 for t in shootout_goals if t == away.id),
        )

    return MatchDetailOut(
        id=match.id,
        competition_id=match.league_id,
        competition_name=league.name,
        season_id=match.season_id,
        season_name=season.year,
        competition_stage=match.competition_stage,
        match_date=match.match_date,
        kick_off=match.kick_off,
        home_team=TeamOut(id=home.id, name=home.name),
        away_team=TeamOut(id=away.id, name=away.name),
        home_score=match.home_team_score,
        away_score=match.away_team_score,
        extra_time=bool(periods & {3, 4}),
        penalties=penalties,
        goals=goals,
    )
