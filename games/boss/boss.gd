extends Node3D
## 招式 Boss 战（3D 低多边形，7×7）。单人挑战 6 个 Boss。
## 玩家选 5 招（3 手 2 弃循环），每回合同时「选招→移动→攻击」对抗 Boss。
## Boss 由固定技能序列驱动（AI），产生大范围 AOE / 持续灾害（雷电轨迹等）。
## 规则与形状计算走 Stance 静态类（StanceRules.gd）。本模式为单机，无联机。

const CELL := 1.0
const NINJA := "res://shared/models/characters/Ninja_Sand.gltf"
const MODEL_SCALE := 0.3
const CENTER := Vector2i(3, 3)

const BOSS_MODEL := {
	"blast": "Skeleton_Mage", "siege": "Skeleton_Minion", "spacetime": "Skeleton_Mage",
	"thunder": "Skeleton_Warrior", "tidal": "Skeleton_Mage", "tornado": "Skeleton_Rogue",
}
const BOSS_ANIM_GLBS := [
	"res://shared/models/bosses/anims/Rig_Medium_General.glb",
	"res://shared/models/bosses/anims/Rig_Medium_MovementBasic.glb",
]

static var _anim_lib: AnimationLibrary = null

static func _boss_anim_library() -> AnimationLibrary:
	if _anim_lib != null:
		return _anim_lib
	_anim_lib = AnimationLibrary.new()
	for path in BOSS_ANIM_GLBS:
		var inst: Node = load(path).instantiate()
		var aps := inst.find_children("*", "AnimationPlayer", true, false)
		if aps.size() > 0:
			var ap: AnimationPlayer = aps[0]
			for clip in ap.get_animation_list():
				if not _anim_lib.has_animation(clip):
					_anim_lib.add_animation(clip, ap.get_animation(clip))
		inst.free()
	if _anim_lib.has_animation("Idle_A"):
		_anim_lib.get_animation("Idle_A").loop_mode = Animation.LOOP_LINEAR
	return _anim_lib

const BOSSES := [
	{"id": "blast",     "name": "轰击", "hp": 5, "player": Vector2i(3, 1), "units": [Vector2i(3, 5)], "skills": ["snipe", "bombard", "burst"]},
	{"id": "siege",     "name": "围攻", "hp": 5, "player": Vector2i(3, 3), "skills": ["crane", "tiger", "dragon"], "units": [
		Vector2i(1,1), Vector2i(1,3), Vector2i(1,5), Vector2i(3,1), Vector2i(3,5), Vector2i(5,1), Vector2i(5,3), Vector2i(5,5),
		Vector2i(0,0), Vector2i(0,2), Vector2i(0,4), Vector2i(0,6), Vector2i(2,6), Vector2i(4,6),
		Vector2i(6,6), Vector2i(6,4), Vector2i(6,2), Vector2i(6,0), Vector2i(4,0), Vector2i(2,0),
	]},
	{"id": "spacetime", "name": "时空", "hp": 5, "player": Vector2i(3, 1), "units": [Vector2i(1, 5), Vector2i(5, 5)], "skills": ["cardinal", "temporal", "boundless"]},
	{"id": "thunder",   "name": "雷霆", "hp": 6, "player": Vector2i(3, 1), "units": [Vector2i(3, 5)], "skills": ["thunder-strike", "thunderstorm", "thunder-cut"]},
	{"id": "tidal",     "name": "潮汐", "hp": 6, "player": Vector2i(3, 1), "units": [Vector2i(3, 3)], "skills": ["destruction", "wave", "wave"]},
	{"id": "tornado",   "name": "龙卷", "hp": 6, "player": Vector2i(3, 1), "units": [Vector2i(3, 5)], "skills": ["whirlwind", "wind-blade", "eye-of-storm"]},
]

const SKILL_LABEL := {
	"snipe": "狙击", "bombard": "轰炸", "burst": "爆发",
	"crane": "鹤击", "tiger": "虎扑", "dragon": "龙环",
	"cardinal": "经线", "temporal": "纬线", "boundless": "无界",
	"thunder-strike": "落雷", "thunderstorm": "雷暴", "thunder-cut": "雷斩",
	"destruction": "震环", "wave": "潮汐",
	"whirlwind": "旋风", "wind-blade": "风刃", "eye-of-storm": "风眼",
}

# --- 状态 ---
var boss_id := ""
var boss_cfg := {}
var phase := "boss_select"
var player_pos := Vector2i(3, 1)
var hp := [2, 5]
var boss_units: Array = []
var hand: Array = []
var discard: Array = []
var pending_double := false
var skill_index := 0
var turn := 1
var winner := -1
var extra := {}

# --- 选招交互 ---
var sel_card := ""
var sel_move := Stance.NONE
var sel_stage := ""

