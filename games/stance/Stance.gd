extends Node3D
## 招式对战（3D 低多边形，7×7 棋盘）
## 双方各从 13 招中选 5 张（3 手牌 + 2 弃牌循环）。每回合同时「选招→移动→攻击」，
## 同时结算：撞同格则双方退回；闪避免伤；蓄力下次翻倍；毒圈随回合收缩。HP 2，先归零者负。
##
## 联机：relay + host 权威（host=player0，guest=player1）。单机：host 打 AI。
## 规则计算全部走 Stance 静态类（StanceRules.gd），本脚本只管状态机、交互、表现与联机。

const CELL := 1.0
const P_COLOR := [Color("e8623c"), Color("3cb0e8")]
const NINJA := ["res://shared/models/characters/Ninja_Sand.gltf", "res://shared/models/characters/Ninja_Male.gltf"]
const MODEL_SCALE := 0.3
const HP_MAX := 2

# --- 状态（host/local 权威）---
var phase := "deck_selection"
var positions: Array[Vector2i] = [Vector2i(3, 1), Vector2i(3, 5)]
var hp := [HP_MAX, HP_MAX]
var hands: Array = [[], []]
var discards: Array = [[], []]
var pending: Array = [{}, {}]
var pending_double := [false, false]
var deck_selected := [false, false]
var poison_turns := [0, 0]
var turn := 1
var winner := -1

# --- 模式 ---
var mode := "local"
var online_started := false

func _my_pi() -> int:
	return 1 if mode == "guest" else 0

# --- 选招交互子状态 ---
var sel_card := ""
var sel_move := Stance.NONE
var sel_stage := ""
var waiting := false

# --- 3D ---
var camera: Camera3D
var board: Node3D
var cell_bodies := {}
var unit_nodes: Array[Node3D] = []
var unit_anim: Array[AnimationPlayer] = []
var highlight_nodes: Array[Node3D] = []
var poison_nodes: Array[Node3D] = []
var anim_attack_nodes: Array[Node3D] = []
var cam_yaw := -PI / 2.0
var cam_yaw_target := -PI / 2.0
var cam_pitch := 0.50
var cam_dist := 4.0
var _cam_dragging := false

# --- UI ---
var status_label: Label
var hand_bar: HBoxContainer
var deck_panel: PanelContainer
var deck_toggles := {}
var deck_confirm: Button
var restart_button: Button
var game_log: GameLog
var room_panel: RoomListPanel

func _ready() -> void:
	add_child(Stage.make_environment())
	add_child(Stage.make_key_light())
	_build_camera()
	_build_board()
	_build_units()
	_build_ui()
	Net.room_created.connect(func(_id): _update_status())
	Net.room_joined.connect(func(_id): _update_status())
	Net.peer_joined.connect(_on_peer_joined)
	Net.peer_left.connect(_on_peer_left)
	Net.message.connect(_on_net_message)
	Net.net_error.connect(func(t): status_label.text = t)
	_start_local()

func _exit_tree() -> void:
	Net.close()

# --- 坐标 ---

func _cell_world(p: Vector2i) -> Vector3:
	return Vector3((p.y - 3) * CELL, 0.0, (p.x - 3) * CELL)

# --- 场景搭建 ---

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
	var pi := _my_pi()
	return (unit_nodes[pi].position if unit_nodes.size() > pi else Vector3.ZERO) + Vector3(0, 0.6, 0)

func _reset_cam_yaw() -> void:
	var initial := -PI / 2.0 if _my_pi() == 0 else PI / 2.0
	cam_yaw = initial
	cam_yaw_target = initial

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
	var pi := _my_pi()
	if unit_nodes.size() > pi:
		var model := unit_nodes[pi].get_child(0) as Node3D
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

func _build_units() -> void:
	unit_nodes.clear()
	unit_anim.clear()
	for i in 2:
		var unit := Node3D.new()
		var model: Node3D = load(NINJA[i]).instantiate()
		model.scale = Vector3.ONE * MODEL_SCALE
		model.rotation_degrees.y = -90.0 if i == 0 else 90.0
		model.position.y = 0.04
		unit.add_child(model)
		unit.position = _cell_world(positions[i])
		board.add_child(unit)
		unit_nodes.append(unit)

		var players := model.find_children("*", "AnimationPlayer", true, false)
		var ap: AnimationPlayer = players[0] if players.size() > 0 else null
		unit_anim.append(ap)
		if ap:
			for clip in ["Idle", "Run", "Walk"]:
				if ap.has_animation(clip):
					ap.get_animation(clip).loop_mode = Animation.LOOP_LINEAR
			_play(i, "Idle")

