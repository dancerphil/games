import { useCallback, useMemo, useState } from 'react';
import { Button, Group, Stack, Table, Text } from '@mantine/core';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { RoomWaiting } from '../../components/RoomWaiting';
import { PokerCard, formatCard } from '../../components/PokerCard';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';

const SUIT_COLORS = ['#222', '#c00', '#25f', '#0a0'];

interface RoundResult {
    round: number;
    yourCards: number[];
    opponentCards: number[];
    yourBest: string;
    opponentBest: string;
    yourMine: number;
    opponentMine: number;
    handOutcome: 'win' | 'lose' | 'draw';
    yourMineHit: boolean;
    opponentMineHit: boolean;
    scoreGained: number;
    yourTotal: number;
    opponentTotal: number;
    gameOver: boolean;
    winner?: 'you' | 'opponent';
    hands?: [number[], number[]];
    bestCards?: [number[], number[]];
}

interface MtGameMessage {
    type: 'game_start' | 'room_joined' | 'round_result' | 'spectating' | 'spectate_update' | 'rematch_start';
    hands?: [number[], number[]];
    bestCards?: [number[], number[]];
    yourCards?: number[];
    opponentCards?: number[];
    yourBest?: string;
    opponentBest?: string;
    yourMine?: number;
    opponentMine?: number;
    handOutcome?: 'win' | 'lose' | 'draw';
    yourMineHit?: boolean;
    opponentMineHit?: boolean;
    scoreGained?: number;
    yourTotal?: number;
    opponentTotal?: number;
    gameOver?: boolean;
    winner?: 'you' | 'opponent';
}

const sortCards = (cards: number[]): number[] =>
    [...cards].sort((a, b) => {
        const ra = a % 13;
        const rb = b % 13;
        if (ra !== rb) { return rb - ra; } // eslint-disable-line @stylistic/max-statements-per-line
        return Math.floor(a / 13) - Math.floor(b / 13);
    });

const ColoredCard = ({ card, mineHit }: { card: number; mineHit?: boolean }) => {
    const s = Math.floor(card / 13);
    return (
        <Text
            component="span"
            size="xs"
            c={SUIT_COLORS[s]}
            style={mineHit ? { outline: '2px solid red', outlineOffset: 1 } : undefined}
        >
            {formatCard(card)}
        </Text>
    );
};

const CardList = ({ cards, mineHitCard }: { cards: number[]; mineHitCard?: number }) => (
    <Text size="xs" style={{ whiteSpace: 'nowrap' }}>
        {cards.map((c, i) => (
            <span key={c}>
                {i > 0 && ' '}
                <ColoredCard card={c} mineHit={c === mineHitCard} />
            </span>
        ))}
    </Text>
);

