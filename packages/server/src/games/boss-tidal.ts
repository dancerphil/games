import type { Pos } from '@games/shared';
import { BOARD, dedupe, fullCol, fullRow, squareRing } from '@games/shared';
import { createBossGame } from './boss-engine.js';

const CENTER: Pos = { row: 3, col: 3 };

type WaveEdge = 'top' | 'bottom' | 'left' | 'right';
const ALL_EDGES: WaveEdge[] = ['top', 'bottom', 'left', 'right'];

interface Wave { edge: WaveEdge; position: number }
interface TidalExtra { destructionStage: 0 | 1 | 2; waves: Wave[] }

const waveCells = (wave: Wave): Pos[] =>
    (wave.edge === 'top' || wave.edge === 'bottom') ? fullRow(wave.position) : fullCol(wave.position);

const initWave = (edge: WaveEdge): Wave => ({ edge, position: edge === 'bottom' || edge === 'right' ? BOARD - 1 : 0 });

const advanceWave = (wave: Wave): Wave | null => {
    const next = (wave.edge === 'top' || wave.edge === 'left') ? wave.position + 1 : wave.position - 1;
    return next < 0 || next >= BOARD ? null : { ...wave, position: next };
};

export const { ROLES, initState, handleMove, getStartData, getSpectateState, getResult } = createBossGame<TidalExtra>({
    bossHp: 6,
    initPlayer: { row: 3, col: 1 },
    initBossUnits: [CENTER],
    initExtra: () => ({ destructionStage: 0, waves: [] }),
    skillSequence: ['destruction', 'wave', 'wave'],
    bossTargets: () => [CENTER],
    resolveTurn: ({ skillId, extra, random }) => {
        const noMove = { bossUnits: [CENTER], unitMoves: [{ from: CENTER, to: CENTER }] };
        let waves = extra.waves;
        let destructionStage: 0 | 1 | 2 = extra.destructionStage;
        let ringAoe: Pos[] = [];

        if (skillId === 'destruction') {
            ringAoe = squareRing(CENTER, 1);
            destructionStage = 1;
        }
        else {
            const edges = [...ALL_EDGES].sort(() => random() - 0.5);
            waves = [...waves, initWave(edges[0]), initWave(edges[1])];
            if (destructionStage === 1) { ringAoe = squareRing(CENTER, 2); destructionStage = 2; }
            else if (destructionStage === 2) { ringAoe = squareRing(CENTER, 3); destructionStage = 0; }
        }

        // Every turn: existing waves strike at their current line, then advance one step for next turn.
        const aoe = dedupe([...ringAoe, ...waves.flatMap(waveCells)]);
        const remaining = waves.map(advanceWave).filter((wave): wave is Wave => wave !== null);
        return { ...noMove, aoe, nextExtra: { destructionStage, waves: remaining } };
    },
    startExtras: extra => ({ destructionStage: extra.destructionStage, waves: extra.waves }),
    resultExtras: extra => ({ destructionStage: extra.destructionStage, waves: extra.waves }),
    spectateExtras: extra => ({ destructionStage: extra.destructionStage, waves: extra.waves }),
});
