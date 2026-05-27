extends Node
## 卡牌纹理缓存与编号约定（与 poker.ts 一致）。
## 编号：suit * 13 + rank
## suit: 0=clubs 1=diamonds 2=hearts 3=spades
## rank: 0=2, 1=3, ..., 7=9, 8=10, 9=J, 10=Q, 11=K, 12=A

const SUIT_NAMES := ["clubs", "diamonds", "hearts", "spades"]
const RANK_NAMES := ["02", "03", "04", "05", "06", "07", "08", "09", "10", "J", "Q", "K", "A"]
const SUIT_SYMBOLS := ["♣", "♦", "♥", "♠"]
const RANK_LABELS := ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]

# 国王与奴隶用到的牌
const HEARTS_K := 2 * 13 + 11
const HEARTS_10 := 2 * 13 + 8
const SPADES_2 := 3 * 13 + 0
const SPADES_10 := 3 * 13 + 8

# 九张牌 A-9（rank 12=A, 0=2..6=8, 7=9）
const HEARTS_A := 2 * 13 + 12
const SPADES_A := 3 * 13 + 12

# 九张牌双方手牌
const NINE_HEARTS: Array[int] = [
	2 * 13 + 12,  # A
	2 * 13 + 0,   # 2
	2 * 13 + 1,   # 3
	2 * 13 + 2,   # 4
	2 * 13 + 3,   # 5
	2 * 13 + 4,   # 6
	2 * 13 + 5,   # 7
	2 * 13 + 6,   # 8
	2 * 13 + 7,   # 9
]
const NINE_SPADES: Array[int] = [
	3 * 13 + 12,  # A
	3 * 13 + 0,   # 2
	3 * 13 + 1,   # 3
	3 * 13 + 2,   # 4
	3 * 13 + 3,   # 5
	3 * 13 + 4,   # 6
	3 * 13 + 5,   # 7
	3 * 13 + 6,   # 8
	3 * 13 + 7,   # 9
]

# 九张牌的牌面点数（A=9，其余按面值），用于比较大小和得分计算
const NINE_VALUE: Dictionary = {
	2 * 13 + 12: 9, 3 * 13 + 12: 9,  # A=9
	2 * 13 + 0: 2,  3 * 13 + 0: 2,
	2 * 13 + 1: 3,  3 * 13 + 1: 3,
	2 * 13 + 2: 4,  3 * 13 + 2: 4,
	2 * 13 + 3: 5,  3 * 13 + 3: 5,
	2 * 13 + 4: 6,  3 * 13 + 4: 6,
	2 * 13 + 5: 7,  3 * 13 + 5: 7,
	2 * 13 + 6: 8,  3 * 13 + 6: 8,
	2 * 13 + 7: 9,  3 * 13 + 7: 9,  # 9=9（与 A 并列最大）
}

var _cache: Dictionary = {}

func texture(card: int) -> Texture2D:
	if _cache.has(card):
		return _cache[card]
	var suit := card / 13
	var rank := card % 13
	var path := "res://shared/cards/kenney/PNG/Cards (large)/card_%s_%s.png" % [SUIT_NAMES[suit], RANK_NAMES[rank]]
	var tex := load(path) as Texture2D
	_cache[card] = tex
	return tex

func back_texture() -> Texture2D:
	if _cache.has(-1):
		return _cache[-1]
	var tex := load("res://shared/cards/kenney/PNG/Cards (large)/card_back.png") as Texture2D
	_cache[-1] = tex
	return tex

func label(card: int) -> String:
	return SUIT_SYMBOLS[card / 13] + RANK_LABELS[card % 13]
