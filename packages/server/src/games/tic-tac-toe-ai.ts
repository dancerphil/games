type Player = 'X' | 'O';
type Board = (Player | null)[];

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

const minimax = (board: Board, isMaximizing: boolean, alpha: number, beta: number, depth: number): number => {
    const winner = getWinner(board);
    if (winner === 'O') {
        return 10 - depth;
    }
    if (winner === 'X') {
        return depth - 10;
    }
    if (board.every(cell => cell !== null)) {
        return 0;
    }

    if (isMaximizing) {
        let best = -Infinity;
        let currentAlpha = alpha;
        for (let i = 0; i < 9; i++) {
            if (board[i] === null) {
                board[i] = 'O';
                const score = minimax(board, false, currentAlpha, beta, depth + 1);
                board[i] = null;
                best = Math.max(best, score);
                currentAlpha = Math.max(currentAlpha, best);
                if (beta <= currentAlpha) {
                    break;
                }
            }
        }
        return best;
    }

    let best = Infinity;
    let currentBeta = beta;
    for (let i = 0; i < 9; i++) {
        if (board[i] === null) {
            board[i] = 'X';
            const score = minimax(board, true, alpha, currentBeta, depth + 1);
            board[i] = null;
            best = Math.min(best, score);
            currentBeta = Math.min(currentBeta, best);
            if (currentBeta <= alpha) {
                break;
            }
        }
    }
    return best;
};

export const getAiMove = (state: { board: Board; currentTurn: Player; role: string }):
    { type: 'move'; position: number } | null => {
    if (state.currentTurn !== state.role) {
        return null;
    }
    let bestScore = -Infinity;
    let bestPos = -1;
    const { board } = state;
    for (let i = 0; i < 9; i++) {
        if (board[i] === null) {
            board[i] = 'O';
            const score = minimax(board, false, -Infinity, Infinity, 0);
            board[i] = null;
            if (score > bestScore) {
                bestScore = score;
                bestPos = i;
            }
        }
    }
    if (bestPos === -1) {
        return null;
    }
    return { type: 'move', position: bestPos };
};
