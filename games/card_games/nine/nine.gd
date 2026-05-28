extends Node3D
## 九张牌（3D 低多边形卡牌）
## 规则：双方各持红桃/黑桃 A-9，同时出牌，出牌大者得两张之和的分数；A=9 分。
##       9 轮后总分高者胜。

static func card_value(card: int) -> int:
	return Cards.NINE_VALUE.get(card, 0)

# --- 游戏状态 ---
var round := 1
var hand_host: Array[int] = []
var hand_guest: Array[int] = []
var score_host := 0
var score_guest := 0
var pending_host := -1
var pending_guest := -1
var game_over := false
var winner := ""
var history: Array[Dictionary] = []

# --- 模式 ---
var mode := "local"
var online_started := false

# --- 3D ---
var camera: Camera3D
var table: Node3D
var my_hand_nodes: Array[StaticBody3D] = []
var my_hand_cards: Array[int] = []
var opp_hand_nodes: Array[StaticBody3D] = []
var my_play_nodes: Array[StaticBody3D] = []
var opp_play_nodes: Array[StaticBody3D] = []
var slot_frame_nodes: Array[Node3D] = []

# --- UI ---
var status_label: Label
var restart_button: Button
var game_log: GameLog
var room_panel: RoomListPanel

func _ready() -> void:
	add_child(Stage.make_environment())
	add_child(Stage.make_key_light())
	_build_camera()
	_build_table()
	_build_ui()
	Net.room_created.connect(_on_room_created)
	Net.room_joined.connect(_on_room_joined)
	Net.peer_joined.connect(_on_peer_joined)
	Net.peer_left.connect(_on_peer_left)
	Net.message.connect(_on_net_message)
	Net.net_error.connect(_on_net_error)
	_start_local()

func _exit_tree() -> void:
	Net.close()

# --- 场景 ---

func _build_camera() -> void:
	camera = Camera3D.new()
	camera.position = Vector3(0, 8.0, 3.5)
	camera.look_at_from_position(camera.position, Vector3(0, 0, 0.5), Vector3.UP)
	camera.current = true
	add_child(camera)

func _build_table() -> void:
	table = Node3D.new()
	add_child(table)
	var base := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(9.0, 0.15, 7.5)
	base.mesh = mesh
	base.material_override = Palette.flat_material(Color("2d5a27"))
	base.position = Vector3(0, -0.08, 0)
	table.add_child(base)
	_zone_bg(Color("1a3d18"), Vector3(0, 0.002,  3.0), Vector3(9.0, 0.004, 1.4))
	_zone_bg(Color("1a3d18"), Vector3(0, 0.002, -3.0), Vector3(9.0, 0.004, 1.4))

func _zone_bg(color: Color, pos: Vector3, size: Vector3) -> void:
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mi.mesh = mesh
	mi.position = pos
	mi.material_override = Palette.flat_material(color)
	table.add_child(mi)

func _slot_x(index: int) -> float:
	return (index - 4.0) * 0.88

func _card_x(index: int, total: int) -> float:
	return (index - (total - 1) * 0.5) * (CardMesh.CARD_W + 0.15)

# --- 手牌与卡槽 ---

func _build_my_hand() -> void:
	for n in my_hand_nodes:
		if is_instance_valid(n): n.queue_free()
	my_hand_nodes.clear()
	my_hand_cards.clear()

	var hand := hand_host if mode != "guest" else hand_guest
	var total := hand.size()
	for i in total:
		var card := hand[i]
		var node := CardMesh.make(card, true, Vector3(_card_x(i, total), 0.01, 3.0), i * 0.04)
		node.input_event.connect(_on_my_card_input.bind(i))
		table.add_child(node)
		my_hand_nodes.append(node)
		my_hand_cards.append(card)

func _build_opp_hand() -> void:
	for n in opp_hand_nodes:
		if is_instance_valid(n): n.queue_free()
	opp_hand_nodes.clear()

	var opp := hand_guest if mode != "guest" else hand_host
	var total := opp.size()
	for i in total:
		var node := CardMesh.make(-1, false, Vector3(_card_x(i, total), 0.01, -3.0), i * 0.04)
		table.add_child(node)
		opp_hand_nodes.append(node)

