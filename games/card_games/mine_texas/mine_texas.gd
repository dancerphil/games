extends Node3D
## 地雷德扑（3D 低多边形卡牌）
## 规则：各发7张牌，同时选5张作手牌 + 在对手7张里选1张作地雷。
##       手牌胜者得1分，地雷踩中者得1分。先到10分胜。
##
## 联机：relay + host 权威（host 负责洗牌/发牌/评估，广播全量状态）。
## 单机：host 打 AI（AI 自动选最优5张 + 随机地雷）。

const WIN_SCORE := 10

# --- 游戏状态 ---
var round_num := 1
var hand_host: Array[int] = []
var hand_guest: Array[int] = []
var selection_host: Array[int] = []    # 选的5张（空=未选）
var mine_host := -1                    # 在对手手牌里选的地雷
var selection_guest: Array[int] = []
var mine_guest := -1
var score_host := 0
var score_guest := 0
var game_over := false
var winner := ""
var history: Array[Dictionary] = []
var best_host: Array[int] = []    # 推荐的5张索引（在 hand_host 里）
var best_guest: Array[int] = []

# --- 模式 ---
var mode := "local"
var online_started := false

# --- 3D ---
var table: Node3D
var my_card_nodes: Array[StaticBody3D] = []    # 按 hand 顺序
var opp_card_nodes: Array[StaticBody3D] = []
var selected_indices: Array[int] = []          # 我选的牌在 my_hand 里的索引
var mine_index := -1                           # 我选的地雷在 opp_hand 里的索引

# --- UI ---
var status_label: Label
var restart_button: Button
var code_edit: LineEdit
var result_label: Label
var submit_button: Button

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
	camera.position = Vector3(0, 6.2, 4.2)
	camera.look_at_from_position(camera.position, Vector3(0, 0, -0.3), Vector3.UP)
	camera.current = true
	add_child(camera)

func _build_table() -> void:
	table = Node3D.new()
	add_child(table)
	var base := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(8.5, 0.15, 8.0)
	base.mesh = mesh
	base.material_override = Palette.flat_material(Color("2d5a27"))
	base.position = Vector3(0, -0.08, 0)
	table.add_child(base)

func _card_x(index: int, total: int) -> float:
	return (index - (total - 1) * 0.5) * 0.82

# --- 洗牌发牌 ---

static func _fresh_deck() -> Array[int]:
	var deck: Array[int] = []
	for i in 52:
		deck.append(i)
	return deck

static func _shuffle(deck: Array[int]) -> Array[int]:
	var d := deck.duplicate()
	for i in range(d.size() - 1, 0, -1):
		var j := randi() % (i + 1)
		var tmp: int = d[i]
		d[i] = d[j]
		d[j] = tmp
	return d

func _deal_hands() -> void:
	var deck := _shuffle(_fresh_deck())
	hand_host.assign(deck.slice(0, 7))
	hand_guest.assign(deck.slice(7, 14))
	best_host.assign(Poker.best_indices(hand_host))
	best_guest.assign(Poker.best_indices(hand_guest))

# --- 手牌 3D 渲染 ---

func _my_hand() -> Array[int]:
	return hand_host if mode != "guest" else hand_guest

func _opp_hand() -> Array[int]:
	return hand_guest if mode != "guest" else hand_host

func _my_best() -> Array[int]:
	return best_host if mode != "guest" else best_guest

func _build_hands() -> void:
	for node in my_card_nodes:
		node.queue_free()
	my_card_nodes.clear()
	for node in opp_card_nodes:
		node.queue_free()
	opp_card_nodes.clear()
	selected_indices.clear()
	mine_index = -1

	var my := _my_hand()
	var opp := _opp_hand()
	var best := _my_best()

	# 我的手牌（下方，面朝上）
	for i in my.size():
		var node := CardMesh.make(my[i], true, Vector3(_card_x(i, my.size()), 0.01, 2.3))
		node.input_event.connect(_on_my_card_input.bind(i))
		table.add_child(node)
		my_card_nodes.append(node)
		# 推荐高亮：轻微抬起
		if i in best:
			node.position.y = 0.06

	# 对手手牌（上方，面朝上——设计上对手牌可见，选地雷用）
	for i in opp.size():
		var node := CardMesh.make(opp[i], true, Vector3(_card_x(i, opp.size()), 0.01, -2.3))
		node.input_event.connect(_on_opp_card_input.bind(i))
		table.add_child(node)
		opp_card_nodes.append(node)

func _refresh_selection_visuals() -> void:
	for i in my_card_nodes.size():
		CardMesh.set_selected(my_card_nodes[i], i in selected_indices)
	for i in opp_card_nodes.size():
		CardMesh.set_selected(opp_card_nodes[i], i == mine_index)
	_update_submit_button()

# --- 模式切换 ---

func _start_local() -> void:
	Net.close()
	mode = "local"
	online_started = false
	_init_round()
	_full_rebuild()

func _on_create_pressed() -> void:
	mode = "host"
	online_started = false
	_init_round()
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

func _init_round() -> void:
	_deal_hands()
	selection_host.clear()
	selection_guest.clear()
	mine_host = -1
	mine_guest = -1

