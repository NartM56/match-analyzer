"""Builds the anchors the PlayIQ performance score is measured against.

For every stat the score uses, it looks at every team's performance in every match in the
database (per 90 minutes where that applies) and saves the 10th and 90th percentiles:
p10 = a bottom-10% performance (0 points), p90 = a top-10% performance (full points).

Run it again whenever new matches are imported:
    python -m app.analysis.build_baselines
"""

import json
from datetime import date

from sqlalchemy import select

from app.analysis.compare import BASELINES_FILE, SCORED_STATS, get_team_match_summary, per_90
from app.db.database import SessionLocal
from app.models.models import Match


def percentile(values: list[float], p: float) -> float:
    """The value p (0-1) of the way through the sorted list, interpolating between the two
    nearest values (the same method as numpy's default, so p=0.5 is the median)."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * p
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def build_baselines() -> dict:
    with SessionLocal() as db:
        performances = []
        for match in db.scalars(select(Match)).all():
            for team_id in (match.home_team_id, match.away_team_id):
                summary = get_team_match_summary(db, match, team_id)
                performances.append(per_90(summary["stats"], summary["minutes"]))

    stats = {}
    for stat in SCORED_STATS:
        values = [p[stat] for p in performances]
        stats[stat] = {
            "p10": round(percentile(values, 0.10), 3),
            "median": round(percentile(values, 0.50), 3),
            "p90": round(percentile(values, 0.90), 3),
        }
    return {
        "built_on": date.today().isoformat(),
        "performances": len(performances),  # team-matches the anchors come from
        "stats": stats,
    }


if __name__ == "__main__":
    baselines = build_baselines()
    BASELINES_FILE.write_text(json.dumps(baselines, indent=2) + "\n")
    print(f"Saved anchors from {baselines['performances']} performances to {BASELINES_FILE}")
    for stat, anchors in baselines["stats"].items():
        print(f"  {stat:28} p10 {anchors['p10']:>7}   median {anchors['median']:>7}   p90 {anchors['p90']:>7}")
