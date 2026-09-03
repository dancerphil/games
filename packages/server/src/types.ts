import type { WebSocket } from 'ws';
import type { GameType } from '@games/shared';

export type { GameType };

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
