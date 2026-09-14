"""无界面自对弈工具包。"""

# models/mcts 仍被项目内其他脚本以顶层模块方式导入；
# 作为 package 运行时，把 python/ 加入模块搜索路径保持兼容。
import os
import sys

_PYTHON_DIR = os.path.dirname(os.path.dirname(__file__))
if _PYTHON_DIR not in sys.path:
    sys.path.insert(0, _PYTHON_DIR)
