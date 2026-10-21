"""The PlayIQ performance score and the Compare page's key differences (app/analysis/compare.py),
and the percentile used to build its anchors (app/analysis/build_baselines.py).

No database: the score works on summaries and per-90 stats, and the anchors are replaced with
simple ones (0 to 10 for every stat) so the expected points are easy to work out by hand."""

import json
import random

import pytest

from app.analysis import compare
from app.analysis.build_baselines import percentile
from app.analysis.compare import (
    BANDS,
    PER_90_STATS,
    RESULT_POINTS,
    SCORE_PARTS,
    SCORED_STATS,
    _result_text,
    key_differences,
    load_baselines,
    per_90,
    performance_score,
    round_half_up,
    scale,
)

LOW, HIGH = 0.0, 10.0
LOWER_IS_BETTER = {stat for _, _, stats in SCORE_PARTS for stat, _, lower in stats if lower}


@pytest.fixture(autouse=True)
def simple_baselines(monkeypatch):
    """Every stat: p10 = 0, p90 = 10."""
    anchors = {stat: {"p10": LOW, "median": 5.0, "p90": HIGH} for stat in SCORED_STATS}
    monkeypatch.setattr(compare, "load_baselines", lambda: anchors)


def summary(result="W", penalties=None):
    return {"result": result, "penalties": penalties}


def stats_at(value, **overrides):
    """Every scored stat at `value`, apart from the overrides."""
    return {**{stat: value for stat in SCORED_STATS}, **overrides}


def best_possible():
    """Top-10% everywhere: high where high is good, low where low is good."""
    return {stat: LOW if stat in LOWER_IS_BETTER else HIGH for stat in SCORED_STATS}


def worst_possible():
    return {stat: HIGH if stat in LOWER_IS_BETTER else LOW for stat in SCORED_STATS}


def points(score, part):
    return next(p["points"] for p in score["parts"] if p["name"] == part)


# ── percentile ──

@pytest.mark.parametrize("p, expected", [(0.0, 1), (0.5, 3), (1.0, 5), (0.25, 2), (0.1, 1.4), (0.9, 4.6)])
def test_percentile_interpolates_like_numpy(p, expected):
    assert percentile([5, 1, 4, 2, 3], p) == pytest.approx(expected)  # unsorted on purpose


def test_percentile_of_one_value():
    assert percentile([7.0], 0.9) == 7.0


def test_percentile_does_not_change_the_input():
    values = [3, 1, 2]
    percentile(values, 0.5)
    assert values == [3, 1, 2]


# ── scale ──

@pytest.mark.parametrize("value, expected", [(0, 0.0), (5, 0.5), (10, 1.0), (2.5, 0.25)])
def test_scale_is_a_straight_line_between_the_anchors(value, expected):
    assert scale(value, LOW, HIGH) == expected


@pytest.mark.parametrize("value, expected", [(-3, 0.0), (25, 1.0)])
def test_scale_is_clamped(value, expected):
    assert scale(value, LOW, HIGH) == expected


@pytest.mark.parametrize("value, expected", [(0, 1.0), (10, 0.0), (2.5, 0.75), (-1, 1.0), (11, 0.0)])
def test_scale_lower_is_better_is_flipped(value, expected):
    assert scale(value, LOW, HIGH, lower_is_better=True) == expected


def test_scale_with_equal_anchors_is_halfway():
    assert scale(3, 2, 2) == 0.5
    assert scale(3, 2, 2, lower_is_better=True) == 0.5


# ── per_90 ──

def test_per_90_scales_counting_stats_only():
    stats = {"xg": 2.4, "shots": 12, "possession": 55.0, "pass_accuracy": 84.2,
             "goals_for": 3, "yellow_cards": 2, "attacking_third_pct": 30.0}
    scaled = per_90(stats, 120)
    assert scaled["xg"] == 1.8
    assert scaled["shots"] == 9
    # goals, cards and percentages are copied as they are
    for key in ("possession", "pass_accuracy", "goals_for", "yellow_cards", "attacking_third_pct"):
        assert scaled[key] == stats[key]


def test_per_90_rounds_to_two_places():
    assert per_90({"xg": 1.0}, 97)["xg"] == 0.93


def test_per_90_of_exactly_90_minutes_is_unchanged():
    stats = {stat: 3 for stat in PER_90_STATS}
    assert per_90(stats, 90) == stats


def test_per_90_without_minutes_returns_a_copy():
    stats = {"xg": 1.5}
    scaled = per_90(stats, 0)
    assert scaled == stats
    assert scaled is not stats


def test_per_90_does_not_change_the_input():
    stats = {"xg": 2.0}
    per_90(stats, 120)
    assert stats == {"xg": 2.0}


