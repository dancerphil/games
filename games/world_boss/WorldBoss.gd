extends "res://games/world/World.gd"
## 开放世界 + 招式 Boss 战（爆破 Boss）融合场景
## 复用 World 的地形、树木、摄像头、角色；在世界中直接触发 Boss 战斗。

const BOSS_GLB := "res://shared/models/bosses/Skeleton_Mage.glb"
const BOSS_SCALE := 0.42
const BOSS_ANIM_PATHS := [
	"res://shared/models/bosses/anims/Rig_Medium_General.glb",
	"res://shared/models/bosses/anims/Rig_Medium_MovementBasic.glb",
]
const TRIGGER_DIST := 5.0  # 5 格触发范围
const BOSS_SPAWN_XZ := Vector2(0.0, -10.0)  # 出生点 10 格外（W 方向）
const BOSS_HP_MAX := 5
const PLAYER_HP_MAX := 2
const BOSS_SKILLS := ["snipe", "bombard", "burst"]
const SKILL_LABELS := {"snipe": "狙击", "bombard": "轰炸", "burst": "爆发"}

# --- 阶段 ---
enum Phase { FREE_ROAM, DECK_SELECT, BATTLE, ENDED }
var phase := Phase.FREE_ROAM

# --- 战斗网格 ---
var grid_center := Vector3.ZERO

# --- 玩家战斗状态 ---
var player_cell := Vector2i(3, 1)
var player_hp := PLAYER_HP_MAX
var pending_double := false

# --- Boss 状态 ---
var boss_cell := Vector2i(3, 5)
var boss_hp := BOSS_HP_MAX
var skill_index := 0
var winner := -1

# --- 回合选择状态 ---
var deck: Array = []  # 进入世界时选定的 5 张招式
var hand: Array = []
var discard: Array = []
var sel_card := ""
var sel_move := Stance.NONE
var sel_stage := ""
var waiting := false

# --- 节点 ---
var boss_node: Node3D
var boss_model: Node3D
var boss_anim: AnimationPlayer
static var _anim_lib: AnimationLibrary = null
var highlight_nodes: Array[Node3D] = []
var warning_nodes: Array[Node3D] = []
var seen_skills: Array[String] = []
var battle_grid: MeshInstance3D = null

# --- UI ---
var canvas: CanvasLayer
var deck_panel: PanelContainer
var hand_bar: HBoxContainer
var status_label: Label
var hp_label: Label
var deck_toggles := {}
var deck_confirm_btn: Button
var restart_btn: Button
var game_log: GameLog

# =======================================================================
func _ready() -> void:
	phase = Phase.DECK_SELECT  # 先选牌，再进入世界
	super._ready()
	_place_boss()
	_build_battle_ui()
	deck_panel.visible = true
	_update_status()

# =======================================================================
# 每帧 / 输入
# =======================================================================

func _physics_process(delta: float) -> void:
	if phase == Phase.FREE_ROAM:
		_update_movement(delta)
		if is_instance_valid(player) and is_instance_valid(boss_node):
			if player.global_position.distance_to(boss_node.global_position) < TRIGGER_DIST:
				_init_battle()
	_update_camera(delta)

## 复用父类的右键旋转视角；战斗中左键点地选格
func _input(event: InputEvent) -> void:
	super._input(event)
	if event is InputEventMouseButton and phase == Phase.BATTLE and not waiting:
		var e := event as InputEventMouseButton
		if e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			_handle_terrain_click()

# =======================================================================
# Boss 模型
# =======================================================================

func _place_boss() -> void:
	var wx := BOSS_SPAWN_XZ.x
	var wz := BOSS_SPAWN_XZ.y
	var ground_y := maxf(_hw(wx, wz), 1.5)  # 确保在水面以上
	boss_node = Node3D.new()
	boss_node.position = Vector3(wx, ground_y, wz)
	# 悬浮标记，方便从远处找到 Boss
	var marker := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.6
	sm.height = 1.2
	marker.mesh = sm
	marker.material_override = Palette.flat_material(Color("e8623c"))
	marker.position.y = 3.5
	boss_node.add_child(marker)
	boss_model = load(BOSS_GLB).instantiate() as Node3D
	boss_model.scale = Vector3.ONE * BOSS_SCALE
	boss_model.rotation_degrees.y = 90.0
	boss_node.add_child(boss_model)
	add_child(boss_node)
	_ensure_anim_lib()
	boss_anim = AnimationPlayer.new()
	boss_model.add_child(boss_anim)
	boss_anim.add_animation_library("", _anim_lib)
	boss_anim.root_node = boss_anim.get_path_to(boss_model)
	if boss_anim.has_animation("Idle_A"):
		boss_anim.play("Idle_A")

