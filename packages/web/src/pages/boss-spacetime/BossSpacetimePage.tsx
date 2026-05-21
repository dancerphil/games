import type { Pos, StanceName } from '@games/shared';
import { spacetimeBackground, spacetimeBorder } from '@/constants/gameColors';
import type { InitialAction } from '../../hooks/useGameRoom';
import { BossBattlePage } from '../boss/BossBattlePage';

type SpacetimeSkill = 'cardinal' | 'temporal' | 'boundless';

const skillLabels: Record<SpacetimeSkill, string> = {
    cardinal: '上下四方',
    temporal: '古往今来',
    boundless: '往复无际',
};

const skillDescriptions: Record<SpacetimeSkill, string> = {
    cardinal: '各自移动一格，然后以各自所在列释放竖向直线攻击',
    temporal: '各自移动一格，然后以各自所在行释放横向直线攻击',
    boundless: '两个 Boss 原地不动，以两者为对角构成长方形，长方形的边受到攻击',
};

const rectangleBorder = (pos1: Pos, pos2: Pos): Pos[] => {
    const minRow = Math.min(pos1.row, pos2.row);
    const maxRow = Math.max(pos1.row, pos2.row);
    const minCol = Math.min(pos1.col, pos2.col);
    const maxCol = Math.max(pos1.col, pos2.col);
    const cells: Pos[] = [];
    for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
            if (row === minRow || row === maxRow || col === minCol || col === maxCol) {
                cells.push({ row, col });
            }
        }
    }
    return cells;
};

interface SpacetimeExtraState {
    boss2Pos: Pos;
}

interface SpacetimeGameMessage {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    bossSkill?: SpacetimeSkill;
    nextBossSkill?: SpacetimeSkill;
    boss2Pos?: Pos;
    myCard?: StanceName;
    myMovedTo?: Pos;
    myMovedFrom?: Pos;
    myAttackedAt?: Pos | null;
    bossMovedTo?: Pos;
    bossMovedFrom?: Pos;
    boss2MovedFrom?: Pos;
    boss2MovedTo?: Pos;
    bossAoe?: Pos[];
    iHitBoss?: boolean;
    bossHitMe?: boolean;
    myDamage?: number;
    gameOver?: boolean;
    winner?: 0 | 1 | 'draw';
}

const possibleColumnsAfterMove = (pos: Pos): number[] => {
    const cols = new Set([pos.col]); // up/down keeps same col
    if (pos.col > 0) { cols.add(pos.col - 1); }
    if (pos.col < 6) { cols.add(pos.col + 1); }
    return [...cols];
};

const possibleRowsAfterMove = (pos: Pos): number[] => {
    const rows = new Set([pos.row]); // left/right keeps same row
    if (pos.row > 0) { rows.add(pos.row - 1); }
    if (pos.row < 6) { rows.add(pos.row + 1); }
    return [...rows];
};

const getSpacetimeWarningHighlights = (skill: SpacetimeSkill, bossPos: Pos, _playerPos: Pos, extraState: SpacetimeExtraState): Pos[] => {
    const boss2Pos = extraState.boss2Pos;
    if (skill === 'cardinal') {
        const cols = [...new Set([...possibleColumnsAfterMove(bossPos), ...possibleColumnsAfterMove(boss2Pos)])];
        return cols.flatMap(col => Array.from({ length: 7 }, (_, row) => ({ row, col })));
    }
    if (skill === 'temporal') {
        const rows = [...new Set([...possibleRowsAfterMove(bossPos), ...possibleRowsAfterMove(boss2Pos)])];
        return rows.flatMap(row => Array.from({ length: 7 }, (_, col) => ({ row, col })));
    }
    return rectangleBorder(bossPos, boss2Pos);
};

export const BossSpacetimePage = ({ initialAction }: { initialAction?: InitialAction }) => (
    <BossBattlePage<SpacetimeSkill, SpacetimeExtraState, SpacetimeGameMessage>
        initialAction={initialAction}
        config={{
            game: 'boss-spacetime',
            bossName: '时空',
            bossHealth: 5,
            skillLabels,
            skillDescriptions,
            initialExtraState: { boss2Pos: { row: 5, col: 5 } },
            getExtraStateFromTurnStart: message => ({ boss2Pos: message.boss2Pos ?? { row: 5, col: 5 } }),
            getExtraStateFromTurnResult: message => ({ boss2Pos: message.boss2Pos ?? { row: 5, col: 5 } }),
            getWarningHighlights: (skill, bossPos, playerPos, extraState) => getSpacetimeWarningHighlights(skill, bossPos, playerPos, extraState),
            getBoss2Pos: extraState => extraState.boss2Pos,
            getBoss2AnimData: msg => msg.boss2MovedFrom && msg.boss2MovedTo
                ? { movedFrom: msg.boss2MovedFrom, movedTo: msg.boss2MovedTo }
                : null,
            specialHighlightStyle: { background: spacetimeBackground, border: spacetimeBorder },
        }}
    />
);