# ── how the score is put together ──

def test_score_parts_add_up_to_100_with_the_result():
    assert sum(max_points for _, max_points, _ in SCORE_PARTS) + RESULT_POINTS == 100


@pytest.mark.parametrize("name, stats", [(name, stats) for name, _, stats in SCORE_PARTS])
def test_shares_in_each_part_add_up_to_1(name, stats):
    assert sum(share for _, share, _ in stats) == pytest.approx(1)


def test_only_the_defending_stats_are_lower_is_better():
    assert LOWER_IS_BETTER == {"xg_against", "shots_on_target_against", "big_chances_against"}


def test_every_count_in_the_score_is_scaled_per_90():
    percentages = {"possession", "pass_accuracy", "attacking_third_pct"}
    assert set(SCORED_STATS) - percentages <= PER_90_STATS


def test_bands_go_from_best_to_worst_and_cover_0():
    floors = [floor for floor, _ in BANDS]
    assert floors == sorted(floors, reverse=True)
    assert floors[-1] == 0


# ── performance_score ──

def test_best_possible_performance_scores_100():
    score = performance_score(summary("W"), best_possible())
    assert score["total"] == 100
    assert score["band"] == "Outstanding"


def test_worst_possible_performance_scores_0():
    score = performance_score(summary("L"), worst_possible())
    assert score["total"] == 0
    assert score["band"] == "Poor"


def test_parts_in_order_with_their_maximums():
    score = performance_score(summary(), stats_at(5))
    assert [(p["name"], p["max"]) for p in score["parts"]] == [
        ("Chance creation", 30),
        ("Defending", 25),
        ("Result", 15),
        ("Control", 20),
        ("Territory", 10),
    ]


def test_halfway_everywhere():
    score = performance_score(summary("D"), stats_at(5))
    assert [p["points"] for p in score["parts"]] == [15.0, 12.5, 7.5, 10.0, 5.0]
    assert score["total"] == 50
    assert score["band"] == "Average"


def test_total_is_the_sum_of_the_parts():
    rng = random.Random(0)
    for _ in range(200):
        stats = {stat: rng.uniform(-5, 15) for stat in SCORED_STATS}
        score = performance_score(summary(rng.choice("WDL")), stats)
        assert 0 <= score["total"] <= 100
        assert score["total"] == round_half_up(sum(p["points"] for p in score["parts"]))
        for part in score["parts"]:
            assert 0 <= part["points"] <= part["max"]


def test_conceding_less_scores_more_on_defending():
    tight = performance_score(summary(), stats_at(5, xg_against=1, shots_on_target_against=1, big_chances_against=0))
    leaky = performance_score(summary(), stats_at(5, xg_against=9, shots_on_target_against=9, big_chances_against=8))
    assert points(tight, "Defending") > points(leaky, "Defending")


def test_stats_are_weighted_within_a_part():
    # only xG at the top: 0.6 of the 30 chance-creation points
    score = performance_score(summary(), stats_at(0, xg=10, shots_on_target=0, big_chances=0))
    assert points(score, "Chance creation") == 18.0


def test_a_stat_beyond_the_top_anchor_earns_no_extra():
    at_top = performance_score(summary(), stats_at(5, xg=10))
    beyond = performance_score(summary(), stats_at(5, xg=40))
    assert points(at_top, "Chance creation") == points(beyond, "Chance creation")


@pytest.mark.parametrize("result, penalties, expected", [
    ("W", None, 15.0),
    ("D", None, 7.5),
    ("L", None, 0.0),
    ("D", {"for": 4, "against": 2}, 10.5),  # a draw, plus 3 for winning the shootout
    ("D", {"for": 2, "against": 4}, 7.5),   # losing the shootout costs nothing extra
])
def test_result_points(result, penalties, expected):
    assert points(performance_score(summary(result, penalties), stats_at(5)), "Result") == expected


@pytest.mark.parametrize("value, expected", [
    (84.5, 85),   # round() would give 84
    (85.5, 86),
    (2.5, 3),     # round() would give 2
    (84.4, 84),
    (84.6, 85),
    (0.0, 0),
    (100.0, 100),
    (84.49999999999999, 85),  # a float sum that should have been 84.5
])
def test_round_half_up(value, expected):
    assert round_half_up(value) == expected


def test_total_of_84_5_rounds_up_to_outstanding():
    # 100, minus 7.5 for a draw, minus the 8 possession points (0.4 of Control's 20)
    score = performance_score(summary("D"), {**best_possible(), "possession": LOW})
    assert sum(p["points"] for p in score["parts"]) == 84.5
    assert score["total"] == 85
    assert score["band"] == "Outstanding"


