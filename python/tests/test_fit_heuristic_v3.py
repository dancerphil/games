import unittest

import numpy as np

from train.fit_heuristic_v3 import fit, load_rows, violations
from models.heuristic_v3 import FEATURES, V3_SCORE, line_features, score_features


class FittingTests(unittest.TestCase):
    def test_reference_satisfies_dataset(self):
        rows = load_rows()
        fitted = fit(rows)
        self.assertEqual(fitted, V3_SCORE)
        self.assertFalse(violations(rows, fitted))

    def test_repair_bad_weights_and_preserve_features(self):
        rows = load_rows()
        line = [None] * 3 + ["black"] * 2 + [None] * 3
        before = line_features(line)
        initial = {**V3_SCORE, "THREE_HALF": 20.0, "TWO_OPEN": 4.0, "FOUR_GAP31": 105.0}
        self.assertTrue(violations(rows, initial))
        fitted = fit(rows, initial)
        self.assertFalse(violations(rows, fitted))
        self.assertEqual(fitted["FOUR_HALF"], 100)
        self.assertEqual(before, line_features(line))
        self.assertGreater(score_features(before.features, fitted), fitted["THREE_HALF"])
        self.assertLessEqual(fitted["SPACE"], 0.25)
        self.assertLessEqual(fitted["CENTER"], 0.05)

    def test_validation_is_not_fitted(self):
        rows = load_rows()
        row = dict(rows[0], id="impossible-heldout", split="validation", delta=np.zeros(len(FEATURES)), margin=1)
        fitted = fit([*rows, row])
        self.assertEqual(fitted, V3_SCORE)
        self.assertEqual(violations([row], fitted)[0]["id"], "impossible-heldout")

    def test_missing_feature_fails_early(self):
        row = {"id": "missing-feature", "delta": np.zeros(len(FEATURES)), "margin": 1}
        with self.assertRaisesRegex(ValueError, "Identical features"):
            fit([row])

    def test_conflicting_constraints_are_exposed(self):
        delta = np.zeros(len(FEATURES))
        delta[FEATURES.index("ONE_OPEN")] = 1
        delta[FEATURES.index("TWO_HALF")] = -1
        rows = [{"id": "a>b", "delta": delta, "margin": 1},
                {"id": "b>a", "delta": -delta, "margin": 1}]
        with self.assertRaisesRegex(ValueError, "did not converge"):
            fit(rows, max_iterations=100)


if __name__ == "__main__":
    unittest.main()
