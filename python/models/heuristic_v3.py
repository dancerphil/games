"""Window-based, explainable Gomoku features and incremental delta policy.

Windows identify candidates, never score independently. Extension tests use
only the candidate's stones; stronger supersets absorb their subshapes. A
maximum-weight disjoint packing handles the remaining overlaps. Packing uses
the fixed reference weights, so feature extraction is independent of fitting.
Actual winning points are extracted separately from the complete line.
"""

from dataclasses import dataclass
from functools import lru_cache
import math

import numpy as np

from mcts import get_candidates
from .heuristic_v2 import _LINES, _POS_LINES

V3_SCORE = {
    "FOUR_OPEN": 1000.0, "FOUR_HALF": 100.0,
    "FOUR_GAP31": 98.0, "FOUR_GAP22": 96.0,
    "THREE_OPEN": 80.0, "THREE_GAP_OPEN": 78.0,
    "TWO_OPEN": 12.0, "THREE_HALF": 10.0,
    "THREE_GAP_HALF": 8.0, "THREE_SPLIT": 6.0,
    "TWO_GAP_OPEN": 8.0, "TWO_WIDE_OPEN": 6.0,
    "ONE_OPEN": 1.0, "TWO_HALF": 0.8,
    "TWO_GAP_HALF": 0.6, "ONE_HALF": 0.3,
    "SPACE": 0.1, "CENTER": 0.02,
}
FEATURES = tuple(V3_SCORE)
REFERENCE = tuple(V3_SCORE.values())
VALUE_SCALE = 400.0
POLICY_TEMP = 20.0


def _other(player):
    return "white" if player == "black" else "black"


def _bits(mask):
    while mask:
        bit = mask & -mask
        yield bit
        mask ^= bit


@lru_cache(maxsize=32768)
def _windows(n, blocked):
    return tuple(31 << i for i in range(n - 4) if not (31 << i) & blocked)


def _winning_mask(stones, windows):
    result = 0
    for window in windows:
        if (window & stones).bit_count() == 4:
            result |= window & ~stones
    return result


@lru_cache(maxsize=65536)
def _open(stones, windows):
    """Can this 2/3-stone shape extend recursively to a two-point four?"""
    if stones.bit_count() == 4:
        return _winning_mask(stones, windows).bit_count() >= 2
    extensions = 0
    for window in windows:
        if window & stones == stones:
            extensions |= window & ~stones
    return any(_open(stones | bit, windows) for bit in _bits(extensions))


def _kind(stones, windows):
    count = stones.bit_count()
    lo = (stones & -stones).bit_length() - 1
    hi = stones.bit_length() - 1
    contiguous = hi - lo + 1 == count
    if count == 4:
        if _open(stones, windows):
            return "FOUR_OPEN"
        if contiguous:
            return "FOUR_HALF"
        return "FOUR_GAP22" if not stones & (1 << (lo + 2)) else "FOUR_GAP31"
    if count == 3:
        if _open(stones, windows):
            return "THREE_OPEN" if contiguous else "THREE_GAP_OPEN"
        if contiguous:
            return "THREE_HALF"
        return "THREE_GAP_HALF" if hi - lo == 3 else "THREE_SPLIT"
    if count == 2:
        if _open(stones, windows):
            return "TWO_OPEN" if contiguous else (
                "TWO_GAP_OPEN" if hi - lo == 2 else "TWO_WIDE_OPEN")
        return "TWO_HALF" if contiguous else "TWO_GAP_HALF"
    # An adjacent boundary/opponent makes a one-sided single.
    room = 0
    for window in windows:
        if window & stones:
            room |= window
    return "ONE_OPEN" if lo > 0 and room & (1 << (lo - 1)) and room & (1 << (lo + 1)) else "ONE_HALF"


@dataclass(frozen=True)
class Line:
    features: tuple
    wins: tuple
    five: bool
    fours: tuple


@lru_cache(maxsize=32768)
def _extract(text):
    stones = sum(1 << i for i, c in enumerate(text) if c == "X")
    blocked = sum(1 << i for i, c in enumerate(text) if c == "O")
    windows = _windows(len(text), blocked)
    five = any(stones & w == w for w in windows)
    wins = tuple(b.bit_length() - 1 for b in _bits(_winning_mask(stones, windows)))
    # Any move creating a four must lie in a currently three-stone window.
    four_mask = 0
    for window in windows:
        if (window & stones).bit_count() == 3:
            four_mask |= window & ~stones
    fours = tuple(b.bit_length() - 1 for b in _bits(four_mask))
    if five:
        return Line((0.0,) * len(FEATURES), wins, True, fours)
    masks = {stones & w for w in windows if stones & w}
    candidates = []
    for mask in masks:
        kind = _kind(mask, windows)
        feature = [0.0] * len(FEATURES)
        feature[FEATURES.index(kind)] = 1.0
        if mask.bit_count() <= 2:
            # Saturated, local development room; never multiplies threats.
            room = sum(w & mask == mask for w in windows)
            feature[FEATURES.index("SPACE")] = min(4, room - 1) / 4
        candidates.append((mask, tuple(feature)))
    candidates = [c for c in candidates if not any(
        c[0] != d[0] and c[0] & d[0] == c[0]
        for d in candidates)]

    @lru_cache(maxsize=None)
    def pack(remaining):
        best = (0.0, (0.0,) * len(FEATURES))
        for mask, feature in candidates:
            if mask & remaining == mask:
                score, rest = pack(remaining ^ mask)
                combined = tuple(a + b for a, b in zip(feature, rest))
                # Feature-vector tie-break, not board coordinates: D4 invariant.
                best = max(best, (score + sum(a * b for a, b in zip(feature, REFERENCE)), combined))
        return best

    return Line(pack(stones)[1], wins, False, fours)


