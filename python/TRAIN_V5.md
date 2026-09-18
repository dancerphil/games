# v5 同构蒸馏

从项目根目录执行，沿用全局 `python`、PyTorch 和 NumPy。默认自动选择 CUDA / MPS / CPU。

## 训练

先运行 A1（value = 0.5 胜负 + 0.5 根 q）：

```sh
python python/train_sqlite_v5.py --output python/checkpoints/v5-a1
```

再运行 A2（value = 0.25 胜负 + 0.75 根 q）：

```sh
python python/train_sqlite_v5.py --output python/checkpoints/v5-a2 --alpha 0.25
```

两次使用相同的 `4.pth`、随机种子和 `python/checkpoints/v5-split.json`。
默认数据是 `~/.games/selfplay.sqlite` 的 `teacher-20260911`。
可通过重复 `--batch-id` 加入其他批次；改数据或种子时必须指定新的 `--split-file`。
输出目录必须尚不存在，避免覆盖候选。脚本不覆盖 `4.pth`，也不自动登记 manifest。

默认 AdamW，batch=128，lr=1e-4，wd=1e-4，cosine，最多 100 epoch，patience=12。
每个 epoch 遍历一次去重后的训练局面，每次随机使用一个 D4 方向；不是八份展开。
日志记录累计 updates，比较训练预算时使用更新次数。

## 数据与评估

- 按完整落子序列的旋转/镜像等价类去重。同组每一步的访问概率、q 等权平均。
- 按棋谱组固定划分 80/10/10；split 文件记录源数据指纹、原始 game ID 和分组。
- 不同棋谱共享的局面仍保留；评估同时报告全部 quiet 与训练未见过的 D4 局面。
- 默认只训练 quiet。战术 value 单独评估，战术 policy 不参与训练。
- v4 验证基线与每轮验证均报告 policy CE/KL、top1/top3，以及 value 对 target/q/z 的 MSE、相关性。
- 附加黑白、0–9/10–29/30+ 手分项；相关性无定义时记为 null。
- 每轮按样本数汇总，按 quiet 验证 CE + target MSE 保存最佳权重并早停。
- A1/A2 的 target 不同，不能跨实验直接比较该总 loss；优先比较共同的 z/q、policy 指标，并用实战决定晋级。
- 测试集默认不评估，避免在调参中反复使用。

空棋盘当前临时固定首手中心 `(7,7)`，避免未受监督的网络偏置直接进入实战；战术层只负责胜负威胁。
历史数据保持原样。历史空棋盘被标成 tactical，默认不训练该步，也不伪造 q。

## V6 TODO

- [ ] 将首手偏好纳入训练监督，验证模型能够稳定处理空棋盘后，移除 `mcts.py` 中的硬编码中心策略。

## 输出

每个候选目录包含：

- `config.json`：参数、模型结构、v4 权重指纹、数据规模。
- `split.json`：本次使用的切分副本。
- `baseline-val.json`：v4 验证基线。
- `metrics.jsonl`：逐 epoch 训练和分项验证指标。
- `best.pth`：最佳候选的纯 state_dict，可直接用现有推理加载。
- `best-val.json`：最佳 epoch 的完整指标。
- `summary.json`：最佳 epoch、验证 loss、累计更新次数。

最佳权重每次改善后立即保存；脚本暂不支持续训，中断后重新训练需使用新输出目录。

## 选择候选后评估保留测试集

例如选中 A2：

```sh
python python/train_sqlite_v5.py \
  --evaluate-only python/checkpoints/v5-a2/best.pth \
  --evaluate-test --alpha 0.25 \
  --output python/checkpoints/v5-a2-eval
```

这一步不训练，输出 v4 和候选的验证/测试报告。
应使用与训练一致的 batch-id、seed、split-file、alpha 和 tactical-weight。
也可显式在训练命令上添加 `--evaluate-test`，在训练结束后评估测试集。

## 可选 A3

如果希望检验搜索树内部 tactical value 的分布缺口，可以在选定的 alpha 上做单独对照：

```sh
python python/train_sqlite_v5.py \
  --output python/checkpoints/v5-a3 --alpha 0.25 --tactical-weight 0.25
```

quiet 的损失为 policy CE + value MSE；tactical 只有 0.25 × MSE(value, 最终胜负)。
总损失按 batch 样本数平均，纯 tactical batch 也保留 0.25 权重。
这只是可选实验；A1/A2 即为本轮同构蒸馏的主流程。

最终注册 `nn-v5` 前仍需同预算实战比较；本脚本交付训练与离线评估，不自动决定晋级。