# --- 3D ---
var camera: Camera3D
var board: Node3D
var cell_bodies := {}
var player_node: Node3D
var player_anim: AnimationPlayer
var boss_nodes: Array[Node3D] = []
var boss_anims: Array[AnimationPlayer] = []
var highlight_nodes: Array[Node3D] = []
var hazard_nodes: Array[Node3D] = []
var cam_yaw := -PI / 2.0
var cam_yaw_target := -PI / 2.0
var cam_pitch := 0.50
var cam_dist := 4.0
var _cam_dragging := false

# --- UI ---
var status_label: Label
var skill_label: Label
var hand_bar: HBoxContainer
var deck_panel: PanelContainer
var deck_toggles := {}
var deck_confirm: Button
var boss_panel: PanelContainer
var restart_button: Button
var game_log: GameLog

func _ready() -> void:
	add_child(Stage.make_environment())
	add_child(Stage.make_key_light())
	_build_camera()
	_build_board()
	_build_player()
	_build_ui()
	_show_boss_select()

# --- 坐标 ---

func _cell_world(p: Vector2i) -> Vector3:
	return Vector3((p.y - 3) * CELL, 0.0, (p.x - 3) * CELL)

# --- 场景 ---

func _build_camera() -> void:
	camera = Camera3D.new()
	camera.current = true
	add_child(camera)
	_snap_camera(Vector3(0, 0.6, 0))

func _snap_camera(target: Vector3) -> void:
	var offset := Vector3(sin(cam_yaw) * cos(cam_pitch), sin(cam_pitch), cos(cam_yaw) * cos(cam_pitch)) * cam_dist
	camera.position = target + offset
	if camera.position.distance_to(target) > 0.01:
		camera.look_at(target, Vector3.UP)

func _camera_target() -> Vector3:
	if is_instance_valid(player_node):
		return player_node.position + Vector3(0, 0.6, 0)
	return Vector3(0, 0.6, 0)

func _reset_cam_yaw() -> void:
	cam_yaw = -PI / 2.0
	cam_yaw_target = -PI / 2.0

func _set_cam_from_dir(dir: Vector3) -> void:
	if dir.length() > 0.01:
		cam_yaw_target = atan2(-dir.x, -dir.z)

func _process(delta: float) -> void:
	if Input.is_key_pressed(KEY_Q): cam_yaw_target -= 1.5 * delta
	if Input.is_key_pressed(KEY_E): cam_yaw_target += 1.5 * delta
	var diff := fmod(cam_yaw_target - cam_yaw + PI * 3.0, PI * 2.0) - PI
	cam_yaw += diff * (1.0 - exp(-6.0 * delta))
	var target := _camera_target()
	var offset := Vector3(sin(cam_yaw) * cos(cam_pitch), sin(cam_pitch), cos(cam_yaw) * cos(cam_pitch)) * cam_dist
	camera.position = camera.position.lerp(target + offset, 1.0 - exp(-10.0 * delta))
	if camera.position.distance_to(target) > 0.01:
		camera.look_at(target, Vector3.UP)
	if is_instance_valid(player_node):
		var model := player_node.get_child(0) as Node3D
		if model:
			model.rotation.y = cam_yaw + PI

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var e := event as InputEventMouseButton
		if e.button_index == MOUSE_BUTTON_RIGHT:
			_cam_dragging = e.pressed
	elif event is InputEventMouseMotion and _cam_dragging:
		cam_yaw_target -= (event as InputEventMouseMotion).relative.x * 0.006
		cam_yaw = cam_yaw_target

func _build_board() -> void:
	board = Node3D.new()
	add_child(board)
	var span := Stance.BOARD * CELL
	var base := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(span + 0.6, 0.2, span + 0.6)
	base.mesh = bm
	base.material_override = Palette.flat_material(Color("28323f"))
	base.position = Vector3(0, -0.12, 0)
	board.add_child(base)
	for r in Stance.BOARD:
		for c in Stance.BOARD:
			var p := Vector2i(r, c)
			var body := StaticBody3D.new()
			body.position = _cell_world(p)
			var mi := MeshInstance3D.new()
			var tile := BoxMesh.new()
			tile.size = Vector3(CELL * 0.94, 0.06, CELL * 0.94)
			mi.mesh = tile
			mi.material_override = Palette.flat_material(Color("3a4a5e") if (r + c) % 2 == 0 else Color("33424f"))
			body.add_child(mi)
			var col := CollisionShape3D.new()
			var shape := BoxShape3D.new()
			shape.size = Vector3(CELL * 0.94, 0.06, CELL * 0.94)
			col.shape = shape
			body.add_child(col)
			body.input_event.connect(_on_cell_input.bind(p))
			board.add_child(body)
			cell_bodies[p] = body

