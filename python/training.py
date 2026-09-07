import os
import random
import math
import copy
import time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

from models.value_cnn import ValueCNN, get_device
from models.nn_model import board_to_tensor
from mcts_puct import MCTS as PUCTMCTS

BOARD_SIZE = 15
CHECKPOINT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")

class Config:
    num_games = 20
    simulations = 25
    epochs = 2
    batch_size = 32
    lr = 1e-3
    hidden = 32
    blocks = 4
    value_dim = 64

def check_win(board, player):
    # board is 2D list 15x15 with 1/-1/0 from current player's perspective? Use flat board absolute
    # For training we use absolute board, check win via flat
    from mcts import check_win_at
    for i, v in enumerate(board):
        if v == player and check_win_at(board, i, player):
            return True
    return False

def is_terminal(board):
    from mcts import check_win_at
    for i, v in enumerate(board):
        if v and check_win_at(board, i, v):
            return True
    return all(v is not None for v in board)

def winner_of(board):
    from mcts import check_win_at
    for i, v in enumerate(board):
        if v and check_win_at(board, i, v):
            return v
    return None

class SelfPlayDataset(Dataset):
    def __init__(self, boards, policies, values):
        self.boards = boards
        self.policies = policies
        self.values = values
    def __len__(self):
        return len(self.boards)
    def __getitem__(self, idx):
        return self.boards[idx], self.policies[idx], self.values[idx]

def run_selfplay(model, simulations):
    # model is ValueCNN or None (use heuristic uniform)
    # returns list of (board, policy, player)
    from models.nn_model import board_to_tensor as b2t
    device = get_device()
    if model is not None:
        model.eval()
        def model_fn(board, player):
            tensor = b2t(board, player).unsqueeze(0).to(device)
            with torch.no_grad():
                value, logits = model.forward(tensor)
                v = float(value.squeeze().cpu().item())
                probs = F.softmax(logits, dim=1).view(-1, BOARD_SIZE, BOARD_SIZE).squeeze(0).cpu().numpy()
                # mask illegal
                for i, vv in enumerate(board):
                    if vv is not None:
                        r, c = divmod(i, BOARD_SIZE)
                        probs[r, c] = 0
                s = probs.sum()
                if s > 1e-8:
                    probs /= s
                else:
                    cnt = sum(1 for vv in board if vv is None)
                    if cnt:
                        for i, vv in enumerate(board):
                            if vv is None:
                                r, c = divmod(i, BOARD_SIZE)
                                probs[r, c] = 1.0 / cnt
                return v, probs.reshape(-1)
    else:
        # heuristic uniform
        def model_fn(board, player):
            # use heuristic_model for value, uniform policy over candidates
            from models.heuristic import heuristic_model
            v, p = heuristic_model(board, player)
            return v, p

    board = [None] * 225
    player = "black"
    history = []  # list of (board_copy, policy, player)
    # MCTS instance
    mcts = PUCTMCTS(model_fn)

    for _ in range(225):
        if is_terminal(board):
            break
        # run PUCT for simulations and get policy from visit counts
        # We need to run MCTS and extract policy
        # Use mcts.run but we need policy, so we replicate logic: expand root and run simulations, then get visit distribution
        from mcts_puct import Node
        import time
        root = Node(board[:], player)
        mcts.expand(root)
        if not root.children:
            break
        deadline = time.monotonic() + 0.3  # 0.3s per move for data generation (faster)
        # do simulations
        for _ in range(simulations):
            if time.monotonic() > deadline:
                break
            node = root
            path = [node]
            while node.is_expanded and node.children and not mcts.is_terminal(node.board):
                node = mcts.select_child(node)
                path.append(node)
            if mcts.is_terminal(node.board):
                leaf_value = mcts.terminal_value(node.board, node.player)
            else:
                if not node.is_expanded:
                    leaf_value = mcts.expand(node)
                else:
                    leaf_value = node.value
            for n in reversed(path):
                n.visit_count += 1
                n.value_sum += leaf_value
                leaf_value = -leaf_value
        # policy from visits
        visits = np.zeros(225, dtype=np.float32)
        total = sum(c.visit_count for c in root.children.values())
        for pos, child in root.children.items():
            visits[pos] = child.visit_count / total if total else 0
        history.append((board[:], visits.copy(), player))
        # sample move with temperature
        # temperature 1.0 for first 10 moves, then 0.5, then 0.1
        move_num = len(history)
        if move_num < 8:
            temp = 1.0
        elif move_num < 20:
            temp = 0.5
        else:
            temp = 0.2
        # apply temperature
        if temp == 0:
            move = max(root.children.items(), key=lambda kv: kv[1].visit_count)[0]
        else:
            # softmax over visits with temp
            probs = visits.copy()
            # only consider legal
            legal = [i for i, v in enumerate(board) if v is None]
            # use visits as proxy, apply temp
            vals = np.array([visits[i] for i in legal], dtype=np.float64)
            if temp != 1.0:
                vals = np.power(vals, 1.0 / temp)
            s = vals.sum()
            if s > 0:
                vals /= s
                move = int(np.random.choice(legal, p=vals))
            else:
                move = legal[0]
        board[move] = player
        w = winner_of(board)
        if w is not None:
            break
        if all(v is not None for v in board):
            break
        player = "white" if player == "black" else "black"

    w = winner_of(board)
    # assign values
    data = []
    for b, p, pl in history:
        if w is None:
            v = 0.0
        elif w == pl:
            v = 1.0
        else:
            v = -1.0
        # board tensor from perspective of player pl
        tensor = board_to_tensor(b, pl)
        data.append((tensor, torch.from_numpy(p), torch.tensor(v, dtype=torch.float32)))
    return data

