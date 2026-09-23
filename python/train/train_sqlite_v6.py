#!/usr/bin/env python3
"""v6-base：A3 热启动，现有老师自对弈蒸馏。项目根目录运行 pnpm train:base。"""
import argparse
from contextlib import closing
from functools import partial
import hashlib
import json
import math
from pathlib import Path
import random
import sqlite3
import time

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

if __package__:
    from . import train_sqlite_v5 as v5
else:
    import train_sqlite_v5 as v5


def losses(pred_v, logits, boards, policy, q, z, tactical, alpha, tactical_weight):
    loss = pred_v.sum() * 0 + logits.sum() * 0
    logits = v5.mask_policy_logits(logits, boards)
    quiet = ~tactical
    # 各类独立取均值，战术局面的数量不改变 quiet / tactical 的相对权重。
    if quiet.any():
        ce = -(policy[quiet] * F.log_softmax(logits[quiet], dim=1)).sum(1).mean()
        target = alpha * z[quiet] + (1 - alpha) * q[quiet]
        loss = loss + ce + F.mse_loss(pred_v.flatten()[quiet], target)
    if tactical.any():
        loss = loss + tactical_weight * F.mse_loss(pred_v.flatten()[tactical], z[tactical])
    return loss


def validation_score(metrics, tactical_weight):
    score = metrics["quiet"]["loss"]
    if tactical_weight:
        score += tactical_weight * metrics["tactical"]["mse_z"]
    return score


def check_teacher(db, batches):
    """v5 loader 会平均重复棋谱标签；base 只接受同一个老师的自对弈。"""
    with closing(sqlite3.connect(Path(db).expanduser().resolve().as_uri() + "?mode=ro", uri=True)) as con:
        pairs = set()
        for batch in batches:
            pairs.update(con.execute(
                "SELECT DISTINCT black_model, white_model FROM games WHERE batch_id=?", (batch,)))
    if len(pairs) != 1 or any(black != white for black, white in pairs):
        raise ValueError("v6-base requires selfplay from a single teacher")
    return next(iter(pairs))[0]


