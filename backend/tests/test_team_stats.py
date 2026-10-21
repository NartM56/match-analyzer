"""Team stats and the possession estimate (app/analysis/team_stats.py).

Events are built in memory (no database): the functions only read their attributes."""

import pytest

from app.analysis.team_stats import (
    DEAD_BALL_SECONDS,
    _card,
    _possession_seconds,
    _team_stats,
    calculate_stats,
)
from app.models.models import Event

HOME, AWAY = 1, 2

_next_index = 0


def event(event_type="Pass", team=HOME, period=1, minute=0, second=0, outcome=None,
          details=None, possession_team=None, index=None):
    """An Event with sensible defaults; event_index counts up unless given."""
    global _next_index
    _next_index += 1
    return Event(
        match_id=1,
        event_index=_next_index if index is None else index,
        period=period,
        minute=minute,
        second=second,
        event_type=event_type,
        team_id=team,
        possession_team_id=possession_team,
        outcome=outcome,
        details=details,
    )


def shot(xg, outcome="Off T", **kwargs):
    return event("Shot", outcome=outcome, details={"statsbomb_xg": xg}, **kwargs)


def card(name, event_type="Foul Committed", **kwargs):
    return event(event_type, details={"card": {"name": name}}, **kwargs)


def at(minute, second, possession_team, period=1, **kwargs):
    """An event used only for its clock time and team in possession."""
    return event("Pass", minute=minute, second=second, period=period, possession_team=possession_team, **kwargs)


# ── _card ──

@pytest.mark.parametrize("name", ["Yellow Card", "Second Yellow", "Red Card"])
def test_card_on_foul(name):
    assert _card(card(name)) == name


def test_card_on_bad_behaviour():
    assert _card(card("Red Card", event_type="Bad Behaviour")) == "Red Card"


def test_foul_without_card():
    assert _card(event("Foul Committed")) is None
    assert _card(event("Foul Committed", details={"advantage": True})) is None


def test_card_ignored_on_other_event_types():
    assert _card(card("Yellow Card", event_type="Pass")) is None


# ── _team_stats ──

def test_empty_match_is_all_zeros():
    assert _team_stats([], HOME) == {
        "xg": 0.0,
        "shots": 0,
        "shots_on_target": 0,
        "passes": 0,
        "corners": 0,
        "fouls": 0,
        "yellow_cards": 0,
        "red_cards": 0,
        "pass_accuracy": 0.0,  # no passes: 0, not a division by zero
    }


def test_only_counts_the_given_team():
    events = [shot(0.5, team=HOME), shot(0.3, team=AWAY), event("Foul Committed", team=AWAY)]
    stats = _team_stats(events, HOME)
    assert stats["shots"] == 1
    assert stats["xg"] == 0.5
    assert stats["fouls"] == 0


def test_shots_xg_and_on_target():
    events = [
        shot(0.76, outcome="Goal"),
        shot(0.10, outcome="Saved"),
        shot(0.05, outcome="Saved to Post"),
        shot(0.20, outcome="Off T"),
        shot(0.08, outcome="Blocked"),
        shot(0.02, outcome="Post"),  # hit the post and stayed out: not on target
    ]
    stats = _team_stats(events, HOME)
    assert stats["shots"] == 6
    assert stats["shots_on_target"] == 3
    assert stats["xg"] == 1.21


def test_xg_is_rounded_to_two_places():
    stats = _team_stats([shot(0.1234), shot(0.0011)], HOME)
    assert stats["xg"] == 0.12


def test_shot_without_xg_counts_as_zero_xg():
    stats = _team_stats([event("Shot", outcome="Off T")], HOME)
    assert stats["shots"] == 1
    assert stats["xg"] == 0.0


@pytest.mark.parametrize("period", [1, 2, 3, 4])
def test_shots_count_in_every_open_play_period(period):
    assert _team_stats([shot(0.1, period=period)], HOME)["shots"] == 1


def test_shootout_kicks_are_not_shots():
    events = [shot(0.78, outcome="Goal", period=5), event("Pass", period=5), event("Foul Committed", period=5)]
    stats = _team_stats(events, HOME)
    assert stats["shots"] == 0
    assert stats["xg"] == 0.0
    assert stats["passes"] == 0
    assert stats["fouls"] == 0


def test_shootout_cards_still_count():
    stats = _team_stats([card("Yellow Card", event_type="Bad Behaviour", period=5)], HOME)
    assert stats["yellow_cards"] == 1


