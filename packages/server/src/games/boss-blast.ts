import type { MoveStrategy, Skill } from '@games/shared';
import { add, eqPos, filledSquare, fixedAoe, fullCol, fullRow, cardinalStep, makeContext, noMove, resolveMover, sub } from '@games/shared';
import { createBossGame } from './boss-engine.js';

const SKILLS: Record<string, { skill: Skill; strategy: MoveStrategy }> = {
    snipe: {
        skill: {
            id: 'snipe',
            move: noMove(),
            attack: fixedAoe((ctx) => {
                const useRow = ctx.to.row === ctx.opponent.row || (ctx.to.col !== ctx.opponent.col && ctx.random() < 0.5);
                return useRow ? fullRow(ctx.to.row) : fullCol(ctx.to.col);
            }),
        },
        strategy: 'stationary',
    },
    bombard: {
        skill: {
            id: 'bombard',
            move: cardinalStep(1),
            attack: fixedAoe((ctx) => {
                const direction = sub(ctx.to, ctx.from);
                const center = add(ctx.to, direction);
                return filledSquare(center, 1).filter(cell => !eqPos(cell, ctx.to));
            }),
        },
        strategy: 'hunt',
    },
    burst: {
        skill: { id: 'burst', move: noMove(), attack: fixedAoe(ctx => filledSquare(ctx.to, 1)) },
        strategy: 'stationary',
    },
};

export const { ROLES, initState, handleMove, getStartData, getSpectateState, getResult } = createBossGame<Record<string, never>>({
    bossHp: 5,
    initPlayer: { row: 3, col: 1 },
    initBossUnits: [{ row: 3, col: 5 }],
    initExtra: () => ({}),
    skillSequence: ['snipe', 'bombard', 'burst'],
    resolveTurn: ({ skillId, bossUnits, playerFrom, random }) => {
        const from = bossUnits[0];
        const ctx = makeContext({ from, to: from, playerIndex: 1, opponent: playerFrom, random });
        const { skill, strategy } = SKILLS[skillId];
        const { to, aoe } = resolveMover(skill, ctx, strategy);
        return { bossUnits: [to], unitMoves: [{ from, to }], aoe, nextExtra: {} };
    },
});
