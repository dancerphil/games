## 游戏日志面板：逐条追加事件，自动滚动到底部。
class_name GameLog
extends PanelContainer

var _box: VBoxContainer
var _scroll: ScrollContainer

func _ready() -> void:
	custom_minimum_size = Vector2(260, 130)
	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_scroll)
	_box = VBoxContainer.new()
	_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_box.add_theme_constant_override("separation", 2)
	_scroll.add_child(_box)

func add(text: String) -> void:
	var label := Label.new()
	label.text = text
	label.add_theme_color_override("font_color", Palette.TEXT)
	label.add_theme_font_size_override("font_size", 13)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_box.add_child(label)
	await get_tree().process_frame
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)

func clear() -> void:
	for child in _box.get_children():
		child.queue_free()
