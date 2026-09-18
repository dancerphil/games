import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

import numpy as np
import torch

from models.nn_model import board_to_tensor
from train_sqlite_v5 import (
    INVERSES, PERMS, PositionDataset, Sample, canonical_game, evaluate,
    load_games, losses, position_key, split_games,
)


class DistillationTests(unittest.TestCase):
    def test_symmetries_align_board_moves_and_policy(self):
        moves = [17, 35, 38, 71]
        key, _ = canonical_game(moves)
        board = np.zeros(225, dtype=np.uint8)
        for ply, pos in enumerate(moves):
            board[pos] = 1 + ply % 2
        for inverse, perm in zip(INVERSES, PERMS):
            transformed = inverse[moves].tolist()
            self.assertEqual(canonical_game(transformed)[0], key)
            self.assertEqual(position_key(board), position_key(board[perm]))
            np.testing.assert_array_equal(board[perm][transformed], [1, 2, 1, 2])
        sample = Sample(board, np.zeros(225, dtype=np.float32), 0.2, 1.0, 5, False)
        encoded = PositionDataset([sample])[0][0]
        colors = [None if x == 0 else "black" if x == 1 else "white" for x in board]
        np.testing.assert_array_equal(encoded, board_to_tensor(colors, "white").numpy())

    def test_duplicate_searches_are_averaged_and_split_together(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "games.sqlite"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, batch_id TEXT, "
                        "black_model TEXT, white_model TEXT, winner TEXT, moves TEXT, policies TEXT)")
            first = [17, 35, 38]
            sequences = [first + list(range(100, 100 + extra)) for extra in range(10)]
            sequences.append(INVERSES[3, first].tolist())
            for index, moves in enumerate(sequences):
                q = 0.8 if index == 10 else 0.2
                policies = [{"t": False, "q": q, "d": {str(p): 10}} for p in moves]
                con.execute("INSERT INTO games VALUES (?, 'teacher', 't', 't', 'black', ?, ?)",
                            (index + 1, json.dumps(moves), json.dumps(policies)))
            con.commit()
            con.close()
            games, metadata = load_games(db, ["teacher"])
            self.assertEqual(len(games), 10)
            duplicate = next(g for g in games.values() if len(g) == 3)
            self.assertAlmostEqual(duplicate[0].q, 0.5)
            canonical, _ = canonical_game(first)
            self.assertEqual(int(duplicate[0].policy.argmax()), canonical[0])
            self.assertEqual(float(duplicate[0].policy.sum()), 1.0)
            split_path = Path(tmp) / "split.json"
            split_games(games, metadata, split_path, 0)
            original = split_path.read_text()
            split_games(games, metadata, split_path, 0)
            self.assertEqual(split_path.read_text(), original)
            split = json.loads(original)["split"]
            self.assertEqual([len(split[k]) for k in ("train", "val", "test")], [8, 1, 1])
            self.assertEqual(len(set(sum(split.values(), []))), 10)
            with self.assertRaises(ValueError):
                split_games(games, metadata, split_path, 1)

    def test_tactical_value_does_not_train_policy_or_use_missing_q(self):
        logits = torch.zeros((2, 225), requires_grad=True)
        v = torch.zeros((2, 1), requires_grad=True)
        policies = torch.zeros((2, 225))
        policies[0, 50] = 1
        q, z = torch.tensor([0.2, 0.0]), torch.tensor([1.0, -1.0])
        tactical = torch.tensor([False, True])
        loss = losses(v, logits, policies, q, z, tactical, 0.5, 0.25)
        expected = (np.log(225) + 0.6 ** 2 + 0.25) / 2
        self.assertAlmostEqual(loss.item(), expected, places=5)
        loss.backward()
        self.assertEqual(float(logits.grad[1].abs().sum()), 0.0)
        self.assertAlmostEqual(v.grad[1].item(), 0.25)
        only_tactical = losses(v[1:], logits[1:], policies[1:], q[1:], z[1:], tactical[1:], 0.5, 0.25)
        self.assertAlmostEqual(only_tactical.item(), 0.25)

    def test_metrics_are_sample_weighted_and_track_unseen_positions(self):
        class ConstantModel(torch.nn.Module):
            def forward(self, x):
                return torch.zeros(len(x), 1), torch.zeros(len(x), 225)

        policy = np.zeros(225, dtype=np.float32)
        policy[5] = 1
        board = np.zeros(225, dtype=np.uint8)
        other = board.copy()
        other[17] = 1
        samples = [Sample(board, policy, 0.0, 1.0, 0, False),
                   Sample(other, policy, 1.0, -1.0, 1, False),
                   Sample(other, policy * 0, 0.0, -1.0, 1, True)]
        metrics = evaluate(ConstantModel(), samples, "cpu", 0.5, {position_key(board)}, 2)
        self.assertAlmostEqual(metrics["quiet"]["mse_target"], 0.125)
        self.assertEqual(metrics["quiet_unseen"]["n"], 1)
        self.assertEqual(metrics["tactical"]["n"], 1)
        self.assertIsNone(metrics["quiet"]["corr_z"])
        self.assertNotIn("mse_q", metrics["tactical"])
        json.dumps(metrics, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