export const MineTexas = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: { initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string }) => {
    const [nickname] = useNickname();
    const [myHand, setMyHand] = useState<number[]>([]);
    const [oppHand, setOppHand] = useState<number[]>([]);
    const [recommended, setRecommended] = useState<Set<number>>(() => new Set());
    const [oppRecommended, setOppRecommended] = useState<Set<number>>(() => new Set());
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const [mine, setMine] = useState<number | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [scores, setScores] = useState<[number, number]>([0, 0]);
    const [history, setHistory] = useState<RoundResult[]>([]);

    const resetGame = useCallback(() => {
        setMyHand([]);
        setOppHand([]);
        setRecommended(new Set());
        setOppRecommended(new Set());
        setSelected(new Set());
        setMine(null);
        setSubmitted(false);
        setScores([0, 0]);
        setHistory([]);
    }, []);

    const applyHands = useCallback((hands: [number[], number[]], bestCards?: [number[], number[]]) => {
        setMyHand(hands[0]);
        setOppHand(hands[1]);
        if (bestCards) {
            setRecommended(new Set(bestCards[0]));
            setOppRecommended(new Set(bestCards[1]));
        }
    }, []);

    const handleRoundResult = useCallback((msg: MtGameMessage) => {
        setSubmitted(false);
        setSelected(new Set());
        setMine(null);
        setHistory(prev => [...prev, msg as unknown as RoundResult]);
        setScores([msg.yourTotal ?? 0, msg.opponentTotal ?? 0]);
        if (msg.hands) { applyHands(msg.hands, msg.bestCards); } // eslint-disable-line @stylistic/max-statements-per-line
    }, [applyHands]);

    const handleGameMessage = useCallback((msg: MtGameMessage) => {
        if (msg.type === 'round_result' && msg.yourCards) {
            handleRoundResult(msg);
        }
        else if ((msg.type === 'game_start' || msg.type === 'room_joined' || msg.type === 'rematch_start') && msg.hands) {
            if (msg.type !== 'room_joined') { resetGame(); } // eslint-disable-line @stylistic/max-statements-per-line
            applyHands(msg.hands, msg.bestCards);
        }
        if (msg.gameOver) { setGameEnded(); } // eslint-disable-line @stylistic/max-statements-per-line
    }, [handleRoundResult, resetGame, applyHands]); // eslint-disable-line react-hooks/exhaustive-deps

    const { connected, phase, roomId: stateRoomId, opponentNickname, send, rematch, addAi, setGameEnded, rematchRequests, totalScores, myIndex } =
        useGameRoom<MtGameMessage>({ game: 'mine-texas', roomId, isCreator, isSpectate, initialRole, nickname, onGameMessage: handleGameMessage, onReset: resetGame, initialAction });

    const sortedMyHand = useMemo(() => sortCards(myHand), [myHand]);
    const sortedOppHand = useMemo(() => sortCards(oppHand), [oppHand]);

    const toggleCard = useCallback((card: number) => {
        if (submitted) { return; }
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(card)) { next.delete(card); }
            else if (next.size < 5) { next.add(card); }
            return next;
        });
    }, [submitted]);

    const selectMine = useCallback((card: number) => {
        if (submitted) { return; }
        setMine(prev => prev === card ? null : card);
    }, [submitted]);

    const submit = useCallback(() => {
        if (selected.size !== 5 || mine === null) { return; }
        setSubmitted(true);
        send({ type: 'move', hand: [...selected], mine });
    }, [selected, mine, send]);

    if (!connected || phase === 'lobby') { return <GameConnecting />; }
    if (phase === 'waiting') { return <RoomWaiting roomId={stateRoomId || roomId || ''} onAddAi={addAi} />; }

    const myWins = myIndex === 0 ? totalScores.p1Wins : totalScores.p2Wins;
    const oppWins = myIndex === 0 ? totalScores.p2Wins : totalScores.p1Wins;
    const hasScores = totalScores.p1Wins > 0 || totalScores.p2Wins > 0 || totalScores.draws > 0;
    const lastRound = history[history.length - 1];

    const rematchHint = !rematchRequests.myRequest && !rematchRequests.opponentRequest ? null
        : rematchRequests.myRequest && rematchRequests.opponentRequest ? '双方已准备'
            : rematchRequests.myRequest ? '你已请求再来一局，等待对手…'
                : '对手请求再来一局';

    const historyTable = history.length > 0 ? (
        <Table highlightOnHover striped withTableBorder>
            <Table.Thead>
                <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>你的牌型</Table.Th>
                    <Table.Th>你设的雷</Table.Th>
                    <Table.Th>对方设的雷</Table.Th>
                    <Table.Th>对手牌型</Table.Th>
                    <Table.Th>得分</Table.Th>
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {history.map(r => (
                    <Table.Tr key={r.round}>
                        <Table.Td>{r.round}</Table.Td>
                        <Table.Td>
                            <CardList cards={r.yourCards} mineHitCard={r.opponentMineHit ? r.opponentMine : undefined} />
                            <Text size="xs" c="dimmed">{r.yourBest}</Text>
                        </Table.Td>
                        <Table.Td>
                            <Text size="xs"><ColoredCard card={r.yourMine} />{r.yourMineHit ? ' ✓' : ' ✗'}</Text>
                        </Table.Td>
                        <Table.Td>
                            <Text size="xs"><ColoredCard card={r.opponentMine} />{r.opponentMineHit ? ' ✓' : ' ✗'}</Text>
                        </Table.Td>
                        <Table.Td>
                            <CardList cards={r.opponentCards} mineHitCard={r.yourMineHit ? r.yourMine : undefined} />
                            <Text size="xs" c="dimmed">{r.opponentBest}</Text>
                        </Table.Td>
                        <Table.Td>
                            <Text size="xs">
                                {r.handOutcome === 'win' ? '胜' : r.handOutcome === 'lose' ? '负' : '平'}
                                {' +'}{r.scoreGained}（{r.yourTotal}:{r.opponentTotal}）
                            </Text>
                        </Table.Td>
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    ) : null;

    return (
        <Stack gap="md" style={{ minHeight: '70vh', justifyContent: 'space-between' }}>
            <Stack gap="md">
                <Group justify="space-between">
                    <Text fw={500}>第 {lastRound ? lastRound.round + 1 : 1} 轮 · 你 {scores[0]} : {scores[1]} 对手</Text>
                    <Text size="sm" c="dimmed">{opponentNickname}（先得 10 分胜）</Text>
                </Group>
                {hasScores && (
                    <Text size="sm" c="dimmed">
                        总比分：你 {myWins} 胜 · 对手 {oppWins} 胜
                        {totalScores.draws > 0 && ` · ${totalScores.draws} 平`}
                    </Text>
                )}
                {historyTable}
                {phase === 'ended' && lastRound?.winner && (
                    <Text fw={700} c={lastRound.winner === 'you' ? 'green' : 'red'} ta="center">
                        {lastRound.winner === 'you' ? '你赢了！' : `${opponentNickname} 赢了！`}
                    </Text>
                )}
                {phase === 'ended' && <RematchSection hint={rematchHint} onRematch={rematch} />}
            </Stack>

            {phase !== 'ended' && (
                <Stack gap="sm" style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
                    {submitted
                        ? <Text c="dimmed">已出牌，等待对手…</Text>
                        : (
                                <>
                                    <Group gap="xs" align="center">
                                        <Text size="sm" fw={500}>你的牌（选 5 张）：</Text>
                                        {sortedMyHand.map(c => (
                                            <PokerCard
                                                key={c}
                                                card={c}
                                                selected={selected.has(c)}
                                                recommended={recommended.has(c)}
                                                onClick={() => { toggleCard(c); }}
                                            />
                                        ))}
                                        <Text size="xs" c="dimmed">{selected.size}/5</Text>
                                    </Group>
                                    <Group gap="xs" align="center">
                                        <Text size="sm" fw={500}>对手的牌（选 1 张地雷）：</Text>
                                        {sortedOppHand.map(c => (
                                            <PokerCard
                                                key={c}
                                                card={c}
                                                selected={mine === c}
                                                recommended={oppRecommended.has(c)}
                                                onClick={() => { selectMine(c); }}
                                            />
                                        ))}
                                        <Text size="xs" c="dimmed">{mine === null ? '0/1' : '1/1'}</Text>
                                    </Group>
                                    <Button
                                        disabled={selected.size !== 5 || mine === null}
                                        onClick={submit}
                                    >
                                        {selected.size !== 5 ? `已选 ${selected.size}/5 张` : mine === null ? '请选地雷' : '出牌'}
                                    </Button>
                                </>
                            )}
                </Stack>
            )}
        </Stack>
    );
};