func _build_player() -> void:
	player_node = Node3D.new()
	var model: Node3D = load(NINJA).instantiate()
	model.scale = Vector3.ONE * MODEL_SCALE
	model.rotation_degrees.y = -90.0
	model.position.y = 0.04
	player_node.add_child(model)
	player_node.position = _cell_world(player_pos)
	board.add_child(player_node)
	var players := model.find_children("*", "AnimationPlayer", true, false)
	player_anim = players[0] if players.size() > 0 else null
	if player_anim:
		for clip in ["Idle", "Run"]:
			if player_anim.has_animation(clip):
				player_anim.get_animation(clip).loop_mode = Animation.LOOP_LINEAR
		_play("Idle")

func _boss_scale() -> float:
	return 0.34 if boss_id == "siege" else 0.42

func _rebuild_boss_units() -> void:
	for n in boss_nodes:
		if is_instance_valid(n): n.queue_free()
	boss_nodes.clear()
	boss_anims.clear()
	var model_path := "res://shared/models/bosses/%s.glb" % BOSS_MODEL.get(boss_id, "Skeleton_Minion")
	var lib := _boss_anim_library()
	for i in boss_units.size():
		var u: Vector2i = boss_units[i]
		var node := Node3D.new()
		var model: Node3D = load(model_path).instantiate()
		model.scale = Vector3.ONE * _boss_scale()
		model.rotation_degrees.y = 90.0
		node.add_child(model)
		node.position = _cell_world(u)
		board.add_child(node)
		boss_nodes.append(node)
		var ap := AnimationPlayer.new()
		model.add_child(ap)
		ap.add_animation_library("", lib)
		ap.root_node = ap.get_path_to(model)
		boss_anims.append(ap)
		if ap.has_animation("Idle_A"):
			ap.play("Idle_A")

func _boss_play(i: int, clip: String) -> void:
	if i < boss_anims.size() and boss_anims[i].has_animation(clip):
		boss_anims[i].play(clip)

func _boss_play_all(clip: String) -> void:
	for i in boss_anims.size():
		_boss_play(i, clip)

# --- 玩家动画 ---

func _play(clip: String) -> void:
	if player_anim and player_anim.has_animation(clip):
		player_anim.play(clip)

func _play_once(clip: String) -> void:
	if player_anim == null: return
	if not player_anim.has_animation(clip): _play("Idle"); return
	player_anim.play(clip)
	player_anim.animation_finished.connect(func(_a):
		if is_instance_valid(player_anim): player_anim.play("Idle"),
		CONNECT_ONE_SHOT)

# --- 高亮 / AOE ---

func _clear(nodes: Array[Node3D]) -> void:
	for n in nodes:
		if is_instance_valid(n): n.queue_free()
	nodes.clear()

func _overlay(cell: Vector2i, color: Color, alpha := 0.45, y := 0.05) -> Node3D:
	var mi := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(CELL * 0.9, CELL * 0.9)
	mi.mesh = plane
	mi.position = _cell_world(cell) + Vector3(0, y, 0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color.r, color.g, color.b, alpha)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 0.7
	mi.material_override = mat
	board.add_child(mi)
	return mi

func _refresh_highlights() -> void:
	_clear(highlight_nodes)
	if sel_card == "": return
	if sel_stage == "move":
		for cell in Stance.move_options(sel_card, player_pos, 0):
			highlight_nodes.append(_overlay(cell, Color("4ea3f2")))
	elif sel_stage == "attack":
		for cell in Stance.attack_targets(sel_card, player_pos, sel_move, 0):
			highlight_nodes.append(_overlay(cell, Color("f2c14e")))

func _flash_aoe(cells: Array, color: Color) -> void:
	for cell in cells:
		var node := _overlay(cell, color, 0.55, 0.06)
		var mat := (node as MeshInstance3D).material_override as StandardMaterial3D
		var tween := node.create_tween()
		tween.tween_interval(0.25)
		tween.tween_property(mat, "albedo_color:a", 0.0, 0.5)
		tween.parallel().tween_property(mat, "emission_energy_multiplier", 0.0, 0.5)
		tween.tween_callback(node.queue_free)

func _refresh_hazard() -> void:
	_clear(hazard_nodes)
	for cell in extra.get("lightning", []):
		hazard_nodes.append(_overlay(cell, Color("f1c40f"), 0.35, 0.04))

# --- 交互 ---

func _can_act() -> bool:
	return phase == "playing" and winner == -1

func _on_hand_pressed(card: String) -> void:
	if not _can_act(): return
	sel_card = card
	sel_move = Stance.NONE
	if Stance.is_no_move(card):
		sel_move = player_pos
		_enter_attack_or_submit()
	else:
		sel_stage = "move"
	_refresh_highlights()
	_update_status()