static func _ensure_anim_lib() -> void:
	if _anim_lib != null: return
	_anim_lib = AnimationLibrary.new()
	for path in BOSS_ANIM_PATHS:
		var inst: Node = load(path).instantiate()
		var aps := inst.find_children("*", "AnimationPlayer", true, false)
		if aps.size() > 0:
			var ap := aps[0] as AnimationPlayer
			for clip in ap.get_animation_list():
				if not _anim_lib.has_animation(clip):
					_anim_lib.add_animation(clip, ap.get_animation(clip))
		inst.free()
	if _anim_lib.has_animation("Idle_A"):
		_anim_lib.get_animation("Idle_A").loop_mode = Animation.LOOP_LINEAR

func _boss_play(clip: String) -> void:
	if boss_anim and boss_anim.has_animation(clip):
		boss_anim.play(clip)

# =======================================================================
# 格子坐标
# =======================================================================

## 战斗格子直接映射到世界的 1×1 格（贴合真实网格高度，不画独立棋盘）
func _cell_world(p: Vector2i) -> Vector3:
	var wx := grid_center.x + (p.y - 3) * BATTLE_CELL
	var wz := grid_center.z + (p.x - 3) * BATTLE_CELL
	return Vector3(wx, _ground_y(wx, wz) + 0.06, wz)

func _world_to_cell(wp: Vector3) -> Vector2i:
	var c := int(round((wp.x - grid_center.x) / BATTLE_CELL)) + 3
	var r := int(round((wp.z - grid_center.z) / BATTLE_CELL)) + 3
	if c < 0 or c >= 7 or r < 0 or r >= 7: return Stance.NONE
	return Vector2i(r, c)

func _raycast_terrain() -> Vector3:
	var mouse := get_viewport().get_mouse_position()
	var from := camera.project_ray_origin(mouse)
	var to := from + camera.project_ray_normal(mouse) * 300.0
	var query := PhysicsRayQueryParameters3D.create(from, to)
	query.exclude = [player.get_rid()]
	var result := get_world_3d().direct_space_state.intersect_ray(query)
	return result.get("position", Vector3.INF) as Vector3

# =======================================================================
# 格子高亮
# =======================================================================

## 高亮格子：按四角的真实网格高度构建贴合斜坡的四边形，略微抬高避免被地面遮挡
func _overlay(cell: Vector2i, color: Color, alpha := 0.5) -> MeshInstance3D:
	var cx := grid_center.x + (cell.y - 3) * BATTLE_CELL
	var cz := grid_center.z + (cell.x - 3) * BATTLE_CELL
	var s := BATTLE_CELL * 0.46
	var o := 0.04  # 采样的就是渲染网格本身，极小抬高即可
	var p0 := Vector3(cx - s, _ground_y(cx - s, cz - s) + o, cz - s)
	var p1 := Vector3(cx + s, _ground_y(cx + s, cz - s) + o, cz - s)
	var p2 := Vector3(cx + s, _ground_y(cx + s, cz + s) + o, cz + s)
	var p3 := Vector3(cx - s, _ground_y(cx - s, cz + s) + o, cz + s)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for v in [p0, p1, p2, p0, p2, p3]:
		st.add_vertex(v)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color.r, color.g, color.b, alpha)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 0.5
	mi.material_override = mat
	add_child(mi)
	return mi

func _clear_nodes(arr: Array) -> void:
	for n in arr:
		if is_instance_valid(n): n.queue_free()
	arr.clear()

func _refresh_highlights() -> void:
	_clear_nodes(highlight_nodes)
	if sel_card == "" or waiting: return
	if sel_stage == "move":
		for cell in Stance.move_options(sel_card, player_cell, 0):
			highlight_nodes.append(_overlay(cell, Color("4ea3f2")))
	elif sel_stage == "attack":
		var targets := Stance.attack_targets(sel_card, player_cell, sel_move, 0)
		var aoe: Array[Vector2i] = []
		for t in targets:
			for h in Stance.hit_cells(sel_card, player_cell, sel_move, 0, t):
				if not aoe.has(h): aoe.append(h)
		for cell in aoe:
			highlight_nodes.append(_overlay(cell, Color("fde68a"), 0.4))
		for cell in targets:
			highlight_nodes.append(_overlay(cell, Color("fca5a5")))

