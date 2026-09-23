"""v6-full 数据：继承切分、交叉局面筛选、冻结老师重分析。"""
from collections import Counter, defaultdict, deque
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import closing
import hashlib
import json
import multiprocessing
from pathlib import Path
import random
import sqlite3
import time

import numpy as np

if __package__:
    from . import train_sqlite_v5 as v5
else:
    import train_sqlite_v5 as v5

TEACHER = "mix-v5-h3"
BASE_MODEL = "nn-v6-base"
CROSS_BATCHES = ["update-elo-20260921", "update-elo-20260922", "update-elo-20260922-2"]
PRIORITY = {"nn-v5-a1", "nn4-policy-h2v80", TEACHER}
PARTS = ("train", "val", "test")


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def load_frozen(db, split_path):
    saved = json.loads(Path(split_path).read_text())
    games, metadata = v5.load_games(db, list(saved["summary"]["batches"]))
    if metadata["fingerprint"] != saved["fingerprint"] or metadata["game_ids"] != saved["game_ids"]:
        raise ValueError(f"source data changed: {split_path}")
    partitions = {part: [s for key in saved["split"][part] for s in games[key]] for part in PARTS}
    return partitions, saved


def read_cross(db, batches):
    rows = []
    with closing(sqlite3.connect(Path(db).expanduser().resolve().as_uri() + "?mode=ro", uri=True)) as con:
        for batch in sorted(set(batches)):
            found = con.execute(
                "SELECT id, batch_id, black_model, white_model, winner, moves, policies, time_limit_ms "
                "FROM games WHERE batch_id=? AND black_model!=white_model "
                "AND (black_model IN (?,?) OR white_model IN (?,?)) ORDER BY id",
                (batch, TEACHER, BASE_MODEL, TEACHER, BASE_MODEL)).fetchall()
            if not found:
                raise ValueError(f"no teacher/base cross games in {batch}")
            rows.extend(found)
    return rows


def canonical_position(board):
    transform = min(range(8), key=lambda i: board[v5.PERMS[i]].tobytes())
    canonical = board[v5.PERMS[transform]]
    return canonical.tobytes().hex(), canonical, transform


def search_label(step, transform, board):
    policy = np.zeros(225, dtype=np.float32)
    for pos, visits in step["d"].items():
        policy[v5.INVERSES[transform, int(pos)]] = visits
    q = float(step["q"])
    if (not np.isfinite(policy).all() or (policy < 0).any() or policy.sum() <= 0
            or policy[board != 0].any() or not np.isfinite(q) or not -1 <= q <= 1):
        raise ValueError("invalid teacher search label")
    return {"policy": (policy / policy.sum()).tolist(), "q": q,
            "visits": int(policy.sum())}


def balanced_select(records, count, per_game, seed):
    """优先组/其余组各半；组内轮流取对手、颜色、胜负桶，限制单棋谱贡献。"""
    rng = random.Random(seed)
    buckets = defaultdict(list)
    for row in records:
        buckets[(row["opponent"] in PRIORITY, row["opponent"], row["ply"] % 2, row["outcome"])].append(row)
    rings = {priority: deque() for priority in (True, False)}
    for key in sorted(buckets):
        rng.shuffle(buckets[key])
        rings[key[0]].append(deque(buckets[key]))
    selected, used = [], Counter()
    while len(selected) < count and any(rings.values()):
        for priority in (True, False):
            ring = rings[priority]
            if not ring or len(selected) == count:
                continue
            bucket = ring.popleft()
            while bucket and used[bucket[-1]["group"]] >= per_game:
                bucket.pop()
            if bucket:
                row = bucket.pop()
                selected.append(row)
                used[row["group"]] += 1
            if bucket:
                ring.append(bucket)
    return selected


def prepare_cross(rows, known_positions, known_groups, seed, reanalyze_count, per_game):
    """先按 D4 棋谱切分；跨新集合共享的局面全部剔除，重分析不会另行切分。"""
    game_groups = {}
    for row in rows:
        moves, _ = v5.canonical_game(json.loads(row[5]))
        game_groups[row[0]] = hashlib.sha256(bytes(moves)).hexdigest()
    keys = sorted(set(game_groups.values()) - known_groups)
    random.Random(seed).shuffle(keys)
    n, v = int(len(keys) * .8), int(len(keys) * .1)
    split = {key: part for part, group in zip(PARTS, (keys[:n], keys[n:n+v], keys[n+v:])) for key in group}
    candidates, memberships, skipped = {}, defaultdict(set), Counter()
    for game_id, batch, black, white, winner, moves_json, policies_json, budget in rows:
        group = game_groups[game_id]
        if group not in split:
            skipped["known_game"] += 1
            continue
        board = np.zeros(225, dtype=np.uint8)
        moves, policies = json.loads(moves_json), json.loads(policies_json)
        if len(moves) != len(policies) or winner not in ("black", "white", "draw"):
            raise ValueError(f"invalid cross game {game_id}")
        # 以 base 或老师为本盘锚点，opponent/outcome 用于分层，而非构造监督。
        anchor = BASE_MODEL if BASE_MODEL in (black, white) else TEACHER
        opponent = white if black == anchor else black
        outcome = "draw" if winner == "draw" else "win" if (winner == "black") == (black == anchor) else "loss"
        for ply, (pos, step) in enumerate(zip(moves, policies)):
            key, canonical, transform = canonical_position(board)
            memberships[key].add(split[group])
            if board[pos]:
                raise ValueError(f"occupied move in game {game_id}")
            if canonical.tobytes() in known_positions:
                skipped["known_position"] += 1
            elif step is not None and not step["t"]:
                actor = black if ply % 2 == 0 else white
                row = {"key": key, "board": canonical.tolist(), "ply": ply, "group": group,
                       "split": split[group], "game_id": game_id, "batch": batch,
                       "actor": actor, "opponent": opponent, "outcome": outcome,
                       "label_teacher": TEACHER, "time_limit_ms": budget,
                       "origin": "recorded" if actor == TEACHER else "reanalyze"}
                if actor == TEACHER:
                    row.update(search_label(step, transform, canonical))
                # 同局面已有老师搜索时优先复用；绝不平均不同模型的标签。
                previous = candidates.get(key)
                if previous is None or (previous["origin"] == "reanalyze" and actor == TEACHER):
                    candidates[key] = row
            board[pos] = 1 + ply % 2
    candidates = [row for key, row in candidates.items() if len(memberships[key]) == 1]
    native = balanced_select([r for r in candidates if r["origin"] == "recorded"], len(candidates), per_game, seed)
    pending = balanced_select([r for r in candidates if r["origin"] == "reanalyze"], reanalyze_count, per_game, seed)
    if len(pending) != reanalyze_count:
        raise ValueError(f"only {len(pending)} eligible reanalysis positions; lower --reanalyze-count or raise --per-game")
    return {"records": native, "pending": pending, "game_split": split,
            "audit": {"games": len(rows), "game_groups": len(keys), "recorded_labels": len(native),
                      "reanalyze_positions": len(pending), "skipped": dict(skipped),
                      "cross_split_positions_removed": sum(len(p) > 1 for p in memberships.values())}}


