extends Node3D
## 国王与奴隶（3D 低多边形卡牌）
## 规则：双方同时出牌，奴隶用奴隶牌打败国王则奴隶方胜；
##       国王方用国王或平民压过奴隶方，或5局内奴隶方未赢则国王方胜。
##
## 联机：relay + host 权威（host 执国王方，guest 执奴隶方）。
## 单机：host 打 AI（AI 随机出牌）。

const CARD_KING := "king"
const CARD_COMMONER := "commoner"
const CARD_SLAVE := "slave"

static func _resolve(k_card: String, s_card: String) -> String:
	if s_card == CARD_SLAVE and k_card == CARD_KING:
		return "slave_wins"
	if k_card == CARD_COMMONER and s_card == CARD_SLAVE:
		return "king_wins"
	if k_card == CARD_KING and s_card == CARD_COMMONER:
		return "king_wins"
	return "continues"

# --- 游戏状态 ---
var round := 1
var hand_host: Dictionary = {}
var hand_guest: Dictionary = {}
var pending_host := ""
var pending_guest := ""
var game_over := false
var winner := ""
var history: Array[Dictionary] = []

# --- 模式 ---
var mode := "local"
var my_role := "king_side"
var online_started := false
var ai_hand: Dictionary = {}

# --- 3D ---
var camera: Camera3D
var table: Node3D
var my_hand_nodes: Array[StaticBody3D] = []
var my_hand_types: Array[String] = []
var opp_hand_nodes: Array[StaticBody3D] = []
var my_play_nodes: Array[StaticBody3D] = []
var opp_play_nodes: Array[StaticBody3D] = []
var slot_frame_nodes: Array[Node3D] = []
var selected_card := ""

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

# --- 场景搭建 ---

func _build_camera() -> void:
	camera = Camera3D.new()
	camera.position = Vector3(0, 8.0, 4.0)
	camera.look_at_from_position(camera.position, Vector3(0, 0, 0.5), Vector3.UP)
	camera.current = true
	add_child(camera)

func _build_table() -> void:
	table = Node3D.new()
	add_child(table)

	var base := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(6.0, 0.15, 8.0)
	base.mesh = mesh
	base.material_override = Palette.flat_material(Color("2d5a27"))
	base.position = Vector3(0, -0.08, 0)
	table.add_child(base)

	# 手牌区背景（我方）
	_zone_bg(Color("1a3d18"), Vector3(0, 0.002, 3.0), Vector3(6.0, 0.004, 1.6))
	# 手牌区背景（对手）
	_zone_bg(Color("1a3d18"), Vector3(0, 0.002, -3.0), Vector3(6.0, 0.004, 1.6))

func _zone_bg(color: Color, pos: Vector3, size: Vector3) -> void:
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mi.mesh = mesh
	mi.position = pos
	mi.material_override = Palette.flat_material(color)
	table.add_child(mi)

func _slot_x(index: int) -> float:
	return (index - 2.0) * 1.0

func _hand_x(index: int, total: int) -> float:
	return (index - (total - 1) * 0.5) * (CardMesh.CARD_W + 0.22)

func _card_texture(card_type: String, role: String) -> int:
	if role == "king_side":
		return Cards.HEARTS_K if card_type == CARD_KING else Cards.HEARTS_10
	return Cards.SPADES_2 if card_type == CARD_SLAVE else Cards.SPADES_10

# --- 手牌与卡槽重建 ---

func _get_my_hand_types() -> Array[String]:
	var types: Array[String] = []
	var hand := hand_host if my_role == "king_side" else hand_guest
	if my_role == "king_side":
		for _i in hand.get(CARD_KING, 0): types.append(CARD_KING)
		for _i in hand.get(CARD_COMMONER, 0): types.append(CARD_COMMONER)
	else:
		for _i in hand.get(CARD_SLAVE, 0): types.append(CARD_SLAVE)
		for _i in hand.get(CARD_COMMONER, 0): types.append(CARD_COMMONER)
	return types

