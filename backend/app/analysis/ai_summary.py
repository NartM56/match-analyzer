from sqlalchemy.orm import Session

from app.analysis.match_events import get_goals, get_penalties, get_periods
from app.analysis.team_stats import get_match_team_stats
from app.models.models import League, Match, Season, Team
from app.services.llm import generate_text

# Raise by 1 whenever you change the prompt or what goes into the fact sheet
# (not when a user regenerates). Saved with each summary.
PROMPT_VERSION = 1

# The rules for the model. Kept separate from the facts so the facts stay a clean
# record of the data (that's what gets saved in match_summaries.facts).
INSTRUCTIONS = """You are a football analyst writing for fans who are not data scientists.
Summarize the match: the most important events, and an analysis of why it turned out
the way it did, using ONLY the facts you are given.

Rules:
- Write 3 short paragraphs, about 150-200 words in total.
- Plain prose: no headings, no lists, no markdown.
- When you mention a moment, write its minute like 23'.
- Do not invent facts, players, or numbers. If the facts don't explain something, don't guess.
- xG (expected goals) measures the quality of chances; mention it in plain words if you use it."""


def _goal_line(goal: dict, team_names: dict[int, str]) -> str:
    """e.g. "23' Lionel Messi (Argentina, penalty)" or "70' Manuel Neuer (own goal, counts for Costa Rica)" """
    team = team_names[goal["team_id"]]
    if goal["own_goal"]:
        return f"{goal['minute_label']} {goal['player_name']} (own goal, counts for {team})"
    note = ", penalty" if goal["penalty"] else ""
    return f"{goal['minute_label']} {goal['player_name']} ({team}{note})"


def _stat_line(label: str, home: str, away: str) -> str:
    """One aligned row of the stats table, e.g. "  Possession           56% | 44%"."""
    return f"  {label:<20} {home} | {away}"


def build_facts(match_id: int, db: Session) -> str:
    """The fact sheet sent to the model: match result, goals and team stats, as plain text."""
    match = db.get(Match, match_id)
    home = db.get(Team, match.home_team_id)
    away = db.get(Team, match.away_team_id)
    league = db.get(League, match.league_id)
    season = db.get(Season, (match.league_id, match.season_id))
    team_names = {home.id: home.name, away.id: away.name}

    periods = get_periods(db, match_id)
    penalties = get_penalties(db, match, periods)
    goals = get_goals(db, match)
    h, a = get_match_team_stats(db, match_id)

    # — match and result —
    stage = f" {match.competition_stage}" if match.competition_stage else ""
    result = f"{home.name} {match.home_team_score}-{match.away_team_score} {away.name}"
    if periods & {3, 4}:
        result += " (after extra time)"
    lines = [
        f"MATCH: {league.name} {season.year}{stage}, {match.match_date:%d %b %Y}",
        f"HOME TEAM: {home.name}",
        f"AWAY TEAM: {away.name}",
        f"RESULT: {result}",
    ]
    if penalties:
        winner, won, lost = (
            (home.name, penalties["home"], penalties["away"])
            if penalties["home"] > penalties["away"]
            else (away.name, penalties["away"], penalties["home"])
        )
        lines.append(f"PENALTY SHOOTOUT: {winner} won {won}-{lost}")

    # — goals —
    lines += ["", "GOALS (in match order):"]
    lines += [f"  {_goal_line(g, team_names)}" for g in goals] or ["  None"]

    # — team stats —
    lines += [
        "",
        f"TEAM STATS ({home.name} | {away.name}):",
        _stat_line("Possession", f"{h['possession']:.0f}%", f"{a['possession']:.0f}%"),
        _stat_line("Expected goals (xG)", f"{h['xg']:.2f}", f"{a['xg']:.2f}"),
        _stat_line("Shots", str(h["shots"]), str(a["shots"])),
        _stat_line("Shots on target", str(h["shots_on_target"]), str(a["shots_on_target"])),
        _stat_line("Passes", str(h["passes"]), str(a["passes"])),
        _stat_line("Pass accuracy", f"{h['pass_accuracy']:.1f}%", f"{a['pass_accuracy']:.1f}%"),
        _stat_line("Corners", str(h["corners"]), str(a["corners"])),
        _stat_line("Fouls", str(h["fouls"]), str(a["fouls"])),
        _stat_line("Yellow cards", str(h["yellow_cards"]), str(a["yellow_cards"])),
        _stat_line("Red cards", str(h["red_cards"]), str(a["red_cards"])),
    ]
    return "\n".join(lines)


def build_ai_summary(match_id: int, db: Session) -> tuple[str, str]:
    """Returns (summary, facts). If anything fails, the error reaches the POST route,
    which returns 502 and keeps the old summary."""
    facts = build_facts(match_id, db)
    summary = generate_text(facts, instructions=INSTRUCTIONS)
    return summary, facts