func _on_cell_input(_cam: Node, event: InputEvent, _pos: Vector3, _n: Vector3, _s: int, cell: Vector2i) -> void:
	if not (event is InputEventMouseButton): return
	var e := event as InputEventMouseButton
	if not e.pressed or e.button_index != MOUSE_BUTTON_LEFT: return
	if not _can_act() or sel_card == "": return
	if sel_stage == "move":
		if Stance.move_options(sel_card, player_pos, 0).has(cell):
			sel_move = cell
			_enter_attack_or_submit()
			_refresh_highlights()
			_update_status()
	elif sel_stage == "attack":
		if Stance.attack_targets(sel_card, player_pos, sel_move, 0).has(cell):
			_submit(cell)

func _enter_attack_or_submit() -> void:
	if Stance.attack_targets(sel_card, player_pos, sel_move, 0).is_empty():
		_submit(Stance.NONE)
	else:
		sel_stage = "attack"

# --- 回合结算 ---

func _submit(attack: Vector2i) -> void:
	var card := sel_card
	var player_from := player_pos
	var player_to := sel_move
	sel_card = ""; sel_move = Stance.NONE; sel_stage = ""
	_clear(highlight_nodes)

	var player_hit := Stance.hit_cells(card, player_from, player_to, 0, attack)
	var skill: String = _skill_now()
	var out := _boss_resolve(skill, player_from)
	var boss_targets: Array = [CENTER] if boss_id == "tidal" else out.units

	var i_hit := false
	for cell in player_hit:
		if (boss_targets as Array).has(cell): i_hit = true; break
	var dmg := 2 if pending_double else 1
	pending_double = false

	var damage_cells: Array[Vector2i] = []
	damage_cells.append_array(out.aoe)
	damage_cells.append_array(out.hazard)
	var boss_hits := not Stance.is_dodge(card) and damage_cells.has(player_to)

	if i_hit: hp[1] -= dmg
	if boss_hits: hp[0] -= 1
	boss_units = out.units
	player_pos = player_to
	extra = out.extra
	if Stance.is_charge(card): pending_double = true

	hand.erase(card)
	discard.append(card)
	hand.append(discard.pop_front())
	skill_index += 1

	var done_turn := turn
	var over: bool = hp[0] <= 0 or hp[1] <= 0
	if over:
		winner = 2 if (hp[0] <= 0 and hp[1] <= 0) else (1 if hp[0] <= 0 else 0)
		phase = "ended"
	else:
		turn += 1

	_apply_resolution(card, player_from, player_to, attack, out, i_hit, dmg, boss_hits, done_turn)

func _apply_resolution(card: String, player_from: Vector2i, player_to: Vector2i, attack: Vector2i, out: Dictionary, i_hit: bool, dmg: int, boss_hits: bool, done_turn: int) -> void:
	var move_dir := _cell_world(player_to) - _cell_world(player_from)
	if move_dir.length() > 0.01:
		_set_cam_from_dir(move_dir)
	if player_from != player_to:
		_play("Run")
		var tween := player_node.create_tween()
		tween.tween_property(player_node, "position", _cell_world(player_to), 0.3) \
			.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tween.tween_callback(func(): _player_action(card, boss_hits, attack, player_from, player_to))
	else:
		player_node.position = _cell_world(player_to)
		_player_action(card, boss_hits, attack, player_from, player_to)

	_rebuild_boss_units()
	_boss_play_all("Throw")
	if i_hit: _boss_play(0, "Hit_A")
	_flash_aoe(out.aoe, Color("e8623c"))
	_refresh_hazard()
	_refresh_hand()

	Stage.shake(camera, 0.06 if (i_hit or boss_hits) else 0.02, 0.24)
	if i_hit:
		Stage.float_text(board, "-%d" % dmg, _cell_world(boss_units[0]) + Vector3(0, 1.4, 0), Palette.WIN)
		Stage.hit_burst(board, _cell_world(boss_units[0]) + Vector3(0, 0.7, 0), Color("f2c14e"))
	if boss_hits:
		Stage.float_text(board, "-1", _cell_world(player_to) + Vector3(0, 1.4, 0), Palette.LOSE)
		Stage.hit_burst(board, _cell_world(player_to) + Vector3(0, 0.7, 0), Color("e8623c"))

	_log_turn(card, done_turn, i_hit, boss_hits)
	_update_status()

	if winner != -1:
		Stage.shake(camera, 0.1, 0.35)
		var text := "击败 Boss！" if winner == 0 else ("同归于尽" if winner == 2 else "你输了")
		var color := Palette.WIN if winner == 0 else (Palette.ACCENT if winner == 2 else Palette.LOSE)
		Stage.float_text(board, text, Vector3(0, 2.2, 0), color)
		restart_button.visible = true
		if winner == 0: _boss_play_all("Death_A")
		var w := winner
		get_tree().create_timer(0.5).timeout.connect(func():
			_play("Victory" if w == 0 else "Death"), CONNECT_ONE_SHOT)

