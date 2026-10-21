"""The StatsBomb rules from the README's "Data notes", checked across the whole backend:
shootouts, own goals, minute labels, extra time, player names and the PlayIQ pass/touch definitions."""

import copy

import pytest

from app.analysis.compare import _match_minutes, get_team_match_summary
from app.analysis.match_events import (
    _is_touch,
    display_name,
    get_attack_area,
    get_goals,
    get_lineups,
    get_passes,
    get_penalties,
    get_periods,
    get_player_events,
    get_shootout,
    get_timeline,
    get_xg,
    is_progressive,
    minute_label,
    zone,
)
from app.analysis.team_stats import get_match_team_stats
from app.models.models import Event, Player
from tests.factories import (
    AWAY,
    HOME,
    MATCH_ID,
    add_events,
    add_lineup,
    add_match,
    card,
    event,
    goal,
    half_end,
    own_goal,
    pass_,
    shot,
    substitution,
)

MESSI, MBAPPE, DI_MARIA, ACUNA, OTAMENDI, ROOKIE = 5503, 3009, 7000, 7001, 5000, 7002
PLAYERS = [
    (MESSI, "Lionel Andrés Messi Cuccittini", "Lionel Messi"),
    (MBAPPE, "Kylian Mbappé Lottin", None),
    (DI_MARIA, "Ángel Fabián Di María Hernández", "Ángel Di María"),
    (ACUNA, "Marcos Javier Acuña", None),
    (OTAMENDI, "Nicolás Hernán Gonzalo Otamendi", None),
]


# ── Minute labels (StatsBomb minutes start at 0 and run on through stoppage time) ──

@pytest.mark.parametrize("minute, period, label", [
    (0, 1, "1'"),
    (22, 1, "23'"),
    (44, 1, "45'"),     # the last minute of normal time
    (45, 1, "45+1'"),   # first minute of stoppage time
    (47, 1, "45+3'"),
    (45, 2, "46'"),     # the second half restarts the clock at 45
    (89, 2, "90'"),
    (90, 2, "90+1'"),
    (97, 2, "90+8'"),
    (90, 3, "91'"),     # extra time
    (104, 3, "105'"),
    (105, 3, "105+1'"),
    (117, 4, "118'"),
    (120, 4, "120+1'"),
])
def test_minute_label(minute, period, label):
    assert minute_label(minute, period) == label


# ── Player names ──

def test_nickname_when_there_is_one():
    assert display_name(Player(id=1, name="Lionel Andrés Messi Cuccittini", nickname="Lionel Messi")) == "Lionel Messi"


def test_full_name_without_a_nickname():
    assert display_name(Player(id=1, name="Kylian Mbappé Lottin", nickname=None)) == "Kylian Mbappé Lottin"


def test_names_across_goals_substitutions_and_lineups(db):
    match = add_match(db, players=PLAYERS, events=[
        goal(HOME, minute=22, player=MESSI),
        goal(AWAY, minute=80, player=MBAPPE, period=2),
        goal(HOME, minute=85, player=None, period=2),  # no player recorded
        substitution(DI_MARIA, ACUNA, minute=63, period=2),
        substitution(MESSI, ROOKIE, on_name="Not In Players Table", minute=88, period=2),
    ])
    add_lineup(db, MESSI)
    add_lineup(db, ACUNA, jersey=8, starter=False, minutes=27)

    assert [g["player_name"] for g in get_goals(db, match)] == ["Lionel Messi", "Kylian Mbappé Lottin", "Unknown"]
    subs = [e for e in get_timeline(db, match)[0] if e["type"] == "substitution"]
    assert [(s["player_off"], s["player_on"]) for s in subs] == [
        ("Ángel Di María", "Marcos Javier Acuña"),
        ("Lionel Messi", "Not In Players Table"),  # replacement missing from players: StatsBomb's name
    ]
    lineup = get_lineups(db, match)["players"][HOME]
    assert [p["player_name"] for p in lineup] == ["Lionel Messi", "Marcos Javier Acuña"]


# ── Penalty shootouts (period 5) are left out of everything except /shootout ──

