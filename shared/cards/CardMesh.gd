## 卡牌 3D 网格工厂。
## 卡牌是带厚度的薄方块（投真实阴影），顶面贴纹理朝上，平放在桌面（X-Z 平面）。
## 宽:高 = 0.74:1.0，与 Kenney 卡牌比例一致。
class_name CardMesh

# Kenney 贴图为 64×64，卡面实际只占 x[11..52] y[2..61]（42×60），四周是透明边距。
# 网格按卡面真实比例 42:60，并用下面的 UV 裁剪掉透明边距，使卡面铺满网格。
const CARD_W := 0.70
const CARD_H := 1.0
const THICK := 0.04          # 卡牌厚度
const FACE_Y := THICK * 0.5 + 0.001

const _CROP_SCALE := Vector3(42.0 / 64.0, 60.0 / 64.0, 1.0)
const _CROP_OFFSET := Vector3(11.0 / 64.0, 2.0 / 64.0, 0.0)

const HOVER_LIFT := 0.12
const HOVER_TILT := 0.20     # 悬停时朝相机微倾（绕 X 轴，弧度）
const SELECT_LIFT := 0.18

## 生成可点击的 3D 卡牌（StaticBody3D），始终使用此方法。
## card=-1 表示强制背面，face_up=false 同样显示背面。
## delay：入场动画的错峰延迟（秒），用于发牌依次弹入。
static func make(card: int, face_up: bool, at: Vector3, delay: float = 0.0) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = at
	body.set_meta("base_y", at.y)
	body.set_meta("selected", false)

	# 卡身（受光、投影、有厚度）
	var card_body := MeshInstance3D.new()
	card_body.name = "Body"
	var box := BoxMesh.new()
	box.size = Vector3(CARD_W, THICK, CARD_H)
	card_body.mesh = box
	card_body.material_override = Palette.flat_material(Palette.CARD_EDGE)
	card_body.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	body.add_child(card_body)

	# 顶面纹理
	var face := MeshInstance3D.new()
	face.name = "Face"
	var plane := PlaneMesh.new()
	plane.size = Vector2(CARD_W, CARD_H)
	plane.orientation = PlaneMesh.FACE_Y
	face.mesh = plane
	face.position.y = FACE_Y
	face.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	face.material_override = _face_material(card, face_up)
	body.add_child(face)

	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(CARD_W, THICK, CARD_H)
	col.shape = shape
	body.add_child(col)

	body.mouse_entered.connect(_on_hover.bind(body, true))
	body.mouse_exited.connect(_on_hover.bind(body, false))

	_animate_in(body, delay)
	return body

static func _face_material(card: int, face_up: bool) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = Cards.texture(card) if (face_up and card >= 0) else Cards.back_texture()
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	mat.uv1_scale = _CROP_SCALE
	mat.uv1_offset = _CROP_OFFSET
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.5
	mat.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
	mat.roughness = 1.0
	mat.emission_enabled = true
	mat.emission = Palette.ACCENT
	mat.emission_energy_multiplier = 0.0   # 悬停时提到 >0 产生辉光
	return mat

## 入场：缩放回弹弹入。create_tween 需节点已入树，故在 tree_entered 后启动。
static func _animate_in(body: StaticBody3D, delay: float) -> void:
	body.scale = Vector3(0.7, 0.7, 0.7)
	body.tree_entered.connect(func() -> void:
		var tween := body.create_tween()
		if delay > 0.0:
			tween.tween_interval(delay)
		tween.tween_property(body, "scale", Vector3.ONE, 0.34) \
			.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT),
		CONNECT_ONE_SHOT)

## 悬停：抬起 + 微倾向相机 + 高亮（选中状态下不响应，避免抢戏）。
static func _on_hover(body: StaticBody3D, entering: bool) -> void:
	if not is_instance_valid(body): return
	if body.get_meta("selected", false): return
	var base_y: float = body.get_meta("base_y", 0.01)
	var face := body.get_node_or_null("Face") as MeshInstance3D
	var tween := body.create_tween().set_parallel(true)
	tween.tween_property(body, "position:y", base_y + (HOVER_LIFT if entering else 0.0), 0.18) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(body, "rotation:x", -HOVER_TILT if entering else 0.0, 0.18)
	tween.tween_property(body, "scale", Vector3.ONE * (1.08 if entering else 1.0), 0.18)
	if face:
		var mat := face.material_override as StandardMaterial3D
		tween.tween_property(mat, "emission_energy_multiplier", 0.45 if entering else 0.0, 0.18)

## 高亮（选中）：弹簧抬起 + 放大。
static func set_selected(body: StaticBody3D, selected: bool) -> void:
	if not is_instance_valid(body): return
	body.set_meta("selected", selected)
	var base_y: float = body.get_meta("base_y", 0.01)
	var tween := body.create_tween().set_parallel(true)
	tween.tween_property(body, "position:y", base_y + (SELECT_LIFT if selected else 0.0), 0.22) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(body, "scale", Vector3.ONE * (1.12 if selected else 1.0), 0.22) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(body, "rotation:x", 0.0, 0.18)

## 更换纹理（翻面、换牌）
static func set_face(body: StaticBody3D, card: int, face_up: bool) -> void:
	var face := body.get_node_or_null("Face") as MeshInstance3D
	if not face: return
	var mat := face.material_override as StandardMaterial3D
	mat.albedo_texture = Cards.texture(card) if (face_up and card >= 0) else Cards.back_texture()
