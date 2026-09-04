from .heuristic import evaluate_board

REGISTRY = {
    "heuristic-v1": evaluate_board,
}
