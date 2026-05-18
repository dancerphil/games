import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { RoomLobby } from '../../components/RoomLobby';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';

type ESCard = 'king' | 'commoner' | 'slave';
type Outcome = 'slave_wins' | 'king_wins' | 'continues';

interface RoundResult {
    round: number;
    yourCard: ESCard;
    opponentCard: ESCard;
    outcome: Outcome;
    gameOver: boolean;
    winner?: 'king_side' | 'slave_side';
}

interface ESGameMessage {
    type: 'round_result' | 'spectating' | 'spectate_update';
    round?: number;
    yourCard?: ESCard;
    opponentCard?: ESCard;
    outcome?: Outcome;
    gameOver?: boolean;
    winner?: 'king_side' | 'slave_side';
    state?: { round: number; hands: [{ king: number; commoner: number; slave: number }, { king: number; commoner: number; slave: number }]; history: { round: number; kingSideCard: ESCard; slaveSideCard: ESCard; outcome: Outcome }[]; winner: string | null };
}

const CARD_LABELS: Record<ESCard, string> = { king: '国王', commoner: '平民', slave: '奴隶' };
const OUTCOME_LABELS: Record<Outcome, string> = { slave_wins: '奴隶方获胜', king_wins: '国王方获胜', continues: '继续' };

