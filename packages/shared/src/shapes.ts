import type { Pos } from './geometry.js';
import { BOARD, add, dedupe, inBounds, keepInBounds } from './geometry.js';

// Filled square: every cell within Chebyshev distance <= radius of center (e.g. 3x3 = radius 1).
export const filledSquare = (center: Pos, radius: number): Pos[] => {
    const cells: Pos[] = [];
    for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
            cells.push({ row: center.row + dr, col: center.col + dc });
        }
    }
    return keepInBounds(cells);
};

// Square ring: cells at exactly Chebyshev distance == radius (3x3 ring = 8 cells, 5x5 ring = 16, 7x7 ring = 24).
export const squareRing = (center: Pos, radius: number): Pos[] => {
    const cells: Pos[] = [];
    for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) === radius) {
                cells.push({ row: center.row + dr, col: center.col + dc });
            }
        }
    }
    return keepInBounds(cells);
};

export const fullRow = (row: number): Pos[] => Array.from({ length: BOARD }, (_, col) => ({ row, col }));
export const fullCol = (col: number): Pos[] => Array.from({ length: BOARD }, (_, row) => ({ row, col }));

// Full straight line through a point along a direction, extended both ways to the board edges.
export const fullLine = (through: Pos, direction: Pos): Pos[] => {
    if (direction.row === 0 && direction.col === 0) { return [through]; }
    const cells: Pos[] = [];
    for (const sign of [1, -1]) {
        let current = through;
        while (inBounds(current)) {
            cells.push(current);
            current = add(current, { row: direction.row * sign, col: direction.col * sign });
        }
    }
    return dedupe(cells);
};

// Both diagonal full lines through a point (NE/SW + NW/SE).
export const diagonalCross = (through: Pos): Pos[] =>
    dedupe([...fullLine(through, { row: 1, col: 1 }), ...fullLine(through, { row: 1, col: -1 })]);

// Straight segment of `length` cells starting at `start` heading in `direction`.
export const lineSegment = (start: Pos, direction: Pos, length: number): Pos[] =>
    keepInBounds(Array.from({ length }, (_, index) => ({
        row: start.row + direction.row * index,
        col: start.col + direction.col * index,
    })));

// Every board cell whose (row + col) parity matches `parity` (0 or 1) — interleaved full-board pattern.
export const checkerboard = (parity: number): Pos[] => {
    const cells: Pos[] = [];
    for (let row = 0; row < BOARD; row++) {
        for (let col = 0; col < BOARD; col++) {
            if ((row + col) % 2 === parity) { cells.push({ row, col }); }
        }
    }
    return cells;
};

// Perimeter of the axis-aligned rectangle spanning the two corners.
export const rectangleBorder = (cornerA: Pos, cornerB: Pos): Pos[] => {
    const minRow = Math.min(cornerA.row, cornerB.row);
    const maxRow = Math.max(cornerA.row, cornerB.row);
    const minCol = Math.min(cornerA.col, cornerB.col);
    const maxCol = Math.max(cornerA.col, cornerB.col);
    const cells: Pos[] = [];
    for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
            if (row === minRow || row === maxRow || col === minCol || col === maxCol) {
                cells.push({ row, col });
            }
        }
    }
    return keepInBounds(cells);
};

// Three cells centered on `center`, sweeping one step each way along `axis` (axis is a unit perpendicular).
export const perpendicularSweep = (center: Pos, axis: Pos): Pos[] => {
    if (axis.row === 0 && axis.col === 0) { return keepInBounds([center]); }
    return keepInBounds([
        { row: center.row - axis.row, col: center.col - axis.col },
        center,
        { row: center.row + axis.row, col: center.col + axis.col },
    ]);
};
