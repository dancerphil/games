extends Node3D
## 开放世界场景（低多边形，噪声高度图地形，第三人称）

const GRID := 80
const CELL := 3.0
const H_SCALE := 14.0
const NINJA := "res://shared/models/characters/Ninja_Sand.gltf"
const MODEL_SCALE := 0.3
const SPEED := 7.0
const GRAVITY := -22.0

const BATTLE_CELL := 1.0  # 与招式对战 CELL 一致

var _noise: FastNoiseLite

# --- 玩家 ---
var player: CharacterBody3D
var player_model: Node3D
var player_anim: AnimationPlayer

# --- 摄像头（沿用招式对战：右键旋转 + 平滑朝向跟随）---
var camera: Camera3D
var cam_yaw := 0.0
var cam_yaw_target := 0.0
var cam_pitch := 0.40
var cam_dist := 5.5
var _cam_dragging := false

func _ready() -> void:
	get_viewport().gui_release_focus()
	_noise = _make_noise()
	_build_env()
	_build_terrain()
	_build_water()
	_build_decorations()
	_build_player()

# --- 噪声 ---

func _make_noise() -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = 1337
	n.frequency = 0.013
	n.fractal_octaves = 5
	n.fractal_gain = 0.45
	n.fractal_lacunarity = 2.1
	return n

func _h(gx: int, gz: int) -> float:
	return _noise.get_noise_2d(float(gx), float(gz)) * H_SCALE

## 世界坐标处的地形高度（与 _build_terrain 的顶点保持一致：world x = gx*CELL - half）
func _hw(wx: float, wz: float) -> float:
	var half := GRID * CELL * 0.5
	return _noise.get_noise_2d((wx + half) / CELL, (wz + half) / CELL) * H_SCALE

## 真实渲染网格的地面高度：向下射线打地形 collider。
## 与屏幕上的三角网格完全一致（_hw 是平滑噪声，会和拉直的三角面有偏差）。
func _ground_y(wx: float, wz: float) -> float:
	var space := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(Vector3(wx, 200.0, wz), Vector3(wx, -200.0, wz))
	if is_instance_valid(player):
		query.exclude = [player.get_rid()]
	var hit := space.intersect_ray(query)
	if hit.is_empty():
		return _hw(wx, wz)
	return (hit.position as Vector3).y

# --- 地形颜色 ---

func _terrain_color(avg_y: float) -> Color:
	if avg_y < -1.0: return Color("2c5f78")  # 深水区
	if avg_y < 0.5:  return Color("c9a96e")  # 沙滩
	if avg_y < 3.5:  return Color("5c7e4a")  # 草地
	if avg_y < 7.5:  return Color("7a7262")  # 岩石
	return Color("d5d2cd")                    # 雪峰

func _add_tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3) -> void:
	var col := _terrain_color((a.y + b.y + c.y) / 3.0)
	st.set_color(col); st.add_vertex(a)
	st.set_color(col); st.add_vertex(b)
	st.set_color(col); st.add_vertex(c)

# --- 地形网格 ---

func _build_terrain() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var half := GRID * CELL * 0.5
	for gz in GRID:
		for gx in GRID:
			var x0 := gx * CELL - half
			var x1 := x0 + CELL
			var z0 := gz * CELL - half
			var z1 := z0 + CELL
			var p00 := Vector3(x0, _h(gx,     gz),     z0)
			var p10 := Vector3(x1, _h(gx + 1, gz),     z0)
			var p01 := Vector3(x0, _h(gx,     gz + 1), z1)
			var p11 := Vector3(x1, _h(gx + 1, gz + 1), z1)
			_add_tri(st, p00, p10, p11)
			_add_tri(st, p00, p11, p01)
	st.generate_normals()
	var mesh := st.commit()
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.95
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	add_child(mi)
	# 碰撞体
	var body := StaticBody3D.new()
	var col := CollisionShape3D.new()
	col.shape = mesh.create_trimesh_shape()
	body.add_child(col)
	add_child(body)

# --- 水面 ---

func _build_water() -> void:
	var pm := PlaneMesh.new()
	pm.size = Vector2(GRID * CELL + 30.0, GRID * CELL + 30.0)
	var mi := MeshInstance3D.new()
	mi.mesh = pm
	mi.position.y = 0.0
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.18, 0.45, 0.62, 0.72)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mi.material_override = mat
	add_child(mi)

