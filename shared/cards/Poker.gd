extends Node
## 德扑牌型评估（移植自 poker.ts），供地雷德扑使用。
## 编号约定与 Cards.gd 相同。

# 牌型分类 0=高牌 1=一对 2=两对 3=三条 4=顺子 5=同花 6=葫芦 7=四条 8=同花顺
const HAND_NAMES := ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"]

# C(7,5) = 21 种组合，用于从7张里找最优5张
const COMBOS_7_5 := [
	[0,1,2,3,4],[0,1,2,3,5],[0,1,2,3,6],[0,1,2,4,5],[0,1,2,4,6],
	[0,1,2,5,6],[0,1,3,4,5],[0,1,3,4,6],[0,1,3,5,6],[0,1,4,5,6],
	[0,2,3,4,5],[0,2,3,4,6],[0,2,3,5,6],[0,2,4,5,6],[0,3,4,5,6],
	[1,2,3,4,5],[1,2,3,4,6],[1,2,3,5,6],[1,2,4,5,6],[1,3,4,5,6],
	[2,3,4,5,6],
]

static func suit_of(card: int) -> int:
	return card / 13

static func rank_of(card: int) -> int:
	return card % 13

## 评估5张牌，返回 {category, tiebreakers}
static func evaluate_five(cards: Array) -> Dictionary:
	var ranks: Array[int] = []
	for c in cards:
		ranks.append(rank_of(c))

	var flush := true
	var s0 := suit_of(cards[0])
	for c in cards:
		if suit_of(c) != s0:
			flush = false
			break

	var straight_top := _is_straight(ranks)

	if flush and straight_top >= 0:
		return {category = 8, tiebreakers = [straight_top]}

	var counts := _rank_counts(ranks)

	if counts[0][1] == 4:
		return {category = 7, tiebreakers = [counts[0][0], counts[1][0]]}
	if counts[0][1] == 3 and counts[1][1] == 2:
		return {category = 6, tiebreakers = [counts[0][0], counts[1][0]]}
	if flush:
		var sorted := ranks.duplicate()
		sorted.sort()
		sorted.reverse()
		return {category = 5, tiebreakers = sorted}
	if straight_top >= 0:
		return {category = 4, tiebreakers = [straight_top]}
	if counts[0][1] == 3:
		var kickers: Array[int] = []
		for i in range(1, counts.size()):
			kickers.append(counts[i][0])
		kickers.sort()
		kickers.reverse()
		return {category = 3, tiebreakers = [counts[0][0]] + kickers}
	if counts[0][1] == 2 and counts[1][1] == 2:
		var pairs := [counts[0][0], counts[1][0]]
		pairs.sort()
		pairs.reverse()
		return {category = 2, tiebreakers = pairs + [counts[2][0]]}
	if counts[0][1] == 2:
		var kickers: Array[int] = []
		for i in range(1, counts.size()):
			kickers.append(counts[i][0])
		kickers.sort()
		kickers.reverse()
		return {category = 1, tiebreakers = [counts[0][0]] + kickers}
	var sorted := ranks.duplicate()
	sorted.sort()
	sorted.reverse()
	return {category = 0, tiebreakers = sorted}

## 比较两个手牌评估，返回正/负/0（a>b / a<b / 平局）
static func compare(a: Dictionary, b: Dictionary) -> int:
	if a.category != b.category:
		return a.category - b.category
	for i in a.tiebreakers.size():
		if i >= b.tiebreakers.size():
			break
		if a.tiebreakers[i] != b.tiebreakers[i]:
			return a.tiebreakers[i] - b.tiebreakers[i]
	return 0

## 从7张牌中找最优5张评估
static func evaluate_best(cards: Array) -> Dictionary:
	if cards.size() == 5:
		return evaluate_five(cards)
	var best := evaluate_five(_pick(cards, COMBOS_7_5[0]))
	for combo in COMBOS_7_5.slice(1):
		var ev := evaluate_five(_pick(cards, combo))
		if compare(ev, best) > 0:
			best = ev
	return best

## 找最优5张的索引（供显示推荐）
static func best_indices(cards: Array) -> Array[int]:
	var best_idx := 0
	var best := evaluate_five(_pick(cards, COMBOS_7_5[0]))
	for i in range(1, COMBOS_7_5.size()):
		var ev := evaluate_five(_pick(cards, COMBOS_7_5[i]))
		if compare(ev, best) > 0:
			best = ev
			best_idx = i
	var result: Array[int] = []
	for idx in COMBOS_7_5[best_idx]:
		result.append(idx)
	return result

## 比较两手5张牌，返回 1=手牌1赢 2=手牌2赢 0=平局
static func hand_winner(hand1: Array, hand2: Array) -> int:
	var r := compare(evaluate_best(hand1), evaluate_best(hand2))
	if r > 0:
		return 1
	if r < 0:
		return 2
	return 0

static func hand_name(cards: Array) -> String:
	var ev := evaluate_best(cards)
	return HAND_NAMES[ev.category]

# --- 内部工具 ---

static func _pick(cards: Array, indices: Array) -> Array:
	var result := []
	for i in indices:
		result.append(cards[i])
	return result

static func _rank_counts(ranks: Array[int]) -> Array:
	var counts: Dictionary = {}
	for r in ranks:
		counts[r] = counts.get(r, 0) + 1
	var entries := []
	for r in counts:
		entries.append([r, counts[r]])
	entries.sort_custom(func(a, b): return b[1] > a[1] or (b[1] == a[1] and b[0] > a[0]))
	return entries

## 判断是否顺子，返回最大牌 rank 或 -1
static func _is_straight(ranks: Array[int]) -> int:
	var sorted := ranks.duplicate()
	sorted.sort()
	if sorted[4] - sorted[0] == 4 and _unique_count(sorted) == 5:
		return sorted[4]
	# A-2-3-4-5（wheel）
	if sorted[0] == 0 and sorted[1] == 1 and sorted[2] == 2 and sorted[3] == 3 and sorted[4] == 12:
		return 3
	return -1

static func _unique_count(arr: Array[int]) -> int:
	var seen: Dictionary = {}
	for v in arr:
		seen[v] = true
	return seen.size()
