"""heuristic-v2: run-based evaluator with race-aware value and value-delta policy.

Differences vs v1 (frozen in heuristic_v1.py):
1. Run counting (no double-count): contiguous stones form one maximal run
   scored exactly once per line (v1 counted open-four twice via overlap).
2. True-open test via two-cell rooms (off-board counts as blocked): a run
   of 3 is a live three iff some extension yields an OPEN four, i.e.
   rooms (l>=2 and r>=1) or (l>=1 and r>=2). Thus edge runs (N0N1N2),
   single-space-then-blocked _XXX_ (O_XXX_O), and N1N2N3 with an opp
   stone one past the single gap are DEAD threes, not live. Same rule
   grades live twos (must be able to reach a live three). Patterns whose
   window can no longer reach five are discounted x0.3.
3. Single-gap patterns priced by the fill's forcing power: XXX_X (fill =
   five) is a four-level threat; XX_X is a live three iff the filled
   four would be open (both outer cells empty), else a dead three; X_X
   gets no gap bonus (two separate live-ones - the gap point is priced
   by the delta policy, not by static value).
4. Race adjudication in the value (player = side to move): own four-level
   threat (five-point) ~ win; opp open four (or double half four) ~ lost;
   opp half four / opp live three ~ forced block (tempo loss); own live
   three ~ converts to open four first. Flat race values replace the old
   combo bonus.
5. Score table scaled 10x down vs v1, with required ratios:
   THREE_OPEN = 0.8 x FOUR_HALF, TWO_OPEN = 1.2 x THREE_HALF,
   ONE_OPEN > TWO_HALF, both far below TWO_OPEN / THREE_HALF.
6. Dynamic defense weight: ahead -> attack (w<1), behind -> defend (w>1),
   urgent four/five races push w up. Smooth (tanh), clamped.
7. Policy = softmax over gain = -V_after(opp to move) - V_self: playing
   my 4->5 scores, killing opp's four/three scores. Every distance-2
   candidate is priced by rescanning only the 4 lines through it - no
   truncation; the priors alone steer the search.

Immediate 1-4 priorities (self five / block five / open four / block it)
stay in tactics.py short-circuit; this module shapes MCTS value/policy.
"""

import math

import numpy as np

BOARD_SIZE = 15

V2_SCORE = {
    "FIVE": 10000.0,
    "FOUR_OPEN": 1000.0,
    "FOUR_HALF": 100.0,
    "FOUR_DEAD": 5.0,
    "THREE_OPEN": 80.0,  # 0.8 x FOUR_HALF
    "THREE_HALF": 10.0,
    "THREE_DEAD": 1.0,
    "TWO_OPEN": 12.0,  # 1.2 x THREE_HALF
    "TWO_HALF": 1.0,
    "ONE_OPEN": 1.2,  # > TWO_HALF, << TWO_OPEN
    "ONE_HALF": 0.3,
}

ROOM_SHORT_FACTOR = 0.3
VALUE_SCALE = 400.0
POLICY_TEMP = 0.1  # gains are tanh-scale value deltas
CENTRAL_STEP = 0.05

RACE_FOUR = 0.95        # own five-point: play it and win
RACE_OPEN_LOSS = -0.95  # opp open four (or double half four): unstoppable
RACE_HALF_LOSS = -0.4   # opp half four: forced block, tempo lost
RACE_THREE = 0.9        # own live three: converts to open four first
RACE_DEFEND = -0.3      # opp live three: forced block


def _other(player):
    return "white" if player == "black" else "black"


def _rooms(cells, start, end):
    """Consecutive empty cells just outside [start, end); off-board = 0."""
    n = len(cells)
    l = 0
    k = start - 1
    while k >= 0 and cells[k] is None:
        l += 1
        k -= 1
    r = 0
    k = end
    while k < n and cells[k] is None:
        r += 1
        k += 1
    return l, r