# --- 装饰物 ---

func _build_decorations() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	var half := GRID * CELL * 0.5 * 0.88
	for _i in 320:
		var wx := rng.randf_range(-half, half)
		var wz := rng.randf_range(-half, half)
		var h := _hw(wx, wz)
		if h >= 0.8 and h <= 5.5:
			_place_tree(Vector3(wx, h, wz), rng)
	for _i in 180:
		var wx := rng.randf_range(-half, half)
		var wz := rng.randf_range(-half, half)
		var h := _hw(wx, wz)
		if h >= 1.0 and h <= 9.5:
			_place_rock(Vector3(wx, h, wz), rng)

func _place_tree(base: Vector3, rng: RandomNumberGenerator) -> void:
	var root := Node3D.new()
	root.position = base
	root.rotation.y = rng.randf() * TAU
	# 树干
	var trunk_h := rng.randf_range(0.9, 1.6)
	var tm := CylinderMesh.new()
	tm.top_radius = 0.09
	tm.bottom_radius = 0.16
	tm.height = trunk_h
	tm.radial_segments = 6
	tm.rings = 0
	var trunk := MeshInstance3D.new()
	trunk.mesh = tm
	trunk.position.y = trunk_h * 0.5
	trunk.material_override = Palette.flat_material(Color("5a3d22"))
	root.add_child(trunk)
	# 树冠（2-3 层球体）
	var greens := [Color("3a6b35"), Color("2f5a2c"), Color("4a7a40")]
	var top_y := trunk_h
	for j in rng.randi_range(2, 3):
		var r := rng.randf_range(0.55, 0.85) * pow(0.82, j)
		var sm := SphereMesh.new()
		sm.radius = r
		sm.height = r * 2.0
		sm.radial_segments = 5
		sm.rings = 3
		var blob := MeshInstance3D.new()
		blob.mesh = sm
		blob.position = Vector3(
			rng.randf_range(-0.18, 0.18),
			top_y + r * 0.75,
			rng.randf_range(-0.18, 0.18)
		)
		blob.material_override = Palette.flat_material(greens[j % greens.size()])
		root.add_child(blob)
		top_y = blob.position.y + r * 0.45
	add_child(root)

func _place_rock(base: Vector3, rng: RandomNumberGenerator) -> void:
	var root := Node3D.new()
	root.position = base
	var greys := [Color("7a7068"), Color("8a8278"), Color("625e58")]
	for _j in rng.randi_range(1, 3):
		var bm := BoxMesh.new()
		bm.size = Vector3(
			rng.randf_range(0.3, 1.0),
			rng.randf_range(0.25, 0.65),
			rng.randf_range(0.3, 1.0)
		)
		var rock := MeshInstance3D.new()
		rock.mesh = bm
		rock.position = Vector3(
			rng.randf_range(-0.45, 0.45),
			bm.size.y * 0.4,
			rng.randf_range(-0.45, 0.45)
		)
		rock.rotation = Vector3(
			rng.randf_range(-0.25, 0.25),
			rng.randf() * TAU,
			rng.randf_range(-0.25, 0.25)
		)
		rock.material_override = Palette.flat_material(greys[rng.randi() % greys.size()])
		root.add_child(rock)
	add_child(root)

# --- 环境 ---

func _build_env() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("1b3246")
	sky_mat.sky_horizon_color = Color("7a9cb0")
	sky_mat.ground_bottom_color = Color("283828")
	sky_mat.ground_horizon_color = Color("4a5e4a")
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.fog_enabled = true
	env.fog_density = 0.008
	env.fog_light_color = Color("8aacbc")
	env.glow_enabled = true
	env.glow_intensity = 0.35
	env.glow_bloom = 0.08
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var light := DirectionalLight3D.new()
	light.light_color = Color("ffe5c8")
	light.light_energy = 1.3
	light.rotation_degrees = Vector3(-50, 40, 0)
	light.shadow_enabled = true
	light.shadow_blur = 2.0
	add_child(light)

# --- 玩家 ---

