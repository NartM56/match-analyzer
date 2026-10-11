from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.analysis.match_events import get_goals, get_penalties, get_periods, get_shootout, get_timeline, get_xg, get_lineups
from app.analysis.team_stats import get_match_team_stats

from app.db.database import get_db
from app.models.models import League, Match, MatchSummary, Season, Team
from app.analysis.ai_summary import PROMPT_VERSION, build_ai_summary
from app.core.config import settings


router = APIRouter()


def _get_match_or_404(db: Session, match_id: int) -> Match:
    match = db.get(Match, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    return match


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


@router.get("/{match_id}", response_model=MatchDetailOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")

    league = db.get(League, match.league_id)
    season = db.get(Season, (match.league_id, match.season_id))
    home = db.get(Team, match.home_team_id)
    away = db.get(Team, match.away_team_id)

    goals = [GoalOut(**g) for g in get_goals(db, match)]
    periods = get_periods(db, match_id)
    pens = get_penalties(db, match, periods)
    penalties = PenaltiesOut(**pens) if pens else None

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
    
class TeamStatsSide(BaseModel):
    possession: float       # % of time on the ball (PlayIQ estimate)
    xg: float
    shots: int
    shots_on_target: int
    passes: int
    pass_accuracy: float    # % of passes completed
    corners: int
    fouls: int
    yellow_cards: int
    red_cards: int


class TeamStatsOut(BaseModel):
    home_team_stats: TeamStatsSide
    away_team_stats: TeamStatsSide


@router.get("/{match_id}/team_stats", response_model=TeamStatsOut)
def get_team_stats(match_id: int, db: Session = Depends(get_db)):
    _get_match_or_404(db, match_id)
    home_team_stats, away_team_stats = get_match_team_stats(db, match_id)
    return {"home_team_stats": home_team_stats, "away_team_stats": away_team_stats}


class SummaryOut(BaseModel):
    summary: str
    model: str
    prompt_version: int
    created_at: datetime


# Minimum time between two generations for the same match, so "Regenerate"
# can't be clicked repeatedly (every call costs money).
REGENERATE_COOLDOWN = timedelta(seconds=60)


@router.get("/{match_id}/ai_summary", response_model=SummaryOut)
def get_ai_summary(match_id: int, db: Session = Depends(get_db)):
    """Read the saved summary. Never calls the AI: opening the tab shouldn't cost money."""
    _get_match_or_404(db, match_id)
    saved = db.get(MatchSummary, match_id)
    if not saved:
        # the frontend shows the "Explain this match" button on this 404
        raise HTTPException(status_code=404, detail="No summary yet")
    return saved


@router.post("/{match_id}/ai_summary", response_model=SummaryOut)
def post_ai_summary(match_id: int, db: Session = Depends(get_db)):
    """Generate a summary (first time or "Regenerate") and save it, replacing any old one."""
    _get_match_or_404(db, match_id)

    saved = db.get(MatchSummary, match_id)
    now = datetime.now(timezone.utc)
    if saved and now - saved.created_at < REGENERATE_COOLDOWN:
        raise HTTPException(status_code=429, detail="Please wait a moment before regenerating")

    try:
        summary, facts = build_ai_summary(match_id, db)
    except Exception as err:
        # AI service down, timed out, etc. Keep the old summary (if any) untouched.
        raise HTTPException(status_code=502, detail="Couldn't write the explanation") from err

    row = db.merge(MatchSummary(
        match_id=match_id,
        summary=summary,
        facts=facts,
        model=settings.OPENAI_MODEL,
        prompt_version=PROMPT_VERSION,
        created_at=now,  # set explicitly: the DB default only applies on insert, not on regenerate
    ))
    db.commit()
    db.refresh(row)
    return row

@router.get("/{match_id}/timeline")
def get_match_timeline(match_id: int, db: Session = Depends(get_db)):
    match = _get_match_or_404(db, match_id)
    timeline, periods = get_timeline(db, match)
    return {"timeline": timeline, "periods": periods}

class XgShotOut(BaseModel):
    event_index: int
    team_id: int            # an own goal counts for the other team
    player_name: str
    period: int
    minute: int
    second: int
    minute_label: str
    xg: float               # 0 for own goals (they aren't shots)
    outcome: Optional[str]  # "Goal", "Saved", "Off T", ... or "Own Goal"
    goal: bool
    penalty: bool
    own_goal: bool


class PeriodEndOut(BaseModel):
    period: int
    end_minute: int


class XgOut(BaseModel):
    shots: list[XgShotOut]
    periods: list[PeriodEndOut]


@router.get("/{match_id}/xg", response_model=XgOut)
def get_match_xg(match_id: int, db: Session = Depends(get_db)):
    match = _get_match_or_404(db, match_id)
    return get_xg(db, match)

class ShootoutKickOut(BaseModel):
    order: int          # 1, 2, 3, ... across both teams
    taken: int          # this team's 1st, 2nd, ... kick
    team_id: int
    player_name: str
    goal: bool
    result: str         # "Scored", "Saved", "Hit the post", "Missed"


class ShootoutOut(BaseModel):
    home_score: int
    away_score: int
    winner_team_id: int
    first_team_id: int  # the team that kicked first
    kicks: list[ShootoutKickOut]


@router.get("/{match_id}/shootout", response_model=ShootoutOut)
def get_match_shootout(match_id: int, db: Session = Depends(get_db)):
    match = _get_match_or_404(db, match_id)
    shootout = get_shootout(db, match)
    if shootout is None:
        raise HTTPException(status_code=404, detail="No penalty shootout in this match")
    return shootout

@router.get("/{match_id}/lineups")
def get_match_lineups(match_id: int, db: Session = Depends(get_db)):
    match = _get_match_or_404(db, match_id)
    return get_lineups(db, match)
    