def _score_line(cells, player):
    """Score one line for `player`.

    Returns (score, open_fours, half_fours, live_threes); half_fours counts
    single five-points (gap shapes like XXX_X included), live_threes the
    room-test-passing open threats (contiguous or gap).
    """
    n = len(cells)
    S = V2_SCORE
    if player not in cells:
        return 0.0, 0, 0, 0
    score = 0.0
    fo4 = fh4 = t3 = 0
    i = 0
    while i < n:
        if cells[i] != player:
            i += 1
            continue
        j = i
        while j < n and cells[j] == player:
            j += 1
        length = j - i
        l, r = _rooms(cells, i, j)
        if length >= 5:
            base = S["FIVE"]
        elif length == 4:
            if l >= 1 and r >= 1:
                base = S["FOUR_OPEN"]
                fo4 += 1
            elif l >= 1 or r >= 1:
                base = S["FOUR_HALF"]
                fh4 += 1
            else:
                base = S["FOUR_DEAD"]
        elif length == 3:
            if (l >= 2 and r >= 1) or (l >= 1 and r >= 2):
                base = S["THREE_OPEN"]
                t3 += 1
            elif l >= 1 or r >= 1:
                base = S["THREE_HALF"]
            else:
                base = S["THREE_DEAD"]
        elif length == 2:
            if (l >= 3 and r >= 1) or (r >= 3 and l >= 1) or (l >= 2 and r >= 2):
                base = S["TWO_OPEN"]
            elif l >= 1 or r >= 1:
                base = S["TWO_HALF"]
            else:
                base = 0.0
        else:
            if l >= 1 and r >= 1:
                base = S["ONE_OPEN"]
            elif l >= 1 or r >= 1:
                base = S["ONE_HALF"]
            else:
                base = 0.0
        if base and length + l + r < 5:
            base *= ROOM_SHORT_FACTOR
        score += base
        i = j
    for e in range(n):
        if cells[e] is not None:
            continue
        left = 0
        k = e - 1
        while k >= 0 and cells[k] == player:
            left += 1
            k -= 1
        right = 0
        k = e + 1
        while k < n and cells[k] == player:
            right += 1
            k += 1
        if left == 0 or right == 0:
            continue
        total = left + right + 1
        gl, gr = _rooms(cells, e - left, e + right + 1)
        if total >= 5:
            base = S["FOUR_HALF"]
            fh4 += 1
        elif total == 4:
            if gl >= 1 and gr >= 1:
                base = S["THREE_OPEN"]
                t3 += 1
            else:
                base = S["THREE_HALF"]
        else:
            base = 0.0
        if base and total < 5 and total + gl + gr < 5:
            base *= ROOM_SHORT_FACTOR
        score += base
    return score, fo4, fh4, t3


def _build_line_tables():
    s = BOARD_SIZE
    lines = []
    pos_lines = [[] for _ in range(s * s)]

    def add(idxs):
        lid = len(lines)
        lines.append(tuple(idxs))
        for p in idxs:
            pos_lines[p].append(lid)

    for r in range(s):
        add([r * s + c for c in range(s)])
    for c in range(s):
        add([r * s + c for r in range(s)])
    for k in range(-(s - 1), s):
        idxs = [r * s + (r + k) for r in range(s) if 0 <= r + k < s]
        if len(idxs) >= 5:
            add(idxs)
    for k in range(s * 2 - 1):
        idxs = [r * s + (k - r) for r in range(s) if 0 <= k - r < s]
        if len(idxs) >= 5:
            add(idxs)
    return lines, tuple(tuple(x) for x in pos_lines)


_LINES, _POS_LINES = _build_line_tables()


def _board_state(board, player):
    """Global material/threat sums + per-line values for incremental deltas."""
    opp = _other(player)
    my = op = 0.0
    m_fo4 = m_fh4 = m_t3 = o_fo4 = o_fh4 = o_t3 = 0
    per = []
    for cells_idx in _LINES:
        cells = [board[i] for i in cells_idx]
        s1, a1, b1, c1 = _score_line(cells, player)
        s2, a2, b2, c2 = _score_line(cells, opp)
        per.append((s1, a1, b1, c1, s2, a2, b2, c2))
        my += s1
        m_fo4 += a1
        m_fh4 += b1
        m_t3 += c1
        op += s2
        o_fo4 += a2
        o_fh4 += b2
        o_t3 += c2
    return my, op, m_fo4, m_fh4, m_t3, o_fo4, o_fh4, o_t3, per


def _defense_weight(my, op, myth, opth):
    """Ahead -> attack (w<1), behind -> defend (w>1).

    Urgent four/five races push w up.
    """
    urgent = 1.0 if (myth > 0 or opth > 0) else 0.0
    adv = my - op
    w = 1.0 + 0.2 * urgent + 0.25 * math.tanh(-adv / 800.0)
    return max(0.75, min(1.35, w))


def _central(board, player):
    opp = _other(player)
    total = 0.0
    for i, v in enumerate(board):
        if v is None:
            continue
        r = i // BOARD_SIZE
        c = i % BOARD_SIZE
        bonus = max(0, 7 - (abs(r - 7) + abs(c - 7))) * CENTRAL_STEP
        if v == player:
            total += bonus
        elif v == opp:
            total -= bonus
    return total