func _player_action(card: String, was_hit: bool, attack: Vector2i, player_from: Vector2i, player_to: Vector2i) -> void:
	if attack != Stance.NONE:
		_set_cam_from_dir(_cell_world(attack) - player_node.position)
	var hits := Stance.hit_cells(card, player_from, player_to, 0, attack)
	_flash_aoe(hits, Color("f97316"))
	if Stance.is_dodge(card): _play_once("Roll")
	elif Stance.is_charge(card): _play_once("Jump")
	else: _play_once("SwordSlash")
	if was_hit:
		get_tree().create_timer(0.22).timeout.connect(func(): _play_once("RecieveHit"), CONNECT_ONE_SHOT)

func _skill_now() -> String:
	var skills: Array = boss_cfg.skills
	return skills[skill_index % skills.size()]

func _skill_now_prev() -> String:
	var skills: Array = boss_cfg.skills
	return skills[(skill_index - 1) % skills.size()]

func _log_turn(card: String, done_turn: int, i_hit: bool, boss_hits: bool) -> void:
	var line := "第%d回合 你[%s] vs Boss[%s]" % [done_turn, Stance.LABEL[card], SKILL_LABEL.get(_skill_now_prev(), "")]
	if i_hit: line += " · 命中 Boss！"
	if boss_hits: line += " · 被击中！"
	game_log.add(line)
	if winner != -1:
		game_log.add("—— %s ——" % ("击败 Boss！" if winner == 0 else ("同归于尽" if winner == 2 else "你输了")))

# --- Boss 技能解算 ---

func _nearest(cands: Array, target: Vector2i) -> Vector2i:
	var best: Vector2i = cands[0]
	for c in cands:
		if Stance.manhattan(c, target) < Stance.manhattan(best, target): best = c
	return best

func _cardinal_opts(pos: Vector2i, dist: int) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for d in Stance.CARDINALS:
		var c := pos + d * dist
		if Stance.in_bounds(c): out.append(c)
	return out

func _hunt(cands: Array, target: Vector2i, aoe_at: Callable) -> Vector2i:
	for to in cands:
		if (aoe_at.call(to) as Array).has(target): return to
	return _nearest(cands, target)

func _boss_resolve(skill: String, player_from: Vector2i) -> Dictionary:
	match boss_id:
		"blast":     return _blast(skill, player_from)
		"siege":     return _siege(skill, player_from)
		"spacetime": return _spacetime(skill, player_from)
		"thunder":   return _thunder(skill, player_from)
		"tidal":     return _tidal(skill)
		"tornado":   return _tornado(skill, player_from)
	return {"units": boss_units, "aoe": [] as Array[Vector2i], "hazard": [] as Array[Vector2i], "extra": extra}

func _blast(skill: String, player_from: Vector2i) -> Dictionary:
	var from: Vector2i = boss_units[0]
	match skill:
		"snipe":
			var use_row: bool = from.x == player_from.x or (from.y != player_from.y and randf() < 0.5)
			var aoe := Stance.full_row(from.x) if use_row else Stance.full_col(from.y)
			return {"units": [from], "aoe": aoe, "hazard": [] as Array[Vector2i], "extra": {}}
		"bombard":
			var opts: Array = _cardinal_opts(from, 1)
			if opts.is_empty(): opts = [from]
			var aoe_at := func(to): return _bombard_aoe(from, to)
			var to: Vector2i = _hunt(opts, player_from, aoe_at)
			return {"units": [to], "aoe": aoe_at.call(to), "hazard": [] as Array[Vector2i], "extra": {}}
		_:
			return {"units": [from], "aoe": Stance.filled_square(from, 1), "hazard": [] as Array[Vector2i], "extra": {}}

