"""Fit ordinal constraints with NumPy only; fail on unsatisfied constraints.

Dykstra projections find the closest feasible weights to the starting table
in squared Euclidean distance. Features/packing stay fixed. FOUR_HALF anchors
the scale at 100; space/center bonuses are bounded. Validation families never
participate in fitting. Tactical policy cases remain independent acceptance
tests because their ordering is not a linear feature constraint.
"""

import argparse
import json
from pathlib import Path

import numpy as np

from models.heuristic_v3 import FEATURES, V3_SCORE, board_state, line_features

DEFAULT_CASES = Path(__file__).parent / "tests" / "heuristic_v3_cases.json"


def case_features(kind, position):
    if kind == "line":
        cells = [{"X": "black", "O": "white", "_": None}[c] for c in position]
        result = line_features(cells)
        if result.five:
            raise ValueError("Terminal results are rules, not fitting features")
        return np.asarray(result.features)
    board = [None] * 225
    for char, points in position.items():
        for r, c in points:
            board[r * 15 + c] = {"X": "black", "O": "white"}[char]
    state = board_state(board, "black")
    if state.five(0) or state.five(1):
        raise ValueError("Terminal results are rules, not fitting features")
    return state.features


def load_rows(path=DEFAULT_CASES):
    data = json.loads(Path(path).read_text())
    rows = []
    families = {}
    for kind in ("line", "board"):
        for case in data[kind]:
            split = case.get("split", "train")
            family = case["family"]
            if family in families and families[family] != split:
                raise ValueError(f"Family leaks across splits: {family}")
            families[family] = split
            rows.append({**case, "split": split, "delta":
                         case_features(kind, case["lhs"]) - case_features(kind, case["rhs"])})
    return rows


def violations(rows, weights, tolerance=1e-7):
    vector = np.array([weights[name] for name in FEATURES])
    errors = []
    for row in rows:
        delta = float(row["delta"] @ vector)
        error = abs(delta) if row.get("relation", ">") == "=" else row["margin"] - delta
        if error > tolerance:
            errors.append({"id": row["id"], "gap": delta, "margin": row["margin"]})
    return errors


def fit(rows, initial=None, max_iterations=10000, tolerance=1e-8):
    """Minimum-change fit to training rows; returns a complete weight table."""
    initial = V3_SCORE if initial is None else initial
    x = np.array([initial[name] for name in FEATURES], dtype=float)
    constraints = []
    for row in rows:
        if row.get("split", "train") != "train":
            continue
        normal = row["delta"]
        equal = row.get("relation", ">") == "="
        margin = 0.0 if equal else row["margin"]
        if not np.any(normal):
            if margin > 0:
                raise ValueError(f"Identical features cannot satisfy: {row['id']}")
            continue
        constraints.append((normal, margin))
        if equal:
            constraints.append((-normal, 0.0))
    lower = np.zeros(len(FEATURES))
    upper = np.full(len(FEATURES), np.inf)
    anchor = FEATURES.index("FOUR_HALF")
    lower[anchor] = upper[anchor] = V3_SCORE["FOUR_HALF"]
    upper[FEATURES.index("SPACE")] = 0.25
    upper[FEATURES.index("CENTER")] = 0.05
    corrections = np.zeros((len(constraints) + 1, len(FEATURES)))
    for _ in range(max_iterations):
        previous = x.copy()
        for i, (normal, margin) in enumerate(constraints):
            trial = x + corrections[i]
            x = trial + max(0.0, margin - normal @ trial) / (normal @ normal) * normal
            corrections[i] = trial - x
        trial = x + corrections[-1]
        x = np.clip(trial, lower, upper)
        corrections[-1] = trial - x
        if np.max(np.abs(x - previous)) <= tolerance and all(
            normal @ x >= margin - tolerance for normal, margin in constraints
        ):
            return dict(zip(FEATURES, map(float, x)))
    weights = dict(zip(FEATURES, map(float, x)))
    failures = violations([r for r in rows if r.get("split", "train") == "train"], weights)
    raise ValueError(f"Fit did not converge; conflicting constraints or iteration limit: {failures}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--weights", type=Path, help="Starting weight JSON; defaults to the reference table")
    parser.add_argument("--output", type=Path, help="Write fitted weights after train/validation pass")
    args = parser.parse_args()
    rows = load_rows(args.cases)
    initial = json.loads(args.weights.read_text()) if args.weights else None
    weights = fit(rows, initial)
    report = {}
    for split in ("train", "validation"):
        subset = [r for r in rows if r["split"] == split]
        report[split] = {"cases": len(subset), "failures": violations(subset, weights)}
    print(json.dumps({"report": report, "weights": weights}, indent=2))
    if any(result["failures"] for result in report.values()):
        raise SystemExit(1)
    if args.output:
        args.output.write_text(json.dumps(weights, indent=2) + "\n")


if __name__ == "__main__":
    main()
