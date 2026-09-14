import random
import time

from .config import BOARD_SIZE


def play_one(task):
    """单个对局，跑在子进程中。"""
    from ..mcts import check_win_at, get_best_move_with_stats
    from ..models import REGISTRY

    black_model = task["black_model"]
    white_model = task["white_model"]
    time_limit_ms = task["time_limit_ms"]
    sample_moves = task.get("sample_moves", 0)
    board = [None] * (BOARD_SIZE * BOARD_SIZE)
    moves = []
    policies = []
    winner = "draw"
    started = time.monotonic()
    current = "black"
    fns = {"black": REGISTRY[black_model], "white": REGISTRY[white_model]}

    for _ in range(BOARD_SIZE * BOARD_SIZE):
        pos, visits, tactical, root_q = get_best_move_with_stats(
            board, current, fns[current], time_limit_ms=time_limit_ms)
        if sample_moves and len(moves) < sample_moves and not tactical and len(visits) > 1:
            pos = random.choices(list(visits.keys()), weights=visits.values())[0]
        step = {"d": visits, "t": tactical}
        if not tactical:
            step["q"] = root_q
        policies.append(step)
        if board[pos] is not None:
            winner = "white" if current == "black" else "black"
            break
        board[pos] = current
        moves.append(pos)
        if check_win_at(board, pos, current):
            winner = current
            break
        current = "white" if current == "black" else "black"
    else:
        winner = "draw"

    return {
        "black_model": black_model,
        "white_model": white_model,
        "winner": winner,
        "moves": moves,
        "policies": policies,
        "num_moves": len(moves),
        "duration_ms": int((time.monotonic() - started) * 1000),
    }
