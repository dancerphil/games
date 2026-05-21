import type { WebSocket } from 'ws';
import type { GameType, Room } from './types.js';
import { send } from './send.js';
import * as ttt from './games/tic-tac-toe.js';
import * as es from './games/emperor-slave.js';
import * as nine from './games/nine.js';
import * as mt from './games/mine-texas.js';
import * as stance from './games/stance.js';
import * as bossBlast from './games/boss-blast.js';
import * as bossTornado from './games/boss-tornado.js';
import * as bossThunder from './games/boss-thunder.js';
import * as bossSpacetime from './games/boss-spacetime.js';
import * as bossTidal from './games/boss-tidal.js';
import * as bossSiege from './games/boss-siege.js';
import { triggerAiMove } from './ai.js';

const GAME_MODULES = { 'tic-tac-toe': ttt, 'emperor-slave': es, 'nine': nine, 'mine-texas': mt, 'stance': stance, 'boss-blast': bossBlast, 'boss-tornado': bossTornado, 'boss-thunder': bossThunder, 'boss-spacetime': bossSpacetime, 'boss-tidal': bossTidal, 'boss-siege': bossSiege };

const rooms = new Map<string, Room>();
const wsToRoom = new Map<unknown, string>();
const wsIsSpectator = new Set<WebSocket>();

const getStartData = (mod: Record<string, unknown>, room: Room): Record<string, unknown> => {
    if (typeof mod['getStartData'] === 'function') { return (mod['getStartData'] as (r: Room) => Record<string, unknown>)(room); } // eslint-disable-line @stylistic/max-statements-per-line
    return {};
};

const newRoomBase = () => ({
    totalScores: { p1Wins: 0, p2Wins: 0, draws: 0 },
    rematchRequests: [false, false],
});

export const handleCreate = (ws: WebSocket, nickname: string, game: GameType) => {
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();
    const mod = GAME_MODULES[game];
    const [hostRole] = mod.ROLES;
    const room: Room = {
        id, gameType: game, status: 'waiting',
        players: [{ ws, nickname, role: hostRole }],
        spectators: [],
        gameState: mod.initState(),
        ...newRoomBase(),
    };
    rooms.set(id, room);
    wsToRoom.set(ws, id);
    send(ws, { type: 'room_created', roomId: id, yourRole: hostRole });
};

export const handleCreateAiRoom = (ws: WebSocket, nickname: string, game: GameType) => {
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();
    const mod = GAME_MODULES[game];
    const aiWs = {} as unknown as WebSocket;
    const aiNickname = 'AI';
    const humanRole = mod.ROLES[0];
    const aiRole = mod.ROLES[1];
    const room: Room = {
        id, gameType: game, status: 'playing',
        players: [
            { ws, nickname, role: humanRole },
            { ws: aiWs, nickname: aiNickname, role: aiRole, isAI: true },
        ],
        spectators: [],
        gameState: mod.initState(),
        ...newRoomBase(),
    };
    rooms.set(id, room);
    wsToRoom.set(ws, id);
    wsToRoom.set(aiWs, id);
    send(ws, { type: 'room_created', roomId: id, yourRole: humanRole });
    send(ws, { type: 'game_start', opponentNickname: aiNickname, yourRole: humanRole, ...getStartData(mod, room) });
    if (game === 'stance') {
        void triggerAiMove(room);
    }
    if (game === 'boss-blast' || game === 'boss-tornado' || game === 'boss-thunder' || game === 'boss-spacetime' || game === 'boss-tidal' || game === 'boss-siege') {
        void triggerAiMove(room);
    }
};

export const handleJoin = (ws: WebSocket, roomId: string, nickname: string) => {
    const room = rooms.get(roomId);
    if (!room) {
        send(ws, { type: 'error', message: '房间不存在' });
        return;
    }
    if (room.status !== 'waiting') {
        send(ws, { type: 'error', message: '房间已满或游戏已开始' });
        return;
    }
    const guestRole = GAME_MODULES[room.gameType].ROLES[1];
    room.players.push({ ws, nickname, role: guestRole });
    room.status = 'playing';
    wsToRoom.set(ws, roomId);
    const host = room.players[0];
    send(ws, { type: 'room_joined', yourRole: guestRole, opponentNickname: host.nickname, ...getStartData(GAME_MODULES[room.gameType], room) });
    send(host.ws, { type: 'game_start', opponentNickname: nickname, yourRole: host.role, ...getStartData(GAME_MODULES[room.gameType], room) });
};

export const handleSpectate = (ws: WebSocket, roomId: string) => {
    const room = rooms.get(roomId);
    if (!room) {
        send(ws, { type: 'error', message: '房间不存在' });
        return;
    }
    room.spectators.push(ws);
    wsToRoom.set(ws, roomId);
    wsIsSpectator.add(ws);
    send(ws, {
        type: 'spectating',
        player1Nickname: room.players[0]?.nickname ?? '',
        player2Nickname: room.players[1]?.nickname ?? '',
        state: GAME_MODULES[room.gameType].getSpectateState(room),
    });
};

