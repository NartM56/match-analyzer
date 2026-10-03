import uuid
from datetime import date, time
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Mirrors app/db/schema.sql. IDs come from StatsBomb, so integer primary keys
# use autoincrement=False to stop SQLAlchemy from generating them.


class League(Base):
    __tablename__ = "leagues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    country: Mapped[str] = mapped_column(Text, nullable=False)
    gender: Mapped[str] = mapped_column(Text, nullable=False)


class Season(Base):
    __tablename__ = "seasons"

    league_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("leagues.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    year: Mapped[str] = mapped_column(Text, nullable=False)


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    country: Mapped[Optional[str]] = mapped_column(Text)
    gender: Mapped[str] = mapped_column(Text, nullable=False)


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    nickname: Mapped[Optional[str]] = mapped_column(Text)  # show this when present
    country: Mapped[Optional[str]] = mapped_column(Text)


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        ForeignKeyConstraint(
            ["league_id", "season_id"], ["seasons.league_id", "seasons.id"]
        ),
        CheckConstraint("home_team_id <> away_team_id"),
        Index("idx_matches_season", "league_id", "season_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    league_id: Mapped[int] = mapped_column(Integer, nullable=False)
    season_id: Mapped[int] = mapped_column(Integer, nullable=False)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    match_date: Mapped[date] = mapped_column(Date, nullable=False)
    kick_off: Mapped[Optional[time]] = mapped_column(Time)
    home_team_score: Mapped[int] = mapped_column(Integer, nullable=False)
    away_team_score: Mapped[int] = mapped_column(Integer, nullable=False)
    competition_stage: Mapped[Optional[str]] = mapped_column(Text)
    match_week: Mapped[Optional[int]] = mapped_column(Integer)
    group_name: Mapped[Optional[str]] = mapped_column(Text)


class Lineup(Base):
    __tablename__ = "lineups"
    __table_args__ = (
        Index("idx_lineups_player", "player_id"),
        Index("idx_lineups_team", "team_id"),
    )

    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True
    )
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    starter: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    jersey_number: Mapped[int] = mapped_column(Integer, nullable=False)
    minutes_played: Mapped[Optional[int]] = mapped_column(Integer)
    position: Mapped[Optional[str]] = mapped_column(Text)


class PlayerMatchStats(Base):
    __tablename__ = "player_match_stats"

    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True
    )
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), primary_key=True)
    goals: Mapped[int] = mapped_column(Integer, nullable=False)
    assists: Mapped[int] = mapped_column(Integer, nullable=False)
    yellow_cards: Mapped[int] = mapped_column(Integer, nullable=False)
    red_cards: Mapped[int] = mapped_column(Integer, nullable=False)
    minutes_played: Mapped[int] = mapped_column(Integer, nullable=False)
    shots: Mapped[int] = mapped_column(Integer, nullable=False)
    passes: Mapped[int] = mapped_column(Integer, nullable=False)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("match_id", "event_index"),
        Index("idx_events_match_type", "match_id", "event_type"),
        Index("idx_events_player", "player_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), nullable=False
    )
    event_index: Mapped[int] = mapped_column(Integer, nullable=False)
    period: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    minute: Mapped[int] = mapped_column(Integer, nullable=False)
    second: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    player_id: Mapped[Optional[int]] = mapped_column(ForeignKey("players.id"))
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))  # team performing the event
    possession: Mapped[Optional[int]] = mapped_column(Integer)  # possession spell number
    possession_team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))  # team with the ball
    play_pattern: Mapped[Optional[str]] = mapped_column(Text)
    under_pressure: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    x: Mapped[Optional[float]] = mapped_column(Float(24))  # REAL
    y: Mapped[Optional[float]] = mapped_column(Float(24))
    end_x: Mapped[Optional[float]] = mapped_column(Float(24))
    end_y: Mapped[Optional[float]] = mapped_column(Float(24))
    outcome: Mapped[Optional[str]] = mapped_column(Text)  # NULL on a pass means completed
    # none_as_null: store Python None as SQL NULL, not the JSON value 'null'
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB(none_as_null=True))
