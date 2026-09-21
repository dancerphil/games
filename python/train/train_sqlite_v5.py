#!/usr/bin/env python3
"""v4 同构蒸馏。完整棋谱 D4 分组去重，固定切分，在线增强。

python python/train/train_sqlite_v5.py --output python/checkpoints/v5-a1
python python/train/train_sqlite_v5.py --output python/checkpoints/v5-a2 --alpha 0.25

不自动登记候选到 manifest；测试集只在显式 --evaluate-test 时评估。
"""
import argparse
from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import random
import sqlite3
import sys

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from models.value_cnn import build_model_from_state_dict, get_device, infer_model_kwargs

SIZE = 15
GRID = np.arange(SIZE * SIZE).reshape(SIZE, SIZE)
# 每个排列把新坐标映射到原坐标；逆排列用于变换落子坐标。
PERMS = np.stack([
    (np.fliplr(np.rot90(GRID, k)) if flip else np.rot90(GRID, k)).ravel()
    for k in range(4) for flip in (False, True)
])
INVERSES = np.argsort(PERMS, axis=1)


def canonical_game(moves):
    variants = [tuple(int(p) for p in inverse[moves]) for inverse in INVERSES]
    transform = min(range(8), key=variants.__getitem__)
    return variants[transform], transform


def position_key(board):
    return min(board[perm].tobytes() for perm in PERMS)


@dataclass
class Sample:
    board: np.ndarray  # 0=empty, 1=black, 2=white
    policy: np.ndarray
    q: float
    z: float
    ply: int
    tactical: bool


def load_games(db_path, batch_ids):
    """同一 D4 棋谱合为一盘；每次搜索等权平均 policy/q，不按搜索速度加权。"""
    groups = {}
    counts = defaultdict(int)
    digest = hashlib.sha256()
    with sqlite3.connect(Path(db_path).expanduser().resolve().as_uri() + "?mode=ro", uri=True) as con:
        for batch in sorted(set(batch_ids)):
            rows = con.execute(
                "SELECT id, black_model, white_model, winner, moves, policies "
                "FROM games WHERE batch_id=? ORDER BY id", (batch,))
            for game_id, black, white, winner, moves_json, policies_json in rows:
                digest.update(json.dumps([batch, game_id, black, white, winner,
                                          moves_json, policies_json]).encode())
                moves, transform = canonical_game(json.loads(moves_json))
                policies = json.loads(policies_json)
                if winner not in ("black", "white", "draw") or len(policies) != len(moves):
                    raise ValueError(f"game {game_id}: invalid result or policies length")
                group_id = hashlib.sha256(bytes(moves)).hexdigest()
                if group_id not in groups:
                    groups[group_id] = {"moves": moves, "winner": winner, "ids": [],
                                        "policy": np.zeros((len(moves), SIZE * SIZE)),
                                        "q": np.zeros(len(moves)), "tactical": None}
                group = groups[group_id]
                tactical = np.array([step["t"] for step in policies], dtype=bool)
                if group["winner"] != winner or (group["tactical"] is not None
                                                and not np.array_equal(group["tactical"], tactical)):
                    raise ValueError(f"game {game_id}: inconsistent duplicate labels")
                group["tactical"] = tactical
                board = np.zeros(SIZE * SIZE, dtype=np.uint8)
                for ply, (pos, step) in enumerate(zip(moves, policies)):
                    if board[pos]:
                        raise ValueError(f"game {game_id}, ply {ply}: occupied move")
                    if not step["t"]:
                        dist = np.zeros(SIZE * SIZE)
                        for key, visits in step["d"].items():
                            dist[INVERSES[transform, int(key)]] = visits
                        q = float(step["q"])
                        if (not np.isfinite(dist).all() or (dist < 0).any()
                                or dist.sum() <= 0 or dist[board != 0].any()
                                or not math.isfinite(q) or not -1 <= q <= 1):
                            raise ValueError(f"game {game_id}, ply {ply}: invalid search labels")
                        group["policy"][ply] += dist / dist.sum()
                        group["q"][ply] += q
                    board[pos] = 1 + ply % 2
                group["ids"].append(game_id)
                counts[batch] += 1
            if not counts[batch]:
                raise ValueError(f"empty batch: {batch}")
    games = {}
    for key, group in groups.items():
        board = np.zeros(SIZE * SIZE, dtype=np.uint8)
        samples = []
        n = len(group["ids"])
        for ply, pos in enumerate(group["moves"]):
            player = "black" if ply % 2 == 0 else "white"
            z = 0.0 if group["winner"] == "draw" else (1.0 if group["winner"] == player else -1.0)
            samples.append(Sample(board.copy(), (group["policy"][ply] / n).astype(np.float32),
                                  float(group["q"][ply] / n), z, ply, bool(group["tactical"][ply])))
            board[pos] = 1 + ply % 2
        games[key] = samples
    summary = {"batches": dict(counts), "games": sum(counts.values()), "groups": len(games),
               "quiet_after_grouping": sum(not s.tactical for g in games.values() for s in g),
               "tactical_after_grouping": sum(s.tactical for g in games.values() for s in g)}
    return games, {"fingerprint": digest.hexdigest(), "summary": summary,
                   "game_ids": {key: g["ids"] for key, g in groups.items()}}


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def split_games(games, metadata, path, seed):
    keys = sorted(games)
    random.Random(seed).shuffle(keys)
    n_train, n_val = int(len(keys) * 0.8), int(len(keys) * 0.1)
    if not n_train or not n_val:
        raise ValueError("need at least 10 unique game groups for an 80/10/10 split")
    split = {"train": keys[:n_train], "val": keys[n_train:n_train + n_val],
             "test": keys[n_train + n_val:]}
    manifest = {"version": 1, "seed": seed, **metadata, "split": split}
    path = Path(path)
    if path.exists():
        if json.loads(path.read_text()) != manifest:
            raise ValueError(f"{path}: dataset/seed changed; use a new split file")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json(path, manifest)
    return {name: [s for key in group_keys for s in games[key]]
            for name, group_keys in split.items()}