func _init_game() -> void:
	round_num = 1
	score_host = 0
	score_guest = 0
	game_over = false
	winner = ""
	history.clear()
	_init_round()

func _full_rebuild() -> void:
	_build_hands()
	restart_button.visible = false
	result_label.text = ""
	_update_status()
	_update_submit_button()

# --- Net ---

func _on_room_created(_id: String) -> void: _update_status()
func _on_room_joined(_id: String) -> void: _update_status()

func _on_peer_joined() -> void:
	online_started = true
	_init_game()
	_full_rebuild()
	_broadcast_state()

func _on_peer_left() -> void:
	online_started = false
	status_label.text = "对手已离开"

func _on_net_error(text: String) -> void:
	status_label.text = text

func _on_net_message(payload: Dictionary) -> void:
	match payload.get("t", ""):
		"submit":
			if mode == "host" and online_started:
				_host_receive_guest_submit(
					payload.get("hand", []),
					int(payload.get("mine", -1))
				)
		"state":
			if mode == "guest":
				_guest_apply_state(payload)
		"restart":
			if mode == "host" and online_started:
				_on_peer_joined()

# --- 输入 ---

func _can_interact() -> bool:
	if game_over:
		return false
	if mode == "host" or mode == "local":
		return selection_host.size() < 5 or mine_host < 0
	return selection_guest.size() < 5 or mine_guest < 0

func _on_my_card_input(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int, index: int) -> void:
	if not (event is InputEventMouseButton):
		return
	var e := event as InputEventMouseButton
	if not e.pressed or e.button_index != MOUSE_BUTTON_LEFT:
		return
	if not _can_interact():
		return
	# 切换选中
	var already_submitted := (mode == "host" and selection_host.size() == 5) or (mode == "guest" and selection_guest.size() == 5)
	if already_submitted:
		return
	if index in selected_indices:
		selected_indices.erase(index)
	elif selected_indices.size() < 5:
		selected_indices.append(index)
	_refresh_selection_visuals()

func _on_opp_card_input(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int, index: int) -> void:
	if not (event is InputEventMouseButton):
		return
	var e := event as InputEventMouseButton
	if not e.pressed or e.button_index != MOUSE_BUTTON_LEFT:
		return
	if not _can_interact():
		return
	mine_index = index if mine_index != index else -1
	_refresh_selection_visuals()

func _on_submit_pressed() -> void:
	if selected_indices.size() != 5 or mine_index < 0:
		return
	var my := _my_hand()
	var opp := _opp_hand()
	var hand_cards: Array[int] = []
	for i in selected_indices:
		hand_cards.append(my[i])
	var mine_card := opp[mine_index]

	if mode == "local" or mode == "host":
		selection_host.assign(hand_cards)
		mine_host = mine_card
		if mode == "local":
			# AI：选最优5张 + 随机地雷
			var ai_best := Poker.best_indices(hand_guest)
			var ai_hand: Array[int] = []
			for i in ai_best:
				ai_hand.append(hand_guest[i])
			selection_guest.assign(ai_hand)
			mine_guest = hand_host[randi() % hand_host.size()]
			_host_resolve()
		elif mode == "host":
			_broadcast_state()
			if selection_guest.size() == 5 and mine_guest >= 0:
				_host_resolve()
	elif mode == "guest":
		selection_guest.assign(hand_cards)
		mine_guest = mine_card
		Net.send_payload({t = "submit", hand = hand_cards, mine = mine_card})
		_update_status()
		_update_submit_button()

func _host_receive_guest_submit(hand: Array, mine_card: int) -> void:
	if selection_guest.size() == 5 or game_over:
		return
	if hand.size() != 5:
		return
	# 验证牌都在 guest 手牌里，地雷在 host 手牌里
	for c in hand:
		if not hand_guest.has(c):
			return
	if not hand_host.has(mine_card):
		return
	selection_guest.assign(hand)
	mine_guest = mine_card
	_broadcast_state()
	if selection_host.size() == 5 and mine_host >= 0:
		_host_resolve()

func _host_resolve() -> void:
	var hand_winner_result := Poker.hand_winner(selection_host, selection_guest)
	var host_mine_hit := selection_guest.has(mine_host)
	var guest_mine_hit := selection_host.has(mine_guest)
	var host_gained := (1 if hand_winner_result == 1 else 0) + (1 if host_mine_hit else 0)
	var guest_gained := (1 if hand_winner_result == 2 else 0) + (1 if guest_mine_hit else 0)
	score_host += host_gained
	score_guest += guest_gained

	var rr: Dictionary = {
		round_num = round_num,
		host_hand = selection_host.duplicate(),
		guest_hand = selection_guest.duplicate(),
		host_best = Poker.hand_name(selection_host),
		guest_best = Poker.hand_name(selection_guest),
		hand_winner = hand_winner_result,
		host_mine = mine_host,
		guest_mine = mine_guest,
		host_mine_hit = host_mine_hit,
		guest_mine_hit = guest_mine_hit,
		host_gained = host_gained,
		guest_gained = guest_gained,
	}
	history.append(rr)

	game_over = score_host >= WIN_SCORE or score_guest >= WIN_SCORE
	if game_over:
		winner = "host" if score_host > score_guest else "guest"
	else:
		round_num += 1
		_init_round()

	if mode == "host":
		_broadcast_state()
	_full_rebuild()
	_show_round_result(rr)

