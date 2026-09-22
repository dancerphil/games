# v6-base 同构蒸馏

项目根目录执行：

```sh
pnpm train
```

使用全局 `python`，自动选择 CUDA / MPS / CPU。默认读取
`~/.games/selfplay.sqlite` 的 `teacher-20260921-2`，从
`python/checkpoints/v5-a3/best.pth` 热启动，输出到 `python/checkpoints/v6-base/`。
输出目录必须不存在。训练不会自动登记模型到 manifest。

## 默认配置

- 30,000 次更新，batch=128，AdamW，lr=1e-4，wd=1e-4，按更新数 cosine 衰减。
- 每 1,000 次更新验证，最终一步也验证；不早停，便于固定预算比较。
- quiet：policy CE + MSE(value, 0.25z + 0.75q)。
- tactical：0.25 × MSE(value, z)，不学习 tactical policy。
- quiet 和 tactical 在各自样本内取均值，再相加；记录实际样本曝光量。
- 仅屏蔽已占用位置，训练与评估一致，不屏蔽老师未探索的合法动作。
- 前两手按普通 quiet 样本参与训练，不增加专项开局数据或搜索规则。

沿用 v5 的完整棋谱 D4 分组、重复搜索等权平均、在线 D4 增强和固定 80/10/10 切分。
切分保存在 `python/checkpoints/v6-base-split.json`。只支持同一老师的自对弈数据；
混合对手、强制前缀和重分析不属于这个 loader 的输入。

例如修改预算或设备：

```sh
pnpm train --updates 40000 --device mps --output python/checkpoints/v6-base-40k
```

更换数据或种子时使用新的 `--split-file`。`--batch-id` 可以重复传入，但所有批次必须来自同一个老师自对弈。
数据指纹能检测已记录数据的变化；历史老师名不等价于权重哈希，不要在同名批次中混入不同配方的数据。

## 输出与选模

- `config.json` / `split.json`：配置、数据指纹、热启动权重哈希、切分与规模。
- `baseline-val.json`：热启动模型的验证指标。
- `metrics.jsonl`：每次验证的分项指标、综合分数、曝光量和耗时。
- `best.pth` / `best-val.json`：quiet loss + tactical_weight × tactical MSE 最优的训练候选。
- `last.pth`：最近一次验证时的权重，正常完成后是最终权重。
- `summary.json`：总更新数、最佳更新和分数。

权重均为纯 state_dict，可直接被现有推理加载。训练中断时最多保留到上次验证；
当前不支持恢复优化器/采样状态，重新训练应使用新输出目录。

`quiet_first_move`、`quiet_second_move` 报告网络在全部合法格上的 policy CE/KL、top1/top3
和 value 指标。空盘只有一个独立状态，这些指标用于检查已有开局偏好是否学进权重，不代表异常开局泛化。
常规、未见局面和 tactical 指标也会保留。最终候选仍需同预算实战对照 A3 和老师。

## 显式评估保留测试集

选定候选后执行：

```sh
pnpm train --evaluate-only python/checkpoints/v6-base/best.pth \
  --evaluate-test --output python/checkpoints/v6-base-eval
```

评估时使用与训练相同的数据、切分和目标参数。日常训练默认不接触测试集。