def _extra_time_match(db):
    """An extra-time match with a bit of everything that has a location."""
    match = add_match(db, home_score=2, away_score=2, players=PLAYERS, events=[
        pass_(50, 40, 85, 30, player=MESSI),
        pass_(30, 10, 70, 10, team=AWAY, player=MBAPPE),
        shot(HOME, minute=10, player=MESSI, x=100, y=40, xg=0.12),
        goal(HOME, minute=22, player=MESSI, x=108, y=40, xg=0.78, penalty=True),
        event("Ball Receipt*", player=MESSI, x=90, y=50, minute=30),
        half_end(1, 47),
        goal(AWAY, minute=80, player=MBAPPE, period=2, x=105, y=35, xg=0.4),
        card("Yellow Card", team=AWAY, player=MBAPPE, minute=70, period=2),
        half_end(2, 95),
        shot(AWAY, minute=100, period=3, player=MBAPPE, x=95, y=70, xg=0.05, outcome="Saved"),
        half_end(3, 106),
        goal(HOME, minute=108, period=4, player=MESSI, x=114, y=38, xg=0.5),
        goal(AWAY, minute=117, period=4, player=MBAPPE, x=108, y=40, xg=0.78, penalty=True),
        half_end(4, 123),
    ])
    add_lineup(db, MESSI)
    add_lineup(db, MBAPPE, team=AWAY)
    return match


SHOOTOUT = [
    goal(AWAY, period=5, minute=124, player=MBAPPE, x=108, y=40, xg=0.78, penalty=True),
    goal(HOME, period=5, minute=124, player=MESSI, x=108, y=40, xg=0.78, penalty=True),
    shot(AWAY, period=5, minute=125, player=MBAPPE, x=108, y=40, xg=0.78, penalty=True, outcome="Saved"),
    event("Goal Keeper", team=HOME, period=5, minute=125, x=2, y=40),  # the save: a touch, if counted
    goal(HOME, period=5, minute=126, player=MESSI, x=108, y=40, xg=0.78, penalty=True),
    shot(AWAY, period=5, minute=126, player=MBAPPE, x=108, y=40, xg=0.78, penalty=True, outcome="Post"),
    half_end(5, 127),
]


def _everything(db, match):
    """Every number the match pages and Compare show, apart from the shootout itself."""
    return copy.deepcopy({
        "team_stats": get_match_team_stats(db, match.id),
        "goals": get_goals(db, match),
        "xg": get_xg(db, match),
        "timeline": get_timeline(db, match),
        "attack": get_attack_area(db, match),
        "passes": get_passes(db, match),
        "messi": get_player_events(db, match, MESSI),
        "mbappe": get_player_events(db, match, MBAPPE),
        "compare_home": get_team_match_summary(db, match, HOME)["stats"],
        "compare_away": get_team_match_summary(db, match, AWAY)["stats"],
        "minutes": _match_minutes(db, match),
    })


def test_a_shootout_changes_nothing_but_the_shootout(db):
    match = _extra_time_match(db)
    before = _everything(db, match)
    add_events(db, events=SHOOTOUT)
    after = _everything(db, match)

    for key in before:
        assert after[key] == before[key], key


def test_the_shootout_itself(db):
    match = _extra_time_match(db)
    add_events(db, events=SHOOTOUT)

    shootout = get_shootout(db, match)
    assert (shootout["home_score"], shootout["away_score"]) == (2, 1)
    assert shootout["winner_team_id"] == HOME
    assert shootout["first_team_id"] == AWAY
    assert [(k["order"], k["taken"], k["team_id"], k["result"]) for k in shootout["kicks"]] == [
        (1, 1, AWAY, "Scored"),
        (2, 1, HOME, "Scored"),
        (3, 2, AWAY, "Saved"),
        (4, 2, HOME, "Scored"),
        (5, 3, AWAY, "Hit the post"),
    ]
    assert get_penalties(db, match, get_periods(db, match.id)) == {"home": 2, "away": 1}


def test_no_shootout(db):
    match = _extra_time_match(db)
    assert get_shootout(db, match) is None
    assert get_penalties(db, match, get_periods(db, match.id)) is None


def test_shootout_cards_count_in_team_stats_and_lineups_but_not_the_timeline(db):
    match = _extra_time_match(db)
    add_events(db, events=[card("Yellow Card", team=HOME, player=MESSI, period=5, minute=125)])

    home, _ = get_match_team_stats(db, match.id)
    assert home["yellow_cards"] == 1  # part of the official tally
    assert not [e for e in get_timeline(db, match)[0] if e["type"] == "card" and e["team_id"] == HOME]
    messi = next(p for p in get_lineups(db, match)["players"][HOME] if p["player_id"] == MESSI)
    assert [c["card"] for c in messi["yellow_red_cards"]] == ["Yellow Card"]