class PositionDataset(Dataset):
    def __init__(self, samples, augment=False):
        self.samples = samples
        self.augment = augment

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        sample = self.samples[index]
        transform = random.randrange(8) if self.augment else 0
        board = sample.board[PERMS[transform]].reshape(SIZE, SIZE)
        player = 1 + sample.ply % 2
        tensor = np.stack((board == player, board == 3 - player, board == 0)).astype(np.float32)
        policy = sample.policy[PERMS[transform]]
        return tensor, policy, np.float32(sample.q), np.float32(sample.z), sample.tactical


def losses(pred_v, logits, policies, q, z, tactical, alpha, tactical_weight):
    quiet = ~tactical
    target = torch.where(tactical, z, alpha * z + (1 - alpha) * q)
    ce = -(policies * F.log_softmax(logits, dim=1)).sum(1)
    weights = torch.where(tactical, tactical_weight, 1.0)
    # 固定每样本权重；纯 tactical batch 的权重也不会被重新归一化掉。
    return (ce * quiet + weights * (pred_v.flatten() - target).square()).mean()


def correlation(x, y):
    x, y = x - x.mean(), y - y.mean()
    denominator = np.linalg.norm(x) * np.linalg.norm(y)
    return float(np.dot(x, y) / denominator) if denominator else None


