from .heuristic_v2 import heuristic_v2_model
from .heuristic_v3 import heuristic_v3_model
from .nn_model import nn_model_fn
import json
import os

C_PUCT = 1.2

CHECKPOINT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "checkpoints"))
MANIFEST = os.path.join(CHECKPOINT_DIR, "manifest.json")

_BUILTINS = {
    "heuristic-v2": heuristic_v2_model,
    "heuristic-v3": heuristic_v3_model,
}


def _bind(eval_fn, c_puct=C_PUCT):
    def fn(board, player):
        return eval_fn(board, player)
    fn.mcts_c_puct = c_puct
    return fn


def _blend(policy_fn, value_spec):
    """组合模型：policy 取自 policy_fn；value = 各模型 value 的加权和。

    value_spec 为模型名，或 {模型名: 权重}（按权重和归一）。
    """
    if isinstance(value_spec, str):
        value_fns = [(_resolve(value_spec), 1.0)]
    else:
        total = sum(value_spec.values())
        value_fns = [(_resolve(name), weight / total) for name, weight in value_spec.items() if weight != 0]

    def fn(board, player):
        fns = dict.fromkeys([policy_fn, *[f for f, _ in value_fns]])
        outputs = {f: f(board, player) for f in fns}
        value = sum(weight * outputs[f][0] for f, weight in value_fns)
        _, policy = outputs[policy_fn]
        return value, policy

    return fn


def make_model(spec):
    """构造可直接写入 manifest 的融合视图；mix 无需注册临时模型。"""
    return _bind(_blend(_resolve(spec["policy"]), spec["value"]), spec.get("c_puct", C_PUCT))


def _load_manifest():
    """训练与 serving 的契约：所有模型（builtin / checkpoint / 组合）都从 manifest 来。"""
    with open(MANIFEST) as f:
        data = json.load(f)
    for name, spec in data.items():
        spec = dict(spec)
        c_puct = spec.pop("c_puct", C_PUCT)
        if not isinstance(c_puct, (int, float)) or not 0 < c_puct < float("inf"):
            raise ValueError(f"bad c_puct for {name}: {c_puct}")
        if spec.keys() == {"builtin"} and spec["builtin"] is True:
            continue
        if spec.keys() == {"checkpoint"}:
            continue
        if spec.keys() == {"policy", "value"}:
            value = spec["value"]
            refs = [spec["policy"]]
            refs += list(value) if isinstance(value, dict) else [value]
            if all(r in data for r in refs):
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
        fn = make_model(spec)
    elif "builtin" in spec:
        fn = _bind(_BUILTINS[name], spec.get("c_puct", C_PUCT))
    else:
        fn = _bind(nn_model_fn(os.path.join(CHECKPOINT_DIR, spec["checkpoint"])), spec.get("c_puct", C_PUCT))
    _resolving.discard(name)
    REGISTRY[name] = fn
    return fn


for _name in _MANIFEST:
    _resolve(_name)

DEFAULT_MODEL = "nn-v4"