func _flash_cells(cells: Array, color: Color) -> void:
	for cell in cells:
		var mi := _overlay(cell, color, 0.65)
		var mat := (mi as MeshInstance3D).material_override as StandardMaterial3D
		var tw := mi.create_tween()
		tw.tween_interval(0.2)
		tw.tween_property(mat, "albedo_color:a", 0.0, 0.5)
		tw.tween_callback(mi.queue_free)

# =======================================================================
# 战斗场地格线（仅 7×7 区域，贴合地形，细且淡）
# =======================================================================

const GRID_LIFT := 0.04
const GRID_HALF_WIDTH := 0.018  # 比世界格线更细

func _build_battle_grid() -> void:
	if is_instance_valid(battle_grid): battle_grid.queue_free()
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var half := 3.5 * BATTLE_CELL  # 7 格，8 条边界线，外缘在 ±3.5
	for i in 8:
		var z := grid_center.z + (i - 3.5) * BATTLE_CELL
		_grid_ribbon(st, grid_center.x - half, z, grid_center.x + half, z)
		var x := grid_center.x + (i - 3.5) * BATTLE_CELL
		_grid_ribbon(st, x, grid_center.z - half, x, grid_center.z + half)
	battle_grid = MeshInstance3D.new()
	battle_grid.mesh = st.commit()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.85, 0.92, 1.0, 0.22)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	battle_grid.material_override = mat
	add_child(battle_grid)

## 沿 (ax,az)→(bx,bz) 铺一条贴合地形的细带，沿途按真实网格高度采样
func _grid_ribbon(st: SurfaceTool, ax: float, az: float, bx: float, bz: float) -> void:
	var dir := Vector2(bx - ax, bz - az)
	var length := dir.length()
	dir = dir.normalized()
	var perp := Vector2(-dir.y, dir.x) * GRID_HALF_WIDTH
	var steps := maxi(int(length / 0.5), 1)
	var prev_l := Vector3.ZERO
	var prev_r := Vector3.ZERO
	for i in steps + 1:
		var t := float(i) / steps
		var px := lerpf(ax, bx, t)
		var pz := lerpf(az, bz, t)
		var lx := px - perp.x; var lz := pz - perp.y
		var rx := px + perp.x; var rz := pz + perp.y
		var l := Vector3(lx, _ground_y(lx, lz) + GRID_LIFT, lz)
		var r := Vector3(rx, _ground_y(rx, rz) + GRID_LIFT, rz)
		if i > 0:
			st.add_vertex(prev_l); st.add_vertex(prev_r); st.add_vertex(r)
			st.add_vertex(prev_l); st.add_vertex(r); st.add_vertex(l)
		prev_l = l; prev_r = r

# =======================================================================
# Boss 技能特效
# =======================================================================

func _farthest_cell(from: Vector2i, cells: Array) -> Vector2i:
	var best := from
	var best_dist := -1
	for c in cells:
		var d := Stance.manhattan(c, from)
		if d > best_dist: best_dist = d; best = c
	return best

## 子弹：从枪口飞向目标，到达时迸发火花
func _shoot_bullet(from_w: Vector3, to_w: Vector3, color: Color) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.13; sm.height = 0.26; sm.radial_segments = 6; sm.rings = 3
	mi.mesh = sm; mi.position = from_w
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color; mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.emission_enabled = true; mat.emission = color; mat.emission_energy_multiplier = 2.5
	mi.material_override = mat; add_child(mi)
	var tw := mi.create_tween()
	tw.tween_property(mi, "position", to_w, 0.28).set_trans(Tween.TRANS_LINEAR)
	tw.tween_callback(func(): Stage.hit_burst(self, to_w, color); mi.queue_free())

