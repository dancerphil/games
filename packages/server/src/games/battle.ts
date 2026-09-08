import type { WebSocket } from 'ws';
import { send } from '../send.js';
import { gomokuEngine } from './gomoku-engine.js';
import { BOARD_SIZE, checkWin } from './gomoku.js';
import type { Board, Player } from './gomoku.js';

export const handleBattleStart = async (ws: WebSocket, data: unknown) => {
    const { blackModel, whiteModel, numGames, timeLimitMs } = data as { blackModel: string; whiteModel: string; numGames: number; timeLimitMs?: number };
    const n = Math.min(Math.max(1, Math.floor(numGames || 1)), 20);
    const timeLimit = Math.min(Math.max(100, Math.floor(timeLimitMs || 500)), 5000);
    const models = await gomokuEngine.listModels();
    if (!models.includes(blackModel) || !models.includes(whiteModel)) {
        send(ws, { type: 'battle_error', message: `unknown model, available: ${models.join(', ')}` });
        return;
    }
    send(ws, { type: 'battle_started', blackModel, whiteModel, numGames: n });
    // use faster time for battle to allow many games
    await gomokuEngine.setTimeLimit(timeLimit);

    let blackWins = 0, whiteWins = 0, draws = 0;

    for (let gameIndex = 0; gameIndex < n; gameIndex++) {
        if (ws.readyState !== ws.OPEN) break;
        const board: (string | null)[] = Array(BOARD_SIZE * BOARD_SIZE).fill(null);
        let current: 'black' | 'white' = 'black';
        let winner: string | null = null;
        const history: { row: number; col: number; player: string }[] = [];

        send(ws, { type: 'battle_game_started', gameIndex, blackModel, whiteModel });

        for (let moveNum = 0; moveNum < BOARD_SIZE * BOARD_SIZE; moveNum++) {
            if (ws.readyState !== ws.OPEN) break;
            const model = current === 'black' ? blackModel : whiteModel;
            // for battle use faster time to allow many games; still respect engine's global but override via direct call with custom time
            // we call engine with custom time by temporarily setting timeLimit via direct mcts call? For now use engine's getMove which respects global 2000, but we can call with custom time by using getMove with time param if we extend engine
            // To keep simple, we will call engine.getMoveWithTime if available, else use default and rely on engine's set_time_limit
            const { row, col } = await gomokuEngine.getMove(board as (string | null)[], current, model);
            const pos = row * BOARD_SIZE + col;
            if (board[pos] !== null) {
                // should not happen, skip
                break;
            }
            board[pos] = current;
            history.push({ row, col, player: current });

            const winLine = checkWin(board as Board, pos, current as Player);
            send(ws, {
                type: 'battle_move',
                gameIndex,
                move: { row, col, player: current },
                board: [...board],
                history: [...history],
                isWin: winLine !== null,
            });

            if (winLine) {
                winner = current;
                if (current === 'black') blackWins++; else whiteWins++;
                send(ws, { type: 'battle_game_over', gameIndex, winner, winningLine: winLine, history, board: [...board] });
                break;
            }
            if (board.every(c => c !== null)) {
                draws++;
                send(ws, { type: 'battle_game_over', gameIndex, winner: null, winningLine: null, history, board: [...board] });
                break;
            }
            current = current === 'black' ? 'white' : 'black';
            // small delay to allow frontend to render
            await new Promise(r => setTimeout(r, 50));
        }
        // brief pause between games
        await new Promise(r => setTimeout(r, 300));
    }

    await gomokuEngine.setTimeLimit(2000);
    send(ws, {
        type: 'battle_finished',
        blackModel,
        whiteModel,
        numGames: n,
        results: { blackWins, whiteWins, draws },
    });
};