func _build_my_hand() -> void:
	for n in my_hand_nodes:
		if is_instance_valid(n): n.queue_free()
	my_hand_nodes.clear()
	my_hand_types.clear()
	selected_card = ""

	var types := _get_my_hand_types()
	var total := types.size()
	for i in total:
		var card_type := types[i]
		var node := CardMesh.make(_card_texture(card_type, my_role), true,
				Vector3(_hand_x(i, total), 0.01, 3.0), i * 0.06)
		node.input_event.connect(_on_my_card_input.bind(i))
		table.add_child(node)
		my_hand_nodes.append(node)
		my_hand_types.append(card_type)

func _build_opp_hand() -> void:
	for n in opp_hand_nodes:
		if is_instance_valid(n): n.queue_free()
	opp_hand_nodes.clear()

	var opp_hand := hand_guest if my_role == "king_side" else hand_host
	var n := int(opp_hand.get(CARD_KING, 0)) + int(opp_hand.get(CARD_COMMONER, 0)) + int(opp_hand.get(CARD_SLAVE, 0))
	n = clampi(n, 0, 5)
	for i in n:
		var node := CardMesh.make(-1, false, Vector3(_hand_x(i, n), 0.01, -3.0), i * 0.06)
		table.add_child(node)
		opp_hand_nodes.append(node)

func _rebuild_slot_frames() -> void:
	for n in slot_frame_nodes:
		if is_instance_valid(n): n.queue_free()
	slot_frame_nodes.clear()

	for i in 5:
		var x := _slot_x(i)
		var active := (i == round - 1) and not game_over
		var color := Color(0.88, 0.72, 0.18) if active else Color(0.30, 0.32, 0.36)
		slot_frame_nodes.append(CardSlot.make(Vector3(x, 0, 1.0), color))
		slot_frame_nodes.append(CardSlot.make(Vector3(x, 0, -1.0), color))
		for sn in [slot_frame_nodes[-2], slot_frame_nodes[-1]]:
			table.add_child(sn)

		var lbl := Label3D.new()
		lbl.text = str(i + 1)
		lbl.font_size = 16
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
		var host_card := str(data.get("host_card", ""))
		var guest_card := str(data.get("guest_card", ""))
		var x := _slot_x(i)

		var my_card := host_card if my_role == "king_side" else guest_card
		var opp_card := guest_card if my_role == "king_side" else host_card
		var opp_role := "slave_side" if my_role == "king_side" else "king_side"

		var mn := CardMesh.make(_card_texture(my_card, my_role), true, Vector3(x, 0.01, 1.0))
		var on_ := CardMesh.make(_card_texture(opp_card, opp_role), true, Vector3(x, 0.01, -1.0))
		table.add_child(mn)
		table.add_child(on_)
		my_play_nodes.append(mn)
		opp_play_nodes.append(on_)

	# 当前回合已出但未结算的牌
	if not game_over:
		var x := _slot_x(round - 1)
		if pending_host != "" and my_role == "king_side":
			var mn := CardMesh.make(_card_texture(pending_host, "king_side"), true, Vector3(x, 0.01, 1.0))
			table.add_child(mn)
			my_play_nodes.append(mn)
		elif pending_guest != "" and pending_guest != "submitted" and my_role == "slave_side":
			var mn := CardMesh.make(_card_texture(pending_guest, "slave_side"), true, Vector3(x, 0.01, 1.0))
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
	my_role = "king_side"
	online_started = false
	game_log.clear()
	_init_hands()
	ai_hand = {CARD_SLAVE: 1, CARD_COMMONER: 4, CARD_KING: 0}
	_full_rebuild()

func _on_create_pressed() -> void:
	mode = "host"
	my_role = "king_side"
	online_started = false
	game_log.clear()
	_init_hands()
	Net.connect_to_server()
	Net.create_room()
	_update_status()

