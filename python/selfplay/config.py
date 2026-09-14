import os


BOARD_SIZE = 15
DEFAULT_DB = os.path.expanduser("~/.games/selfplay.sqlite")
LOG_DIR = os.path.expanduser("~/.games/logs")

ELO_INIT = 1500.0
ELO_K = 32.0

# 运行时只通过 --mode 选择工作流；以下固定参数直接修改常量。
WORKERS = 8
DB = DEFAULT_DB
BATCH_ID = None              # None=自动生成；续跑时填已有 batch
SAMPLE_MOVES = 4
TIME_LIMIT_MS = 5000

CONFIGS = {
    "train": {
        "models": ["nn4-policy-h2v80", "nn4-policy-h2-value"],
        "games_per_pair": 200,
        "no_self": True,
    },
    "update-elo": {
        "models": ["nn4-policy-h2v80"],  # None=全部模型；列表=重点模型
        "games_per_pair": 10,
        "no_self": True,
    },
    "teacher": {
        "models": ["nn4-policy-h2v80"],
        "games_per_pair": 2000,
        "no_self": False,
    },
}
