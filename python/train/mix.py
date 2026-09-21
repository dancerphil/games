#!/usr/bin/env python3
"""分阶段筛选融合老师：pnpm mix。每盘落盘，同一命令可续跑。"""
import argparse
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import json
import math
import multiprocessing
import os
from pathlib import Path
import random
import sys

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE.parent))
sys.path.insert(0, str(BASE))

from python.selfplay.game import play_one
from python.models import MANIFEST, REGISTRY

BASELINE = "nn-v5-a3"
PANEL = ["nn4-policy-h2v80", "nn-v5-a2", "heuristic-v3"]


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def candidate(policy=BASELINE, heuristic=None, weight=0.0, c_puct=1.2):
    value = {BASELINE: 1 - weight, heuristic: weight} if heuristic else BASELINE
    return {"policy": policy, "value": value, "c_puct": c_puct}


def name_of(spec):
    return "mix-" + hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:12]


def opening_key(moves):
    variants = []
    for rotation in range(4):
        for flip in (False, True):
            transformed = []
            for pos in moves:
                r, c = divmod(pos, 15)
                for _ in range(rotation):
                    r, c = c, 14 - r
                transformed.append(r * 15 + (14 - c if flip else c))
            # 相同颜色交换落子顺序也可能得到同一局面，按棋盘而非棋谱去重。
            variants.append((tuple(sorted(transformed[::2])), tuple(sorted(transformed[1::2]))))
    return min(variants)


def openings(count, rng, used):
    """中心首手、白棋邻近应手，随后双方在中心 5×5 内展开。D4 去重。"""
    near = [r * 15 + c for r in range(5, 10) for c in range(5, 10) if (r, c) != (7, 7)]
    replies = [r * 15 + c for r in range(6, 9) for c in range(6, 9) if (r, c) != (7, 7)]
    pool = []
    for second in replies:
        for third in near:
            for fourth in near:
                moves = [112, second, third, fourth]
                if len(set(moves)) != 4:
                    continue
                key = opening_key(moves)
                if key not in used:
                    used.add(key)
                    pool.append(moves)
    rng.shuffle(pool)
    if count > len(pool):
        raise ValueError(f"only {len(pool)} disjoint openings available, requested {count}")
    # 只占用本阶段真正选中的前缀。
    used.difference_update(opening_key(m) for m in pool[count:])
    return pool[:count]


def tasks_for(stage, specs, opponents, prefixes, seed, time_ms):
    tasks = []
    for spec in specs:
        name = name_of(spec)
        for opponent in opponents:
            for index, opening in enumerate(prefixes):
                for color in ("black", "white"):
                    key = f"{stage}:{name}:{opponent}:{index}:{color}"
                    tasks.append({"id": key, "stage": stage, "candidate": name,
                                  "opponent": opponent, "opening_id": index, "color": color,
                                  "black_model": name if color == "black" else opponent,
                                  "white_model": name if color == "white" else opponent,
                                  "model_specs": {name: spec}, "opening": opening,
                                  "time_limit_ms": time_ms, "sample_moves": 0, "warmup": True,
                                  "seed": seed + index * 2 + (color == "white")})
    random.Random(seed).shuffle(tasks)  # 配方、对手交错运行，减少时段负载偏差。
    return tasks


def summarize(tasks, records):
    grouped = defaultdict(list)
    for task in tasks:
        result = records[task["id"]]
        grouped[task["candidate"]].append((task, result))
    report = {}
    for name, games in grouped.items():
        pairs, opponents = defaultdict(list), defaultdict(lambda: [0, 0, 0])
        visits, searched = 0, 0
        for task, result in games:
            score = 0.5 if result["winner"] == "draw" else float(result["winner"] == task["color"])
            pairs[(task["opponent"], task["opening_id"])].append(score)
            opponents[task["opponent"]][0 if score == 1 else 1 if score == 0.5 else 2] += 1
            parity = 0 if task["color"] == "black" else 1
            for ply, step in enumerate(result["policies"]):
                if ply % 2 == parity and step is not None and not step["t"]:
                    visits += sum(step["d"].values())
                    searched += 1
        if any(len(pair) != 2 for pair in pairs.values()):
            raise ValueError("incomplete color-swapped pair")
        paired = [sum(pair) / 2 for pair in pairs.values()]
        # 以开局为簇，同时重采样该开局的全部对手；不把换先局当成独立观测。
        clusters = defaultdict(list)
        for (_, opening_id), pair in pairs.items():
            clusters[opening_id].extend(pair)
        cluster_scores = [sum(v) / len(v) for v in clusters.values()]
        rng = random.Random(0)
        boot = sorted(sum(rng.choices(cluster_scores, k=len(cluster_scores))) / len(cluster_scores)
                      for _ in range(2000))
        report[name] = {"games": len(games), "score": sum(paired) / len(paired),
                        "opening_bootstrap_95": [boot[50], boot[1949]],
                        "opponents_wdl": dict(opponents),
                        "mean_visits_per_quiet_move": visits / searched if searched else None,
                        "mean_game_seconds": sum(r["duration_ms"] for _, r in games) / len(games) / 1000}
    return report


