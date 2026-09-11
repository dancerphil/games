#!/usr/bin/env python3
"""从 v4-train 自对弈 sqlite 训练 nn-v4：warm start nn-v3，修复 v3 的 value 短板。

v3 教训（见 train_sqlite_v3.py）：
- value 目标只有弱棋手对局胜负 ±1，quiet 局面信号近似噪声
  （真实 quiet 局面 pred_v 与胜负 corr=-0.21），是致命短板；
- 29.7% 样本是 tactical 步（推理时被 tactics.py 短路，网络永远见不到）；
- 仅数 epoch，val_loss 仍在下降，欠训练；
- 训练局 28.9% 重复（v4 已由 --sample-moves 解决，实测 3.0%）。

v4 对策：
- 只用 quiet 步（t=false）：训练分布 = 推理分布；
- value 目标 = 0.5×胜负 + 0.5×根q（老师 MCTS 的 visit 加权 q，
  实测与最终胜负 corr=+0.38，是稠密且方向正确的评估信号）；
- 从 3.pth warm start（同构 H32/B4/V64），AdamW + cosine LR 训练到收敛；
- val 增报 value corr（pred_v vs 目标），直接监控 v3 的失败模式。

用法：
    python python/train_sqlite_v4.py --batch-id v4-train-1 --epochs 80
"""
import argparse
import json
import math
import os
import random
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(__file__))

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from models.nn_model import board_to_tensor
from models.value_cnn import build_model_from_state_dict, get_device

BOARD_SIZE = 15
BASE = os.path.dirname(__file__)
DEFAULT_DB = os.path.expanduser("~/.games/selfplay.sqlite")
CHECKPOINT = os.path.join(BASE, "checkpoints", "4.pth")
CHECKPOINT_FILE = os.path.basename(CHECKPOINT)
WARM_START = os.path.join(BASE, "checkpoints", "3.pth")
MANIFEST = os.path.join(BASE, "checkpoints", "manifest.json")


class PositionDataset(Dataset):
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def load_positions(db_path, batch_ids):
    """重放每盘 moves，只取 quiet 步：(tensor, policy225, value)。按盘切分用。

    policy 目标：MCTS visit 分布；value 目标 = 0.5×胜负 + 0.5×根q
    （均为行棋方视角）。tactical 步由 tactics.py 短路，网络学不到也用不上。
    """
    con = sqlite3.connect(db_path)
    per_game = []
    n_skip = 0
    for batch_id in batch_ids:
        games = con.execute(
            "SELECT moves, winner, policies FROM games WHERE batch_id = ?",
            (batch_id,),
        ).fetchall()
        print(f"[train] batch={batch_id} games={len(games)}")
        for moves_json, winner, policies_json in games:
            moves = json.loads(moves_json)
            policies = json.loads(policies_json) if policies_json else []
            board = [None] * (BOARD_SIZE * BOARD_SIZE)
            samples = []
            for ply, pos in enumerate(moves):
                player = "black" if ply % 2 == 0 else "white"
                step = policies[ply] if ply < len(policies) else None
                visits = (step or {}).get("d")
                q = (step or {}).get("q")
                if step and not step.get("t") and visits and q is not None:
                    if winner == "draw":
                        result = 0.0
                    else:
                        result = 1.0 if player == winner else -1.0
                    dist = torch.zeros(BOARD_SIZE * BOARD_SIZE)
                    total = sum(visits.values())
                    for k, v in visits.items():
                        dist[int(k)] = v / total
                    value = 0.5 * result + 0.5 * q
                    samples.append((board_to_tensor(board, player), dist, value))
                else:
                    n_skip += 1
                board[pos] = player
            if samples:
                per_game.append(samples)
    con.close()
    print(f"[train] quiet samples kept, skipped {n_skip} tactical/invalid steps")
    return per_game


def augment(rows):
    out = []
    for tensor, policy, value in rows:
        p = policy.reshape(BOARD_SIZE, BOARD_SIZE)
        for k in range(4):
            for flip in (False, True):
                t = torch.rot90(tensor, k, [1, 2])
                q = torch.rot90(p, k, [0, 1])
                if flip:
                    t = torch.flip(t, [2])
                    q = torch.flip(q, [1])
                out.append((t, q.reshape(-1), torch.tensor(value)))
    return out


def to_plain(rows):
    return [(t, p, torch.tensor(v)) for t, p, v in rows]


def soft_ce_loss(pred_logits, targets):
    return -(targets * F.log_softmax(pred_logits, dim=1)).sum(dim=1).mean()


def pearson(xs, ys):
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    return cov / math.sqrt(vx * vy) if vx > 0 and vy > 0 else float("nan")


