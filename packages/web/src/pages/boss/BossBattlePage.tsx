import { useCallback, useRef, useState } from 'react';
import { Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Pos, StanceName } from '@games/shared';
import { ALL_STANCES, eqPos } from '@games/shared';
import { getAttackOptions, getHitCells, getMoveOptions, isCharge } from '@/game/stanceRules';
import {
    actionOrange,
    areaOfEffectBackground,
    areaOfEffectBorder,
    attackBackground,
    boardCellBackground,
    emptyHealthBackground,
    enemyRed,
    moveBackground,
    neutralBorder,
    playerBlue,
    warningBackground,
} from '@/constants/gameColors';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { StanceCard, STANCE_LABELS, getStanceCooldown } from '../../components/StanceCard';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { GameType, InitialAction } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';

const deckPresetKey = (game: string) => `boss-deck-preset-${game}`;

const loadDeckPreset = (game: string): StanceName[] | null => {
    try {
        const saved = localStorage.getItem(deckPresetKey(game));
        return saved ? JSON.parse(saved) : null;
    } catch { return null; }
};

const saveDeckPreset = (game: string, deck: StanceName[]) => {
    localStorage.setItem(deckPresetKey(game), JSON.stringify(deck));
};

const boardPixelSize = 7 * 40 + 6 * 2;
const boardStep = 42;

const cellCenter = (pos: Pos) => ({ x: pos.col * boardStep + 20, y: pos.row * boardStep + 20 });

export interface Arrow {
    from: Pos;
    to: Pos;
    color: string;
}

// A small arrow drawn inside a single cell, pointing in one of 8 directions.
export interface DirectionArrow {
    pos: Pos;
    dir: Pos;
}

const directionArrowColor = '#ef4444';

interface BossBoardProps {
    positions: [Pos, Pos];
    playerDisplayPos?: Pos;
    boss2Pos?: Pos;
    allBossPositions?: Pos[];
    moveHighlights?: Pos[];
    attackHighlights?: Pos[];
    areaOfEffectHighlights?: Pos[];
    warningHighlights?: Pos[];
    specialHighlights?: Pos[];
    specialBackground?: string;
    specialBorder?: string;
    animatedAttacks?: Pos[];
    animatedBossAreaOfEffect?: Pos[];
    arrows?: Arrow[];
    directionArrows?: DirectionArrow[];
    onCellClick?: (pos: Pos) => void;
}

