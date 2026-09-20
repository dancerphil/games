"""Independent ordinal data, exhaustive structure oracle, and board invariants."""

import itertools
import json
import math
from pathlib import Path
import random
import unittest
from functools import partial, update_wrapper

import numpy as np

from models import REGISTRY
from models.heuristic_v3 import (
    FEATURES, V3_SCORE, _LINES, _POS_LINES, _extract, _fork_points, after_move,
    board_state, evaluate_board_v3, heuristic_v3_model, line_features,
    score_features, score_line, static_score,
)
from tactics import winning_points

DATA = json.loads(Path(__file__).with_name("heuristic_v3_cases.json").read_text())


def cells(text):
    return [{"X": "black", "O": "white", "_": None}[c] for c in text]


def board(spec):
    result = [None] * 225
    for char, positions in spec.items():
        for r, c in positions:
            assert result[r * 15 + c] is None
            result[r * 15 + c] = "black" if char == "X" else "white"
    return result


def compare(case, left, right):
    if case.get("relation", ">") == "=":
        assert math.isclose(left, right, abs_tol=1e-9), case["id"]
    else:
        assert left - right >= case["margin"] - 1e-9, (case["id"], left, right)


def test_line_dataset(case, reverse, player):
    def score(text):
        if reverse:
            text = text[::-1]
        if player == "white":
            text = text.translate(str.maketrans("XO", "OX"))
        return score_line(cells(text), player)
    compare(case, score(case["lhs"]), score(case["rhs"]))


def transform(b, rotation, reflect):
    out = [None] * 225
    for p, value in enumerate(b):
        r, c = divmod(p, 15)
        if reflect:
            c = 14 - c
        for _ in range(rotation):
            r, c = c, 14 - r
        out[r * 15 + c] = value
    return out


def test_board_dataset(case, rotation, reflect):
    left = transform(board(case["lhs"]), rotation, reflect)
    right = transform(board(case["rhs"]), rotation, reflect)
    compare(case, static_score(left, "black"), static_score(right, "black"))


