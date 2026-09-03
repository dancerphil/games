import type { Pos, StanceName } from '@games/shared';
import { expansionBackground, expansionBorder } from '@/constants/gameColors';
import { squareRingArrows } from '@/game/aoeArrows';
import type { InitialAction } from '../../hooks/useGameRoom';
import { BossBattlePage } from '../boss/BossBattlePage';

type Boss2Skill = 'whirlwind' | 'wind-blade' | 'eye-of-storm';

const skillLabels: Record<Boss2Skill, string> = {
    'whirlwind': '旋风',
    'wind-blade': '风刃',
    'eye-of-storm': '风眼',
};

const skillDescriptions: Record<Boss2Skill, string> = {
    'whirlwind': '移动一格，以落点为中心攻击 3×3 外圈，之后持续扩散',
    'wind-blade': '原地不动，向四个斜方向释放直线攻击，旋风同时扩散为 5×5 外圈',
    'eye-of-storm': '无直接伤害，旋风扩散为 7×7 外圈',
};

const inBounds = (pos: Pos): boolean => pos.row >= 0 && pos.row < 7 && pos.col >= 0 && pos.col < 7;
const addPos = (left: Pos, right: Pos): Pos => ({ row: left.row + right.row, col: left.col + right.col });
const directions: Pos[] = [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }];

// The whirlwind moves one cardinal step before striking, so every in-bounds landing is a threat.
const whirlwindLandings = (bossPos: Pos): Pos[] => directions.map(direction => addPos(bossPos, direction)).filter(inBounds);

const ring3x3 = (center: Pos): Pos[] => {
    const cells: Pos[] = [];
    for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
        for (let colDelta = -1; colDelta <= 1; colDelta++) {
            if (rowDelta === 0 && colDelta === 0) { continue; }
            const cell = addPos(center, { row: rowDelta, col: colDelta });
            if (inBounds(cell)) { cells.push(cell); }
        }
    }
    return cells;
};

const ring5x5 = (center: Pos): Pos[] => {
    const cells: Pos[] = [];
    for (let rowDelta = -2; rowDelta <= 2; rowDelta++) {
        for (let colDelta = -2; colDelta <= 2; colDelta++) {
            if (Math.abs(rowDelta) <= 1 && Math.abs(colDelta) <= 1) { continue; }
            const cell = addPos(center, { row: rowDelta, col: colDelta });
            if (inBounds(cell)) { cells.push(cell); }
        }
    }
    return cells;
};

const ring7x7 = (center: Pos): Pos[] => {
    const cells: Pos[] = [];
    for (let rowDelta = -3; rowDelta <= 3; rowDelta++) {
        for (let colDelta = -3; colDelta <= 3; colDelta++) {
            if (Math.abs(rowDelta) <= 2 && Math.abs(colDelta) <= 2) { continue; }
            const cell = addPos(center, { row: rowDelta, col: colDelta });
            if (inBounds(cell)) { cells.push(cell); }
        }
    }
    return cells;
};

const fullLine = (center: Pos, direction: Pos): Pos[] => {
    if (direction.row === 0 && direction.col === 0) { return [center]; }
    const cells: Pos[] = [];
    let current = center;
    while (inBounds(current)) {
        cells.push(current);
        current = addPos(current, direction);
    }
    current = addPos(center, { row: -direction.row, col: -direction.col });
    while (inBounds(current)) {
        cells.push(current);
        current = addPos(current, { row: -direction.row, col: -direction.col });
    }
    return cells;
};

const windBladeAreaOfEffect = (bossPos: Pos): Pos[] => {
    const uniqueCells = new Map<string, Pos>();
    const addCells = (cells: Pos[]) => {
        for (const cell of cells) {
            uniqueCells.set(`${cell.row},${cell.col}`, cell);
        }
    };
    addCells(fullLine(bossPos, { row: 1, col: 1 }));
    addCells(fullLine(bossPos, { row: 1, col: -1 }));
    return [...uniqueCells.values()];
};

interface Boss2ExtraState {
    pendingExpansion: Pos | null;
}

interface Boss2GameMessage {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    bossSkill?: Boss2Skill;
    nextBossSkill?: Boss2Skill;
    pendingExpansion?: Pos | null;
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

const dedup = (cells: Pos[]): Pos[] =>
    [...new Map(cells.map(p => [`${p.row},${p.col}`, p])).values()];

const getBoss2WarningHighlights = (skill: Boss2Skill, bossPos: Pos): Pos[] => {
    if (skill === 'eye-of-storm') { return []; }
    if (skill === 'wind-blade') { return windBladeAreaOfEffect(bossPos); }
    // whirlwind: union of the 3×3 rings around every possible landing cell
    return dedup(whirlwindLandings(bossPos).flatMap(ring3x3));
};

export const BossTornadoPage = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: { initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string }) => (
    <BossBattlePage<Boss2Skill, Boss2ExtraState, Boss2GameMessage>
        roomId={roomId}
        isCreator={isCreator}
        isSpectate={isSpectate}
        initialRole={initialRole}
        initialAction={initialAction}
        config={{
            game: 'boss-tornado',
            bossName: '龙卷',
            bossHealth: 6,
            skillLabels,
            skillDescriptions,
            initialExtraState: { pendingExpansion: null },
            getExtraStateFromTurnStart: message => ({ pendingExpansion: message.pendingExpansion ?? null }),
            getExtraStateFromTurnResult: message => ({ pendingExpansion: message.pendingExpansion ?? null }),
            getWarningHighlights: (skill, bossPos) => getBoss2WarningHighlights(skill, bossPos),
            getDirectionArrows: (skill, bossPos, _playerPos, extraState) => {
                // The fired ring expands one radius outward next turn → arrows on each ring cell.
                if (skill === 'whirlwind') { return whirlwindLandings(bossPos).flatMap(landing => squareRingArrows(landing, 1)); }
                if (skill === 'wind-blade' && extraState.pendingExpansion) { return squareRingArrows(extraState.pendingExpansion, 2); }
                return []; // eye-of-storm: 7×7 is terminal, no further expansion
            },
            getSpecialHighlights: (skill, extraState, animPhase, submitted) => {
                if (!extraState.pendingExpansion || animPhase !== 'idle' || submitted) { return []; }
                return skill === 'eye-of-storm' ? ring7x7(extraState.pendingExpansion) : ring5x5(extraState.pendingExpansion);
            },
            getSpecialStatusText: (skill, extraState, animPhase, submitted) => {
                if (!extraState.pendingExpansion || animPhase !== 'idle' || submitted) { return null; }
                return `本回合旋风扩散为${skill === 'eye-of-storm' ? '7×7' : '5×5'}外圈`;
            },
            specialHighlightStyle: { background: expansionBackground, border: expansionBorder },
        }}
    />
);
