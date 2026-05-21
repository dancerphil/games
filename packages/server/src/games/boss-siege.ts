import type { Pos, StanceName } from '@games/shared';
import { STANCES, dedupe, makeContext, resolveRandom } from '@games/shared';
import { createBossGame } from './boss-engine.js';

const INITIAL_PLAYER_POS: Pos = { row: 3, col: 3 };
const INITIAL_BOSS_POSITIONS: Pos[] = [
    // inner ring (8): 3×3 grid with 1-cell gaps, excluding center
    { row: 1, col: 1 }, { row: 1, col: 3 }, { row: 1, col: 5 },
    { row: 3, col: 1 }, { row: 3, col: 5 },
    { row: 5, col: 1 }, { row: 5, col: 3 }, { row: 5, col: 5 },
    // outer ring (12): every other cell along the 7×7 perimeter
    { row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }, { row: 0, col: 6 },
    { row: 2, col: 6 }, { row: 4, col: 6 },
    { row: 6, col: 6 }, { row: 6, col: 4 }, { row: 6, col: 2 }, { row: 6, col: 0 },
    { row: 4, col: 0 }, { row: 2, col: 0 },
];

export const { ROLES, initState, handleMove, getStartData, getSpectateState, getResult } = createBossGame<Record<string, never>>({
    bossHp: 5,
    initPlayer: INITIAL_PLAYER_POS,
    initBossUnits: INITIAL_BOSS_POSITIONS,
    initExtra: () => ({}),
    skillSequence: ['crane', 'tiger', 'dragon'],
    reportMissAsZeroDamage: true,
    resolveTurn: ({ skillId, bossUnits, playerFrom, random }) => {
        const skill = STANCES[skillId as StanceName];
        const results = bossUnits.map((unitFrom) => {
            const ctx = makeContext({ from: unitFrom, to: unitFrom, playerIndex: 1, opponent: playerFrom, random });
            return resolveRandom(skill, ctx, random);
        });
        return {
            bossUnits: results.map(result => result.to),
            unitMoves: results.map(result => ({ from: result.from, to: result.to })),
            aoe: dedupe(results.flatMap(result => result.aoe)),
            nextExtra: {},
        };
    },
    startExtras: (_extra, bossUnits) => ({ bossPositions: bossUnits }),
    resultExtras: (_extra, output) => ({
        bossMovedFrom: output.bossUnits[0],
        bossMovedTo: output.bossUnits[0],
        bossPositions: output.bossUnits,
        bossMovements: output.unitMoves.map(move => ({ movedFrom: move.from, movedTo: move.to })),
    }),
    spectateExtras: (_extra, bossUnits) => ({ bossPositions: bossUnits }),
});
