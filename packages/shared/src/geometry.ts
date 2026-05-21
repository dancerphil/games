export interface Pos { row: number; col: number }

export const BOARD = 7;

export const eqPos = (a: Pos, b: Pos): boolean => a.row === b.row && a.col === b.col;
export const add = (a: Pos, b: Pos): Pos => ({ row: a.row + b.row, col: a.col + b.col });
export const sub = (a: Pos, b: Pos): Pos => ({ row: a.row - b.row, col: a.col - b.col });
export const scale = (a: Pos, n: number): Pos => ({ row: a.row * n, col: a.col * n });
export const inBounds = (p: Pos): boolean => p.row >= 0 && p.row < BOARD && p.col >= 0 && p.col < BOARD;

export const CARDINALS: Pos[] = [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }];
export const DIAGONALS: Pos[] = [{ row: -1, col: -1 }, { row: -1, col: 1 }, { row: 1, col: -1 }, { row: 1, col: 1 }];

// Player 0 faces east (+col), player 1 faces west (-col).
export const forward = (playerIndex: number): Pos => ({ row: 0, col: playerIndex === 0 ? 1 : -1 });
export const backward = (playerIndex: number): Pos => ({ row: 0, col: playerIndex === 0 ? -1 : 1 });
export const left = (playerIndex: number): Pos => ({ row: playerIndex === 0 ? -1 : 1, col: 0 });
export const right = (playerIndex: number): Pos => ({ row: playerIndex === 0 ? 1 : -1, col: 0 });

// Unit step of a delta, snapping to the dominant axis (ties favor the row axis).
export const dominantUnit = (delta: Pos): Pos => {
    if (delta.row === 0 && delta.col === 0) { return { row: 0, col: 0 }; }
    if (Math.abs(delta.row) >= Math.abs(delta.col)) { return { row: delta.row > 0 ? 1 : -1, col: 0 }; }
    return { row: 0, col: delta.col > 0 ? 1 : -1 };
};

export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.row - b.row) + Math.abs(a.col - b.col);

export const dedupe = (cells: Pos[]): Pos[] =>
    [...new Map(cells.map(p => [`${p.row},${p.col}`, p])).values()];

export const keepInBounds = (cells: Pos[]): Pos[] => cells.filter(inBounds);
