## 招式对战规则引擎（移植自 web 版 shared/src 的 geometry/shapes/patterns/skill/stances）。
## 棋盘 7×7，坐标用 Vector2i(row, col)。NONE 表示「无目标 / null」。
## 每个招式定义：移动范围 move_options、攻击可选格 attack_targets、命中格 hit_cells。
class_name Stance

const BOARD := 7
const NONE := Vector2i(-1, -1)

const ALL: Array[String] = [
	"snake", "crane", "leopard", "tiger", "dragon", "turtle", "horse",
	"charge", "dodge", "crab", "monkey", "ox", "dog",
]

# 招式中文名（展示用）
const LABEL := {
	"snake": "蛇", "crane": "鹤", "leopard": "豹", "tiger": "虎", "dragon": "龙",
	"turtle": "龟", "horse": "马", "charge": "冲", "dodge": "闪", "crab": "蟹",
	"monkey": "猴", "ox": "牛", "dog": "狗",
}

const CARDINALS: Array[Vector2i] = [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]
const DIAGONALS: Array[Vector2i] = [Vector2i(-1, -1), Vector2i(-1, 1), Vector2i(1, -1), Vector2i(1, 1)]
const KNIGHT: Array[Vector2i] = [
	Vector2i(1, 2), Vector2i(1, -2), Vector2i(-1, 2), Vector2i(-1, -2),
	Vector2i(2, 1), Vector2i(2, -1), Vector2i(-2, 1), Vector2i(-2, -1),
]

# --- 几何 ---

static func forward(pi: int) -> Vector2i:
	return Vector2i(0, 1 if pi == 0 else -1)

static func dominant_unit(delta: Vector2i) -> Vector2i:
	if delta == Vector2i.ZERO:
		return Vector2i.ZERO
	if absi(delta.x) >= absi(delta.y):
		return Vector2i(signi(delta.x), 0)
	return Vector2i(0, signi(delta.y))

static func in_bounds(p: Vector2i) -> bool:
	return p.x >= 0 and p.x < BOARD and p.y >= 0 and p.y < BOARD

static func _keep(cells: Array[Vector2i]) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for c in cells:
		if in_bounds(c):
			out.append(c)
	return out

# --- 形状 ---

