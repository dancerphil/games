extends Node3D
## 井字棋（真 3D 低多边形）。支持三种模式：
##   local —— 单机，玩家执 X 对战内置 AI
##   host  —— 联机房主，权威方，执 X，跑规则并广播全量状态
##   guest —— 联机加入方，执 O，只发落子意图、按房主广播的状态渲染
## 规则/AI/渲染都在本脚本内（游戏层），联机传输复用共享的 Net；视觉取色自 Palette。

const X_MARK := "X"
const O_MARK := "O"
const CELL_GAP := 1.1
const WIN_LINES := [
	[0, 1, 2], [3, 4, 5], [6, 7, 8],
	[0, 3, 6], [1, 4, 7], [2, 5, 8],
	[0, 4, 8], [2, 4, 6],
]

var mode := "local"
var my_mark := X_MARK
var online_started := false

var board: Array[String] = []
var current_turn := X_MARK
var game_over := false
var winner := ""

var pieces: Node3D
var status_label: Label
var restart_button: Button
var code_edit: LineEdit

func _ready() -> void:
	board.resize(9)
	board.fill("")
	_build_environment()
	_build_camera()
	_build_board()
	pieces = Node3D.new()
	add_child(pieces)
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

func _build_environment() -> void:
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-55, -40, 0)
	light.light_energy = 1.1
	add_child(light)

	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Palette.BACKGROUND
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.55, 0.6, 0.66)
	environment.ambient_light_energy = 0.7
	world_environment.environment = environment
	add_child(world_environment)

func _build_camera() -> void:
	var camera := Camera3D.new()
	add_child(camera)
	camera.position = Vector3(0, 4.4, 3.7)
	camera.look_at(Vector3.ZERO, Vector3.UP)
	camera.current = true

func _cell_position(index: int) -> Vector3:
	var column := index % 3
	var row := index / 3
	return Vector3((column - 1) * CELL_GAP, 0.0, (row - 1) * CELL_GAP)

func _build_board() -> void:
	var base := MeshInstance3D.new()
	var base_mesh := BoxMesh.new()
	base_mesh.size = Vector3(3.5, 0.2, 3.5)
	base.mesh = base_mesh
	base.material_override = Palette.flat_material(Palette.BOARD)
	base.position = Vector3(0, -0.11, 0)
	add_child(base)

	var line_material := Palette.flat_material(Palette.GRID)
	for offset in [-CELL_GAP / 2.0, CELL_GAP / 2.0]:
		add_child(_grid_bar(Vector3(3.3, 0.06, 0.06), Vector3(0, 0.01, offset), line_material))
		add_child(_grid_bar(Vector3(0.06, 0.06, 3.3), Vector3(offset, 0.01, 0), line_material))

	for index in 9:
		var body := StaticBody3D.new()
		body.position = _cell_position(index)
		var collision := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = Vector3(CELL_GAP, 0.4, CELL_GAP)
		collision.shape = shape
		body.add_child(collision)
		body.input_event.connect(_on_cell_input.bind(index))
		add_child(body)

func _grid_bar(size: Vector3, at: Vector3, material: StandardMaterial3D) -> MeshInstance3D:
	var bar := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	bar.mesh = mesh
	bar.material_override = material
	bar.position = at
	return bar

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var bar := HBoxContainer.new()
	bar.mouse_filter = Control.MOUSE_FILTER_PASS
	bar.add_theme_constant_override("separation", 8)
	bar.anchor_left = 0.5
	bar.anchor_right = 0.5
	bar.offset_top = 12.0
	bar.offset_left = -220.0
	bar.offset_right = 220.0
	layer.add_child(bar)
	bar.add_child(_bar_button("单机", _start_local))
	bar.add_child(_bar_button("创建房间", _on_create_pressed))
	bar.add_child(_bar_button("加入", _on_join_pressed))
	code_edit = LineEdit.new()
	code_edit.placeholder_text = "房间号"
	code_edit.custom_minimum_size = Vector2(96, 0)
	bar.add_child(code_edit)

	status_label = Label.new()
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label.add_theme_font_size_override("font_size", 26)
	status_label.add_theme_color_override("font_color", Palette.TEXT)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.anchor_left = 0.0
	status_label.anchor_right = 1.0
	status_label.offset_top = 56.0
	status_label.offset_bottom = 96.0
	layer.add_child(status_label)

	restart_button = Button.new()
	restart_button.text = "再来一局"
	restart_button.custom_minimum_size = Vector2(160, 48)
	restart_button.anchor_left = 0.5
	restart_button.anchor_right = 0.5
	restart_button.anchor_top = 1.0
	restart_button.anchor_bottom = 1.0
	restart_button.offset_left = -80.0
	restart_button.offset_right = 80.0
	restart_button.offset_top = -88.0
	restart_button.offset_bottom = -40.0
	restart_button.visible = false
	restart_button.pressed.connect(_on_restart_pressed)
	layer.add_child(restart_button)