func _join_room(code: String) -> void:
	mode = "guest"
	my_role = "slave_side"
	online_started = false
	Net.connect_to_server()
	Net.join_room(code)
	_update_status()

func _init_hands() -> void:
	hand_host = {CARD_KING: 1, CARD_COMMONER: 4, CARD_SLAVE: 0}
	hand_guest = {CARD_KING: 0, CARD_COMMONER: 4, CARD_SLAVE: 1}
	pending_host = ""
	pending_guest = ""
	round = 1
	game_over = false
	winner = ""
	history.clear()

# --- Net 信号 ---

func _on_room_created(_id: String) -> void:
	_update_status()

func _on_room_joined(_id: String) -> void:
	_update_status()

func _on_peer_joined() -> void:
	online_started = true
	if is_instance_valid(room_panel):
		room_panel.visible = false
	game_log.clear()
	_init_hands()
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
				_host_receive_guest_move(payload.get("card", ""))
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
	if card_index >= my_hand_types.size(): return

	var card_type := my_hand_types[card_index]

	if mode == "local" or mode == "host":
		if pending_host != "": return
		if (mode == "host" and hand_host.get(card_type, 0) <= 0) or \
		   (mode == "local" and hand_host.get(card_type, 0) <= 0): return
		selected_card = card_type
		for i in my_hand_nodes.size():
			CardMesh.set_selected(my_hand_nodes[i], i == card_index)
		_confirm_selection()

	elif mode == "guest":
		if pending_guest != "": return
		if hand_guest.get(card_type, 0) <= 0: return
		selected_card = card_type
		for i in my_hand_nodes.size():
			CardMesh.set_selected(my_hand_nodes[i], i == card_index)
		Net.send_payload({t = "move", card = card_type})
		pending_guest = card_type
		_full_rebuild()
		_update_status()

func _confirm_selection() -> void:
	if selected_card == "": return
	var card := selected_card
	selected_card = ""
	pending_host = card
	_full_rebuild()
	_update_status()

	if mode == "local":
		await get_tree().create_timer(0.2).timeout
		var ai_card := _ai_choose()
		_host_resolve(card, ai_card)
	elif mode == "host":
		_broadcast_state()
		if pending_guest != "":
			_host_resolve(pending_host, pending_guest)

func _ai_choose() -> String:
	if ai_hand.get(CARD_SLAVE, 0) > 0 and randi() % 2 == 0:
		return CARD_SLAVE
	if ai_hand.get(CARD_COMMONER, 0) > 0:
		return CARD_COMMONER
	return CARD_SLAVE

func _host_receive_guest_move(card: String) -> void:
	if pending_guest != "" or game_over: return
	if card not in [CARD_SLAVE, CARD_COMMONER, CARD_KING]: return
	if int(hand_guest.get(card, 0)) <= 0: return
	pending_guest = card
	_broadcast_state()
	if pending_host != "":
		_host_resolve(pending_host, pending_guest)

func _host_resolve(k_card: String, s_card: String) -> void:
	var outcome := _resolve(k_card, s_card)
	var slot_x := _slot_x(round - 1)
	hand_host[k_card] -= 1
	hand_guest[s_card] -= 1
	history.append({round = round, host_card = k_card, guest_card = s_card, outcome = outcome})

	pending_host = ""
	pending_guest = ""

	var is_last := round == 5
	game_over = outcome != "continues" or is_last
	if game_over:
		winner = "slave_side" if outcome == "slave_wins" else "king_side"
	else:
		round += 1

	if mode == "host":
		_broadcast_state()
	_full_rebuild()
	_resolve_feedback(outcome, slot_x)
	_log_round_result(k_card, s_card, outcome)

	if mode == "local" and not game_over:
		ai_hand[s_card] -= 1

