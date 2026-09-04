import type { WebSocket } from 'ws';
import type { Room } from '../types.js';
import { send } from '../send.js';

export const BOARD_SIZE = 15;
export type Player = 'black' | 'white';
export type Cell = Player | null;
export type Board = Cell[];

export const ROLES: [string, string] = ['black', 'white'];

export interface GomokuState {
    board: Board;
    currentTurn: Player;
    winner: Player | null;
    winningLine: number[] | null;
    lastMove: number | null;
    modelId: string;
}

export const initState = (p: { modelId?: string } = {}): GomokuState => ({
    board: Array<Cell>(BOARD_SIZE * BOARD_SIZE).fill(null),
    currentTurn: 'black',
    winner: null,
    winningLine: null,
    lastMove: null,
    modelId: p.modelId ?? 'heuristic-v1',
});

const idx = (r: number, c: number) => r * BOARD_SIZE + c;

const checkWin = (board: Board, pos: number, player: Player): number[] | null => {
    const r = Math.floor(pos / BOARD_SIZE);
    const c = pos % BOARD_SIZE;
    const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
        const line: number[] = [pos];
        for (let step = 1; step < 5; step++) {
            const nr = r + dr * step;
            const nc = c + dc * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) { break; }
            const p = idx(nr, nc);
            if (board[p] !== player) { break; }
            line.push(p);
        }
        for (let step = 1; step < 5; step++) {
            const nr = r - dr * step;
            const nc = c - dc * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) { break; }
            const p = idx(nr, nc);
            if (board[p] !== player) { break; }
            line.unshift(p);
        }
        if (line.length >= 5) {
            for (let i = 0; i <= line.length - 5; i++) {
                const seg = line.slice(i, i + 5);
                if (seg.includes(pos)) { return seg; }
            }
            return line.slice(0, 5);
        }
    }
    return null;
};

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as GomokuState;
    if (state.winner) { return false; }
    const { row, col } = data as { row: number; col: number };
    if (typeof row !== 'number' || typeof col !== 'number') { return false; }
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) { return false; }
    const pos = idx(row, col);
    if (state.board[pos] !== null) { return false; }
    const mover = room.players.find(p => p.ws === ws);
    if (!mover || mover.role !== state.currentTurn) { return false; }

    state.board[pos] = state.currentTurn;
    state.lastMove = pos;

    const winLine = checkWin(state.board, pos, state.currentTurn);
    if (winLine) {
        state.winner = state.currentTurn;
        state.winningLine = winLine;
        const moveMsg = { type: 'move', row, col, player: state.currentTurn, lastMove: pos };
        room.players.forEach((p) => { send(p.ws, moveMsg); });
        room.spectators.forEach((s) => { send(s, moveMsg); });
        const overMsg = { type: 'game_over', winner: state.winner, winningLine: winLine };
        room.players.forEach((p) => { send(p.ws, overMsg); });
        room.spectators.forEach((s) => { send(s, overMsg); });
        return true;
    }

    const isDraw = state.board.every(c => c !== null);
    const moveMsg = { type: 'move', row, col, player: state.currentTurn, lastMove: pos };
    room.players.forEach((p) => { send(p.ws, moveMsg); });
    room.spectators.forEach((s) => { send(s, moveMsg); });

    if (isDraw) {
        const overMsg = { type: 'game_over', winner: null, winningLine: null };
        room.players.forEach((p) => { send(p.ws, overMsg); });
        room.spectators.forEach((s) => { send(s, overMsg); });
        return true;
    }

    state.currentTurn = state.currentTurn === 'black' ? 'white' : 'black';
    return false;
};

export const getSpectateState = (room: Room): unknown => {
    const s = room.gameState as GomokuState;
    return { board: s.board, currentTurn: s.currentTurn, winner: s.winner, winningLine: s.winningLine, lastMove: s.lastMove, modelId: s.modelId };
};

export const getResult = (room: Room): number | 'draw' => {
    const s = room.gameState as GomokuState;
    if (!s.winner) { return 'draw'; }
    return room.players.findIndex(p => p.role === s.winner);
};
