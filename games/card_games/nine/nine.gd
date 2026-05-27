extends Node3D
## 九张牌（3D 低多边形卡牌）
## 规则：双方各持红桃/黑桃 A-9，同时出牌，出牌大者得两张之和的分数；A=9 分。
##       9 轮后总分高者胜（A 在九张牌里按 9 分算，与数字 9 并列最大）。
##
## 联机：relay + host 权威。单机：host 打 AI（随机 + 简单策略）。

# 九张牌的点数（面值，用于比较）
static func card_value(card: int) -> int:
	return Cards.NINE_VALUE.get(card, 0)

# --- 游戏状态 ---
var round := 1
var hand_host: Array[int] = []
var hand_guest: Array[int] = []
var score_host := 0
var score_guest := 0
var pending_host := -1     # -1 = 未出
var pending_guest := -1
var game_over := false
var winner := ""           # "host" | "guest" | "draw"
var history: Array[Dictionary] = []

# --- 模式 ---
var mode := "local"
var online_started := false

# --- 3D ---
var table: Node3D
var my_card_nodes: Dictionary = {}   # card_int -> StaticBody3D
var opp_card_nodes: Array[StaticBody3D] = []
var selected_card := -1

# --- UI ---
var status_label: Label
var restart_button: Button
var code_edit: LineEdit
var result_label: Label

func _ready() -> void:
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
	var camera := Camera3D.new()
	camera.position = Vector3(0, 5.8, 3.8)
	camera.look_at_from_position(camera.position, Vector3(0, 0, -0.5), Vector3.UP)
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

func _card_x(index: int, total: int) -> float:
	return (index - (total - 1) * 0.5) * 0.82

func _build_my_hand() -> void:
	for node in my_card_nodes.values():
		node.queue_free()
	my_card_nodes.clear()
	selected_card = -1

	var hand := hand_host if mode != "guest" else hand_guest
	var n := hand.size()
	for i in n:
		var card := hand[i]
		var node := CardMesh.make(card, true, Vector3(_card_x(i, n), 0.01, 2.2))
		node.input_event.connect(_on_my_card_input.bind(card))
		table.add_child(node)
		my_card_nodes[card] = node

func _build_opp_hand() -> void:
	for node in opp_card_nodes:
		node.queue_free()
	opp_card_nodes.clear()

	var n := (hand_guest if mode != "guest" else hand_host).size()
	for i in n:
		var node := CardMesh.make(-1, false, Vector3(_card_x(i, n), 0.01, -2.2))
		table.add_child(node)
		opp_card_nodes.append(node)

# --- 模式切换 ---

func _start_local() -> void:
	Net.close()
	mode = "local"
	online_started = false
	_init_state()
	_full_rebuild()

func _on_create_pressed() -> void:
	mode = "host"
	online_started = false
	_init_state()
	Net.connect_to_server()
	Net.create_room()
	_update_status()

func _on_join_pressed() -> void:
	var code := code_edit.text.strip_edges()
	if code.is_empty():
		status_label.text = "请输入房间号"
		return
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

func _full_rebuild() -> void:
	_build_my_hand()
	_build_opp_hand()
	restart_button.visible = false
	result_label.text = ""
	_update_status()

# --- Net ---

func _on_room_created(_id: String) -> void: _update_status()
func _on_room_joined(_id: String) -> void: _update_status()

func _on_peer_joined() -> void:
	online_started = true
	_init_state()
	_full_rebuild()
	_broadcast_state()

func _on_peer_left() -> void:
	online_started = false
	status_label.text = "对手已离开"

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

func _on_my_card_input(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int, card: int) -> void:
	if not (event is InputEventMouseButton):
		return
	var e := event as InputEventMouseButton
	if not e.pressed or e.button_index != MOUSE_BUTTON_LEFT:
		return
	if game_over:
		return

	if mode == "local" or mode == "host":
		if pending_host >= 0:
			return
		selected_card = card
		for c in my_card_nodes:
			CardMesh.set_selected(my_card_nodes[c], c == card)
		pending_host = card
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
		if pending_guest >= 0:
			return
		selected_card = card
		for c in my_card_nodes:
			CardMesh.set_selected(my_card_nodes[c], c == card)
		pending_guest = card
		Net.send_payload({t = "move", card = card})
		_update_status()

func _ai_choose(hand: Array[int]) -> int:
	# 简单策略：出手牌中最大的
	var best := hand[0]
	for c in hand:
		if card_value(c) > card_value(best):
			best = c
	return best

