from collections import Counter
import json
import os
import sqlite3
import time

from .config import ELO_INIT


def ensure_schema(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    con = sqlite3.connect(db_path, timeout=30.0, isolation_level=None)
    con.execute("PRAGMA busy_timeout=30000")
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
    cols = {row[1] for row in con.execute("PRAGMA table_info(games)")}
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
    con.execute(
        """CREATE TABLE IF NOT EXISTS selfplay_batches (
            batch_id TEXT PRIMARY KEY,
            config TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"""
    )
    return con


def list_models():
    from ..models import REGISTRY
    return sorted(REGISTRY.keys())


def get_ratings(con):
    rows = con.execute(
        "SELECT model, rating, games, wins, losses, draws "
        "FROM elo_ratings ORDER BY rating DESC"
    ).fetchall()
    return [
        {"model": row[0], "rating": row[1], "games": row[2],
         "wins": row[3], "losses": row[4], "draws": row[5]}
        for row in rows
    ]


def print_ratings(con):
    rows = get_ratings(con)
    if not rows:
        print("[elo] no ratings yet")
        return
    print(f"{'model':<20}{'elo':>8}  W-D-L (games)")
    for row in rows:
        print(f"{row['model']:<20}{row['rating']:>8.0f}  "
              f"{row['wins']}-{row['draws']}-{row['losses']} ({row['games']})")


def existing_counts(con, batch_id):
    rows = con.execute(
        "SELECT black_model, white_model, COUNT(*) FROM games "
        "WHERE batch_id = ? GROUP BY black_model, white_model",
        (batch_id,),
    ).fetchall()
    return {(row[0], row[1]): row[2] for row in rows}


def next_batch_id(con, mode):
    from datetime import datetime

    base = f"{mode or 'selfplay'}-{datetime.now().strftime('%Y%m%d')}"
    existing = {row[0] for row in con.execute(
        "SELECT batch_id FROM games UNION SELECT batch_id FROM selfplay_batches"
    )}
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def select_batch_id(con, mode, tasks, time_limit_ms, sample_moves):
    """续跑最近的匹配批次；旧批次仅能按已保存的配对和时限匹配。"""
    target = Counter((task["black_model"], task["white_model"]) for task in tasks)
    config = json.dumps({
        "mode": mode,
        "pairs": [(*pair, count) for pair, count in sorted(target.items())],
        "time_limit_ms": time_limit_ms,
        "sample_moves": sample_moves,
    }, sort_keys=True)
    candidates = con.execute(
        "SELECT batch_id, MAX(created_at) FROM ("
        "SELECT batch_id, created_at FROM selfplay_batches UNION ALL "
        "SELECT batch_id, created_at FROM games) "
        "WHERE batch_id LIKE ? GROUP BY batch_id ORDER BY MAX(created_at) DESC, batch_id DESC",
        (f"{mode}-%",),
    ).fetchall()
    for batch_id, _ in candidates:
        saved = con.execute(
            "SELECT config FROM selfplay_batches WHERE batch_id = ?", (batch_id,)
        ).fetchone()
        if saved is not None and saved[0] != config:
            continue
        rows = con.execute(
            "SELECT black_model, white_model, time_limit_ms, COUNT(*) FROM games "
            "WHERE batch_id = ? GROUP BY black_model, white_model, time_limit_ms",
            (batch_id,),
        ).fetchall()
        if any(limit != time_limit_ms or (black, white) not in target
               or count > target[(black, white)] for black, white, limit, count in rows):
            continue
        done = {(black, white): count for black, white, _, count in rows}
        if not any(done.get(pair, 0) < count for pair, count in target.items()):
            continue
        con.execute("INSERT OR IGNORE INTO selfplay_batches (batch_id, config) VALUES (?, ?)",
                    (batch_id, config))
        return batch_id
    batch_id = next_batch_id(con, mode)
    con.execute("INSERT INTO selfplay_batches (batch_id, config) VALUES (?, ?)",
                (batch_id, config))
    return batch_id


def insert_game(con, batch_id, result, time_limit_ms):
    con.execute(
        "INSERT INTO games (batch_id, black_model, white_model, winner, moves, "
        "num_moves, time_limit_ms, duration_ms, policies) VALUES (?,?,?,?,?,?,?,?,?)",
        (batch_id, result["black_model"], result["white_model"], result["winner"],
         json.dumps(result["moves"]), result["num_moves"], time_limit_ms,
         result["duration_ms"], json.dumps(result["policies"])),
    )


def ensure_elo_models(con, *models):
    for model in models:
        con.execute("INSERT OR IGNORE INTO elo_ratings (model, rating) VALUES (?, ?)",
                    (model, ELO_INIT))
