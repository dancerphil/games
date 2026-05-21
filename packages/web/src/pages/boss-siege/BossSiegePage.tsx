import type { Pos, StanceName } from '@games/shared';
import { getMoveOptions, getAttackOptions, getHitCells, isNoMove } from '@/game/stanceRules';
import type { InitialAction } from '../../hooks/useGameRoom';
import { BossBattlePage } from '../boss/BossBattlePage';

type SiegeSkill = 'crane' | 'tiger' | 'dragon';

const skillLabels: Record<SiegeSkill, string> = {
    crane: '鹤',
    tiger: '虎',
    dragon: '龙',
};

const skillDescriptions: Record<SiegeSkill, string> = {
    crane: '直向一步，前后攻击',
    tiger: '直向一步，前后攻击点中选一格，命中时横扫三格',
    dragon: '不移动，选择 5×5 外圈中的一格攻击',
};

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

interface SiegeExtraState {
    bossPositions: Pos[];
}

interface SiegeGameMessage {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    bossSkill?: SiegeSkill;
    nextBossSkill?: SiegeSkill;
    bossPositions?: Pos[];
    bossMovements?: Array<{ movedFrom: Pos; movedTo: Pos }>;
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

const getWarningHighlights = (skill: SiegeSkill, _bossPos: Pos, _playerPos: Pos, extraState: SiegeExtraState): Pos[] => {
    const allHitCells: Pos[] = [];
    for (const bossPos of extraState.bossPositions) {
        const moveOptions = isNoMove(skill) ? [bossPos] : getMoveOptions(skill, bossPos, 1);
        const destinations = moveOptions.length > 0 ? moveOptions : [bossPos];
        for (const movedTo of destinations) {
            const attackOptions = getAttackOptions(skill, movedTo, 1, bossPos);
            for (const attackAt of attackOptions) {
                allHitCells.push(...getHitCells(skill, attackAt, movedTo, 1, bossPos));
            }
        }
    }
    return dedup(allHitCells);
};

export const BossSiegePage = ({ initialAction }: { initialAction?: InitialAction }) => (
    <BossBattlePage<SiegeSkill, SiegeExtraState, SiegeGameMessage>
        initialAction={initialAction}
        config={{
            game: 'boss-siege',
            bossName: '围攻',
            bossHealth: 5,
            skillLabels,
            skillDescriptions,
            initialExtraState: { bossPositions: INITIAL_BOSS_POSITIONS },
            getExtraStateFromTurnStart: msg => ({ bossPositions: msg.bossPositions ?? INITIAL_BOSS_POSITIONS }),
            getExtraStateFromTurnResult: (msg, prev) => ({ bossPositions: msg.bossPositions ?? prev.bossPositions }),
            getWarningHighlights,
            getAllBossPositions: extraState => extraState.bossPositions,
            getAllBossAnimData: msg => msg.bossMovements ?? [],
        }}
    />
);