func _host_receive_guest_move(card: int) -> void:
	if pending_guest >= 0 or game_over or not hand_guest.has(card):
		return
	pending_guest = card
	_broadcast_state()
	if pending_host >= 0:
		_host_resolve(pending_host, pending_guest)

func _host_resolve(host_card: int, guest_card: int) -> void:
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
		round = round,
		host_card = host_card,
		guest_card = guest_card,
		host_gained = host_gained,
		guest_gained = guest_gained,
	})

	game_over = round == 9
	if game_over:
		if score_host > score_guest:
			winner = "host"
		elif score_guest > score_host:
			winner = "guest"
		else:
			winner = "draw"
	else:
		round += 1

	if mode == "host":
		_broadcast_state()
	_full_rebuild()
	_show_result(host_card, guest_card, host_gained, guest_gained)

	if mode == "local" and not game_over:
		pass  # AI is in hand_guest directly

func _show_result(host_card: int, guest_card: int, host_gained: int, guest_gained: int) -> void:
	var my_card := host_card if mode != "guest" else guest_card
	var opp_card := guest_card if mode != "guest" else host_card
	var my_gained := host_gained if mode != "guest" else guest_gained
	result_label.text = "你出：%s（%d分）  对手出：%s  你得 %d 分" % [
		Cards.label(my_card), card_value(my_card), Cards.label(opp_card), my_gained
	]

func _broadcast_state() -> void:
	Net.send_payload({
		t = "state",
		round = round,
		hand_host = hand_host,
		hand_guest = hand_guest,
		score_host = score_host,
		score_guest = score_guest,
		pending_host = pending_host >= 0,
		pending_guest = pending_guest >= 0,
		history = history,
		game_over = game_over,
		winner = winner,
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
	history.assign(payload.get("history", []))
	if bool(payload.get("pending_guest", false)):
		pending_guest = 0
	else:
		pending_guest = -1
	_full_rebuild()
	var hist: Array = payload.get("history", [])
	if hist.size() > 0:
		var last := hist[hist.size() - 1] as Dictionary
		_show_result(int(last.get("host_card", 0)), int(last.get("guest_card", 0)),
			int(last.get("host_gained", 0)), int(last.get("guest_gained", 0)))

# --- UI ---

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	bar.anchor_left = 0.5
	bar.anchor_right = 0.5
	bar.offset_left = -260.0
	bar.offset_right = 260.0
	bar.offset_top = 52.0
	layer.add_child(bar)
	bar.add_child(_btn("单机", _start_local))
	bar.add_child(_btn("创建房间", _on_create_pressed))
	bar.add_child(_btn("加入", _on_join_pressed))
	code_edit = LineEdit.new()
	code_edit.placeholder_text = "房间号"
	code_edit.custom_minimum_size = Vector2(88, 0)
	bar.add_child(code_edit)

	status_label = _make_label(22, Palette.TEXT, 90.0, 124.0)
	layer.add_child(status_label)

	result_label = _make_label(17, Palette.ACCENT, 122.0, 152.0)
	layer.add_child(result_label)

	restart_button = Button.new()
	restart_button.text = "再来一局"
	restart_button.custom_minimum_size = Vector2(160, 44)
	restart_button.anchor_left = 0.5
	restart_button.anchor_right = 0.5
	restart_button.anchor_top = 1.0
	restart_button.anchor_bottom = 1.0
	restart_button.offset_left = -80.0
	restart_button.offset_right = 80.0
	restart_button.offset_top = -80.0
	restart_button.offset_bottom = -36.0
	restart_button.visible = false
	restart_button.pressed.connect(_on_restart_pressed)
	layer.add_child(restart_button)

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
		_init_state()
		if mode == "host":
			_broadcast_state()
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
		var result := ""
		if winner == "draw":
			result = "平局！"
		elif (winner == "host" and mode != "guest") or (winner == "guest" and mode == "guest"):
			result = "你赢了！"
		else:
			result = "你输了！"
		status_label.text = "%s  你 %d : %d 对手" % [result, my_score, opp_score]
		restart_button.visible = true
		return
	var my_pending := (mode != "guest" and pending_host >= 0) or (mode == "guest" and pending_guest >= 0)
	var my_score := score_host if mode != "guest" else score_guest
	var opp_score := score_guest if mode != "guest" else score_host
	status_label.text = "第 %d/9 轮 · 你 %d : %d 对手 · %s" % [
		round, my_score, opp_score, "已出牌，等待…" if my_pending else "请出牌"
	]