## 轰炸：Boss 跃起抛物线飞行，落地时 3×3 大爆炸 + 冲击波
func _do_bombard(boss_to: Vector2i, boss_aoe: Array) -> void:
	_boss_play("Jump_Start")
	var start := boss_node.global_position
	var land := _cell_world(boss_to)
	# 预警：目标 3×3 格闪烁
	for cell in Stance.filled_square(boss_to, 1):
		var mi := _overlay(cell, Color("ff6600"), 0.35)
		var mat := (mi as MeshInstance3D).material_override as StandardMaterial3D
		var tw2 := mi.create_tween(); tw2.set_loops(3)
		tw2.tween_property(mat, "albedo_color:a", 0.0, 0.1)
		tw2.tween_property(mat, "albedo_color:a", 0.35, 0.1)
		tw2.tween_callback(mi.queue_free)
	# 抛物线弧
	var tw := boss_node.create_tween()
	tw.tween_method(func(t: float):
		var xz := start.lerp(land, t)
		boss_node.global_position = Vector3(xz.x, lerpf(start.y, land.y, t) + sin(t * PI) * 6.0, xz.z),
		0.0, 1.0, 0.55)
	tw.tween_callback(func():
		_boss_play("Jump_Land")
		_flash_cells(boss_aoe, Color("e8623c"))
		_explosion_large(land + Vector3(0, 0.4, 0), Color("ff7b3c"), 9.0)
		_shockwave(land, Color("ff9d3c"), 5.0, 0.4)
		Stage.shake(camera, 0.14, 0.4))

## 爆发：就地召唤、全场警报、超大爆炸 + 双层冲击波 + 四角小爆
func _do_burst(boss_to: Vector2i, boss_aoe: Array) -> void:
	_boss_play("Spawn_Ground")
	var center := _cell_world(boss_to)
	# 全 3×3 警报闪烁
	for cell in Stance.filled_square(boss_to, 1):
		var mi := _overlay(cell, Color("ffffff"), 0.5)
		var mat := (mi as MeshInstance3D).material_override as StandardMaterial3D
		var tw2 := mi.create_tween(); tw2.set_loops(4)
		tw2.tween_property(mat, "albedo_color:a", 0.0, 0.08)
		tw2.tween_property(mat, "albedo_color:a", 0.5, 0.08)
		tw2.tween_callback(mi.queue_free)
	# 中心大爆炸
	get_tree().create_timer(0.3).timeout.connect(func():
		_flash_cells(boss_aoe, Color("e8623c"))
		_explosion_large(center + Vector3(0, 0.5, 0), Color("ff5500"), 14.0)
		_shockwave(center, Color("ff9944"), 6.0, 0.5)
		Stage.shake(camera, 0.2, 0.55), CONNECT_ONE_SHOT)
	# 第二波冲击波
	get_tree().create_timer(0.55).timeout.connect(func():
		_shockwave(center, Color("ffcc66"), 9.0, 0.55), CONNECT_ONE_SHOT)
	# 四角小爆
	for offset in [Vector2i(-1,-1), Vector2i(-1,1), Vector2i(1,-1), Vector2i(1,1)]:
		var corner_cell: Vector2i = boss_to + offset
		if Stance.in_bounds(corner_cell):
			get_tree().create_timer(0.45 + randf() * 0.25).timeout.connect(func():
				_explosion_large(_cell_world(corner_cell) + Vector3(0,0.3,0), Color("ff7733"), 5.0),
				CONNECT_ONE_SHOT)

## 膨胀球爆炸：scale 控制最终大小
func _explosion_large(world_pos: Vector3, color: Color, max_scale: float) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.5; sm.height = 1.0; sm.radial_segments = 10; sm.rings = 5
	mi.mesh = sm; mi.position = world_pos
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color.r, color.g, color.b, 0.65)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.emission_enabled = true; mat.emission = color; mat.emission_energy_multiplier = 1.5
	mi.material_override = mat; add_child(mi)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3.ONE * max_scale, 0.45).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(mat, "albedo_color:a", 0.0, 0.45)
	tw.tween_callback(mi.queue_free)
	Stage.hit_burst(self, world_pos, color)

## 冲击波：扁平圆环向外扩散
func _shockwave(world_pos: Vector3, color: Color, max_radius: float, duration: float) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.3; cm.bottom_radius = 0.3; cm.height = 0.2
	cm.radial_segments = 20; cm.rings = 1
	mi.mesh = cm; mi.position = world_pos + Vector3(0, 0.15, 0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(color.r, color.g, color.b, 0.7)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.emission_enabled = true; mat.emission = color; mat.emission_energy_multiplier = 1.2
	mi.material_override = mat; add_child(mi)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3(max_radius, 1.0, max_radius), duration).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(mat, "albedo_color:a", 0.0, duration)
	tw.tween_callback(mi.queue_free)

# =======================================================================
# 战斗流程
# =======================================================================

