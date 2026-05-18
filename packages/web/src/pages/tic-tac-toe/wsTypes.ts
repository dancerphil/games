export type Player = 'X' | 'O';
export type Board = (Player | null)[];

const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

export const getWinLine = (board: Board): number[] | null => {
    for (const line of WIN_LINES) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return line;
        }
    }
    return null;
};

export type TttGameMessage =
    | { type: 'move'; position: number; player: Player }
    | { type: 'game_over'; winner: Player | null }
    | { type: 'spectating'; state: { board: Board; currentTurn: Player } }
    | { type: 'spectate_update'; state: { board: Board; currentTurn: Player } };
