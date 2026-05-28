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

# 灯光与环境
const LIGHT_COLOR := Color("fff4e0")    # 暖白主光
const AMBIENT := Color("3a4660")        # 冷调环境光，与暖光形成冷暖对比
const FOG := Color("16202e")            # 远处氛围
const CARD_EDGE := Color("f4f1e8")      # 卡牌侧边纸张色
const WIN := Color("6ddf8e")
const LOSE := Color("e8623c")

func flat_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.0
	material.roughness = 0.85
	return material
