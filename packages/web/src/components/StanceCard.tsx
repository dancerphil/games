import { Badge, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import type { Pos, StanceName } from '@games/shared';
import { STANCES, makeContext, skillAttackTargets, skillHitCells, skillMoveOptions } from '@games/shared';
const stanceCardCtx = (pi: number, from: import('@games/shared').Pos, to: import('@games/shared').Pos, opponent: import('@games/shared').Pos) => makeContext({ from, to, playerIndex: pi as 0 | 1, opponent });
const getMoveOptions = (card: import('@games/shared').StanceName, pos: import('@games/shared').Pos, pi: number): import('@games/shared').Pos[] => skillMoveOptions(STANCES[card], stanceCardCtx(pi, pos, pos, pos));
const getAttackOptions = (card: import('@games/shared').StanceName, pos: import('@games/shared').Pos, pi: number, originalPos?: import('@games/shared').Pos): import('@games/shared').Pos[] => skillAttackTargets(STANCES[card], stanceCardCtx(pi, originalPos ?? pos, pos, pos));
const getHitCells = (card: import('@games/shared').StanceName, attackAt: import('@games/shared').Pos | null, pos: import('@games/shared').Pos, pi: number, originalPos?: import('@games/shared').Pos): import('@games/shared').Pos[] => skillHitCells(STANCES[card], stanceCardCtx(pi, originalPos ?? pos, pos, pos), attackAt);
import {
    areaOfEffectBackground,
    attackBackground,
    boardCellBackground,
    cardBackground,
    cardSelectedBackground,
    enemyRed,
    moveBackground,
    neutralBorder,
    playerBlue,
} from '@/constants/gameColors';

const PREVIEW_ROWS = 6;
const PREVIEW_COLS = 5;
const PREVIEW_ORIGIN: Pos = { row: 3, col: 2 };
const RULE_ORIGIN: Pos = { row: 3, col: 3 };

export const STANCE_LABELS: Record<StanceName, string> = {
    snake: '蛇',
    crane: '鹤',
    leopard: '豹',
    tiger: '虎',
    dragon: '龙',
    turtle: '龟',
    horse: '马',
    charge: '凝',
    dodge: '闪',
    crab: '蟹',
    monkey: '猴',
    ox: '牛',
    dog: '狗',
};

export const STANCE_DESCRIPTIONS: Record<StanceName, string> = {
    snake: '斜向一步，侧向攻击',
    crane: '直向一步，前后攻击',
    leopard: '直向两步，前后攻击',
    tiger: '直向一步，前后攻击点中选一格，命中时横扫三格',
    dragon: '不移动，选择 5×5 外圈中的一格攻击',
    turtle: '不移动，选择 3×3 中的一格攻击',
    horse: '马步走，前后攻击',
    charge: '不移动不攻击，下一招额外造成 1 点伤害',
    dodge: '向任意方向移动一格，本回合免疫伤害',
    crab: '斜向一步，除来路外三个斜向位置选一格攻击',
    monkey: '直向两步，攻击自己的落点',
    ox: '直向一步，选择一格攻击并横扫垂直三格',
    dog: '直向一步，往回斜向选一格攻击',
};

const STANCE_EXTRA_NOTES: Partial<Record<StanceName, string>> = {
    charge: '效果：下一招额外造成 1 点伤害',
    dodge: '效果：本回合免疫伤害',
};

const eqPos = (left: Pos, right: Pos): boolean => left.row === right.row && left.col === right.col;

const pickPreviewTarget = (options: Pos[], origin: Pos): Pos | null => {
    if (options.length === 0) return null;
    const [target] = [...options].sort((left, right) => {
        const score = (pos: Pos): number => {
            if (pos.col === origin.col && pos.row < origin.row) return 0;
            if (pos.row < origin.row && pos.col > origin.col) return 1;
            if (pos.col > origin.col) return 2;
            if (pos.row > origin.row && pos.col > origin.col) return 3;
            if (pos.row > origin.row) return 4;
            return 5;
        };
        const scoreDiff = score(left) - score(right);
        if (scoreDiff !== 0) return scoreDiff;
        const distanceDiff = Math.abs(left.row - origin.row) + Math.abs(left.col - origin.col)
            - (Math.abs(right.row - origin.row) + Math.abs(right.col - origin.col));
        if (distanceDiff !== 0) return distanceDiff;
        return left.row - right.row || left.col - right.col;
    });
    return target;
};

export const getStanceCooldown = (stance: StanceName, discard: StanceName[]): number =>
    stance === discard[1] ? 2 : stance === discard[0] ? 1 : 0;

interface PreviewData {
    moveOptions: Pos[];
    previewMove: Pos | null;
    attackOptions: Pos[];
    previewAttack: Pos | null;
    hitCells: Pos[];
    previewOrigin: Pos;
    ruleOrigin: Pos;
}

const getPreviewData = (stance: StanceName, playerIndex: 0 | 1): PreviewData => {
    const moveOptions = getMoveOptions(stance, RULE_ORIGIN, playerIndex);
    const previewMove = pickPreviewTarget(moveOptions, RULE_ORIGIN);
    const boardPos = previewMove ?? RULE_ORIGIN;
    const attackOptions = getAttackOptions(stance, boardPos, playerIndex, previewMove ? RULE_ORIGIN : undefined);
    const previewAttack = pickPreviewTarget(attackOptions, boardPos);
    const hitCells = previewAttack ? getHitCells(stance, previewAttack, boardPos, playerIndex, previewMove ? RULE_ORIGIN : undefined) : [];
    return { moveOptions, previewMove, attackOptions, previewAttack, hitCells, previewOrigin: PREVIEW_ORIGIN, ruleOrigin: RULE_ORIGIN };
};

const stripe = (c1: string, c2: string) => `repeating-linear-gradient(135deg, ${c1} 0 2px, ${c1} 2px 4px, ${c2} 4px 6px, ${c2} 6px 8px)`;

interface StanceCardProps {
    stance: StanceName;
    playerIndex?: 0 | 1;
    selected?: boolean;
    disabled?: boolean;
    cooldown?: number;
    onClick?: () => void;
}

export const StanceCard = ({
    stance,
    playerIndex = 0,
    selected = false,
    disabled = false,
    cooldown = 0,
    onClick,
}: StanceCardProps) => {
    const { moveOptions, previewMove, attackOptions, previewAttack, hitCells, previewOrigin, ruleOrigin } = getPreviewData(stance, playerIndex);
    const extraNote = STANCE_EXTRA_NOTES[stance];
    const statusLabel = cooldown > 0 ? `冷却 ${cooldown}` : selected ? '已选中' : null;
    const toPreviewPos = (cell: Pos): Pos => ({
        row: previewOrigin.row + (cell.row - ruleOrigin.row),
        col: previewOrigin.col + (cell.col - ruleOrigin.col),
    });

    return (
        <UnstyledButton
            onClick={onClick}
            disabled={disabled}
            style={{
                width: '100%',
                display: 'block',
                cursor: disabled ? 'not-allowed' : onClick ? 'pointer' : 'default',
            }}
        >
            <Stack
                gap={8}
                p={10}
                style={{
                    aspectRatio: '2 / 3',
                    borderRadius: 14,
                    border: `1px solid ${neutralBorder}`,
                    outline: selected ? `2px solid ${playerBlue}` : 'none',
                    background: selected ? cardSelectedBackground : cardBackground,
                    boxShadow: selected ? '0 8px 18px rgba(59, 130, 246, 0.16)' : '0 4px 12px rgba(15, 23, 42, 0.08)',
                    opacity: disabled ? 0.58 : 1,
                    transition: '120ms ease',
                    overflow: 'hidden',
                }}
            >
                <Group justify="center" gap={6} wrap="nowrap">
                    <Text fw={800} size="sm">{STANCE_LABELS[stance]}</Text>
                    {statusLabel && (
                        <Badge
                            size="xs"
                            color={cooldown > 0 ? 'gray' : 'blue'}
                            variant={cooldown > 0 ? 'filled' : 'light'}
                        >
                            {statusLabel}
                        </Badge>
                    )}
                </Group>

                <div
                    style={{
                        width: '80%',
                        alignSelf: 'center',
                        aspectRatio: `${PREVIEW_COLS} / ${PREVIEW_ROWS}`,
                        borderRadius: 8,
                        border: `1px solid ${neutralBorder}`,
                        background: '#ffffff',
                        padding: 4,
                        boxSizing: 'border-box',
                        flexShrink: 0,
                    }}
                >
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PREVIEW_COLS}, 1fr)`, gridTemplateRows: `repeat(${PREVIEW_ROWS}, 1fr)`, gap: 2, height: '100%' }}>
                        {Array.from({ length: PREVIEW_ROWS * PREVIEW_COLS }, (_, index) => {
                            const pos = { row: Math.floor(index / PREVIEW_COLS), col: index % PREVIEW_COLS };
                            const isOrigin = eqPos(pos, previewOrigin);
                            const isMove = moveOptions.some(option => eqPos(toPreviewPos(option), pos));
                            const isPreviewMove = previewMove ? eqPos(toPreviewPos(previewMove), pos) : false;
                            const isAttackOption = attackOptions.some(option => eqPos(toPreviewPos(option), pos));
                            const isPreviewAttack = previewAttack ? eqPos(toPreviewPos(previewAttack), pos) : false;
                            const isHit = hitCells.some(cell => eqPos(toPreviewPos(cell), pos));

                            let background = boardCellBackground;

                            if (isAttackOption) {
                                if (isMove) {
                                    background = stripe(moveBackground, attackBackground);
                                }
                                else {
                                    background = attackBackground;
                                }
                            }
                            else if (isHit) {
                                if (isMove) {
                                    background = stripe(moveBackground, areaOfEffectBackground);
                                }
                                else {
                                    background = areaOfEffectBackground;
                                }
                            }
                            else if (isMove) {
                                background = moveBackground;
                            }

                            let boxShadow = 'inset 0 0 0 1px rgba(0, 0, 0, 0.08)';
                            if (isPreviewMove) {
                                boxShadow = `inset 0 0 0 2px ${playerBlue}`;
                            }
                            else if (isPreviewAttack) {
                                boxShadow = `inset 0 0 0 2px ${enemyRed}`;
                            }

                            return (
                                <div
                                    key={index}
                                    style={{
                                        position: 'relative',
                                        borderRadius: 3,
                                        background,
                                        boxShadow,
                                    }}
                                >
                                    {isOrigin && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                inset: '22%',
                                                borderRadius: '50%',
                                                background: '#0f172a',
                                            }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <Stack gap={4} align="center" style={{ overflow: 'hidden' }}>
                    <Text size="10px" c="dimmed" ta="center" style={{ lineHeight: 1.35, overflow: 'hidden' }}>
                        {STANCE_DESCRIPTIONS[stance]}
                    </Text>
                    {extraNote && (
                        <Text size="10px" fw={600} ta="center" c={stance === 'dodge' ? 'cyan.7' : 'blue.7'} style={{ lineHeight: 1.35, overflow: 'hidden' }}>
                            {extraNote}
                        </Text>
                    )}
                </Stack>
            </Stack>
        </UnstyledButton>
    );
};