def test_shootout_routes(client, db):
    _extra_time_match(db)
    assert client.get(f"/matches/{MATCH_ID}/shootout").status_code == 404
    add_events(db, events=SHOOTOUT)
    assert client.get(f"/matches/{MATCH_ID}/shootout").json()["home_score"] == 2
    header = client.get(f"/matches/{MATCH_ID}").json()
    assert header["penalties"] == {"home": 2, "away": 1}
    assert (header["home_score"], header["away_score"]) == (2, 2)  # the shootout isn't in the score


# ── Own goals count for the other team ──

@pytest.fixture
def own_goal_match(db):
    """1-1: Messi scores, then Otamendi (home) puts one into his own net."""
    match = add_match(db, home_score=1, away_score=1, players=PLAYERS, events=[
        goal(HOME, minute=22, player=MESSI, x=108, y=40, xg=0.78),
        own_goal(HOME, minute=80, period=2, player=OTAMENDI),
    ])
    add_lineup(db, OTAMENDI, jersey=19)
    return match


def test_own_goal_goes_to_the_other_team(db, own_goal_match):
    goals = get_goals(db, own_goal_match)
    assert [(g["team_id"], g["own_goal"]) for g in goals] == [(HOME, False), (AWAY, True)]
    assert goals[1]["player_name"] == "Nicolás Hernán Gonzalo Otamendi"  # who put it in


def test_own_goal_on_the_xg_race(db, own_goal_match):
    og = next(s for s in get_xg(db, own_goal_match)["shots"] if s["own_goal"])
    assert og["team_id"] == AWAY
    assert og["xg"] == 0.0  # not a shot
    assert og["outcome"] == "Own Goal"
    assert og["goal"] is True


def test_own_goal_is_not_a_shot(db, own_goal_match):
    home, away = get_match_team_stats(db, own_goal_match.id)
    assert (home["shots"], away["shots"]) == (1, 0)
    assert get_team_match_summary(db, own_goal_match, AWAY)["stats"]["big_chances"] == 0


def test_own_goal_is_not_the_players_goal(db, own_goal_match):
    otamendi = get_player_events(db, own_goal_match, OTAMENDI)
    assert otamendi["summary"]["goals"] == 0
    assert otamendi["player"]["goals"] == []


def test_own_goal_in_the_match_header(client, own_goal_match):
    goals = client.get(f"/matches/{MATCH_ID}").json()["goals"]
    assert [(g["team_id"], g["minute_label"], g["own_goal"]) for g in goals] == [
        (HOME, "23'", False),
        (AWAY, "81'", True),
    ]


# ── Extra time ──

def test_extra_time_period_ends(db):
    match = _extra_time_match(db)
    _, periods = get_timeline(db, match)
    assert periods == [
        {"period": 1, "end_minute": 47},
        {"period": 2, "end_minute": 95},
        {"period": 3, "end_minute": 106},
        {"period": 4, "end_minute": 123},
    ]
    assert _match_minutes(db, match) == 123  # what per-90 stats divide by


def test_match_without_extra_time(db, client):
    match = add_match(db, events=[half_end(1, 47), half_end(2, 96)])
    assert [p["period"] for p in get_timeline(db, match)[1]] == [1, 2]
    assert "et" not in get_attack_area(db, match)  # no "Extra time" filter
    assert client.get(f"/matches/{MATCH_ID}").json()["extra_time"] is False


def test_extra_time_filter_only_covers_extra_time(db, client):
    match = _extra_time_match(db)
    attack = get_attack_area(db, match)
    assert set(attack) == {"all", "1", "2", "et"}
    assert attack["et"]["away"]["channels"][2]["shots"] == 1  # Mbappé's 101' shot from the right
    assert attack["et"]["home"]["channels"][1]["shots"] == 1  # Messi's 109' goal from the centre
    assert attack["2"]["away"]["channels"][2]["shots"] == 0   # not in the second half
    assert client.get(f"/matches/{MATCH_ID}").json()["extra_time"] is True


def test_missing_period_ends_fall_back_to_90_minutes(db):
    match = add_match(db)
    assert _match_minutes(db, match) == 90


# ── PlayIQ definitions: progressive passes ──

def _pass(x, y, end_x, end_y, outcome=None):
    return Event(event_type="Pass", x=x, y=y, end_x=end_x, end_y=end_y, outcome=outcome, period=1)


def test_progressive_when_exactly_25_percent_closer():
    # from (60, 40), 60 from goal, to (75, 40), 45 from goal: exactly 75% of the distance
    assert is_progressive(_pass(60, 40, 75, 40))


def test_not_progressive_when_just_short_of_25_percent():
    assert not is_progressive(_pass(60, 40, 74.9, 40))


