import type { WebSocket } from 'ws';
import { send } from './send.js';

// 游戏无关的「笨中转」房间：服务器只按房间转发消息，不理解任何游戏规则。
// 房主（host）持有权威游戏逻辑（在 Godot 客户端里），服务器仅负责 host↔guest 之间的透传。

interface RelayRoom {
    id: string;
    host: WebSocket;
    guest: WebSocket | null;
}

const relayRooms = new Map<string, RelayRoom>();
const wsToRelayRoom = new Map<WebSocket, string>();

const peerOf = (room: RelayRoom, ws: WebSocket): WebSocket | null => {
    if (ws === room.host) { return room.guest; }
    if (ws === room.guest) { return room.host; }
    return null;
};

export const handleRelayCreate = (ws: WebSocket) => {
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();
    relayRooms.set(id, { id, host: ws, guest: null });
    wsToRelayRoom.set(ws, id);
    send(ws, { type: 'relay_created', roomId: id, role: 'host' });
};

export const handleRelayJoin = (ws: WebSocket, roomId: string) => {
    const room = relayRooms.get(roomId);
    if (!room) {
        send(ws, { type: 'relay_error', message: '房间不存在' });
        return;
    }
    if (room.guest) {
        send(ws, { type: 'relay_error', message: '房间已满' });
        return;
    }
    room.guest = ws;
    wsToRelayRoom.set(ws, roomId);
    send(ws, { type: 'relay_joined', roomId, role: 'guest' });
    send(room.host, { type: 'relay_peer_joined' });
};

export const handleRelayMessage = (ws: WebSocket, payload: unknown) => {
    const roomId = wsToRelayRoom.get(ws);
    if (!roomId) { return; }
    const room = relayRooms.get(roomId);
    if (!room) { return; }
    const peer = peerOf(room, ws);
    if (peer) { send(peer, { type: 'relay', payload }); }
};

export const getRelayRoomList = () =>
    [...relayRooms.values()]
        .filter(r => r.guest === null)
        .map(r => ({ id: r.id }));

export const handleRelayDisconnect = (ws: WebSocket): boolean => {
    const roomId = wsToRelayRoom.get(ws);
    if (!roomId) { return false; }
    wsToRelayRoom.delete(ws);
    const room = relayRooms.get(roomId);
    if (!room) { return true; }
    if (ws === room.host) {
        if (room.guest) {
            send(room.guest, { type: 'relay_peer_left' });
            wsToRelayRoom.delete(room.guest);
        }
        relayRooms.delete(roomId);
    }
    else if (ws === room.guest) {
        room.guest = null;
        send(room.host, { type: 'relay_peer_left' });
    }
    return true;
};