func _on_deck_confirm() -> void:
	var chosen: Array[String] = []
	for s in Stance.ALL:
		if deck_toggles[s].button_pressed: chosen.append(s)
	if chosen.size() != 5: return
	deck = chosen
	deck_panel.visible = false
	phase = Phase.FREE_ROAM
	_update_status()

func _init_battle() -> void:
	phase = Phase.BATTLE
	winner = -1
	waiting = false
	player_hp = PLAYER_HP_MAX
	boss_hp = BOSS_HP_MAX
	skill_index = 0
	pending_double = false
	sel_card = ""
	sel_stage = ""
	seen_skills.clear()
	_clear_nodes(warning_nodes)
	var shuffled := deck.duplicate()
	shuffled.shuffle()
	hand = shuffled.slice(0, 3)
	discard = shuffled.slice(3, 5)
	player_cell = Vector2i(3, 1)
	boss_cell = Vector2i(3, 5)
	# 以 Boss 当前位置为锚点，对齐到世界格子中心（整数+0.5，正好落在格线方块内）
	var snap_x := floorf(boss_node.global_position.x) + 0.5
	var snap_z := floorf(boss_node.global_position.z) + 0.5
	# Boss 占 (3,5)，反推出格子原点 (3,3 中心)
	grid_center = Vector3(snap_x - (boss_cell.y - 3) * BATTLE_CELL, 0.0, snap_z - (boss_cell.x - 3) * BATTLE_CELL)
	_build_battle_grid()
	# 双方就位（玩家被拉入战斗阵型，贴合地形）
	player.global_position = _cell_world(player_cell)
	player.velocity = Vector3.ZERO
	boss_node.global_position = _cell_world(boss_cell)
	# 面朝对方，摄像头朝向 Boss
	var to_boss := _cell_world(boss_cell) - _cell_world(player_cell)
	player_model.rotation.y = atan2(-to_boss.x, -to_boss.z) + PI
	boss_model.rotation_degrees.y = 90.0
	_set_cam_from_dir(to_boss)
	cam_yaw = cam_yaw_target
	hand_bar.visible = true
	restart_btn.visible = false
	game_log.clear()
	_refresh_hand()
	_update_status()

func _on_card_pressed(card: String) -> void:
	if phase != Phase.BATTLE or waiting: return
	sel_card = card
	sel_move = Stance.NONE
	if Stance.is_no_move(card):
		sel_move = player_cell
		_enter_attack_or_confirm()
	else:
		sel_stage = "move"
	_refresh_highlights()
	_update_status()

func _handle_terrain_click() -> void:
	if sel_card == "": return
	var hit := _raycast_terrain()
	if hit == Vector3.INF: return
	var cell := _world_to_cell(hit)
	if cell == Stance.NONE: return
	if sel_stage == "move":
		if Stance.move_options(sel_card, player_cell, 0).has(cell):
			sel_move = cell
			_enter_attack_or_confirm()
			_refresh_highlights()
			_update_status()
	elif sel_stage == "attack":
		if Stance.attack_targets(sel_card, player_cell, sel_move, 0).has(cell):
			_submit_turn(cell)

func _enter_attack_or_confirm() -> void:
	if Stance.attack_targets(sel_card, player_cell, sel_move, 0).is_empty():
		_submit_turn(Stance.NONE)
	else:
		sel_stage = "attack"

func _submit_turn(attack: Vector2i) -> void:
	var action := {"card": sel_card, "move": sel_move, "attack": attack}
	sel_card = ""
	sel_move = Stance.NONE
	sel_stage = ""
	_clear_nodes(highlight_nodes)
	_clear_nodes(warning_nodes)
	waiting = true
	_update_status()
	_resolve_turn(action)

# =======================================================================
# 回合结算
# =======================================================================