func _bombard_aoe(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	var center := to + (to - from)
	var cells: Array[Vector2i] = []
	for c in Stance.filled_square(center, 1):
		if c != to: cells.append(c)
	return cells

func _siege(skill: String, player_from: Vector2i) -> Dictionary:
	var new_units: Array[Vector2i] = []
	var aoe: Array[Vector2i] = []
	for unit in boss_units:
		var u: Vector2i = unit
		var opts := Stance.move_options(skill, u, 1)
		var to: Vector2i = u if opts.is_empty() else opts.pick_random()
		new_units.append(to)
		var targets := Stance.attack_targets(skill, u, to, 1)
		var target: Vector2i = Stance.NONE if targets.is_empty() else targets.pick_random()
		aoe.append_array(Stance.hit_cells(skill, u, to, 1, target))
	return {"units": new_units, "aoe": Stance.dedupe(aoe), "hazard": [] as Array[Vector2i], "extra": {}}

func _spacetime(skill: String, player_from: Vector2i) -> Dictionary:
	var from1: Vector2i = boss_units[0]
	var from2: Vector2i = boss_units[1]
	if skill == "boundless":
		return {"units": [from1, from2], "aoe": Stance.rectangle_border(from1, from2), "hazard": [] as Array[Vector2i], "extra": {}}
	var opts1: Array = _cardinal_opts(from1, 1)
	var opts2: Array = _cardinal_opts(from2, 1)
	if opts1.is_empty(): opts1 = [from1]
	if opts2.is_empty(): opts2 = [from2]
	var best_m1 := from1
	var best_m2 := from2
	var best_score := INF
	for m1 in opts1:
		for m2 in opts2:
			var score := float(Stance.manhattan(m1, player_from) + Stance.manhattan(m2, player_from))
			if m1.x == m2.x: score += 4.0
			if m1.y == m2.y: score += 4.0
			score += randf() * 3.0
			if score < best_score:
				best_score = score; best_m1 = m1; best_m2 = m2
	var aoe: Array[Vector2i] = []
	if skill == "cardinal":
		aoe.append_array(Stance.full_col(best_m1.y))
		aoe.append_array(Stance.full_col(best_m2.y))
	else:
		aoe.append_array(Stance.full_row(best_m1.x))
		aoe.append_array(Stance.full_row(best_m2.x))
	return {"units": [best_m1, best_m2], "aoe": Stance.dedupe(aoe), "hazard": [] as Array[Vector2i], "extra": {}}

func _thunder(skill: String, player_from: Vector2i) -> Dictionary:
	var from: Vector2i = boss_units[0]
	var light: Array = extra.get("lightning", [])
	match skill:
		"thunder-strike":
			var cands: Array = _cardinal_opts(from, 1)
			if cands.is_empty(): cands = [from]
			var to: Vector2i = _nearest(cands, player_from)
			var trail: Array[Vector2i] = []
			trail.append_array(light)
			if not trail.has(player_from): trail.append(player_from)
			return {"units": [to], "aoe": [player_from] as Array[Vector2i], "hazard": trail, "extra": {"lightning": trail}}
		"thunderstorm":
			var cands: Array = _cardinal_opts(from, 1)
			if cands.is_empty(): cands = [from]
			var to: Vector2i = _nearest(cands, player_from)
			return {"units": [to], "aoe": Stance.checkerboard((to.x + to.y) % 2), "hazard": light, "extra": extra}
		_:
			var opts: Array = _cardinal_opts(from, 3)
			if opts.is_empty(): opts = [from]
			var aoe_at := func(to): return Stance.line_segment(from, Stance.dominant_unit(to - from), 4)
			var to: Vector2i = _hunt(opts, player_from, aoe_at)
			return {"units": [to], "aoe": aoe_at.call(to), "hazard": light, "extra": extra}

func _tidal(skill: String) -> Dictionary:
	var stage: int = extra.get("stage", 0)
	var waves: Array = (extra.get("waves", []) as Array).duplicate()
	var ring: Array[Vector2i] = []
	if skill == "destruction":
		ring = Stance.square_ring(CENTER, 1); stage = 1
	else:
		var edges := ["top", "bottom", "left", "right"]
		edges.shuffle()
		waves.append(_init_wave(edges[0]))
		waves.append(_init_wave(edges[1]))
		if stage == 1: ring = Stance.square_ring(CENTER, 2); stage = 2
		elif stage == 2: ring = Stance.square_ring(CENTER, 3); stage = 0
	var aoe: Array[Vector2i] = []
	aoe.append_array(ring)
	for w in waves: aoe.append_array(_wave_cells(w))
	var remaining: Array = []
	for w in waves:
		var nw := _advance_wave(w)
		if not nw.is_empty(): remaining.append(nw)
	return {"units": [CENTER], "aoe": Stance.dedupe(aoe), "hazard": [] as Array[Vector2i], "extra": {"stage": stage, "waves": remaining}}

func _init_wave(edge: String) -> Dictionary:
	return {"edge": edge, "pos": 6 if (edge == "bottom" or edge == "right") else 0}

func _wave_cells(w: Dictionary) -> Array[Vector2i]:
	if w.edge == "top" or w.edge == "bottom": return Stance.full_row(w.pos)
	return Stance.full_col(w.pos)

func _advance_wave(w: Dictionary) -> Dictionary:
	var nxt: int = w.pos + 1 if (w.edge == "top" or w.edge == "left") else w.pos - 1
	if nxt < 0 or nxt >= Stance.BOARD: return {}
	return {"edge": w.edge, "pos": nxt}

func _tornado(skill: String, player_from: Vector2i) -> Dictionary:
	var from: Vector2i = boss_units[0]
	var pending: Vector2i = extra.get("pending", Stance.NONE)
	match skill:
		"whirlwind":
			var opts: Array = _cardinal_opts(from, 1)
			if opts.is_empty(): opts = [from]
			var aoe_at := func(to): return Stance.square_ring(to, 1)
			var to: Vector2i = _hunt(opts, player_from, aoe_at)
			return {"units": [to], "aoe": Stance.square_ring(to, 1), "hazard": [] as Array[Vector2i], "extra": {"pending": to}}
		"wind-blade":
			var aoe: Array[Vector2i] = []
			aoe.append_array(Stance.diagonal_cross(from))
			if pending != Stance.NONE: aoe.append_array(Stance.square_ring(pending, 2))
			return {"units": [from], "aoe": Stance.dedupe(aoe), "hazard": [] as Array[Vector2i], "extra": extra}
		_:
			var aoe: Array[Vector2i] = Stance.square_ring(pending, 3) if pending != Stance.NONE else []
			return {"units": [from], "aoe": aoe, "hazard": [] as Array[Vector2i], "extra": {"pending": Stance.NONE}}

# --- 流程 ---

func _show_boss_select() -> void:
	phase = "boss_select"
	boss_panel.visible = true
	deck_panel.visible = false
	restart_button.visible = false
	hand_bar.visible = false
	skill_label.text = ""
	status_label.text = "选择要挑战的 Boss"

func _on_boss_pick(cfg: Dictionary) -> void:
	boss_id = cfg.id
	boss_cfg = cfg
	boss_panel.visible = false
	_init_boss()
	_open_deck_selection()

func _init_boss() -> void:
	_reset_cam_yaw()
	phase = "deck_selection"
	player_pos = boss_cfg.player
	hp = [2, int(boss_cfg.hp)]
	boss_units = (boss_cfg.units as Array).duplicate()
	hand = []; discard = []
	pending_double = false
	skill_index = 0; turn = 1; winner = -1
	extra = _init_extra()
	sel_card = ""; sel_stage = ""
	hand_bar.visible = false
	game_log.clear()
	player_node.position = _cell_world(player_pos)
	_play("Idle")
	_rebuild_boss_units()
	_clear(hazard_nodes)
	_clear(highlight_nodes)

func _init_extra() -> Dictionary:
	match boss_id:
		"thunder": return {"lightning": []}
		"tidal":   return {"stage": 0, "waves": []}
		"tornado": return {"pending": Stance.NONE}
	return {}

func _open_deck_selection() -> void:
	for s in deck_toggles: deck_toggles[s].button_pressed = false
	deck_panel.visible = true
	_update_deck_confirm()
	status_label.text = "选择 5 个招式挑战「%s」" % boss_cfg.name

func _on_deck_confirm() -> void:
	var chosen: Array[String] = []
	for s in Stance.ALL:
		if deck_toggles[s].button_pressed: chosen.append(s)
	if chosen.size() != 5: return
	deck_panel.visible = false
	chosen.shuffle()
	hand = chosen.slice(0, 3)
	discard = chosen.slice(3, 5)
	phase = "playing"
	hand_bar.visible = true
	_refresh_hand()
	_update_status()

func _refresh_hand() -> void:
	for c in hand_bar.get_children(): c.queue_free()
	if phase != "playing": return
	for card in hand:
		var b := Button.new()
		b.text = Stance.LABEL[card]
		b.custom_minimum_size = Vector2(56, 48)
		b.add_theme_font_size_override("font_size", 22)
		b.pressed.connect(_on_hand_pressed.bind(card))
		hand_bar.add_child(b)

# --- UI ---

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	status_label = Label.new()
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label.add_theme_font_size_override("font_size", 18)
	status_label.add_theme_color_override("font_color", Palette.TEXT)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.anchor_right = 1.0; status_label.offset_top = 12.0; status_label.offset_bottom = 40.0
	layer.add_child(status_label)

	skill_label = Label.new()
	skill_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	skill_label.add_theme_font_size_override("font_size", 16)
	skill_label.add_theme_color_override("font_color", Palette.ACCENT)
	skill_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	skill_label.anchor_right = 1.0; skill_label.offset_top = 40.0; skill_label.offset_bottom = 64.0
	layer.add_child(skill_label)

	hand_bar = HBoxContainer.new()
	hand_bar.add_theme_constant_override("separation", 10)
	hand_bar.alignment = BoxContainer.ALIGNMENT_CENTER
	hand_bar.anchor_right = 1.0; hand_bar.anchor_top = 1.0; hand_bar.anchor_bottom = 1.0
	hand_bar.offset_top = -70.0; hand_bar.offset_bottom = -14.0
	layer.add_child(hand_bar)

	game_log = GameLog.new()
	game_log.anchor_bottom = 1.0; game_log.offset_bottom = -90.0; game_log.offset_top = -240.0
	game_log.offset_left = 10.0; game_log.offset_right = 280.0
	layer.add_child(game_log)

	restart_button = Button.new()
	restart_button.text = "再战"
	restart_button.custom_minimum_size = Vector2(120, 40)
	restart_button.anchor_left = 0.5; restart_button.anchor_right = 0.5
	restart_button.anchor_top = 1.0; restart_button.anchor_bottom = 1.0
	restart_button.offset_left = -130.0; restart_button.offset_right = -10.0
	restart_button.offset_top = -130.0; restart_button.offset_bottom = -90.0
	restart_button.visible = false
	restart_button.pressed.connect(_on_restart_pressed)
	layer.add_child(restart_button)

	var change_btn := Button.new()
	change_btn.text = "换 Boss"
	change_btn.custom_minimum_size = Vector2(120, 40)
	change_btn.anchor_left = 0.5; change_btn.anchor_right = 0.5
	change_btn.anchor_top = 1.0; change_btn.anchor_bottom = 1.0
	change_btn.offset_left = 10.0; change_btn.offset_right = 130.0
	change_btn.offset_top = -130.0; change_btn.offset_bottom = -90.0
	change_btn.pressed.connect(_show_boss_select)
	layer.add_child(change_btn)

	_build_deck_panel(layer)
	_build_boss_panel(layer)

func _build_boss_panel(layer: CanvasLayer) -> void:
	boss_panel = PanelContainer.new()
	boss_panel.anchor_left = 0.5; boss_panel.anchor_right = 0.5
	boss_panel.anchor_top = 0.5; boss_panel.anchor_bottom = 0.5
	boss_panel.offset_left = -180.0; boss_panel.offset_right = 180.0
	boss_panel.offset_top = -150.0; boss_panel.offset_bottom = 150.0
	layer.add_child(boss_panel)
	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	boss_panel.add_child(vbox)
	var title := Label.new()
	title.text = "选择 Boss"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 20)
	vbox.add_child(title)
	for cfg in BOSSES:
		var b := Button.new()
		b.text = "%s（HP %d）" % [cfg.name, cfg.hp]
		b.custom_minimum_size = Vector2(0, 42)
		b.add_theme_font_size_override("font_size", 18)
		b.pressed.connect(_on_boss_pick.bind(cfg))
		vbox.add_child(b)

