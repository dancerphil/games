import unittest

import numpy as np
import torch

from train.train_sqlite_v5 import Sample, evaluate
from train.train_sqlite_v6 import losses, validation_score


class V6LossTests(unittest.TestCase):
    def batch(self, tactical):
        n = len(tactical)
        boards = torch.zeros(n, 3, 15, 15)
        boards[:, 2] = 1
        boards[:, 2, 0, 0] = 0
        policy = torch.zeros(n, 225)
        policy[:, 112] = 1
        return (torch.zeros(n, 1, requires_grad=True),
                torch.zeros(n, 225, requires_grad=True), boards, policy,
                torch.full((n,), 0.4), torch.ones(n), torch.tensor(tactical))

    def test_occupied_logits_do_not_affect_loss_or_gradient(self):
        args = self.batch([False, True])
        with torch.no_grad():
            args[1][:, 0] = 1000
        loss = losses(*args, 0.25, 0.25)
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertTrue(torch.isfinite(args[1].grad).all())
        self.assertEqual(args[1].grad[:, 0].abs().sum().item(), 0)
        self.assertLess(args[1].grad[0, 112].item(), 0)
        self.assertEqual(args[1].grad[1].abs().sum().item(), 0)

    def test_tactical_proportion_does_not_dilute_quiet_loss(self):
        a = losses(*self.batch([False, True]), 0.25, 0.25)
        b = losses(*self.batch([False, True, True, True]), 0.25, 0.25)
        torch.testing.assert_close(a, b)

    def test_all_tactical_ignores_policy_and_q(self):
        args = self.batch([True, True])
        args[4].fill_(float("nan"))
        loss = losses(*args, 0.25, 0.25)
        self.assertAlmostEqual(loss.item(), 0.25)
        loss.backward()
        self.assertEqual(args[1].grad.abs().sum().item(), 0)

    def test_opening_metrics_measure_network_without_candidate_mask(self):
        class CornerModel(torch.nn.Module):
            def forward(self, boards):
                logits = torch.zeros(len(boards), 225)
                logits[:, 0] = 10
                return torch.zeros(len(boards), 1), logits

        empty = np.zeros(225, dtype=np.uint8)
        single = empty.copy()
        single[0] = 1
        policy = np.zeros(225, dtype=np.float32)
        policy[112] = 1
        samples = [Sample(empty, policy, 0, 1, 0, False),
                   Sample(single, policy, 0, -1, 1, False)]
        result = evaluate(CornerModel(), samples, torch.device("cpu"), 0.25, set(), 2,
                          legal_mask=True)
        self.assertEqual(result["quiet_first_move"]["top1"], 0)
        self.assertGreater(result["quiet_first_move"]["ce"], result["quiet_second_move"]["ce"])
        self.assertTrue(np.isfinite(result["quiet"]["loss"]))

    def test_selection_includes_tactical_value(self):
        metrics = {"quiet": {"loss": 2.0}, "tactical": {"mse_z": 0.8}}
        self.assertAlmostEqual(validation_score(metrics, 0.25), 2.2)


if __name__ == "__main__":
    unittest.main()