func _rebuild_slot_frames() -> void:
	for n in slot_frame_nodes:
		if is_instance_valid(n): n.queue_free()
	slot_frame_nodes.clear()

	for i in 9:
		var x := _slot_x(i)
		var active := (i == round - 1) and not game_over
		var color := Color(0.88, 0.72, 0.18) if active else Color(0.30, 0.32, 0.36)
		var f1 := CardSlot.make(Vector3(x, 0, 1.0), color)
		var f2 := CardSlot.make(Vector3(x, 0, -1.0), color)
		table.add_child(f1)
		table.add_child(f2)
		slot_frame_nodes.append(f1)
		slot_frame_nodes.append(f2)

		var lbl := Label3D.new()
		lbl.text = str(i + 1)
		lbl.font_size = 14
		lbl.position = Vector3(x, 0.005, 0)
		lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lbl.modulate = Color(0.55, 0.55, 0.55)
		table.add_child(lbl)

func _rebuild_played() -> void:
	for n in my_play_nodes:
		if is_instance_valid(n): n.queue_free()
	my_play_nodes.clear()
	for n in opp_play_nodes:
		if is_instance_valid(n): n.queue_free()
	opp_play_nodes.clear()

	for i in history.size():
		var data := history[i]
		var host_card := int(data.get("host_card", 0))
		var guest_card := int(data.get("guest_card", 0))
		var x := _slot_x(i)

		var my_card := host_card if mode != "guest" else guest_card
		var opp_card := guest_card if mode != "guest" else host_card
		var mn := CardMesh.make(my_card, true, Vector3(x, 0.01, 1.0))
		var on_ := CardMesh.make(opp_card, true, Vector3(x, 0.01, -1.0))
		table.add_child(mn)
		table.add_child(on_)
		my_play_nodes.append(mn)
		opp_play_nodes.append(on_)

	# 当前回合已出但未结算
	if not game_over:
		var x := _slot_x(round - 1)
		if pending_host >= 0 and mode != "guest":
			var mn := CardMesh.make(pending_host, true, Vector3(x, 0.01, 1.0))
			table.add_child(mn)
			my_play_nodes.append(mn)
		elif pending_guest >= 0 and mode == "guest":
			var mn := CardMesh.make(pending_guest, true, Vector3(x, 0.01, 1.0))
			table.add_child(mn)
			my_play_nodes.append(mn)

func _full_rebuild() -> void:
	_rebuild_slot_frames()
	_rebuild_played()
	_build_my_hand()
	_build_opp_hand()
	restart_button.visible = false
	_update_status()

# --- 模式切换 ---

func _start_local() -> void:
	Net.close()
	mode = "local"
	online_started = false
	game_log.clear()
	_init_state()
	_full_rebuild()

func _on_create_pressed() -> void:
	mode = "host"
	online_started = false
	game_log.clear()
	_init_state()
	Net.connect_to_server()
	Net.create_room()
	_update_status()

func _join_room(code: String) -> void:
	mode = "guest"
	online_started = false
	Net.connect_to_server()
	Net.join_room(code)
	_update_status()

func _init_state() -> void:
	hand_host.assign(Cards.NINE_HEARTS)
	hand_guest.assign(Cards.NINE_SPADES)
	score_host = 0
	score_guest = 0
	pending_host = -1
	pending_guest = -1
	game_over = false
	winner = ""
	history.clear()
	round = 1

# --- Net ---

func _on_room_created(_id: String) -> void: _update_status()
func _on_room_joined(_id: String) -> void: _update_status()

func _on_peer_joined() -> void:
	online_started = true
	if is_instance_valid(room_panel): room_panel.visible = false
	game_log.clear()
	_init_state()
	_full_rebuild()
	_broadcast_state()

func _on_peer_left() -> void:
	online_started = false
	status_label.text = "对手已离开"
	if is_instance_valid(room_panel):
		room_panel.visible = true
		room_panel.refresh()

func _on_net_error(text: String) -> void:
	status_label.text = text

func _on_net_message(payload: Dictionary) -> void:
	match payload.get("t", ""):
		"move":
			if mode == "host" and online_started:
				_host_receive_guest_move(int(payload.get("card", -1)))
		"state":
			if mode == "guest":
				_guest_apply_state(payload)
		"restart":
			if mode == "host" and online_started:
				_on_peer_joined()

# --- 输入 ---

