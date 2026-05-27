extends Node
## 外壳场景：首页列表 + 返回按钮 + 当前游戏的挂载点。
## 类比 App.tsx：HomePage 与游戏视图之间切换，游戏作为子场景挂到 GameRoot 下。

@onready var game_root: Node3D = $GameRoot
@onready var home_ui: Control = $UI/HomeUI
@onready var back_button: Button = $UI/BackButton

var current_game: Node = null

func _ready() -> void:
	_build_home()
	back_button.pressed.connect(GameHub.go_home)
	GameHub.launch_requested.connect(_on_launch)
	GameHub.home_requested.connect(_on_home)
	_on_home()

func _build_home() -> void:
	var background := ColorRect.new()
	background.color = Palette.BACKGROUND
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	home_ui.add_child(background)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	home_ui.add_child(center)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 16)
	center.add_child(box)

	var title := Label.new()
	title.text = "Games"
	title.add_theme_font_size_override("font_size", 48)
	title.add_theme_color_override("font_color", Palette.TEXT)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)

	for game in GameHub.GAMES:
		var button := Button.new()
		button.text = game["title"]
		button.custom_minimum_size = Vector2(240, 60)
		button.pressed.connect(GameHub.launch.bind(game["id"]))
		box.add_child(button)

func _on_launch(scene_path: String) -> void:
	_clear_current_game()
	var packed: PackedScene = load(scene_path)
	current_game = packed.instantiate()
	game_root.add_child(current_game)
	home_ui.visible = false
	back_button.visible = true

func _on_home() -> void:
	_clear_current_game()
	home_ui.visible = true
	back_button.visible = false

func _clear_current_game() -> void:
	if current_game:
		current_game.queue_free()
		current_game = null
