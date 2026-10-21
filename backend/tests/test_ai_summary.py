"""The AI match summary: the fact sheet (app/analysis/ai_summary.py) and the GET/POST
/matches/{id}/ai_summary routes. The model is always replaced by a fake: no test calls OpenAI."""

from datetime import timedelta

import pytest

from app.analysis import ai_summary
from app.analysis.ai_summary import INSTRUCTIONS, PROMPT_VERSION, build_facts
from app.models.models import MatchSummary
from app.routes.matches import REGENERATE_COOLDOWN
from tests.factories import AWAY, HOME, MATCH_ID, add_match, goal, half_end, own_goal, shot

MESSI, DI_MARIA, MBAPPE, OTAMENDI = 5503, 7000, 3009, 5000
PLAYERS = [
    (MESSI, "Lionel Andrés Messi Cuccittini", "Lionel Messi"),
    (DI_MARIA, "Ángel Fabián Di María Hernández", "Ángel Di María"),
    (MBAPPE, "Kylian Mbappé Lottin", None),  # no nickname: the full name is used
    (OTAMENDI, "Nicolás Hernán Gonzalo Otamendi", None),
]
URL = f"/matches/{MATCH_ID}/ai_summary"


class FakeModel:
    """Stands in for app.services.llm.generate_text and records what it was sent."""

    def __init__(self, reply="Argentina won a thrilling final.", error=None):
        self.reply, self.error, self.calls = reply, error, []

    def __call__(self, prompt, instructions=None):
        self.calls.append({"prompt": prompt, "instructions": instructions})
        if self.error:
            raise self.error
        return self.reply


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setattr(ai_summary, "generate_text", fake)
    return fake


@pytest.fixture
def match(db):
    """A 2-1 home win: a penalty, a goal in first-half stoppage time and an own goal."""
    return add_match(db, home_score=2, away_score=1, players=PLAYERS, events=[
        goal(HOME, minute=22, player=MESSI, penalty=True, xg=0.78),
        goal(HOME, minute=46, player=DI_MARIA, xg=0.3),  # 45+2'
        half_end(1, 48),
        shot(AWAY, minute=60, player=MBAPPE, outcome="Saved", xg=0.2),
        own_goal(HOME, minute=80, player=OTAMENDI, period=2),
        half_end(2, 95),
    ])


def make_old(db, minutes):
    """Pretend the saved summary was written `minutes` ago."""
    saved = db.get(MatchSummary, MATCH_ID)
    saved.created_at -= timedelta(minutes=minutes)
    db.flush()


# ── build_facts ──

def test_facts_header(db, match):
    lines = build_facts(MATCH_ID, db).splitlines()
    assert lines[:4] == [
        "MATCH: FIFA World Cup 2022 Final, 18 Dec 2022",
        "HOME TEAM: Argentina",
        "AWAY TEAM: France",
        "RESULT: Argentina 2-1 France",
    ]


def test_facts_list_goals_in_order_with_penalties_and_own_goals(db, match):
    facts = build_facts(MATCH_ID, db)
    goals = facts.split("GOALS (in match order):\n")[1].split("\n\n")[0].splitlines()
    assert goals == [
        "  23' Lionel Messi (Argentina, penalty)",
        "  45+2' Ángel Di María (Argentina)",
        "  81' Nicolás Hernán Gonzalo Otamendi (own goal, counts for France)",
    ]


def test_facts_include_the_team_stats(db, match):
    facts = build_facts(MATCH_ID, db)
    assert "TEAM STATS (Argentina | France):" in facts
    assert "  Expected goals (xG)  1.08 | 0.20" in facts
    assert "  Shots                2 | 1" in facts
    assert "  Shots on target      2 | 1" in facts


def test_facts_without_goals(db):
    add_match(db, events=[half_end(1, 47), half_end(2, 93)])
    assert "GOALS (in match order):\n  None" in build_facts(MATCH_ID, db)


