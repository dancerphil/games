"""heuristic-v2 tests: ratios, ordering, single-count, race value, policy."""

from mcts import get_best_move, idx
from models import REGISTRY
from models.heuristic_v2 import (
    RACE_DEFEND,
    RACE_FOUR,
    RACE_HALF_LOSS,
    RACE_OPEN_LOSS,
    RACE_THREE,
    V2_SCORE,
    _board_state,
    _defense_weight,
    _score_line,
    evaluate_board_v2,
    heuristic_v2_model,
)

S = V2_SCORE


def _line(stones, val="black"):
    cells = [None] * 15
    for i in stones:
        cells[i] = val
    return cells


def _board(cells, val="black"):
    b = [None] * 225
    for r, c in cells:
        b[idx(r, c)] = val
    return b


def test_ratios():
    assert S["THREE_OPEN"] == 0.8 * S["FOUR_HALF"]
    assert S["TWO_OPEN"] == 1.2 * S["THREE_HALF"]
    assert S["ONE_OPEN"] > S["TWO_HALF"]
    assert S["ONE_OPEN"] < S["TWO_OPEN"] / 5
    assert S["TWO_HALF"] < S["THREE_HALF"] / 5


def test_open_four_single_count():
    s, fo4, fh4, t3 = _score_line(_line([5, 6, 7, 8]), "black")
    assert s == S["FOUR_OPEN"], f"open four must count once, got {s}"
    assert (fo4, fh4, t3) == (1, 0, 0)


def test_dead4_above_open3():
    dead4 = _score_line(["white"] + ["black"] * 4 + [None] * 10, "black")
    open3 = _score_line(_line([5, 6, 7]), "black")
    assert dead4[0] == S["FOUR_HALF"] and dead4[1] == 0 and dead4[2] == 1
    assert open3[0] == S["THREE_OPEN"] and open3[3] == 1
    assert dead4[0] > open3[0]


def test_live2_above_dead3():
    live2 = _score_line(_line([5, 6]), "black")
    dead3 = _score_line(["white"] + ["black"] * 3 + [None] * 11, "black")
    assert live2[0] == S["TWO_OPEN"]
    assert dead3[0] == S["THREE_HALF"] and dead3[3] == 0
    assert live2[0] > dead3[0]


def test_gap_threat_levels():
    # XXX_X (left capped by white): gap fill = five -> half-four threat, NOT five
    cells = [None] * 15
    cells[4] = "white"
    for i in (5, 6, 7, 9):
        cells[i] = "black"
    s, fo4, fh4, t3 = _score_line(cells, "black")
    assert S["FOUR_HALF"] <= s < S["FIVE"], f"got {s}"
    assert (fo4, fh4, t3) == (0, 1, 0)
    # XX_X with open outers: fill -> open four -> live-three level threat
    s, fo4, fh4, t3 = _score_line(_line([5, 6, 8]), "black")
    assert S["THREE_OPEN"] <= s < S["FOUR_OPEN"], f"got {s}"
    assert (fo4, fh4, t3) == (0, 0, 1)
    # XX_X with a blocked outer: fill -> half four -> dead-three level only
    cells = [None] * 15
    for i in (5, 6, 8):
        cells[i] = "black"
    cells[9] = "white"
    s, fo4, fh4, t3 = _score_line(cells, "black")
    assert S["THREE_HALF"] <= s < S["THREE_OPEN"], f"got {s}"
    assert (fo4, fh4, t3) == (0, 0, 0)
    # X_X: two separate live-ones, no gap bonus
    s, fo4, fh4, t3 = _score_line(_line([5, 7]), "black")
    assert abs(s - 2 * S["ONE_OPEN"]) < 1e-9
    assert (fo4, fh4, t3) == (0, 0, 0)


def test_true_live_three_room_rule():
    # edge run N0N1N2: dead three, not live (off-board counts as blocked)
    assert _score_line(_line([0, 1, 2]), "black")[0] == S["THREE_HALF"]
    # N1N2N3 with edge beyond N0 and opp at N5: even playing N0 gives no open four
    cells = [None] * 15
    for i in (1, 2, 3):
        cells[i] = "black"
    cells[5] = "white"
    assert _score_line(cells, "black")[0] < S["THREE_OPEN"]
    # O_XXX_O (one space then blocked, both sides): dead three
    cells = [None] * 15
    cells[3] = "white"
    for i in (5, 6, 7):
        cells[i] = "black"
    cells[9] = "white"
    assert _score_line(cells, "black")[0] < S["THREE_OPEN"]
    # OXXXO (blocked tight): fully dead
    cells = [None] * 15
    cells[4] = "white"
    for i in (5, 6, 7):
        cells[i] = "black"
    cells[8] = "white"
    assert _score_line(cells, "black")[0] < S["THREE_HALF"]


def test_live_two_room_rule():
    # _XX_ with one space then blocked on both sides: cannot reach a live three
    cells = [None] * 15
    cells[3] = "white"
    for i in (5, 6):
        cells[i] = "black"
    cells[8] = "white"
    assert _score_line(cells, "black")[0] < S["TWO_OPEN"]


def test_merged_gap_five_point():
    # XXX_XX: gap fill merges into six -> five-point, half-four level threat
    s, fo4, fh4, t3 = _score_line(_line([5, 6, 7, 9, 10]), "black")
    assert S["FOUR_HALF"] <= s < S["FIVE"], f"got {s}"
    assert (fo4, fh4, t3) == (0, 1, 1)