def run_training(args):
    random.seed(0)
    per_game = load_positions(args.db, args.batch_id)
    n_games = len(per_game)
    n_pos = sum(len(g) for g in per_game)
    print(f"[train] games={n_games} positions={n_pos} augmented={n_pos * 8}")

    random.shuffle(per_game)
    split = int(n_games * 0.9)
    train_rows = augment([s for g in per_game[:split] for s in g])
    # val 不增强：只用原始方向，避免指标偏乐观
    val_rows = to_plain([s for g in per_game[split:] for s in g])
    random.shuffle(train_rows)
    print(f"[train] train={len(train_rows)} val={len(val_rows)}")

    device = get_device()
    print(f"[train] device={device}")
    state_dict = torch.load(args.warm_start, map_location=device, weights_only=True)
    model = build_model_from_state_dict(state_dict)
    model.load_state_dict(state_dict)
    model.to(device)
    print(f"[train] warm start from {args.warm_start}")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    train_loader = DataLoader(
        PositionDataset(train_rows), batch_size=args.batch, shuffle=True)
    val_loader = DataLoader(PositionDataset(val_rows), batch_size=512)

    best_val = float("inf")
    best_state = None
    bad_epochs = 0
    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for boards, policies, values in train_loader:
            boards = torch.stack(list(boards)).to(device)
            policies = torch.stack(list(policies)).to(device)
            values = torch.stack(list(values)).to(device).unsqueeze(1)
            opt.zero_grad()
            pred_v, pred_logits = model(boards)
            loss = F.mse_loss(pred_v, values) + soft_ce_loss(pred_logits, policies)
            loss.backward()
            opt.step()
            total += loss.item()
        sched.step()
        model.eval()
        vloss = vmse = 0.0
        top1 = top3 = counted = 0
        preds, targets = [], []
        with torch.no_grad():
            for boards, policies, values in val_loader:
                boards = torch.stack(list(boards)).to(device)
                policies = torch.stack(list(policies)).to(device)
                values = torch.stack(list(values)).to(device).unsqueeze(1)
                pred_v, pred_logits = model(boards)
                batch_mse = F.mse_loss(pred_v, values)
                vmse += batch_mse.item()
                vloss += (batch_mse + soft_ce_loss(pred_logits, policies)).item()
                top1 += (pred_logits.argmax(1) == policies.argmax(1)).sum().item()
                top3 += sum(
                    p.argmax().item() in o.topk(3).indices.tolist()
                    for p, o in zip(policies, pred_logits)
                )
                preds.extend(pred_v.squeeze(1).cpu().tolist())
                targets.extend(values.squeeze(1).cpu().tolist())
                counted += len(boards)
        n_val = max(1, len(val_loader))
        vloss /= n_val
        vmse /= n_val
        vcorr = pearson(preds, targets)
        print(f"[train] epoch {epoch + 1}/{args.epochs} "
              f"loss={total / len(train_loader):.4f} "
              f"val_loss={vloss:.4f} val_mse={vmse:.4f} val_vcorr={vcorr:+.3f} "
              f"val_top1={top1 / max(1, counted):.3f} "
              f"val_top3={top3 / max(1, counted):.3f}", flush=True)
        if vloss < best_val:
            best_val = vloss
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            bad_epochs = 0
        else:
            bad_epochs += 1
            if bad_epochs >= args.patience:
                print(f"[train] early stop at epoch {epoch + 1} "
                      f"best_val={best_val:.4f}")
                break

    os.makedirs(os.path.dirname(CHECKPOINT), exist_ok=True)
    model.load_state_dict(best_state)
    torch.save(model.state_dict(), CHECKPOINT)
    print(f"[train] saved {CHECKPOINT} best_val={best_val:.4f}")
    register_manifest(args.model, CHECKPOINT_FILE)


def register_manifest(model_name, checkpoint_file):
    """落盘即登记：serving 下次启动直接可用，不改代码。"""
    with open(MANIFEST) as f:
        data = json.load(f)
    data[model_name] = {"checkpoint": checkpoint_file}
    with open(MANIFEST, "w") as f:
        json.dump(data, f, indent=4, sort_keys=True)
        f.write("\n")
    print(f"[train] registered {model_name} -> {checkpoint_file} in manifest")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--batch-id", action="append", required=True,
                        help="可重复指定，如 --batch-id v4-train-1")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--patience", type=int, default=12)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--wd", type=float, default=1e-4)
    parser.add_argument("--warm-start", default=WARM_START)
    parser.add_argument("--model", default="nn-v4",
                        help="登记到 manifest 的模型名")
    run_training(parser.parse_args())


if __name__ == "__main__":
    main()
