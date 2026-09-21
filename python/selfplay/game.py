import random
import time

from .config import BOARD_SIZE


def play_one(task):
    """单个对局，跑在子进程中。"""
    from ..mcts import check_win_at, get_best_move_with_stats
    from ..models import REGISTRY, make_model

    black_model = task["black_model"]
    white_model = task["white_model"]
    time_limit_ms = task["time_limit_ms"]
    sample_moves = task.get("sample_moves", 0)
    if "seed" in task:
        random.seed(task["seed"])
    board = [None] * (BOARD_SIZE * BOARD_SIZE)
    moves = list(task.get("opening", []))
    policies = [None] * len(moves)  # 固定前缀没有搜索标签，不伪造训练目标。
    for ply, pos in enumerate(moves):
        if not 0 <= pos < len(board) or board[pos] is not None:
            raise ValueError(f"invalid opening move: {pos}")
        board[pos] = "black" if ply % 2 == 0 else "white"
        if check_win_at(board, pos, board[pos]):
            raise ValueError("opening is already terminal")
    winner = "draw"
    current = "black" if len(moves) % 2 == 0 else "white"
    specs = task.get("model_specs", {})
    fns = {color: make_model(specs[name]) if name in specs else REGISTRY[name]
           for color, name in (("black", black_model), ("white", white_model))}
    if task.get("warmup"):
        for fn in fns.values():
            fn(board, current)
    started = time.monotonic()

    for _ in range(len(moves), BOARD_SIZE * BOARD_SIZE):
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