func _resolve_turn(action: Dictionary) -> void:
	var skill := _skill_now()
	var p_from := player_cell
	var p_to: Vector2i = action.move if action.move != Stance.NONE else player_cell
	var boss_from := boss_cell
	var boss_out := _resolve_blast(skill, p_from)
	var boss_to: Vector2i = boss_out.new_pos
	var boss_aoe: Array = boss_out.aoe

	var dmg := 2 if pending_double else 1
	pending_double = false

	var p_hits := Stance.hit_cells(action.card, p_from, p_to, 0, action.attack)
	var i_hit_boss: bool = not p_hits.is_empty() and action.attack != Stance.NONE and p_hits.has(boss_to)
	var boss_hit_me: bool = not Stance.is_dodge(action.card) and (boss_aoe as Array).has(p_to)

	if i_hit_boss: boss_hp -= dmg
	if boss_hit_me: player_hp -= 1
	player_cell = p_to
	boss_cell = boss_to
	if Stance.is_charge(action.card): pending_double = true
	if not seen_skills.has(skill):
		seen_skills.append(skill)
	skill_index += 1

	hand.erase(action.card)
	discard.append(action.card)
	hand.append(discard.pop_front())

	if player_hp <= 0 or boss_hp <= 0:
		winner = 0 if boss_hp <= 0 else 1
		phase = Phase.ENDED

	var line := "你[%s] vs Boss[%s]" % [Stance.LABEL[action.card], SKILL_LABELS.get(skill, "?")]
	if i_hit_boss: line += " · 命中 Boss！"
	if boss_hit_me: line += " · 被击中！"
	game_log.add(line)

	_animate_turn(skill, p_from, p_to, boss_from, boss_to, boss_aoe, i_hit_boss, boss_hit_me, dmg, action)

func _skill_now() -> String:
	return BOSS_SKILLS[skill_index % BOSS_SKILLS.size()]

func _skill_label() -> String:
	return SKILL_LABELS.get(_skill_now(), "?")

# =======================================================================
# 爆破 Boss AI
# =======================================================================

func _cardinal_opts(pos: Vector2i) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for d in Stance.CARDINALS:
		var c := pos + d
		if Stance.in_bounds(c): out.append(c)
	return out

