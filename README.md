# PlayIQ — football match analysis

PlayIQ lets you pick a football match and see **what happened and why**: the score and scorers, team stats, shot maps, passing, lineups and player performance, with an optional AI-written explanation.

It uses real event-level data from [StatsBomb Open Data](https://github.com/hudl/open-data), every pass, shot, carry and pressure with pitch coordinates. A Python importer loads it into PostgreSQL, FastAPI serves it, and a React app displays it.

> **Status:** work in progress. The match picker and the match page header are built; the analysis tabs (Overview, Shots, Passing, Attack, Lineups, Players) are being built next.

## Features

**Built**
- **Match picker:** browse competitions (search, men's/women's filter), pick a season, then filter matches by team or stage, with matches grouped by stage and matchday
- **Match page header:** competition, stage and date, score, goal scorers (penalties and own goals marked), extra time and penalty-shootout result
- **Tab navigation** with shareable URLs, e.g. `/matches/3869685/lineups`
- Responsive layout for desktop and phones

**Planned**
- Overview: team stats comparison, timeline, xG race, AI match summary
- Shots, Passing (pass map and passing network), Attack (zones)
- Lineups on a pitch, and a player panel with per-match stats

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React, TypeScript, React Router, Vite, plain CSS ("Organic" design system) |
| Backend | Python, FastAPI, SQLAlchemy 2, Pydantic |
| Database | PostgreSQL |
| Data | StatsBomb Open Data (JSON) |

## How it fits together

```
StatsBomb JSON  →  Python importer  →  PostgreSQL  →  FastAPI  →  React
```

The frontend never reads the JSON files or the database directly; everything goes through the API.

## Project structure

```
match-analyzer/
├── backend/
│   ├── main.py                  FastAPI app, registers the routers
│   ├── requirements.txt
│   └── app/
│       ├── core/config.py       settings read from backend/.env
│       ├── db/                  engine/session, schema.sql
│       ├── models/models.py     SQLAlchemy models (mirror schema.sql)
│       ├── importer/statsbomb.py  loads the JSON into PostgreSQL
│       └── routes/              API endpoints (competitions, matches)
├── frontend/
│   ├── vite.config.js           proxies /api to the backend
│   └── src/
│       ├── pages/               MatchSelection, Score (match page) and its tabs
│       ├── components/          Header
│       ├── styles/organic.css   design-system tokens and classes
│       ├── types/api.ts         TypeScript types for API responses
│       └── utils/format.ts      date and team-code helpers
└── data-sample/                 StatsBomb files to import (not in git, see setup)
```

## Getting started

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 14+

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

Create an empty PostgreSQL database (in DBeaver or with `psql`):

```bash
psql -U postgres -c "CREATE DATABASE playiq;"
psql -U postgres -d playiq -f backend/app/db/schema.sql
```

### 3. Configure the backend

Create `backend/.env` (it's gitignored):

```env
DATABASE_URL=postgresql+psycopg://postgres:YOUR_PASSWORD@localhost:5432/playiq
JWT_SECRET=any-long-random-string
```

Generate a secret with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Special characters in the password must be URL-encoded (`@` → `%40`, `#` → `%23`).

### 4. Install and import

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python3 -m app.importer.statsbomb    # about a minute for the World Cup
```

The importer is safe to re-run: it updates existing rows instead of duplicating them.

### 5. Run it

In two terminals:

```bash
# backend — http://localhost:8000 (API docs at /docs)
cd backend
uvicorn main:app --reload
```

```bash
# frontend — http://localhost:5173
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to the backend, so no CORS setup is needed in development.

## API

| Method | Endpoint | Returns |
| --- | --- | --- |
| GET | `/competitions` | All competitions |
| GET | `/competitions/{competition_id}` | One competition |
| GET | `/competitions/{competition_id}/seasons` | Its seasons, newest first |
| GET | `/competitions/{competition_id}/seasons/{season_id}/matches` | Matches with teams, scores, stage, matchday and group |
| GET | `/matches/{match_id}` | Match header: teams, score, goals, extra time, shootout |

Interactive docs: http://localhost:8000/docs

## Data notes

- IDs come straight from StatsBomb, so re-importing never creates duplicates.
- A season ID is only unique together with its competition, so season routes take both.
- StatsBomb minutes start at 0; the API shows them as match minutes (`22` → `23'`, stoppage time as `45+3'`).
- Own goals come from `Own Goal Against` events, and shootout kicks are shots in period 5, so they're excluded from the scorers and counted separately.
- Most players only have a full legal name; a common name (`nickname`) exists for about 40%, and the app shows it when present.
- StatsBomb has no team codes; the three-letter badges currently come from a lookup in `frontend/src/utils/format.ts`.

## Credits

Match data: [StatsBomb Open Data](https://github.com/hudl/open-data) by Hudl StatsBomb. If you publish work using this data, follow the attribution terms in their repository.
