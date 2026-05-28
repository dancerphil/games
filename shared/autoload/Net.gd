extends Node
## 共享网络层：连到 Node server 的「笨中转」通道，做房主权威的联机。
## 服务器只转发 host↔guest 的消息；游戏规则由房主端自己跑。
## 类比 web 端的 useGameRoom，但这里只负责传输与房间生命周期，不含任何游戏逻辑。
##
## 未来可把传输从 WebSocket 换成 WebRTC P2P（服务器退化为信令）而不改游戏代码：
## 只要保持 room_created / peer_joined / message / peer_left 这组信号语义不变。

signal connected
signal disconnected
signal room_created(room_id: String)
signal room_joined(room_id: String)
signal peer_joined
signal peer_left
signal message(payload: Dictionary)
signal net_error(text: String)

const DEFAULT_URL := "ws://localhost:8791/ws"
const HTTP_BASE := "http://localhost:8791"

var role := ""  # "host" / "guest" / ""
var room_id := ""

var _socket: WebSocketPeer = null
var _was_open := false
var _pending: Array[Dictionary] = []  # 连接建立前缓存的待发消息

func connect_to_server(url: String = DEFAULT_URL) -> void:
	_reset()
	_socket = WebSocketPeer.new()
	var error := _socket.connect_to_url(url)
	if error != OK:
		net_error.emit("无法连接服务器")
		_socket = null

func create_room() -> void:
	_send_raw({"type": "relay_create"})

func join_room(code: String) -> void:
	_send_raw({"type": "relay_join", "roomId": code.strip_edges().to_upper()})

## 发送一条游戏消息给房间里的另一端（经服务器透传）。
func send_payload(payload: Dictionary) -> void:
	_send_raw({"type": "relay", "payload": payload})

func close() -> void:
	if _socket:
		_socket.close()
	_reset()

func _process(_delta: float) -> void:
	if _socket == null:
		return
	_socket.poll()
	var state := _socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			connected.emit()
			_flush_pending()
		while _socket.get_available_packet_count() > 0:
			_handle_packet(_socket.get_packet().get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED:
		if _was_open:
			_was_open = false
			disconnected.emit()
		_socket = null

func _handle_packet(text: String) -> void:
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var data: Dictionary = parsed
	match data.get("type", ""):
		"relay_created":
			role = "host"
			room_id = data.get("roomId", "")
			room_created.emit(room_id)
		"relay_joined":
			role = "guest"
			room_id = data.get("roomId", "")
			room_joined.emit(room_id)
		"relay_peer_joined":
			peer_joined.emit()
		"relay_peer_left":
			peer_left.emit()
		"relay":
			var payload: Variant = data.get("payload")
			if typeof(payload) == TYPE_DICTIONARY:
				message.emit(payload)
		"relay_error":
			net_error.emit(data.get("message", "网络错误"))

func _send_raw(data: Dictionary) -> void:
	if _socket and _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_socket.send_text(JSON.stringify(data))
	else:
		_pending.append(data)

func _flush_pending() -> void:
	for data in _pending:
		_socket.send_text(JSON.stringify(data))
	_pending.clear()

func fetch_relay_rooms(callback: Callable) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
		http.queue_free()
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			callback.call([])
			return
		var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
		callback.call(parsed if typeof(parsed) == TYPE_ARRAY else [])
	)
	http.request(HTTP_BASE + "/api/relay-rooms")

func _reset() -> void:
	role = ""
	room_id = ""
	_was_open = false
	_pending.clear()