func _build_deck_panel(layer: CanvasLayer) -> void:
	deck_panel = PanelContainer.new()
	deck_panel.anchor_left = 0.5; deck_panel.anchor_right = 0.5
	deck_panel.anchor_top = 0.5; deck_panel.anchor_bottom = 0.5
	deck_panel.offset_left = -200.0; deck_panel.offset_right = 200.0
	deck_panel.offset_top = -160.0; deck_panel.offset_bottom = 170.0
	layer.add_child(deck_panel)
	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	deck_panel.add_child(vbox)
	var title := Label.new()
	title.text = "选择 5 个招式"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 20)
	vbox.add_child(title)
	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	vbox.add_child(grid)
	for s in Stance.ALL:
		var b := Button.new()
		b.toggle_mode = true
		b.text = Stance.LABEL[s]
		b.custom_minimum_size = Vector2(64, 56)
		b.add_theme_font_size_override("font_size", 24)
		b.toggled.connect(func(_p): _update_deck_confirm())
		grid.add_child(b)
		deck_toggles[s] = b
	deck_confirm = Button.new()
	deck_confirm.text = "确认"
	deck_confirm.custom_minimum_size = Vector2(0, 44)
	deck_confirm.disabled = true
	deck_confirm.pressed.connect(_on_deck_confirm)
	vbox.add_child(deck_confirm)
	deck_panel.visible = false

func _update_deck_confirm() -> void:
	var count := 0
	for s in deck_toggles:
		if deck_toggles[s].button_pressed: count += 1
	for s in deck_toggles:
		var b: Button = deck_toggles[s]
		b.disabled = count >= 5 and not b.button_pressed
	deck_confirm.disabled = count != 5
	deck_confirm.text = "确认" if count == 5 else "确认（%d/5）" % count

func _on_restart_pressed() -> void:
	_init_boss()
	_open_deck_selection()

func _update_status() -> void:
	if phase != "playing": return
	var hp_text := "你 %d ♥ · Boss %d ♥" % [hp[0], hp[1]]
	if winner != -1:
		var result := "击败 Boss！" if winner == 0 else ("同归于尽" if winner == 2 else "你输了")
		status_label.text = "%s  %s" % [result, hp_text]
		skill_label.text = ""; return
	status_label.text = "第%d回合 · %s" % [turn, hp_text]
	skill_label.text = "Boss 招式：%s" % SKILL_LABEL.get(_skill_now(), _skill_now())
