from mcts import get_best_move, idx
from models.heuristic import evaluate_board

def test_block(desc, stones, player, expected):
    board = [None] * 225
    for r, c in stones:
        board[idx(r, c)] = "black"
    pos = get_best_move(board, player, evaluate_board, time_limit_ms=2000)
    rc = (pos // 15, pos % 15)
    assert rc in expected, f"{desc}: got {rc} expected {expected}"

def test_live_three():
    test_block("horiz_three", [(7,7),(7,8),(7,9)], "white", [(7,6),(7,10)])
    test_block("vert_three", [(7,7),(8,7),(9,7)], "white", [(6,7),(10,7)])

def test_live_four():
    test_block("horiz_four", [(7,7),(7,8),(7,9),(7,10)], "white", [(7,6),(7,11)])
    test_block("vert_four", [(7,7),(8,7),(9,7),(10,7)], "white", [(6,7),(11,7)])
    test_block("diag_four", [(7,7),(8,8),(9,9),(10,10)], "white", [(6,6),(11,11)])
    test_block("anti_four", [(7,7),(6,8),(5,9),(4,10)], "white", [(8,6),(3,11)])
    test_block("gap_xxx_x", [(7,7),(7,8),(7,9),(7,11)], "white", [(7,10)])
    test_block("gap_x_xxx", [(7,7),(7,9),(7,10),(7,11)], "white", [(7,8)])

if __name__ == "__main__":
    test_live_three()
    test_live_four()
    print("all block tests PASS")
