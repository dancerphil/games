"""Heuristic entry (compat shim).

Scoring details live in heuristic_v1.py (frozen) and heuristic_v2.py.
Old imports (`from models.heuristic import evaluate_board, heuristic_model`)
keep resolving to v1 behavior.
"""

from .heuristic_v1 import (
    BOARD_SIZE,
    PATTERN_SCORE,
    evaluate_board,
    heuristic_model,
)
from .heuristic_v2 import (
    V2_SCORE,
    evaluate_board_v2,
    heuristic_v2_model,
)

__all__ = [
    "BOARD_SIZE",
    "PATTERN_SCORE",
    "V2_SCORE",
    "evaluate_board",
    "evaluate_board_v2",
    "heuristic_model",
    "heuristic_v2_model",
]
