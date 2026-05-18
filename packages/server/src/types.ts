import type { WebSocket } from 'ws';

export type GameType = 'tic-tac-toe' | 'emperor-slave' | 'nine';

export interface PlayerState {
    ws: WebSocket;
    nickname: string;
    role: string;
    isAI?: boolean;
}

export interface Room {
    id: string;
    gameType: GameType;
    status: 'waiting' | 'playing' | 'ended';
    players: PlayerState[];
    spectators: WebSocket[];
    gameState: unknown;
    rematchRequests: boolean[];
    totalScores: { p1Wins: number; p2Wins: number; draws: number };
}
