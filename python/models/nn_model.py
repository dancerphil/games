import numpy as np
import torch
import torch.nn.functional as F

from .value_cnn import ValueCNN, build_model_from_state_dict, get_device

BOARD_SIZE = 15
_model_cache = {}


def board_to_tensor(board, player):
    # board flat 225, player to move is 1, opp -1, empty 0 from player perspective
    arr = np.zeros((3, BOARD_SIZE, BOARD_SIZE), dtype=np.float32)
    for i, v in enumerate(board):
        r, c = divmod(i, BOARD_SIZE)
        if v is None:
            arr[2, r, c] = 1
        elif v == player:
            arr[0, r, c] = 1
        else:
            arr[1, r, c] = 1
    return torch.from_numpy(arr)


def load_model(checkpoint_path):
    device = get_device()
    if checkpoint_path in _model_cache:
        return _model_cache[checkpoint_path]
    state_dict = torch.load(checkpoint_path, map_location=device, weights_only=True)
    model = build_model_from_state_dict(state_dict)
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    _model_cache[checkpoint_path] = model
    return model


def nn_model_fn(checkpoint_path):
    device = get_device()

    def fn(board, player):
        model = load_model(checkpoint_path)
        tensor = board_to_tensor(board, player).unsqueeze(0).to(device)
        with torch.no_grad():
            value, logits = model.forward(tensor)
            v = float(value.squeeze(0).squeeze(0).cpu().item())
            probs = F.softmax(logits, dim=1).view(-1, BOARD_SIZE, BOARD_SIZE).squeeze(0).cpu().numpy()
            # mask illegal
            mask = np.zeros_like(probs)
            for i, cell in enumerate(board):
                if cell is None:
                    r, c = divmod(i, BOARD_SIZE)
                    mask[r, c] = 1
            probs = probs * mask
            s = probs.sum()
            if s > 1e-8:
                probs /= s
            else:
                # uniform over legal
                cnt = (mask > 0).sum()
                if cnt:
                    probs = mask / cnt
            flat = probs.reshape(-1)
            return v, flat

    return fn



