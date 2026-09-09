#!/usr/bin/env python3
"""从 v3-train 自对弈 sqlite 训练 nn-v3：新增结构，从零训练。

与 train_sqlite.py（nn-v2，H16/B2/V32，单 batch，val 也增强，Adam 1e-3）
的区别：
- 结构 H32/B4/V64，产物 checkpoints/3.pth；
- 支持多 --batch-id（v3-train-1 + v3-train-2 共 900 局）；
- policy 用 MCTS visit 分布软目标（policies 列），不再是落子 one-hot；
- val 集不做旋转翻转增强，只用原始方向选模型；
- AdamW + 早停存验证最优，不存最后一个 epoch。

用法：
    python python/train_sqlite_v3.py --batch-id v3-train-1 --batch-id v3-train-2 --epochs 20
"""
import argparse
import json
import os
import random
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(__file__))

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from models.nn_model import board_to_tensor
from models.value_cnn import ValueCNN, get_device

BOARD_SIZE = 15
BASE = os.path.dirname(__file__)
DEFAULT_DB = os.path.expanduser("~/.games/selfplay.sqlite")
CHECKPOINT = os.path.join(BASE, "checkpoints", "3.pth")

# v3 结构（v1/v2 为 H16/B2/V32，见 train_sqlite.py）
HIDDEN = 32
BLOCKS = 4
VALUE_DIM = 64


class PositionDataset(Dataset):
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def load_positions(db_path, batch_ids):
    """重放每盘 moves，拆成逐手样本 (tensor, policy225, value)。按盘切分用。

    policy 目标：policies 列每手 {"d": {pos: visits}, "t": bool}，
    tactical 步本来就是单点分布，统一归一化即可。
    """
    con = sqlite3.connect(db_path)
    per_game = []
    for batch_id in batch_ids:
        games = con.execute(
            "SELECT moves, winner, policies FROM games WHERE batch_id = ?",
            (batch_id,),
        ).fetchall()
        print(f"[train] batch={batch_id} games={len(games)}")
        for moves_json, winner, policies_json in games:
            moves = json.loads(moves_json)
            policies = json.loads(policies_json) if policies_json else [None] * len(moves)
            board = [None] * (BOARD_SIZE * BOARD_SIZE)
            samples = []
            for ply, pos in enumerate(moves):
                player = "black" if ply % 2 == 0 else "white"
                if winner == "draw":
                    value = 0.0
                else:
                    value = 1.0 if player == winner else -1.0
                dist = torch.zeros(BOARD_SIZE * BOARD_SIZE)
                visits = (policies[ply] or {}).get("d") if ply < len(policies) else None
                if visits:
                    total = sum(visits.values())
                    for k, v in visits.items():
                        dist[int(k)] = v / total
                else:
                    # 无 visit 记录时退化为落子 one-hot（与 v2 一致）
                    dist[pos] = 1.0
                samples.append((board_to_tensor(board, player), dist, value))
                board[pos] = player
            per_game.append(samples)
    con.close()
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


def run_training(args):
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
    model = ValueCNN(
        in_channels=3, hidden_channels=HIDDEN, num_blocks=BLOCKS,
        value_dim=VALUE_DIM,
    ).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)

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
        model.eval()
        vloss = vmse = 0.0
        top1 = top3 = counted = 0
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
                counted += len(boards)
        n_val = max(1, len(val_loader))
        vloss /= n_val
        vmse /= n_val
        print(f"[train] epoch {epoch + 1}/{args.epochs} "
              f"loss={total / len(train_loader):.4f} "
              f"val_loss={vloss:.4f} val_mse={vmse:.4f} "
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--batch-id", action="append", required=True,
                        help="可重复指定，如 --batch-id v3-train-1 --batch-id v3-train-2")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--lr", type=float, default=5e-4)
    parser.add_argument("--wd", type=float, default=1e-4)
    run_training(parser.parse_args())


if __name__ == "__main__":
    main()
