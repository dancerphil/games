import type { Room } from './types.js';
import { getAiMove as getTttAiMove } from './games/tic-tac-toe-ai.js';
import { getAiMove as getEsAiMove } from './games/emperor-slave-ai.js';
import { getAiMove as getNineAiMove } from './games/nine-ai.js';
import { getAiMove as getMtAiMove } from './games/mine-texas-ai.js';
import { getAiDeckSelect as getStanceAiDeckSelect, getAiMove as getStanceAiMove } from './games/stance-ai.js';
import { GAME_MODULES } from './games/registry.js';

export const triggerAiMove = async (room: Room): Promise<void> => {
    if (room.gameType === 'boss-blast' || room.gameType === 'boss-tornado' || room.gameType === 'boss-thunder' || room.gameType === 'boss-spacetime' || room.gameType === 'boss-tidal' || room.gameType === 'boss-siege') { return; }
    const aiPlayer = room.players.find(p => p.isAI);
    if (!aiPlayer) { return; }
    const game = room.gameType;
    const aiIdx = room.players.indexOf(aiPlayer);
    let aiData: object | null = null;
    if (game === 'tic-tac-toe') {
        const state = room.gameState as { board: (('X' | 'O') | null)[]; currentTurn: 'X' | 'O' };
        aiData = getTttAiMove({ board: state.board, currentTurn: state.currentTurn, role: aiPlayer.role });
    }
    else if (game === 'emperor-slave') {
        const state = room.gameState as { hands: [{ king: number; commoner: number; slave: number }, { king: number; commoner: number; slave: number }] };
        const aiRoleIdx = aiPlayer.role === 'king_side' ? 0 : 1;
        const hand = state.hands[aiRoleIdx];
        aiData = getEsAiMove({ hand });
    }
    else if (game === 'nine') {
        const state = room.gameState as { hands: [number[], number[]] };
        const hand = aiIdx === 0 ? state.hands[0] : state.hands[1];
        aiData = getNineAiMove({ hand });
    }
    else if (game === 'mine-texas') {
        const state = room.gameState as { hands: [number[], number[]] };
        const hand = aiIdx === 0 ? state.hands[0] : state.hands[1];
        const oppHand = aiIdx === 0 ? state.hands[1] : state.hands[0];
        try {
            aiData = getMtAiMove({ hand, opponentHand: oppHand });
        }
        catch (e) {
            console.error('mine-texas AI error:', e);
        }
    }
    else if (game === 'stance') {
        const state = room.gameState as { phase: string; handStates: { hand: string[]; deckSelected: boolean }[]; positions: [{ row: number; col: number }, { row: number; col: number }] };
        if (state.phase === 'deck_selection' && !state.handStates[aiIdx].deckSelected) {
            aiData = getStanceAiDeckSelect();
        }
        else if (state.phase === 'playing') {
            aiData = getStanceAiMove({ hand: state.handStates[aiIdx].hand as import('./games/stance.js').StanceName[], positions: state.positions, pi: aiIdx });
        }
    }
    if (aiData) {
        const ended = GAME_MODULES[game].handleMove(room, aiPlayer.ws, aiData);
        if (ended) {
            room.status = 'ended';
        }
    }
};
