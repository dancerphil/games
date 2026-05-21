import type { Pos, Skill } from '@games/shared';
import { cardinalStep, dedupe, diagonalCross, fixedAoe, makeContext, resolveMover, squareRing } from '@games/shared';
import { createBossGame } from './boss-engine.js';

interface TornadoExtra { pendingExpansion: Pos | null }

const whirlwindSkill: Skill = {
    id: 'whirlwind',
    move: cardinalStep(1),
    attack: fixedAoe(ctx => squareRing(ctx.to, 1)),
};

export const { ROLES, initState, handleMove, getStartData, getSpectateState, getResult } = createBossGame<TornadoExtra>({
    bossHp: 6,
    initPlayer: { row: 3, col: 1 },
    initBossUnits: [{ row: 3, col: 5 }],
    initExtra: () => ({ pendingExpansion: null }),
    skillSequence: ['whirlwind', 'wind-blade', 'eye-of-storm'],
    resolveTurn: ({ skillId, extra, bossUnits, playerFrom, random }) => {
        const from = bossUnits[0];

        if (skillId === 'whirlwind') {
            const ctx = makeContext({ from, to: from, playerIndex: 1, opponent: playerFrom, random });
            const { to, aoe } = resolveMover(whirlwindSkill, ctx, 'hunt');
            return { bossUnits: [to], unitMoves: [{ from, to }], aoe, nextExtra: { pendingExpansion: to } };
        }

        if (skillId === 'wind-blade') {
            const expansion = extra.pendingExpansion ? squareRing(extra.pendingExpansion, 2) : [];
            const aoe = dedupe([...diagonalCross(from), ...expansion]);
            return { bossUnits: [from], unitMoves: [{ from, to: from }], aoe, nextExtra: extra };
        }

        const aoe = extra.pendingExpansion ? squareRing(extra.pendingExpansion, 3) : [];
        return { bossUnits: [from], unitMoves: [{ from, to: from }], aoe, nextExtra: { pendingExpansion: null } };
    },
    startExtras: extra => ({ pendingExpansion: extra.pendingExpansion }),
    resultExtras: extra => ({ pendingExpansion: extra.pendingExpansion }),
});