def test_policy_dataset(case, rotation, reflect):
    b = transform(board(case["board"]), rotation, reflect)
    original = b.copy()
    value, policy = heuristic_v3_model(b, "black")
    best = transform([int([p // 15, p % 15] in case["best"]) for p in range(225)], rotation, reflect)
    worse = transform([int([p // 15, p % 15] in case["worse"]) for p in range(225)], rotation, reflect)
    best_mass = policy[np.array(best, dtype=bool)].sum()
    worse_mass = policy[np.array(worse, dtype=bool)].sum()
    assert best_mass > worse_mass, (case["id"], best_mass, worse_mass)
    if case["forced"]:
        assert math.isclose(float(best_mass), 1.0, abs_tol=1e-6)
    assert -1 <= value <= 1
    assert math.isclose(float(policy.sum()), 1.0, abs_tol=1e-6)
    assert np.all(policy >= 0)
    assert all(policy[p] == 0 for p, c in enumerate(b) if c is not None)
    assert b == original


def oracle_wins(text):
    """Direct string trial moves; no production window/extension helpers."""
    result = set()
    for p, char in enumerate(text):
        if char != "_":
            continue
        trial = text[:p] + "X" + text[p + 1:]
        left = p
        right = p
        while left > 0 and trial[left - 1] == "X":
            left -= 1
        while right + 1 < len(text) and trial[right + 1] == "X":
            right += 1
        if right - left + 1 >= 5:
            result.add(p)
    return result


def oracle_open(text, count):
    if count == 4:
        return len(oracle_wins(text)) >= 2
    return any(oracle_open(text[:p] + "X" + text[p + 1:], count + 1)
               for p, c in enumerate(text) if c == "_")


def test_exhaustive_structure(length):
    for chars in itertools.product("_XO", repeat=length):
        text = "".join(chars)
        result = _extract(text)
        assert result.five == ("XXXXX" in text), text
        assert set(result.wins) == oracle_wins(text), text
        assert result.features == _extract(text[::-1]).features, text
        viable = any("O" not in text[i:i + 5] and "X" in text[i:i + 5]
                     for i in range(length - 4))
        if not viable:
            assert not any(result.features), text
        # A single candidate of 2/3 stones: independently validate true-open.
        count = text.count("X")
        positions = [i for i, c in enumerate(text) if c == "X"]
        if count in (2, 3) and positions[-1] - positions[0] < 5 and any(
            "O" not in text[i:i + 5] and text[i:i + 5].count("X") == count
            for i in range(length - 4)
        ):
            prefix = "TWO" if count == 2 else "THREE"
            predicted = any(v for name, v in zip(FEATURES, result.features)
                            if name.startswith(prefix) and name.endswith("OPEN"))
            assert predicted == oracle_open(text, count), text


def test_line_geometry():
    assert len(_LINES) == 72
    assert len(set(_LINES)) == 72
    assert all(len(line) >= 5 for line in _LINES)
    for p in range(225):
        assert set(_POS_LINES[p]) == {i for i, line in enumerate(_LINES) if p in line}
        assert len(_POS_LINES[p]) <= 4


def test_dominant_shape_counted_once(text, kind):
    result = _extract(text)
    assert score_features(result.features) == V3_SCORE[kind]
    assert sum(result.features) == 1
    assert result.features[FEATURES.index(kind)] == 1


def test_shared_winning_point_is_not_double_threat():
    b = board({"O": [[7,3],[7,4],[7,5],[7,6],[3,7],[4,7],[5,7],[6,7]],
               "X": [[7,2],[2,7]]})
    state = board_state(b, "black")
    assert state.winning_points(1) == {7 * 15 + 7}
    assert evaluate_board_v3(b, "black") > -0.99
    assert heuristic_v3_model(b, "black")[1][7 * 15 + 7] == 1
    b[3 * 15 + 7] = None
    b[3 * 15 + 8] = b[4 * 15 + 8] = b[5 * 15 + 8] = b[6 * 15 + 8] = "white"
    b[2 * 15 + 8] = "black"
    assert len(board_state(b, "black").winning_points(1)) == 2
    assert evaluate_board_v3(b, "black") == -0.99


def test_terminal_tempo_and_counter_four():
    b = board({"X": [[7,4],[7,5],[7,6],[7,7]], "O": [[3,4],[3,5],[3,6],[3,7]]})
    assert evaluate_board_v3(b, "black", "black") == 0.99
    assert evaluate_board_v3(b, "black", "white") == -0.99
    b[7 * 15 + 8] = "black"
    assert evaluate_board_v3(b, "black", "white") == 1
    assert evaluate_board_v3(b, "white") == -1
    assert heuristic_v3_model(b, "black")[1].sum() == 0
    b[7 * 15 + 9] = "black"
    assert evaluate_board_v3(b, "black") == 1  # overline
    # Blocking white's four at (7,7) creates black's open four vertically.
    b = board({"O": [[7,3],[7,4],[7,5],[7,6]],
               "X": [[7,2],[4,7],[5,7],[6,7]]})
    assert evaluate_board_v3(b, "black") == 0.99
    assert heuristic_v3_model(b, "black")[1][112] == 1


def test_value_keeps_nonterminal_order():
    a = board({"X": [[7,6],[7,7],[7,8]]})
    b = a.copy()
    b[4 * 15 + 5] = "black"
    assert 0 < evaluate_board_v3(a, "black") < evaluate_board_v3(b, "black") < 0.99


def test_forks_against_full_board_trial_oracle():
    positions = [
        {"X": [[7,6],[7,7],[7,8]]},
        {"X": [[7,4],[7,5],[7,6],[4,7],[5,7],[6,7]], "O": [[7,3],[3,7]]},
        {"X": [[7,4],[7,5],[7,6]], "O": [[4,8],[5,8],[6,8]]},
    ]
    for spec in positions:
        b = board(spec)
        state = board_state(b, "black")
        for side, player, opp in ((0, "black", "white"), (1, "white", "black")):
            expected = set()
            for p, cell in enumerate(b):
                if cell is not None:
                    continue
                trial = b.copy()
                trial[p] = player
                if len(winning_points(trial, player)) >= 2 and not winning_points(trial, opp):
                    expected.add(p)
            assert _fork_points(b, state, side) == expected
    crossed = board(positions[1])
    assert 112 in _fork_points(crossed, board_state(crossed, "black"), 0)


def test_incremental_and_color_invariants():
    rng = random.Random(731)
    for occupied in (0, 1, 8, 25, 60, 120):
        b = [None] * 225
        for i, pos in enumerate(rng.sample(range(225), occupied)):
            b[pos] = "black" if i % 2 else "white"
        snapshot = b.copy()
        state = board_state(b, "black")
        assert math.isclose(static_score(b, "black"), -static_score(b, "white"), abs_tol=1e-9)
        swapped = [None if c is None else "white" if c == "black" else "black" for c in b]
        assert math.isclose(evaluate_board_v3(b, "black"), evaluate_board_v3(swapped, "white"), abs_tol=1e-9)
        for pos in rng.sample([p for p, c in enumerate(b) if c is None], 8):
            for player in ("black", "white"):
                inc = after_move(b, state, pos, player)
                trial = b.copy()
                trial[pos] = player
                full = board_state(trial, "black")
                np.testing.assert_allclose(inc.features, full.features, atol=1e-12)
                assert inc.lines == full.lines
                assert inc.winning_points(0) == full.winning_points(0)
                assert inc.winning_points(1) == full.winning_points(1)
        assert b == snapshot


def test_policy_equivariance():
    b = board({"X": [[7,6],[7,8],[5,7]], "O": [[6,5],[6,6],[8,8]]})
    value, policy = heuristic_v3_model(b, "black")
    for rotation, reflect in itertools.product(range(4), [False, True]):
        v, p = heuristic_v3_model(transform(b, rotation, reflect), "black")
        assert math.isclose(v, value, abs_tol=1e-9)
        np.testing.assert_allclose(p, transform(policy, rotation, reflect), atol=1e-7)
    swapped = [None if c is None else "white" if c == "black" else "black" for c in b]
    v, p = heuristic_v3_model(swapped, "white")
    assert math.isclose(v, value, abs_tol=1e-9)
    np.testing.assert_allclose(p, policy)


def test_empty_and_full_board():
    value, policy = REGISTRY["heuristic-v3"]([None] * 225, "black")
    assert value == 0 and policy[112] == 1 and policy.sum() == 1
    # Alternating two-column stripes contain no five in any direction.
    full = ["black" if (r + c // 2) % 2 else "white" for r in range(15) for c in range(15)]
    assert not board_state(full, "black").five(0)
    assert not board_state(full, "black").five(1)
    value, policy = heuristic_v3_model(full, "black")
    assert value == 0 and policy.sum() == 0
    assert evaluate_board_v3(full, "black") == 0


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()

    def add(fn, *args):
        description = fn.__name__ + " " + str(args)
        suite.addTest(unittest.FunctionTestCase(update_wrapper(partial(fn, *args), fn), description=description))

    for case, reverse, player in itertools.product(DATA["line"], [False, True], ["black", "white"]):
        add(test_line_dataset, case, reverse, player)
    for key, fn in (("board", test_board_dataset), ("policy", test_policy_dataset)):
        for case, rotation, reflect in itertools.product(DATA[key], range(4), [False, True]):
            add(fn, case, rotation, reflect)
    for length in range(5, 10):
        add(test_exhaustive_structure, length)
    for text, kind in (
        ("_XXXX_", "FOUR_OPEN"), ("OXXXX_", "FOUR_HALF"),
        ("__XXX_X__", "FOUR_GAP31"), ("__XX_XX__", "FOUR_GAP22"),
        ("__XXX__", "THREE_OPEN"), ("_XX_X_", "THREE_GAP_OPEN"),
        ("OXXX__", "THREE_HALF"), ("OXX_X_", "THREE_GAP_HALF"),
    ):
        add(test_dominant_shape_counted_once, text, kind)
    for fn in (test_line_geometry, test_shared_winning_point_is_not_double_threat,
               test_terminal_tempo_and_counter_four, test_value_keeps_nonterminal_order,
               test_forks_against_full_board_trial_oracle,
               test_incremental_and_color_invariants, test_policy_equivariance,
               test_empty_and_full_board):
        add(fn)
    return suite


if __name__ == "__main__":
    unittest.main()
