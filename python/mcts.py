import math
import random
import time

BOARD_SIZE = 15


def idx(r, c):
    return r * BOARD_SIZE + c


def in_bounds(r, c):
    return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE


def check_win_at(board, pos, player):
    r = pos // BOARD_SIZE
    c = pos % BOARD_SIZE
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        count = 1
        for s in range(1, 5):
            nr = r + dr * s
            nc = c + dc * s
            if not in_bounds(nr, nc) or board[idx(nr, nc)] != player:
                break
            count += 1
        for s in range(1, 5):
            nr = r - dr * s
            nc = c - dc * s
            if not in_bounds(nr, nc) or board[idx(nr, nc)] != player:
                break
            count += 1
        if count >= 5:
            return True
    return False


def get_candidates(board):
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


def monte_carlo_score(board, ai_player, evaluate_board, simulations=30):
    opp = "white" if ai_player == "black" else "black"
    wins = 0
    losses = 0
    for s in range(simulations):
        b = board[:]
        cur = opp if s % 2 == 0 else ai_player
        steps = 0
        max_steps = 12
        ended = False
        while steps < max_steps:
            cands = get_candidates(b)
            if not cands:
                break
            pick = random.choice(cands)
            b[pick] = cur
            if check_win_at(b, pick, cur):
                if cur == ai_player:
                    wins += 1
                else:
                    losses += 1
                ended = True
                break
            cur = "white" if cur == "black" else "black"
            steps += 1
        if not ended:
            ev = evaluate_board(b, ai_player)
            if ev > 500:
                wins += 0.5
            elif ev < -500:
                losses += 0.5
    return ((wins - losses) / simulations) * 1000


class Timeout(Exception):
    pass


def minimax(board, depth, alpha, beta, maximizing, ai_player, evaluate_board, deadline=None):
    if deadline is not None and time.monotonic() >= deadline:
        raise Timeout()
    for i, v in enumerate(board):
        if v and check_win_at(board, i, v):
            return 100000 - (3 - depth) * 1000 if v == ai_player else -100000 + (3 - depth) * 1000
    if all(c is not None for c in board):
        return 0
    if depth == 0:
        static_eval = evaluate_board(board, ai_player)
        mc = monte_carlo_score(board, ai_player, evaluate_board, 12)
        return static_eval * 0.7 + mc * 0.3

    cands = get_candidates(board)
    if not cands:
        return evaluate_board(board, ai_player)

    opp = "white" if ai_player == "black" else "black"
    ordered = []
    for p in cands:
        board[p] = ai_player if maximizing else opp
        s = evaluate_board(board, ai_player)
        board[p] = None
        ordered.append((p, s))
    ordered.sort(key=lambda x: -x[1] if maximizing else x[1])
    sorted_cands = [p for p, _ in ordered]

    if maximizing:
        best = -math.inf
        a = alpha
        for cand in sorted_cands:
            board[cand] = ai_player
            score = minimax(board, depth - 1, a, beta, False, ai_player, evaluate_board, deadline)
            board[cand] = None
            if score > best:
                best = score
            if best > a:
                a = best
            if beta <= a:
                break
        return best
    else:
        best = math.inf
        b = beta
        for cand in sorted_cands:
            board[cand] = opp
            score = minimax(board, depth - 1, alpha, b, True, ai_player, evaluate_board, deadline)
            board[cand] = None
            if score < best:
                best = score
            if best < b:
                b = best
            if b <= alpha:
                break
        return best


def get_best_move(board, ai_player, evaluate_board, time_limit_ms=500):
    # 1) immediate win / block - same as TS
    cands_all = get_candidates(board)

    for p in cands_all:
        board[p] = ai_player
        if check_win_at(board, p, ai_player):
            board[p] = None
            return p
        board[p] = None

    opp = "white" if ai_player == "black" else "black"
    for p in cands_all:
        board[p] = opp
        if check_win_at(board, p, opp):
            board[p] = None
            return p
        board[p] = None

    occupied_count = sum(1 for c in board if c is not None)
    if occupied_count == 0:
        return idx(7, 7)
    if occupied_count == 1 and board[idx(7, 7)] is None:
        return idx(7, 7)

    deadline = time.monotonic() + time_limit_ms / 1000.0

    # root ordering
    root_ordered = []
    for p in cands_all:
        board[p] = ai_player
        s = evaluate_board(board, ai_player)
        board[p] = None
        root_ordered.append((p, s))
    root_ordered.sort(key=lambda x: -x[1])

    # iterative deepening under time budget
    # depth schedule matches TS: early game depth 3, else 2; we iterate deeper until deadline
    base_depth = 3 if occupied_count < 4 else 2
    best_pos = root_ordered[0][0]
    best_score = -math.inf

    for depth in range(base_depth, base_depth + 6):
        if time.monotonic() >= deadline:
            break
        cur_best = best_pos
        cur_score = -math.inf
        completed = True
        for cand, _ in root_ordered:
            if time.monotonic() >= deadline:
                completed = False
                break
            board[cand] = ai_player
            try:
                score = minimax(board, depth - 1, -math.inf, math.inf, False, ai_player, evaluate_board, deadline)
            except Timeout:
                board[cand] = None
                completed = False
                break
            board[cand] = None
            if score > cur_score:
                cur_score = score
                cur_best = cand
        if completed:
            best_pos = cur_best
            best_score = cur_score
        else:
            break

    return best_pos