# --- 角色动画 ---

func _play(i: int, clip: String) -> void:
	var ap := unit_anim[i]
	if ap and ap.has_animation(clip):
		ap.play(clip)

func _play_once(i: int, clip: String) -> void:
	var ap := unit_anim[i]
	if ap == null:
		return
	if not ap.has_animation(clip):
		_play(i, "Idle")
		return
	ap.play(clip)
	ap.animation_finished.connect(func(_a):
		if is_instance_valid(ap): ap.play("Idle"),
		CONNECT_ONE_SHOT)

# --- 高亮 ---

func _clear(nodes: Array[Node3D]) -> void:
	for n in nodes:
		if is_instance_valid(n): n.queue_free()
	nodes.clear()

func _overlay(cell: Vector2i, color: Color, y := 0.05) -> Node3D:
	var mi := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(CELL * 0.9, CELL * 0.9)
	mi.mesh = plane
	mi.position = _cell_world(cell) + Vector3(0, y, 0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color.r, color.g, color.b, 0.45)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 0.6
	mi.material_override = mat
	board.add_child(mi)
	return mi

func _refresh_highlights() -> void:
	_clear(highlight_nodes)
	if sel_card == "" or waiting:
		return
	var pi := _my_pi()
	if sel_stage == "move":
		for cell in Stance.move_options(sel_card, positions[pi], pi):
			highlight_nodes.append(_overlay(cell, Color("4ea3f2")))
	elif sel_stage == "attack":
		var targets := Stance.attack_targets(sel_card, positions[pi], sel_move, pi)
		# 命中格（黄色 AOE 预览），对虎/牛展示横扫区域
		var aoe: Array[Vector2i] = []
		for t in targets:
			for h in Stance.hit_cells(sel_card, positions[pi], sel_move, pi, t):
				if not aoe.has(h): aoe.append(h)
		for cell in aoe:
			highlight_nodes.append(_overlay(cell, Color("fde68a"), 0.04))
		# 可点击攻击目标（红色，覆盖在上层）
		for cell in targets:
			highlight_nodes.append(_overlay(cell, Color("fca5a5")))

func _flash_anim_attacks(cells: Array[Vector2i]) -> void:
	for cell in cells:
		anim_attack_nodes.append(_overlay(cell, Color("f97316")))
	get_tree().create_timer(0.65).timeout.connect(func():
		_clear(anim_attack_nodes), CONNECT_ONE_SHOT)

func _refresh_poison() -> void:
	_clear(poison_nodes)
	var rings := turn / 5
	if rings <= 0:
		return
	for r in Stance.BOARD:
		for c in Stance.BOARD:
			if mini(mini(r, 6 - r), mini(c, 6 - c)) < rings:
				poison_nodes.append(_overlay(Vector2i(r, c), Color("9b5de5")))

# --- 交互 ---

func _can_act() -> bool:
	return phase == "playing" and winner == -1 and not waiting and pending[_my_pi()].is_empty()

func _on_hand_pressed(card: String) -> void:
	if not _can_act(): return
	sel_card = card
	sel_move = Stance.NONE
	if Stance.is_no_move(card):
		sel_move = positions[_my_pi()]
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
	var pi := _my_pi()
	if sel_stage == "move":
		if Stance.move_options(sel_card, positions[pi], pi).has(cell):
			sel_move = cell
			_enter_attack_or_submit()
			_refresh_highlights()
			_update_status()
	elif sel_stage == "attack":
		if Stance.attack_targets(sel_card, positions[pi], sel_move, pi).has(cell):
			_submit(cell)

func _enter_attack_or_submit() -> void:
	var pi := _my_pi()
	var targets := Stance.attack_targets(sel_card, positions[pi], sel_move, pi)
	if targets.is_empty():
		_submit(Stance.NONE)
	else:
		sel_stage = "attack"

func _submit(attack: Vector2i) -> void:
	var action := {"card": sel_card, "move": sel_move, "attack": attack}
	sel_card = ""
	sel_move = Stance.NONE
	sel_stage = ""
	_clear(highlight_nodes)

	if mode == "guest":
		Net.send_payload({t = "move", card = action.card, move = _pack(action.move), attack = _pack(action.attack)})
		waiting = true
		_update_status()
		return

	pending[0] = action
	if mode == "local":
		pending[1] = _ai_move(1)
		_resolve()
	else:
		_broadcast_state()
		if not pending[1].is_empty():
			_resolve()
		else:
			waiting = true
			_update_status()

