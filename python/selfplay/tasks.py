import itertools


def build_tasks(models, games_per_pair, no_self=False, focus_models=None):
    """根据模型列表生成配对任务，可只筛选与重点模型相关的配对。"""
    all_pairs = (itertools.combinations(models, 2) if no_self
                 else itertools.combinations_with_replacement(models, 2))
    if focus_models is None:
        pairs = all_pairs
    else:
        focus = set(focus_models)
        pairs = (pair for pair in all_pairs if pair[0] in focus or pair[1] in focus)
    tasks = []
    for first, second in pairs:
        for index in range(games_per_pair):
            black, white = (first, second) if index % 2 == 0 else (second, first)
            tasks.append({
                "black_model": black,
                "white_model": white,
                "pair": f"{first} vs {second}",
            })
    return tasks
