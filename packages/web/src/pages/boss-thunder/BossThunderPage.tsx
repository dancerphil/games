import type { Pos, StanceName } from '@games/shared';
import { lightningBackground, lightningBorder } from '@/constants/gameColors';
import type { InitialAction } from '../../hooks/useGameRoom';
import { BossBattlePage } from '../boss/BossBattlePage';

type Boss3Skill = 'thunder-strike' | 'thunderstorm' | 'thunder-cut';

const skillLabels: Record<Boss3Skill, string> = {
    'thunder-strike': '雷击',
    'thunderstorm': '雷暴',
    'thunder-cut': '雷切',
};

const skillDescriptions: Record<Boss3Skill, string> = {
    'thunder-strike': '移动一格，劈中玩家原地并留下闪电地块',
    'thunderstorm': '移动一格，向玩家靠近，落脚后全屏释放雷暴',
    'thunder-cut': '直线突进三格，对起点到终点的四格造成伤害',
};

const inBounds = (pos: Pos): boolean => pos.row >= 0 && pos.row < 7 && pos.col >= 0 && pos.col < 7;
const addPos = (left: Pos, right: Pos): Pos => ({ row: left.row + right.row, col: left.col + right.col });
const cardinalDirections: Pos[] = [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }];

const thunderCutLine = (start: Pos, end: Pos): Pos[] => {
    const rowStep = Math.sign(end.row - start.row);
    const colStep = Math.sign(end.col - start.col);
    return Array.from({ length: 4 }, (_, index) => ({
        row: start.row + rowStep * index,
        col: start.col + colStep * index,
    })).filter(inBounds);
};

interface Boss3ExtraState {
    lightningCells: Pos[];
}

interface Boss3GameMessage {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    bossSkill?: Boss3Skill;
    nextBossSkill?: Boss3Skill;
    lightningCells?: Pos[];
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

const getThunderstormWarning = (bossPos: Pos): Pos[] => {
    // bossTo is always one cardinal step away, so parity flips
    const parity = (bossPos.row + bossPos.col + 1) % 2;
    const cells: Pos[] = [];
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            if ((row + col) % 2 === parity) { cells.push({ row, col }); }
        }
    }
    return cells;
};

const getThunderCutWarning = (bossPos: Pos): Pos[] => {
    const uniqueCells = new Map<string, Pos>();
    for (const direction of cardinalDirections) {
        const bossTo = addPos(bossPos, { row: 3 * direction.row, col: 3 * direction.col });
        if (!inBounds(bossTo)) { continue; }
        for (const cell of thunderCutLine(bossPos, bossTo)) {
            uniqueCells.set(`${cell.row},${cell.col}`, cell);
        }
    }
    return [...uniqueCells.values()];
};

const getBoss3WarningHighlights = (skill: Boss3Skill, bossPos: Pos, playerPos: Pos): Pos[] => {
    if (skill === 'thunder-strike') { return [playerPos]; }
    if (skill === 'thunderstorm') { return getThunderstormWarning(bossPos); }
    return getThunderCutWarning(bossPos);
};

export const BossThunderPage = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: { initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string }) => (
    <BossBattlePage<Boss3Skill, Boss3ExtraState, Boss3GameMessage>
        roomId={roomId}
        isCreator={isCreator}
        isSpectate={isSpectate}
        initialRole={initialRole}
        initialAction={initialAction}
        config={{
            game: 'boss-thunder',
            bossName: '雷神',
            bossHealth: 6,
            skillLabels,
            skillDescriptions,
            initialExtraState: { lightningCells: [] },
            getExtraStateFromTurnStart: message => ({ lightningCells: message.lightningCells ?? [] }),
            getExtraStateFromTurnResult: message => ({ lightningCells: message.lightningCells ?? [] }),
            getWarningHighlights: (skill, bossPos, playerPos) => getBoss3WarningHighlights(skill, bossPos, playerPos),
            getSpecialHighlights: (_skill, extraState) => extraState.lightningCells,
            getSpecialStatusText: (_skill, extraState) => extraState.lightningCells.length > 0 ? '闪电地块持续存在，踩入会受击' : null,
            specialHighlightStyle: { background: lightningBackground, border: lightningBorder },
        }}
    />
);