def _race_value(m_fo4, m_fh4, m_t3, o_fo4, o_fh4, o_t3, raw):
    """Tempo/race adjudication for the side to move, else material tanh."""
    if m_fo4 + m_fh4 > 0:
        return RACE_FOUR
    if o_fo4 > 0 or o_fh4 > 1:
        return RACE_OPEN_LOSS
    if o_fh4 > 0:
        return RACE_HALF_LOSS
    if m_t3 > 0:
        return RACE_THREE
    if o_t3 > 0:
        return RACE_DEFEND
    return math.tanh(raw / VALUE_SCALE)


def _value_from_state(my, op, m_fo4, m_fh4, m_t3, o_fo4, o_fh4, o_t3, central, player):
    w = _defense_weight(my, op, m_fo4 + m_fh4 + m_t3, o_fo4 + o_fh4 + o_t3)
    raw = my - w * op + central
    return _race_value(m_fo4, m_fh4, m_t3, o_fo4, o_fh4, o_t3, raw)


def evaluate_board_v2(board, player):
    my, op, m_fo4, m_fh4, m_t3, o_fo4, o_fh4, o_t3, _ = _board_state(board, player)
    return _value_from_state(my, op, m_fo4, m_fh4, m_t3, o_fo4, o_fh4, o_t3,
                             _central(board, player), player)


def _get_candidates_for_policy(board):
    """All empty cells within distance 2 of any stone (no density cut)."""
    def idx(r, c):
        return r * BOARD_SIZE + c

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
                if 0 <= nr < BOARD_SIZE and 0 <= nc < BOARD_SIZE and board[idx(nr, nc)] is None:
                    cand.append(idx(nr, nc))
        return cand
    s = set()
    for pos in occupied:
        r = pos // BOARD_SIZE
        c = pos % BOARD_SIZE
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                nr, nc = r + dr, c + dc
                if 0 <= nr < BOARD_SIZE and 0 <= nc < BOARD_SIZE:
                    p = nr * BOARD_SIZE + nc
                    if board[p] is None:
                        s.add(p)
    return sorted(s)


def heuristic_v2_model(board, player):
    """Value-delta policy over ALL distance-2 candidates (no truncation).

    gain(pos) = -V_after(board+pos, opp) - V_self: playing my 4->5 wins,
    removing opp's four/three gains; only the 4 lines through pos are
    rescanned per candidate.
    """
    opp = _other(player)
    my0, op0, mf4, mh4, mt3, of4, oh4, ot3, per = _board_state(board, player)
    central0 = _central(board, player)
    V_self = _value_from_state(my0, op0, mf4, mh4, mt3, of4, oh4, ot3, central0, player)
    policy = np.zeros(BOARD_SIZE * BOARD_SIZE, dtype=np.float32)
    cands = _get_candidates_for_policy(board)
    if not cands:
        return float(V_self), policy
    gains = []
    for pos in cands:
        r = pos // BOARD_SIZE
        c = pos % BOARD_SIZE
        board[pos] = player
        dm = do = 0.0
        dmf4 = dmh4 = dmt3 = dof4 = doh4 = dot3 = 0
        for lid in _POS_LINES[pos]:
            cells = [board[i] for i in _LINES[lid]]
            s1, a1, b1, c1 = _score_line(cells, player)
            s2, a2, b2, c2 = _score_line(cells, opp)
            b0 = per[lid]
            dm += s1 - b0[0]
            dmf4 += a1 - b0[1]
            dmh4 += b1 - b0[2]
            dmt3 += c1 - b0[3]
            do += s2 - b0[4]
            dof4 += a2 - b0[5]
            doh4 += b2 - b0[6]
            dot3 += c2 - b0[7]
        board[pos] = None
        my1, op1 = my0 + dm, op0 + do
        central1 = central0 + CENTRAL_STEP * max(0, 7 - (abs(r - 7) + abs(c - 7)))
        V_after_opp = _value_from_state(
            op1, my1, of4 + dof4, oh4 + doh4, ot3 + dot3,
            mf4 + dmf4, mh4 + dmh4, mt3 + dmt3, -central1, opp)
        gains.append(-V_after_opp - V_self)
    max_g = max(gains)
    exps = [math.exp((g - max_g) / POLICY_TEMP) for g in gains]
    sum_e = sum(exps)
    for pos, e in zip(cands, exps):
        policy[pos] = e / sum_e
    return float(V_self), policy