def test_facts_extra_time_and_shootout(db):
    add_match(db, home_score=3, away_score=3, events=[
        goal(HOME, minute=22, player=None),
        half_end(3, 106),
        goal(HOME, period=5, minute=120), goal(AWAY, period=5, minute=121),
        goal(HOME, period=5, minute=122), shot(AWAY, period=5, minute=123, outcome="Saved"),
    ])
    facts = build_facts(MATCH_ID, db)
    assert "RESULT: Argentina 3-3 France (after extra time)" in facts
    assert "PENALTY SHOOTOUT: Argentina won 2-1" in facts
    # shootout kicks are not goals in the match
    goals = facts.split("GOALS (in match order):\n")[1].split("\n\n")[0].splitlines()
    assert goals == ["  23' Unknown (Argentina)"]  # no player recorded


def test_facts_away_team_wins_the_shootout(db):
    add_match(db, events=[goal(AWAY, period=5, minute=120), shot(HOME, period=5, minute=121, outcome="Saved")])
    assert "PENALTY SHOOTOUT: France won 1-0" in build_facts(MATCH_ID, db)


def test_summary_sends_the_facts_and_the_rules(db, match, model):
    summary, facts = ai_summary.build_ai_summary(MATCH_ID, db)
    assert summary == model.reply
    assert facts == build_facts(MATCH_ID, db)
    assert model.calls == [{"prompt": facts, "instructions": INSTRUCTIONS}]


# ── GET /matches/{id}/ai_summary ──

def test_get_before_any_summary_is_404(client, match, model):
    response = client.get(URL)
    assert response.status_code == 404
    assert response.json()["detail"] == "No summary yet"  # the frontend shows the button on this


def test_get_never_calls_the_model(client, match, model):
    client.get(URL)
    client.post(URL)
    client.get(URL)
    assert len(model.calls) == 1  # only the POST


def test_get_unknown_match_is_404(client, model):
    response = client.get("/matches/999999/ai_summary")
    assert response.status_code == 404
    assert response.json()["detail"] == "Match not found"


# ── POST /matches/{id}/ai_summary ──

def test_post_generates_and_saves(client, db, match, model):
    response = client.post(URL)
    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == model.reply
    assert body["prompt_version"] == PROMPT_VERSION
    assert body["model"]  # from settings

    saved = db.get(MatchSummary, MATCH_ID)
    assert saved.summary == model.reply
    assert saved.facts == model.calls[0]["prompt"]  # the fact sheet is kept for debugging
    assert client.get(URL).json() == body


def test_post_unknown_match_is_404_without_calling_the_model(client, model):
    assert client.post("/matches/999999/ai_summary").status_code == 404
    assert model.calls == []


def test_regenerating_within_the_cooldown_is_429(client, match, model):
    first = client.post(URL).json()
    response = client.post(URL)
    assert response.status_code == 429
    assert len(model.calls) == 1  # the model isn't called again
    assert client.get(URL).json() == first  # and the saved summary is untouched


def test_regenerating_after_the_cooldown_replaces_the_summary(client, db, match, model):
    first = client.post(URL).json()
    make_old(db, minutes=REGENERATE_COOLDOWN.total_seconds() / 60 + 1)
    model.reply = "A second take on the final."

    response = client.post(URL)
    assert response.status_code == 200
    assert response.json()["summary"] == "A second take on the final."
    assert response.json()["created_at"] > first["created_at"]  # the cooldown restarts
    assert db.query(MatchSummary).filter_by(match_id=MATCH_ID).count() == 1  # replaced, not added


def test_just_inside_the_cooldown_is_still_429(client, db, match, model):
    client.post(URL)
    make_old(db, minutes=(REGENERATE_COOLDOWN.total_seconds() - 5) / 60)
    assert client.post(URL).status_code == 429


def test_cooldown_is_per_match(client, db, match, model):
    add_match(db, match_id=MATCH_ID + 1)
    assert client.post(URL).status_code == 200
    assert client.post(f"/matches/{MATCH_ID + 1}/ai_summary").status_code == 200


def test_model_failure_is_502_and_saves_nothing(client, db, match, model):
    model.error = TimeoutError("OpenAI took too long")
    response = client.post(URL)
    assert response.status_code == 502
    assert response.json()["detail"] == "Couldn't write the explanation"
    assert db.get(MatchSummary, MATCH_ID) is None


def test_model_failure_keeps_the_old_summary(client, db, match, model):
    first = client.post(URL).json()
    make_old(db, minutes=5)
    model.error = RuntimeError("service down")

    assert client.post(URL).status_code == 502
    assert client.get(URL).json()["summary"] == first["summary"]
