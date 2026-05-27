extends Node3D
## 三合一卡牌游戏入口：国王与奴隶 / 九张牌 / 地雷德扑。
## 类似 web 端的 BossHub，顶部 tab 切换子游戏，子游戏作为子场景挂载。

const GAMES := [
	{id = "emperor_slave", title = "国王与奴隶", scene = "res://games/card_games/emperor_slave/emperor_slave.tscn"},
	{id = "nine", title = "九张牌", scene = "res://games/card_games/nine/nine.tscn"},
	{id = "mine_texas", title = "地雷德扑", scene = "res://games/card_games/mine_texas/mine_texas.tscn"},
]

var current_game_node: Node = null
var current_id := ""
var tab_buttons: Array[Button] = []
var game_root: Node3D

func _ready() -> void:
	_build_environment()
	game_root = Node3D.new()
	add_child(game_root)
	_build_tab_ui()
	_enter_game("emperor_slave")

func _build_environment() -> void:
	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Palette.BACKGROUND
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.55, 0.6, 0.66)
	environment.ambient_light_energy = 0.7
	world_environment.environment = environment
	add_child(world_environment)

	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-55, -40, 0)
	light.light_energy = 1.1
	add_child(light)

func _build_tab_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 4)
	bar.anchor_left = 0.5
	bar.anchor_right = 0.5
	bar.offset_left = -200.0
	bar.offset_right = 200.0
	bar.offset_top = 8.0
	layer.add_child(bar)

	for game in GAMES:
		var button := Button.new()
		button.text = game.title
		button.custom_minimum_size = Vector2(120, 36)
		button.pressed.connect(_enter_game.bind(game.id))
		bar.add_child(button)
		tab_buttons.append(button)

func _enter_game(game_id: String) -> void:
	if current_id == game_id:
		return
	if current_game_node:
		current_game_node.queue_free()
		current_game_node = null
	current_id = game_id
	for i in GAMES.size():
		tab_buttons[i].disabled = GAMES[i].id == game_id
	for game in GAMES:
		if game.id == game_id:
			var packed := load(game.scene) as PackedScene
			current_game_node = packed.instantiate()
			game_root.add_child(current_game_node)
			return
