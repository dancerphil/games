from .heuristic import heuristic_model
from .nn_model import nn_model_fn
import os

C_PUCT = 1.2
C_UCT = 1.4142


def _bind(eval_fn, strategy):
    def fn(board, player):
        return eval_fn(board, player)
    fn.mcts_strategy = strategy
    fn.mcts_c_puct = C_PUCT
    fn.mcts_c_uct = C_UCT
    fn.eval_name = getattr(eval_fn, "__name__", "eval")
    return fn


def _fixed_nn(filename):
    ckpt = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "checkpoints", filename))

    def fn(board, player):
        if os.path.exists(ckpt):
            return nn_model_fn(ckpt)(board, player)
        import numpy as np
        policy = np.zeros(225, dtype=np.float32)
        cnt = sum(1 for v in board if v is None)
        if cnt:
            for i, v in enumerate(board):
                if v is None:
                    policy[i] = 1.0 / cnt
        return 0.0, policy
    return fn


REGISTRY = {
    "heuristic-puct-v1": _bind(heuristic_model, "puct"),
    "heuristic-uct-v1": _bind(heuristic_model, "uct"),
    "nn-puct-v1": _bind(_fixed_nn("1.pth"), "puct"),
    "nn-uct-v1": _bind(_fixed_nn("1.pth"), "uct"),
    "nn-puct-v2": _bind(_fixed_nn("2.pth"), "puct"),
    "nn-uct-v2": _bind(_fixed_nn("2.pth"), "uct"),
}

DEFAULT_MODEL = "heuristic-puct-v1"
