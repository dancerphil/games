#!/usr/bin/env python3
"""从自对弈 sqlite 训练 nn-v2：与 v1 同结构，从零训练。

用法：
    uv run python python/train_sqlite.py --epochs 10
    uv run python python/train_sqlite.py --db ~/.games/selfplay.sqlite --batch-id v2-train --epochs 10
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
CHECKPOINT = os.path.join(BASE, "checkpoints", "2.pth")

# v1 同结构（反推自 1.pth）
HIDDEN = 16
BLOCKS = 2
VALUE_DIM = 32


class PositionDataset(Dataset):
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def load_positions(db_path, batch_id):
    """重放每盘 moves，拆成逐步样本 (tensor, move, value)。按盘切分用。"""
    con = sqlite3.connect(db_path)
    games = con.execute(
        "SELECT moves, winner FROM games WHERE batch_id = ?", (batch_id,)
    ).fetchall()
    con.close()
    per_game = []
    for moves_json, winner in games:
        moves = json.loads(moves_json)
        board = [None] * (BOARD_SIZE * BOARD_SIZE)
        samples = []
        for ply, pos in enumerate(moves):
            player = "black" if ply % 2 == 0 else "white"
            samples.append((board_to_tensor(board, player), pos, player))
            board[pos] = player
        if winner == "draw":
            values = [0.0] * len(samples)
        else:
            values = [
                1.0 if player == winner else -1.0 for _, _, player in samples
            ]
        per_game.append(
            [(t, m, v) for (t, m, _), v in zip(samples, values)]
        )
    return per_game


def augment(rows):
    out = []
    for tensor, move, value in rows:
        r, c = divmod(move, BOARD_SIZE)
        policy = torch.zeros(BOARD_SIZE, BOARD_SIZE)
        policy[r, c] = 1.0
        for k in range(4):
            for flip in (False, True):
                t = torch.rot90(tensor, k, [1, 2])
                p = torch.rot90(policy, k, [0, 1])
                if flip:
                    t = torch.flip(t, [2])
                    p = torch.flip(p, [1])
                out.append((t, p.reshape(-1), torch.tensor(value)))
    return out


def run_training(args):
    per_game = load_positions(args.db, args.batch_id)
    n_games = len(per_game)
    n_pos = sum(len(g) for g in per_game)
    print(f"[train] games={n_games} positions={n_pos} augmented={n_pos * 8}")

    random.shuffle(per_game)
    split = int(n_games * 0.9)
    train_rows = [s for g in per_game[:split] for s in g]
    val_rows = [s for g in per_game[split:] for s in g]
    train_rows = augment(train_rows)
    val_rows = augment(val_rows)
    random.shuffle(train_rows)
    print(f"[train] train={len(train_rows)} val={len(val_rows)}")

    device = get_device()
    print(f"[train] device={device}")
    model = ValueCNN(
        in_channels=3, hidden_channels=HIDDEN, num_blocks=BLOCKS,
        value_dim=VALUE_DIM,
    ).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    train_loader = DataLoader(
        PositionDataset(train_rows), batch_size=args.batch, shuffle=True)
    val_loader = DataLoader(PositionDataset(val_rows), batch_size=512)

    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for boards, policies, values in train_loader:
            boards = torch.stack(list(boards)).to(device)
            policies = torch.stack(list(policies)).to(device)
            values = torch.stack(list(values)).to(device).unsqueeze(1)
            opt.zero_grad()
            pred_v, pred_logits = model(boards)
            loss = F.mse_loss(pred_v, values) + F.cross_entropy(
                pred_logits, policies)
            loss.backward()
            opt.step()
            total += loss.item()
        model.eval()
        correct = counted = 0
        vloss = 0.0
        with torch.no_grad():
            for boards, policies, values in val_loader:
                boards = torch.stack(list(boards)).to(device)
                policies = torch.stack(list(policies)).to(device)
                values = torch.stack(list(values)).to(device).unsqueeze(1)
                pred_v, pred_logits = model(boards)
                vloss += F.mse_loss(pred_v, values).item()
                correct += (pred_logits.argmax(1) == policies.argmax(1)).sum().item()
                counted += len(boards)
        print(f"[train] epoch {epoch + 1}/{args.epochs} "
              f"loss={total / len(train_loader):.4f} "
              f"val_mse={vloss / max(1, len(val_loader)):.4f} "
              f"val_acc={correct / max(1, counted):.3f}", flush=True)

    os.makedirs(os.path.dirname(CHECKPOINT), exist_ok=True)
    torch.save(model.state_dict(), CHECKPOINT)
    print(f"[train] saved {CHECKPOINT}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    run_training(parser.parse_args())


if __name__ == "__main__":
    main()
