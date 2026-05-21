import { describe, expect, it } from 'vitest';
import { STANCES, eqPos, hasNoMove, makeContext, skillAttackTargets, skillHitCells, skillMoveOptions } from './index';
import type { Pos, StanceName } from './index';

const p = (row: number, col: number): Pos => ({ row, col });
const has = (arr: Pos[], pos: Pos) => arr.some(q => eqPos(q, pos));

// Adapters from the legacy stance API onto the composable Skill model, so the
// behavioral assertions below double as a spec the refactor must preserve.
const getMoveOptions = (name: StanceName, pos: Pos, pi: number): Pos[] =>
    skillMoveOptions(STANCES[name], makeContext({ from: pos, to: pos, playerIndex: pi as 0 | 1 }));
const getAttackOptions = (name: StanceName, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillAttackTargets(STANCES[name], makeContext({ from: originalPos ?? pos, to: pos, playerIndex: pi as 0 | 1 }));
const getHitCells = (name: StanceName, attackAt: Pos | null, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillHitCells(STANCES[name], makeContext({ from: originalPos ?? pos, to: pos, playerIndex: pi as 0 | 1 }), attackAt);
const isNoMove = (name: StanceName): boolean => hasNoMove(STANCES[name], makeContext({ from: p(3, 3), to: p(3, 3) }));
const isDodge = (name: StanceName): boolean => Boolean(STANCES[name].immune);
const isCharge = (name: StanceName): boolean => Boolean(STANCES[name].charge);

describe('getMoveOptions', () => {
    describe('snake', () => {
        it('4 diagonal options from center', () => {
            const opts = getMoveOptions('snake', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(2, 2))).toBe(true);
            expect(has(opts, p(2, 4))).toBe(true);
            expect(has(opts, p(4, 2))).toBe(true);
            expect(has(opts, p(4, 4))).toBe(true);
        });
        it('clips to board at corner', () => {
            const opts = getMoveOptions('snake', p(0, 0), 0);
            expect(opts).toHaveLength(1);
            expect(has(opts, p(1, 1))).toBe(true);
        });
    });

    describe('crane', () => {
        it('4 cardinal options from center (player 0)', () => {
            const opts = getMoveOptions('crane', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 4))).toBe(true); // F: east
            expect(has(opts, p(3, 2))).toBe(true); // B: west
            expect(has(opts, p(2, 3))).toBe(true); // L: north
            expect(has(opts, p(4, 3))).toBe(true); // R: south
        });
        it('same 4 cells from center (player 1)', () => {
            const opts = getMoveOptions('crane', p(3, 3), 1);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 2))).toBe(true); // F: west
            expect(has(opts, p(3, 4))).toBe(true); // B: east
            expect(has(opts, p(4, 3))).toBe(true); // L: south
            expect(has(opts, p(2, 3))).toBe(true); // R: north
        });
    });

    describe('tiger', () => {
        it('same move options as crane', () => {
            const crane = getMoveOptions('crane', p(3, 3), 0);
            const tiger = getMoveOptions('tiger', p(3, 3), 0);
            expect(tiger).toHaveLength(crane.length);
            crane.forEach((c: Pos) => expect(has(tiger, c)).toBe(true));
        });
    });

    describe('leopard', () => {
        it('2-step options from center (player 0)', () => {
            const opts = getMoveOptions('leopard', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 5))).toBe(true); // 2 east
            expect(has(opts, p(3, 1))).toBe(true); // 2 west
            expect(has(opts, p(1, 3))).toBe(true); // 2 north
            expect(has(opts, p(5, 3))).toBe(true); // 2 south
        });
        it('clips out-of-bounds 2-step at east edge (player 0)', () => {
            const opts = getMoveOptions('leopard', p(3, 6), 0);
            expect(has(opts, p(3, 8))).toBe(false);
            expect(has(opts, p(3, 4))).toBe(true);
        });
    });

    describe('dragon and turtle', () => {
        it('no move options for dragon', () => {
            expect(getMoveOptions('dragon', p(3, 3), 0)).toHaveLength(0);
        });
        it('no move options for turtle', () => {
            expect(getMoveOptions('turtle', p(3, 3), 0)).toHaveLength(0);
        });
        it('no move options for charge', () => {
            expect(getMoveOptions('charge', p(3, 3), 0)).toHaveLength(0);
        });
    });

    describe('crab', () => {
        it('4 diagonal options from center (same as snake)', () => {
            const opts = getMoveOptions('crab', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(2, 2))).toBe(true);
            expect(has(opts, p(2, 4))).toBe(true);
            expect(has(opts, p(4, 2))).toBe(true);
            expect(has(opts, p(4, 4))).toBe(true);
        });
    });

    describe('monkey', () => {
        it('4 two-step options from center (same as leopard)', () => {
            const opts = getMoveOptions('monkey', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 5))).toBe(true);
            expect(has(opts, p(3, 1))).toBe(true);
            expect(has(opts, p(1, 3))).toBe(true);
            expect(has(opts, p(5, 3))).toBe(true);
        });
    });

    describe('ox', () => {
        it('4 cardinal options from center (same as crane)', () => {
            const opts = getMoveOptions('ox', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 4))).toBe(true);
            expect(has(opts, p(3, 2))).toBe(true);
            expect(has(opts, p(2, 3))).toBe(true);
            expect(has(opts, p(4, 3))).toBe(true);
        });
    });

    describe('dog', () => {
        it('4 cardinal options from center (same as crane)', () => {
            const opts = getMoveOptions('dog', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 4))).toBe(true);
            expect(has(opts, p(3, 2))).toBe(true);
            expect(has(opts, p(2, 3))).toBe(true);
            expect(has(opts, p(4, 3))).toBe(true);
        });
    });

    describe('dodge', () => {
        it('same 4 cardinal options as crane (player 0)', () => {
            const opts = getMoveOptions('dodge', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(3, 4))).toBe(true);
            expect(has(opts, p(3, 2))).toBe(true);
            expect(has(opts, p(2, 3))).toBe(true);
            expect(has(opts, p(4, 3))).toBe(true);
        });
    });

    describe('horse', () => {
        it('8 L-shaped options from center', () => {
            const opts = getMoveOptions('horse', p(3, 3), 0);
            expect(opts).toHaveLength(8);
            [p(4, 5), p(4, 1), p(2, 5), p(2, 1), p(5, 4), p(5, 2), p(1, 4), p(1, 2)].forEach((q) => {
                expect(has(opts, q)).toBe(true);
            });
        });
        it('clips options at corner', () => {
            const opts = getMoveOptions('horse', p(0, 0), 0);
            expect(opts).toHaveLength(2);
            expect(has(opts, p(1, 2))).toBe(true);
            expect(has(opts, p(2, 1))).toBe(true);
        });
    });
});

