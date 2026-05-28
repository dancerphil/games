## 桌面卡槽：4 条细边框围成的矩形轮廓，用于标识放牌位置。
class_name CardSlot

const W := CardMesh.CARD_W + 0.10
const H := CardMesh.CARD_H + 0.10
const T := 0.03
const Y := 0.004

static func make(at: Vector3, color: Color = Color(0.35, 0.35, 0.40)) -> Node3D:
	var node := Node3D.new()
	node.position = at
	_strip(node, Vector3(0,    Y, -H * 0.5), Vector3(W, T, T), color)
	_strip(node, Vector3(0,    Y,  H * 0.5), Vector3(W, T, T), color)
	_strip(node, Vector3(-W * 0.5, Y, 0),    Vector3(T, T, H), color)
	_strip(node, Vector3( W * 0.5, Y, 0),    Vector3(T, T, H), color)
	return node

static func _strip(parent: Node3D, pos: Vector3, size: Vector3, color: Color) -> void:
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mi.mesh = mesh
	mi.position = pos
	mi.material_override = Palette.flat_material(color)
	parent.add_child(mi)
