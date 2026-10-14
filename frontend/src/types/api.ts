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
  | (TimelineEventBase & {
      type: "goal";
      player_name: string;
      penalty: boolean;
      own_goal: boolean;
    })
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
  player_id: number | null;
  period: number;
  minute: number;
  second: number;
  minute_label: string;
  xg: number; // 0 for own goals (they aren't shots)
  outcome: string | null; // "Goal", "Saved", "Off T", ... or "Own Goal"
  goal: boolean;
  penalty: boolean;
  own_goal: boolean;
  // where the shot was taken (StatsBomb 120 × 80, the shooting team attacks towards x = 120)
  x: number | null;
  y: number | null;
  end_x: number | null;
  end_y: number | null;
  body_part: string | null; // "Left Foot", "Head", ...
  shot_type: string | null; // "Open Play", "Penalty", "Free Kick", ...
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
  goals: LineupGoal[]; // goals this player scored (own goals included, flagged)
  yellow_red_cards: LineupCard[]; // every card, penalty shootout included
  subbed_off: (LineupSub & { replaced_by: string }) | null; // starters who came off
  subbed_on: (LineupSub & { replaced: string }) | null; // substitutes who came on
}

export interface LineupGoal {
  minute_label: string;
  period: number;
  penalty: boolean;
  own_goal: boolean; // counts for the other team
}

export interface LineupCard {
  minute_label: string;
  period: number; // 5 = shown during the penalty shootout
  card: "Yellow Card" | "Second Yellow" | "Red Card";
}

export interface LineupSub {
  minute_label: string;
  reason: string | null; // "Tactical" / "Injury"
}

// GET /matches/{id}/lineups — both keyed by team id (JSON object keys are strings)
export interface MatchLineups {
  players: Record<string, LineupPlayer[]>;
  formations: Record<string, string | null>; // "4-3-3"
}

// GET /matches/{id}/players/{player_id} — the player panel
export interface PlayerRank {
  rank: number; // 1 = best in the team
  of: number; // teammates who played
  joint: boolean; // someone else has exactly the same value
}

export interface PlayerShotPoint {
  x: number;
  y: number;
  end_x: number | null;
  end_y: number | null;
  minute_label: string;
  xg: number;
  outcome: string | null; // "Goal", "Saved", "Off T", "Blocked", ...
  body_part: string | null;
  shot_type: string | null; // "Open Play", "Penalty", ...
}

export interface PlayerPassPoint {
  x: number;
  y: number;
  end_x: number | null;
  end_y: number | null;
  completed: boolean;
}

export interface PlayerMatch {
  player: {
    player_id: number;
    player_name: string;
    full_name: string;
    team_id: number;
    jersey_number: number;
    position: string | null;
    starter: boolean;
    minutes_played: number; // 0 = didn't play
    goals: { minute_label: string; penalty: boolean }[];
    cards: { minute_label: string; card: string; period: number }[];
    subbed_off: (LineupSub & { replaced_by: string }) | null;
    subbed_on: (LineupSub & { replaced: string }) | null;
  };
  summary: {
    goals: number;
    xg: number;
    shots: number;
    shots_on_target: number;
    passes: number;
    pass_accuracy: number;
    passes_into_final_third: number;
    touches: number;
    touches_in_attacking_third_pct: number;
    [stat: string]: number; // plus the other counts (tackles, assists, ...)
  };
  maps: {
    shots: PlayerShotPoint[];
    passes: PlayerPassPoint[];
    touches: { x: number; y: number }[];
  };
  ranks: {
    xg: PlayerRank | null;
    passes: PlayerRank | null;
    touches: PlayerRank | null;
  };
}

export interface MatchPass {
  event_index: number;
  team_id: number;
  player_id: number | null;
  player_name: string;
  period: number;
  x: number | null;
  y: number | null;
  end_x: number | null;
  end_y: number | null;
  completed: boolean;
  recipient_id: number | null;
  is_progressive: boolean;
  into_final_third: boolean;
  into_box: boolean;
}
