// Mirrors the Pydantic response models in backend/app/routes/competitions.py

export interface Competition {
  id: number;
  name: string;
  country: string;
  gender: string;
}

export interface Season {
  id: number;
  league_id: number;
  year: string;
}

export interface Match {
  id: number;
  match_date: string; // ISO date string
  kick_off: string | null; // ISO time string or null
  home_team_id: number;
  home_team_name: string;
  away_team_id: number;
  away_team_name: string;
  home_team_score: number;
  away_team_score: number;
  competition_stage: string | null;
  match_week: number | null;
  group_name: string | null;
}

// GET /matches/{id} — the match header shown above every match tab
export interface MatchDetail {
  id: number;
  competition_id: number;
  competition_name: string;
  season_id: number;
  season_name: string;
  competition_stage: string | null;
  match_date: string; // "2022-12-18"
  kick_off: string | null; // "17:00:00"
  home_team: { id: number; name: string };
  away_team: { id: number; name: string };
  home_score: number;
  away_score: number;
  extra_time: boolean;
  penalties: { home: number; away: number } | null; // only when there was a shootout
  goals: {
    team_id: number; // team the goal counts for
    player_name: string; // for an own goal, the player who scored it
    minute_label: string; // "23'", "45+3'"
    period: number;
    penalty: boolean;
    own_goal: boolean;
  }[];
}

// GET /matches/{id}/team_stats — one side of the comparison
export interface TeamStatsSide {
  possession: number; // % of time on the ball (PlayIQ estimate)
  xg: number;
  shots: number;
  shots_on_target: number;
  passes: number;
  pass_accuracy: number; // % of passes completed
  corners: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
}

export interface TeamStats {
  home_team_stats: TeamStatsSide;
  away_team_stats: TeamStatsSide;
}

// GET / POST /matches/{id}/ai_summary
export interface MatchSummary {
  summary: string;
  model: string;
  prompt_version: number;
  created_at: string; // ISO timestamp
}

// GET /matches/{id}/timeline
export interface TimelinePeriod {
  period: number; // 1, 2, 3/4 extra time
  end_minute: number; // when its final whistle went (stoppage time included)
}

interface TimelineEventBase {
  team_id: number; // the side the marker belongs to (an own goal counts for the other team)
  period: number;
  minute: number; // StatsBomb clock: keeps counting through stoppage time
  second: number;
  minute_label: string; // "23'", "45+7'"
  event_index: number;
}

// One item per marker. The "type" field tells TypeScript which other fields exist.
export type TimelineEvent =
  | (TimelineEventBase & { type: "goal"; player_name: string; penalty: boolean; own_goal: boolean })
  | (TimelineEventBase & {
      type: "card";
      player_name: string;
      card: "Yellow Card" | "Second Yellow" | "Red Card";
    })
  | (TimelineEventBase & {
      type: "substitution";
      player_on: string;
      player_off: string;
      reason: string | null; // "Tactical" / "Injury"
    });

export interface MatchTimeline {
  timeline: TimelineEvent[];
  periods: TimelinePeriod[];
}

// GET /matches/{id}/xg — shots for the xG race (periods 1-4) plus own goals
export interface XgShot {
  event_index: number;
  team_id: number; // an own goal counts for the other team
  player_name: string;
  period: number;
  minute: number;
  second: number;
  minute_label: string;
  xg: number; // 0 for own goals (they aren't shots)
  outcome: string | null; // "Goal", "Saved", "Off T", ... or "Own Goal"
  goal: boolean;
  penalty: boolean;
  own_goal: boolean;
}

export interface MatchXg {
  shots: XgShot[];
  periods: TimelinePeriod[];
}

// GET /matches/{id}/shootout — only for matches decided on penalties (404 otherwise)
export interface ShootoutKick {
  order: number; // 1, 2, 3, ... across both teams
  taken: number; // this team's 1st, 2nd, ... kick
  team_id: number;
  player_name: string;
  goal: boolean;
  result: string; // "Scored", "Saved", "Hit the post", "Missed"
}

export interface MatchShootout {
  home_score: number;
  away_score: number;
  winner_team_id: number;
  first_team_id: number; // the team that kicked first
  kicks: ShootoutKick[];
}

// GET /matches/{id}/lineups — keyed by team id (JSON object keys are strings)
export interface LineupPlayer {
  player_id: number;
  player_name: string;
  team_id: number;
  jersey_number: number;
  position: string | null; // starting position; null for unused substitutes
  starter: boolean;
  minutes_played: number | null; // null for unused substitutes
}

export type MatchLineups = Record<string, LineupPlayer[]>;
