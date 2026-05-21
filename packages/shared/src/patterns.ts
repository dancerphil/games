import type { AttackPattern, MovePattern, SkillContext } from './skill.js';
import type { Pos } from './geometry.js';
import { CARDINALS, DIAGONALS, add, scale } from './geometry.js';
import { perpendicularSweep } from './shapes.js';

const KNIGHT_OFFSETS: Pos[] = [
    { row: 1, col: 2 }, { row: 1, col: -2 }, { row: -1, col: 2 }, { row: -1, col: -2 },
    { row: 2, col: 1 }, { row: 2, col: -1 }, { row: -2, col: 1 }, { row: -2, col: -1 },
];

// --- Move patterns ---
export const noMove = (): MovePattern => () => [];
export const diagonalStep = (): MovePattern => ctx => DIAGONALS.map(direction => add(ctx.from, direction));
export const cardinalStep = (distance: number): MovePattern => ctx => CARDINALS.map(direction => add(ctx.from, scale(direction, distance)));
export const knightMove = (): MovePattern => ctx => KNIGHT_OFFSETS.map(offset => add(ctx.from, offset));

// --- Attack patterns ---
export const noAttack = (): AttackPattern => ({ targets: () => [], hitCells: () => [] });

// Choose one of the given cells; the hit is exactly that cell.
export const selectCells = (targetsFn: (ctx: SkillContext) => Pos[]): AttackPattern => ({
    targets: targetsFn,
    hitCells: (_ctx, target) => (target ? [target] : []),
});

// Choose one cell; the hit sweeps three cells along an axis perpendicular to motion.
export const sweep = (targetsFn: (ctx: SkillContext) => Pos[], axisFn: (ctx: SkillContext) => Pos): AttackPattern => ({
    targets: targetsFn,
    hitCells: (ctx, target) => (target ? perpendicularSweep(target, axisFn(ctx)) : []),
});

// No selection; the hit is always the actor's own landing cell.
export const selfCell = (): AttackPattern => ({
    targets: ctx => [ctx.to],
    hitCells: (ctx, target) => [target ?? ctx.to],
});

// No selection; the hit is a board area computed from context (boss AOEs).
export const fixedAoe = (areaFn: (ctx: SkillContext) => Pos[]): AttackPattern => ({
    targets: () => [],
    hitCells: ctx => areaFn(ctx),
});