@pytest.mark.parametrize("total, band", [(100, "Outstanding"), (85, "Outstanding"), (84, "Strong"), (70, "Strong"),
                                         (69, "Good"), (55, "Good"), (54, "Average"), (40, "Average"),
                                         (39, "Poor"), (0, "Poor")])
def test_band_edges(total, band):
    # the same lookup performance_score uses
    assert next(label for floor, label in BANDS if total >= floor) == band


# ── the real anchors ──

def test_baselines_file_has_every_scored_stat():
    load_baselines.cache_clear()
    anchors = load_baselines()
    for stat in SCORED_STATS:
        assert anchors[stat]["p10"] <= anchors[stat]["median"] <= anchors[stat]["p90"], stat


def test_for_and_against_anchors_match():
    # every match has both sides, so what teams create and what teams concede is the same set of numbers
    anchors = json.loads(compare.BASELINES_FILE.read_text())["stats"]
    for stat in ("xg", "shots_on_target", "big_chances"):
        assert anchors[stat] == anchors[f"{stat}_against"]


def test_missing_baselines_file_explains_how_to_build_it(monkeypatch, tmp_path):
    monkeypatch.setattr(compare, "BASELINES_FILE", tmp_path / "missing.json")
    load_baselines.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="build_baselines"):
            load_baselines()
    finally:
        load_baselines.cache_clear()


# ── key differences ──

def side(parts, opponent="France", result="W", goals=(2, 1), penalties=None, **per_90_stats):
    """A Compare side with only what key_differences reads; parts are points in SCORE_PARTS order."""
    names = ["Chance creation", "Defending", "Result", "Control", "Territory"]
    stats_90 = {"xg": 1.0, "xg_against": 1.0, "shots_on_target": 3.0, "possession": 50.0,
                "pass_accuracy": 80.0, "attacking_third_pct": 25.0, "final_third_entries": 30.0, **per_90_stats}
    return {
        "opponent_name": opponent,
        "result": result,
        "penalties": penalties,
        "stats": {"goals_for": goals[0], "goals_against": goals[1]},
        "stats_per_90": stats_90,
        "score": {"parts": [{"name": n, "points": p} for n, p in zip(names, parts, strict=True)]},
    }


def test_biggest_gaps_first_and_at_most_three():
    a = side([20, 10, 15, 10, 5])
    b = side([10, 15, 15, 9, 2])
    diffs = key_differences(a, b)
    assert [(d["part"], d["better"], d["points_gap"]) for d in diffs] == [
        ("Chance creation", "A", 10),
        ("Defending", "B", 5),
        ("Territory", "A", 3),
    ]


def test_equal_parts_are_left_out():
    a = side([10, 10, 15, 10, 5])
    b = side([10, 10, 15, 10, 4])
    assert [d["part"] for d in key_differences(a, b)] == ["Territory"]


def test_identical_matches_have_no_differences():
    a = side([10, 10, 15, 10, 5])
    assert key_differences(a, a) == []


def test_key_stat_values_are_formatted_for_each_match():
    a = side([20, 10, 15, 10, 5], xg=2.345)
    b = side([10, 10, 15, 10, 5], xg=0.5)
    [diff] = key_differences(a, b)
    assert diff["values"] == {"a": "2.35", "b": "0.50"}
    assert diff["unit"] == "xG per 90"


def test_result_difference_shows_the_scores():
    a = side([10, 10, 15, 10, 5], result="W", goals=(3, 0))
    b = side([10, 10, 0, 10, 5], result="L", goals=(1, 2), opponent="Saudi Arabia")
    [diff] = key_differences(a, b)
    assert diff["values"] == {"a": "3-0", "b": "1-2"}
    assert diff["text"] == "A 3-0 win over France, against a 1-2 defeat to Saudi Arabia."


def test_text_names_the_better_match():
    a = side([10, 10, 15, 10, 5], opponent="Mexico")
    b = side([10, 20, 15, 10, 5], opponent="Poland", xg_against=0.4)
    [diff] = key_differences(a, b)
    assert diff["better"] == "B"
    assert diff["text"].startswith("Gave away less in Match B: Poland made 0.40 xG per 90")


# ── _result_text ──

@pytest.mark.parametrize("result, goals, penalties, expected", [
    ("W", (2, 0), None, "a 2-0 win over France"),
    ("L", (1, 2), None, "a 1-2 defeat to France"),
    ("D", (3, 3), {"for": 4, "against": 2}, "a 3-3 draw with France (won 4-2 on penalties)"),
    ("D", (0, 0), {"for": 2, "against": 4}, "a 0-0 draw with France (lost 2-4 on penalties)"),
])
def test_result_text(result, goals, penalties, expected):
    assert _result_text(side([0] * 5, result=result, goals=goals, penalties=penalties)) == expected
