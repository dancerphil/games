import torch
import torch.nn as nn
import torch.nn.functional as F

BOARD_SIZE = 15


class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)
        self.relu = nn.ReLU()

    def forward(self, x):
        residual = x
        out = self.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out += residual
        out = self.relu(out)
        return out


class ValueCNN(nn.Module):
    def __init__(self, in_channels=3, hidden_channels=32, num_blocks=4, value_dim=64):
        super().__init__()
        self.conv_init = nn.Conv2d(in_channels, hidden_channels, kernel_size=3, padding=1)
        self.bn_init = nn.BatchNorm2d(hidden_channels)
        self.res_blocks = nn.ModuleList([ResidualBlock(hidden_channels) for _ in range(num_blocks)])
        self.policy_conv1 = nn.Conv2d(hidden_channels, hidden_channels // 2, kernel_size=3, padding=1)
        self.policy_bn1 = nn.BatchNorm2d(hidden_channels // 2)
        self.policy_conv2 = nn.Conv2d(hidden_channels // 2, 1, kernel_size=3, padding=1)
        self.value_conv = nn.Conv2d(hidden_channels, 1, kernel_size=1)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(BOARD_SIZE * BOARD_SIZE, value_dim)
        self.value_fc2 = nn.Linear(value_dim, 1)

    def forward(self, x):
        x = F.relu(self.bn_init(self.conv_init(x)))
        for block in self.res_blocks:
            x = block(x)
        policy = F.relu(self.policy_bn1(self.policy_conv1(x)))
        policy = self.policy_conv2(policy)
        policy = policy.squeeze(1)
        policy_logits = policy.view(x.size(0), -1)
        value = F.relu(self.value_bn(self.value_conv(x)))
        value = value.view(x.size(0), -1)
        value = F.relu(self.value_fc1(value))
        value = torch.tanh(self.value_fc2(value))
        return value, policy_logits

    def calc(self, x):
        self.eval()
        with torch.no_grad():
            value, logits = self.forward(x)
            probs = F.softmax(logits, dim=1).view(-1, BOARD_SIZE, BOARD_SIZE)
            return value, probs


def infer_model_kwargs(state_dict):
    hidden = state_dict["conv_init.weight"].shape[0]
    block_idxs = {int(k.split(".")[1]) for k in state_dict if k.startswith("res_blocks.")}
    num_blocks = len(block_idxs)
    value_dim = state_dict["value_fc1.weight"].shape[0]
    return {
        "in_channels": state_dict["conv_init.weight"].shape[1],
        "hidden_channels": hidden,
        "num_blocks": num_blocks,
        "value_dim": value_dim,
    }


def build_model_from_state_dict(state_dict):
    return ValueCNN(**infer_model_kwargs(state_dict))


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
