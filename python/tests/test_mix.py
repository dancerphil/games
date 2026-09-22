import random
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from python import models, mcts
from python.selfplay.elo import apply_elo
from python.selfplay.game import play_one
from python.train.mix import candidate, name_of, openings, opening_key, run_stage, summarize, tasks_for


class MixTests(unittest.TestCase):
    def test_hidden_dependencies_remain_usable_by_public_blends(self):
        from python.selfplay.db import list_models

        available = list_models()
        for name in ("heuristic-v2", "nn-v4"):
            self.assertNotIn(name, models.REGISTRY)
            self.assertNotIn(name, available)
        board = [None] * 225
        board[112] = "black"
        neural_value, neural_policy = models._resolve("nn-v4")(board, "white")
        heuristic_value, _ = models._resolve("heuristic-v2")(board, "white")
        for name, expected in (
            ("nn4-policy-h2-value", heuristic_value),
            ("nn4-policy-h2v80", 0.8 * heuristic_value + 0.2 * neural_value),
        ):
            self.assertIn(name, available)
            value, policy = models.REGISTRY[name](board, "white")
            self.assertAlmostEqual(value, expected)
            np.testing.assert_allclose(policy, neural_policy)

    def test_blend_evaluates_shared_model_once(self):
        calls = []

        def neural(board, player):
            calls.append("n")
            return 0.8, np.ones(225) / 225

        def heuristic(board, player):
            calls.append("h")
            return -0.4, np.ones(225) / 225

        with patch.dict(models._resolved, {"n": neural, "h": heuristic}):
            fn = models.make_model({"policy": "n", "value": {"n": 0.25, "h": 0.75}, "c_puct": 1.8})
            value, policy = fn([None] * 225, "black")
        self.assertEqual(calls, ["n", "h"])
        self.assertAlmostEqual(value, -0.1)
        self.assertAlmostEqual(policy.sum(), 1)
        self.assertEqual(fn.mcts_c_puct, 1.8)

    def test_openings_disjoint_under_d4_and_tasks_swap_colors(self):
        self.assertEqual(opening_key([112, 113, 97, 98]), opening_key([112, 98, 97, 113]))
        used, rng = set(), random.Random(0)
        stages = [openings(n, rng, used) for n in (3, 5, 20)]
        self.assertEqual(len({opening_key(m) for stage in stages for m in stage}), 28)
        for stage in stages:
            for moves in stage:
                self.assertEqual(moves[0], 112)
                self.assertEqual(len(set(moves)), 4)
                self.assertLessEqual(abs(moves[1] // 15 - 7), 1)
                self.assertLessEqual(abs(moves[1] % 15 - 7), 1)
        tasks = tasks_for("test", [candidate()], ["opponent"], stages[0], 0, 5000)
        self.assertEqual(len(tasks), 6)
        for index in range(3):
            pair = [t for t in tasks if t["opening_id"] == index]
            self.assertEqual({t["color"] for t in pair}, {"black", "white"})
            self.assertEqual(pair[0]["opening"], pair[1]["opening"])
            self.assertEqual(pair[0]["sample_moves"], 0)

    def test_summary_uses_candidate_perspective_and_paired_scores(self):
        spec = candidate()
        tasks = tasks_for("test", [spec], ["opponent"], [[112, 113, 97, 98]], 0, 5000)
        records = {t["id"]: {"winner": "black", "policies": [None] * 4, "duration_ms": 1000}
                   for t in tasks}
        report = summarize(tasks, records)[name_of(spec)]
        self.assertEqual(report["score"], 0.5)
        self.assertEqual(report["opponents_wdl"]["opponent"], [1, 0, 1])
        self.assertEqual(report["opening_bootstrap_95"], [0.5, 0.5])

    def test_fixed_prefix_is_replayed_without_fake_policy(self):
        observed = []

        def search(board, player, fn, time_limit_ms):
            observed.append((board[:], player))
            return 116, {116: 1}, True, None

        task = {"black_model": "n", "white_model": "n", "time_limit_ms": 5000,
                "opening": [112, 113, 97, 98]}
        with patch.dict(models.REGISTRY, {"n": lambda b, p: (0, np.ones(225) / 225)}), \
                patch.object(mcts, "get_best_move_with_stats", side_effect=search), \
                patch.object(mcts, "check_win_at", side_effect=lambda b, p, color: p == 116):
            result = play_one(task)
        self.assertEqual(observed[0][1], "black")
        self.assertEqual(observed[0][0][113], "white")
        self.assertEqual(result["moves"], [112, 113, 97, 98, 116])
        self.assertEqual(result["policies"][:4], [None] * 4)
        self.assertEqual(result["winner"], "black")

    def test_completed_stage_resume_never_launches_games(self):
        spec = candidate()
        prefixes = [[112, 113, 97, 98]]
        tasks = tasks_for("test", [spec], ["opponent"], prefixes, 0, 5000)
        records = {t["id"]: {"winner": "black", "policies": [None] * 4, "duration_ms": 1000}
                   for t in tasks}
        with tempfile.TemporaryDirectory() as tmp, \
                patch("python.train.mix.ProcessPoolExecutor") as pool, patch("builtins.print"):
            args = SimpleNamespace(seed=0, time_ms=5000, workers=1, output=Path(tmp))
            ranked, report = run_stage("test", [spec], ["opponent"], prefixes, args, records)
            pool.assert_not_called()
            self.assertEqual(ranked, [spec])
            self.assertEqual(report[name_of(spec)]["games"], 2)
            self.assertTrue((Path(tmp) / "test.json").exists())

    def test_elo_uses_both_old_ratings_and_ignores_selfplay(self):
        con = sqlite3.connect(":memory:")
        con.execute("CREATE TABLE elo_ratings (model TEXT PRIMARY KEY, rating REAL, "
                    "games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, "
                    "draws INTEGER DEFAULT 0, updated_at TEXT)")
        apply_elo(con, "a", "b", "black")
        self.assertEqual(con.execute("SELECT model,rating,games FROM elo_ratings ORDER BY model").fetchall(),
                         [("a", 1516.0, 1), ("b", 1484.0, 1)])
        before = con.execute("SELECT * FROM elo_ratings ORDER BY model").fetchall()
        apply_elo(con, "a", "a", "black")
        self.assertEqual(con.execute("SELECT * FROM elo_ratings ORDER BY model").fetchall(), before)
        con.close()

    def test_search_budget_includes_root_evaluation(self):
        events = []

        def clock():
            events.append("clock")
            return 0 if len(events) == 1 else 10

        def model(board, player):
            events.append("model")
            return 0.0, np.ones(225) / 225

        with patch.object(mcts.time, "monotonic", side_effect=clock), \
                patch.object(mcts, "find_tactical_move", return_value=None):
            mcts.MCTS(model).search([None] * 225, "black", 5000)
        self.assertEqual(events[:2], ["clock", "model"])
        self.assertEqual(events.count("model"), 1)


if __name__ == "__main__":
    unittest.main()
