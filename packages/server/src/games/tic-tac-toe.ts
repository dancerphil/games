import type { WebSocket } from 'ws';
import type { Room } from '../types.js';
import { send } from '../send.js';

type Player = 'X' | 'O';
type Board = (Player | null)[];

interface TttState {
    board: Board;
    currentTurn: Player;
}

export const ROLES: [string, string] = ['X', 'O'];

export const initState = (): TttState => ({
    board: Array<Player | null>(9).fill(null),
    currentTurn: 'X',
});

const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

const getWinner = (board: Board): Player | null => {
    for (const [a, b, c] of WIN_LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a] as Player;
        }
    }
    return null;
};

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as TttState;
    const position = (data as { position: number }).position;
    const mover = room.players.find(p => p.ws === ws);
    if (!mover || mover.role !== state.currentTurn) { return false; } // eslint-disable-line @stylistic/max-statements-per-line
    if (state.board[position] !== null) { return false; } // eslint-disable-line @stylistic/max-statements-per-line

    state.board[position] = state.currentTurn;
    const moveMsg = { type: 'move', position, player: state.currentTurn };
    room.players.forEach((p) => { send(p.ws, moveMsg); }); // eslint-disable-line @stylistic/max-statements-per-line
    room.spectators.forEach((s) => { send(s, moveMsg); }); // eslint-disable-line @stylistic/max-statements-per-line

    const winner = getWinner(state.board);
    const isDraw = !winner && state.board.every(c => c !== null);
    if (winner ?? isDraw) {
        const overMsg = { type: 'game_over', winner: winner ?? null };
        room.players.forEach((p) => { send(p.ws, overMsg); });
        room.spectators.forEach((s) => { send(s, overMsg); });
        return true;
    }
    state.currentTurn = state.currentTurn === 'X' ? 'O' : 'X';
    return false;
};

export const getSpectateState = (room: Room): unknown => {
    const state = room.gameState as TttState;
    return { board: state.board, currentTurn: state.currentTurn };
};

export const getResult = (room: Room): number | 'draw' => {
    const state = room.gameState as TttState;
    const winner = getWinner(state.board);
    if (winner === null) { return 'draw'; }
    return room.players.findIndex(p => p.role === winner);
};
