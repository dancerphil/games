#!/usr/bin/env python3
"""v6-full：pnpm train。筛选交叉局面 → 500/5000 重分析 → A3 热启动训练。"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
import time

import numpy as np
import torch
from torch.utils.data import default_collate

if __package__:
    from . import train_sqlite_v6 as base
    from . import v6_full_data as data
else:
    import train_sqlite_v6 as base
    import v6_full_data as data

v5 = base.v5
WEIGHTS = {"selfplay": .7, "cross": .2, "replay": .1}


def atomic_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    v5.write_json(tmp, value)
    tmp.replace(path)


def atomic_save(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    torch.save(value, tmp)
    tmp.replace(path)


def freeze(path, config):
    if path.exists():
        if json.loads(path.read_text()) != config:
            raise ValueError(f"config/data/code/weights changed: use a new --output ({path})")
    else:
        atomic_json(path, config)


def fingerprints(args):
    manifest = json.loads((v5.BASE / "checkpoints/manifest.json").read_text())
    specs = {}
    paths = {Path(__file__), Path(data.__file__), Path(base.__file__), Path(v5.__file__),
             v5.BASE / "mcts.py", v5.BASE / "tactics.py", Path(args.warm_start), Path(args.base_checkpoint),
             Path(args.base_split), Path(args.replay_split)}
    paths.update((v5.BASE / "models").glob("*.py"))

    def visit(name):
        if name in specs:
            return
        spec = manifest[name]
        specs[name] = spec
        if "checkpoint" in spec:
            paths.add(v5.BASE / "checkpoints" / spec["checkpoint"])
        if "policy" in spec:
            visit(spec["policy"])
            for ref in [spec["value"]] if isinstance(spec["value"], str) else spec["value"]:
                visit(ref)

    visit(data.TEACHER)
    return {"teacher_specs": specs, "files": {
        str(p.resolve()): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}}


def source_alpha(source):
    return 0.0 if source == "cross" else .25


def combined_loss(value, logits, batch, counts, tactical_weight):
    loss, offset = value.sum() * 0, 0
    for source, count in counts.items():
        section = slice(offset, offset + count)
        loss = loss + WEIGHTS[source] * base.losses(
            value[section], logits[section], *[tensor[section] for tensor in batch],
            source_alpha(source), tactical_weight)
        offset += count
    return loss


def evaluate_sources(model, partitions, part, device, train_keys, batch_size, tactical_weight):
    result, score = {}, 0.0
    for source, splits in partitions.items():
        metrics = v5.evaluate(model, splits[part], device, source_alpha(source), train_keys,
                              batch_size, legal_mask=True)
        score += WEIGHTS[source] * base.validation_score(metrics, 0 if source == "cross" else tactical_weight)
        if source == "cross":
            # 重分析 q 是唯一价值目标，不把占位 z=0 报告成真实胜负指标。
            for values in metrics.values():
                values.pop("mse_z", None)
                values.pop("corr_z", None)
        result[source] = metrics
    return {"score": score, "sources": result}


class SourceSampler:
    def __init__(self, partitions, cross_buckets, batch_size):
        self.datasets = {source: v5.PositionDataset(splits["train"], augment=True)
                         for source, splits in partitions.items()}
        cross, replay = round(batch_size * .2), round(batch_size * .1)
        self.counts = {"selfplay": batch_size-cross-replay, "cross": cross, "replay": replay}
        self.buckets = defaultdict(list)
        for index, key in enumerate(cross_buckets):
            self.buckets[key].append(index)
        self.buckets = list(self.buckets.values())

    def sample(self):
        rows = []
        for source, count in self.counts.items():
            dataset = self.datasets[source]
            for _ in range(count):
                index = random.choice(random.choice(self.buckets)) if source == "cross" else random.randrange(len(dataset))
                rows.append(dataset[index])
        return default_collate(rows)


def train(args, partitions, cross_buckets, output, train_keys):
    device = v5.get_device() if args.device == "auto" else torch.device(args.device)
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    state = torch.load(args.warm_start, map_location="cpu", weights_only=True)
    model = v5.build_model_from_state_dict(state).to(device)
    model.load_state_dict(state)
    evaluate = lambda part: evaluate_sources(model, partitions, part, device, train_keys,
                                             args.batch, args.tactical_weight)
    if args.evaluate_only:
        model.load_state_dict(torch.load(args.evaluate_only, map_location=device, weights_only=True))
        atomic_json(output / "candidate-val.json", evaluate("val"))
        if args.evaluate_test:
            atomic_json(output / "candidate-test.json", evaluate("test"))
        return
    if (output / "summary.json").exists():
        print(f"[done] already complete: {output / 'summary.json'}", flush=True)
        return
    sampler = SourceSampler(partitions, cross_buckets, args.batch)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.updates)
    start, best_score, best_update, elapsed = 0, float("inf"), 0, 0.0
    exposures = {source: {"quiet": 0, "tactical": 0} for source in WEIGHTS}
    history = []
    resume_path = output / "resume.pth"
    if resume_path.exists():
        saved = torch.load(resume_path, map_location="cpu", weights_only=True)
        model.load_state_dict(saved["model"])
        optimizer.load_state_dict(saved["optimizer"])
        scheduler.load_state_dict(saved["scheduler"])
        random.setstate(saved["random_state"])
        torch.set_rng_state(saved["torch_rng"])
        start, best_score, best_update = saved["updates"], saved["best_score"], saved["best_update"]
        exposures, history, elapsed = saved["exposures"], saved["history"], saved["elapsed_seconds"]
        atomic_save(output / "best.pth", saved["best_model"])
        best_model = saved["best_model"]
        print(f"[resume training] update={start}", flush=True)
    else:
        atomic_json(output / "baseline-a3-val.json", evaluate("val"))
        model.load_state_dict(torch.load(args.base_checkpoint, map_location=device, weights_only=True))
        atomic_json(output / "baseline-base-val.json", evaluate("val"))
        model.load_state_dict(state)
        best_model = None
    total_loss, steps, started = 0.0, 0, time.monotonic()
    model.train()
    for update in range(start + 1, args.updates + 1):
        batch = [x.to(device) for x in sampler.sample()]
        optimizer.zero_grad(set_to_none=True)
        value, logits = model(batch[0])
        loss = combined_loss(value, logits, batch, sampler.counts, args.tactical_weight)
        if not torch.isfinite(loss):
            raise ValueError(f"non-finite training loss at {update}")
        loss.backward()
        optimizer.step()
        scheduler.step()
        total_loss += loss.item()
        steps += 1
        offset = 0
        for source, count in sampler.counts.items():
            tactical = int(batch[-1][offset:offset+count].sum().item())
            exposures[source]["quiet"] += count-tactical
            exposures[source]["tactical"] += tactical
            offset += count
        if update % args.eval_every and update != args.updates:
            continue
        val = evaluate("val")
        if not math.isfinite(val["score"]):
            raise ValueError(f"non-finite validation score at {update}")
        record = {"updates": update, "lr": scheduler.get_last_lr()[0], "train_loss": total_loss/steps,
                  "val": val, "exposures": json.loads(json.dumps(exposures)),
                  "elapsed_seconds": elapsed + time.monotonic()-started}
        history.append(record)
        weights = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        if val["score"] < best_score:
            best_score, best_update, best_model = val["score"], update, weights
        # resume 是单个原子检查点，其他输出均可由它重建。
        atomic_save(resume_path, {"model": weights, "best_model": best_model,
                    "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(),
                    "updates": update, "best_score": best_score, "best_update": best_update,
                    "exposures": exposures, "history": history, "elapsed_seconds": record["elapsed_seconds"],
                    "random_state": random.getstate(), "torch_rng": torch.get_rng_state()})
        atomic_save(output / "best.pth", best_model)
        atomic_save(output / "last.pth", weights)
        atomic_json(output / "metrics.json", history)
        atomic_json(output / "best-val.json", next(r for r in history if r["updates"] == best_update))
        print(f"[update {update}/{args.updates}] loss={record['train_loss']:.4f} "
              f"val={val['score']:.4f} elapsed={record['elapsed_seconds']/60:.1f}m", flush=True)
        total_loss, steps = 0.0, 0
        model.train()
    if args.evaluate_test:
        model.load_state_dict(best_model)
        atomic_json(output / "best-test.json", evaluate("test"))
    # 覆盖在最终检查点落盘后、派生文件写入前被中断的情况。
    if start == args.updates:
        atomic_save(output / "last.pth", saved["model"])
        atomic_json(output / "metrics.json", history)
        atomic_json(output / "best-val.json", next(r for r in history if r["updates"] == best_update))
    atomic_json(output / "summary.json", {"updates": args.updates, "best_update": best_update,
                "best_score": best_score, "exposures": exposures})
    print(f"[done] best update={best_update}; {output}", flush=True)


def run(args):
    output = Path(args.output).expanduser().resolve()
    current, current_split = data.load_frozen(args.db, args.base_split)
    replay, replay_split = data.load_frozen(args.db, args.replay_split)
    rows = data.read_cross(args.db, args.cross_batch)
    config = {"args": {k: v for k, v in vars(args).items()
                        if k not in ("pilot_only", "evaluate_only", "evaluate_test")},
              "fingerprints": fingerprints(args), "cross_fingerprint": data.digest(rows),
              "selfplay_fingerprint": current_split["fingerprint"], "replay_fingerprint": replay_split["fingerprint"],
              "source_weights": WEIGHTS, "torch_version": str(torch.__version__)}
    if output.exists() and not (output / "config.json").exists():
        raise FileExistsError(f"output is not a v6-full run: {output}")
    output.mkdir(parents=True, exist_ok=True)
    freeze(output / "config.json", config)
    known = {v5.position_key(s.board) for parts in (current, replay) for samples in parts.values() for s in samples}
    groups = set(current_split["game_ids"]) | set(replay_split["game_ids"])
    plan = data.prepare_cross(rows, known, groups, args.seed, args.reanalyze_count, args.per_game)
    freeze(output / "cross-plan.json", plan)
    print(f"[data] {json.dumps(plan['audit'])}", flush=True)
    labels = data.reanalyze(output, plan["pending"], args.time_ms, args.workers, args.seed, args.pilot_only)
    if args.pilot_only:
        print("[pilot done] inspect pilot-audit.json; pnpm train resumes the full run", flush=True)
        return
    cross, buckets = data.cross_samples(plan, labels)
    # 只回放旧训练集；额外排除 base 保留集的局面，避免通过回放新增泄漏。
    protected = {v5.position_key(s.board) for part in ("val", "test") for s in current[part]}
    replay["train"] = [s for s in replay["train"] if v5.position_key(s.board) not in protected]
    partitions = {"selfplay": current, "cross": cross, "replay": replay}
    for source, parts in partitions.items():
        for part, samples in parts.items():
            if not any(not s.tactical for s in samples):
                raise ValueError(f"{source}/{part}: no quiet samples")
            if source != "cross" and args.tactical_weight and not any(s.tactical for s in samples):
                raise ValueError(f"{source}/{part}: no tactical samples")
    train_keys = {v5.position_key(s.board) for parts in partitions.values() for s in parts["train"]}
    atomic_json(output / "data-summary.json", {
        "positions": {source: {part: len(samples) for part, samples in parts.items()} for source, parts in partitions.items()},
        "cross_train_buckets": {f"{opponent}:{color}": n for (opponent, color), n in Counter(buckets).items()},
        "unique_train_positions_d4": len(train_keys), "cross_plan": plan["audit"]})
    train(args, partitions, buckets, output, train_keys)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    checkpoints = v5.BASE / "checkpoints"
    parser.add_argument("--db", default=str(Path("~/.games/selfplay.sqlite").expanduser()))
    parser.add_argument("--output", default=str(checkpoints / "v6-full"))
    parser.add_argument("--base-split", default=str(checkpoints / "v6-base/split.json"))
    parser.add_argument("--replay-split", default=str(checkpoints / "v5-split.json"))
    parser.add_argument("--warm-start", default=str(checkpoints / "v5-a3/best.pth"))
    parser.add_argument("--base-checkpoint", default=str(checkpoints / "v6-base/best.pth"))
    parser.add_argument("--cross-batch", action="append")
    parser.add_argument("--reanalyze-count", type=int, default=5000)
    parser.add_argument("--per-game", type=int, default=12)
    parser.add_argument("--time-ms", type=int, default=5000)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--pilot-only", action="store_true", help="仅完成前 500 个重分析并输出审计")
    parser.add_argument("--updates", type=int, default=30000)
    parser.add_argument("--eval-every", type=int, default=1000)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--tactical-weight", type=float, default=.25)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    parser.add_argument("--evaluate-only")
    parser.add_argument("--evaluate-test", action="store_true")
    args = parser.parse_args()
    args.cross_batch = args.cross_batch or data.CROSS_BATCHES
    if min(args.reanalyze_count, args.per_game, args.time_ms, args.workers, args.updates, args.eval_every) < 1 or args.batch < 10:
        parser.error("counts/budgets must be positive; batch must be at least 10")
    if not math.isfinite(args.lr) or args.lr <= 0 or not math.isfinite(args.tactical_weight) or args.tactical_weight < 0:
        parser.error("invalid lr/tactical-weight")
    run(args)


if __name__ == "__main__":
    main()
