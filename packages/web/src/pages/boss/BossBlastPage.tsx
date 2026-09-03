import type { Pos } from '@games/shared';
import type { InitialAction } from '../../hooks/useGameRoom';
import { BossBattlePage } from './BossBattlePage';

type BossSkill = 'snipe' | 'bombard' | 'burst';

const skillLabels: Record<BossSkill, string> = {
    snipe: '狙击',
    bombard: '轰击',
    burst: '爆裂',
};

const skillDescriptions: Record<BossSkill, string> = {
    snipe: '不移动，直线全行或全列 7 格攻击',
    bombard: '移动一格，向前方 3×3 范围轰击（不含落点）',
    burst: '原地不动，自身周围 3×3 范围攻击',
};

const getBossAreaOfEffectWarning = (skill: BossSkill, bossPos: Pos): Pos[] => {
    if (skill === 'snipe') {
        return [
            ...Array.from({ length: 7 }, (_, col) => ({ row: bossPos.row, col })),
            ...Array.from({ length: 7 }, (_, row) => ({ row, col: bossPos.col })),
        ];
    }

    if (skill === 'bombard') {
        const cells: Pos[] = [];
        const directions: Pos[] = [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }];
        for (const direction of directions) {
            const bossTo = { row: bossPos.row + direction.row, col: bossPos.col + direction.col };
            if (bossTo.row < 0 || bossTo.row >= 7 || bossTo.col < 0 || bossTo.col >= 7) { continue; }
            const center = { row: bossTo.row + direction.row, col: bossTo.col + direction.col };
            for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
                for (let colDelta = -1; colDelta <= 1; colDelta++) {
                    const cell = { row: center.row + rowDelta, col: center.col + colDelta };
                    if (cell.row >= 0 && cell.row < 7 && cell.col >= 0 && cell.col < 7 && !(cell.row === bossTo.row && cell.col === bossTo.col)) {
                        cells.push(cell);
                    }
                }
            }
        }
        return cells;
    }

    const cells: Pos[] = [];
    for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
        for (let colDelta = -1; colDelta <= 1; colDelta++) {
            const cell = { row: bossPos.row + rowDelta, col: bossPos.col + colDelta };
            if (cell.row >= 0 && cell.row < 7 && cell.col >= 0 && cell.col < 7) { cells.push(cell); }
        }
    }
    return cells;
};

interface BossGameMessage {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: import('@games/shared').StanceName[];
    discard?: import('@games/shared').StanceName[];
    turn?: number;
    bossSkill?: BossSkill;
    nextBossSkill?: BossSkill;
    myCard?: import('@games/shared').StanceName;
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

export const BossBlastPage = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: { initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string }) => (
    <BossBattlePage<BossSkill, Record<string, never>, BossGameMessage>
        roomId={roomId}
        isCreator={isCreator}
        isSpectate={isSpectate}
        initialRole={initialRole}
        initialAction={initialAction}
        config={{
            game: 'boss-blast',
            bossName: '爆破',
            bossHealth: 5,
            skillLabels,
            skillDescriptions,
            initialExtraState: {},
            getExtraStateFromTurnStart: () => ({}),
            getExtraStateFromTurnResult: () => ({}),
            getWarningHighlights: (skill, bossPos) => getBossAreaOfEffectWarning(skill, bossPos),
        }}
    />
);
