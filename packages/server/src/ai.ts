import type { Room } from './types.js';
import { getAiMove as getTttAiMove } from './games/tic-tac-toe-ai.js';
import { getAiMove as getEsAiMove } from './games/emperor-slave-ai.js';
import { getAiMove as getNineAiMove } from './games/nine-ai.js';
import * as ttt from './games/tic-tac-toe.js';
import * as es from './games/emperor-slave.js';
import * as nine from './games/nine.js';

const GAME_MODULES = { 'tic-tac-toe': ttt, 'emperor-slave': es, 'nine': nine };

export const triggerAiMove = (room: Room) => {
    const aiPlayer = room.players.find(p => p.isAI);
    if (!aiPlayer) {
        return;
    }
    const game = room.gameType;
    const aiIdx = room.players.indexOf(aiPlayer);
    let aiData: object | null = null;
    if (game === 'tic-tac-toe') {
        const state = room.gameState as { board: (('X' | 'O') | null)[]; currentTurn: 'X' | 'O' };
        aiData = getTttAiMove({ board: state.board, currentTurn: state.currentTurn, role: aiPlayer.role });
    }
    else if (game === 'emperor-slave') {
        const state = room.gameState as { hands: [{ king: number; commoner: number; slave: number }, { king: number; commoner: number; slave: number }] };
        const hand = aiIdx === 0 ? state.hands[0] : state.hands[1];
        aiData = getEsAiMove({ hand });
    }
    else if (game === 'nine') {
        const state = room.gameState as { hands: [number[], number[]] };
        const hand = aiIdx === 0 ? state.hands[0] : state.hands[1];
        aiData = getNineAiMove({ hand });
    }
    if (aiData) {
        const ended = GAME_MODULES[game].handleMove(room, aiPlayer.ws, aiData);
        if (ended) {
            room.status = 'ended';
        }
    }
};
