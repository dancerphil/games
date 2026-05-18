import type { WebSocket } from 'ws';
import type { CoreMessage } from 'ai';
import type { Room } from '../types.js';
import { send } from '../send.js';

export const ROLES: [string, string] = ['answerer', 'questioner'];
export const MAX_ROUNDS = 15;

export interface GuessState {
    round: number;
    ended: boolean;
    llmMessages: CoreMessage[];
}

export const initState = (): GuessState => ({
    round: 0,
    ended: false,
    llmMessages: [],
});

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as GuessState;
    if (state.ended) { return true; }
    const { text } = data as { text: string };
    const mover = room.players.find(p => p.ws === ws);
    if (!mover) { return false; }

    if (room.players.some(p => p.isAI)) {
        state.llmMessages.push({ role: 'user', content: text });
    }

    room.players.filter(p => !p.isAI).forEach(p => {
        send(p.ws, { type: 'guess_message', role: mover.role, text });
    });

    if (mover.role === 'questioner') {
        state.round++;
    }

    return false;
};

export const broadcastAiText = (room: Room, text: string, ended: boolean): void => {
    room.players.filter(p => !p.isAI).forEach(p => {
        send(p.ws, { type: 'guess_message', role: 'ai', text, ended });
    });
    if (ended) {
        (room.gameState as GuessState).ended = true;
        room.status = 'ended';
    }
};

export const getSpectateState = (room: Room): unknown => room.gameState;
export const getResult = (_room: Room): 'draw' | 0 | 1 => 'draw';
