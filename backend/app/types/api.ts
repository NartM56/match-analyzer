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
  league_id: number;
  season_id: number;
  home_team_id: number;
  away_team_id: number;
  match_date: string; // ISO date string
  kick_off: string | null; // ISO time string or null
  home_team_score: number;
  away_team_score: number;
  competition_stage: string | null;
  match_week: number | null;
  group_name: string | null;
}
