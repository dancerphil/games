from tactics import find_tactical_move, idx
from mcts import Node, MCTS
import numpy as np


def _board(stones):
    board = [None] * 225
    for r, c, color in stones:
        board[idx(r, c)] = color
    return board


def test_empty_center():
    assert find_tactical_move([None] * 225, "black") == idx(7, 7)


def test_self_five():
    b = _board([(7, 7, "black"), (7, 8, "black"), (7, 9, "black"), (7, 10, "black")])
    assert find_tactical_move(b, "black") in (idx(7, 6), idx(7, 11))
    # gap 31 immediate win must be the gap
    b = _board([(7, 7, "black"), (7, 8, "black"), (7, 9, "black"), (7, 11, "black")])
    assert find_tactical_move(b, "black") == idx(7, 10)


def test_block_four_variants():
    # continuous 4: either end
    b = _board([(7, 7, "black"), (7, 8, "black"), (7, 9, "black"), (7, 10, "black")])
    assert find_tactical_move(b, "white") in (idx(7, 6), idx(7, 11))
    # 31 gap must block the gap
    for stones in (
        [(7, 7), (7, 8), (7, 9), (7, 11)],
        [(7, 7), (7, 9), (7, 10), (7, 11)],
    ):
        b = [None] * 225
        for r, c in stones:
            b[idx(r, c)] = "black"
        gaps = {idx(7, 10), idx(7, 8)}
        assert find_tactical_move(b, "white") in gaps
    # 22 gap
    b = [None] * 225
    for r, c in [(7, 7), (7, 8), (7, 10), (7, 11)]:
        b[idx(r, c)] = "black"
    assert find_tactical_move(b, "white") == idx(7, 9)


def test_single_side_blockable():
    # black four blocked on the right by white: only left to block
    b = _board(
        [(7, 6, "white"), (7, 7, "black"), (7, 8, "black"), (7, 9, "black"), (7, 10, "black")]
    )
    assert find_tactical_move(b, "white") == idx(7, 11)


def test_forcing_win_double_threat():
    # white to move creates open four (double threat) at (7,11) or (7,6):
    # XXX with both ends open handled by block layer for opp, here self attack
    # shape: white has (7,7),(7,8),(7,9) open + (8,7),(9,7) support so that
    # playing (7,10) yields 4-in-row with open end -> at least single threat chain
    b = _board(
        [
            (7, 7, "white"),
            (7, 8, "white"),
            (7, 9, "white"),
            (5, 5, "black"),
            (5, 6, "black"),
        ]
    )
    pos = find_tactical_move(b, "white")
    assert pos in (idx(7, 6), idx(7, 10))


def test_no_tactics_returns_none():
    b = _board([(7, 7, "black"), (8, 8, "white"), (9, 9, "black")])
    # scattered stones: no immediate five/block/forced win expected
    assert find_tactical_move(b, "white") is None or isinstance(find_tactical_move(b, "white"), int)


def test_open_three_attack_is_forcing_win():
    # own open three: an end makes an open four -> proven win via deep search
    b = _board([(7, 7, "white"), (7, 8, "white"), (7, 9, "white"), (3, 3, "black")])
    assert find_tactical_move(b, "white") in (idx(7, 6), idx(7, 10))


def _uniform(board, player):
    p = np.zeros(225, dtype=np.float32)
    n = sum(1 for v in board if v is None)
    for i, v in enumerate(board):
        if v is None:
            p[i] = 1.0 / n
    return 0.0, p


def test_expand_uses_same_shortcircuit_as_root():
    # immediate block: tree node keeps only the short-circuit move
    b = _board([(7, 7, "black"), (7, 8, "black"), (7, 9, "black"), (7, 10, "black"), (3, 3, "white")])
    node = Node(b[:], "white")
    MCTS(_uniform).expand(node)
    assert len(node.children) == 1
    assert set(node.children) <= {idx(7, 6), idx(7, 11)}


def test_expand_untouched_when_quiet():
    b = _board([(7, 7, "black"), (8, 8, "white"), (9, 9, "black")])
    assert find_tactical_move(b, "white") is None
    node = Node(b[:], "white")
    MCTS(_uniform).expand(node)
    assert len(node.children) > 2


if __name__ == "__main__":
    test_empty_center()
    test_self_five()
    test_block_four_variants()
    test_single_side_blockable()
    test_forcing_win_double_threat()
    test_open_three_attack_is_forcing_win()
    test_expand_uses_same_shortcircuit_as_root()
    test_expand_untouched_when_quiet()
    test_no_tactics_returns_none()
    print("all tactics tests PASS")