static func _filled_square(center: Vector2i, radius: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for dr in range(-radius, radius + 1):
		for dc in range(-radius, radius + 1):
			cells.append(center + Vector2i(dr, dc))
	return _keep(cells)

static func _square_ring(center: Vector2i, radius: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for dr in range(-radius, radius + 1):
		for dc in range(-radius, radius + 1):
			if maxi(absi(dr), absi(dc)) == radius:
				cells.append(center + Vector2i(dr, dc))
	return _keep(cells)

static func _perpendicular_sweep(center: Vector2i, axis: Vector2i) -> Array[Vector2i]:
	if axis == Vector2i.ZERO:
		return _keep([center] as Array[Vector2i])
	return _keep([center - axis, center, center + axis] as Array[Vector2i])

# --- Boss 用到的公开形状/工具 ---

static func filled_square(center: Vector2i, radius: int) -> Array[Vector2i]:
	return _filled_square(center, radius)

static func square_ring(center: Vector2i, radius: int) -> Array[Vector2i]:
	return _square_ring(center, radius)

static func full_row(row: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for c in BOARD: cells.append(Vector2i(row, c))
	return _keep(cells)

static func full_col(col: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for r in BOARD: cells.append(Vector2i(r, col))
	return _keep(cells)

static func full_line(through: Vector2i, direction: Vector2i) -> Array[Vector2i]:
	if direction == Vector2i.ZERO:
		return _keep([through] as Array[Vector2i])
	var cells: Array[Vector2i] = []
	for s in [1, -1]:
		var cur := through
		while in_bounds(cur):
			cells.append(cur)
			cur += direction * s
	return dedupe(cells)

static func diagonal_cross(through: Vector2i) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	cells.append_array(full_line(through, Vector2i(1, 1)))
	cells.append_array(full_line(through, Vector2i(1, -1)))
	return dedupe(cells)

static func line_segment(start: Vector2i, direction: Vector2i, length: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for i in length: cells.append(start + direction * i)
	return _keep(cells)

static func checkerboard(parity: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	for r in BOARD:
		for c in BOARD:
			if (r + c) % 2 == parity: cells.append(Vector2i(r, c))
	return cells

static func rectangle_border(a: Vector2i, b: Vector2i) -> Array[Vector2i]:
	var min_r := mini(a.x, b.x); var max_r := maxi(a.x, b.x)
	var min_c := mini(a.y, b.y); var max_c := maxi(a.y, b.y)
	var cells: Array[Vector2i] = []
	for r in range(min_r, max_r + 1):
		for c in range(min_c, max_c + 1):
			if r == min_r or r == max_r or c == min_c or c == max_c:
				cells.append(Vector2i(r, c))
	return _keep(cells)

static func dedupe(cells: Array[Vector2i]) -> Array[Vector2i]:
	var seen := {}
	var out: Array[Vector2i] = []
	for c in cells:
		if not seen.has(c): seen[c] = true; out.append(c)
	return out

static func manhattan(a: Vector2i, b: Vector2i) -> int:
	return absi(a.x - b.x) + absi(a.y - b.y)

# --- 招式属性 ---

static func is_no_move(name: String) -> bool:
	return name in ["dragon", "turtle", "charge"]

static func is_dodge(name: String) -> bool:
	return name == "dodge"

static func is_charge(name: String) -> bool:
	return name == "charge"

# --- 移动范围 ---

static func move_options(name: String, from: Vector2i, _pi: int) -> Array[Vector2i]:
	var cells: Array[Vector2i] = []
	match name:
		"dragon", "turtle", "charge":
			return cells
		"snake", "crab":
			for d in DIAGONALS: cells.append(from + d)
		"crane", "tiger", "ox", "dodge", "dog":
			for d in CARDINALS: cells.append(from + d)
		"leopard", "monkey":
			for d in CARDINALS: cells.append(from + d * 2)
		"horse":
			for d in KNIGHT: cells.append(from + d)
	return _keep(cells)

# --- 攻击可选目标（from=移动前原位，to=移动后落点）---

static func attack_targets(name: String, from: Vector2i, to: Vector2i, pi: int) -> Array[Vector2i]:
	var moved := from != to
	var delta := to - from
	match name:
		"charge", "dodge":
			return [] as Array[Vector2i]
		"crane", "leopard", "horse":
			var unit := forward(pi) if delta == Vector2i.ZERO else dominant_unit(delta)
			return _keep([to + unit, to - unit] as Array[Vector2i])
		"snake":
			if moved:
				return _keep([Vector2i(from.x, to.y), Vector2i(to.x, from.y)] as Array[Vector2i])
			return _keep([Vector2i(to.x - 1, to.y), Vector2i(to.x + 1, to.y)] as Array[Vector2i])
		"tiger":
			var unit := delta if moved else forward(pi)
			return _keep([to + unit] as Array[Vector2i])
		"ox":
			return _keep([to] as Array[Vector2i])
		"dragon":
			return _square_ring(to, 2)
		"turtle":
			return _filled_square(to, 1)
		"crab":
			var cells: Array[Vector2i] = []
			for d in DIAGONALS:
				var cell := to + d
				if not moved or cell != from:
					cells.append(cell)
			return _keep(cells)
		"monkey":
			return _keep([to] as Array[Vector2i])
		"dog":
			if not moved:
				return [] as Array[Vector2i]
			if delta.y != 0:
				return _keep([Vector2i(to.x - 1, to.y - delta.y), Vector2i(to.x + 1, to.y - delta.y)] as Array[Vector2i])
			return _keep([Vector2i(to.x - delta.x, to.y - 1), Vector2i(to.x - delta.x, to.y + 1)] as Array[Vector2i])
	return [] as Array[Vector2i]

# --- 命中格（target=玩家选定的攻击格，NONE 表示无）---

static func hit_cells(name: String, from: Vector2i, to: Vector2i, pi: int, target: Vector2i) -> Array[Vector2i]:
	var moved := from != to
	var delta := to - from
	match name:
		"charge", "dodge":
			return [] as Array[Vector2i]
		"tiger":
			var unit := delta if moved else forward(pi)
			return _perpendicular_sweep(target, Vector2i(unit.y, unit.x))
		"ox":
			return _perpendicular_sweep(target, Vector2i(delta.y, delta.x))
		"monkey":
			return _keep([to if target == NONE else target] as Array[Vector2i])
		_:
			# selectCells 类：命中就是选定的那一格
			if target == NONE:
				return [] as Array[Vector2i]
			return _keep([target] as Array[Vector2i])
