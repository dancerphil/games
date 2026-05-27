extends Node3D
## 国王与奴隶（3D 低多边形卡牌）
## 规则：双方同时出牌，奴隶用奴隶牌打败国王则奴隶方胜；
##       国王方用国王或平民压过奴隶方，或5局内奴隶方未赢则国王方胜。
##
## 联机：relay + host 权威（host 执国王方，guest 执奴隶方）。
## 单机：host 打 AI（AI 随机出牌）。
##
## 牌面（Kenney）：
##   国王方：红心K(×1)、红心10(×4)
##   奴隶方：黑桃2(×1)、黑桃10(×4)

const CARD_KING := "king"
const CARD_COMMONER := "commoner"
const CARD_SLAVE := "slave"

# 规则解析，返回 "slave_wins" / "king_wins" / "continues"
static func _resolve(k_card: String, s_card: String) -> String:
	if s_card == CARD_SLAVE and k_card == CARD_KING:
		return "slave_wins"
	if k_card == CARD_COMMONER and s_card == CARD_SLAVE:
		return "king_wins"
	if k_card == CARD_KING and s_card == CARD_COMMONER:
		return "king_wins"
	return "continues"

# --- 游戏状态（host 维护） ---
var round := 1
var hand_host: Dictionary = {}   # {king:int, commoner:int, slave:int}
var hand_guest: Dictionary = {}
var pending_host := ""            # 本轮 host 已选的牌（""=未选）
var pending_guest := ""           # 本轮 guest 已选的牌
var game_over := false
var winner := ""                  # "king_side" | "slave_side"
var history: Array[Dictionary] = []

# --- 模式 ---
var mode := "local"   # "local" | "host" | "guest"
var my_role := "king_side"  # host 固定 king_side，guest 固定 slave_side
var online_started := false
var ai_hand: Dictionary = {}

# --- 3D 节点 ---
var table: Node3D
var my_card_nodes: Dictionary = {}    # card_type -> StaticBody3D
var opp_card_nodes: Array[StaticBody3D] = []
var selected_card := ""

# --- UI ---
var status_label: Label
var restart_button: Button
var code_edit: LineEdit
var round_result_label: Label

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

# --- 场景搭建 ---

func _build_camera() -> void:
	var camera := Camera3D.new()
	camera.position = Vector3(0, 5.5, 4.5)
	camera.look_at_from_position(camera.position, Vector3(0, 0, 0), Vector3.UP)
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

func _card_texture(card_type: String, role: String) -> int:
	if role == "king_side":
		return Cards.HEARTS_K if card_type == CARD_KING else Cards.HEARTS_10
	return Cards.SPADES_2 if card_type == CARD_SLAVE else Cards.SPADES_10

func _build_my_hand() -> void:
	for node in my_card_nodes.values():
		node.queue_free()
	my_card_nodes.clear()
	selected_card = ""

	var types: Array[String] = []
	if my_role == "king_side":
		if hand_host.get(CARD_KING, 0) > 0:
			types.append(CARD_KING)
		if hand_host.get(CARD_COMMONER, 0) > 0:
			types.append(CARD_COMMONER)
	else:
		if hand_guest.get(CARD_SLAVE, 0) > 0:
			types.append(CARD_SLAVE)
		if hand_guest.get(CARD_COMMONER, 0) > 0:
			types.append(CARD_COMMONER)

	var n := types.size()
	for i in n:
		var card_type := types[i]
		var x := (i - (n - 1) * 0.5) * 0.9
		var node := CardMesh.make(_card_texture(card_type, my_role), true, Vector3(x, 0.01, 2.5))
		node.input_event.connect(_on_my_card_input.bind(card_type))
		table.add_child(node)
		my_card_nodes[card_type] = node

		# 平民牌：右上角数量标签（CanvasLayer 坐标不方便，用 3D Label3D 替代）
		var count: int = hand_host.get(card_type, 0) if my_role == "king_side" else hand_guest.get(card_type, 0)
		if card_type == CARD_COMMONER and count > 1:
			var label3d := Label3D.new()
			label3d.text = "×%d" % count
			label3d.font_size = 28
			label3d.modulate = Palette.TEXT
			label3d.position = Vector3(x + 0.28, 0.05, 2.0)
			label3d.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			table.add_child(label3d)