# --- 选牌阶段 ---

func _start_local() -> void:
	Net.close()
	mode = "local"
	online_started = false
	game_log.clear()
	_init_match()
	_open_deck_selection()

func _on_create_pressed() -> void:
	mode = "host"
	online_started = false
	game_log.clear()
	_init_match()
	Net.connect_to_server()
	Net.create_room()
	_update_status()

func _join_room(code: String) -> void:
	mode = "guest"
	online_started = false
	Net.connect_to_server()
	Net.join_room(code)
	_update_status()

func _init_match() -> void:
	phase = "deck_selection"
	positions = [Vector2i(3, 1), Vector2i(3, 5)]
	hp = [HP_MAX, HP_MAX]
	hands = [[], []]
	discards = [[], []]
	pending = [{}, {}]
	pending_double = [false, false]
	deck_selected = [false, false]
	poison_turns = [0, 0]
	turn = 1
	winner = -1
	waiting = false
	sel_card = ""
	sel_stage = ""
	_refresh_units()
	_refresh_poison()
	_refresh_hand()
	_update_hp_status()

func _open_deck_selection() -> void:
	for s in deck_toggles:
		deck_toggles[s].button_pressed = false
	deck_panel.visible = true
	_update_deck_confirm()
	_update_status()

func _on_deck_confirm() -> void:
	var chosen: Array[String] = []
	for s in Stance.ALL:
		if deck_toggles[s].button_pressed:
			chosen.append(s)
	if chosen.size() != 5: return
	deck_panel.visible = false

	if mode == "guest":
		Net.send_payload({t = "deck", stances = chosen})
		status_label.text = "已选招，等待对手…"
		return

	_set_deck(0, chosen)
	if mode == "local":
		_set_deck(1, _ai_deck())
		_begin_playing()
	else:
		if deck_selected[1]:
			_begin_playing()
		else:
			_broadcast_state()
			status_label.text = "已选招，等待对手…"

func _set_deck(pi: int, stances: Array) -> void:
	var shuffled := stances.duplicate()
	shuffled.shuffle()
	hands[pi] = shuffled.slice(0, 3)
	discards[pi] = shuffled.slice(3, 5)
	deck_selected[pi] = true

func _begin_playing() -> void:
	_reset_cam_yaw()
	phase = "playing"
	_refresh_units()
	_refresh_hand()
	_refresh_poison()
	_update_hp_status()
	if mode == "host":
		_broadcast_state()

# --- 结算 ---

func _resolve() -> void:
	var a0: Dictionary = pending[0]
	var a1: Dictionary = pending[1]
	pending = [{}, {}]
	waiting = false

	var prev0: Vector2i = positions[0]
	var prev1: Vector2i = positions[1]
	var np0: Vector2i = a0.move
	var np1: Vector2i = a1.move

	var dodge0 := Stance.is_dodge(a0.card)
	var dodge1 := Stance.is_dodge(a1.card)
	var dmg0 := 2 if pending_double[0] else 1
	var dmg1 := 2 if pending_double[1] else 1
	pending_double = [false, false]

	var hit01 := not dodge1 and Stance.hit_cells(a0.card, prev0, np0, 0, a0.attack).has(np1)
	var hit10 := not dodge0 and Stance.hit_cells(a1.card, prev1, np1, 1, a1.attack).has(np0)

	if hit01: hp[1] -= dmg0
	if hit10: hp[0] -= dmg1
	positions = [np0, np1]
	if Stance.is_charge(a0.card): pending_double[0] = true
	if Stance.is_charge(a1.card): pending_double[1] = true

	for i in 2:
		var played: String = a0.card if i == 0 else a1.card
		hands[i].erase(played)
		discards[i].append(played)
		hands[i].append(discards[i].pop_front())

	var rings := turn / 5
	var poison := [0, 0]
	if rings > 0:
		for i in 2:
			var pos: Vector2i = positions[i]
			var in_poison := mini(mini(pos.x, 6 - pos.x), mini(pos.y, 6 - pos.y)) < rings
			if in_poison:
				poison_turns[i] += 1
				if poison_turns[i] >= 2:
					hp[i] -= 1
					poison[i] = 1
			else:
				poison_turns[i] = 0

	var done_turn := turn
	var over: bool = hp[0] <= 0 or hp[1] <= 0
	if over:
		winner = 2 if (hp[0] <= 0 and hp[1] <= 0) else (1 if hp[0] <= 0 else 0)
		phase = "ended"
	else:
		turn += 1

	var last := {
		"turn": done_turn, "c0": a0.card, "c1": a1.card,
		"hit01": hit01, "hit10": hit10, "dmg0": dmg0, "dmg1": dmg1,
		"poison0": poison[0], "poison1": poison[1],
		"atk0": _pack(a0.attack), "atk1": _pack(a1.attack),
		"prev0": _pack(prev0), "prev1": _pack(prev1),
	}
	if mode == "host":
		_broadcast_state(last)
	_apply_resolution(last)

