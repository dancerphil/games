export type GomokuPlayer = 'black' | 'white';
export type GomokuCell = GomokuPlayer | null;
export type GomokuBoard = GomokuCell[];
export type GomokuMessage =
    | { type: 'move'; row: number; col: number; player: GomokuPlayer; lastMove: number }
    | { type: 'game_over'; winner: GomokuPlayer | null; winningLine: number[] | null }
    | { type: 'spectating'; state: { board: GomokuBoard; currentTurn: GomokuPlayer; winner: GomokuPlayer | null; winningLine: number[] | null; lastMove: number | null } }
    | { type: 'spectate_update'; state: { board: GomokuBoard; currentTurn: GomokuPlayer; winner: GomokuPlayer | null; winningLine: number[] | null; lastMove: number | null } };