def run_stage(stage, specs, opponents, prefixes, args, records):
    specs = list({name_of(spec): spec for spec in specs}.values())
    tasks = tasks_for(stage, specs, opponents, prefixes, args.seed, args.time_ms)
    pending = [task for task in tasks if task["id"] not in records]
    print(f"[{stage}] candidates={len(specs)} total={len(tasks)} remaining={len(pending)}", flush=True)
    if pending:
        with ProcessPoolExecutor(max_workers=args.workers, mp_context=multiprocessing.get_context("spawn")) as pool:
            futures = {pool.submit(play_one, task): task for task in pending}
            with (args.output / "games.jsonl").open("a") as log:
                for future in as_completed(futures):
                    task = futures[future]
                    result = future.result()  # 模型/搜索异常直接暴露，不把失败计为输棋。
                    log.write(json.dumps({"task": task, "result": result}) + "\n")
                    log.flush()
                    os.fsync(log.fileno())
                    records[task["id"]] = result
                    print(f"[{stage}] {sum(t['id'] in records for t in tasks)}/{len(tasks)} "
                          f"{task['candidate']} ({task['color']}) vs {task['opponent']}: "
                          f"{result['winner']} {result['num_moves']} moves", flush=True)
    report = summarize(tasks, records)
    save(args.output / f"{stage}.json", {"specs": {name_of(s): s for s in specs}, "results": report})
    ranked = sorted(specs, key=lambda s: (-report[name_of(s)]["score"], name_of(s)))
    for spec in ranked:
        print(f"[{stage}] {name_of(spec)} {report[name_of(spec)]['score']:.1%} {spec}", flush=True)
    return ranked, report


def fingerprint():
    paths = [Path(MANIFEST), BASE / "mcts.py", BASE / "tactics.py",
             BASE / "selfplay/game.py", Path(__file__)]
    paths.extend(sorted((BASE / "models").glob("*.py")))
    for spec in json.loads(Path(MANIFEST).read_text()).values():
        if "checkpoint" in spec:
            paths.append(BASE / "checkpoints" / spec["checkpoint"])
    return {str(p.relative_to(BASE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=BASE / "checkpoints/mix-v6")
    parser.add_argument("--workers", type=int, default=1, help="默认单进程，减少共享 MPS 竞争")
    parser.add_argument("--time-ms", type=int, default=5000)
    parser.add_argument("--screen-pairs", type=int, default=3, help="每个对手的换先开局对数")
    parser.add_argument("--tune-pairs", type=int, default=5)
    parser.add_argument("--confirm-pairs", type=int, default=20)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--weights", type=float, nargs="+", default=[0.25, 0.5, 0.75])
    parser.add_argument("--c-puct", type=float, nargs="+", default=[0.8, 1.2, 1.8])
    args = parser.parse_args()
    if min(args.workers, args.time_ms, args.screen_pairs, args.tune_pairs, args.confirm_pairs) < 1:
        parser.error("workers/time-ms/pair counts must be positive")
    if any(not 0 < w <= 1 for w in args.weights) or any(not math.isfinite(c) or c <= 0 for c in args.c_puct):
        parser.error("weights must be in (0,1]; c-puct must be finite and positive")
    args.output = args.output.expanduser().resolve()
    for name in [BASELINE, *PANEL, "heuristic-v2", "nn4-policy-h2-value"]:
        if name not in REGISTRY:
            parser.error(f"missing model: {name}")
    rng, used = random.Random(args.seed), set()
    prefixes = {stage: openings(count, rng, used) for stage, count in
                (("screen", args.screen_pairs), ("tune", args.tune_pairs), ("confirm", args.confirm_pairs))}
    config = {"args": {**vars(args), "output": str(args.output)}, "openings": prefixes,
              "fingerprints": fingerprint(), "panel": PANEL}
    args.output.mkdir(parents=True, exist_ok=True)
    config_path = args.output / "config.json"
    if config_path.exists():
        if json.loads(config_path.read_text()) != config:
            raise ValueError("configuration/code/weights changed; use a new --output directory")
    else:
        save(config_path, config)
    records = {}
    journal = args.output / "games.jsonl"
    if journal.exists():
        for line in journal.read_text().splitlines():
            row = json.loads(line)
            key = row["task"]["id"]
            if key in records:
                raise ValueError(f"duplicate result: {key}")
            records[key] = row["result"]
    baseline = candidate()
    screen = [baseline] + [candidate(heuristic=h, weight=w)
                           for h in ("heuristic-v2", "heuristic-v3") for w in args.weights]
    ranked, _ = run_stage("screen", screen, PANEL, prefixes["screen"], args, records)
    finalists = ranked[:2]
    tune = [baseline]
    for spec in finalists:
        tune.extend({**spec, "c_puct": cp} for cp in args.c_puct)
    # 用相同最佳 value 比较 A2 policy，验证是否存在跨头互补。
    tune.append({**ranked[0], "policy": "nn-v5-a2"})
    ranked, _ = run_stage("tune", tune, PANEL, prefixes["tune"], args, records)
    finalists = [spec for spec in ranked if spec != baseline][:2]
    ranked, confirmation = run_stage("confirm", [baseline, *finalists],
                                    [*PANEL, "nn4-policy-h2-value"], prefixes["confirm"], args, records)
    _, duels = run_stage("duel", finalists, [BASELINE], prefixes["confirm"], args, records)
    best = ranked[0]
    # 确认阶段不再调参数；全对手表现与直接交手共同决定是否建议替代 A3。
    eligible = [s for s in ranked if s != baseline
                and confirmation[name_of(s)]["score"] > confirmation[name_of(baseline)]["score"]
                and duels[name_of(s)]["opening_bootstrap_95"][0] > 0.5]
    recommendation = eligible[0] if eligible else baseline
    save(args.output / "result.json", {"best_panel_spec": best,
         "recommended_spec": recommendation, "confirmed_improvement": bool(eligible),
         "note": "Exploratory two-finalist comparison; intervals are not multiple-testing adjusted.",
         "confirmation": confirmation, "duels_vs_a3": duels})
    save(args.output / "teacher-manifest.json", {"v6-teacher": recommendation})
    print(f"[done] best panel={best}; recommended={recommendation}", flush=True)
    print(f"[done] reports: {args.output}; manifest fragment not automatically installed", flush=True)


if __name__ == "__main__":
    main()