def test_stone_decomposition():
    # 单子 = 4 方向活1
    my, _, mf4, mh4, mt3, *_ = _board_state(_board([(7, 7)]), "black")
    assert abs(my - 4 * S["ONE_OPEN"]) < 1e-9 and mf4 + mh4 + mt3 == 0
    # 双子 = 活2 + 6 方向活1
    my, *_ = _board_state(_board([(7, 7), (7, 6)]), "black")
    assert abs(my - (S["TWO_OPEN"] + 6 * S["ONE_OPEN"])) < 1e-9
    # 双单子 = 8 方向活1（X_X 不再加 gap 分，gap 点由 delta policy 定价）
    my, *_ = _board_state(_board([(7, 7), (7, 5)]), "black")
    assert abs(my - 8 * S["ONE_OPEN"]) < 1e-9
    e1 = evaluate_board_v2(_board([(7, 7)]), "black")
    e2 = evaluate_board_v2(_board([(7, 7), (7, 6)]), "black")
    e3 = evaluate_board_v2(_board([(7, 7), (7, 5)]), "black")
    assert e2 > e3 > e1, f"双子={e2} 双单子={e3} 单子={e1}"


def test_defense_weight_direction():
    ahead = _defense_weight(500, 100, 0, 0)
    behind = _defense_weight(100, 500, 0, 0)
    assert ahead < 1.0 < behind, f"ahead={ahead} behind={behind}"
    calm = _defense_weight(100, 100, 0, 0)
    urgent = _defense_weight(100, 100, 0, 1)
    assert urgent > calm
    for w in (ahead, behind, calm, urgent):
        assert 0.75 <= w <= 1.35


def test_race_value():
    own_three = _board([(7, 6), (7, 7), (7, 8)])
    assert abs(evaluate_board_v2(own_three, "black") - RACE_THREE) < 1e-9
    opp_three = _board([(7, 6), (7, 7), (7, 8)], val="white")
    assert abs(evaluate_board_v2(opp_three, "black") - RACE_DEFEND) < 1e-9
    own_four = _board([(7, 6), (7, 7), (7, 8), (7, 9)])
    assert abs(evaluate_board_v2(own_four, "black") - RACE_FOUR) < 1e-9
    opp_open4 = _board([(7, 6), (7, 7), (7, 8), (7, 9)], val="white")
    assert abs(evaluate_board_v2(opp_open4, "black") - RACE_OPEN_LOSS) < 1e-9
    # 轮走方有活三时先转开四，即使对方也有活三（竞速我们先手）
    both = _board([(7, 6), (7, 7), (7, 8)])
    both[idx(9, 9)] = "white"
    both[idx(10, 10)] = "white"
    both[idx(11, 11)] = "white"
    assert abs(evaluate_board_v2(both, "black") - RACE_THREE) < 1e-9


def test_policy_sums_to_one_and_finds_five():
    b = [None] * 225
    for c in (7, 8, 9, 10):
        b[idx(7, c)] = "black"
    v, p = heuristic_v2_model(b, "black")
    assert abs(p.sum() - 1.0) < 1e-5
    assert v > 0
    best = int(p.argmax())
    assert best in (idx(7, 6), idx(7, 11)), f"should complete five, got {(best // 15, best % 15)}"


def test_policy_blocks_half_four():
    # white half four (7,6) blocked by black: single five-point (7,11) must be taken
    b = _board([(7, 7), (7, 8), (7, 9), (7, 10)], val="white")
    b[idx(7, 6)] = "black"
    _, p = heuristic_v2_model(b, "black")
    assert int(p.argmax()) == idx(7, 11), f"got {(int(p.argmax()) // 15, int(p.argmax()) % 15)}"


def test_empty_board_center():
    v, p = heuristic_v2_model([None] * 225, "black")
    assert v == 0.0
    assert abs(p.sum() - 1.0) < 1e-5
    assert int(p.argmax()) == idx(7, 7)


def test_engine_blocks_live_three_race():
    # regression (user game): black live three (7,5),(8,6),(9,7); white's
    # double-three point (5,6) loses the race - value must prefer blocking,
    # and both blocking ends must be available to the search (no fixed pick)
    b = _board([(6, 8), (7, 5), (7, 7), (8, 6), (9, 5), (9, 7)])
    for r, c in ((5, 8), (5, 9), (6, 7), (7, 8), (10, 4)):
        b[idx(r, c)] = "white"
    _, p = heuristic_v2_model(b, "white")
    block = p[idx(6, 4)] + p[idx(10, 8)]
    assert block > p[idx(5, 6)], f"block={block} jump={p[idx(5, 6)]}"
    m = get_best_move(b, "white", heuristic_v2_model, time_limit_ms=1000)
    assert m in (idx(6, 4), idx(10, 8)), f"got {(m // 15, m % 15)}"


def test_registry():
    assert "heuristic-v2" in REGISTRY
    b = [None] * 225
    b[idx(7, 7)] = "black"
    assert evaluate_board_v2(b, "black") > 0


if __name__ == "__main__":
    test_ratios()
    test_open_four_single_count()
    test_dead4_above_open3()
    test_live2_above_dead3()
    test_gap_threat_levels()
    test_true_live_three_room_rule()
    test_live_two_room_rule()
    test_merged_gap_five_point()
    test_stone_decomposition()
    test_defense_weight_direction()
    test_race_value()
    test_policy_sums_to_one_and_finds_five()
    test_policy_blocks_half_four()
    test_empty_board_center()
    test_engine_blocks_live_three_race()
    test_registry()
    print("all heuristic-v2 tests PASS")