# --- 表现 ---

func _apply_resolution(last: Dictionary) -> void:
	_animate_turn(last)
	_refresh_poison()
	_refresh_hand()
	_update_hp_status()
	_log_turn(last)

	Stage.shake(camera, 0.05 if (last.hit01 or last.hit10) else 0.02, 0.22)
	if last.hit01:
		Stage.float_text(board, "-%d" % int(last.dmg0), _cell_world(positions[1]) + Vector3(0, 1.4, 0), Palette.WIN)
		Stage.hit_burst(board, _cell_world(positions[1]) + Vector3(0, 0.7, 0), Color("f2c14e"))
	if last.hit10:
		Stage.float_text(board, "-%d" % int(last.dmg1), _cell_world(positions[0]) + Vector3(0, 1.4, 0), Palette.LOSE)
		Stage.hit_burst(board, _cell_world(positions[0]) + Vector3(0, 0.7, 0), Color("f2c14e"))
	for i in 2:
		if int(last["poison%d" % i]) > 0:
			Stage.float_text(board, "毒", _cell_world(positions[i]) + Vector3(0, 1.6, 0), Color("9b5de5"))

	if winner != -1:
		Stage.shake(camera, 0.1, 0.35)
		var me := _my_pi()
		var text := "平局" if winner == 2 else ("胜！" if winner == me else "负")
		var color := Palette.ACCENT if winner == 2 else (Palette.WIN if winner == me else Palette.LOSE)
		Stage.float_text(board, text, Vector3(0, 2.0, 0), color)
		restart_button.visible = true
		var w := winner
		get_tree().create_timer(0.5).timeout.connect(func(): _play_endgame(w), CONNECT_ONE_SHOT)

func _play_endgame(w: int) -> void:
	for i in 2:
		if w == 2: _play(i, "Defeat")
		elif i == w: _play(i, "Victory")
		else: _play(i, "Death")

func _animate_turn(last: Dictionary) -> void:
	var pi := _my_pi()
	var my_from := unit_nodes[pi].position
	var my_to := _cell_world(positions[pi])
	var move_dir := my_to - my_from
	if move_dir.length() > 0.01:
		_set_cam_from_dir(move_dir)
	for i in 2:
		var node := unit_nodes[i]
		var target := _cell_world(positions[i])
		if node.position.distance_to(target) > 0.01:
			_play(i, "Run")
			var tween := node.create_tween()
			tween.tween_property(node, "position", target, 0.32) \
				.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
			tween.tween_callback(_play_action.bind(i, last))
		else:
			_play_action(i, last)

func _play_action(i: int, last: Dictionary) -> void:
	var card: String = last["c%d" % i]
	var prev := _unpack(last.get("prev%d" % i, []))
	var atk := _unpack(last.get("atk%d" % i, []))
	if i == _my_pi() and atk != Stance.NONE:
		_set_cam_from_dir(_cell_world(atk) - unit_nodes[i].position)
	if prev != Stance.NONE:
		_flash_anim_attacks(Stance.hit_cells(card, prev, positions[i], i, atk))
	var was_hit: bool = (last.hit01 and i == 1) or (last.hit10 and i == 0)
	if Stance.is_dodge(card): _play_once(i, "Roll")
	elif Stance.is_charge(card): _play_once(i, "Jump")
	else: _play_once(i, "SwordSlash")
	if was_hit:
		get_tree().create_timer(0.22).timeout.connect(_play_once.bind(i, "RecieveHit"), CONNECT_ONE_SHOT)

