import type { Pos } from './geometry.js';
import type { Skill, SkillContext } from './skill.js';
import { add, dominantUnit, forward, sub } from './geometry.js';
import { cardinalStep, diagonalStep, knightMove, noAttack, noMove, selectCells, selfCell, sweep } from './patterns.js';
import { DIAGONALS } from './geometry.js';
import { filledSquare, squareRing } from './shapes.js';

export type StanceName = 'snake' | 'crane' | 'leopard' | 'tiger' | 'dragon' | 'turtle' | 'horse' | 'charge' | 'dodge' | 'crab' | 'monkey' | 'ox' | 'dog';
export const ALL_STANCES: StanceName[] = ['snake', 'crane', 'leopard', 'tiger', 'dragon', 'turtle', 'horse', 'charge', 'dodge', 'crab', 'monkey', 'ox', 'dog'];

const hasMoved = (ctx: SkillContext): boolean => !(ctx.from.row === ctx.to.row && ctx.from.col === ctx.to.col);
const moveDelta = (ctx: SkillContext): Pos => sub(ctx.to, ctx.from);
const motionUnit = (ctx: SkillContext): Pos => (hasMoved(ctx) ? moveDelta(ctx) : forward(ctx.playerIndex));

// Front & back along the movement axis (crane / leopard / horse share this).
const alongAxis = selectCells((ctx) => {
    const delta = moveDelta(ctx);
    const unit = delta.row === 0 && delta.col === 0 ? forward(ctx.playerIndex) : dominantUnit(delta);
    return [add(ctx.to, unit), sub(ctx.to, unit)];
});

export const STANCES: Record<StanceName, Skill> = {
    snake: {
        id: 'snake',
        move: diagonalStep(),
        attack: selectCells(ctx => (hasMoved(ctx)
            ? [{ row: ctx.from.row, col: ctx.to.col }, { row: ctx.to.row, col: ctx.from.col }]
            : [{ row: ctx.to.row - 1, col: ctx.to.col }, { row: ctx.to.row + 1, col: ctx.to.col }])),
    },
    crane: { id: 'crane', move: cardinalStep(1), attack: alongAxis },
    leopard: { id: 'leopard', move: cardinalStep(2), attack: alongAxis },
    horse: { id: 'horse', move: knightMove(), attack: alongAxis },
    tiger: {
        id: 'tiger',
        move: cardinalStep(1),
        attack: sweep(
            ctx => [add(ctx.to, motionUnit(ctx))],
            ctx => ({ row: motionUnit(ctx).col, col: motionUnit(ctx).row }),
        ),
    },
    ox: {
        id: 'ox',
        move: cardinalStep(1),
        attack: sweep(
            ctx => [ctx.to],
            ctx => ({ row: moveDelta(ctx).col, col: moveDelta(ctx).row }),
        ),
    },
    dragon: { id: 'dragon', move: noMove(), attack: selectCells(ctx => squareRing(ctx.to, 2)) },
    turtle: { id: 'turtle', move: noMove(), attack: selectCells(ctx => filledSquare(ctx.to, 1)) },
    charge: { id: 'charge', move: noMove(), attack: noAttack(), charge: true },
    dodge: { id: 'dodge', move: cardinalStep(1), attack: noAttack(), immune: true },
    crab: {
        id: 'crab',
        move: diagonalStep(),
        attack: selectCells((ctx) => {
            const diagonals = DIAGONALS.map(direction => add(ctx.to, direction));
            return hasMoved(ctx) ? diagonals.filter(cell => !(cell.row === ctx.from.row && cell.col === ctx.from.col)) : diagonals;
        }),
    },
    monkey: { id: 'monkey', move: cardinalStep(2), attack: selfCell() },
    dog: {
        id: 'dog',
        move: cardinalStep(1),
        attack: selectCells((ctx) => {
            if (!hasMoved(ctx)) return [];
            const delta = moveDelta(ctx);
            return delta.col !== 0
                ? [{ row: ctx.to.row - 1, col: ctx.to.col - delta.col }, { row: ctx.to.row + 1, col: ctx.to.col - delta.col }]
                : [{ row: ctx.to.row - delta.row, col: ctx.to.col - 1 }, { row: ctx.to.row - delta.row, col: ctx.to.col + 1 }];
        }),
    },
};
