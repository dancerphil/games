import type { WebSocket } from 'ws';
import type { Room } from '../types.js';
import { send } from '../send.js';

interface NineRound {
    round: number;
    p1Card: number;
    p2Card: number;
    p1Gained: number;
    p2Gained: number;
}

interface NineState {
    round: number;
    hands: [number[], number[]];
    scores: [number, number];
    pending: [number | null, number | null];
    history: NineRound[];
    winner: 'player1' | 'player2' | 'draw' | null;
}

export const ROLES: [string, string] = ['player1', 'player2'];

export const initState = (): NineState => ({
    round: 1,
    hands: [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    scores: [0, 0],
    pending: [null, null],
    history: [],
    winner: null,
});

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as NineState;
    const card = (data as { card: number }).card;
    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx === -1 || state.pending[idx] !== null) { return false; } // eslint-disable-line @stylistic/max-statements-per-line
    if (!state.hands[idx].includes(card)) { return false; } // eslint-disable-line @stylistic/max-statements-per-line

    state.hands[idx] = state.hands[idx].filter(c => c !== card);
    state.pending[idx] = card;

    if (state.pending[0] === null || state.pending[1] === null) { return false; } // eslint-disable-line @stylistic/max-statements-per-line

    const [c1, c2] = state.pending as [number, number];
    state.pending = [null, null];

    const sum = c1 + c2;
    const p1Gained = c1 > c2 ? sum : 0;
    const p2Gained = c2 > c1 ? sum : 0;
    state.scores[0] += p1Gained;
    state.scores[1] += p2Gained;

    const round: NineRound = { round: state.round, p1Card: c1, p2Card: c2, p1Gained, p2Gained };
    state.history.push(round);

    const gameOver = state.round === 9;
    if (gameOver) {
        if (state.scores[0] > state.scores[1]) {
            state.winner = 'player1';
        }
        else if (state.scores[1] > state.scores[0]) {
            state.winner = 'player2';
        }
        else {
            state.winner = 'draw';
        }
    }
    else {
        state.round++;
    }

    room.players.forEach((p, i) => {
        const opponentIdx = 1 - i;
        const myWinner = !gameOver ? undefined
            : state.winner === 'draw' ? 'draw'
                : state.winner === (i === 0 ? 'player1' : 'player2') ? 'you' : 'opponent';
        send(p.ws, {
            type: 'round_result',
            round: round.round,
            yourCard: i === 0 ? c1 : c2,
            opponentCard: i === 0 ? c2 : c1,
            scoreGained: i === 0 ? p1Gained : p2Gained,
            yourTotal: state.scores[i],
            opponentTotal: state.scores[opponentIdx],
            gameOver,
            winner: myWinner,
        });
    });
    room.spectators.forEach((s) => {
        send(s, { type: 'spectate_update', state: getSpectateState(room) });
    });
    return gameOver;
};

export const getSpectateState = (room: Room): unknown => {
    const st = room.gameState as NineState;
    return { round: st.round, hands: st.hands, scores: st.scores, history: st.history, winner: st.winner };
};

export const getResult = (room: Room): number | 'draw' => {
    const st = room.gameState as NineState;
    if (st.winner === null || st.winner === 'draw') { return 'draw'; } // eslint-disable-line @stylistic/max-statements-per-line
    return st.winner === 'player1' ? 0 : 1;
};
