from .heuristic import heuristic_model, heuristic_v2_model
from .nn_model import nn_model_fn
import json
import os

C_PUCT = 1.2

CHECKPOINT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "checkpoints"))
MANIFEST = os.path.join(CHECKPOINT_DIR, "manifest.json")

_BUILTINS = {
    "heuristic-v1": heuristic_model,
    "heuristic-v2": heuristic_v2_model,
}


def _bind(eval_fn):
    def fn(board, player):
        return eval_fn(board, player)
    fn.mcts_c_puct = C_PUCT
    return fn


def _hybrid(value_fn, policy_fn):
    """组合模型：value 取自 value，policy 取自 policy（均为 manifest 模型名）。"""

    def fn(board, player):
        v, _ = value_fn(board, player)
        _, p = policy_fn(board, player)
        return v, p

    return fn


def _load_manifest():
    """训练与 serving 的契约：所有模型（builtin / checkpoint / 组合）都从 manifest 来。"""
    with open(MANIFEST) as f:
        data = json.load(f)
    for name, spec in data.items():
        if spec.keys() == {"builtin"} and spec["builtin"] is True:
            continue
        if spec.keys() == {"checkpoint"}:
            continue
        if spec.keys() == {"policy", "value"} and all(r in data for r in spec.values()):
            continue
        raise ValueError(f"bad manifest entry {name}: {spec}")
    return data


_MANIFEST = _load_manifest()
REGISTRY = {}
_resolving = set()


def _resolve(name):
    if name in REGISTRY:
        return REGISTRY[name]
    if name in _resolving:
        raise ValueError(f"cyclic manifest ref at {name}")
    _resolving.add(name)
    spec = _MANIFEST[name]
    if "policy" in spec:
        fn = _bind(_hybrid(_resolve(spec["value"]), _resolve(spec["policy"])))
    elif "builtin" in spec:
        fn = _bind(_BUILTINS[name])
    else:
        fn = _bind(nn_model_fn(os.path.join(CHECKPOINT_DIR, spec["checkpoint"])))
    _resolving.discard(name)
    REGISTRY[name] = fn
    return fn


for _name in _MANIFEST:
    _resolve(_name)

DEFAULT_MODEL = "heuristic-v1"
