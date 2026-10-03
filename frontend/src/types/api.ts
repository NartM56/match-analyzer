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