describe('getAttackOptions', () => {
    describe('snake', () => {
        it('with originalPos: the two corner cells between old and new position', () => {
            // moved from (3,3) to (2,4) diagonally NE
            const opts = getAttackOptions('snake', p(2, 4), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 4))).toBe(true); // originalPos.row, pos.col
            expect(has(opts, p(2, 3))).toBe(true); // pos.row, originalPos.col
        });
        it('without originalPos: L and R of player 0', () => {
            const opts = getAttackOptions('snake', p(3, 3), 0);
            expect(opts).toHaveLength(2);
            expect(has(opts, p(2, 3))).toBe(true); // L(0): north
            expect(has(opts, p(4, 3))).toBe(true); // R(0): south
        });
        it('without originalPos: L and R of player 1', () => {
            const opts = getAttackOptions('snake', p(3, 3), 1);
            expect(opts).toHaveLength(2);
            expect(has(opts, p(4, 3))).toBe(true); // L(1): south
            expect(has(opts, p(2, 3))).toBe(true); // R(1): north
        });
    });

    describe('crane', () => {
        it('fallback F/B without originalPos (player 0)', () => {
            const opts = getAttackOptions('crane', p(3, 3), 0);
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 4))).toBe(true); // F: east
            expect(has(opts, p(3, 2))).toBe(true); // B: west
        });
        it('direction-based: moved east → attack east and west', () => {
            const opts = getAttackOptions('crane', p(3, 4), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 5))).toBe(true);
            expect(has(opts, p(3, 3))).toBe(true);
        });
        it('direction-based: moved north → attack north and south', () => {
            const opts = getAttackOptions('crane', p(2, 3), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(1, 3))).toBe(true);
            expect(has(opts, p(3, 3))).toBe(true);
        });
    });

    describe('leopard', () => {
        it('fallback F/B without originalPos (player 0)', () => {
            const opts = getAttackOptions('leopard', p(3, 3), 0);
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 4))).toBe(true); // F: east
            expect(has(opts, p(3, 2))).toBe(true); // B: west
        });
        it('direction-based: moved east 2 steps → attack east and west', () => {
            const opts = getAttackOptions('leopard', p(3, 5), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 6))).toBe(true);
            expect(has(opts, p(3, 4))).toBe(true);
        });
        it('direction-based: moved south 2 steps → attack south and north', () => {
            const opts = getAttackOptions('leopard', p(5, 3), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(6, 3))).toBe(true);
            expect(has(opts, p(4, 3))).toBe(true);
        });
    });

    describe('tiger', () => {
        it('1 selectable cell: direction extended from original pos (player 0, moved east)', () => {
            // moved from (3,3) to (3,4) — direction is east, selectable = (3,5)
            const opts = getAttackOptions('tiger', p(3, 4), 0, p(3, 3));
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 5))).toBe(true);
        });
        it('1 selectable cell: direction extended (player 1, moved west)', () => {
            // player 1 at (3,4) moved from (3,5) — direction west, selectable = (3,3)
            const opts = getAttackOptions('tiger', p(3, 4), 1, p(3, 5));
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 3))).toBe(true);
        });
        it('uses forward direction when no originalPos (player 0)', () => {
            const opts = getAttackOptions('tiger', p(3, 3), 0);
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 4))).toBe(true); // F(0) = east
        });
        it('clips when near board edge', () => {
            // moved north: from (3,3) to (2,3) — direction north, selectable = (1,3)
            const opts = getAttackOptions('tiger', p(2, 3), 0, p(3, 3));
            expect(opts).toHaveLength(1);
            expect(has(opts, p(1, 3))).toBe(true);
        });
    });

    describe('dragon', () => {
        it('5×5 outer ring (16 cells) from center', () => {
            const opts = getAttackOptions('dragon', p(3, 3), 0);
            expect(opts).toHaveLength(16);
            expect(has(opts, p(1, 1))).toBe(true);
            expect(has(opts, p(5, 5))).toBe(true);
            expect(has(opts, p(3, 1))).toBe(true);
            // inner 3×3 excluded
            expect(has(opts, p(3, 3))).toBe(false);
            expect(has(opts, p(3, 4))).toBe(false);
            expect(has(opts, p(4, 4))).toBe(false);
        });
        it('clips out-of-bounds cells', () => {
            const opts = getAttackOptions('dragon', p(1, 1), 0);
            opts.forEach((q: Pos) => {
                expect(q.row).toBeGreaterThanOrEqual(0);
                expect(q.col).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('turtle', () => {
        it('3×3 area (9 cells) from center', () => {
            const opts = getAttackOptions('turtle', p(3, 3), 0);
            expect(opts).toHaveLength(9);
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    expect(has(opts, p(3 + dr, 3 + dc))).toBe(true);
                }
            }
        });
        it('clips to board at corner (0,0): 4 cells', () => {
            const opts = getAttackOptions('turtle', p(0, 0), 0);
            expect(opts).toHaveLength(4);
            [p(0, 0), p(0, 1), p(1, 0), p(1, 1)].forEach(q => expect(has(opts, q)).toBe(true));
        });
    });

    describe('horse', () => {
        it('fallback F/B without originalPos (player 0)', () => {
            const opts = getAttackOptions('horse', p(3, 3), 0);
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 4))).toBe(true); // F: east
            expect(has(opts, p(3, 2))).toBe(true); // B: west
        });
        it('direction-based: L-move (+1,+2) → primary axis east-west', () => {
            // moved from (3,3) to (4,5): dc=2 > dr=1, axis = east-west
            const opts = getAttackOptions('horse', p(4, 5), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(4, 6))).toBe(true);
            expect(has(opts, p(4, 4))).toBe(true);
        });
        it('direction-based: L-move (+2,+1) → primary axis south-north', () => {
            // moved from (3,3) to (5,4): dr=2 >= dc=1, axis = south-north
            const opts = getAttackOptions('horse', p(5, 4), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(6, 4))).toBe(true);
            expect(has(opts, p(4, 4))).toBe(true);
        });
    });

    describe('charge and dodge', () => {
        it('no attack options for charge', () => {
            expect(getAttackOptions('charge', p(3, 3), 0)).toHaveLength(0);
        });
        it('no attack options for dodge', () => {
            expect(getAttackOptions('dodge', p(3, 3), 0)).toHaveLength(0);
        });
    });

    describe('monkey', () => {
        it('1 attack option: the landing position', () => {
            const opts = getAttackOptions('monkey', p(3, 5), 0, p(3, 3));
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 5))).toBe(true);
        });
        it('without originalPos: the current pos', () => {
            const opts = getAttackOptions('monkey', p(3, 3), 0);
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 3))).toBe(true);
        });
    });

    describe('ox', () => {
        it('1 attack option: the landing position', () => {
            const opts = getAttackOptions('ox', p(3, 3), 0);
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 3))).toBe(true);
        });
        it('with originalPos: still just the landing position', () => {
            const opts = getAttackOptions('ox', p(3, 2), 0, p(3, 3));
            expect(opts).toHaveLength(1);
            expect(has(opts, p(3, 2))).toBe(true);
        });
    });

    describe('crab', () => {
        it('3 diagonals from destination, excluding origin (moved SE)', () => {
            // moved from (3,3) to (4,4): diagonals of (4,4) excluding (3,3)
            const opts = getAttackOptions('crab', p(4, 4), 0, p(3, 3));
            expect(opts).toHaveLength(3);
            expect(has(opts, p(3, 3))).toBe(false);
            expect(has(opts, p(3, 5))).toBe(true);
            expect(has(opts, p(5, 3))).toBe(true);
            expect(has(opts, p(5, 5))).toBe(true);
        });
        it('3 diagonals from destination, excluding origin (moved NE)', () => {
            // moved from (3,3) to (2,4): diagonals of (2,4) excluding (3,3)
            const opts = getAttackOptions('crab', p(2, 4), 0, p(3, 3));
            expect(opts).toHaveLength(3);
            expect(has(opts, p(3, 3))).toBe(false);
            expect(has(opts, p(1, 3))).toBe(true);
            expect(has(opts, p(1, 5))).toBe(true);
            expect(has(opts, p(3, 5))).toBe(true);
        });
        it('all 4 diagonals without originalPos', () => {
            const opts = getAttackOptions('crab', p(3, 3), 0);
            expect(opts).toHaveLength(4);
            expect(has(opts, p(2, 2))).toBe(true);
            expect(has(opts, p(2, 4))).toBe(true);
            expect(has(opts, p(4, 2))).toBe(true);
            expect(has(opts, p(4, 4))).toBe(true);
        });
        it('clips out-of-bounds', () => {
            // moved from (3,5) to (4,6): diagonals of (4,6) excluding (3,5)
            const opts = getAttackOptions('crab', p(4, 6), 0, p(3, 5));
            expect(opts).toHaveLength(1);
            expect(has(opts, p(5, 5))).toBe(true);
        });
    });

    describe('dog', () => {
        it('2 backward diagonal cells when moved west', () => {
            // moved from (3,3) to (3,2): backward=east, diagonals=(2,3) and (4,3)
            const opts = getAttackOptions('dog', p(3, 2), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(2, 3))).toBe(true);
            expect(has(opts, p(4, 3))).toBe(true);
        });
        it('2 backward diagonal cells when moved north', () => {
            // moved from (3,3) to (2,3): backward=south, diagonals=(3,2) and (3,4)
            const opts = getAttackOptions('dog', p(2, 3), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(3, 2))).toBe(true);
            expect(has(opts, p(3, 4))).toBe(true);
        });
        it('2 backward diagonal cells when moved east', () => {
            // moved from (3,3) to (3,4): backward=west, diagonals=(2,3) and (4,3)
            const opts = getAttackOptions('dog', p(3, 4), 0, p(3, 3));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(2, 3))).toBe(true);
            expect(has(opts, p(4, 3))).toBe(true);
        });
        it('clips to board edge', () => {
            // moved from (1,1) to (0,1): backward=south, diagonals=(1,0) and (1,2)
            const opts = getAttackOptions('dog', p(0, 1), 0, p(1, 1));
            expect(opts).toHaveLength(2);
            expect(has(opts, p(1, 0))).toBe(true);
            expect(has(opts, p(1, 2))).toBe(true);
        });
    });
});