func _build_opp_hand() -> void:
	for node in opp_card_nodes:
		node.queue_free()
	opp_card_nodes.clear()

	var opp_hand: Dictionary = hand_guest if my_role == "king_side" else hand_host
	var total: int = int(opp_hand.get(CARD_KING, 0)) + int(opp_hand.get(CARD_COMMONER, 0)) + int(opp_hand.get(CARD_SLAVE, 0))
	total = clampi(total, 0, 5)

	for i in total:
		var x: float = (i - (total - 1) * 0.5) * 0.9
		var node := CardMesh.make(-1, false, Vector3(x, 0.01, -2.5))
		table.add_child(node)
		opp_card_nodes.append(node)

# --- 模式切换 ---

func _start_local() -> void:
	Net.close()
	mode = "local"
	my_role = "king_side"
	online_started = false
	_init_hands()
	ai_hand = {CARD_SLAVE: 1, CARD_COMMONER: 4, CARD_KING: 0}
	_full_rebuild()

func _on_create_pressed() -> void:
	mode = "host"
	my_role = "king_side"
	online_started = false
	_init_hands()
	Net.connect_to_server()
	Net.create_room()
	_update_status()

func _on_join_pressed() -> void:
	var code := code_edit.text.strip_edges()
	if code.is_empty():
		status_label.text = "请输入房间号"
		return
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

func _full_rebuild() -> void:
	_build_my_hand()
	_build_opp_hand()
	restart_button.visible = false
	round_result_label.text = ""
	_update_status()

# --- Net 信号 ---

func _on_room_created(_id: String) -> void:
	_update_status()

func _on_room_joined(_id: String) -> void:
	_update_status()

func _on_peer_joined() -> void:
	online_started = true
	_init_hands()
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
				_host_receive_guest_move(payload.get("card", ""))
		"state":
			if mode == "guest":
				_guest_apply_state(payload)
		"restart":
			if mode == "host" and online_started:
				_on_peer_joined()

# --- 输入 ---

func _on_my_card_input(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int, card_type: String) -> void:
	if not (event is InputEventMouseButton):
		return
	var e := event as InputEventMouseButton
	if not e.pressed or e.button_index != MOUSE_BUTTON_LEFT:
		return
	if game_over:
		return

	if mode == "local" or mode == "host":
		if pending_host != "":
			return
		# 国王方逻辑检查
		var avail := hand_host if mode == "host" else hand_host
		if avail.get(card_type, 0) <= 0:
			return
		selected_card = card_type
		for ct in my_card_nodes:
			CardMesh.set_selected(my_card_nodes[ct], ct == selected_card)
		_confirm_selection()

	elif mode == "guest":
		if pending_guest != "":
			return
		if hand_guest.get(card_type, 0) <= 0:
			return
		selected_card = card_type
		for ct in my_card_nodes:
			CardMesh.set_selected(my_card_nodes[ct], ct == selected_card)
		Net.send_payload({t = "move", card = card_type})
		pending_guest = card_type
		_update_status()

func _confirm_selection() -> void:
	if selected_card == "":
		return
	var card := selected_card
	selected_card = ""
	pending_host = card
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
	# AI 随机出牌（优先出奴隶牌如果有）
	if ai_hand.get(CARD_SLAVE, 0) > 0 and randi() % 2 == 0:
		return CARD_SLAVE
	if ai_hand.get(CARD_COMMONER, 0) > 0:
		return CARD_COMMONER
	return CARD_SLAVE

func _host_receive_guest_move(card: String) -> void:
	if pending_guest != "" or game_over:
		return
	if card not in [CARD_SLAVE, CARD_COMMONER, CARD_KING]:
		return
	var valid: bool = int(hand_guest.get(card, 0)) > 0
	if not valid:
		return
	pending_guest = card
	_broadcast_state()
	if pending_host != "":
		_host_resolve(pending_host, pending_guest)

