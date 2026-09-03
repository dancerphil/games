import { useCallback, useRef, useState } from 'react';
import { Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Pos, StanceName } from '@games/shared';
import { ALL_STANCES, eqPos } from '@games/shared';
import { useNavigate } from 'react-router';
import { getMoveOptions, getHitCells, getAttackOptions, isCharge } from '@/game/stanceHelpers';
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
    poisonBackground,
    poisonPurple,
} from '@/constants/gameColors';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { StanceCard, STANCE_LABELS, getStanceCooldown } from '../../components/StanceCard';
import { DeckSelector } from '../../components/DeckSelector';
import { RoomWaiting } from '../../components/RoomWaiting';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';
import { useAppStore } from '../../store';

// Board component
interface BoardProps {
    positions: [Pos, Pos];
    pi: number;
    moveHighlights?: Pos[];
    attackHighlights?: Pos[];
    aoeHighlights?: Pos[];
    animAttacks?: Pos[];
    poisonRings?: number;
    onCellClick?: (pos: Pos) => void;
}

const Board = ({ positions, pi, moveHighlights = [], attackHighlights = [], aoeHighlights = [], animAttacks = [], poisonRings = 0, onCellClick }: BoardProps) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 40px)', gap: 2 }}>
        {Array.from({ length: 49 }, (_, i) => {
            const pos = { row: Math.floor(i / 7), col: i % 7 };
            const isMe = eqPos(positions[pi], pos);
            const isOpp = eqPos(positions[1 - pi], pos);
            const isMove = !isMe && moveHighlights.some(m => eqPos(m, pos));
            const isAttack = !isMe && attackHighlights.some(a => eqPos(a, pos));
            const isAoe = aoeHighlights.some(a => eqPos(a, pos));
            const isAnimAttack = animAttacks.some(a => eqPos(a, pos));
            const isPoison = poisonRings > 0 && Math.min(pos.row, 6 - pos.row, pos.col, 6 - pos.col) < poisonRings;
            let bg = boardCellBackground;
            if (isAnimAttack) { bg = actionOrange; }
            else if (isAttack) { bg = attackBackground; }
            else if (isAoe) { bg = areaOfEffectBackground; }
            else if (isMove) { bg = moveBackground; }
            else if (isPoison) { bg = poisonBackground; }
            const clickable = isMove || isAttack;
            const border = isAttack ? `2px solid ${enemyRed}`
                : isAoe ? `2px solid ${areaOfEffectBorder}`
                    : isMove ? `2px solid ${playerBlue}`
                        : isAnimAttack ? `2px solid ${actionOrange}`
                            : isPoison ? `1px solid ${poisonPurple}`
                                : `1px solid ${neutralBorder}`;
            return (
                <div
                    key={i}
                    onClick={() => { if (clickable) { onCellClick?.(pos); } }}
                    style={{
                        width: 40, height: 40, background: bg,
                        border,
                        borderRadius: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: clickable ? 'pointer' : 'default',
                    }}
                >
                    {isMe && <div style={{ width: 34, height: 34, borderRadius: '50%', background: playerBlue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>我</div>}
                    {isOpp && <div style={{ width: 34, height: 34, borderRadius: '50%', background: isAnimAttack ? actionOrange : enemyRed, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>敌</div>}
                </div>
            );
        })}
    </div>
);

interface GameMsg {
    type: string;
    phase?: string;
    positions?: [Pos, Pos];
    hp?: [number, number];
    hand?: StanceName[];
    discard?: StanceName[];
    turn?: number;
    myCard?: StanceName;
    opponentCard?: StanceName;
    iHitOpponent?: boolean;
    opponentHitMe?: boolean;
    myDamage?: number;
    opponentDamage?: number;
    myPoisonDamage?: number;
    opponentPoisonDamage?: number;
    numPoisonRings?: number;
    gameOver?: boolean;
    winner?: 0 | 1 | 'draw';
    myMovedTo?: Pos;
    opponentMovedTo?: Pos;
    myAttackedAt?: Pos | null;
    opponentAttackedAt?: Pos | null;
    myMovedFrom?: Pos;
    opponentMovedFrom?: Pos;
    opponentHand?: StanceName[];
    opponentDiscard?: StanceName[];
    state?: { positions: [Pos, Pos]; hp: [number, number] };
}

interface LastResult { myCard: StanceName; opponentCard: StanceName; iHitOpponent: boolean; opponentHitMe: boolean; myDamage: number; opponentDamage: number; myPoisonDamage: number; opponentPoisonDamage: number }

export const StancePage = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: { initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string }) => {
    const [nickname] = useNickname();

    const [subPhase, setSubPhase] = useState<'deck_selection' | 'waiting_deck' | 'playing' | 'ended'>('deck_selection');
    const [deckChoice, setDeckChoice] = useState<Set<StanceName>>(new Set());
    const [positions, setPositions] = useState<[Pos, Pos]>([{ row: 3, col: 1 }, { row: 3, col: 5 }]);
    const [hp, setHp] = useState<[number, number]>([2, 2]);
    const [numPoisonRings, setNumPoisonRings] = useState(0);
    const [hand, setHand] = useState<StanceName[]>([]);
    const [discard, setDiscard] = useState<StanceName[]>([]);
    const [opponentHand, setOpponentHand] = useState<StanceName[]>([]);
    const [opponentDiscard, setOpponentDiscard] = useState<StanceName[]>([]);
    const [submitted, setSubmitted] = useState(false);
    const [lastResult, setLastResult] = useState<LastResult | null>(null);
    const [spectatePositions, setSpectatePositions] = useState<[Pos, Pos] | null>(null);
    const [spectateHp, setSpectateHp] = useState<[number, number] | null>(null);

    // Turn action state
    const [actionStep, setActionStep] = useState<'card' | 'move' | 'attack' | null>(null);
    const [selectedCard, setSelectedCard] = useState<StanceName | null>(null);
    const [previewPos, setPreviewPos] = useState<Pos | null>(null);
    const [animPhase, setAnimPhase] = useState<'idle' | 'moving' | 'attacking'>('idle');
    const [attackDisplay, setAttackDisplay] = useState<Pos[]>([]);
    const piRef = useRef(0);
    const setGameEndedRef = useRef<() => void>(() => {});

    const resetGame = useCallback(() => {
        setSubPhase('deck_selection');
        setDeckChoice(new Set());
        setPositions([{ row: 3, col: 1 }, { row: 3, col: 5 }]);
        setHp([2, 2]);
        setNumPoisonRings(0);
        setHand([]);
        setDiscard([]);
        setOpponentHand([]);
        setOpponentDiscard([]);
        setSubmitted(false);
        setLastResult(null);
        setActionStep(null);
        setSelectedCard(null);
        setPreviewPos(null);
        setAnimPhase('idle');
        setAttackDisplay([]);
        setSpectatePositions(null);
        setSpectateHp(null);
    }, []);

    const handleGameMessage = useCallback((msg: GameMsg) => {
        if (msg.type === 'game_start' || msg.type === 'room_joined') {
            if (msg.phase === 'deck_selection') { setSubPhase('deck_selection'); }
        }
        else if (msg.type === 'deck_confirmed') {
            setSubPhase('waiting_deck');
        }
        else if (msg.type === 'turn_start') {
            setPositions(msg.positions!);
            setHp(msg.hp!);
            setHand(msg.hand!);
            setDiscard(msg.discard!);
            setOpponentHand(msg.opponentHand ?? []);
            setOpponentDiscard(msg.opponentDiscard ?? []);
            setNumPoisonRings(msg.numPoisonRings ?? 0);
            setSubPhase('playing');
            setActionStep('card');
            setSubmitted(false);
            setLastResult(null);
        }
        else if (msg.type === 'turn_result') {
            const piVal = piRef.current;
            const myMoved = msg.myMovedTo!;
            const oppMoved = msg.opponentMovedTo!;
            const p0Moved: Pos = piVal === 0 ? myMoved : oppMoved;
            const p1Moved: Pos = piVal === 0 ? oppMoved : myMoved;
            setPositions([p0Moved, p1Moved]);
            setAnimPhase('moving');
            setTimeout(() => {
                const attacks: Pos[] = [];
                if (msg.myAttackedAt) { attacks.push(...getHitCells(msg.myCard!, msg.myAttackedAt, myMoved, piVal, msg.myMovedFrom)); }
                if (msg.opponentAttackedAt) { attacks.push(...getHitCells(msg.opponentCard!, msg.opponentAttackedAt, oppMoved, 1 - piVal, msg.opponentMovedFrom)); }
                setAttackDisplay(attacks);
                setAnimPhase('attacking');
                setTimeout(() => {
                    setAnimPhase('idle');
                    setAttackDisplay([]);
                    setPositions(msg.positions!);
                    setHp(msg.hp!);
                    setLastResult({ myCard: msg.myCard!, opponentCard: msg.opponentCard!, iHitOpponent: msg.iHitOpponent!, opponentHitMe: msg.opponentHitMe!, myDamage: msg.myDamage ?? 1, opponentDamage: msg.opponentDamage ?? 1, myPoisonDamage: msg.myPoisonDamage ?? 0, opponentPoisonDamage: msg.opponentPoisonDamage ?? 0 });
                    if (msg.gameOver) {
                        setSubPhase('ended');
                        setGameEndedRef.current();
                    }
                    else {
                        setNumPoisonRings(msg.numPoisonRings ?? 0);
                        setHand(msg.hand as StanceName[]);
                        setDiscard(msg.discard as StanceName[]);
                        setOpponentHand(msg.opponentHand ?? []);
                        setOpponentDiscard(msg.opponentDiscard ?? []);
                        setSubmitted(false);
                        setActionStep('card');
                        setSelectedCard(null);
                        setPreviewPos(null);
                    }
                }, 700);
            }, 700);
        }
        else if (msg.type === 'spectating' || msg.type === 'spectate_update') {
            if (msg.state) {
                setSpectatePositions(msg.state.positions);
                setSpectateHp(msg.state.hp);
            }
        }
    }, []);

    const { connected, phase, roomId: stateRoomId, role, opponentNickname, spectateNicknames, send, rematch, addAi, setGameEnded, rematchRequests, totalScores, myIndex } =
        useGameRoom<GameMsg>({ game: 'stance', roomId, isCreator, isSpectate, initialRole, nickname, onGameMessage: handleGameMessage, onReset: resetGame, initialAction });

    const pi: 0 | 1 = role === 'player1' ? 1 : 0;
    piRef.current = pi;
    setGameEndedRef.current = setGameEnded;

    const navigate = useNavigate();
    const { send: globalSend, setMessageHandler } = useAppStore();
    const handleAddBoss = (bossKey: string) => {
        let done = false;
        const handler = (msg: Record<string, unknown>) => {
            if (done) { return; }
            if (msg['type'] === 'room_created') {
                done = true;
                setMessageHandler(null);
                void navigate(`/room/${msg['roomId'] as string}`, { state: { isCreator: true, yourRole: msg['yourRole'] as string } });
            }
            else if (msg['type'] === 'error') {
                done = true;
                setMessageHandler(null);
            }
        };
        setMessageHandler(handler);
        globalSend({ type: 'create_ai_room', nickname, game: bossKey });
        setTimeout(() => { if (!done) { setMessageHandler(null); } }, 5000);
    };

    const toggleStance = useCallback((s: StanceName) => {
        setDeckChoice((prev) => {
            const next = new Set(prev);
            if (next.has(s)) { next.delete(s); }
            else if (next.size < 5) { next.add(s); }
            return next;
        });
    }, []);

    const confirmDeck = useCallback(() => {
        if (deckChoice.size !== 5) { return; }
        send({ type: 'move', stances: [...deckChoice] });
        setSubPhase('waiting_deck');
    }, [deckChoice, send]);

    const selectCard = useCallback((card: StanceName) => {
        if (submitted || actionStep !== 'card') { return; }
        setSelectedCard(card);
        if (isCharge(card)) {
            // 凝: no move, no attack — auto-submit
            send({ type: 'move', card, moveTo: positions[pi], attackAt: null });
            setSubmitted(true);
            setActionStep(null);
            return;
        }
        const moveOpts = getMoveOptions(card, positions[pi], pi);
        if (moveOpts.length === 0) {
            setPreviewPos(positions[pi]);
            if (getAttackOptions(card, positions[pi], pi).length === 0) {
                send({ type: 'move', card, moveTo: positions[pi], attackAt: null });
                setSubmitted(true);
                setActionStep(null);
            }
            else {
                setActionStep('attack');
            }
        }
        else {
            setActionStep('move');
        }
    }, [submitted, actionStep, positions, pi, send]);

    const handleCellClick = useCallback((pos: Pos) => {
        if (!selectedCard) { return; }
        if (actionStep === 'move') {
            setPreviewPos(pos);
            const attackOpts = getAttackOptions(selectedCard, pos, pi, positions[pi]);
            if (attackOpts.length === 0) {
                // no attack options — auto-submit after move
                send({ type: 'move', card: selectedCard, moveTo: pos, attackAt: null });
                setSubmitted(true);
                setActionStep(null);
            }
            else {
                setActionStep('attack');
            }
        }
        else if (actionStep === 'attack') {
            const moveTo = previewPos ?? positions[pi];
            send({ type: 'move', card: selectedCard, moveTo, attackAt: pos });
            setSubmitted(true);
            setActionStep(null);
        }
    }, [selectedCard, actionStep, previewPos, positions, pi, send]);

    const cancelAction = useCallback(() => {
        setSelectedCard(null);
        setPreviewPos(null);
        setActionStep('card');
    }, []);

    const myPos = positions[pi];
    const moveHighlights = selectedCard && actionStep === 'move'
        ? getMoveOptions(selectedCard, myPos, pi)
        : [];
    const newPos = previewPos ?? myPos;
    const attackHighlights = selectedCard && actionStep === 'attack'
        ? getAttackOptions(selectedCard, newPos, pi, myPos)
        : [];
    const attackAoeHighlights = (selectedCard === 'tiger' || selectedCard === 'ox') && actionStep === 'attack' && attackHighlights.length >= 1
        ? getHitCells(selectedCard, attackHighlights[0], newPos, pi, myPos)
        : [];

    const rematchHint = !rematchRequests.myRequest && !rematchRequests.opponentRequest ? null
        : rematchRequests.myRequest && rematchRequests.opponentRequest ? '双方已准备'
            : rematchRequests.myRequest ? '你已请求再来一局，等待对手…'
                : '对手请求再来一局';

    if (!connected || phase === 'lobby') { return <GameConnecting />; }
    if (phase === 'waiting') {
        return (
            <Stack align="center" gap="md">
                <RoomWaiting roomId={stateRoomId || roomId || ''} onAddAi={addAi} />
                <Text size="sm" c="dimmed">或选择 Boss 挑战</Text>
                <Group gap="xs" justify="center">
                    <Button size="xs" variant="light" onClick={() => { handleAddBoss('boss-blast'); }}>爆破</Button>
                    <Button size="xs" variant="light" onClick={() => { handleAddBoss('boss-tornado'); }}>龙卷</Button>
                    <Button size="xs" variant="light" onClick={() => { handleAddBoss('boss-thunder'); }}>雷神</Button>
                    <Button size="xs" variant="light" onClick={() => { handleAddBoss('boss-spacetime'); }}>时空</Button>
                    <Button size="xs" variant="light" onClick={() => { handleAddBoss('boss-tidal'); }}>潮汐</Button>
                    <Button size="xs" variant="light" onClick={() => { handleAddBoss('boss-siege'); }}>围攻</Button>
                </Group>
            </Stack>
        );
    }

    if (phase === 'spectating') {
        return (
            <Stack gap="sm" align="center">
                <Text size="sm">{spectateNicknames[0]} vs {spectateNicknames[1]}</Text>
                {spectatePositions && spectateHp && (
                    <>
                        <Group gap="md">
                            <Text size="sm">{spectateNicknames[0]} HP: {spectateHp[0]}/2</Text>
                            <Text size="sm">{spectateNicknames[1]} HP: {spectateHp[1]}/2</Text>
                        </Group>
                        <Board positions={spectatePositions} pi={0} />
                    </>
                )}
            </Stack>
        );
    }

    const myWins = myIndex === 0 ? totalScores.p1Wins : totalScores.p2Wins;
    const oppWins = myIndex === 0 ? totalScores.p2Wins : totalScores.p1Wins;

    if (subPhase === 'deck_selection' || subPhase === 'waiting_deck') {
        return (
            <DeckSelector
                selected={deckChoice}
                onToggle={toggleStance}
                disabled={s => subPhase === 'waiting_deck' || (!deckChoice.has(s) && deckChoice.size >= 5)}
                playerIndex={pi}
                action={
                    subPhase === 'deck_selection' ? (
                        <Button disabled={deckChoice.size !== 5} onClick={confirmDeck}>确认套牌</Button>
                    ) : (
                        <Text c="dimmed" size="sm">已选定套牌，等待对手…</Text>
                    )
                }
            />
        );
    }

    const hint = animPhase === 'moving' ? '双方移动中…'
        : animPhase === 'attacking' ? '双方出招！'
            : submitted ? '等待对手…'
                : actionStep === 'card' ? '选择要打出的招式'
                    : actionStep === 'move' ? `${STANCE_LABELS[selectedCard!]}：在棋盘上选择移动目标`
                        : actionStep === 'attack' ? `${STANCE_LABELS[selectedCard!]}：在棋盘上选择攻击目标`
                            : '';

    return (
        <Stack gap="sm" align="center">
            <Text size="sm">对手：{opponentNickname}{(myWins > 0 || oppWins > 0) ? `　总比分：我 ${myWins} 胜 · 对手 ${oppWins} 胜` : ''}</Text>
            <Group gap="xl">
                {[0, 1].map(i => (
                    <Group key={i} gap={4}>
                        <Text size="sm" fw={i === pi ? 700 : 400}>{i === pi ? '我' : opponentNickname}</Text>
                        {Array.from({ length: 2 }, (_, j) => (
                            <div
                                key={j}
                                style={{ width: 12, height: 12, borderRadius: 2, background: j < hp[i] ? (i === pi ? playerBlue : enemyRed) : emptyHealthBackground }}
                            />
                        ))}
                        <Text size="sm">{hp[i]}/2</Text>
                    </Group>
                ))}
            </Group>
            <Board
                positions={positions}
                pi={pi}
                moveHighlights={animPhase === 'idle' ? moveHighlights : []}
                attackHighlights={animPhase === 'idle' ? attackHighlights : []}
                aoeHighlights={animPhase === 'idle' ? attackAoeHighlights : []}
                animAttacks={animPhase === 'attacking' ? attackDisplay : []}
                poisonRings={numPoisonRings}
                onCellClick={animPhase === 'idle' ? handleCellClick : undefined}
            />
            {lastResult && (
                <Text size="sm" c="dimmed">
                    {`上回合：我出${STANCE_LABELS[lastResult.myCard]}，对手出${STANCE_LABELS[lastResult.opponentCard]}`}
                    {lastResult.iHitOpponent ? ` · 我击中对手 -${lastResult.myDamage}HP` : ''}
                    {lastResult.opponentHitMe ? ` · 对手击中我 -${lastResult.opponentDamage}HP` : ''}
                    {lastResult.myPoisonDamage > 0 ? ` · 我受毒圈 -${lastResult.myPoisonDamage}HP` : ''}
                    {lastResult.opponentPoisonDamage > 0 ? ` · 对手受毒圈 -${lastResult.opponentPoisonDamage}HP` : ''}
                </Text>
            )}
            {subPhase === 'playing' && (
                <Stack gap="xs" align="center">
                    <Text size="sm">{hint}</Text>
                    {(hand.length > 0 || discard.length > 0) && (
                        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm" w="100%" maw={760}>
                            {ALL_STANCES.filter(s => [...hand, ...discard].includes(s)).map((s) => {
                                const cd = getStanceCooldown(s, discard);
                                const isDisabled = submitted || actionStep !== 'card' || cd > 0 || animPhase !== 'idle';
                                return (
                                    <StanceCard
                                        key={s}
                                        stance={s}
                                        playerIndex={pi}
                                        selected={s === selectedCard}
                                        cooldown={cd}
                                        disabled={isDisabled}
                                        onClick={() => { if (!isDisabled) { selectCard(s); } }}
                                    />
                                );
                            })}
                        </SimpleGrid>
                    )}
                    {(opponentHand.length > 0 || opponentDiscard.length > 0) && (
                        <Stack gap={6} w="100%" maw={760}>
                            <Text size="xs" c="dimmed">对手：</Text>
                            <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">
                                {ALL_STANCES.filter(s => [...opponentHand, ...opponentDiscard].includes(s)).map(s => (
                                    <StanceCard
                                        key={s}
                                        stance={s}
                                        playerIndex={(1 - pi) as 0 | 1}
                                        cooldown={getStanceCooldown(s, opponentDiscard)}
                                        disabled
                                    />
                                ))}
                            </SimpleGrid>
                        </Stack>
                    )}
                    {!submitted && (actionStep === 'move' || actionStep === 'attack') && (
                        <Button size="xs" variant="subtle" onClick={cancelAction}>↩ 取消</Button>
                    )}
                </Stack>
            )}
            {subPhase === 'ended' && (
                <RematchSection hint={rematchHint} onRematch={rematch} />
            )}
        </Stack>
    );
};
