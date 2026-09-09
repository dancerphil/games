#!/usr/bin/env python3
"""无界面自对弈批量脚本：多模型两两对比（含各自自战），结果存 ~/.games/selfplay.sqlite。

用法示例（4 模型两两含自战各 100 局、每手 5s、4 并发，跑一整夜）：
    pnpm selfplay
    pnpm selfplay -- --games-per-pair 100 --time-limit-ms 5000 --workers 4
    nohup pnpm selfplay &

日志自动追加到 ~/.games/selfplay-<batch-id>.log，无需 shell 重定向。

 断点续跑：同一 --batch-id 已落库的对局会自动跳过，可直接重跑同一命令。
 查看可用模型：python python/selfplay.py --list-models

 ELO：每局落库时同步更新 elo_ratings 表（初始 1500，K=32，平局各 0.5），
 与 batch 无关——后续任何 batch 的对战都会继续更新同一份 ELO。
 初始定级赛（8 模型两两 5 黑 5 白共 360 局）：
     python python/selfplay.py --games-per-pair 10 --time-limit-ms 5000 --workers 4 --batch-id elo-seed
 查看当前 ELO：python python/selfplay.py --show-elo
 按 id 重放全部对局重建 ELO（修复用）：python python/selfplay.py --recalc-elo
"""
import argparse
import concurrent.futures
import itertools
import json
import os
import sqlite3
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

BOARD_SIZE = 15
DEFAULT_DB = os.path.expanduser("~/.games/selfplay.sqlite")

ELO_INIT = 1500.0
ELO_K = 32.0


class Tee:
    """同时写控制台和日志文件。"""

    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)

    def flush(self):
        for s in self.streams:
            s.flush()


def list_models():
    from models import REGISTRY
    return sorted(REGISTRY.keys())


def ensure_schema(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    con = sqlite3.connect(db_path)
    con.execute(
        """CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,
            black_model TEXT NOT NULL,
            white_model TEXT NOT NULL,
            winner TEXT NOT NULL,
            moves TEXT NOT NULL,
            num_moves INTEGER NOT NULL,
            time_limit_ms INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            policies TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )
    cols = {r[1] for r in con.execute("PRAGMA table_info(games)")}
    if "policies" not in cols:
        con.execute("ALTER TABLE games ADD COLUMN policies TEXT")
    con.execute("CREATE INDEX IF NOT EXISTS idx_games_batch ON games(batch_id)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_games_models ON games(black_model, white_model)")
    con.execute(
        """CREATE TABLE IF NOT EXISTS elo_ratings (
            model TEXT PRIMARY KEY,
            rating REAL NOT NULL,
            games INTEGER NOT NULL DEFAULT 0,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )
    con.commit()
    return con


def expected_score(ra, rb):
    """ELO 期望得分：ra 对 rb 的胜率期望。"""
    return 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))


def get_ratings(con):
    cur = con.execute(
        "SELECT model, rating, games, wins, losses, draws FROM elo_ratings ORDER BY rating DESC")
    return [
        {"model": r[0], "rating": r[1], "games": r[2],
         "wins": r[3], "losses": r[4], "draws": r[5]}
        for r in cur.fetchall()
    ]


def print_ratings(con):
    rows = get_ratings(con)
    if not rows:
        print("[elo] no ratings yet")
        return
    print(f"{'model':<20}{'elo':>8}  W-D-L (games)")
    for r in rows:
        print(f"{r['model']:<20}{r['rating']:>8.0f}  "
              f"{r['wins']}-{r['draws']}-{r['losses']} ({r['games']})")


def apply_elo(con, black_model, white_model, winner):
    """按一局结果更新双方 ELO，不 commit，由调用方统一提交。

    自战（同模型）时先后两次更新净变化恰为 0，只累计场次胜负。
    """
    for m in (black_model, white_model):
        con.execute("INSERT OR IGNORE INTO elo_ratings (model, rating) VALUES (?, ?)",
                    (m, ELO_INIT))
    if winner == "draw":
        sb, sw = 0.5, 0.5
        rb, rw = "draw", "draw"
    elif winner == "black":
        sb, sw = 1.0, 0.0
        rb, rw = "win", "loss"
    else:
        sb, sw = 0.0, 1.0
        rb, rw = "loss", "win"
    # 顺序更新：后一方读到前一方的最新分；自战时净变化恰为 0
    _move_elo(con, black_model, white_model, sb, rb)
    _move_elo(con, white_model, black_model, sw, rw)


