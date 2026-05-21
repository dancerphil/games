import type { Pos, Skill } from '@games/shared';
import { cardinalStep, checkerboard, dedupe, dominantUnit, fixedAoe, lineSegment, makeContext, resolveMover, sub } from '@games/shared';
import { createBossGame } from './boss-engine.js';

interface ThunderExtra { lightningCells: Pos[] }

const stormSkill: Skill = {
    id: 'thunderstorm',
    move: cardinalStep(1),
    attack: fixedAoe(ctx => checkerboard((ctx.to.row + ctx.to.col) % 2)),
};

const cutSkill: Skill = {
    id: 'thunder-cut',
    move: cardinalStep(3),
    attack: fixedAoe(ctx => lineSegment(ctx.from, dominantUnit(sub(ctx.to, ctx.from)), 4)),
};

const strikeSkill: Skill = {
    id: 'thunder-strike',
    move: cardinalStep(1),
    attack: fixedAoe(ctx => [ctx.opponent]),
};

export const { ROLES, initState, handleMove, getStartData, getSpectateState, getResult } = createBossGame<ThunderExtra>({
    bossHp: 6,
    initPlayer: { row: 3, col: 1 },
    initBossUnits: [{ row: 3, col: 5 }],
    initExtra: () => ({ lightningCells: [] }),
    skillSequence: ['thunder-strike', 'thunderstorm', 'thunder-cut'],
    resolveTurn: ({ skillId, extra, bossUnits, playerFrom, random }) => {
        const from = bossUnits[0];
        const ctx = makeContext({ from, to: from, playerIndex: 1, opponent: playerFrom, random });

        if (skillId === 'thunder-strike') {
            const { to, aoe } = resolveMover(strikeSkill, ctx, 'toward');
            const trail = dedupe([...extra.lightningCells, playerFrom]);
            return { bossUnits: [to], unitMoves: [{ from, to }], aoe, hazard: trail, nextExtra: { lightningCells: trail } };
        }

        const skill = skillId === 'thunderstorm' ? stormSkill : cutSkill;
        const strategy = skillId === 'thunderstorm' ? 'toward' : 'hunt';
        const { to, aoe } = resolveMover(skill, ctx, strategy);
        return { bossUnits: [to], unitMoves: [{ from, to }], aoe, hazard: extra.lightningCells, nextExtra: extra };
    },
    startExtras: extra => ({ lightningCells: extra.lightningCells }),
    resultExtras: extra => ({ lightningCells: extra.lightningCells }),
    spectateExtras: extra => ({ lightningCells: extra.lightningCells }),
});