func _bar_button(text: String, handler: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.pressed.connect(handler)
	return button

# --- 模式切换 ---

func _start_local() -> void:
	Net.close()
	mode = "local"
	my_mark = X_MARK
	online_started = false
	_reset_board()

func _on_create_pressed() -> void:
	mode = "host"
	my_mark = X_MARK
	online_started = false
	Net.connect_to_server()
	Net.create_room()
	status_label.text = "正在创建房间……"

func _on_join_pressed() -> void:
	var code := code_edit.text.strip_edges()
	if code.is_empty():
		status_label.text = "请输入房间号"
		return
	mode = "guest"
	my_mark = O_MARK
	online_started = false
	Net.connect_to_server()
	Net.join_room(code)
	status_label.text = "正在加入房间……"

# --- Net 信号 ---

func _on_room_created(_room_id: String) -> void:
	_update_status()

func _on_room_joined(_room_id: String) -> void:
	_update_status()

func _on_peer_joined() -> void:
	# 房主：对手到齐，开新局并广播初始状态
	online_started = true
	_reset_board()
	_broadcast_state()
	_update_status()

func _on_peer_left() -> void:
	online_started = false
	status_label.text = "对手已离开"
	restart_button.visible = false

func _on_net_error(text: String) -> void:
	status_label.text = text

func _on_net_message(payload: Dictionary) -> void:
	var kind: String = payload.get("t", "")
	if mode == "host":
		if kind == "move":
			_host_apply_guest_move(int(payload.get("index", -1)))
		elif kind == "restart":
			_on_peer_joined()
	elif mode == "guest":
		if kind == "state":
			_apply_state(payload)

# --- 落子输入 ---

func _on_cell_input(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int, index: int) -> void:
	if not (event is InputEventMouseButton):
		return
	var mouse_event := event as InputEventMouseButton
	if not mouse_event.pressed or mouse_event.button_index != MOUSE_BUTTON_LEFT:
		return
	if game_over or board[index] != "":
		return

	if mode == "local":
		if current_turn != X_MARK:
			return
		_apply_move(index, X_MARK)
		_render_board()
		_after_change()
		if not game_over:
			current_turn = O_MARK
			_update_status()
			await get_tree().create_timer(0.35).timeout
			_take_ai_turn()
	elif mode == "host":
		if not online_started or current_turn != X_MARK:
			return
		_apply_move(index, X_MARK)
		if not game_over:
			current_turn = O_MARK
		_render_board()
		_broadcast_state()
		_after_change()
	elif mode == "guest":
		if not online_started or current_turn != O_MARK:
			return
		Net.send_payload({"t": "move", "index": index})

func _host_apply_guest_move(index: int) -> void:
	if not online_started or current_turn != O_MARK or game_over:
		return
	if index < 0 or index > 8 or board[index] != "":
		return
	_apply_move(index, O_MARK)
	if not game_over:
		current_turn = X_MARK
	_render_board()
	_broadcast_state()
	_after_change()

func _take_ai_turn() -> void:
	var index := _ai_choose()
	if index < 0:
		return
	_apply_move(index, O_MARK)
	_render_board()
	if not game_over:
		current_turn = X_MARK
	_after_change()

# --- 规则与状态 ---

func _apply_move(index: int, mark: String) -> void:
	board[index] = mark
	_evaluate()

func _evaluate() -> void:
	winner = _winner()
	game_over = winner != "" or not board.has("")

func _winner() -> String:
	for line in WIN_LINES:
		var first: String = board[line[0]]
		if first != "" and first == board[line[1]] and first == board[line[2]]:
			return first
	return ""

func _reset_board() -> void:
	board.fill("")
	current_turn = X_MARK
	game_over = false
	winner = ""
	_render_board()
	restart_button.visible = false
	_update_status()

func _after_change() -> void:
	restart_button.visible = game_over
	_update_status()

func _broadcast_state() -> void:
	Net.send_payload({
		"t": "state",
		"board": board,
		"turn": current_turn,
		"over": game_over,
		"winner": winner,
	})

func _apply_state(payload: Dictionary) -> void:
	online_started = true
	board.assign(payload.get("board", []))
	current_turn = str(payload.get("turn", X_MARK))
	game_over = bool(payload.get("over", false))
	winner = str(payload.get("winner", ""))
	_render_board()
	restart_button.visible = game_over
	_update_status()

# --- AI（仅单机）---

func _ai_choose() -> int:
	var winning := _line_completion(O_MARK)
	if winning >= 0:
		return winning
	var blocking := _line_completion(X_MARK)
	if blocking >= 0:
		return blocking
	if board[4] == "":
		return 4
	for corner in [0, 2, 6, 8]:
		if board[corner] == "":
			return corner
	for index in 9:
		if board[index] == "":
			return index
	return -1

## 若 mark 在某条线上已占两格且第三格为空，返回该空格索引，用于抢赢或挡赢。
func _line_completion(mark: String) -> int:
	for line in WIN_LINES:
		var marked := 0
		var empty := -1
		for index in line:
			if board[index] == mark:
				marked += 1
			elif board[index] == "":
				empty = index
		if marked == 2 and empty >= 0:
			return empty
	return -1

# --- 渲染与 UI ---

func _render_board() -> void:
	for piece in pieces.get_children():
		piece.queue_free()
	for index in 9:
		if board[index] != "":
			pieces.add_child(_build_piece(board[index], _cell_position(index)))

func _build_piece(mark: String, at: Vector3) -> Node3D:
	if mark == O_MARK:
		var ring := MeshInstance3D.new()
		var torus := TorusMesh.new()
		torus.inner_radius = 0.18
		torus.outer_radius = 0.38
		torus.rings = 8
		torus.ring_segments = 12
		ring.mesh = torus
		ring.material_override = Palette.flat_material(Palette.O_PIECE)
		ring.position = at + Vector3(0, 0.05, 0)
		return ring

	var cross := Node3D.new()
	cross.position = at + Vector3(0, 0.05, 0)
	var cross_material := Palette.flat_material(Palette.X_PIECE)
	for angle in [45.0, -45.0]:
		var bar := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = Vector3(0.72, 0.12, 0.16)
		bar.mesh = mesh
		bar.material_override = cross_material
		bar.rotation_degrees = Vector3(0, angle, 0)
		cross.add_child(bar)
	return cross

func _on_restart_pressed() -> void:
	if mode == "guest":
		Net.send_payload({"t": "restart"})
	elif mode == "host":
		online_started = true
		_reset_board()
		_broadcast_state()
	else:
		_reset_board()

func _update_status() -> void:
	if mode == "host" and not online_started:
		status_label.text = "房间号：%s（等待对手加入）" % Net.room_id
		return
	if mode == "guest" and not online_started:
		status_label.text = "已加入，等待房主开始"
		return
	if game_over:
		if winner == "":
			status_label.text = "平局！"
		elif mode == "local":
			status_label.text = "你赢了！" if winner == X_MARK else "AI 赢了！"
		else:
			status_label.text = "你赢了！" if winner == my_mark else "对手赢了！"
		return
	if mode == "local":
		status_label.text = "轮到你了（X）" if current_turn == X_MARK else "AI 思考中（O）"
	else:
		status_label.text = "轮到你了" if current_turn == my_mark else "等待对手落子"