func _on_my_card_input(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int, card_index: int) -> void:
	if not (event is InputEventMouseButton): return
	var e := event as InputEventMouseButton
	if not e.pressed or e.button_index != MOUSE_BUTTON_LEFT: return
	if game_over: return
	if card_index >= my_hand_cards.size(): return

	var card := my_hand_cards[card_index]

	if mode == "local" or mode == "host":
		if pending_host >= 0: return
		pending_host = card
		for i in my_hand_nodes.size():
			CardMesh.set_selected(my_hand_nodes[i], i == card_index)
		_full_rebuild()
		_update_status()
		if mode == "local":
			await get_tree().create_timer(0.25).timeout
			var ai_card := _ai_choose(hand_guest)
			_host_resolve(pending_host, ai_card)
		elif mode == "host":
			_broadcast_state()
			if pending_guest >= 0:
				_host_resolve(pending_host, pending_guest)
	elif mode == "guest":
		if pending_guest >= 0: return
		pending_guest = card
		for i in my_hand_nodes.size():
			CardMesh.set_selected(my_hand_nodes[i], i == card_index)
		Net.send_payload({t = "move", card = card})
		_full_rebuild()
		_update_status()

func _ai_choose(hand: Array[int]) -> int:
	var best := hand[0]
	for c in hand:
		if card_value(c) > card_value(best): best = c
	return best

func _host_receive_guest_move(card: int) -> void:
	if pending_guest >= 0 or game_over or not hand_guest.has(card): return
	pending_guest = card
	_broadcast_state()
	if pending_host >= 0:
		_host_resolve(pending_host, pending_guest)

func _host_resolve(host_card: int, guest_card: int) -> void:
	var slot_x := _slot_x(round - 1)
	hand_host.erase(host_card)
	hand_guest.erase(guest_card)
	pending_host = -1
	pending_guest = -1

	var hv := card_value(host_card)
	var gv := card_value(guest_card)
	var sum := hv + gv
	var host_gained := sum if hv > gv else 0
	var guest_gained := sum if gv > hv else 0
	score_host += host_gained
	score_guest += guest_gained

	history.append({
		round = round, host_card = host_card, guest_card = guest_card,
		host_gained = host_gained, guest_gained = guest_gained,
	})

	game_over = round == 9
	if game_over:
		winner = "host" if score_host > score_guest else ("guest" if score_guest > score_host else "draw")
	else:
		round += 1

	if mode == "host": _broadcast_state()
	_full_rebuild()
	_resolve_feedback(slot_x, host_gained, guest_gained)
	_log_result(host_card, guest_card, host_gained, guest_gained)

func _resolve_feedback(slot_x: float, host_gained: int, guest_gained: int) -> void:
	var my_gained := host_gained if mode != "guest" else guest_gained
	var opp_gained := guest_gained if mode != "guest" else host_gained
	Stage.shake(camera, 0.03 + 0.002 * (my_gained + opp_gained), 0.22)
	if my_gained > 0:
		Stage.float_text(table, "+%d" % my_gained, Vector3(slot_x, 0.3, 1.0), Palette.WIN)
	elif opp_gained > 0:
		Stage.float_text(table, "+%d" % opp_gained, Vector3(slot_x, 0.3, -1.0), Palette.LOSE)
	if game_over and winner != "draw":
		var i_win := (winner == "host" and mode != "guest") or (winner == "guest" and mode == "guest")
		if mode == "local": i_win = winner == "host"
		Stage.shake(camera, 0.09, 0.35)
		Stage.float_text(table, "胜！" if i_win else "负", Vector3(0, 0.6, 0),
			Palette.WIN if i_win else Palette.LOSE)

func _log_result(host_card: int, guest_card: int, host_gained: int, guest_gained: int) -> void:
	var my_card := host_card if mode != "guest" else guest_card
	var opp_card := guest_card if mode != "guest" else host_card
	var my_gained := host_gained if mode != "guest" else guest_gained
	var opp_gained := guest_gained if mode != "guest" else host_gained
	var r := history.size()
	game_log.add("第%d轮 你出%s(%d) 对手出%s(%d) → 你得%d 对手得%d" % [
		r, Cards.label(my_card), card_value(my_card),
		Cards.label(opp_card), card_value(opp_card),
		my_gained, opp_gained
	])
	if game_over:
		if winner == "draw":
			game_log.add("—— 平局！你 %d : %d 对手 ——" % [score_host if mode != "guest" else score_guest,
				score_guest if mode != "guest" else score_host])
		else:
			var i_win := (winner == "host" and mode != "guest") or (winner == "guest" and mode == "guest")
			game_log.add("—— %s（你 %d : %d 对手）——" % [
				"你赢了！" if i_win else "你输了！",
				score_host if mode != "guest" else score_guest,
				score_guest if mode != "guest" else score_host
			])