func _refresh_units() -> void:
	for i in 2:
		unit_nodes[i].position = _cell_world(positions[i])

func _refresh_hand() -> void:
	for c in hand_bar.get_children():
		c.queue_free()
	if phase != "playing":
		return
	var pi := _my_pi()
	for card in hands[pi]:
		var b := Button.new()
		b.text = Stance.LABEL[card]
		b.custom_minimum_size = Vector2(56, 48)
		b.add_theme_font_size_override("font_size", 22)
		b.pressed.connect(_on_hand_pressed.bind(card))
		hand_bar.add_child(b)

func _log_turn(last: Dictionary) -> void:
	var me := _my_pi()
	var my_card: String = last["c%d" % me]
	var opp_card: String = last["c%d" % (1 - me)]
	var i_hit: bool = last.hit01 if me == 0 else last.hit10
	var hit_me: bool = last.hit10 if me == 0 else last.hit01
	var line := "第%d回合 你[%s] 对手[%s]" % [int(last.turn), Stance.LABEL[my_card], Stance.LABEL[opp_card]]
	if i_hit: line += " · 命中对手！"
	if hit_me: line += " · 被命中！"
	game_log.add(line)
	if winner != -1:
		game_log.add("—— %s ——" % ("平局" if winner == 2 else ("你赢了！" if winner == me else "你输了！")))

# --- AI ---

func _ai_deck() -> Array:
	var all := Stance.ALL.duplicate()
	all.shuffle()
	return all.slice(0, 5)

func _ai_move(pi: int) -> Dictionary:
	var my: Vector2i = positions[pi]
	var opp: Vector2i = positions[1 - pi]
	var hand: Array = hands[pi].duplicate()
	hand.shuffle()
	for card in hand:
		if Stance.is_charge(card):
			return {"card": card, "move": my, "attack": Stance.NONE}
		var opts: Array[Vector2i] = ([my] as Array[Vector2i]) if Stance.is_no_move(card) else Stance.move_options(card, my, pi)
		opts.shuffle()
		for mv in opts:
			if Stance.is_dodge(card):
				return {"card": card, "move": mv, "attack": Stance.NONE}
			var atk := Stance.attack_targets(card, my, mv, pi)
			if atk.is_empty():
				if mv == opp: return {"card": card, "move": mv, "attack": Stance.NONE}
				continue
			for cell in atk:
				if cell == opp: return {"card": card, "move": mv, "attack": cell}
	var card: String = hands[pi].pick_random()
	if Stance.is_charge(card): return {"card": card, "move": my, "attack": Stance.NONE}
	var opts: Array[Vector2i] = ([my] as Array[Vector2i]) if Stance.is_no_move(card) else Stance.move_options(card, my, pi)
	var mv: Vector2i = my if opts.is_empty() else opts.pick_random()
	if Stance.is_dodge(card): return {"card": card, "move": mv, "attack": Stance.NONE}
	var atk := Stance.attack_targets(card, my, mv, pi)
	return {"card": card, "move": mv, "attack": Stance.NONE if atk.is_empty() else atk.pick_random()}

# --- 联机 ---

func _on_peer_joined() -> void:
	online_started = true
	if is_instance_valid(room_panel): room_panel.visible = false
	game_log.clear()
	_init_match()
	_open_deck_selection()

func _on_peer_left() -> void:
	online_started = false
	status_label.text = "对手已离开"
	if is_instance_valid(room_panel):
		room_panel.visible = true
		room_panel.refresh()

func _on_net_message(payload: Dictionary) -> void:
	match payload.get("t", ""):
		"deck":
			if mode == "host" and not deck_selected[1]:
				_set_deck(1, payload.get("stances", []))
				if deck_selected[0]: _begin_playing()
				else: _broadcast_state()
		"move":
			if mode == "host" and pending[1].is_empty():
				pending[1] = {"card": payload.get("card", ""), "move": _unpack(payload.get("move", [])), "attack": _unpack(payload.get("attack", []))}
				if not pending[0].is_empty(): _resolve()
				else: _broadcast_state()
		"state":
			if mode == "guest": _apply_state(payload)
		"restart":
			if mode == "host" and online_started:
				_init_match()
				_open_deck_selection()

func _broadcast_state(last: Variant = null) -> void:
	Net.send_payload({
		t = "state", phase = phase, turn = turn, winner = winner,
		positions = [_pack(positions[0]), _pack(positions[1])],
		hp = hp, hands = hands, discards = discards,
		pending = [not pending[0].is_empty(), not pending[1].is_empty()],
		last = last,
	})

