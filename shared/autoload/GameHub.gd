extends Node
## 游戏注册表 + 场景切换中枢，类比 web 端的 App.tsx 路由 / enterGame / exitGame。
## 新增游戏只需在 GAMES 里加一条，外壳会数据驱动地生成入口。

const GAMES := [
	{"id": "tic_tac_toe", "title": "井字棋", "scene": "res://games/tic_tac_toe/tic_tac_toe.tscn"},
	{"id": "emperor_slave", "title": "国王与奴隶", "scene": "res://games/card_games/emperor_slave/emperor_slave.tscn"},
	{"id": "nine", "title": "九张牌", "scene": "res://games/card_games/nine/nine.tscn"},
	{"id": "mine_texas", "title": "地雷德扑", "scene": "res://games/card_games/mine_texas/mine_texas.tscn"},
	{"id": "stance", "title": "招式对战", "scene": "res://games/stance/stance.tscn"},
	{"id": "boss", "title": "招式 Boss 战", "scene": "res://games/boss/boss.tscn"},
	{"id": "world", "title": "开放世界", "scene": "res://games/world/world.tscn"},
	{"id": "world_boss", "title": "世界 Boss 战", "scene": "res://games/world_boss/world_boss.tscn"},
]

signal launch_requested(scene_path: String)
signal home_requested

func launch(id: String) -> void:
	for game in GAMES:
		if game["id"] == id:
			launch_requested.emit(game["scene"])
			return

func go_home() -> void:
	home_requested.emit()