def evaluate(model, samples, device, alpha, train_keys, batch_size):
    loader = DataLoader(PositionDataset(samples), batch_size=batch_size)
    values, ces, kls, top1, top3 = [], [], [], [], []
    model.eval()
    with torch.inference_mode():
        for boards, policy, _, _, _ in loader:
            v, logits = model(boards.to(device))
            log_probs = F.log_softmax(logits.cpu(), dim=1)
            ce = -(policy * log_probs).sum(1)
            entropy = -torch.special.xlogy(policy, policy).sum(1)
            best = policy.argmax(1)
            values.extend(v.flatten().cpu().tolist())
            ces.extend(ce.tolist())
            kls.extend((ce - entropy).tolist())
            top1.extend((log_probs.argmax(1) == best).tolist())
            top3.extend((log_probs.topk(3, dim=1).indices == best[:, None]).any(1).tolist())
    pred = np.array(values)
    q = np.array([s.q for s in samples])
    z = np.array([s.z for s in samples])
    quiet = np.array([not s.tactical for s in samples])
    target = np.where(quiet, alpha * z + (1 - alpha) * q, z)
    ply = np.array([s.ply for s in samples])
    unseen = np.array([position_key(s.board) not in train_keys for s in samples])
    masks = {"quiet": quiet, "quiet_unseen": quiet & unseen,
             "quiet_black": quiet & (ply % 2 == 0), "quiet_white": quiet & (ply % 2 == 1),
             "quiet_ply_0_9": quiet & (ply < 10), "quiet_ply_10_29": quiet & (ply >= 10) & (ply < 30),
             "quiet_ply_30_plus": quiet & (ply >= 30), "tactical": ~quiet,
             "tactical_unseen": ~quiet & unseen}
    result = {}
    for name, mask in masks.items():
        n = int(mask.sum())
        metrics = {"n": n}
        if n:
            for label, truth in (("target", target), ("q", q), ("z", z)):
                if name.startswith("tactical") and label == "q":
                    continue
                metrics[f"mse_{label}"] = float(np.mean((pred[mask] - truth[mask]) ** 2))
                metrics[f"corr_{label}"] = correlation(pred[mask], truth[mask])
            if name.startswith("quiet"):
                for label, data in (("ce", ces), ("kl", kls), ("top1", top1), ("top3", top3)):
                    metrics[label] = float(np.array(data)[mask].mean())
                metrics["loss"] = metrics["ce"] + metrics["mse_target"]
        result[name] = metrics
    return result