func _apply_state(payload: Dictionary) -> void:
	online_started = true
	var prev_phase := phase
	phase = payload.get("phase", phase)
	turn = int(payload.get("turn", turn))
	winner = int(payload.get("winner", -1))
	var pos: Array = payload.get("positions", [])
	if pos.size() == 2:
		positions = [_unpack(pos[0]), _unpack(pos[1])]
	hp = payload.get("hp", hp)
	hands = payload.get("hands", hands)
	discards = payload.get("discards", discards)
	var pend: Array = payload.get("pending", [false, false])
	waiting = pend.size() == 2 and pend[1]
	if prev_phase == "deck_selection" and phase == "playing":
		game_log.clear()
	var last: Variant = payload.get("last")
	if last != null:
		_apply_resolution(last)
	else:
		_refresh_units()
		_refresh_poison()
		_refresh_hand()
		_update_hp_status()

func _pack(p: Vector2i) -> Array:
	return [p.x, p.y]

func _unpack(a: Variant) -> Vector2i:
	if typeof(a) == TYPE_ARRAY and (a as Array).size() == 2:
		return Vector2i(int(a[0]), int(a[1]))
	return Stance.NONE

# --- UI ---

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	bar.anchor_left = 0.5; bar.anchor_right = 0.5
	bar.offset_left = -180.0; bar.offset_right = 180.0; bar.offset_top = 8.0
	layer.add_child(bar)
	bar.add_child(_btn("单机", _start_local))
	bar.add_child(_btn("创建房间", _on_create_pressed))

	status_label = Label.new()
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label.add_theme_font_size_override("font_size", 18)
	status_label.add_theme_color_override("font_color", Palette.TEXT)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.anchor_right = 1.0; status_label.offset_top = 46.0; status_label.offset_bottom = 74.0
	layer.add_child(status_label)

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
	restart_button.text = "再来一局"
	restart_button.custom_minimum_size = Vector2(160, 44)
	restart_button.anchor_left = 0.5; restart_button.anchor_right = 0.5
	restart_button.anchor_top = 1.0; restart_button.anchor_bottom = 1.0
	restart_button.offset_left = -80.0; restart_button.offset_right = 80.0
	restart_button.offset_top = -130.0; restart_button.offset_bottom = -86.0
	restart_button.visible = false
	restart_button.pressed.connect(_on_restart_pressed)
	layer.add_child(restart_button)

	room_panel = RoomListPanel.new()
	room_panel.anchor_right = 1.0; room_panel.offset_right = -10.0; room_panel.offset_left = -260.0
	room_panel.offset_top = 8.0
	room_panel.join_requested.connect(_join_room)
	layer.add_child(room_panel)

	_build_deck_panel(layer)

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

func _btn(text: String, handler: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(handler)
	return b

func _on_restart_pressed() -> void:
	if mode == "guest": Net.send_payload({t = "restart"})
	else:
		game_log.clear()
		_init_match()
		_open_deck_selection()

func _update_hp_status() -> void:
	restart_button.visible = winner != -1
	_update_status()

func _update_status() -> void:
	if mode == "host" and not online_started:
		status_label.text = "房间号：%s（等待对手加入）" % Net.room_id; return
	if mode == "guest" and not online_started:
		status_label.text = "已加入，等待开始"; return
	if phase == "deck_selection":
		status_label.text = "选择 5 个招式组成你的牌组"; return
	var me := _my_pi()
	var hp_text := "你 %d : %d 对手" % [hp[me], hp[1 - me]]
	if winner != -1:
		var result := "平局" if winner == 2 else ("你赢了！" if winner == me else "你输了！")
		status_label.text = "%s  %s" % [result, hp_text]; return
	var rings := turn / 5
	var poison_hint := "（毒圈 %d 层）" % rings if rings > 0 else ""
	if waiting: status_label.text = "第%d回合 · %s · 已出招，等待对手…%s" % [turn, hp_text, poison_hint]
	elif sel_stage == "move": status_label.text = "第%d回合 · 选择移动格" % turn
	elif sel_stage == "attack": status_label.text = "第%d回合 · 选择攻击格" % turn
	else: status_label.text = "第%d回合 · %s · 选招出牌%s" % [turn, hp_text, poison_hint]
