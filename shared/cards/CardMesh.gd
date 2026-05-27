## 卡牌 3D 网格工厂。
## 卡牌平放在桌面（PlaneMesh，X-Z 平面，纹理朝上）。
## 宽:高 = 0.74:1.0，与 Kenney 卡牌比例一致。
class_name CardMesh

const CARD_W := 0.74
const CARD_H := 1.0

## 生成可点击的 3D 卡牌（StaticBody3D），始终使用此方法。
## card=-1 表示强制背面，face_up=false 同样显示背面。
static func make(card: int, face_up: bool, at: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = at

	var mesh_inst := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(CARD_W, CARD_H)
	plane.orientation = PlaneMesh.FACE_Y
	mesh_inst.mesh = plane

	var mat := StandardMaterial3D.new()
	mat.albedo_texture = Cards.texture(card) if (face_up and card >= 0) else Cards.back_texture()
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	mat.roughness = 0.8
	mesh_inst.material_override = mat
	body.add_child(mesh_inst)

	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(CARD_W, 0.05, CARD_H)
	col.shape = shape
	body.add_child(col)

	return body

## 高亮（选中）：抬高 Y + 缩放略大
static func set_selected(body: StaticBody3D, selected: bool) -> void:
	body.position.y = 0.15 if selected else 0.01

## 更换纹理（翻面、换牌）
static func set_face(body: StaticBody3D, card: int, face_up: bool) -> void:
	var mesh_inst := body.get_child(0) as MeshInstance3D
	var mat := mesh_inst.material_override as StandardMaterial3D
	mat.albedo_texture = Cards.texture(card) if (face_up and card >= 0) else Cards.back_texture()
