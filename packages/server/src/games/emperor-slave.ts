import type { WebSocket } from 'ws';
import type { Room } from '../types.js';
import { send } from '../send.js';

export type ESCard = 'king' | 'commoner' | 'slave';

interface Hand { king: number; commoner: number; slave: number }

interface ESRound {
    round: number;
    kingSideCard: ESCard;
    slaveSideCard: ESCard;
    outcome: 'slave_wins' | 'king_wins' | 'continues';
}

interface ESState {
    round: number;
    hands: [Hand, Hand];
    pending: [ESCard | null, ESCard | null];
    history: ESRound[];
    winner: 'king_side' | 'slave_side' | null;
}

export const ROLES: [string, string] = ['king_side', 'slave_side'];

export const initState = (): ESState => ({
    round: 1,
    hands: [
        { king: 1, commoner: 4, slave: 0 },
        { king: 0, commoner: 4, slave: 1 },
    ],
    pending: [null, null],
    history: [],
    winner: null,
});

const resolveOutcome = (k: ESCard, s: ESCard): ESRound['outcome'] => {
    if (s === 'slave' && k === 'king') {
        return 'slave_wins';
    }
    if (k === 'commoner' && s === 'slave') {
        return 'king_wins';
    }
    if (k === 'king' && s === 'commoner') {
        return 'king_wins';
    }
    return 'continues';
};

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as ESState;
    const card = (data as { card: ESCard }).card;
    const player = room.players.find(p => p.ws === ws);
    if (!player) { return false; }
    const roleIdx = player.role === 'king_side' ? 0 : 1;
    if (state.pending[roleIdx] !== null) {
        return false;
    }
    const hand = state.hands[roleIdx];
    if (hand[card] <= 0) {
        return false;
    }

    hand[card]--;
    state.pending[roleIdx] = card;

    if (state.pending[0] === null || state.pending[1] === null) {
        return false;
    }

    const [kCard, sCard] = state.pending as [ESCard, ESCard];
    state.pending = [null, null];

    const outcome = resolveOutcome(kCard, sCard);
    const isLast = state.round === 5;
    const gameOver = outcome !== 'continues' || isLast;
    const roundWinner: ESState['winner'] = outcome === 'slave_wins' ? 'slave_side' : (gameOver ? 'king_side' : null);

    state.history.push({ round: state.round, kingSideCard: kCard, slaveSideCard: sCard, outcome });
    if (gameOver) {
        state.winner = roundWinner ?? 'king_side';
    }
    else {
        state.round++;
    }

    room.players.forEach((p) => {
        const pRoleIdx = p.role === 'king_side' ? 0 : 1;
        send(p.ws, {
            type: 'round_result',
            round: state.history[state.history.length - 1].round,
            yourCard: pRoleIdx === 0 ? kCard : sCard,
            opponentCard: pRoleIdx === 0 ? sCard : kCard,
            outcome,
            gameOver,
            winner: gameOver ? state.winner : undefined,
        });
    });
    room.spectators.forEach((s) => {
        send(s, { type: 'spectate_update', state: getSpectateState(room) });
    });
    return gameOver;
};

export const getSpectateState = (room: Room): unknown => {
    const st = room.gameState as ESState;
    return { round: st.round, hands: st.hands, history: st.history, winner: st.winner };
};

export const getResult = (room: Room): number | 'draw' => {
    const st = room.gameState as ESState;
    if (!st.winner) {
        return 'draw';
    }
    return room.players.findIndex(p => p.role === st.winner);
};