def test_progressive_can_start_on_the_edge_of_the_defensive_third():
    assert is_progressive(_pass(40, 40, 70, 40))


def test_passes_from_inside_the_defensive_third_are_never_progressive():
    assert not is_progressive(_pass(39.9, 40, 110, 40))


def test_incomplete_passes_are_not_progressive():
    assert not is_progressive(_pass(60, 40, 100, 40, outcome="Incomplete"))


def test_backward_and_sideways_passes_are_not_progressive():
    assert not is_progressive(_pass(60, 40, 50, 40))
    assert not is_progressive(_pass(60, 10, 60, 70))


def test_distance_is_to_the_goal_not_just_up_the_pitch():
    # 30 forward but out to the touchline: from 60 to about 46 from goal, only 23% closer
    assert not is_progressive(_pass(60, 40, 90, 0))


def test_passes_without_a_location_are_not_progressive():
    assert not is_progressive(_pass(None, None, 70, 40))
    assert not is_progressive(_pass(60, 40, None, None))


# ── PlayIQ definitions: final-third entries and passes into the box (from /passes) ──

@pytest.mark.parametrize("x, end_x, completed, expected", [
    (79.9, 80, True, True),     # just outside to the line
    (60, 100, True, True),
    (80, 100, True, False),     # already in the final third
    (60, 79.9, True, False),    # stops short
    (60, 100, False, False),    # didn't arrive
])
def test_into_final_third(db, x, end_x, completed, expected):
    match = add_match(db, events=[pass_(x, 40, end_x, 40, completed=completed)])
    assert get_passes(db, match)[0]["into_final_third"] is expected


@pytest.mark.parametrize("end_x, end_y, completed, expected", [
    (102, 18, True, True),      # the corner of the box
    (102, 62, True, True),
    (120, 40, True, True),
    (101.9, 40, True, False),   # just outside the box
    (110, 17.9, True, False),
    (110, 62.1, True, False),
    (110, 40, False, False),
])
def test_into_box(db, end_x, end_y, completed, expected):
    match = add_match(db, events=[pass_(70, 40, end_x, end_y, completed=completed)])
    assert get_passes(db, match)[0]["into_box"] is expected


def test_attack_entries_use_the_same_rule_and_the_arrival_channel(db):
    match = add_match(db, events=[
        pass_(70, 40, 85, 5),                    # arrives on the left
        pass_(70, 5, 85, 40),                    # starts left, arrives centre
        pass_(70, 40, 85, 75),                   # right
        pass_(85, 40, 95, 40),                   # already in the final third
        pass_(70, 40, 85, 40, completed=False),  # incomplete
    ])
    channels = get_attack_area(db, match)["all"]["home"]["channels"]
    assert {c["channel"]: c["entries"] for c in channels} == {"left": 1, "centre": 1, "right": 1}


# ── PlayIQ definitions: touches and zones ──

def _event(event_type, outcome=None, details=None, period=1):
    return Event(event_type=event_type, outcome=outcome, details=details, period=period, x=50, y=40)


@pytest.mark.parametrize("event_type", ["Pass", "Ball Receipt*", "Shot", "Dribble", "Clearance", "Interception",
                                        "Ball Recovery", "Block", "Miscontrol", "Goal Keeper"])
def test_on_ball_actions_are_touches(event_type):
    assert _is_touch(_event(event_type))


@pytest.mark.parametrize("event_type", ["Pressure", "Carry", "Duel", "Foul Committed", "Foul Won", "Half End"])
def test_off_ball_actions_are_not_touches(event_type):
    assert not _is_touch(_event(event_type))


def test_a_pass_that_never_arrived_is_not_a_touch_for_the_receiver():
    assert not _is_touch(_event("Ball Receipt*", outcome="Incomplete"))


def test_a_failed_recovery_is_not_a_touch():
    assert not _is_touch(_event("Ball Recovery", details={"recovery_failure": True}))


def test_shootout_actions_are_not_touches():
    assert not _is_touch(_event("Shot", period=5))


@pytest.mark.parametrize("x, y, expected", [
    (0, 0, ("defensive", "left")),
    (39.9, 26.6, ("defensive", "left")),
    (40, 80 / 3, ("middle", "centre")),   # a line belongs to the zone ahead of it / to its right
    (79.9, 53.3, ("middle", "centre")),
    (80, 160 / 3, ("attacking", "right")),
    (120, 80, ("attacking", "right")),
])
def test_zones(x, y, expected):
    assert zone(x, y) == expected