def augment_data(data):
    # D4
    augmented = []
    for tensor, policy, value in data:
        # tensor 3x15x15, policy 225
        policy_2d = policy.view(BOARD_SIZE, BOARD_SIZE)
        for k in range(4):
            for flip in [False, True]:
                import torch
                t = torch.rot90(tensor, k, [1, 2])
                p = torch.rot90(policy_2d, k, [0, 1])
                if flip:
                    t = torch.flip(t, [2])
                    p = torch.flip(p, [1])
                augmented.append((t, p.reshape(-1), value))
    return augmented

def train_one_round(model, optimizer, data):
    device = get_device()
    model.train()
    # augment
    data = augment_data(data)
    random.shuffle(data)
    # split train/val 90%
    n = len(data)
    split = int(n * 0.9)
    train_data = data[:split]
    val_data = data[split:] if split < n else data[:1]

    train_ds = SelfPlayDataset(*zip(*[(b, p, v) for b, p, v in train_data])) if train_data else None
    # Actually SelfPlayDataset expects tensors already, but we have tensors
    # Create loaders manually
    def make_loader(ds_data, shuffle):
        boards = torch.stack([b for b, _, _ in ds_data])
        policies = torch.stack([p for _, p, _ in ds_data])
        values = torch.stack([v for _, _, v in ds_data])
        # values already 0-d, need unsqueeze
        return DataLoader(SelfPlayDataset(boards, policies, values), batch_size=Config.batch_size, shuffle=shuffle)

    if not train_data:
        return

    train_loader = make_loader(train_data, True)
    val_loader = make_loader(val_data, False) if len(val_data) else train_loader

    for epoch in range(Config.epochs):
        total_loss = 0
        for boards, policies, values in train_loader:
            boards = boards.to(device)
            policies = policies.to(device)
            values = values.to(device).unsqueeze(1)
            optimizer.zero_grad()
            pred_v, pred_logits = model(boards)
            loss_v = F.mse_loss(pred_v, values)
            loss_p = F.cross_entropy(pred_logits, policies)
            loss = loss_v * 1.0 + loss_p * 1.0
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f" epoch {epoch+1}/{Config.epochs} loss {total_loss/len(train_loader):.4f}")

def main():
    os.makedirs(CHECKPOINT_DIR, exist_ok=True)
    device = get_device()
    print(f"device {device}")
    model = ValueCNN(in_channels=3, hidden_channels=Config.hidden, num_blocks=Config.blocks, value_dim=Config.value_dim).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=Config.lr)

    # check existing checkpoint
    existing = [f for f in os.listdir(CHECKPOINT_DIR) if f.endswith(".pth")]
    start = 0
    if existing:
        nums = []
        for f in existing:
            try:
                nums.append(int(os.path.splitext(f)[0]))
            except:
                pass
        if nums:
            start = max(nums)
            ckpt = os.path.join(CHECKPOINT_DIR, f"{start}.pth")
            print(f"loading {ckpt}")
            sd = torch.load(ckpt, map_location=device, weights_only=True)
            model.load_state_dict(sd)

    for rnd in range(start, start + 1):  # single round for minimal
        print(f"=== round {rnd+1} selfplay ===")
        all_data = []
        for g in range(Config.num_games):
            print(f" game {g+1}/{Config.num_games}")
            data = run_selfplay(model, Config.simulations)
            all_data.extend(data)
        print(f" collected {len(all_data)} positions")
        train_one_round(model, optimizer, all_data)
        ckpt_path = os.path.join(CHECKPOINT_DIR, f"{rnd+1}.pth")
        torch.save(model.state_dict(), ckpt_path)
        print(f"saved {ckpt_path}")

if __name__ == "__main__":
    main()