def _move_elo(con, model, opp_model, actual, result):
    rating = con.execute("SELECT rating FROM elo_ratings WHERE model = ?",
                         (model,)).fetchone()[0]
    opp = con.execute("SELECT rating FROM elo_ratings WHERE model = ?",
                      (opp_model,)).fetchone()[0]
    new_rating = rating + ELO_K * (actual - expected_score(rating, opp))
    col = {"win": "wins", "loss": "losses", "draw": "draws"}[result]
    con.execute(f"UPDATE elo_ratings SET rating = ?, games = games + 1, "  # noqa: S608 - col 来自内部常量
                f"{col} = {col} + 1, updated_at = datetime('now') WHERE model = ?",
                (new_rating, model))


def recalc_elo(con):
    """按 id 顺序重放全部对局重建 ELO（修复用）。"""
    con.execute("DELETE FROM elo_ratings")
    games = con.execute(
        "SELECT black_model, white_model, winner FROM games ORDER BY id").fetchall()
    for b, w, winner in games:
        apply_elo(con, b, w, winner)
    con.commit()
    print(f"[elo] recalculated from {len(games)} games")


def existing_counts(con, batch_id):
    cur = con.execute(
        "SELECT black_model, white_model, COUNT(*) FROM games WHERE batch_id = ? GROUP BY black_model, white_model",
        (batch_id,),
    )
    return {(r[0], r[1]): r[2] for r in cur.fetchall()}


def play_one(task):
    """单个对局（跑在子进程）。返回可直接落库的 dict。"""
    import time as _time

    from models import REGISTRY
    from mcts import check_win_at

    black_model = task["black_model"]
    white_model = task["white_model"]
    time_limit_ms = task["time_limit_ms"]
    board = [None] * (BOARD_SIZE * BOARD_SIZE)
    moves = []
    policies = []
    winner = "draw"
    started = _time.monotonic()
    current = "black"
    fns = {"black": REGISTRY[black_model], "white": REGISTRY[white_model]}

    # 局部 import 避免循环依赖
    from mcts import get_best_move_with_stats

    for _ in range(BOARD_SIZE * BOARD_SIZE):
        pos, visits, tactical = get_best_move_with_stats(
            board, current, fns[current], time_limit_ms=time_limit_ms)
        policies.append({"d": visits, "t": tactical})
        if board[pos] is not None:
            # 非法落子极少见：判负，避免坏数据污染统计
            winner = "white" if current == "black" else "black"
            break
        board[pos] = current
        moves.append(pos)
        if check_win_at(board, pos, current):
            winner = current
            break
        current = "white" if current == "black" else "black"
    else:
        winner = "draw"

    duration_ms = int((_time.monotonic() - started) * 1000)
    return {
        "black_model": black_model,
        "white_model": white_model,
        "winner": winner,
        "moves": moves,
        "policies": policies,
        "num_moves": len(moves),
        "duration_ms": duration_ms,
    }


def build_tasks(models, games_per_pair):
    tasks = []
    for a, b in itertools.combinations_with_replacement(models, 2):
        for k in range(games_per_pair):
            if k % 2 == 0:
                tasks.append({"black_model": a, "white_model": b, "pair": f"{a} vs {b}"})
            else:
                tasks.append({"black_model": b, "white_model": a, "pair": f"{a} vs {b}"})
    return tasks