def line_features(cells, player="black"):
    """Return immutable features, local winning indices, and terminal flag."""
    return _extract("".join("_" if c is None else "X" if c == player else "O" for c in cells))


def score_features(features, weights=None):
    weights = V3_SCORE if weights is None else weights
    return sum(value * weights[name] for name, value in zip(FEATURES, features))


def score_line(cells, player="black", weights=None):
    line = line_features(cells, player)
    return math.inf if line.five else score_features(line.features, weights)


def _center(pos):
    r, c = divmod(pos, 15)
    return max(0, 7 - abs(r - 7) - abs(c - 7))


@dataclass
class State:
    player: str
    lines: list
    features: np.ndarray

    def winning_points(self, side):
        return {positions[p] for positions, pair in zip(_LINES, self.lines)
                for p in pair[side].wins}

    def five(self, side):
        return any(pair[side].five for pair in self.lines)


def board_state(board, player):
    opp = _other(player)
    lines = []
    features = np.zeros(len(FEATURES), dtype=np.float64)
    for positions in _LINES:
        cells = [board[p] for p in positions]
        pair = (line_features(cells, player), line_features(cells, opp))
        lines.append(pair)
        features += np.subtract(pair[0].features, pair[1].features)
    features[-1] = sum(_center(p) * (1 if c == player else -1)
                       for p, c in enumerate(board) if c is not None)
    return State(player, lines, features)


def after_move(board, state, pos, player):
    """Local update without mutating the caller's board or state."""
    lines = state.lines.copy()
    features = state.features.copy()
    opp = _other(state.player)
    for lid in _POS_LINES[pos]:
        cells = [player if p == pos else board[p] for p in _LINES[lid]]
        old = lines[lid]
        pair = (line_features(cells, state.player), line_features(cells, opp))
        features += np.subtract(pair[0].features, pair[1].features)
        features -= np.subtract(old[0].features, old[1].features)
        lines[lid] = pair
    features[-1] += _center(pos) * (1 if player == state.player else -1)
    return State(state.player, lines, features)


def static_score(board, player, weights=None):
    """Nonterminal material score, antisymmetric in the evaluation player."""
    return score_features(board_state(board, player).features, weights)


def _value(board, state, to_move, weights=None):
    side = int(to_move != state.player)
    sign = 1 if side == 0 else -1
    if state.five(0):
        return 1.0
    if state.five(1):
        return -1.0
    if all(c is not None for c in board):
        return 0.0
    if state.winning_points(side):
        return sign * 0.99
    threats = state.winning_points(1 - side)
    if len(threats) >= 2:
        return -sign * 0.99
    if threats:
        pos = next(iter(threats))
        updated = after_move(board, state, pos, to_move)
        next_board = board.copy()
        next_board[pos] = to_move
        # Every recursion fills a forced block; counter-fours are handled too.
        return _value(next_board, updated, _other(to_move), weights)
    return 0.98 * math.tanh(score_features(state.features, weights) / VALUE_SCALE)


def evaluate_board_v3(board, player, to_move=None, weights=None):
    return _value(board, board_state(board, player), to_move or player, weights)


def _fork_points(board, state, side, candidates=None):
    """Proven next-move double wins, including crossed half-fours.

    A counter-win by the defender invalidates the fork. Shared winning
    coordinates count once, even when several lines create them.
    """
    if candidates is None:
        candidates = {positions[p] for positions, pair in zip(_LINES, state.lines)
                      for p in pair[side].fours}
    blocks = state.winning_points(1 - side)
    if len(blocks) >= 2:
        return set()
    if blocks:
        candidates = candidates & blocks
    player = state.player if side == 0 else _other(state.player)
    forks = set()
    for pos in candidates:
        if board[pos] is not None:
            continue
        updated = after_move(board, state, pos, player)
        if len(updated.winning_points(side)) >= 2 and not updated.winning_points(1 - side):
            forks.add(pos)
    return forks


def heuristic_v3_model(board, player, weights=None):
    state = board_state(board, player)
    value = _value(board, state, player, weights)
    policy = np.zeros(225, dtype=np.float32)
    if state.five(0) or state.five(1):
        return value, policy
    wins = state.winning_points(0)
    blocks = state.winning_points(1)
    cands = sorted(wins or blocks) if wins or len(blocks) == 1 else get_candidates(board)
    if not cands:
        return 0.0, policy
    if wins or len(blocks) == 1:
        policy[cands] = 1.0 / len(cands)
        return value, policy
    gains = []
    categories = []
    opponent_forks = _fork_points(board, state, 1)
    for pos in cands:
        updated = after_move(board, state, pos, player)
        gains.append(score_features(updated.features - state.features, weights))
        next_board = board.copy()
        next_board[pos] = player
        if updated.winning_points(1):
            category = -2
        elif len(updated.winning_points(0)) >= 2:
            category = 1
        elif _fork_points(next_board, updated, 1, opponent_forks):
            category = -1
        else:
            category = 0
        categories.append(category)
    best = max(categories)
    eligible = [(p, g) for p, g, category in zip(cands, gains, categories) if category == best]
    peak = max(g for _, g in eligible)
    exps = [math.exp((g - peak) / POLICY_TEMP) for _, g in eligible]
    total = sum(exps)
    for (pos, _), exp in zip(eligible, exps):
        policy[pos] = exp / total
    return value, policy