_teacher_fn = None


def init_teacher():
    global _teacher_fn
    from models import REGISTRY
    _teacher_fn = REGISTRY[TEACHER]
    _teacher_fn([None] * 225, "black")


def analyze_one(task):
    from mcts import get_best_move_with_stats
    row, time_ms, seed = task
    random.seed(seed + int(hashlib.sha256(row["key"].encode()).hexdigest()[:16], 16))
    board = [None if cell == 0 else "black" if cell == 1 else "white" for cell in row["board"]]
    started = time.monotonic()
    _, visits, tactical, q = get_best_move_with_stats(
        board, "black" if row["ply"] % 2 == 0 else "white", _teacher_fn, time_limit_ms=time_ms)
    result = {"key": row["key"], "tactical": tactical, "time_limit_ms": time_ms,
              "duration_ms": (time.monotonic() - started) * 1000, "label_teacher": TEACHER}
    if not tactical:
        result.update(search_label({"d": visits, "q": q}, 0, np.array(row["board"])))
    return result


def reanalyze(output, pending, time_ms, workers, seed, pilot_only=False):
    """SQLite 每条结果提交；中断最多丢失正在搜索的局面。"""
    with closing(sqlite3.connect(output / "reanalysis.sqlite")) as con:
        con.execute("CREATE TABLE IF NOT EXISTS labels (key TEXT PRIMARY KEY, result TEXT NOT NULL)")
        con.commit()
        records = {key: json.loads(data) for key, data in con.execute("SELECT key,result FROM labels")}
        stages = [("pilot", pending[:500])]
        if not pilot_only:
            stages.append(("full", pending))
        for stage, selected in stages:
            remaining = [row for row in selected if row["key"] not in records]
            print(f"[reanalyze {stage}] saved={len(selected)-len(remaining)}/{len(selected)} workers={workers}", flush=True)
            if remaining:
                pool = ProcessPoolExecutor(max_workers=workers, initializer=init_teacher,
                                           mp_context=multiprocessing.get_context("spawn"))
                try:
                    futures = {pool.submit(analyze_one, (row, time_ms, seed)): row for row in remaining}
                    for future in as_completed(futures):
                        result = future.result()
                        con.execute("INSERT INTO labels VALUES (?,?)", (result["key"], json.dumps(result, allow_nan=False)))
                        con.commit()
                        records[result["key"]] = result
                        done = sum(row["key"] in records for row in selected)
                        if done % 25 == 0 or done == len(selected):
                            print(f"[reanalyze {stage}] {done}/{len(selected)}", flush=True)
                finally:
                    # 中断或某条搜索失败时取消排队任务，仅等待已经开始的少量搜索。
                    pool.shutdown(wait=True, cancel_futures=True)
            labels = [records[row["key"]] for row in selected]
            quiet = [r for r in labels if not r["tactical"]]
            if not quiet:
                raise ValueError("reanalysis produced no quiet labels")
            audit = {"positions": len(labels), "quiet": len(quiet), "tactical_excluded": len(labels)-len(quiet),
                     "visits_p10_median_p90": np.percentile([r["visits"] for r in quiet], [10, 50, 90]).tolist(),
                     "mean_duration_ms": float(np.mean([r["duration_ms"] for r in labels]))}
            v5.write_json(output / f"{stage}-audit.json", audit)
            print(f"[audit {stage}] {json.dumps(audit)}", flush=True)
        return records


def cross_samples(plan, labels):
    parts = {part: [] for part in PARTS}
    buckets = []
    for row in [*plan["records"], *plan["pending"]]:
        label = row if row["origin"] == "recorded" else labels[row["key"]]
        if label.get("tactical", False):
            continue
        # 交叉局面没有可信 z；置零且 alpha=0，避免把其他策略的胜负用于训练。
        sample = v5.Sample(np.array(row["board"], dtype=np.uint8), np.array(label["policy"], dtype=np.float32),
                           label["q"], 0.0, row["ply"], False)
        parts[row["split"]].append(sample)
        if row["split"] == "train":
            buckets.append((row["opponent"], row["ply"] % 2))
    return parts, buckets
