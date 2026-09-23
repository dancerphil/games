# v6-full：交叉局面蒸馏

```sh
pnpm train
```

默认输出 `python/checkpoints/v6-full/`。同一个命令中断后重跑即可续跑。
同一输出目录一次只运行一个进程；参数、输入数据、老师权重或相关源码变化时使用新 `--output`。
`pnpm train:base` 保留原 base 入口。

## 执行顺序与预算

1. 读取 base/v5 原始切分，确认数据指纹一致。
2. 整理三个交叉批次：`update-elo-20260921`、`update-elo-20260922`、`update-elo-20260922-2`。
   当前合计 910 盘；第三批中的 100 盘 base/老师对战不会重复计算。
3. 固定选择 5,000 个待重分析局面，先完成前 500 个并输出访问数/耗时审计，然后自动继续。
4. 从 A3 热启动训练 30,000 次更新，每 1,000 次验证并保存恢复点。

重分析默认每局面 5 秒、2 workers，约 6.9 worker-hours，墙钟时间预计数小时。
训练在全部重分析结束后开始，自动选择 CUDA / MPS / CPU。前 500 个的审计不证明老师标签最优，
用于检查访问量和实际成本；没有搜索访问或非法标签会直接报错，不会伪造有效样本。

如果想先看审计再跑余下部分：

```sh
pnpm train --pilot-only
# 查看 pilot-audit.json 后，原目录继续：
pnpm train
```

调整搜索预算或并发需要新目录，例如：

```sh
pnpm train --workers 1 --time-ms 10000 --output python/checkpoints/v6-full-10s
```

## 标签与切分

- 原自对弈沿用 `v6-base/split.json`，旧回放沿用 `v5-split.json`。
- 旧回放只使用原训练集，再剔除与 base 验证/测试局面重合的样本。
- 交叉对局按完整棋谱 D4 等价类固定 80/10/10 切分，重分析继承原局面的归属。
- 只采原 base/v5 全部数据都未覆盖的局面；同一交叉局面跨集合出现时整体剔除。
- 同局面只保留一个标签；已有 mix 老师搜索时优先复用，不平均其他模型的 π/q。
- 对其他模型步骤，仅保留其局面来源；搜索标签由当前冻结的 mix-v5-h3 重新生成。
- 交叉数据只训练 quiet，value 目标为老师 q，不使用对局胜负。tactical 继续从自对弈/旧回放学习。
- 前两手沿用普通自对弈 quiet 标签，不修改开局候选和规则。

局面筛选在优先组（A1、旧融合老师、mix）与其余对手之间轮流抽取；组内兼顾对手、
行棋颜色和锚点模型胜/和/负，每盘 D4 棋谱最多提供 12 个重分析局面，原老师标签另限 12 个。
若候选不足 5,000 个会直接报告数量，调整 `--reanalyze-count` 或 `--per-game` 时使用新输出目录。
这里的 5,000 个包含交叉验证/测试份额，不是全部加入训练。

`cross-plan.json` 记录行为模型、原对局、棋谱组、split、标签老师与原搜索预算。
`reanalysis.sqlite` 保存每条重新搜索的 π/q、访问数、预算和耗时，逐条提交，续跑不重算已完成项。
`config.json` 冻结老师配方、依赖权重/源码哈希、输入指纹；历史原老师标签只有原对局来源，
不会把当前权重哈希冒充为历史生成时的哈希。

## 训练与选模

- A3 热启动，H32/B4/V64，30,000 updates，AdamW lr=1e-4 / wd=1e-4，cosine。
- 总 batch=128，按来源约 70/20/10 分配：89 个自对弈、26 个交叉、13 个旧回放。
- 各来源内部有放回抽样，在线 D4 增强；交叉训练先等概率选择对手×行棋颜色桶，再选样本。
- 每个来源 quiet/tactical 分别归一化，以固定 0.7/0.2/0.1 权重组合损失。
- 自对弈和回放 quiet value 使用 0.25z+0.75q，tactical value 权重 0.25；交叉仅使用 q。
- 验证同样按来源固定权重；保存综合分数最优的 `best.pth` 和最近验证的 `last.pth`。
- A3、base、full 使用同一评估数据与同一训练局面排除集合报告 unseen。
  跨棋谱的历史局面重合仍会存在，整体指标不等于未见局面指标。

输出包括：

- `config.json`、`cross-plan.json`、`data-summary.json`：冻结输入、来源与规模。
- `pilot-audit.json`、`full-audit.json`：重分析质量/耗时统计。
- `baseline-a3-val.json`、`baseline-base-val.json`：共同评估集上的基线。
- `metrics.json`、`best-val.json`、`summary.json`：训练指标与选模结果。
- `best.pth`、`last.pth`：可被现有推理加载的纯 state_dict。
- `resume.pth`：优化器、调度器、模型、抽样随机状态及更新进度，每次验证原子保存。

训练中断后恢复到最近验证点；尚未保存的更新会重做。已完成的训练重跑时直接报告完成。
不自动修改 manifest。最终用新的固定开局对局验收 full vs base，重点观察 A1/A2 执白表现。

## 最终候选测试集评估

默认不计算测试集指标。选定候选后，在同一输出目录使用：

```sh
pnpm train --evaluate-only python/checkpoints/v6-full/best.pth --evaluate-test
```

写入 `candidate-val.json` 和 `candidate-test.json`。自定义训练参数时，评估命令也需保持一致。