func _build_player() -> void:
	var spawn_y := _hw(0.0, 0.0) + 2.0
	player = CharacterBody3D.new()
	player.position = Vector3(0.0, spawn_y, 0.0)
	var cap := CapsuleShape3D.new()
	cap.radius = 0.28
	cap.height = 1.4
	var col := CollisionShape3D.new()
	col.shape = cap
	col.position.y = 0.7
	player.add_child(col)
	var model: Node3D = load(NINJA).instantiate()
	model.scale = Vector3.ONE * MODEL_SCALE
	model.position.y = 0.04
	player_model = model
	player.add_child(model)
	var anims := model.find_children("*", "AnimationPlayer", true, false)
	player_anim = anims[0] if anims.size() > 0 else null
	if player_anim:
		for clip in ["Idle", "Run"]:
			if player_anim.has_animation(clip):
				player_anim.get_animation(clip).loop_mode = Animation.LOOP_LINEAR
		_play_anim("Idle")
	add_child(player)
	camera = Camera3D.new()
	camera.current = true
	add_child(camera)
	_snap_camera()

func _snap_camera() -> void:
	var tgt := _cam_target()
	camera.position = tgt + _cam_offset()
	if camera.position.distance_to(tgt) > 0.01:
		camera.look_at(tgt, Vector3.UP)

func _cam_target() -> Vector3:
	if not is_instance_valid(player): return Vector3.ZERO
	return player.global_position + Vector3(0, 1.2, 0)

func _cam_offset() -> Vector3:
	return Vector3(
		sin(cam_yaw) * cos(cam_pitch),
		sin(cam_pitch),
		cos(cam_yaw) * cos(cam_pitch)
	) * cam_dist

func _play_anim(clip: String) -> void:
	if player_anim and player_anim.has_animation(clip):
		if player_anim.current_animation != clip:
			player_anim.play(clip)

# --- 每帧 ---

func _update_movement(delta: float) -> void:
	if not is_instance_valid(player): return
	if not player.is_on_floor():
		player.velocity.y += GRAVITY * delta
	else:
		player.velocity.y = min(player.velocity.y, 0.0)
	var input := Vector2(
		float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)),
		float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W))
	)
	if input.length() > 0.01:
		input = input.normalized()
		var forward := Vector3(-sin(cam_yaw), 0.0, -cos(cam_yaw))
		var right   := Vector3( cos(cam_yaw), 0.0, -sin(cam_yaw))
		var dir := (right * input.x - forward * input.y).normalized()
		player.velocity.x = dir.x * SPEED
		player.velocity.z = dir.z * SPEED
		player_model.rotation.y = atan2(-dir.x, -dir.z) + PI
		_play_anim("Run")
	else:
		player.velocity.x = move_toward(player.velocity.x, 0.0, SPEED * 10.0 * delta)
		player.velocity.z = move_toward(player.velocity.z, 0.0, SPEED * 10.0 * delta)
		_play_anim("Idle")
	player.move_and_slide()

## 摄像头朝向由方向驱动（移动/攻击调用），平滑插值到目标 yaw（取最短弧避免跨 ±π 跳变）
func _set_cam_from_dir(dir: Vector3) -> void:
	if dir.length() > 0.01:
		cam_yaw_target = atan2(-dir.x, -dir.z)

func _update_camera(delta: float) -> void:
	if Input.is_key_pressed(KEY_Q): cam_yaw_target -= 1.5 * delta
	if Input.is_key_pressed(KEY_E): cam_yaw_target += 1.5 * delta
	var diff := fmod(cam_yaw_target - cam_yaw + PI * 3.0, PI * 2.0) - PI
	cam_yaw += diff * (1.0 - exp(-8.0 * delta))
	var tgt := _cam_target()
	camera.global_position = camera.global_position.lerp(
		tgt + _cam_offset(), 1.0 - exp(-12.0 * delta)
	)
	if camera.global_position.distance_to(tgt) > 0.01:
		camera.look_at(tgt, Vector3.UP)

func _physics_process(delta: float) -> void:
	_update_movement(delta)
	_update_camera(delta)

## 右键拖拽旋转视角（不捕获鼠标）
func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var e := event as InputEventMouseButton
		if e.button_index == MOUSE_BUTTON_RIGHT:
			_cam_dragging = e.pressed
	elif event is InputEventMouseMotion and _cam_dragging:
		var m := event as InputEventMouseMotion
		cam_yaw_target -= m.relative.x * 0.005
		cam_yaw = cam_yaw_target
		cam_pitch = clamp(cam_pitch + m.relative.y * 0.005, 0.05, 1.2)
