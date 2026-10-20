from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.analysis.compare import get_comparison
from app.db.database import get_db
from app.routes.matches import _get_match_or_404


router = APIRouter()


class ComparePenaltiesOut(BaseModel):
    for_: int = Field(alias="for")  # "for" is a Python keyword, so the field is for_ and the JSON key "for"
    against: int


class ScorePartOut(BaseModel):
    name: str        # "Chance creation", "Defending", "Result", "Control", "Territory"
    points: float
    max: int


class ScoreOut(BaseModel):
    total: int       # 0-100
    band: str        # "Outstanding", "Strong", "Good", "Average", "Poor"
    parts: list[ScorePartOut]


class OpponentStrengthOut(BaseModel):
    xg_difference: float                  # the opponent's xG difference over the whole season
    rank: int                             # 1 = best in the competition
    teams: int


class CompareSideOut(BaseModel):
    match_id: int
    team_id: int
    opponent_id: int
    opponent_name: str
    is_home: bool
    match_date: str
    competition_stage: Optional[str]
    group_name: Optional[str]             # "C" for group games
    minutes: int                          # match length incl. stoppage time, e.g. 124 after extra time
    extra_time: bool
    result: str                           # "W" / "D" / "L" over 90 or 120 minutes
    penalties: Optional[ComparePenaltiesOut]
    stats: dict[str, float]               # totals for the match
    stats_per_90: dict[str, float]        # the same stats scaled to 90 minutes
    score: ScoreOut
    opponent_strength: Optional[OpponentStrengthOut]


class VerdictOut(BaseModel):
    better: Optional[str]                 # "A", "B", or None when level
    points_gap: int


class KeyDifferenceOut(BaseModel):
    part: str
    better: str                           # "A" or "B"
    points_gap: float
    text: str
    values: dict[str, str]                # {"a": "2.00", "b": "2.18"}
    unit: str


class CompareOut(BaseModel):
    team_id: int
    team_name: str
    a: CompareSideOut
    b: CompareSideOut
    verdict: VerdictOut
    key_differences: list[KeyDifferenceOut]


@router.get("", response_model=CompareOut)
def compare_matches(team: int, a: int, b: int, db: Session = Depends(get_db)):
    """One team in two of its matches, side by side: /compare?team=779&a=3869685&b=3857300"""
    if a == b:
        raise HTTPException(status_code=400, detail="Pick two different matches")
    match_a = _get_match_or_404(db, a)
    match_b = _get_match_or_404(db, b)
    try:
        return get_comparison(db, match_a, match_b, team)
    except ValueError as err:  # the team didn't play in one of the matches
        raise HTTPException(status_code=400, detail=str(err))
