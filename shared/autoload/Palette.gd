extends Node
## 跨游戏共享的低多边形调色板与材质工厂。
## 类比网页里的设计 token / 主题文件，所有游戏从这里取色，保证视觉一致。

const BACKGROUND := Color("1e2a3a")
const BOARD := Color("3a4a5e")
const GRID := Color("28323f")
const X_PIECE := Color("e8623c")
const O_PIECE := Color("3cb0e8")
const ACCENT := Color("f2c14e")
const TEXT := Color("eef2f7")

func flat_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.0
	material.roughness = 0.85
	return material