describe('getHitCells', () => {
    describe('tiger AoE', () => {
        it('expands to 3-cell perpendicular (moved east, target one more east)', () => {
            // moved from (3,3) to (3,4) east, attack target = (3,5)
            const cells = getHitCells('tiger', p(3, 5), p(3, 4), 0, p(3, 3));
            expect(cells).toHaveLength(3);
            expect(has(cells, p(2, 5))).toBe(true); // perp north
            expect(has(cells, p(3, 5))).toBe(true); // center
            expect(has(cells, p(4, 5))).toBe(true); // perp south
        });
        it('expands perpendicular when moved north', () => {
            // moved from (3,3) to (2,3) north, attack target = (1,3)
            const cells = getHitCells('tiger', p(1, 3), p(2, 3), 0, p(3, 3));
            expect(cells).toHaveLength(3);
            expect(has(cells, p(1, 2))).toBe(true); // perp west
            expect(has(cells, p(1, 3))).toBe(true);
            expect(has(cells, p(1, 4))).toBe(true); // perp east
        });
    });

    it('dragon returns single attackAt cell', () => {
        const cells = getHitCells('dragon', p(1, 1), p(3, 3), 0);
        expect(cells).toHaveLength(1);
        expect(has(cells, p(1, 1))).toBe(true);
    });

    it('turtle returns single attackAt cell', () => {
        const cells = getHitCells('turtle', p(3, 4), p(3, 3), 0);
        expect(cells).toHaveLength(1);
        expect(has(cells, p(3, 4))).toBe(true);
    });

    it('other stances return single attackAt cell', () => {
        const cells = getHitCells('crane', p(3, 4), p(3, 3), 0);
        expect(cells).toHaveLength(1);
        expect(has(cells, p(3, 4))).toBe(true);
    });

    it('returns empty when attackAt is null and stance is not auto', () => {
        const cells = getHitCells('crane', null, p(3, 3), 0);
        expect(cells).toHaveLength(0);
    });

    describe('monkey attack', () => {
        it('hits the provided attackAt position', () => {
            const cells = getHitCells('monkey', p(3, 5), p(3, 5), 0, p(3, 3));
            expect(cells).toHaveLength(1);
            expect(has(cells, p(3, 5))).toBe(true);
        });
        it('falls back to landing pos when attackAt is null', () => {
            const cells = getHitCells('monkey', null, p(3, 5), 0, p(3, 3));
            expect(cells).toHaveLength(1);
            expect(has(cells, p(3, 5))).toBe(true);
        });
    });

    describe('ox AoE', () => {
        it('sweeps column when moved horizontally (west)', () => {
            // moved from (3,3) to (3,2), attack at (3,2): sweeps (2,2),(3,2),(4,2)
            const cells = getHitCells('ox', p(3, 2), p(3, 2), 0, p(3, 3));
            expect(cells).toHaveLength(3);
            expect(has(cells, p(2, 2))).toBe(true);
            expect(has(cells, p(3, 2))).toBe(true);
            expect(has(cells, p(4, 2))).toBe(true);
        });
        it('sweeps column when moved east', () => {
            const cells = getHitCells('ox', p(3, 4), p(3, 4), 0, p(3, 3));
            expect(cells).toHaveLength(3);
            expect(has(cells, p(2, 4))).toBe(true);
            expect(has(cells, p(3, 4))).toBe(true);
            expect(has(cells, p(4, 4))).toBe(true);
        });
        it('sweeps row when moved vertically (south)', () => {
            const cells = getHitCells('ox', p(4, 3), p(4, 3), 0, p(3, 3));
            expect(cells).toHaveLength(3);
            expect(has(cells, p(4, 2))).toBe(true);
            expect(has(cells, p(4, 3))).toBe(true);
            expect(has(cells, p(4, 4))).toBe(true);
        });
        it('clips at board row 0', () => {
            // moved from (0,2) to (0,3) east: column sweep clips (−1,3)
            const cells = getHitCells('ox', p(0, 3), p(0, 3), 0, p(0, 2));
            expect(cells).toHaveLength(2);
            expect(has(cells, p(0, 3))).toBe(true);
            expect(has(cells, p(1, 3))).toBe(true);
        });
    });
});

describe('stance property helpers', () => {
    it('isNoMove: dragon, turtle, charge', () => {
        expect(isNoMove('dragon')).toBe(true);
        expect(isNoMove('turtle')).toBe(true);
        expect(isNoMove('charge')).toBe(true);
        expect(isNoMove('tiger')).toBe(false);
        expect(isNoMove('dodge')).toBe(false);
    });
    it('isDodge: dodge only', () => {
        expect(isDodge('dodge')).toBe(true);
        expect(isDodge('crane')).toBe(false);
        expect(isDodge('charge')).toBe(false);
    });
    it('isCharge: charge only', () => {
        expect(isCharge('charge')).toBe(true);
        expect(isCharge('dragon')).toBe(false);
        expect(isCharge('dodge')).toBe(false);
    });
});