def run_training(args):
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    output = Path(args.output).expanduser().resolve()
    if output.exists():
        raise FileExistsError(f"use a new --output directory: {output}")
    games, metadata = load_games(args.db, args.batch_id or ["teacher-20260911"])
    partitions = split_games(games, metadata, args.split_file, args.seed)
    train_samples = [s for s in partitions["train"] if not s.tactical or args.tactical_weight > 0]
    if not train_samples or not any(not s.tactical for s in partitions["val"]):
        raise ValueError("training samples and quiet validation samples are required")
    train_keys = {position_key(s.board) for s in train_samples}
    device = get_device() if args.device == "auto" else torch.device(args.device)
    state = torch.load(args.warm_start, map_location="cpu", weights_only=True)
    model = build_model_from_state_dict(state)
    model.load_state_dict(state)
    model.to(device)
    output.mkdir(parents=True)
    config = {**vars(args), "device_used": str(device), "torch_version": torch.__version__,
              "architecture": infer_model_kwargs(state), "data": metadata["summary"],
              "data_fingerprint": metadata["fingerprint"],
              "warm_start_sha256": hashlib.sha256(Path(args.warm_start).read_bytes()).hexdigest(),
              "positions": {name: len(rows) for name, rows in partitions.items()},
              "train_samples": len(train_samples), "unique_train_positions_d4": len(train_keys)}
    write_json(output / "config.json", config)
    write_json(output / "split.json", json.loads(Path(args.split_file).read_text()))
    print(json.dumps(config, indent=2), flush=True)
    baseline = evaluate(model, partitions["val"], device, args.alpha, train_keys, args.batch)
    write_json(output / "baseline-val.json", baseline)
    print(f"[v4 val] {json.dumps(baseline['quiet'])}", flush=True)
    if args.evaluate_only:
        if args.evaluate_test:
            write_json(output / "baseline-test.json",
                       evaluate(model, partitions["test"], device, args.alpha, train_keys, args.batch))
        model.load_state_dict(torch.load(args.evaluate_only, map_location=device, weights_only=True))
        write_json(output / "candidate-val.json",
                   evaluate(model, partitions["val"], device, args.alpha, train_keys, args.batch))
        if args.evaluate_test:
            write_json(output / "candidate-test.json",
                       evaluate(model, partitions["test"], device, args.alpha, train_keys, args.batch))
        print(f"[done] evaluation saved to {output}", flush=True)
        return
    loader = DataLoader(PositionDataset(train_samples, augment=True), batch_size=args.batch,
                        shuffle=True, generator=torch.Generator().manual_seed(args.seed))
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    best_loss, best_epoch, bad_epochs, updates = float("inf"), 0, 0, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        lr = optimizer.param_groups[0]["lr"]
        for batch in loader:
            boards, policy, q, z, tactical = [x.to(device) for x in batch]
            optimizer.zero_grad(set_to_none=True)
            pred_v, logits = model(boards)
            loss = losses(pred_v, logits, policy, q, z, tactical, args.alpha, args.tactical_weight)
            if not torch.isfinite(loss):
                raise ValueError(f"non-finite loss at epoch {epoch}, update {updates}")
            loss.backward()
            optimizer.step()
            total += loss.item() * len(boards)
            updates += 1
        scheduler.step()
        val = evaluate(model, partitions["val"], device, args.alpha, train_keys, args.batch)
        record = {"epoch": epoch, "updates": updates, "lr": lr,
                  "train_loss": total / len(train_samples), "val": val}
        with (output / "metrics.jsonl").open("a") as f:
            f.write(json.dumps(record, allow_nan=False) + "\n")
        score = val["quiet"]["loss"]
        if not math.isfinite(score):
            raise ValueError(f"non-finite validation loss at epoch {epoch}")
        print(f"[epoch {epoch}/{args.epochs}] updates={updates} "
              f"train={record['train_loss']:.4f} val={score:.4f} "
              f"mse_z={val['quiet']['mse_z']:.4f} corr_z={val['quiet']['corr_z']} "
              f"top1={val['quiet']['top1']:.3f}", flush=True)
        if score < best_loss:
            best_loss, best_epoch, bad_epochs = score, epoch, 0
            torch.save({k: v.detach().cpu().clone() for k, v in model.state_dict().items()},
                       output / "best.pth")
            write_json(output / "best-val.json", record)
        else:
            bad_epochs += 1
            if bad_epochs >= args.patience:
                break
    summary = {"best_epoch": best_epoch, "best_val_loss": best_loss, "updates": updates,
               "checkpoint": str(output / "best.pth")}
    if args.evaluate_test:
        model.load_state_dict(state)
        write_json(output / "baseline-test.json",
                   evaluate(model, partitions["test"], device, args.alpha, train_keys, args.batch))
        model.load_state_dict(torch.load(output / "best.pth", map_location=device, weights_only=True))
        write_json(output / "best-test.json",
                   evaluate(model, partitions["test"], device, args.alpha, train_keys, args.batch))
    write_json(output / "summary.json", summary)
    print(f"[done] {json.dumps(summary)}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(Path("~/.games/selfplay.sqlite").expanduser()))
    parser.add_argument("--batch-id", action="append", help="默认 teacher-20260911；可重复指定")
    parser.add_argument("--warm-start", default=str(BASE / "checkpoints/4.pth"))
    parser.add_argument("--output", required=True, help="新的候选输出目录")
    parser.add_argument("--split-file", default=str(BASE / "checkpoints/v5-split.json"))
    parser.add_argument("--alpha", type=float, default=0.5, help="value 中最终胜负的权重")
    parser.add_argument("--tactical-weight", type=float, default=0.0, help="可选 A3：战术 value 的损失权重")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--wd", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    parser.add_argument("--evaluate-test", action="store_true", help="显式允许训练结束后评估保留测试集")
    parser.add_argument("--evaluate-only", help="仅评估指定候选权重，不训练；可配合 --evaluate-test")
    args = parser.parse_args()
    if not 0 <= args.alpha <= 1 or args.tactical_weight < 0:
        parser.error("alpha must be in [0,1]; tactical-weight must be nonnegative")
    if min(args.epochs, args.patience, args.batch) < 1 or args.lr <= 0 or args.wd < 0:
        parser.error("epochs/patience/batch/lr must be positive; wd must be nonnegative")
    run_training(args)


if __name__ == "__main__":
    main()