func _broadcast_state() -> void:
	Net.send_payload({
		t = "state", round = round,
		hand_host = hand_host, hand_guest = hand_guest,
		score_host = score_host, score_guest = score_guest,
		pending_host = pending_host >= 0, pending_guest = pending_guest >= 0,
		history = history, game_over = game_over, winner = winner,
	})

func _guest_apply_state(payload: Dictionary) -> void:
	online_started = true
	round = int(payload.get("round", 1))
	hand_host.assign(payload.get("hand_host", []))
	hand_guest.assign(payload.get("hand_guest", []))
	score_host = int(payload.get("score_host", 0))
	score_guest = int(payload.get("score_guest", 0))
	game_over = bool(payload.get("game_over", false))
	winner = str(payload.get("winner", ""))
	var new_history: Array = payload.get("history", [])
	pending_guest = 0 if bool(payload.get("pending_guest", false)) else -1
	var prev_len := history.size()
	history.assign(new_history)
	_full_rebuild()
	for i in range(prev_len, history.size()):
		var d := history[i] as Dictionary
		_log_result(int(d.get("host_card", 0)), int(d.get("guest_card", 0)),
			int(d.get("host_gained", 0)), int(d.get("guest_gained", 0)))

# --- UI ---

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	bar.anchor_left = 0.5
	bar.anchor_right = 0.5
	bar.offset_left = -180.0
	bar.offset_right = 180.0
	bar.offset_top = 8.0
	layer.add_child(bar)
	bar.add_child(_btn("单机", _start_local))
	bar.add_child(_btn("创建房间", _on_create_pressed))

	status_label = _make_label(18, Palette.TEXT, 46.0, 72.0)
	layer.add_child(status_label)

	game_log = GameLog.new()
	game_log.anchor_bottom = 1.0
	game_log.offset_bottom = -10.0
	game_log.offset_top = -150.0
	game_log.offset_left = 10.0
	game_log.offset_right = 280.0
	layer.add_child(game_log)

	restart_button = Button.new()
	restart_button.text = "再来一局"
	restart_button.custom_minimum_size = Vector2(160, 44)
	restart_button.anchor_left = 0.5
	restart_button.anchor_right = 0.5
	restart_button.anchor_top = 1.0
	restart_button.anchor_bottom = 1.0
	restart_button.offset_left = -80.0
	restart_button.offset_right = 80.0
	restart_button.offset_top = -60.0
	restart_button.offset_bottom = -16.0
	restart_button.visible = false
	restart_button.pressed.connect(_on_restart_pressed)
	layer.add_child(restart_button)

	room_panel = RoomListPanel.new()
	room_panel.anchor_right = 1.0
	room_panel.offset_right = -10.0
	room_panel.offset_left = -260.0
	room_panel.offset_top = 8.0
	room_panel.join_requested.connect(_join_room)
	layer.add_child(room_panel)

func _make_label(font_size: int, color: Color, top: float, bottom: float) -> Label:
	var label := Label.new()
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.anchor_left = 0.0
	label.anchor_right = 1.0
	label.offset_top = top
	label.offset_bottom = bottom
	return label

func _btn(text: String, handler: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(handler)
	return b

func _on_restart_pressed() -> void:
	if mode == "guest":
		Net.send_payload({t = "restart"})
	else:
		game_log.clear()
		_init_state()
		if mode == "host": _broadcast_state()
		_full_rebuild()

func _update_status() -> void:
	if mode == "host" and not online_started:
		status_label.text = "房间号：%s（等待对手加入）" % Net.room_id
		return
	if mode == "guest" and not online_started:
		status_label.text = "已加入，等待开始"
		return
	if game_over:
		var my_score := score_host if mode != "guest" else score_guest
		var opp_score := score_guest if mode != "guest" else score_host
		status_label.text = "你 %d : %d 对手" % [my_score, opp_score]
		restart_button.visible = true
		return
	var my_pending := (mode != "guest" and pending_host >= 0) or (mode == "guest" and pending_guest >= 0)
	var my_score := score_host if mode != "guest" else score_guest
	var opp_score := score_guest if mode != "guest" else score_host
	status_label.text = "第%d/9轮 · 你%d : 对手%d · %s" % [
		round, my_score, opp_score, "已出牌，等待…" if my_pending else "请出牌"
	]
