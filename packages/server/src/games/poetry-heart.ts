import type { WebSocket } from 'ws';
import type { Room } from '../types.js';
import { send } from '../send.js';
import { PoetryHeart } from '@games/shared';
import type { PoetryHeartState } from '@games/shared';
const { createInitialSlips } = PoetryHeart;

export const ROLES: [string, string] = ['player', 'player'];

export const initState = (): PoetryHeartState => ({
    slips: createInitialSlips({ seed: Date.now() }),
    collected: [],
});

export const getStartData = (room: Room): Record<string, unknown> => ({
    state: room.gameState,
});

export const getSpectateState = (room: Room): unknown => room.gameState;

export const getResult = (_room: Room): number | 'draw' => 'draw';

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as PoetryHeartState;
    const raw = data as { type?: string; data?: unknown; slipId?: string; slip?: unknown; x?: number; y?: number; poemId?: string };
    const msg = (raw.data as { type?: string; slipId?: string; slip?: unknown; x?: number; y?: number; poemId?: string } | undefined) ?? raw;
    if (msg.type === 'pick') {
        const idx = state.slips.findIndex((s: PoetryHeartState['slips'][number]) => s.id === msg.slipId);
        if (idx === -1) {
            send(ws, { type: 'error', message: '竹简已被取走' });
            return false;
        }
        const [removed] = state.slips.splice(idx, 1);
        const payload = { type: 'desk_remove', slipId: removed!.id };
        room.players.forEach((p) => { if (p.ws !== ws) { send(p.ws, payload); } });
        room.spectators.forEach(s => send(s, payload));
        send(ws, { type: 'pick_ok', slipId: removed!.id });
        return false;
    }
    if (msg.type === 'drop') {
        const slip = msg.slip as PoetryHeartState['slips'][number];
        if (!slip?.id) { return false; }
        if (state.slips.some((s: PoetryHeartState['slips'][number]) => s.id === slip.id)) { return false; }
        const placed = { ...slip, x: msg.x ?? slip.x, y: msg.y ?? slip.y, r: (Math.random() - 0.5) * 16 };
        state.slips.push(placed);
        const payload = { type: 'desk_add', slip: placed };
        room.players.forEach((p) => { if (p.ws !== ws) { send(p.ws, payload); } });
        room.spectators.forEach(s => send(s, payload));
        send(ws, { type: 'drop_ok', slip: placed });
        return false;
    }
    if (msg.type === 'collect') {
        const pid = msg.poemId;
        if (!pid || state.collected.includes(pid)) { return false; }
        state.slips = state.slips.filter((s: PoetryHeartState['slips'][number]) => s.poemId !== pid);
        state.collected.push(pid);
        const payload = { type: 'collected', poemId: pid, collected: state.collected };
        room.players.forEach(p => send(p.ws, payload));
        room.spectators.forEach(s => send(s, payload));
        if (state.collected.length >= 50) {
            const over = { type: 'game_over', collected: state.collected };
            room.players.forEach(p => send(p.ws, over));
            room.spectators.forEach(s => send(s, over));
            return true;
        }
        return false;
    }
    return false;
};
