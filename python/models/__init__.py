from .heuristic import evaluate_board, heuristic_model
from .nn_model import nn_model_fn, find_checkpoints
import os

REGISTRY = {
    "minimax_heuristic": evaluate_board,
    "mcts_heuristic": heuristic_model,
    # backward compat
    "heuristic-v1": evaluate_board,
}

# auto-discover nn checkpoints: nn-v1 -> checkpoints/1.pth etc.
for ckpt in find_checkpoints():
    name = os.path.splitext(os.path.basename(ckpt))[0]
    # map 1.pth -> nn-v1, 2.pth -> nn-v2, or keep raw name
    key = f"nn-v{name}" if name.isdigit() else name
    REGISTRY[key] = nn_model_fn(ckpt)

# if no checkpoint yet, provide placeholder nn-v1 that will be available after training
if "nn-v1" not in REGISTRY:
    # lazy placeholder: will try to load checkpoints/1.pth on first use
    import pathlib
    ckpt1 = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "checkpoints", "1.pth"))
    # register a function that loads on demand and falls back to heuristic
    def _lazy_nn_v1(board, player):
        if os.path.exists(ckpt1):
            fn = nn_model_fn(ckpt1)
            return fn(board, player)
        # fallback: uniform policy
        import numpy as np
        n = 225
        policy = np.zeros(n, dtype=np.float32)
        cnt = sum(1 for v in board if v is None)
        if cnt:
            for i, v in enumerate(board):
                if v is None:
                    policy[i] = 1.0 / cnt
        return 0.0, policy
    REGISTRY["nn-v1"] = _lazy_nn_v1
