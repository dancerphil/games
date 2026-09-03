import type { Pos, StanceName } from '@games/shared';
import { squareRingArrows } from '@/game/aoeArrows';
import type { InitialAction } from '../../hooks/useGameRoom';
import type { DirectionArrow } from '../boss/BossBattlePage';
import { BossBattlePage } from '../boss/BossBattlePage';

type TidalSkill = 'destruction' | 'wave';

const skillLabels: Record<TidalSkill, string> = {
    destruction: '破坏',
    wave: '巨浪',
};

const skillDescriptions: Record<TidalSkill, string> = {
    destruction: '以场地中央为中心释放 3×3 外圈，后续巨浪回合依次扩散至 5×5 和 7×7 外圈',
    wave: '追加 2 股新巨浪，所有巨浪各向场地中间推进一格，毁灭之环同步扩散',
};

type WaveEdge = 'top' | 'bottom' | 'left' | 'right';

interface Wave {
    edge: WaveEdge;
    position: number;
}

const BOARD = 7;
const CENTER: Pos = { row: 3, col: 3 };

const ring3x3 = (): Pos[] => {
    const cells: Pos[] = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) { continue; }
            cells.push({ row: CENTER.row + dr, col: CENTER.col + dc });
        }
    }
    return cells;
};

const ring5x5 = (): Pos[] => {
    const cells: Pos[] = [];
    for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
            if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) { continue; }
            cells.push({ row: CENTER.row + dr, col: CENTER.col + dc });
        }
    }
    return cells;
};

const ring7x7 = (): Pos[] => {
    const cells: Pos[] = [];
    for (let dr = -3; dr <= 3; dr++) {
        for (let dc = -3; dc <= 3; dc++) {
            if (Math.abs(dr) <= 2 && Math.abs(dc) <= 2) { continue; }
            const cell = { row: CENTER.row + dr, col: CENTER.col + dc };
            if (cell.row >= 0 && cell.row < BOARD && cell.col >= 0 && cell.col < BOARD) { cells.push(cell); }
        }
    }
    return cells;
};

const getWaveCells = (wave: Wave): Pos[] => {
    if (wave.edge === 'top' || wave.edge === 'bottom') {
        return Array.from({ length: BOARD }, (_, col) => ({ row: wave.position, col }));
    }
    return Array.from({ length: BOARD }, (_, row) => ({ row, col: wave.position }));
};

const dedup = (cells: Pos[]): Pos[] =>
    [...new Map(cells.map(p => [`${p.row},${p.col}`, p])).values()];

interface TidalExtraState {
    destructionStage: 0 | 1 | 2;
    waves: Wave[];
}

interface TidalGameMessage {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    bossSkill?: TidalSkill;
    nextBossSkill?: TidalSkill;
    destructionStage?: 0 | 1 | 2;
    waves?: Wave[];
    myCard?: StanceName;
    myMovedTo?: Pos;
    myMovedFrom?: Pos;
    myAttackedAt?: Pos | null;
    bossMovedTo?: Pos;
    bossMovedFrom?: Pos;
    bossAoe?: Pos[];
    iHitBoss?: boolean;
    bossHitMe?: boolean;
    myDamage?: number;
    gameOver?: boolean;
    winner?: 0 | 1 | 'draw';
}

const ALL_EDGE_CELLS: Pos[] = [
    ...Array.from({ length: BOARD }, (_, col) => ({ row: 0, col })),
    ...Array.from({ length: BOARD }, (_, col) => ({ row: BOARD - 1, col })),
    ...Array.from({ length: BOARD }, (_, row) => ({ row, col: 0 })),
    ...Array.from({ length: BOARD }, (_, row) => ({ row, col: BOARD - 1 })),
];

const waveDirection = (edge: WaveEdge): Pos =>
    edge === 'top' ? { row: 1, col: 0 } : edge === 'bottom' ? { row: -1, col: 0 } : edge === 'left' ? { row: 0, col: 1 } : { row: 0, col: -1 };

const getWarningHighlights = (skill: TidalSkill, _bossPos: Pos, _playerPos: Pos, extraState: TidalExtraState): Pos[] => {
    const currentWaves = extraState.waves.flatMap(getWaveCells);
    if (skill === 'destruction') { return dedup([...currentWaves, ...ring3x3()]); }
    // wave turn: existing waves keep advancing + 2 new waves from random edges (all 4 shown as possible)
    const cells = dedup([...currentWaves, ...ALL_EDGE_CELLS]);
    if (extraState.destructionStage === 1) { return dedup([...cells, ...ring5x5()]); }
    if (extraState.destructionStage === 2) { return dedup([...cells, ...ring7x7()]); }
    return cells;
};

const getDirectionArrows = (skill: TidalSkill, extraState: TidalExtraState): DirectionArrow[] => {
    const arrows: DirectionArrow[] = [];
    if (skill === 'destruction') { arrows.push(...squareRingArrows(CENTER, 1)); }
    else if (skill === 'wave' && extraState.destructionStage === 1) { arrows.push(...squareRingArrows(CENTER, 2)); }
    // wave lines keep their fixed advance direction (cardinal only), one arrow per cell
    for (const wave of extraState.waves) {
        const dir = waveDirection(wave.edge);
        for (const cell of getWaveCells(wave)) { arrows.push({ pos: cell, dir }); }
    }
    return arrows;
};

export const BossTidalPage = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: { initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string }) => (
    <BossBattlePage<TidalSkill, TidalExtraState, TidalGameMessage>
        roomId={roomId}
        isCreator={isCreator}
        isSpectate={isSpectate}
        initialRole={initialRole}
        initialAction={initialAction}
        config={{
            game: 'boss-tidal',
            bossName: '潮汐',
            bossHealth: 6,
            skillLabels,
            skillDescriptions,
            initialExtraState: { destructionStage: 0, waves: [] },
            getExtraStateFromTurnStart: msg => ({ destructionStage: msg.destructionStage ?? 0, waves: msg.waves ?? [] }),
            getExtraStateFromTurnResult: msg => ({ destructionStage: msg.destructionStage ?? 0, waves: msg.waves ?? [] }),
            getWarningHighlights,
            getDirectionArrows: (skill, _bossPos, _playerPos, extraState) => getDirectionArrows(skill, extraState),
            getSpecialStatusText: (skill, extraState, animPhase, submitted) => {
                if (animPhase !== 'idle' || submitted || skill !== 'wave') { return null; }
                if (extraState.destructionStage === 1) { return '毁灭之环本回合扩散至 5×5 外圈'; }
                if (extraState.destructionStage === 2) { return '毁灭之环本回合扩散至 7×7 外圈'; }
                return null;
            },
        }}
    />
);
