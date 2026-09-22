import tempfile
import unittest
from pathlib import Path

from python.selfplay.db import ensure_schema, insert_game, select_batch_id
from python.selfplay.runner import _pending_tasks
from python.selfplay.tasks import build_tasks


class SelfplayResumeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.con = ensure_schema(str(Path(self.directory.name) / "selfplay.sqlite"))
        self.addCleanup(self.con.close)

    def save_game(self, batch_id, black="a", white="a", time_limit=5000):
        insert_game(self.con, batch_id, {
            "black_model": black, "white_model": white, "winner": "draw",
            "moves": [], "num_moves": 0, "duration_ms": 0, "policies": [],
        }, time_limit)

    def select(self, mode="teacher", models=None, games=4, time_limit=5000, sample_moves=4):
        tasks = build_tasks(models or ["a"], games, no_self=mode != "teacher")
        return select_batch_id(self.con, mode, tasks, time_limit, sample_moves)

    def test_resume_legacy_batch_across_dates_and_skip_saved_games(self):
        batch = "teacher-20200101-2"
        self.save_game(batch)
        self.save_game(batch)
        self.assertEqual(self.select(), batch)
        pending, skipped = _pending_tasks(self.con, build_tasks(["a"], 4), batch)
        self.assertEqual((len(pending), skipped), (2, 2))

    def test_resume_before_first_game_and_create_new_after_completion(self):
        batch = self.select()
        self.assertEqual(self.select(), batch)
        for _ in range(4):
            self.save_game(batch)
        self.assertNotEqual(self.select(), batch)

    def test_config_changes_start_new_batches(self):
        for change in ({"models": ["b"]}, {"games": 6}, {"time_limit": 1000},
                       {"sample_moves": 0}, {"models": ["a", "b"]}):
            with self.subTest(change=change):
                batch = self.select()
                self.assertNotEqual(self.select(**change), batch)
                self.assertEqual(self.select(), batch)

    def test_legacy_wrong_model_or_time_limit_is_not_resumed(self):
        self.save_game("teacher-20200101", black="b", white="b")
        self.save_game("teacher-20200102", time_limit=1000)
        self.assertNotIn(self.select(), ["teacher-20200101", "teacher-20200102"])

    def test_latest_matching_legacy_batch_is_selected(self):
        self.save_game("teacher-20200101")
        self.save_game("teacher-20200102")
        self.con.execute("UPDATE games SET created_at = '2020-01-01' "
                         "WHERE batch_id = 'teacher-20200101'")
        self.assertEqual(self.select(), "teacher-20200102")

    def test_train_and_update_elo_resume_each_color_separately(self):
        for mode in ("train", "update-elo"):
            with self.subTest(mode=mode):
                batch = self.select(mode=mode, models=["a", "b"])
                self.save_game(batch, "a", "b")
                self.save_game(batch, "a", "b")
                self.assertEqual(self.select(mode=mode, models=["a", "b"]), batch)
                pending, skipped = _pending_tasks(
                    self.con, build_tasks(["a", "b"], 4, no_self=True), batch)
                self.assertEqual(skipped, 2)
                self.assertEqual([(t["black_model"], t["white_model"]) for t in pending],
                                 [("b", "a"), ("b", "a")])


if __name__ == "__main__":
    unittest.main()
