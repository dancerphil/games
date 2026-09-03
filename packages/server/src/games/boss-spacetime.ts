import type { Pos } from '@games/shared';
import { CARDINALS, add, dedupe, fullCol, fullRow, inBounds, manhattan, rectangleBorder } from '@games/shared';
import { createBossGame } from './boss-engine.js';

const validMoves = (pos: Pos): Pos[] => CARDINALS.map(direction => add(pos, direction)).filter(inBounds);

// Move both units toward the player, slightly favoring shared rows/columns so their lines overlap the board.
const pickBestMoves = (unit1Moves: Pos[], unit2Moves: Pos[], playerPos: Pos, random: () => number): [Pos, Pos] => {
    const pairs: { move1: Pos; move2: Pos; score: number }[] = [];
    for (const move1 of unit1Moves) {
        for (const move2 of unit2Moves) {
            const distance = manhattan(move1, playerPos) + manhattan(move2, playerPos);
            const sameRow = move1.row === move2.row ? 4 : 0;
            const sameCol = move1.col === move2.col ? 4 : 0;
            pairs.push({ move1, move2, score: distance + sameRow + sameCol + random() * 3 });
        }
    }
    const best = pairs.reduce((a, b) => (a.score < b.score ? a : b));
    return [best.move1, best.move2];
};

export const { ROLES, initState, handleMove, getStartData, getSpectateState, getResult } = createBossGame<Record<string, never>>({
    bossHp: 5,
    initPlayer: { row: 3, col: 1 },
    initBossUnits: [{ row: 1, col: 5 }, { row: 5, col: 5 }],
    initExtra: () => ({}),
    skillSequence: ['cardinal', 'temporal', 'boundless'],
    resolveTurn: ({ skillId, bossUnits, playerFrom, random }) => {
        const [from1, from2] = bossUnits;

        if (skillId === 'boundless') {
            return {
                bossUnits: [from1, from2],
                unitMoves: [{ from: from1, to: from1 }, { from: from2, to: from2 }],
                aoe: rectangleBorder(from1, from2),
                nextExtra: {},
            };
        }

        const [to1, to2] = pickBestMoves(validMoves(from1), validMoves(from2), playerFrom, random);
        const aoe = skillId === 'cardinal'
            ? dedupe([...fullCol(to1.col), ...fullCol(to2.col)])
            : dedupe([...fullRow(to1.row), ...fullRow(to2.row)]);
        return { bossUnits: [to1, to2], unitMoves: [{ from: from1, to: to1 }, { from: from2, to: to2 }], aoe, nextExtra: {} };
    },
    startExtras: (_extra, bossUnits) => ({ boss2Pos: bossUnits[1] }),
    resultExtras: (_extra, output) => ({
        boss2MovedFrom: output.unitMoves[1].from,
        boss2MovedTo: output.unitMoves[1].to,
        boss2Pos: output.bossUnits[1],
    }),
    spectateExtras: (_extra, bossUnits) => ({ boss2Pos: bossUnits[1] }),
});