def main():
    parser = argparse.ArgumentParser(description="gomoku headless selfplay")
    parser.add_argument("--models", default=",".join(
        ["heuristic-puct-v1", "heuristic-uct-v1",
         "nn-puct-v1", "nn-uct-v1", "nn-puct-v2", "nn-uct-v2",
         "nn-puct-v3", "nn-uct-v3"]),
        help="逗号分隔的模型名，默认 8 个全量")
    parser.add_argument("--games-per-pair", type=int, default=100, help="每无序对局数（黑白各半）")
    parser.add_argument("--time-limit-ms", type=int, default=5000, help="每手思考毫秒数")
    parser.add_argument("--workers", type=int, default=4, help="并发进程数")
    parser.add_argument("--db", default=DEFAULT_DB, help="sqlite 路径")
    parser.add_argument("--batch-id", required=False, default=None, help="同一 batch 可断点续跑")
    parser.add_argument("--list-models", action="store_true")
    parser.add_argument("--show-elo", action="store_true", help="只打印当前 ELO，不开跑")
    parser.add_argument("--recalc-elo", action="store_true", help="重放全部对局重建 ELO 后退出")
    parser.add_argument("--dry-run", action="store_true", help="只打印任务数，不开跑")
    args = parser.parse_args()

    if args.show_elo:
        con = ensure_schema(args.db)
        print_ratings(con)
        con.close()
        return

    if args.recalc_elo:
        con = ensure_schema(args.db)
        recalc_elo(con)
        print_ratings(con)
        con.close()
        return

    if not args.batch_id:
        print("need --batch-id (or use --show-elo / --recalc-elo)", file=sys.stderr)
        sys.exit(2)

    if args.list_models:
        print(" ".join(list_models()))
        return

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    available = set(list_models())
    unknown = [m for m in models if m not in available]
    if unknown:
        print(f"unknown model: {unknown}, available: {sorted(available)}", file=sys.stderr)
        sys.exit(1)
    if len(models) < 2:
        print("至少需要 2 个模型", file=sys.stderr)
        sys.exit(1)

    tasks = build_tasks(models, args.games_per_pair)
    for t in tasks:
        t["time_limit_ms"] = args.time_limit_ms

    con = ensure_schema(args.db)
    done = existing_counts(con, args.batch_id)
    # 按有序 (black,white) 跳过已落库的前 N 个
    seen: dict = {}
    pending = []
    skipped = 0
    for t in tasks:
        key = (t["black_model"], t["white_model"])
        n = seen.get(key, 0)
        if n < done.get(key, 0):
            seen[key] = n + 1
            skipped += 1
            continue
        seen[key] = n + 1
        pending.append(t)

    total = len(tasks)
    print(f"[selfplay] batch={args.batch_id} models={models}")
    print(f"[selfplay] pairs={len(models) * (len(models) + 1) // 2} games_per_pair={args.games_per_pair} "
          f"total={total} skipped={skipped} pending={len(pending)} "
          f"time_limit={args.time_limit_ms}ms workers={args.workers} db={args.db}")
    if args.dry_run or not pending:
        if not pending:
            print("[selfplay] nothing to do, all done.")
        con.close()
        return

    log_path = os.path.expanduser(f"~/.games/selfplay-{args.batch_id}.log")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    log_file = open(log_path, "a")
    sys.stdout = Tee(sys.stdout, log_file)
    sys.stderr = Tee(sys.stderr, log_file)
    print(f"[selfplay] logging to {log_path}")

    started_all = time.monotonic()
    finished = skipped
    wins: dict = {}
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
            future_to_task = {pool.submit(play_one, t): t for t in pending}
            for fut in concurrent.futures.as_completed(future_to_task):
                task = future_to_task[fut]
                try:
                    r = fut.result()
                except Exception as e:  # noqa: BLE001 - 子进程异常只记日志，不中断整夜任务
                    print(f"[selfplay] ERROR {task['black_model']} vs {task['white_model']}: {e}",
                          file=sys.stderr, flush=True)
                    continue
                con.execute(
                    "INSERT INTO games (batch_id, black_model, white_model, winner, moves, "
                    "num_moves, time_limit_ms, duration_ms, policies) VALUES (?,?,?,?,?,?,?,?,?)",
                    (args.batch_id, r["black_model"], r["white_model"], r["winner"],
                     json.dumps(r["moves"]), r["num_moves"], args.time_limit_ms, r["duration_ms"],
                     json.dumps(r["policies"])),
                )
                apply_elo(con, r["black_model"], r["white_model"], r["winner"])
                con.commit()
                finished += 1
                key = (r["black_model"], r["white_model"], r["winner"])
                wins[key] = wins.get(key, 0) + 1
                elapsed = time.monotonic() - started_all
                eta = elapsed / max(1, finished - skipped) * (len(pending) - (finished - skipped))
                print(f"[selfplay] [{finished}/{total}] black={r['black_model']} white={r['white_model']} "
                      f"winner={r['winner']} moves={r['num_moves']} "
                      f"game={r['duration_ms'] // 1000}s elapsed={int(elapsed // 60)}m eta={int(eta // 60)}m",
                      flush=True)
    except KeyboardInterrupt:
        print(f"\n[selfplay] interrupted, progress saved ({finished}/{total}). rerun same command to resume.",
              flush=True)
    finally:
        con.close()

    elapsed = time.monotonic() - started_all
    print(f"[selfplay] done batch={args.batch_id} finished={finished}/{total} "
          f"elapsed={int(elapsed // 60)}m at {datetime.now().isoformat(timespec='seconds')}")
    con = ensure_schema(args.db)
    print_ratings(con)
    con.close()


if __name__ == "__main__":
    main()