func _bombard_aoe(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	var center := to + (to - from)
	var cells: Array[Vector2i] = []
	for c in Stance.filled_square(center, 1):
		if c != to: cells.append(c)
	return cells

func _resolve_blast(skill: String, player_from: Vector2i) -> Dictionary:
	var from := boss_cell
	match skill:
		"snipe":
			var use_row := from.x == player_from.x or (from.y != player_from.y and randf() < 0.5)
			var aoe := Stance.full_row(from.x) if use_row else Stance.full_col(from.y)
			return {"new_pos": from, "aoe": aoe}
		"bombard":
			var opts := _cardinal_opts(from)
			if opts.is_empty(): opts = [from]
			var best := from
			var best_hits := -1
			for to in opts:
				var a := _bombard_aoe(from, to)
				var hits := (a as Array).count(player_from)
				if hits > best_hits: best_hits = hits; best = to
			return {"new_pos": best, "aoe": _bombard_aoe(from, best)}
		_:  # burst
			return {"new_pos": from, "aoe": Stance.filled_square(from, 1)}
	return {"new_pos": from, "aoe": [] as Array[Vector2i]}

# =======================================================================
# 动画与表现
# =======================================================================

func _animate_turn(skill: String, p_from: Vector2i, p_to: Vector2i, boss_from: Vector2i, boss_to: Vector2i,
		boss_aoe: Array, i_hit: bool, boss_hit_me: bool, dmg: int, action: Dictionary) -> void:
	var p_world := _cell_world(p_to)
	# 各技能独立处理 Boss 移动 + 演出
	match skill:
		"snipe":
			if boss_from != boss_to:
				var bt := boss_node.create_tween()
				bt.tween_property(boss_node, "global_position", _cell_world(boss_to), 0.3) \
					.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
			_boss_play("Throw")
			var muzzle := _cell_world(boss_to) + Vector3(0, 0.9, 0)
			var far := _farthest_cell(boss_to, boss_aoe)
			_shoot_bullet(muzzle, _cell_world(far) + Vector3(0, 0.5, 0), Color("ffe066"))
			_flash_cells(boss_aoe, Color("e8623c"))
		"bombard":
			_do_bombard(boss_to, boss_aoe)
		"burst":
			_do_burst(boss_to, boss_aoe)
	# 命中 Boss 的反馈
	if i_hit:
		get_tree().create_timer(0.35).timeout.connect(func():
			Stage.float_text(boss_node, "-%d" % dmg, Vector3(0, 1.4, 0), Palette.WIN)
			Stage.hit_burst(boss_node, Vector3(0, 0.8, 0), Color("f2c14e"))
			_boss_play("Hit_A"), CONNECT_ONE_SHOT)
	if p_from != p_to:
		# 移动：朝向移动方向转身，摄像头跟随
		var dir := _cell_world(p_to) - _cell_world(p_from)
		player_model.rotation.y = atan2(-dir.x, -dir.z) + PI
		_set_cam_from_dir(dir)
		_play_anim("Run")
		var tw := player.create_tween()
		tw.tween_property(player, "global_position", p_world + Vector3(0, 0.1, 0), 0.3) \
			.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.tween_callback(_on_moved.bind(action, i_hit, boss_hit_me))
	else:
		player.global_position = p_world + Vector3(0, 0.1, 0)
		_on_moved(action, i_hit, boss_hit_me)

func _on_moved(action: Dictionary, i_hit: bool, boss_hit_me: bool) -> void:
	# 攻击：朝向攻击格（无攻击则朝向 Boss）转身，摄像头跟随
	var face_cell: Vector2i = action.attack if action.attack != Stance.NONE else boss_cell
	var to_target := _cell_world(face_cell) - player.global_position
	if to_target.length() > 0.01:
		player_model.rotation.y = atan2(-to_target.x, -to_target.z) + PI
		_set_cam_from_dir(to_target)
	# 攻击动画
	var card: String = action.card
	if Stance.is_dodge(card): _play_anim("Roll")
	elif Stance.is_charge(card): _play_anim("Jump")
	else: _play_anim("SwordSlash")
	# 受击
	if boss_hit_me:
		Stage.float_text(player, "-1", Vector3(0, 1.4, 0), Palette.LOSE)
		Stage.hit_burst(player, Vector3(0, 0.8, 0), Color("e8623c"))
		get_tree().create_timer(0.2).timeout.connect(
			func(): _play_anim("RecieveHit"), CONNECT_ONE_SHOT)
	Stage.shake(camera, 0.05 if (i_hit or boss_hit_me) else 0.01, 0.2)
	get_tree().create_timer(0.55).timeout.connect(_after_turn, CONNECT_ONE_SHOT)

func _after_turn() -> void:
	waiting = false
	_play_anim("Idle")
	_refresh_hand()
	_update_status()
	if phase == Phase.ENDED:
		_show_result()
	else:
		_refresh_warnings()

func _refresh_warnings() -> void:
	_clear_nodes(warning_nodes)
	var next_skill := _skill_now()
	if not seen_skills.has(next_skill): return
	for cell in _warning_cells(next_skill):
		warning_nodes.append(_overlay(cell, Color("f59e0b"), 0.18))

func _warning_cells(skill: String) -> Array[Vector2i]:
	match skill:
		"snipe":
			# 整行 + 整列（Boss 会选其一，全部标出）
			return Stance.dedupe(Stance.full_row(boss_cell.x) + Stance.full_col(boss_cell.y))
		"bombard":
			# 4 个方向的落点各自展开 3×3，全部标出
			var cells: Array[Vector2i] = []
			for d in Stance.CARDINALS:
				var boss_to: Vector2i = boss_cell + d
				if Stance.in_bounds(boss_to):
					cells.append_array(_bombard_aoe(boss_cell, boss_to))
			return Stance.dedupe(cells)
		_:  # burst
			return Stance.filled_square(boss_cell, 1)
	return []

func _show_result() -> void:
	var won := winner == 0
	var text := "Boss 已倒！" if won else "你倒下了…"
	Stage.float_text(self, text, player.global_position + Vector3(0, 3.0, 0),
		Palette.WIN if won else Palette.LOSE)
	game_log.add("—— %s ——" % text)
	restart_btn.visible = true
	if won:
		_play_anim("Victory")
		_boss_play("Death_A")
	else:
		_play_anim("Death")
		_boss_play("Idle_A")

# =======================================================================
# UI
# =======================================================================

func _build_battle_ui() -> void:
	canvas = CanvasLayer.new()
	add_child(canvas)

	status_label = Label.new()
	status_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label.add_theme_font_size_override("font_size", 18)
	status_label.add_theme_color_override("font_color", Palette.TEXT)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.anchor_right = 1.0
	status_label.offset_top = 12.0; status_label.offset_bottom = 40.0
	canvas.add_child(status_label)

	hp_label = Label.new()
	hp_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hp_label.add_theme_font_size_override("font_size", 16)
	hp_label.add_theme_color_override("font_color", Palette.ACCENT)
	hp_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hp_label.anchor_right = 1.0
	hp_label.offset_top = 42.0; hp_label.offset_bottom = 64.0
	canvas.add_child(hp_label)

	hand_bar = HBoxContainer.new()
	hand_bar.alignment = BoxContainer.ALIGNMENT_CENTER
	hand_bar.add_theme_constant_override("separation", 10)
	hand_bar.anchor_right = 1.0
	hand_bar.anchor_top = 1.0; hand_bar.anchor_bottom = 1.0
	hand_bar.offset_top = -70.0; hand_bar.offset_bottom = -14.0
	hand_bar.visible = false
	canvas.add_child(hand_bar)

	game_log = GameLog.new()
	game_log.anchor_bottom = 1.0
	game_log.offset_bottom = -90.0; game_log.offset_top = -240.0
	game_log.offset_left = 10.0; game_log.offset_right = 280.0
	canvas.add_child(game_log)

	restart_btn = Button.new()
	restart_btn.text = "再战"
	restart_btn.custom_minimum_size = Vector2(140, 44)
	restart_btn.anchor_left = 0.5; restart_btn.anchor_right = 0.5
	restart_btn.anchor_top = 1.0; restart_btn.anchor_bottom = 1.0
	restart_btn.offset_left = -70.0; restart_btn.offset_right = 70.0
	restart_btn.offset_top = -130.0; restart_btn.offset_bottom = -86.0
	restart_btn.visible = false
	restart_btn.pressed.connect(_on_restart)
	canvas.add_child(restart_btn)

	_build_deck_panel()

func _build_deck_panel() -> void:
	deck_panel = PanelContainer.new()
	deck_panel.anchor_left = 0.5; deck_panel.anchor_right = 0.5
	deck_panel.anchor_top = 0.5; deck_panel.anchor_bottom = 0.5
	deck_panel.offset_left = -200.0; deck_panel.offset_right = 200.0
	deck_panel.offset_top = -170.0; deck_panel.offset_bottom = 180.0
	canvas.add_child(deck_panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	deck_panel.add_child(vbox)

	var title := Label.new()
	title.text = "选择 5 个招式，进入世界探索"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 18)
	vbox.add_child(title)

	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	vbox.add_child(grid)
	for s in Stance.ALL:
		var b := Button.new()
		b.toggle_mode = true
		b.text = Stance.LABEL[s]
		b.custom_minimum_size = Vector2(64, 52)
		b.add_theme_font_size_override("font_size", 22)
		b.toggled.connect(func(_p): _update_deck_confirm())
		grid.add_child(b)
		deck_toggles[s] = b

	deck_confirm_btn = Button.new()
	deck_confirm_btn.text = "确认"
	deck_confirm_btn.custom_minimum_size = Vector2(0, 44)
	deck_confirm_btn.disabled = true
	deck_confirm_btn.pressed.connect(_on_deck_confirm)
	vbox.add_child(deck_confirm_btn)
	deck_panel.visible = false

func _update_deck_confirm() -> void:
	var count := 0
	for s in deck_toggles:
		if deck_toggles[s].button_pressed: count += 1
	for s in deck_toggles:
		deck_toggles[s].disabled = count >= 5 and not deck_toggles[s].button_pressed
	deck_confirm_btn.disabled = count != 5
	deck_confirm_btn.text = "确认" if count == 5 else "确认（%d/5）" % count

func _refresh_hand() -> void:
	for c in hand_bar.get_children(): c.queue_free()
	if phase != Phase.BATTLE: return
	for card in hand:
		var b := Button.new()
		b.text = Stance.LABEL[card]
		b.custom_minimum_size = Vector2(56, 48)
		b.add_theme_font_size_override("font_size", 22)
		b.pressed.connect(_on_card_pressed.bind(card))
		hand_bar.add_child(b)

func _update_status() -> void:
	match phase:
		Phase.FREE_ROAM:
			status_label.text = "WASD 移动 · 走近 Boss 触发战斗"
			hp_label.text = ""
		Phase.DECK_SELECT:
			status_label.text = "进入世界前，选择 5 个招式"
			hp_label.text = ""
		Phase.BATTLE:
			hp_label.text = "你 %d♥  ·  Boss %d♥" % [player_hp, boss_hp]
			if waiting: status_label.text = "结算中…"
			elif sel_stage == "move": status_label.text = "点击格子选择移动目标"
			elif sel_stage == "attack": status_label.text = "点击格子选择攻击目标"
			else: status_label.text = "选择招式出牌  [Boss 招式：%s]" % _skill_label()
		Phase.ENDED:
			hp_label.text = "你 %d♥  ·  Boss %d♥" % [player_hp, boss_hp]

func _on_restart() -> void:
	hand_bar.visible = false
	restart_btn.visible = false
	_clear_nodes(highlight_nodes)
	_init_battle()
