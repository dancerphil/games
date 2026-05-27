extends Node
## 游戏注册表 + 场景切换中枢，类比 web 端的 App.tsx 路由 / enterGame / exitGame。
## 新增游戏只需在 GAMES 里加一条，外壳会数据驱动地生成入口。

const GAMES := [
	{"id": "tic_tac_toe", "title": "井字棋", "scene": "res://games/tic_tac_toe/tic_tac_toe.tscn"},
	{"id": "card_games", "title": "卡牌游戏", "scene": "res://games/card_games/card_games.tscn"},
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