func _resolve_feedback(outcome: String, slot_x: float) -> void:
	if outcome == "continues" and not game_over:
		Stage.shake(camera, 0.03, 0.18)
		return
	Stage.shake(camera, 0.08, 0.32)
	var i_win := (winner == my_role) if mode != "local" else (winner == "king_side")
	var text := "胜！" if i_win else "负"
	if mode == "local":
		text = "国王方胜！" if winner == "king_side" else "奴隶方胜！"
	var color := Palette.WIN if i_win else Palette.LOSE
	Stage.float_text(table, text, Vector3(slot_x, 0.3, 0), color)

func _broadcast_state() -> void:
	Net.send_payload({
		t = "state",
		round = round,
		hand_host = hand_host,
		hand_guest = hand_guest,
		pending_host = pending_host != "",
		pending_guest = pending_guest != "",
		history = history,
		game_over = game_over,
		winner = winner,
	})

func _guest_apply_state(payload: Dictionary) -> void:
	online_started = true
	round = int(payload.get("round", 1))
	hand_host = _to_dict(payload.get("hand_host", {}))
	hand_guest = _to_dict(payload.get("hand_guest", {}))
	var pguest: bool = payload.get("pending_guest", false)
	game_over = bool(payload.get("game_over", false))
	winner = str(payload.get("winner", ""))
	var new_history: Array = payload.get("history", [])

	pending_guest = "submitted" if pguest else ""

	var prev_len := history.size()
	history.assign(new_history)
	_full_rebuild()

	for i in range(prev_len, history.size()):
		var data := history[i] as Dictionary
		_log_round_result(str(data.get("host_card", "")), str(data.get("guest_card", "")),
				str(data.get("outcome", "")))

static func _to_dict(v: Variant) -> Dictionary:
	if typeof(v) == TYPE_DICTIONARY: return v as Dictionary
	return {}

# --- 日志 ---

func _log_round_result(k_card: String, s_card: String, outcome: String) -> void:
	var k_name := {CARD_KING: "国王K", CARD_COMMONER: "平民10", CARD_SLAVE: "奴隶2"}
	var s_name := {CARD_KING: "国王K", CARD_COMMONER: "平民10", CARD_SLAVE: "奴隶2"}
	var outcome_text := {"slave_wins": "奴隶方胜！", "king_wins": "国王方胜！", "continues": "继续"}
	var r := history.size()
	game_log.add("第%d轮 国王出%s · 奴隶出%s → %s" % [
		r, k_name.get(k_card, k_card), s_name.get(s_card, s_card), outcome_text.get(outcome, outcome)
	])
	if game_over:
		var role_label := "国王方" if winner == "king_side" else "奴隶方"
		game_log.add("—— %s获胜 ——" % role_label)

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

	status_label = Label.new()
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label.add_theme_font_size_override("font_size", 18)
	status_label.add_theme_color_override("font_color", Palette.TEXT)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.anchor_left = 0.0
	status_label.anchor_right = 1.0
	status_label.offset_top = 46.0
	status_label.offset_bottom = 74.0
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
		_init_hands()
		if mode == "host": _broadcast_state()
		elif mode == "local": ai_hand = {CARD_SLAVE: 1, CARD_COMMONER: 4, CARD_KING: 0}
		_full_rebuild()

func _update_status() -> void:
	if mode == "host" and not online_started:
		status_label.text = "房间号：%s（等待对手加入）" % Net.room_id
		return
	if mode == "guest" and not online_started:
		status_label.text = "已加入，等待开始"
		return
	if game_over:
		var role_label := "国王方" if winner == "king_side" else "奴隶方"
		var i_am := "国王方" if my_role == "king_side" else "奴隶方"
		status_label.text = "%s获胜！%s" % [role_label, "（你赢了）" if role_label == i_am else "（你输了）"] if mode != "local" else "%s获胜！" % role_label
		restart_button.visible = true
		return
	var my_pending := (pending_host != "" and my_role == "king_side") or (pending_guest != "" and my_role == "slave_side")
	status_label.text = "第%d/5轮 · %s" % [round, "已出牌，等待对手…" if my_pending else "请出牌"]
