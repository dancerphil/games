class_name RoomListPanel
extends VBoxContainer
## 显示等待中的 relay 房间列表，点击加入。
## 每 5 秒自动刷新，也可手动刷新。

signal join_requested(room_id: String)

var _list: VBoxContainer
var _empty_label: Label
var _code_edit: LineEdit

func _ready() -> void:
	custom_minimum_size = Vector2(240, 0)
	add_theme_constant_override("separation", 6)

	var header := HBoxContainer.new()
	add_child(header)
	var title := Label.new()
	title.text = "可加入的房间"
	title.add_theme_color_override("font_color", Palette.TEXT)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title)
	var refresh_btn := Button.new()
	refresh_btn.text = "刷新"
	refresh_btn.pressed.connect(refresh)
	header.add_child(refresh_btn)

	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 4)
	add_child(_list)
	_empty_label = Label.new()
	_empty_label.text = "暂无等待的房间"
	_empty_label.add_theme_color_override("font_color", Palette.TEXT)
	_list.add_child(_empty_label)

	var sep := HSeparator.new()
	add_child(sep)

	var manual_row := HBoxContainer.new()
	manual_row.add_theme_constant_override("separation", 4)
	add_child(manual_row)
	_code_edit = LineEdit.new()
	_code_edit.placeholder_text = "输入房间号"
	_code_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	manual_row.add_child(_code_edit)
	var join_btn := Button.new()
	join_btn.text = "加入"
	join_btn.pressed.connect(_on_manual_join)
	manual_row.add_child(join_btn)

	var timer := Timer.new()
	timer.wait_time = 5.0
	timer.timeout.connect(refresh)
	add_child(timer)
	timer.start()
	refresh()

func refresh() -> void:
	Net.fetch_relay_rooms(_on_rooms_fetched)

func _on_rooms_fetched(rooms: Array) -> void:
	for child in _list.get_children():
		if child != _empty_label:
			child.queue_free()
	_empty_label.visible = rooms.is_empty()
	for room in rooms:
		var room_id: String = str(room.get("id", ""))
		if room_id.is_empty():
			continue
		var row := HBoxContainer.new()
		var label := Label.new()
		label.text = "房间 %s" % room_id
		label.add_theme_color_override("font_color", Palette.TEXT)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(label)
		var btn := Button.new()
		btn.text = "加入"
		btn.pressed.connect(join_requested.emit.bind(room_id))
		row.add_child(btn)
		_list.add_child(row)

func _on_manual_join() -> void:
	var code := _code_edit.text.strip_edges()
	if not code.is_empty():
		join_requested.emit(code.to_upper())
