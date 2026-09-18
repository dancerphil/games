"""All-model shared early-return layer for gomoku.

Order:
1. self immediate five -> play it
2. opp must-block (any 4-threat: 4 / 31 / 22 covered via simulation) -> block it
3. forced-win deep search (my moves <= 3): m1 forces o1 forces ... ends in
   proven win (direct five or double threat). Option A: abort branch as soon
   as opp's block creates a counter-threat I must answer.
4. otherwise -> None (fall back to model/MCTS)

Tie-break among multiple winning moves: random.choice.
"""

import random

BOARD_SIZE = 15


def idx(r, c):
    return r * BOARD_SIZE + c


def in_bounds(r, c):
    return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE


def other(player):
    return "white" if player == "black" else "black"


def check_win_at(board, pos, player):
    r, c = divmod(pos, BOARD_SIZE)
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        count = 1
        for s in range(1, 5):
            nr, nc = r + dr * s, c + dc * s
            if not in_bounds(nr, nc) or board[idx(nr, nc)] != player:
                break
            count += 1
        for s in range(1, 5):
            nr, nc = r - dr * s, c - dc * s
            if not in_bounds(nr, nc) or board[idx(nr, nc)] != player:
                break
            count += 1
        if count >= 5:
            return True
    return False


def _threat_empties(board, player):
    """Empty cells 8-adjacent to player's stones.

    A winning point (empty completing five) is always line-adjacent to a
    stone of that player, so scanning this set is sufficient and cheap.
    """
    out = set()
    for i, v in enumerate(board):
        if v != player:
            continue
        r, c = divmod(i, BOARD_SIZE)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                p = idx(nr, nc)
                if board[p] is None:
                    out.add(p)
    return out


def winning_points(board, player):
    """All empty pos where `player` plays and gets five immediately."""
    pts = []
    for p in _threat_empties(board, player):
        board[p] = player
        win = check_win_at(board, p, player)
        board[p] = None
        if win:
            pts.append(p)
    return pts


def _candidates(board):
    occupied = [i for i, v in enumerate(board) if v is not None]
    s = set()
    for pos in occupied:
        r, c = divmod(pos, BOARD_SIZE)
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                p = idx(nr, nc)
                if board[p] is None:
                    s.add(p)
    scored = []
    for p in s:
        r, c = divmod(p, BOARD_SIZE)
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
    n = 20 if len(occupied) < 10 else 24
    return [p for p, _ in scored[:n]]


def _candidates_around(board, anchors, radius=2):
    s = set()
    for pos in anchors:
        r, c = divmod(pos, BOARD_SIZE)
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                nr, nc = r + dr, c + dc
                if not in_bounds(nr, nc):
                    continue
                p = idx(nr, nc)
                if board[p] is None:
                    s.add(p)
    return list(s)


def _can_force(board, player, opp, depth, anchors):
    """True if current side-to-move `player` forces a proven win within depth."""
    cands = _candidates_around(board, anchors) if anchors else _candidates(board)
    for m in cands:
        board[m] = player
        if check_win_at(board, m, player):
            board[m] = None
            return True
        threats = winning_points(board, player)
        if not threats:
            board[m] = None
            continue
        if len(threats) >= 2:
            if not winning_points(board, opp):
                board[m] = None
                return True
            board[m] = None
            continue
        # single threat: needs deeper search
        if depth <= 1:
            board[m] = None
            continue
        if winning_points(board, opp):
            board[m] = None
            continue
        o = threats[0]
        board[o] = opp
        if winning_points(board, opp):
            # option A: opp block carries a counter-threat -> branch dead
            board[o] = None
            board[m] = None
            continue
        nxt_anchors = [m, o, *threats]
        ok = _can_force(board, player, opp, depth - 1, nxt_anchors)
        board[o] = None
        board[m] = None
        if ok:
            return True
    return False


def find_forcing_win(board, player):
    """All my first-moves leading to forced win within 3 of my moves; random pick."""
    opp = other(player)
    winners = []
    for m1 in _candidates(board):
        board[m1] = player
        if check_win_at(board, m1, player):
            board[m1] = None
            winners.append(m1)
            continue
        threats = winning_points(board, player)
        if not threats:
            board[m1] = None
            continue
        if len(threats) >= 2:
            if not winning_points(board, opp):
                winners.append(m1)
            board[m1] = None
            continue
        if winning_points(board, opp):
            board[m1] = None
            continue
        o1 = threats[0]
        board[o1] = opp
        if winning_points(board, opp):
            board[o1] = None
            board[m1] = None
            continue
        if _can_force(board, player, opp, 2, [m1, o1, *threats]):
            winners.append(m1)
        board[o1] = None
        board[m1] = None
    if not winners:
        return None
    return random.choice(winners)


def find_tactical_move(board, player):
    """Shared early-return for all models. None -> fall back to model."""
    # 1. self immediate five
    wins = winning_points(board, player)
    if wins:
        return random.choice(wins)
    # 2. opp must-block (covers 4 / 31 / 22 via simulation)
    opp = other(player)
    blocks = winning_points(board, opp)
    if blocks:
        return random.choice(blocks)
    # 3. forced win within 3 of my moves
    forcing = find_forcing_win(board, player)
    if forcing is not None:
        return forcing
    # 4. fall back to model
    return None
