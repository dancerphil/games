#!/usr/bin/env python3
"""无界面自对弈批量脚本：多模型两两对比（含各自自战），结果存 sqlite 并同步更新 ELO。

用法（推荐走 pnpm 脚本，参数集中在 package.json）：
    pnpm train           # --mode train：nn-v4 vs nn4-policy-h2-value 头对头 200 局
    pnpm teacher         # --mode teacher：ELO 第一的模型自战 1000 局
    pnpm init-elo        # --mode init-elo：单模型 vs 其他各模型各 10 局定级
    pnpm update-elo      # --mode update-elo：全模型两两对战（不含自战）各 10 局
    python python/selfplay.py --show-elo        # 评级 + 可用模型
    python python/selfplay.py --recalc-elo      # 重放全部对局重建 ELO（修复用）

所有对局统一协议（5s/手、8 workers、前 4 手开局采样）写同一 DB，
每局都更新 ELO；batch-id 用于筛选与断点续跑（显式指定同一 id 可续跑；
缺省按 {mode}-{日期} 自动派生，同日重复执行依次 -2、-3…）。并行写同一 DB 安全（WAL + 单事务），
合计 workers 别超 CPU 核数，time-limit 是墙钟，超载会拉低每手有效模拟数。
日志统一写 ~/.games/logs/selfplay-<batch-id>.log。
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
    # WAL + busy_timeout + 手动事务：支持多个批次进程并行写同一 DB，
    # ELO 读改写包在 BEGIN IMMEDIATE 单事务内，消除并发丢更新。
    con = sqlite3.connect(db_path, timeout=30.0, isolation_level=None)
    con.execute("PRAGMA busy_timeout=30000")
    # journal_mode 变更需要独占且不吃 busy_timeout：并发启动时轮询等待
    # （WAL 是持久属性，对端设好即可）
    for _ in range(30):
        try:
            con.execute("PRAGMA journal_mode=WAL")
            break
        except sqlite3.OperationalError:
            time.sleep(1.0)
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
    return con


def top_rated_model(db_path):
    """ELO 第一的模型名（teacher 预设用）。"""
    con = ensure_schema(db_path)
    row = con.execute(
        "SELECT model FROM elo_ratings ORDER BY rating DESC LIMIT 1").fetchone()
    con.close()
    if not row:
        print("elo_ratings 为空，无法确定 teacher 模型", file=sys.stderr)
        sys.exit(1)
    return row[0]


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
    con.execute("BEGIN IMMEDIATE")
    con.execute("DELETE FROM elo_ratings")
    games = con.execute(
        "SELECT black_model, white_model, winner FROM games ORDER BY id").fetchall()
    for b, w, winner in games:
        apply_elo(con, b, w, winner)
    con.execute("COMMIT")
    print(f"[elo] recalculated from {len(games)} games")


def existing_counts(con, batch_id):
    cur = con.execute(
        "SELECT black_model, white_model, COUNT(*) FROM games WHERE batch_id = ? GROUP BY black_model, white_model",
        (batch_id,),
    )
    return {(r[0], r[1]): r[2] for r in cur.fetchall()}


def play_one(task):
    """单个对局（跑在子进程）。返回可直接落库的 dict。"""
    import random
    import time as _time

    from models import REGISTRY
    from mcts import check_win_at

    black_model = task["black_model"]
    white_model = task["white_model"]
    time_limit_ms = task["time_limit_ms"]
    sample_moves = task.get("sample_moves", 0)
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
        pos, visits, tactical, root_q = get_best_move_with_stats(
            board, current, fns[current], time_limit_ms=time_limit_ms)
        # 开局多样化：前 N 手按 visit 分布采样（仅非 tactical 步），
        # 避免确定性自对弈重放同一棋路；visit 分布仍照记作 policy 目标
        if sample_moves and len(moves) < sample_moves and not tactical and len(visits) > 1:
            pos = random.choices(list(visits.keys()), weights=visits.values())[0]
        step = {"d": visits, "t": tactical}
        if not tactical:
            step["q"] = root_q
        policies.append(step)
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


def build_tasks(models, games_per_pair, no_self=False, vs=None):
    """vs 模式：只跑该模型 vs 其他模型（不含自战），用于新模型定级。"""
    if vs:
        pairs = [(vs, m) for m in models if m != vs]
    else:
        pairs = (itertools.combinations(models, 2) if no_self
                 else itertools.combinations_with_replacement(models, 2))
    tasks = []
    for a, b in pairs:
        for k in range(games_per_pair):
            if k % 2 == 0:
                tasks.append({"black_model": a, "white_model": b, "pair": f"{a} vs {b}"})
            else:
                tasks.append({"black_model": b, "white_model": a, "pair": f"{a} vs {b}"})
    return tasks


# 常驻工作流预设：mode 定职责，显式参数可覆盖预设值。
# 所有对局统一协议（5s/手、开局采样 4 手）写同一 DB，每局都更新 ELO，
# batch-id 仅用于筛选与断点续跑（缺省 {mode}-{日期}，同日 -2、-3…）。
MODE_PRESETS = {
    # train：nn4-policy-h2v80 vs nn4-policy-h2-value 头对头 200 局（不含自战）
    "train": {"models": ["nn4-policy-h2v80", "nn4-policy-h2-value"], "games_per_pair": 200, "no_self": True},
    # 新模型定级：vs 其他各模型，不含自战
    "init-elo": {"no_self": True, "games_per_pair": 10},
    # 全池更新：全部注册模型两两对战，不含自战
    "update-elo": {"no_self": True, "games_per_pair": 10},
    # 老师数据生成：ELO 第一的模型自战 1000 局
    "teacher": {"games_per_pair": 1000},
}
LOG_DIR = os.path.expanduser("~/.games/logs")


def next_batch_id(con, mode):
    """按天派生 batch-id：{mode}-{YYYYMMDD}，同日重复执行依次 -2、-3…"""
    base = f"{mode or 'selfplay'}-{datetime.now().strftime('%Y%m%d')}"
    existing = {r[0] for r in con.execute("SELECT DISTINCT batch_id FROM games")}
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def main():
    parser = argparse.ArgumentParser(description="gomoku headless selfplay")
    parser.add_argument("--mode", default=None, choices=[*MODE_PRESETS],
                        help="train=nn-v4 vs nn4-policy-h2-value 200 局 / teacher=ELO 第一自战 1000 局 / init-elo=单模型定级（需 --vs）/ update-elo=全模型两两对战；缺省=含自战循环赛")
    parser.add_argument("--models", default=None,
                        help="逗号分隔的模型名，默认全部已注册模型（train/teacher 预设另定）")
    parser.add_argument("--vs", default=None,
                        help="只跑该模型 vs 其他各模型（init-elo 必填），定级用")
    parser.add_argument("--games-per-pair", type=int, default=None,
                        help="每无序对局数（黑白各半），缺省按 mode 预设，无 mode 为 10")
    parser.add_argument("--time-limit-ms", type=int, default=5000, help="每手思考毫秒数")
    parser.add_argument("--workers", type=int, default=8, help="并发进程数")
    parser.add_argument("--db", default=DEFAULT_DB, help="sqlite 路径")
    parser.add_argument("--batch-id", default=None,
                        help="同一 batch 断点续跑；缺省按 {mode}-{日期} 自动派生，同日 -2、-3…")
    parser.add_argument("--show-elo", action="store_true", help="打印当前 ELO 与可用模型，不开跑")
    parser.add_argument("--recalc-elo", action="store_true", help="重放全部对局重建 ELO 后退出")
    parser.add_argument("--no-self", action="store_true", default=None,
                        help="只跑不同模型两两对战，不含自战")
    parser.add_argument("--sample-moves", type=int, default=4,
                        help="前 N 手按 visit 分布采样开局（统一协议 4；0=确定性）")
    args = parser.parse_args()

    if args.show_elo:
        con = ensure_schema(args.db)
        print_ratings(con)
        print("[elo] available models:", " ".join(list_models()))
        con.close()
        return

    if args.recalc_elo:
        con = ensure_schema(args.db)
        recalc_elo(con)
        print_ratings(con)
        con.close()
        return

    preset = MODE_PRESETS.get(args.mode, {})
    if args.mode == "init-elo" and not args.vs:
        print("--mode init-elo 需要 --vs MODEL", file=sys.stderr)
        sys.exit(2)
    for key, value in preset.items():
        if getattr(args, key) is None:
            setattr(args, key, value)
    if args.games_per_pair is None:
        args.games_per_pair = 10
    if args.mode == "teacher" and args.models is None:
        args.models = [top_rated_model(args.db)]

    if isinstance(args.models, list):
        models = args.models
    elif args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        models = list_models()
    available = set(list_models())
    unknown = [m for m in models if m not in available] + (
        [args.vs] if args.vs and args.vs not in available else [])
    if unknown:
        print(f"unknown model: {unknown}, available: {sorted(available)}", file=sys.stderr)
        sys.exit(1)
    if len(models) < 2 and not args.vs and args.mode != "teacher":
        print("至少需要 2 个模型", file=sys.stderr)
        sys.exit(1)
    if args.vs and args.vs not in models:
        models = [args.vs, *models]
    con = ensure_schema(args.db)
    batch_id = args.batch_id or next_batch_id(con, args.mode)

    tasks = build_tasks(models, args.games_per_pair, args.no_self, args.vs)
    for t in tasks:
        t["time_limit_ms"] = args.time_limit_ms
        t["sample_moves"] = args.sample_moves

    done = existing_counts(con, batch_id)
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
    if args.vs:
        n_pairs = len(models) - 1
    else:
        n_pairs = (len(models) * (len(models) - 1) // 2) if args.no_self else (len(models) * (len(models) + 1) // 2)
    print(f"[selfplay] batch={batch_id} models={models}")
    print(f"[selfplay] pairs={n_pairs} games_per_pair={args.games_per_pair} "
          f"total={total} skipped={skipped} pending={len(pending)} "
          f"time_limit={args.time_limit_ms}ms workers={args.workers} db={args.db}")
    if not pending:
        print("[selfplay] nothing to do, all done.")
        con.close()
        return

    log_path = os.path.join(LOG_DIR, f"selfplay-{batch_id}.log")
    os.makedirs(LOG_DIR, exist_ok=True)
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
                    # 单事务写局分 + ELO：并行批次下原子，busy_timeout 兜底锁等待
                    con.execute("BEGIN IMMEDIATE")
                    con.execute(
                        "INSERT INTO games (batch_id, black_model, white_model, winner, moves, "
                        "num_moves, time_limit_ms, duration_ms, policies) VALUES (?,?,?,?,?,?,?,?,?)",
                        (batch_id, r["black_model"], r["white_model"], r["winner"],
                         json.dumps(r["moves"]), r["num_moves"], args.time_limit_ms, r["duration_ms"],
                         json.dumps(r["policies"])),
                    )
                    apply_elo(con, r["black_model"], r["white_model"], r["winner"])
                    con.execute("COMMIT")
                except Exception as e:  # noqa: BLE001 - 子进程/落库异常只记日志，不中断整夜任务
                    print(f"[selfplay] ERROR {task['black_model']} vs {task['white_model']}: {e}",
                          file=sys.stderr, flush=True)
                    continue
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
    print(f"[selfplay] done batch={batch_id} finished={finished}/{total} "
          f"elapsed={int(elapsed // 60)}m at {datetime.now().isoformat(timespec='seconds')}")
    con = ensure_schema(args.db)
    print_ratings(con)
    con.close()


if __name__ == "__main__":
    main()
