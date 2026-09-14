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
    existing = {row[0] for row in con.execute("SELECT DISTINCT batch_id FROM games")}
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def insert_game(con, batch_id, result, time_limit_ms):
    import json

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