def test_pass_accuracy():
    # StatsBomb leaves completed passes without an outcome
    events = [event("Pass")] * 2 + [event("Pass", outcome="Incomplete")]
    stats = _team_stats(events, HOME)
    assert stats["passes"] == 3
    assert stats["pass_accuracy"] == 66.7
    assert "completed_passes" not in stats  # only used to work out the accuracy


@pytest.mark.parametrize("outcome", ["Incomplete", "Out", "Pass Offside", "Unknown"])
def test_any_pass_outcome_means_not_completed(outcome):
    assert _team_stats([event("Pass", outcome=outcome)], HOME)["pass_accuracy"] == 0.0


def test_corners_are_passes_of_type_corner():
    events = [
        event("Pass", details={"type": {"name": "Corner"}}),
        event("Pass", details={"type": {"name": "Free Kick"}}),
        event("Pass"),
    ]
    stats = _team_stats(events, HOME)
    assert stats["corners"] == 1
    assert stats["passes"] == 3


def test_fouls():
    events = [event("Foul Committed"), card("Yellow Card"), event("Foul Won")]
    assert _team_stats(events, HOME)["fouls"] == 2  # "Foul Won" is the other side of a foul


def test_second_yellow_is_a_red_card():
    events = [card("Yellow Card"), card("Second Yellow"), card("Red Card", event_type="Bad Behaviour")]
    stats = _team_stats(events, HOME)
    assert stats["yellow_cards"] == 1
    assert stats["red_cards"] == 2


# ── _possession_seconds ──

def test_time_goes_to_the_team_in_possession_at_the_earlier_event():
    events = [at(0, 0, HOME), at(0, 10, AWAY), at(0, 15, HOME)]
    assert _possession_seconds(events) == {HOME: 10, AWAY: 5}


def test_last_event_gets_no_time():
    assert _possession_seconds([at(0, 0, HOME)]) == {}


def test_gap_just_under_the_dead_ball_limit_counts():
    events = [at(0, 0, HOME), at(0, DEAD_BALL_SECONDS - 1, AWAY)]
    assert _possession_seconds(events) == {HOME: DEAD_BALL_SECONDS - 1}


@pytest.mark.parametrize("gap", [DEAD_BALL_SECONDS, DEAD_BALL_SECONDS + 1, 90])
def test_long_gaps_are_dead_ball_and_ignored_entirely(gap):
    events = [at(0, 0, HOME), at(gap // 60, gap % 60, AWAY)]
    assert _possession_seconds(events) == {}


def test_events_in_the_same_second_add_nothing():
    assert _possession_seconds([at(5, 0, HOME), at(5, 0, AWAY)]) == {}


def test_the_break_between_periods_is_not_counted():
    # StatsBomb restarts the second half at 45:00, so a first half ending at 44:50 would look like
    # a 10-second gap; it's half-time, so nobody gets it
    events = [at(44, 50, HOME, period=1), at(45, 0, AWAY, period=2), at(45, 5, AWAY, period=2)]
    assert _possession_seconds(events) == {AWAY: 5}


def test_extra_time_counts_but_the_shootout_does_not():
    events = [
        at(91, 0, HOME, period=3),
        at(91, 20, HOME, period=3),
        at(120, 0, AWAY, period=5),
        at(120, 10, AWAY, period=5),
    ]
    assert _possession_seconds(events) == {HOME: 20}


def test_events_without_a_team_in_possession_are_skipped():
    # the gap is measured to the next event that has a team in possession
    events = [at(0, 0, HOME), at(0, 4, None), at(0, 6, AWAY)]
    assert _possession_seconds(events) == {HOME: 6}


def test_sorted_by_match_clock_not_event_index():
    # out-of-order indexes, e.g. a 'Half End' indexed straight after the kick-off
    events = [at(0, 20, AWAY, index=2), at(0, 0, HOME, index=3), at(0, 10, HOME, index=1)]
    assert _possession_seconds(events) == {HOME: 20}


# ── calculate_stats ──

def test_possession_shares_add_up_to_100():
    events = [at(0, 0, HOME, team=HOME), at(0, 1, AWAY, team=AWAY), at(0, 3, HOME, team=HOME)]
    home, away = calculate_stats(events, HOME, AWAY)
    assert home["possession"] == 33.3
    assert away["possession"] == 66.7
    assert home["possession"] + away["possession"] == 100


def test_possession_is_50_50_without_any_possession_time():
    home, away = calculate_stats([], HOME, AWAY)
    assert home["possession"] == away["possession"] == 50.0


def test_returns_home_then_away():
    events = [shot(0.4, team=HOME), shot(0.1, team=AWAY), shot(0.1, team=AWAY)]
    home, away = calculate_stats(events, HOME, AWAY)
    assert (home["shots"], away["shots"]) == (1, 2)
