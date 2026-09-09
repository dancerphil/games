"""heuristic-v1: frozen legacy evaluator (sliding 5-window, fixed weights).

Do NOT modify scoring logic here; evolve in heuristic_v2.py instead.
Kept self-contained (no imports from heuristic.py) to avoid cycles.
"""
import math
import numpy as np

BOARD_SIZE = 15

PATTERN_SCORE = {
    "FIVE": 100000,
    "FOUR_OPEN": 10000,
    "FOUR_HALF": 1000,
    "THREE_OPEN": 500,
    "THREE_HALF": 100,
    "TWO_OPEN": 20,
    "TWO_HALF": 5,
}


def _evaluate_line(cells, player):
    opp = "white" if player == "black" else "black"
    score = 0
    n = len(cells)
    for i in range(n - 4):
        window = cells[i:i + 5]
        if opp in window:
            continue
        count = sum(1 for c in window if c == player)
        if count == 0:
            continue
        left_blocked = i == 0 or cells[i - 1] == opp
        right_blocked = i + 5 == n or cells[i + 5] == opp
        empties = 5 - count
        if count == 5:
            score += PATTERN_SCORE["FIVE"]
        elif count == 4 and empties == 1:
            if not left_blocked and not right_blocked:
                score += PATTERN_SCORE["FOUR_OPEN"]
            elif not left_blocked or not right_blocked:
                score += PATTERN_SCORE["FOUR_HALF"]
            else:
                score += 50
        elif count == 3 and empties == 2:
            if not left_blocked and not right_blocked:
                score += PATTERN_SCORE["THREE_OPEN"]
            elif not left_blocked or not right_blocked:
                score += PATTERN_SCORE["THREE_HALF"]
            else:
                score += 10
        elif count == 2 and empties == 3:
            if not left_blocked and not right_blocked:
                score += PATTERN_SCORE["TWO_OPEN"]
            elif not left_blocked or not right_blocked:
                score += PATTERN_SCORE["TWO_HALF"]
    return score


def evaluate_board(board, player):
    opp = "white" if player == "black" else "black"
    my = 0
    op = 0

    def idx(r, c):
        return r * BOARD_SIZE + c

    for r in range(BOARD_SIZE):
        row = [board[idx(r, c)] for c in range(BOARD_SIZE)]
        my += _evaluate_line(row, player)
        op += _evaluate_line(row, opp)

    for c in range(BOARD_SIZE):
        col = [board[idx(r, c)] for r in range(BOARD_SIZE)]
        my += _evaluate_line(col, player)
        op += _evaluate_line(col, opp)

    for k in range(-(BOARD_SIZE - 1), BOARD_SIZE):
        diag = []
        for r in range(BOARD_SIZE):
            c = r + k
            if 0 <= c < BOARD_SIZE:
                diag.append(board[idx(r, c)])
        if len(diag) >= 5:
            my += _evaluate_line(diag, player)
            op += _evaluate_line(diag, opp)

    for k in range(BOARD_SIZE * 2 - 1):
        diag = []
        for r in range(BOARD_SIZE):
            c = k - r
            if 0 <= c < BOARD_SIZE:
                diag.append(board[idx(r, c)])
        if len(diag) >= 5:
            my += _evaluate_line(diag, player)
            op += _evaluate_line(diag, opp)

    central = 0
    for i, v in enumerate(board):
        if v is None:
            continue
        r = i // BOARD_SIZE
        c = i % BOARD_SIZE
        dist = abs(r - 7) + abs(c - 7)
        bonus = max(0, 7 - dist) * 0.5
        if v == player:
            central += bonus
        elif v == opp:
            central -= bonus

    return my - op * 1.1 + central


def _get_candidates_for_policy(board):
    # duplicated from mcts to avoid circular import; keep in sync
    def idx(r, c):
        return r * BOARD_SIZE + c

    def in_bounds(r, c):
        return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE

    occupied = [i for i, v in enumerate(board) if v is not None]
    if not occupied:
        return [idx(7, 7)]
    if len(occupied) == 1:
        r = occupied[0] // BOARD_SIZE
        c = occupied[0] % BOARD_SIZE
        cand = []
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if in_bounds(nr, nc) and board[idx(nr, nc)] is None:
                    cand.append(idx(nr, nc))
        return cand if cand else [idx(7, 7)]
    s = set()
    dist = 2
    for pos in occupied:
        r = pos // BOARD_SIZE
        c = pos % BOARD_SIZE
        for dr in range(-dist, dist + 1):
            for dc in range(-dist, dist + 1):
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                p = idx(nr, nc)
                if board[p] is None:
                    s.add(p)
    cands = list(s)
    scored = []
    for p in cands:
        r = p // BOARD_SIZE
        c = p % BOARD_SIZE
        neighbor = 0
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                if board[idx(nr, nc)] is not None:
                    neighbor += 1 / (abs(dr) + abs(dc) or 1)
        scored.append((p, neighbor))
    scored.sort(key=lambda x: -x[1])
    n = 12 if len(occupied) < 10 else 16
    return [p for p, _ in scored[:n]]


def heuristic_model(board, player):
    raw = evaluate_board(board, player)
    value = math.tanh(raw / 4000.0)
    policy = np.zeros(BOARD_SIZE * BOARD_SIZE, dtype=np.float32)
    cands = _get_candidates_for_policy(board)
    if not cands:
        return float(value), policy
    scores = []
    for pos in cands:
        board[pos] = player
        s = evaluate_board(board, player)
        board[pos] = None
        scores.append(s)
    # softmax with temperature
    max_s = max(scores)
    exps = [math.exp((s - max_s) / 600.0) for s in scores]
    sum_e = sum(exps)
    for pos, e in zip(cands, exps):
        policy[pos] = e / sum_e
    return float(value), policy