const updateScores = (room: Room) => {
    const result = GAME_MODULES[room.gameType].getResult(room);
    if (result === 'draw') {
        room.totalScores.draws++;
    }
    else {
        const key = result === 0 ? 'p1Wins' : 'p2Wins';
        room.totalScores[key]++;
    }
};

const startRematch = (room: Room) => {
    const mod = GAME_MODULES[room.gameType];
    if (room.gameType === 'emperor-slave') {
        const [p0, p1] = room.players;
        const temp = p0.role;
        p0.role = p1.role;
        p1.role = temp;
    }
    room.gameState = mod.initState();
    room.status = 'playing';
    room.rematchRequests = [false, false];
    room.players.forEach((p) => {
        send(p.ws, { type: 'rematch_start', yourRole: p.role, totalScores: room.totalScores });
    });
    room.spectators.forEach((s) => {
        send(s, { type: 'spectate_update', state: mod.getSpectateState(room) });
    });
    if (room.gameType === 'stance' && room.players.some(p => p.isAI)) {
        void triggerAiMove(room);
    }
};

export const handleRematch = (ws: WebSocket) => {
    const roomId = wsToRoom.get(ws);
    if (!roomId) { return; } // eslint-disable-line @stylistic/max-statements-per-line
    const room = rooms.get(roomId);
    if (!room || room.status !== 'ended') { return; } // eslint-disable-line @stylistic/max-statements-per-line
    const playerIdx = room.players.findIndex(p => p.ws === ws);
    if (playerIdx === -1) { return; } // eslint-disable-line @stylistic/max-statements-per-line
    room.rematchRequests[playerIdx] = true;
    room.players.forEach((p, i) => {
        send(p.ws, {
            type: 'rematch_update',
            myRequest: room.rematchRequests[i],
            opponentRequest: room.rematchRequests[1 - i],
        });
    });
    const hasAI = room.players.some(p => p.isAI);
    const bothReady = room.rematchRequests.every(r => r);
    if (bothReady || hasAI) {
        startRematch(room);
    }
};

export const handleMove = (ws: WebSocket | object, data: unknown) => {
    if (wsIsSpectator.has(ws as WebSocket)) { return; } // eslint-disable-line @stylistic/max-statements-per-line
    const roomId = wsToRoom.get(ws);
    if (!roomId) { return; } // eslint-disable-line @stylistic/max-statements-per-line
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') { return; } // eslint-disable-line @stylistic/max-statements-per-line
    const stateBefore = JSON.stringify(room.gameState);
    const ended = GAME_MODULES[room.gameType].handleMove(room, ws as WebSocket, data);
    if (ended) {
        room.status = 'ended';
        updateScores(room);
        return;
    }
    const stateChanged = JSON.stringify(room.gameState) !== stateBefore;
    const isAiMove = room.players.some(p => p.isAI && p.ws === ws);
    if (!stateChanged && !isAiMove) {
        send(ws as WebSocket, { type: 'error', message: '无效操作' });
        return;
    }
    if (stateChanged && !isAiMove) {
        void triggerAiMove(room);
    }
    if ((room.status as string) === 'ended') {
        updateScores(room);
    }
};

export const getRoomList = () =>
    [...rooms.values()]
        .filter(r => r.status !== 'ended' && !r.players.some(p => p.isAI))
        .map(r => ({
            id: r.id,
            gameType: r.gameType,
            status: r.status,
            player1Nickname: r.players[0]?.nickname ?? '',
            player2Nickname: r.players[1]?.nickname ?? '',
        }));

export const handleDisconnect = (ws: WebSocket) => {
    const roomId = wsToRoom.get(ws);
    wsToRoom.delete(ws);
    if (!roomId) { return; } // eslint-disable-line @stylistic/max-statements-per-line
    const room = rooms.get(roomId);
    if (!room) { return; } // eslint-disable-line @stylistic/max-statements-per-line
    if (wsIsSpectator.has(ws)) {
        wsIsSpectator.delete(ws);
        room.spectators = room.spectators.filter(s => s !== ws);
        return;
    }
    if (room.players.some(p => p.isAI)) {
        room.players.forEach((p) => {
            if (p.isAI && p.ws) { wsToRoom.delete(p.ws); } // eslint-disable-line @stylistic/max-statements-per-line
        });
    }
    rooms.delete(roomId);
    room.players.forEach((p) => {
        if (!p.isAI && p.ws !== ws && room.status !== 'ended') {
            send(p.ws, { type: 'opponent_left' });
        }
    });
    room.spectators.forEach((s) => {
        send(s, { type: 'opponent_left' });
        wsToRoom.delete(s);
        wsIsSpectator.delete(s);
    });
};