const BossBoard = ({
    positions,
    playerDisplayPos,
    boss2Pos,
    allBossPositions,
    moveHighlights = [],
    attackHighlights = [],
    areaOfEffectHighlights = [],
    warningHighlights = [],
    specialHighlights = [],
    specialBackground = warningBackground,
    specialBorder = areaOfEffectBorder,
    animatedAttacks = [],
    animatedBossAreaOfEffect = [],
    arrows = [],
    directionArrows = [],
    onCellClick,
}: BossBoardProps) => {
    const cells = Array.from({ length: 49 }, (_, index) => {
        const pos = { row: Math.floor(index / 7), col: index % 7 };
        const isPlayer = eqPos(playerDisplayPos ?? positions[0], pos);
        const bossPosArray = allBossPositions ?? [positions[1], ...(boss2Pos != null ? [boss2Pos] : [])];
        const anyBoss = bossPosArray.some(p => eqPos(p, pos));
        const isMove = !isPlayer && moveHighlights.some(highlight => eqPos(highlight, pos));
        const isAttack = attackHighlights.some(highlight => eqPos(highlight, pos));
        const isAreaOfEffect = areaOfEffectHighlights.some(highlight => eqPos(highlight, pos));
        const isWarning = warningHighlights.some(highlight => eqPos(highlight, pos));
        const isSpecial = specialHighlights.some(highlight => eqPos(highlight, pos));
        const isAnimatedAttack = animatedAttacks.some(highlight => eqPos(highlight, pos));
        const isAnimatedBossAreaOfEffect = animatedBossAreaOfEffect.some(highlight => eqPos(highlight, pos));

        let background = boardCellBackground;
        if (isAnimatedBossAreaOfEffect || isAnimatedAttack) { background = actionOrange; }
        else if (isAttack) { background = attackBackground; }
        else if (isAreaOfEffect) { background = areaOfEffectBackground; }
        else if (isMove) { background = moveBackground; }
        else if (isSpecial) { background = specialBackground; }
        else if (isWarning) { background = warningBackground; }

        const border = isAnimatedBossAreaOfEffect || isAnimatedAttack ? `2px solid ${actionOrange}`
            : isAttack ? `2px solid ${enemyRed}`
                : isAreaOfEffect ? `2px solid ${areaOfEffectBorder}`
                    : isMove ? `2px solid ${playerBlue}`
                        : isSpecial ? `2px solid ${specialBorder}`
                            : isWarning ? `1px solid ${areaOfEffectBorder}`
                                : `1px solid ${neutralBorder}`;
        const clickable = isMove || isAttack;

        return (
            <div
                key={index}
                onClick={() => { if (clickable) { onCellClick?.(pos); } }}
                style={{
                    width: 40,
                    height: 40,
                    background,
                    border,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: clickable ? 'pointer' : 'default',
                }}
            >
                {isPlayer && !anyBoss && <div style={{ width: 34, height: 34, borderRadius: '50%', background: playerBlue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>我</div>}
                {anyBoss && !isPlayer && <div style={{ width: 34, height: 34, borderRadius: '50%', background: enemyRed, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0 }}>Boss</div>}
                {isPlayer && anyBoss && (
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: enemyRed, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: playerBlue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff' }}>我</div>
                    </div>
                )}
            </div>
        );
    });

    return (
        <div style={{ position: 'relative', width: boardPixelSize, height: boardPixelSize }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 40px)', gap: 2 }}>
                {cells}
            </div>
            {(arrows.length > 0 || directionArrows.length > 0) && (
                <svg style={{ position: 'absolute', top: 0, left: 0, width: boardPixelSize, height: boardPixelSize, pointerEvents: 'none' }} viewBox={`0 0 ${boardPixelSize} ${boardPixelSize}`}>
                    <defs>
                        <marker id="boss-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L8,3 z" fill="context-stroke" />
                        </marker>
                        <marker id="boss-dir-arrowhead" markerUnits="userSpaceOnUse" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                            <path d="M0,0 L0,7 L7,3.5 z" fill="context-stroke" />
                        </marker>
                    </defs>
                    {directionArrows.map((arrow, index) => {
                        const center = cellCenter(arrow.pos);
                        const length = Math.hypot(arrow.dir.row, arrow.dir.col) || 1;
                        const unitX = arrow.dir.col / length;
                        const unitY = arrow.dir.row / length;
                        const half = 11;
                        return (
                            <line
                                key={`dir-${index}`}
                                x1={center.x - unitX * half}
                                y1={center.y - unitY * half}
                                x2={center.x + unitX * half}
                                y2={center.y + unitY * half}
                                stroke={directionArrowColor}
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                markerEnd="url(#boss-dir-arrowhead)"
                            />
                        );
                    })}
                    {arrows.map((arrow, index) => {
                        const from = cellCenter(arrow.from);
                        const to = cellCenter(arrow.to);
                        const deltaX = to.x - from.x;
                        const deltaY = to.y - from.y;
                        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                        if (distance < 1) { return null; }
                        const unitX = deltaX / distance;
                        const unitY = deltaY / distance;
                        const x2 = to.x - unitX * 18;
                        const y2 = to.y - unitY * 18;
                        return (
                            <line
                                key={index}
                                x1={from.x}
                                y1={from.y}
                                x2={x2}
                                y2={y2}
                                stroke={arrow.color}
                                strokeWidth="3"
                                strokeLinecap="round"
                                markerEnd="url(#boss-arrowhead)"
                            />
                        );
                    })}
                </svg>
            )}
        </div>
    );
};

interface BossBattleMessage<TBossSkill extends string> {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    bossSkill?: TBossSkill;
    nextBossSkill?: TBossSkill;
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

interface BossAnimationData {
    arrows: Arrow[];
    prePositions: [Pos, Pos];
    myTo: Pos;
    bossTo: Pos;
    attacks: Pos[];
    bossAreaOfEffect: Pos[];
}

interface BossBattleConfig<TBossSkill extends string, TExtraState, TBossMessage extends BossBattleMessage<TBossSkill>> {
    game: GameType;
    bossName: string;
    bossHealth: number;
    skillLabels: Record<TBossSkill, string>;
    skillDescriptions: Record<TBossSkill, string>;
    initialExtraState: TExtraState;
    getExtraStateFromTurnStart: (msg: TBossMessage) => TExtraState;
    getExtraStateFromTurnResult: (msg: TBossMessage, currentExtraState: TExtraState) => TExtraState;
    getWarningHighlights: (skill: TBossSkill, bossPos: Pos, playerPos: Pos, extraState: TExtraState) => Pos[];
    getSpecialHighlights?: (skill: TBossSkill | null, extraState: TExtraState, animPhase: 'idle' | 'moving' | 'attacking', submitted: boolean) => Pos[];
    getSpecialStatusText?: (skill: TBossSkill | null, extraState: TExtraState, animPhase: 'idle' | 'moving' | 'attacking', submitted: boolean) => string | null;
    specialHighlightStyle?: { background: string; border: string };
    getStaticArrows?: (skill: TBossSkill | null, bossPos: Pos, playerPos: Pos, extraState: TExtraState) => Arrow[];
    getDirectionArrows?: (skill: TBossSkill, bossPos: Pos, playerPos: Pos, extraState: TExtraState) => DirectionArrow[];
    getBoss2Pos?: (extraState: TExtraState) => Pos | null;
    getBoss2AnimData?: (msg: TBossMessage) => { movedFrom: Pos; movedTo: Pos } | null;
    getAllBossPositions?: (extraState: TExtraState) => Pos[];
    getAllBossAnimData?: (msg: TBossMessage) => Array<{ movedFrom: Pos; movedTo: Pos }>;
}

interface BossBattlePageProps<TBossSkill extends string, TExtraState, TBossMessage extends BossBattleMessage<TBossSkill>> {
    initialAction?: InitialAction;
    config: BossBattleConfig<TBossSkill, TExtraState, TBossMessage>;
}

export const BossBattlePage = <TBossSkill extends string, TExtraState, TBossMessage extends BossBattleMessage<TBossSkill>>({
    initialAction,
    config,
}: BossBattlePageProps<TBossSkill, TExtraState, TBossMessage>) => {
    const [nickname] = useNickname();
    const [subPhase, setSubPhase] = useState<'deck_selection' | 'playing' | 'ended'>('deck_selection');
    const [deckChoice, setDeckChoice] = useState<Set<StanceName>>(new Set());
    const [deckPreset, setDeckPreset] = useState<StanceName[] | null>(() => loadDeckPreset(config.game));
    const [editingDeck, setEditingDeck] = useState(() => loadDeckPreset(config.game) === null);
    const [positions, setPositions] = useState<[Pos, Pos]>([{ row: 3, col: 1 }, { row: 3, col: 5 }]);
    const [hp, setHp] = useState<[number, number]>([2, config.bossHealth]);
    const [hand, setHand] = useState<StanceName[]>([]);
    const [discard, setDiscard] = useState<StanceName[]>([]);
    const [bossSkill, setBossSkill] = useState<TBossSkill | null>(null);
    const [extraState, setExtraState] = useState<TExtraState>(config.initialExtraState);
    const [revealedSkills, setRevealedSkills] = useState<Set<TBossSkill>>(new Set());
    const [submitted, setSubmitted] = useState(false);
    const [lastResult, setLastResult] = useState<{ myCard: StanceName; iHitBoss: boolean; bossHitMe: boolean; myDamage: number } | null>(null);
    const [actionStep, setActionStep] = useState<'card' | 'move' | 'attack' | null>(null);
    const [selectedCard, setSelectedCard] = useState<StanceName | null>(null);
    const [previewPos, setPreviewPos] = useState<Pos | null>(null);
    const [animPhase, setAnimPhase] = useState<'idle' | 'moving' | 'attacking'>('idle');
    const [attackDisplay, setAttackDisplay] = useState<Pos[]>([]);
    const [animatedBossAreaOfEffect, setAnimatedBossAreaOfEffect] = useState<Pos[]>([]);
    const [animatedArrows, setAnimatedArrows] = useState<Arrow[]>([]);
    const [lastAnimationData, setLastAnimationData] = useState<BossAnimationData | null>(null);
    const setGameEndedRef = useRef<() => void>(() => {});

    const resetGame = useCallback(() => {
        setSubPhase('deck_selection');
        setDeckChoice(new Set());
        setEditingDeck(false);
        setPositions([{ row: 3, col: 1 }, { row: 3, col: 5 }]);
        setHp([2, config.bossHealth]);
        setHand([]);
        setDiscard([]);
        setBossSkill(null);
        setExtraState(config.initialExtraState);
        setRevealedSkills(new Set());
        setSubmitted(false);
        setLastResult(null);
        setActionStep(null);
        setSelectedCard(null);
        setPreviewPos(null);
        setAnimPhase('idle');
        setAttackDisplay([]);
        setAnimatedBossAreaOfEffect([]);
        setAnimatedArrows([]);
        setLastAnimationData(null);
    }, [config.bossHealth, config.initialExtraState]);

    const handleGameMessage = useCallback((msg: TBossMessage) => {
        if (msg.type === 'game_start') {
            if (msg.phase === 'deck_selection') { setSubPhase('deck_selection'); }
            return;
        }
        if (msg.type === 'boss_turn_start') {
            setPositions(msg.positions!);
            setHp(msg.hp!);
            setHand(msg.hand!);
            setDiscard(msg.discard!);
            setBossSkill(msg.bossSkill!);
            setExtraState(config.getExtraStateFromTurnStart(msg));
            setSubPhase('playing');
            setActionStep('card');
            setSubmitted(false);
            setLastResult(null);
            return;
        }
        if (msg.type !== 'boss_turn_result') { return; }

        const myMovedTo = msg.myMovedTo!;
        const bossMovedTo = msg.bossMovedTo!;
        const attacks = getHitCells(msg.myCard!, msg.myAttackedAt ?? null, myMovedTo, 0, msg.myMovedFrom);
        const bossAreaOfEffect = msg.bossAoe ?? [];
        const playerArrow = { from: msg.myMovedFrom!, to: myMovedTo, color: '#22c55e' };
        const bossArrow = msg.bossMovedFrom && !eqPos(msg.bossMovedFrom, bossMovedTo)
            ? { from: msg.bossMovedFrom, to: bossMovedTo, color: actionOrange }
            : null;
        const boss2AnimData = config.getBoss2AnimData?.(msg) ?? null;
        const boss2Arrow = boss2AnimData && !eqPos(boss2AnimData.movedFrom, boss2AnimData.movedTo)
            ? { from: boss2AnimData.movedFrom, to: boss2AnimData.movedTo, color: actionOrange }
            : null;
        const allBossArrows = (config.getAllBossAnimData?.(msg) ?? [])
            .filter(data => !eqPos(data.movedFrom, data.movedTo))
            .map(data => ({ from: data.movedFrom, to: data.movedTo, color: actionOrange }));
        const arrows = [playerArrow, ...(bossArrow ? [bossArrow] : []), ...(boss2Arrow ? [boss2Arrow] : []), ...allBossArrows];
        const newExtraState = config.getExtraStateFromTurnResult(msg, extraState);

        setPositions([myMovedTo, bossMovedTo]);
        setExtraState(newExtraState);
        setAnimatedArrows(arrows);
        setAnimPhase('moving');
        setTimeout(() => {
            setAnimatedArrows([]);
            setAttackDisplay(attacks);
            setAnimatedBossAreaOfEffect(bossAreaOfEffect);
            setAnimPhase('attacking');
            setTimeout(() => {
                setAnimPhase('idle');
                setAttackDisplay([]);
                setAnimatedBossAreaOfEffect([]);
                setPositions(msg.positions!);
                setHp(msg.hp!);
                setLastResult({
                    myCard: msg.myCard!,
                    iHitBoss: msg.iHitBoss!,
                    bossHitMe: msg.bossHitMe!,
                    myDamage: msg.myDamage ?? 1,
                });
                setLastAnimationData({
                    arrows,
                    prePositions: [msg.myMovedFrom!, msg.bossMovedFrom ?? bossMovedTo],
                    myTo: myMovedTo,
                    bossTo: bossMovedTo,
                    attacks,
                    bossAreaOfEffect,
                });
                setRevealedSkills(prev => new Set([...prev, msg.bossSkill!]));
                if (msg.gameOver) {
                    setSubPhase('ended');
                    setGameEndedRef.current();
                } else {
                    setHand(msg.hand as StanceName[]);
                    setDiscard(msg.discard as StanceName[]);
                    setBossSkill(msg.nextBossSkill!);
                    setSubmitted(false);
                    setActionStep('card');
                    setSelectedCard(null);
                    setPreviewPos(null);
                }
            }, 700);
        }, 700);
    }, [config, extraState]); // eslint-disable-line react-hooks/exhaustive-deps

    const { connected, phase, send, rematch, setGameEnded, rematchRequests, totalScores } =
        useGameRoom<TBossMessage>({ game: config.game, nickname, onGameMessage: handleGameMessage, onReset: resetGame, initialAction });

    setGameEndedRef.current = setGameEnded;

    const startWithPreset = useCallback(() => {
        if (!deckPreset) { return; }
        send({ type: 'move', stances: deckPreset });
    }, [deckPreset, send]);

    const saveAndStart = useCallback(() => {
        if (deckChoice.size !== 5) { return; }
        const deck = [...deckChoice];
        saveDeckPreset(config.game, deck);
        setDeckPreset(deck);
        setEditingDeck(false);
        send({ type: 'move', stances: deck });
    }, [deckChoice, config.game, send]);

    const toggleStance = useCallback((stance: StanceName) => {
        setDeckChoice(previousChoice => {
            const nextChoice = new Set(previousChoice);
            if (nextChoice.has(stance)) { nextChoice.delete(stance); }
            else if (nextChoice.size < 5) { nextChoice.add(stance); }
            return nextChoice;
        });
    }, []);

    const selectCard = useCallback((card: StanceName) => {
        if (submitted || actionStep !== 'card') { return; }
        setSelectedCard(card);
        if (isCharge(card)) {
            send({ type: 'move', card, moveTo: positions[0], attackAt: null });
            setSubmitted(true);
            setActionStep(null);
            return;
        }
        const moveOptions = getMoveOptions(card, positions[0], 0);
        if (moveOptions.length === 0) {
            setPreviewPos(positions[0]);
            if (getAttackOptions(card, positions[0], 0).length === 0) {
                send({ type: 'move', card, moveTo: positions[0], attackAt: null });
                setSubmitted(true);
                setActionStep(null);
            } else {
                setActionStep('attack');
            }
        } else {
            setActionStep('move');
        }
    }, [submitted, actionStep, positions, send]);

    const handleCellClick = useCallback((pos: Pos) => {
        if (!selectedCard) { return; }
        if (actionStep === 'move') {
            setPreviewPos(pos);
            const attackOptions = getAttackOptions(selectedCard, pos, 0, positions[0]);
            if (attackOptions.length === 0) {
                send({ type: 'move', card: selectedCard, moveTo: pos, attackAt: null });
                setSubmitted(true);
                setActionStep(null);
            } else {
                setActionStep('attack');
            }
            return;
        }
        if (actionStep === 'attack') {
            send({ type: 'move', card: selectedCard, moveTo: previewPos ?? positions[0], attackAt: pos });
            setSubmitted(true);
            setActionStep(null);
        }
    }, [selectedCard, actionStep, previewPos, positions, send]);

    const cancelAction = useCallback(() => {
        setSelectedCard(null);
        setPreviewPos(null);
        setActionStep('card');
    }, []);

    const replayAnimation = useCallback(() => {
        if (!lastAnimationData || animPhase !== 'idle') { return; }
        setPositions(lastAnimationData.prePositions);
        setAnimatedArrows(lastAnimationData.arrows);
        setAnimPhase('moving');
        setTimeout(() => {
            setPositions([lastAnimationData.myTo, lastAnimationData.bossTo]);
            setAnimatedArrows([]);
            setAttackDisplay(lastAnimationData.attacks);
            setAnimatedBossAreaOfEffect(lastAnimationData.bossAreaOfEffect);
            setAnimPhase('attacking');
            setTimeout(() => {
                setAnimPhase('idle');
                setAttackDisplay([]);
                setAnimatedBossAreaOfEffect([]);
            }, 700);
        }, 700);
    }, [lastAnimationData, animPhase]);

    const playerPos = positions[0];
    const bossPos = positions[1];
    const moveHighlights = selectedCard && actionStep === 'move' ? getMoveOptions(selectedCard, playerPos, 0) : [];
    const nextPlayerPos = previewPos ?? playerPos;
    const attackHighlights = selectedCard && actionStep === 'attack' ? getAttackOptions(selectedCard, nextPlayerPos, 0, playerPos) : [];
    const attackAreaOfEffectHighlights = (selectedCard === 'tiger' || selectedCard === 'ox') && actionStep === 'attack' && attackHighlights.length >= 1
        ? getHitCells(selectedCard, attackHighlights[0], nextPlayerPos, 0, playerPos)
        : [];
    const warningHighlights = bossSkill && animPhase === 'idle' && !submitted
        ? config.getWarningHighlights(bossSkill, bossPos, playerPos, extraState)
        : [];
    const directionArrows = bossSkill && animPhase === 'idle' && !submitted && revealedSkills.has(bossSkill)
        ? (config.getDirectionArrows?.(bossSkill, bossPos, playerPos, extraState) ?? [])
        : [];
    const staticArrows = bossSkill && animPhase === 'idle' && !submitted && revealedSkills.has(bossSkill)
        ? (config.getStaticArrows?.(bossSkill, bossPos, playerPos, extraState) ?? [])
        : [];
    const specialHighlights = config.getSpecialHighlights?.(bossSkill, extraState, animPhase, submitted) ?? [];
    const specialStatusText = config.getSpecialStatusText?.(bossSkill, extraState, animPhase, submitted) ?? null;

    const rematchHint = rematchRequests.myRequest ? '你已请求再来一局…' : null;

    if (!connected || phase === 'lobby') { return <GameConnecting />; }

    const playerWins = totalScores.p1Wins;
    const bossWins = totalScores.p2Wins;

    if (subPhase === 'deck_selection') {
        if (deckPreset && !editingDeck) {
            return (
                <Stack gap="sm" maw={760} w="100%">
                    <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
                        {deckPreset.map(stance => (
                            <StanceCard key={stance} stance={stance} selected={false} disabled={false} onClick={() => {}} />
                        ))}
                    </SimpleGrid>
                    <Group gap="sm" mt="sm">
                        <Button onClick={startWithPreset}>开始挑战</Button>
                        <Button variant="subtle" color="gray" onClick={() => { setDeckChoice(new Set(deckPreset)); setEditingDeck(true); }}>修改卡组</Button>
                    </Group>
                </Stack>
            );
        }
        return (
            <Stack gap="sm" maw={760} w="100%">
                <Text size="sm">选择 5 张招式组成套牌（已选 {deckChoice.size}/5）</Text>
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
                    {ALL_STANCES.map(stance => (
                        <StanceCard
                            key={stance}
                            stance={stance}
                            selected={deckChoice.has(stance)}
                            disabled={!deckChoice.has(stance) && deckChoice.size >= 5}
                            onClick={() => { toggleStance(stance); }}
                        />
                    ))}
                </SimpleGrid>
                <Group gap="sm" mt="sm">
                    <Button disabled={deckChoice.size !== 5} onClick={saveAndStart}>保存并开始挑战</Button>
                    {deckPreset && <Button variant="subtle" color="gray" onClick={() => setEditingDeck(false)}>取消</Button>}
                </Group>
            </Stack>
        );
    }

    const hint = animPhase === 'moving' ? '双方移动中…'
        : animPhase === 'attacking' ? 'Boss 出招！'
            : submitted ? '等待中…'
                : actionStep === 'card' ? '选择要打出的招式'
                    : actionStep === 'move' ? `${STANCE_LABELS[selectedCard!]}：在棋盘上选择移动目标`
                        : actionStep === 'attack' ? `${STANCE_LABELS[selectedCard!]}：在棋盘上选择攻击目标`
                            : '';

    return (
        <Stack gap="sm" align="center">
            <div style={{ height: 20, display: 'flex', alignItems: 'center' }}>
                {(playerWins > 0 || bossWins > 0) && (
                    <Text size="sm" c="dimmed">你的胜场 {playerWins} · Boss 胜场 {bossWins}</Text>
                )}
            </div>
            <Group gap="xl">
                <Group gap={4}>
                    <Text size="sm" fw={700}>我</Text>
                    {Array.from({ length: 2 }, (_, index) => (
                        <div key={index} style={{ width: 12, height: 12, borderRadius: 2, background: index < hp[0] ? playerBlue : emptyHealthBackground }} />
                    ))}
                    <Text size="sm">{hp[0]}/2</Text>
                </Group>
                <Group gap={4}>
                    <Text size="sm" fw={700} c="red">Boss {config.bossName}</Text>
                    {Array.from({ length: config.bossHealth }, (_, index) => (
                        <div key={index} style={{ width: 12, height: 12, borderRadius: 2, background: index < hp[1] ? enemyRed : emptyHealthBackground }} />
                    ))}
                    <Text size="sm">{hp[1]}/{config.bossHealth}</Text>
                </Group>
            </Group>
            <div style={{ height: 72, maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {bossSkill && (
                    <Text size="sm" c="red" ta="center">
                        Boss 下一技能：{config.skillLabels[bossSkill]}{revealedSkills.has(bossSkill) ? `（${config.skillDescriptions[bossSkill]}）` : '（???）'}
                    </Text>
                )}
                {specialStatusText && <Text size="xs" c="orange" ta="center">{specialStatusText}</Text>}
            </div>
            <BossBoard
                positions={positions}
                playerDisplayPos={actionStep === 'attack' && previewPos ? previewPos : undefined}
                boss2Pos={config.getBoss2Pos?.(extraState) ?? undefined}
                allBossPositions={config.getAllBossPositions?.(extraState)}
                moveHighlights={animPhase === 'idle' ? moveHighlights : []}
                attackHighlights={animPhase === 'idle' ? attackHighlights : []}
                areaOfEffectHighlights={animPhase === 'idle' ? attackAreaOfEffectHighlights : []}
                warningHighlights={animPhase === 'idle' && !submitted && bossSkill !== null && revealedSkills.has(bossSkill) ? warningHighlights : []}
                specialHighlights={specialHighlights}
                specialBackground={config.specialHighlightStyle?.background}
                specialBorder={config.specialHighlightStyle?.border}
                animatedAttacks={animPhase === 'attacking' ? attackDisplay : []}
                animatedBossAreaOfEffect={animPhase === 'attacking' ? animatedBossAreaOfEffect : []}
                arrows={animPhase === 'moving' ? animatedArrows : staticArrows}
                directionArrows={animPhase === 'idle' ? directionArrows : []}
                onCellClick={animPhase === 'idle' ? handleCellClick : undefined}
            />
            {lastResult && (
                <Text size="sm" c="dimmed">
                    {`上回合：我出${STANCE_LABELS[lastResult.myCard]}`}
                    {lastResult.iHitBoss ? ` · 击中 Boss -${lastResult.myDamage}HP` : ''}
                    {lastResult.bossHitMe ? ' · Boss 击中我 -1HP' : ''}
                </Text>
            )}
            {lastAnimationData && animPhase === 'idle' && (
                <Button size="xs" variant="subtle" onClick={replayAnimation}>↩ 重播动画</Button>
            )}
            {subPhase === 'playing' && (
                <Stack gap="xs" align="center">
                    <Text size="sm">{hint}</Text>
                    {(hand.length > 0 || discard.length > 0) && (
                        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm" w="100%" maw={760}>
                            {ALL_STANCES.filter(stance => [...hand, ...discard].includes(stance)).map(stance => {
                                const cooldown = getStanceCooldown(stance, discard);
                                const isDisabled = submitted || actionStep !== 'card' || cooldown > 0 || animPhase !== 'idle';
                                return (
                                    <StanceCard
                                        key={stance}
                                        stance={stance}
                                        selected={stance === selectedCard}
                                        cooldown={cooldown}
                                        disabled={isDisabled}
                                        onClick={() => { if (!isDisabled) { selectCard(stance); } }}
                                    />
                                );
                            })}
                        </SimpleGrid>
                    )}
                    {!submitted && (actionStep === 'move' || actionStep === 'attack') && (
                        <Group gap="xs">
                            <Button size="xs" variant="subtle" onClick={cancelAction}>↩ 取消</Button>
                            {actionStep === 'attack' && (
                                <Button size="xs" variant="subtle" onClick={() => {
                                    send({ type: 'move', card: selectedCard!, moveTo: previewPos ?? positions[0], attackAt: null });
                                    setSubmitted(true);
                                    setActionStep(null);
                                }}>跳过攻击</Button>
                            )}
                        </Group>
                    )}
                </Stack>
            )}
            {subPhase === 'ended' && (
                <RematchSection hint={rematchHint} onRematch={rematch} />
            )}
        </Stack>
    );
};