func _show_round_result(rr: Dictionary) -> void:
	var is_host := mode != "guest"
	var my_best := str(rr.get("host_best", "")) if is_host else str(rr.get("guest_best", ""))
	var opp_best := str(rr.get("guest_best", "")) if is_host else str(rr.get("host_best", ""))
	var hw := int(rr.get("hand_winner", 0))
	var hand_outcome := "平局"
	if (hw == 1 and is_host) or (hw == 2 and not is_host):
		hand_outcome = "牌胜"
	elif (hw == 2 and is_host) or (hw == 1 and not is_host):
		hand_outcome = "牌负"
	var my_hit := bool(rr.get("host_mine_hit", false)) if is_host else bool(rr.get("guest_mine_hit", false))
	var opp_hit := bool(rr.get("guest_mine_hit", false)) if is_host else bool(rr.get("host_mine_hit", false))
	var mine_text := ""
	if my_hit:
		mine_text += " 对手雷踩中你！"
	if opp_hit:
		mine_text += " 你的雷踩中了！"
	result_label.text = "你：%s（%s）  对手：%s  %s%s" % [my_best, hand_outcome, opp_best, hand_outcome, mine_text]

func _broadcast_state() -> void:
	Net.send_payload({
		t = "state",
		round_num = round_num,
		hand_host = hand_host,
		hand_guest = hand_guest,
		best_host = best_host,
		best_guest = best_guest,
		score_host = score_host,
		score_guest = score_guest,
		pending_host = selection_host.size() == 5,
		pending_guest = selection_guest.size() == 5,
		history = history,
		game_over = game_over,
		winner = winner,
	})

func _guest_apply_state(payload: Dictionary) -> void:
	online_started = true
	round_num = int(payload.get("round_num", 1))
	hand_host.assign(payload.get("hand_host", []))
	hand_guest.assign(payload.get("hand_guest", []))
	best_host.assign(payload.get("best_host", []))
	best_guest.assign(payload.get("best_guest", []))
	score_host = int(payload.get("score_host", 0))
	score_guest = int(payload.get("score_guest", 0))
	game_over = bool(payload.get("game_over", false))
	winner = str(payload.get("winner", ""))
	history.assign(payload.get("history", []))
	if bool(payload.get("pending_guest", false)):
		selection_guest = [0, 0, 0, 0, 0]  # 占位，表示已提交
	else:
		selection_guest.clear()
		mine_guest = -1
	_full_rebuild()
	var hist: Array = payload.get("history", [])
	if hist.size() > 0:
		_show_round_result(hist[hist.size() - 1] as Dictionary)

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

	result_label = _make_label(16, Palette.ACCENT, 122.0, 150.0)
	layer.add_child(result_label)

	submit_button = Button.new()
	submit_button.text = "出牌"
	submit_button.custom_minimum_size = Vector2(120, 44)
	submit_button.anchor_left = 0.5
	submit_button.anchor_right = 0.5
	submit_button.anchor_top = 1.0
	submit_button.anchor_bottom = 1.0
	submit_button.offset_left = -60.0
	submit_button.offset_right = 60.0
	submit_button.offset_top = -132.0
	submit_button.offset_bottom = -88.0
	submit_button.disabled = true
	submit_button.pressed.connect(_on_submit_pressed)
	layer.add_child(submit_button)

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

func _update_submit_button() -> void:
	if submit_button == null:
		return
	var already_submitted := false
	if mode == "host" or mode == "local":
		already_submitted = selection_host.size() == 5 and mine_host >= 0
	else:
		already_submitted = selection_guest.size() == 5
	submit_button.visible = not game_over and not already_submitted and online_started or mode == "local"
	submit_button.disabled = selected_indices.size() != 5 or mine_index < 0
	var count := selected_indices.size()
	submit_button.text = "出牌" if count == 5 and mine_index >= 0 else "选 %d/5 张 + 地雷" % count

func _on_restart_pressed() -> void:
	if mode == "guest":
		Net.send_payload({t = "restart"})
	else:
		_init_game()
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
		var is_me_winner := (winner == "host" and mode != "guest") or (winner == "guest" and mode == "guest")
		status_label.text = "%s  你 %d : %d 对手（先到%d分胜）" % [
			"你赢了！" if is_me_winner else "你输了！", my_score, opp_score, WIN_SCORE
		]
		restart_button.visible = true
		return
	var my_score := score_host if mode != "guest" else score_guest
	var opp_score := score_guest if mode != "guest" else score_host
	var submitted := (selection_host.size() == 5 and mine_host >= 0) if (mode != "guest") else (selection_guest.size() == 5)
	status_label.text = "第 %d 轮 · 你 %d : %d 对手（先到%d分）· %s" % [
		round_num, my_score, opp_score, WIN_SCORE, "已出牌，等待…" if submitted else "请选5张+设地雷"
	]