def run_training(args):
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    output = Path(args.output).expanduser().resolve()
    if output.exists():
        raise FileExistsError(f"use a new --output directory: {output}")
    teacher = check_teacher(args.db, args.batch_id)
    games, metadata = v5.load_games(args.db, args.batch_id)
    partitions = v5.split_games(games, metadata, args.split_file, args.seed)
    for name in ("train", "val"):
        samples = partitions[name]
        if not any(not s.tactical for s in samples):
            raise ValueError(f"{name}: quiet samples required")
        if args.tactical_weight and not any(s.tactical for s in samples):
            raise ValueError(f"{name}: tactical samples required")
    train_samples = [s for s in partitions["train"] if not s.tactical or args.tactical_weight]
    train_keys = {v5.position_key(s.board) for s in train_samples}
    device = v5.get_device() if args.device == "auto" else torch.device(args.device)
    state = torch.load(args.warm_start, map_location="cpu", weights_only=True)
    model = v5.build_model_from_state_dict(state)
    model.load_state_dict(state)
    model.to(device)
    evaluate = partial(v5.evaluate, device=device, alpha=args.alpha,
                       train_keys=train_keys, batch_size=args.batch, legal_mask=True)
    output.mkdir(parents=True)
    config = {**vars(args), "teacher": teacher, "device_used": str(device),
              "torch_version": str(torch.__version__), "architecture": v5.infer_model_kwargs(state),
              "data": metadata["summary"], "data_fingerprint": metadata["fingerprint"],
              "warm_start_sha256": hashlib.sha256(Path(args.warm_start).read_bytes()).hexdigest(),
              "positions": {k: len(v) for k, v in partitions.items()},
              "unique_train_positions_d4": len(train_keys)}
    v5.write_json(output / "config.json", config)
    v5.write_json(output / "split.json", json.loads(Path(args.split_file).read_text()))
    print(json.dumps(config, indent=2), flush=True)
    baseline = evaluate(model, partitions["val"])
    v5.write_json(output / "baseline-val.json", baseline)
    print(f"[A3 val] score={validation_score(baseline, args.tactical_weight):.4f}", flush=True)
    if args.evaluate_only:
        model.load_state_dict(torch.load(args.evaluate_only, map_location=device, weights_only=True))
        v5.write_json(output / "candidate-val.json", evaluate(model, partitions["val"]))
        if args.evaluate_test:
            v5.write_json(output / "candidate-test.json", evaluate(model, partitions["test"]))
        return

    loader = DataLoader(v5.PositionDataset(train_samples, augment=True), batch_size=args.batch,
                        shuffle=True, generator=torch.Generator().manual_seed(args.seed))
    iterator = iter(loader)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.updates)
    best_score, best_update = float("inf"), 0
    total_loss, interval_steps = 0.0, 0
    exposures = {"quiet": 0, "tactical": 0}
    started = time.monotonic()
    model.train()
    for update in range(1, args.updates + 1):
        try:
            batch = next(iterator)
        except StopIteration:
            iterator = iter(loader)
            batch = next(iterator)
        boards, policy, q, z, tactical = [x.to(device) for x in batch]
        optimizer.zero_grad(set_to_none=True)
        value, logits = model(boards)
        loss = losses(value, logits, boards, policy, q, z, tactical, args.alpha, args.tactical_weight)
        if not torch.isfinite(loss):
            raise ValueError(f"non-finite loss at update {update}")
        loss.backward()
        optimizer.step()
        scheduler.step()
        total_loss += loss.item()
        interval_steps += 1
        n_tactical = int(tactical.sum().item())
        exposures["tactical"] += n_tactical
        exposures["quiet"] += len(tactical) - n_tactical
        if update % args.eval_every and update != args.updates:
            continue
        val = evaluate(model, partitions["val"])
        score = validation_score(val, args.tactical_weight)
        if not math.isfinite(score):
            raise ValueError(f"non-finite validation score at update {update}")
        record = {"updates": update, "lr": scheduler.get_last_lr()[0],
                  "train_loss": total_loss / interval_steps, "score": score, "val": val,
                  "exposures": dict(exposures), "elapsed_seconds": time.monotonic() - started}
        with (output / "metrics.jsonl").open("a") as f:
            f.write(json.dumps(record, allow_nan=False) + "\n")
        weights = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        torch.save(weights, output / "last.pth")
        if score < best_score:
            best_score, best_update = score, update
            torch.save(weights, output / "best.pth")
            v5.write_json(output / "best-val.json", record)
        print(f"[update {update}/{args.updates}] loss={record['train_loss']:.4f} "
              f"val={score:.4f} first_top1={val['quiet_first_move'].get('top1')} "
              f"second_top1={val['quiet_second_move'].get('top1')} "
              f"elapsed={record['elapsed_seconds'] / 60:.1f}m", flush=True)
        total_loss, interval_steps = 0.0, 0
        model.train()
    if args.evaluate_test:
        model.load_state_dict(torch.load(output / "best.pth", map_location=device, weights_only=True))
        v5.write_json(output / "best-test.json", evaluate(model, partitions["test"]))
    v5.write_json(output / "summary.json", {"updates": args.updates, "best_update": best_update,
                  "best_score": best_score, "exposures": exposures})
    print(f"[done] best update={best_update}; outputs: {output}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(Path("~/.games/selfplay.sqlite").expanduser()))
    parser.add_argument("--batch-id", action="append")
    parser.add_argument("--warm-start", default=str(v5.BASE / "checkpoints/v5-a3/best.pth"))
    parser.add_argument("--output", default=str(v5.BASE / "checkpoints/v6-base"))
    parser.add_argument("--split-file", default=str(v5.BASE / "checkpoints/v6-base-split.json"))
    parser.add_argument("--updates", type=int, default=30000)
    parser.add_argument("--eval-every", type=int, default=1000)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--wd", type=float, default=1e-4)
    parser.add_argument("--alpha", type=float, default=0.25)
    parser.add_argument("--tactical-weight", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    parser.add_argument("--evaluate-only", help="仅评估给定权重，不训练")
    parser.add_argument("--evaluate-test", action="store_true", help="显式评估保留测试集")
    args = parser.parse_args()
    args.batch_id = args.batch_id or ["teacher-20260921-2"]
    if min(args.updates, args.eval_every, args.batch) < 1:
        parser.error("updates/eval-every/batch must be positive")
    if (not all(math.isfinite(x) for x in (args.lr, args.wd, args.alpha, args.tactical_weight))
            or args.lr <= 0 or args.wd < 0 or not 0 <= args.alpha <= 1 or args.tactical_weight < 0):
        parser.error("invalid lr/wd/alpha/tactical-weight")
    run_training(args)


if __name__ == "__main__":
    main()
