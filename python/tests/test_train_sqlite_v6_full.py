from concurrent.futures import Future
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import random
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch

from train import train_sqlite_v6_full as full
from train import v6_full_data as data


def cross_rows():
    rng = random.Random(12)
    rows = []
    for index in range(40):
        moves = rng.sample(range(225), 8)
        teacher_black = index % 2 == 0
        policies = [{"t": False, "q": .2 if (ply % 2 == 0) == teacher_black else -.9,
                     "d": {str(pos): 10}} for ply, pos in enumerate(moves)]
        black, white = (data.TEACHER, "nn-v5-a1") if teacher_black else ("nn-v5-a2", data.TEACHER)
        rows.append((index, "cross", black, white, "black", json.dumps(moves), json.dumps(policies), 5000))
    return rows


class FullDataTests(unittest.TestCase):
    def test_canonical_labels_preserve_coordinates_and_q(self):
        board = np.zeros(225, dtype=np.uint8)
        board[[17, 35]] = [1, 2]
        key, canonical, transform = data.canonical_position(board)
        label = data.search_label({"d": {71: 3, 72: 1}, "q": -.4}, transform, canonical)
        self.assertAlmostEqual(label["policy"][data.v5.INVERSES[transform, 71]], .75)
        self.assertAlmostEqual(label["q"], -.4)
        for perm in data.v5.PERMS:
            self.assertEqual(data.canonical_position(board[perm])[0], key)

    def test_cross_selection_never_uses_opponent_labels_or_known_positions(self):
        rows = cross_rows()
        plan = data.prepare_cross(rows, set(), set(), 0, 20, 2)
        self.assertEqual(len(plan["pending"]), 20)
        self.assertTrue(all(r["actor"] == data.TEACHER and r["q"] == .2 for r in plan["records"]))
        self.assertTrue(all(r["actor"] != data.TEACHER and "q" not in r for r in plan["pending"]))
        known = bytes(plan["pending"][0]["board"])
        second = data.prepare_cross(rows, {known}, set(), 0, 20, 2)
        self.assertNotIn(known.hex(), [r["key"] for r in second["records"] + second["pending"]])
        # 所有对局都有空盘，这个跨集合公共局面不能进入新的交叉数据。
        self.assertNotIn(bytes(225).hex(), [r["key"] for r in plan["records"] + plan["pending"]])
        groups = {part: set() for part in data.PARTS}
        positions = {part: set() for part in data.PARTS}
        for row in plan["records"] + plan["pending"]:
            groups[row["split"]].add(row["group"])
            positions[row["split"]].add(row["key"])
        for a, b in (("train", "val"), ("train", "test"), ("val", "test")):
            self.assertFalse(groups[a] & groups[b])
            self.assertFalse(positions[a] & positions[b])

    def test_original_game_groups_are_excluded(self):
        rows = cross_rows()
        plan = data.prepare_cross(rows, set(), set(), 0, 20, 2)
        group = next(iter(plan["game_split"]))
        filtered = data.prepare_cross(rows, set(), {group}, 0, 20, 2)
        self.assertNotIn(group, filtered["game_split"])
        self.assertGreater(filtered["audit"]["skipped"]["known_game"], 0)

    def test_balancing_limits_game_contribution_and_keeps_both_priorities(self):
        records = [{"group": str(i // 10), "opponent": "nn-v5-a1" if i % 2 else "nn-v5-a3",
                    "ply": i % 2, "outcome": "win" if i % 3 else "loss", "key": str(i)} for i in range(200)]
        selected = data.balanced_select(records, 20, 2, 0)
        self.assertEqual(len(selected), 20)
        self.assertEqual(sum(r["opponent"] in data.PRIORITY for r in selected), 10)
        self.assertLessEqual(max(data.Counter(r["group"] for r in selected).values()), 2)

    def test_reanalysis_resume_reuses_committed_results(self):
        plan = data.prepare_cross(cross_rows(), set(), set(), 0, 3, 2)
        calls = []

        class Pool:
            def __init__(self, **kwargs):
                pass

            def shutdown(self, **kwargs):
                pass

            def submit(self, fn, task):
                row, time_ms, seed = task
                calls.append(row["key"])
                future = Future()
                policy = np.zeros(225)
                policy[row["board"].index(0)] = 1
                future.set_result({"key": row["key"], "tactical": False, "policy": policy.tolist(),
                                   "q": -.3, "visits": 10, "duration_ms": 1, "time_limit_ms": time_ms})
                return future

        with tempfile.TemporaryDirectory() as tmp, patch.object(data, "ProcessPoolExecutor", Pool), redirect_stdout(io.StringIO()):
            labels = data.reanalyze(Path(tmp), plan["pending"], 5, 1, 0)
            cached = data.reanalyze(Path(tmp), plan["pending"], 5, 1, 0)
            self.assertEqual(labels, cached)
            self.assertEqual(len(calls), 3)
            parts, _ = data.cross_samples({"records": [], "pending": plan["pending"]}, labels)
            for samples in parts.values():
                for sample in samples:
                    self.assertEqual(sample.q, -.3)
                    self.assertEqual(sample.z, 0)

    def test_freeze_rejects_changed_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            full.freeze(path, {"teacher_hash": "a"})
            full.freeze(path, {"teacher_hash": "a"})
            with self.assertRaises(ValueError):
                full.freeze(path, {"teacher_hash": "b"})


class FullTrainingTests(unittest.TestCase):
    def test_cross_value_ignores_outcome_but_selfplay_uses_it(self):
        boards = torch.zeros(3, 3, 15, 15)
        boards[:, 2] = 1
        policy = torch.zeros(3, 225)
        policy[:, 112] = 1
        z = torch.ones(3)
        batch = [boards, policy, torch.zeros(3), z, torch.zeros(3, dtype=torch.bool)]
        value, logits = torch.zeros(3, 1), torch.zeros(3, 225)
        counts = dict.fromkeys(full.WEIGHTS, 1)
        before = full.combined_loss(value, logits, batch, counts, .25)
        z[1] = 100
        torch.testing.assert_close(before, full.combined_loss(value, logits, batch, counts, .25))
        z[0] = 100
        self.assertGreater(full.combined_loss(value, logits, batch, counts, .25), before)

    def test_validation_uses_fixed_source_weights_and_hides_fake_z(self):
        def metrics(model, samples, device, alpha, keys, batch, legal_mask):
            return {"quiet": {"loss": float(samples[0]), "mse_z": 123, "corr_z": .2},
                    "tactical": {"mse_z": 2}}

        partitions = {s: {"val": [i]} for i, s in enumerate(full.WEIGHTS, 1)}
        with patch.object(full.v5, "evaluate", side_effect=metrics):
            result = full.evaluate_sources(None, partitions, "val", "cpu", set(), 128, .25)
        self.assertAlmostEqual(result["score"], .7*1.5 + .2*2 + .1*3.5)
        self.assertNotIn("mse_z", result["sources"]["cross"]["quiet"])

    def test_training_resume_matches_uninterrupted_updates(self):
        class Toy(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.policy = torch.nn.Parameter(torch.zeros(225))
                self.value = torch.nn.Parameter(torch.zeros(1))

            def forward(self, boards):
                return self.value.expand(len(boards), 1), self.policy.expand(len(boards), 225)

        samples = []
        for pos, tactical in ((112, False), (113, False), (114, True)):
            policy = np.zeros(225, dtype=np.float32)
            policy[pos] = 1
            samples.append(full.v5.Sample(np.zeros(225, dtype=np.uint8), policy, .4, 1, 0, tactical))
        partitions = {s: {"train": samples[:2] if s == "cross" else samples} for s in full.WEIGHTS}
        buckets = [("a", 0), ("b", 1)]
        evaluate = lambda *a, **kw: {"score": float(a[0].policy.detach().square().sum()), "sources": {}}
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()):
            root = Path(tmp)
            checkpoint = root / "start.pth"
            torch.save(Toy().state_dict(), checkpoint)
            args = SimpleNamespace(device="cpu", seed=0, warm_start=str(checkpoint), base_checkpoint=str(checkpoint),
                                   batch=10, lr=1e-3, updates=3, eval_every=1, tactical_weight=.25,
                                   evaluate_only=None, evaluate_test=False)
            complete, resumed = root / "complete", root / "resumed"
            complete.mkdir()
            resumed.mkdir()
            with patch.object(full.v5, "build_model_from_state_dict", side_effect=lambda _: Toy()), \
                    patch.object(full, "evaluate_sources", side_effect=evaluate):
                full.train(args, partitions, buckets, complete, set())
            calls = 0

            def interrupt(*a, **kw):
                nonlocal calls
                calls += 1
                if calls == 4:  # 两个 baseline、update 1，然后在 update 2 中断。
                    raise RuntimeError("interrupted")
                return evaluate(*a, **kw)

            with patch.object(full.v5, "build_model_from_state_dict", side_effect=lambda _: Toy()), \
                    patch.object(full, "evaluate_sources", side_effect=interrupt):
                with self.assertRaisesRegex(RuntimeError, "interrupted"):
                    full.train(args, partitions, buckets, resumed, set())
            with patch.object(full.v5, "build_model_from_state_dict", side_effect=lambda _: Toy()), \
                    patch.object(full, "evaluate_sources", side_effect=evaluate):
                full.train(args, partitions, buckets, resumed, set())
            a = torch.load(complete / "last.pth", weights_only=True)
            b = torch.load(resumed / "last.pth", weights_only=True)
            for key in a:
                torch.testing.assert_close(a[key], b[key], rtol=0, atol=0)
            summary = json.loads((resumed / "summary.json").read_text())
            self.assertEqual(summary["updates"], 3)
            self.assertEqual(sum(sum(v.values()) for v in summary["exposures"].values()), 30)


if __name__ == "__main__":
    unittest.main()