func _host_resolve(k_card: String, s_card: String) -> void:
	var outcome := _resolve(k_card, s_card)
	var king_hand := hand_host
	var slave_hand := hand_guest
	king_hand[k_card] -= 1
	slave_hand[s_card] -= 1
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
	_show_round_result(k_card, s_card, outcome)

	if mode == "local" and not game_over:
		ai_hand[s_card] -= 1

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
	var phost: bool = payload.get("pending_host", false)
	var pguest: bool = payload.get("pending_guest", false)
	game_over = bool(payload.get("game_over", false))
	winner = str(payload.get("winner", ""))
	history.assign(payload.get("history", []))

	# 如果 guest 刚出牌，pending_guest 为 true（不需要本地再设，只显示状态）
	if pguest:
		pending_guest = "submitted"
	else:
		pending_guest = ""

	_full_rebuild()
	var hist: Array = payload.get("history", [])
	if hist.size() > 0:
		var last: Dictionary = hist[hist.size() - 1]
		_show_round_result(str(last.get("host_card", "")), str(last.get("guest_card", "")), str(last.get("outcome", "")))

static func _to_dict(v: Variant) -> Dictionary:
	if typeof(v) == TYPE_DICTIONARY:
		return v as Dictionary
	return {}

func _show_round_result(k_card: String, s_card: String, outcome: String) -> void:
	var k_label := {CARD_KING: "国王K", CARD_COMMONER: "平民10", CARD_SLAVE: "奴隶2"}
	var s_label := {CARD_KING: "国王K", CARD_COMMONER: "平民10", CARD_SLAVE: "奴隶2"}
	var outcome_text := {"slave_wins": "奴隶方胜！", "king_wins": "国王方胜！", "continues": "继续"}
	round_result_label.text = "国王方出：%s  奴隶方出：%s  %s" % [
		k_label.get(k_card, k_card), s_label.get(s_card, s_card), outcome_text.get(outcome, outcome)
	]

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
	bar.add_child(_small_button("单机", _start_local))
	bar.add_child(_small_button("创建房间", _on_create_pressed))
	bar.add_child(_small_button("加入", _on_join_pressed))
	code_edit = LineEdit.new()
	code_edit.placeholder_text = "房间号"
	code_edit.custom_minimum_size = Vector2(88, 0)
	bar.add_child(code_edit)

	status_label = Label.new()
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label.add_theme_font_size_override("font_size", 22)
	status_label.add_theme_color_override("font_color", Palette.TEXT)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.anchor_left = 0.0
	status_label.anchor_right = 1.0
	status_label.offset_top = 90.0
	status_label.offset_bottom = 124.0
	layer.add_child(status_label)

	round_result_label = Label.new()
	round_result_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	round_result_label.add_theme_font_size_override("font_size", 18)
	round_result_label.add_theme_color_override("font_color", Palette.ACCENT)
	round_result_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	round_result_label.anchor_left = 0.0
	round_result_label.anchor_right = 1.0
	round_result_label.offset_top = 120.0
	round_result_label.offset_bottom = 152.0
	layer.add_child(round_result_label)

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

func _small_button(text: String, handler: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.pressed.connect(handler)
	return button

func _on_restart_pressed() -> void:
	if mode == "guest":
		Net.send_payload({t = "restart"})
	else:
		_init_hands()
		if mode == "host":
			_broadcast_state()
		elif mode == "local":
			ai_hand = {CARD_SLAVE: 1, CARD_COMMONER: 4, CARD_KING: 0}
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
		if mode == "local":
			status_label.text = "%s获胜！" % role_label
		else:
			var i_am := "国王方" if my_role == "king_side" else "奴隶方"
			status_label.text = "%s获胜！%s" % [role_label, "（你赢了）" if role_label == i_am else "（你输了）"]
		restart_button.visible = true
		return
	var round_text := "第 %d / 5 轮" % round
	var my_hand: Dictionary = hand_host if my_role == "king_side" else hand_guest
	var my_total: int = int(my_hand.get(CARD_KING, 0)) + int(my_hand.get(CARD_COMMONER, 0)) + int(my_hand.get(CARD_SLAVE, 0))
	var my_pending := (pending_host != "" and my_role == "king_side") or (pending_guest != "" and my_role == "slave_side")
	var status := "已出牌，等待对手…" if my_pending else "请出牌"
	status_label.text = "%s · 你剩 %d 张 · %s" % [round_text, my_total, status]
