# heuristic-v3

模型名：`heuristic-v3`。已接入 `models.REGISTRY` 和 checkpoint manifest，沿用
现有 engine / MCTS 接口 `(board, player) -> (value, policy)`。

## 评分结构

1. 复用 v2 的 72 条有效线和落点到线的索引：15 横、15 竖、两个方向各 21 条斜线。
2. 枚举无对手的五格窗口。棋子不能参与任何这样的窗口时，该方向严格为零。
   边界与对手一样阻挡；长度不足五的线直接没有窗口。
3. 窗口产生棋子集合候选，相同集合合并。以试落子的方式递归判定活四、活三、
   活二：活四有两个不同成五点，活三能一步成为活四，活二能一步成为活三。
4. 候选只用自己的棋子做延伸验证。更大棋子集合吞并所有严格子集，即使子集的
   数值更高：例如不能把 `OXXX____` 中的两个子抽出来，按活二 12 分压过眠三 10 分。
   其余相交候选做最大分不重叠选择；不同方向可以复用同一棋子。
5. 重叠选择使用固定参考权重和特征向量平局规则。运行时传入拟合权重不会改变
   特征提取，旋转/镜像也不会因扫描顺序改变结果。
6. 静态分为双方特征差的线性加权和。单子、二子最多额外获得 0.1 的局部空间分；
   空间由包含整个候选的有效五格窗口数量决定，最多四档。中心每步 0.02，单子
   最大 0.14。空间奖励不用于三、四威胁，空线没有奖励。

### 初始分值

| 类别 | 分值 |
|---|---:|
| 活四 | 1000 |
| 连续冲四 / 31 跳四 / 22 跳四 | 100 / 98 / 96 |
| 活三 / 跳活三 | 80 / 78 |
| 活二 | 12 |
| 眠三 / 单空跳眠三 / 两空散三 | 10 / 8 / 6 |
| 跳活二 `X_X` / 宽跳活二 `X__X` | 8 / 6 |
| 双侧可发展的单子 / 单侧单子 | 1 / 0.3 |
| 眠二 / 跳眠二 | 0.8 / 0.6 |

所有类别都要求有成五可能，活形还必须通过延伸验证。
`__X__` 在恰好五格空间中仍有 1 分，但比更宽空间略低。
`O_XXX_O` 是眠三；`O_XX__O` 是眠二；`OXX` 如果到此就是边界则为零。
成五和长连（>=5）独立判断终局，不参与线性拟合。

## value 与 policy

`static_score(board, player, weights=None)` 用于非终局静态偏序。
`evaluate_board_v3(board, player, to_move=None, weights=None)` 明确区分评估视角和行棋方；
默认由 `player` 行棋。

- 已成五：±1；满盘无胜者：0。
- 行棋方有成五点：按评估视角返回 ±0.99。
- 否则对手有两个不同成五点：无法一手全堵，返回相应 ±0.99。
- 对手只有一个成五点：试下必堵点，递归处理双方冲四反击。每层填一个空格，必定终止。
- 普通局面：`0.98 * tanh(static_score / 400)`。普通活三不会被统一压成固定 value。

policy 先处理成五和唯一必堵点。普通候选复用 `get_candidates()`，按落子后的：

1. 对手是否能立即获胜；
2. 我方是否形成两个不同成五点；
3. 对手下一手是否能形成两个成五点、且我方不能立即反胜；

划分战术优先级，只在最高优先级的候选中以静态增量做 softmax，温度 20。
第三步通过实际试落子验证，也覆盖交叉双冲四。它防止在对手将先形成活四时，
被我方静态双三高分诱惑。更深的非强制攻防仍由现有 tactics / MCTS 处理。

成五点始终来自整条实际棋线，并映射为全盘坐标集合，独立于静态棋形去重。
两个方向共用一个成五点只能算一次。落子只重算至多四条线，不修改传入棋盘。
线特征及延伸结果有有界 LRU 缓存。

## 数据集与测试

在 `python/` 目录使用全局默认 `python`：

```sh
python -m unittest tests.test_heuristic_v3 tests.test_fit_heuristic_v3 -q
python -m tests.test_heuristic_v2
```

只依赖已有 NumPy 和标准库 unittest。

`tests/heuristic_v3_cases.json` 包含：

- 45 个单线偏序/相等 case，扩展镜像及颜色交换；
- 9 个整盘静态 case，扩展 8 种旋转/镜像；
- 10 个 policy case，扩展 8 种旋转/镜像，包括 v2 的实战回归盘面；
- 49 个训练评分 case、5 个按家族隔离的留出评分 case。

文本中的 `_` 是空位，`X/O` 是双方棋子，文本外部是边界。整盘坐标从 0 开始。
单线分与整盘分分别断言，避免其他方向的贡献破坏原本只针对单线的比较。
`margin` 指严格偏序所需最小分差；`relation: "="` 表示相等。

另外穷举长度 5～9 的全部 29,403 个三态线段，用独立字符串试落子判定器验证
终局、成五点、死区和符合条件的二/三子延伸分类；测试还覆盖跨方向双威胁的
独立整盘试落子 oracle、局部更新与整盘重算一致、颜色与 D4 对称、终局和空盘。

## 参数拟合

```sh
python train/fit_heuristic_v3.py
python train/fit_heuristic_v3.py --weights starting_weights.json --output fitted_weights.json
```

使用 NumPy 实现的 Dykstra 投影，求满足训练约束、离初始表欧氏距离最小的参数：

```text
min ||theta - theta_initial||²
s.t. (features(lhs) - features(rhs)) · theta >= margin
     等分 case 的特征差 · theta = 0
     theta >= 0
     FOUR_HALF = 100
     SPACE <= 0.25, CENTER <= 0.05
```

这是硬约束最小改动拟合，不用软损失隐藏必需偏序的失败。特征相同却要求严格
大小时立即报错；冲突或未收敛会报出失败 case。留出集仅验收，不用于更新参数；
验证失败时命令退出非零且不输出权重文件。policy 的战术 case 独立验收，不当作
线性约束拟合。输出权重后仍应运行模型测试，评分约束通过不代表棋力已提升。

当前初始表已满足全部评分 case，因此默认拟合保留初始值。测试额外验证了故意
扰乱权重后的修复、矛盾约束暴露和留出隔离。

运行时可把完整权重表传给评分器或模型：

```python
import json
from functools import partial
from models.heuristic_v3 import heuristic_v3_model

with open("fitted_weights.json") as f:
    weights = json.load(f)
model = partial(heuristic_v3_model, weights=weights)
value, policy = model(board, player)
```

新增 case 时先判断是识别错误、特征不足、参数错误还是数据矛盾。尤其不能依靠
调整权重解决共享成五点、伪活三、先手反击等结构问题。