export const PvpGame = ({ nickname, initialAction }: { nickname: string; initialAction?: InitialAction }) => {
    const [hand, setHand] = useState<Record<ESCard, number>>({ king: 0, commoner: 0, slave: 0 });
    const [submitted, setSubmitted] = useState(false);
    const [history, setHistory] = useState<RoundResult[]>([]);
    const [spectateState, setSpectateState] = useState<ESGameMessage['state'] | null>(null);

    const resetGame = useCallback(() => {
        setHand({ king: 0, commoner: 0, slave: 0 });
        setSubmitted(false);
        setHistory([]);
        setSpectateState(null);
    }, []);

    const handleGameMessage = useCallback((msg: ESGameMessage) => {
        if (msg.type === 'round_result' && msg.yourCard && msg.opponentCard && msg.outcome !== undefined) {
            setSubmitted(false);
            setHistory(prev => [...prev, msg as RoundResult]);
        }
        else if (msg.type === 'spectating' || msg.type === 'spectate_update') {
            if (msg.state) { setSpectateState(msg.state); }
        }
        if (msg.gameOver) { setGameEnded(); }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const { connected, phase, roomId, role, opponentNickname, spectateNicknames, error, clearError, send, createRoom, joinRoom, spectateRoom, rematch, setGameEnded, rematchRequests, totalScores, myIndex } =
        useGameRoom<ESGameMessage>({ game: 'emperor-slave', nickname, onGameMessage: handleGameMessage, onReset: resetGame, initialAction });

    useEffect(() => {
        if (phase !== 'playing') { return; }
        const newHand = role === 'king_side' ? { king: 1, commoner: 4, slave: 0 } : { king: 0, commoner: 4, slave: 1 };
        setHand(newHand);
    }, [phase, role]);

    const playCard = useCallback((card: ESCard) => {
        if (submitted || hand[card] <= 0) { return; }
        setHand(prev => ({ ...prev, [card]: prev[card] - 1 }));
        setSubmitted(true);
        send({ type: 'move', card });
    }, [submitted, hand, send]);

    if (phase === 'lobby' || phase === 'waiting') {
        return (
            <Stack align="center" gap="md">
                <RoomLobby
                    connected={connected}
                    isWaiting={phase === 'waiting'}
                    roomId={roomId}
                    error={error}
                    onCreateRoom={createRoom}
                    onJoinRoom={joinRoom}
                    onSpectate={spectateRoom}
                />
            </Stack>
        );
    }

    const isSpectating = phase === 'spectating';
    const lastRound = history[history.length - 1];
    const roundNum = lastRound ? (lastRound.gameOver ? lastRound.round : lastRound.round + 1) : 1;
    const myWins = myIndex === 0 ? totalScores.p1Wins : totalScores.p2Wins;
    const oppWins = myIndex === 0 ? totalScores.p2Wins : totalScores.p1Wins;
    const hasScores = totalScores.p1Wins > 0 || totalScores.p2Wins > 0;

    if (isSpectating && spectateState) {
        const [kHand, sHand] = spectateState.hands;
        return (
            <Stack gap="md">
                <Text>{spectateNicknames[0]}（国王方）vs {spectateNicknames[1]}（奴隶方）</Text>
                <Group>
                    <Text size="sm">国王方：国王×{kHand.king} 平民×{kHand.commoner}</Text>
                    <Text size="sm">奴隶方：奴隶×{sHand.slave} 平民×{sHand.commoner}</Text>
                </Group>
                {spectateState.history.length > 0 && <Table data={{ body: spectateState.history.map(r => [r.round, CARD_LABELS[r.kingSideCard], CARD_LABELS[r.slaveSideCard], OUTCOME_LABELS[r.outcome]]) }} />}
                {spectateState.winner && <Text fw={700}>{spectateState.winner === 'king_side' ? '国王方' : '奴隶方'}获胜！</Text>}
            </Stack>
        );
    }

    const roleLabel = role === 'king_side' ? '国王方（国王×1 平民×4）' : '奴隶方（奴隶×1 平民×4）';
    const cards: ESCard[] = role === 'king_side' ? ['king', 'commoner'] : ['slave', 'commoner'];

    const rematchHint = !rematchRequests.myRequest && !rematchRequests.opponentRequest ? null
        : rematchRequests.myRequest && rematchRequests.opponentRequest ? '双方已准备'
            : rematchRequests.myRequest ? '你已请求再来一局，等待对手…'
                : '对手请求再来一局';

    return (
        <Stack gap="md">
            {error && <Text c="red" size="sm" onClick={clearError}>{error}</Text>}
            <Text fw={500}>第 {roundNum} 轮 · {roleLabel}</Text>
            <Text size="sm">对手：{opponentNickname}</Text>
            {hasScores && (
                <Text size="sm" c="dimmed">
                    总比分：你 {myWins} 胜 · 对手 {oppWins} 胜
                </Text>
            )}
            {phase !== 'ended' && (
                submitted
                    ? <Text c="dimmed">已出牌，等待对手…</Text>
                    : (
                            <Group>{cards.map(card => hand[card] > 0 && (
                                <Button key={card} onClick={() => { playCard(card); }}>
                                    {CARD_LABELS[card]}{card === 'commoner' && hand[card] > 1 ? ` ×${hand[card]}` : ''}
                                </Button>
                            ))}
                            </Group>
                        )
            )}
            {history.length > 0 && (
                <Stack gap="xs">
                    <Text size="sm" fw={500}>历史</Text>
                    {history.map(r => (
                        <Group key={r.round} gap="xs">
                            <Badge variant="outline">第{r.round}轮</Badge>
                            <Text size="sm">你：{CARD_LABELS[r.yourCard]} vs 对手：{CARD_LABELS[r.opponentCard]}</Text>
                            {r.gameOver && <Badge color={r.winner === role ? 'green' : 'red'}>{OUTCOME_LABELS[r.outcome]}</Badge>}
                        </Group>
                    ))}
                </Stack>
            )}
            {phase === 'ended' && lastRound?.winner && (
                <Text fw={700} c={lastRound.winner === role ? 'green' : 'red'}>
                    {lastRound.winner === role ? '你赢了！' : `${opponentNickname} 赢了！`}
                </Text>
            )}
            {phase === 'ended' && (
                <Stack align="center" gap="xs">
                    {rematchHint && <Text size="sm" c="dimmed">{rematchHint}</Text>}
                    <Button onClick={rematch} variant="light">再来一局</Button>
                </Stack>
            )}
        </Stack>
    );
};
