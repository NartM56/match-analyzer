-- IDs come straight from StatsBomb, so re-running the importer
-- won't create duplicates.

CREATE TABLE leagues (
    id INT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    gender TEXT NOT NULL
);

-- StatsBomb reuses season ids across leagues, so the key is the pair.
CREATE TABLE seasons (
    league_id INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    id INT NOT NULL,
    year TEXT NOT NULL,
    PRIMARY KEY (league_id, id)
);

CREATE TABLE teams (
    id INT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    gender TEXT NOT NULL
);

CREATE TABLE players (
    id INT PRIMARY KEY,
    name TEXT NOT NULL,                      -- full legal name, e.g. "Lionel Andrés Messi Cuccittini"
    nickname TEXT,                           -- common name, e.g. "Lionel Messi" (missing for ~60% of players)
    country TEXT
);

CREATE TABLE matches (
    id INT PRIMARY KEY,
    league_id INT NOT NULL,
    season_id INT NOT NULL,
    home_team_id INT NOT NULL REFERENCES teams(id),
    away_team_id INT NOT NULL REFERENCES teams(id),
    match_date DATE NOT NULL,
    kick_off TIME,
    home_team_score INT NOT NULL,
    away_team_score INT NOT NULL,
    competition_stage TEXT,
    match_week INT,
    group_name TEXT,
    FOREIGN KEY (league_id, season_id) REFERENCES seasons(league_id, id),
    CHECK (home_team_id <> away_team_id)
);

CREATE TABLE lineups (
    match_id INT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id INT NOT NULL REFERENCES players(id),
    team_id INT NOT NULL REFERENCES teams(id),
    starter BOOLEAN NOT NULL DEFAULT FALSE,
    jersey_number INT NOT NULL,
    minutes_played INT,
    position TEXT,
    PRIMARY KEY (match_id, player_id)
);

CREATE TABLE player_match_stats (
    match_id INT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id INT NOT NULL REFERENCES players(id),
    goals INT NOT NULL,
    assists INT NOT NULL,
    yellow_cards INT NOT NULL,
    red_cards INT NOT NULL,
    minutes_played INT NOT NULL,
    shots INT NOT NULL,
    passes INT NOT NULL,
    PRIMARY KEY (match_id, player_id)
);

CREATE TABLE events (
    id UUID PRIMARY KEY,                     -- StatsBomb event ids are UUIDs
    match_id INT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_index INT NOT NULL,                -- order within the match
    period SMALLINT NOT NULL,                -- 1, 2, 3/4 extra time, 5 penalties
    minute INT NOT NULL,
    second INT NOT NULL,
    event_type TEXT NOT NULL,
    player_id INT REFERENCES players(id),
    team_id INT REFERENCES teams(id),        -- team performing the event
    possession INT,                          -- possession spell number within the match
    possession_team_id INT REFERENCES teams(id),  -- team with the ball (differs on defensive events)
    play_pattern TEXT,                       -- Regular Play, From Corner, From Counter, ...
    under_pressure BOOLEAN NOT NULL DEFAULT FALSE,
    x REAL,
    y REAL,
    end_x REAL,
    end_y REAL,
    outcome TEXT,                            -- NULL on a pass means completed
    details JSONB,                           -- type-specific data (xG, recipient, ...)
    UNIQUE (match_id, event_index)
);

CREATE INDEX idx_matches_season ON matches (league_id, season_id);
CREATE INDEX idx_lineups_player ON lineups (player_id);
CREATE INDEX idx_lineups_team ON lineups (team_id);
CREATE INDEX idx_events_match_type ON events (match_id, event_type);
CREATE INDEX idx_events_player ON events (player_id);
