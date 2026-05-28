## 跨游戏共享的 3D 舞台工具：环境氛围、主光、屏幕震动、浮动文字。
## 类比前端的「全局视觉层 / 反馈层」，所有 3D 游戏从这里取得统一的光影与打击感。
class_name Stage

## 环境氛围：暖冷对比的环境光 + 微弱辉光(bloom) + 轻雾营造景深。
## 注意：gl_compatibility 后端下 glow/阴影可用但弱于 Forward+。
static func make_environment() -> WorldEnvironment:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Palette.BACKGROUND

	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Palette.AMBIENT
	env.ambient_light_energy = 1.4

	env.fog_enabled = true
	env.fog_light_color = Palette.FOG
	env.fog_density = 0.02

	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.1
	env.glow_hdr_threshold = 1.0

	var node := WorldEnvironment.new()
	node.environment = env
	return node

## 主光：略带暖色的方向光，斜向打下并投软阴影，给卡牌厚度感。
static func make_key_light() -> DirectionalLight3D:
	var light := DirectionalLight3D.new()
	light.light_color = Palette.LIGHT_COLOR
	light.light_energy = 1.1
	light.rotation_degrees = Vector3(-55, -35, 0)
	light.shadow_enabled = true
	light.shadow_blur = 1.5
	light.shadow_bias = 0.05
	return light

## 屏幕震动：抖动相机的 h/v_offset（不改变 look_at 朝向），振幅随时间衰减。
static func shake(camera: Camera3D, intensity: float = 0.06, duration: float = 0.25) -> void:
	if not is_instance_valid(camera): return
	var tween := camera.create_tween()
	tween.tween_method(
		func(t: float) -> void:
			var amount := intensity * (1.0 - t)
			camera.h_offset = randf_range(-amount, amount)
			camera.v_offset = randf_range(-amount, amount),
		0.0, 1.0, duration)
	tween.tween_callback(func() -> void:
		camera.h_offset = 0.0
		camera.v_offset = 0.0)

## 浮动文字：在世界坐标弹出一段文字，放大→上浮→淡出后自动销毁。
static func float_text(parent: Node3D, text: String, world_pos: Vector3, color: Color) -> void:
	var label := Label3D.new()
	label.text = text
	label.font_size = 64
	label.pixel_size = 0.004
	label.modulate = color
	label.outline_size = 12
	label.outline_modulate = Color(0, 0, 0, 0.6)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.position = world_pos
	label.scale = Vector3.ZERO
	parent.add_child(label)

	var tween := label.create_tween()
	tween.tween_property(label, "scale", Vector3.ONE, 0.22) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.parallel().tween_property(label, "position:y", world_pos.y + 1.2, 1.1) \
		.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(label, "modulate:a", 0.0, 0.45)
	tween.tween_callback(label.queue_free)

## 命中爆发：在世界坐标喷一束星火粒子（加色混合），结束后自动销毁。
## 用 CPUParticles3D —— gl_compatibility 后端不支持 GPUParticles3D。
static func hit_burst(parent: Node3D, world_pos: Vector3, color: Color) -> void:
	var p := CPUParticles3D.new()
	p.position = world_pos
	p.amount = 18
	p.lifetime = 0.55
	p.one_shot = true
	p.explosiveness = 0.92
	p.direction = Vector3(0, 1, 0)
	p.spread = 180.0
	p.initial_velocity_min = 1.5
	p.initial_velocity_max = 3.6
	p.gravity = Vector3(0, -5, 0)
	p.scale_amount_min = 0.25
	p.scale_amount_max = 0.55
	p.color = color
	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.32, 0.32)
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = load("res://shared/particles/star_07.png")
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.albedo_color = color
	mesh.material = mat
	p.mesh = mesh
	parent.add_child(p)
	p.emitting = true
	p.finished.connect(p.queue_free)
