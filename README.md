# PlayIQ — football match analysis

PlayIQ lets you pick a football match and see **what happened and why**: the score and scorers, team stats, a timeline, shot maps, passing networks, where each team attacked, lineups with per-player stats, and an optional AI-written summary. A **Compare** page puts two of a team's matches side by side and rates each performance out of 100.

It uses real event-level data from [StatsBomb Open Data](https://github.com/hudl/open-data): every pass, shot, carry and pressure, with pitch coordinates. A Python importer loads it into PostgreSQL, FastAPI analyses and serves it, and a React app displays it.

## Features

### Match picker
- Browse competitions (search, men's/women's filter), pick a season, then filter matches by team or stage
- Matches grouped by stage and matchday, with scores and three-letter team badges

### Match page
Every match has a header (competition, stage, date, score, scorers, extra time, penalty shootout) and five tabs with shareable URLs, e.g. `/matches/3869685/shots`.

| Tab | What it shows |
| --- | --- |
| **Overview** | Team stats side by side, a match timeline (goals, cards, substitutions), an xG race chart, the penalty shootout kick by kick, and an AI summary on request |
| **Lineups** | Both starting XIs on a pitch in their formations, benches, goals, cards and substitutions. Click any player for a side panel with their minutes, goals and a shot map, pass map and touch heatmap |
| **Shots** | Every shot on a half-pitch per team, sized by xG and shaped by outcome, with team, player and outcome filters and a list of every shot |
| **Passing** | A passing network (average positions and strongest links) and a pass map with Completed / Incomplete / Progressive / Into box filters, by period |
| **Attack** | Each team's share of touches in nine zones of the pitch, final-third entries by channel (left, centre, right), and territory by third. One team or both compared |

### Compare
Pick a competition, a team and two of its matches to see which was the better performance:
- **PlayIQ performance score** out of 100 for each match, with a band (Outstanding to Poor) and a breakdown of how it was earned
- **Key differences:** the parts of the score with the biggest gaps, in plain English
- **Full stats** side by side, as totals or per 90 minutes
- The opponent's tournament xG difference on each card, for context

See [How the performance score works](#how-the-performance-score-works) below.

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React, TypeScript, React Router, Vite, plain CSS with theme variables |
| Backend | Python, FastAPI, SQLAlchemy 2, Pydantic |
| Database | PostgreSQL |
| Data | StatsBomb Open Data (JSON) |
| AI summary | OpenAI API (optional; the rest of the app works without it) |

## How it fits together

```
StatsBomb JSON  →  Python importer  →  PostgreSQL  →  FastAPI (analysis)  →  React
```

The frontend never reads the JSON files or the database directly; everything goes through the API. All counting and scoring happens in the backend (`backend/app/analysis/`), so every page uses the same definitions.

## Project structure

```
match-analyzer/
├── backend/
│   ├── main.py                       FastAPI app, registers the routers
│   ├── requirements.txt
│   └── app/
│       ├── core/config.py            settings read from backend/.env
│       ├── db/                       engine/session, schema.sql
│       ├── models/models.py          SQLAlchemy models (mirror schema.sql)
│       ├── importer/statsbomb.py     loads the JSON into PostgreSQL
│       ├── analysis/
│       │   ├── team_stats.py         team stats and the possession estimate
│       │   ├── match_events.py       goals, timeline, xG, lineups, passes, players, attack zones
│       │   ├── ai_summary.py         builds the facts and prompt for the AI summary
│       │   ├── compare.py            team-in-a-match summaries, per 90, performance score, key differences
│       │   ├── build_baselines.py    builds the score's anchors from every match
│       │   └── score_baselines.json  those anchors (generated)
│       ├── services/llm.py           OpenAI client
│       └── routes/                   API endpoints (competitions, matches, compare)
├── frontend/
│   ├── vite.config.js                proxies /api to the backend
│   └── src/
│       ├── pages/                    MatchSelection, Score (match page) and its tabs, Compare
│       ├── components/               Header, PlayerPanel, ShotMap, XgRace, MatchTimeline, Shootout
│       ├── styles/                   design-system base (organic.css) and colour themes
│       ├── types/api.ts              TypeScript types for API responses
│       └── utils/format.ts           date, team-code and name helpers
└── data-sample/                      StatsBomb files to import (not in git, see setup)
```

## Getting started

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 14+
- An OpenAI API key, only if you want the AI summary

### 1. Get the data

`data-sample/` isn't committed because the data is large. The full StatsBomb dataset is about 15 GB; this project develops against the **2022 FIFA World Cup** (64 matches, about 190 MB).

Clone the StatsBomb repository next to this project, then copy just the World Cup files into `data-sample/`:

```bash
git clone --depth 1 https://github.com/hudl/open-data.git

python3 - <<'EOF'
import json, shutil, pathlib
src, dst = pathlib.Path("open-data/data"), pathlib.Path("match-analyzer/data-sample")
comps = [c for c in json.load(open(src / "competitions.json"))
         if c["competition_id"] == 43 and c["season_id"] == 106]
(dst / "matches/43").mkdir(parents=True, exist_ok=True)
(dst / "events").mkdir(exist_ok=True); (dst / "lineups").mkdir(exist_ok=True)
json.dump(comps, open(dst / "competitions.json", "w"), indent=2)
shutil.copy(src / "matches/43/106.json", dst / "matches/43/106.json")
for m in json.load(open(src / "matches/43/106.json")):
    for kind in ("events", "lineups"):
        shutil.copy(src / kind / f"{m['match_id']}.json", dst / kind / f"{m['match_id']}.json")
EOF
```

You can delete `open-data/` afterwards. The importer reads whatever competitions are listed in `data-sample/competitions.json`, so the same steps work for other competitions.

### 2. Create the database

Create an empty PostgreSQL database (in DBeaver or with `psql`) and run the schema:

```bash
psql -U postgres -c "CREATE DATABASE playiq;"
psql -U postgres -d playiq -f backend/app/db/schema.sql
```

### 3. Configure the backend

Create `backend/.env` (it's gitignored, so your keys never reach GitHub):

```env
DATABASE_URL=postgresql+psycopg://postgres:YOUR_PASSWORD@localhost:5432/playiq
JWT_SECRET=any-long-random-string
OPENAI_API_KEY=sk-...           # required by the settings; any placeholder works if you skip the AI summary
OPENAI_MODEL=gpt-4.1-mini       # optional, this is the default
```

Generate a secret with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Special characters in the database password must be URL-encoded (`@` → `%40`, `#` → `%23`).

### 4. Install, import and build the score anchors

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python3 -m app.importer.statsbomb          # about a minute for the World Cup
python3 -m app.analysis.build_baselines    # anchors for the performance score
```

Both are safe to re-run. The importer updates existing rows instead of duplicating them. **Re-run `build_baselines` whenever you import new matches**, so the performance score is measured against all of them.

### 5. Run it

In two terminals:

```bash
# backend: http://localhost:8000 (interactive API docs at /docs)
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

```bash
# frontend: http://localhost:5173
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to the backend, so no CORS setup is needed in development.

## API

Interactive docs with every response shape: http://localhost:8000/docs

| Method | Endpoint | Returns |
| --- | --- | --- |
| GET | `/competitions` | All competitions |
| GET | `/competitions/{competition_id}` | One competition |
| GET | `/competitions/{competition_id}/seasons` | Its seasons, newest first |
| GET | `/competitions/{competition_id}/seasons/{season_id}/matches` | Matches with teams, scores, stage, group and shootout score |
| GET | `/matches/{match_id}` | Match header: teams, score, goals, extra time, shootout |
| GET | `/matches/{match_id}/team_stats` | Possession, xG, shots, passes, corners, fouls and cards per team |
| GET | `/matches/{match_id}/timeline` | Goals, cards and substitutions, plus when each period ended |
| GET | `/matches/{match_id}/xg` | Every shot with xG, location, outcome and player (for the xG race and shot maps) |
| GET | `/matches/{match_id}/shootout` | Penalty shootout kick by kick (404 if there wasn't one) |
| GET | `/matches/{match_id}/lineups` | Both squads with positions, minutes, goals, cards, substitutions and formations |
| GET | `/matches/{match_id}/players/{player_id}` | One player's match: facts, stats, shot/pass/touch maps and team ranks |
| GET | `/matches/{match_id}/passes` | Every pass with location, recipient and progressive / final-third / into-box flags |
| GET | `/matches/{match_id}/possession` | Touches in nine zones, final-third entries and shots by channel, per period |
| GET | `/matches/{match_id}/ai_summary` | The saved AI summary (404 if none yet) |
| POST | `/matches/{match_id}/ai_summary` | Generates a new AI summary (limited to one per minute per match) |
| GET | `/compare?team=&a=&b=` | One team in two matches: stats, per-90 stats, performance scores, verdict, key differences |

## How the performance score works

The PlayIQ performance score is a **custom 0–100 rating of one team's performance in one match**. It's not an official rating.

| Part | Points | Measured by (per 90 minutes) |
| --- | --- | --- |
| Chance creation | 30 | xG, shots on target, big chances (shots with xG ≥ 0.3) |
| Defending | 25 | xG, shots on target and big chances conceded (lower is better) |
| Control | 20 | possession, pass accuracy, progressive passes |
| Result | 15 | win 15, draw 7.5, loss 0, plus 3 for winning a shootout |
| Territory | 10 | share of touches in the attacking third, final-third entries |

Each stat is compared with **every team's performance in every imported match**: a bottom-10% figure earns 0, a top-10% figure earns full marks, with a straight line in between. These anchors live in `score_baselines.json`. Stats are per 90 minutes so a 120-minute match isn't favoured. The weights and stats are defined in one list (`SCORE_PARTS` in `backend/app/analysis/compare.py`), so they're easy to change.

Opponent strength isn't part of the score yet; the Compare page shows each opponent's tournament xG difference instead.

## Data notes

- IDs come straight from StatsBomb, so re-importing never creates duplicates. A season ID is only unique together with its competition, so season routes take both.
- StatsBomb minutes start at 0 and keep counting through stoppage time; the app shows match minutes (`22` → `23'`, stoppage time as `45+3'`).
- Penalty shootouts are period 5. Shootout kicks are left out of every stat, chart and score, and shown separately.
- Own goals come from `Own Goal Against` events and count for the other team.
- **Possession is a PlayIQ estimate**: each team's share of time on the ball, worked out from event timestamps (StatsBomb doesn't provide it).
- **PlayIQ definitions:**
  - a *progressive pass* is a completed pass, starting outside the team's own defensive third, that ends at least 25% closer to the opponent's goal;
  - a *final-third entry* is a completed pass from outside the final third into it;
  - a *touch* is any event where a player played the ball.
- Every team attacks towards x = 120 in StatsBomb's 120 × 80 coordinates, so maps are drawn from each team's own point of view.
- Most players only have a full legal name; a common name (`nickname`) exists for about 40%, and the app shows it when present.

## Theming

Colours and fonts are CSS variables. `src/styles/organic.css` is the base design system, and a theme file loaded after it in `src/main.jsx` overrides them. The current theme is **Charcoal + Matchday Orange** with Barlow fonts (`theme-charcoal.css`). `theme-midnight.css` and `theme.css` are alternatives; switch by changing the import.

## Known limitations

- Developed and tested against the 2022 World Cup only. More competitions should import the same way, but haven't been checked.
- StatsBomb has no team codes; the three-letter badges come from a lookup in `frontend/src/utils/format.ts` (FIFA codes for national teams, a fallback for others).
- The performance score's anchors are built from all imported matches together. With several competitions you may want separate anchors per competition.

## Credits

Match data: [StatsBomb Open Data](https://github.com/hudl/open-data) by Hudl StatsBomb. If you publish work using this data, follow the attribution terms in their repository.
