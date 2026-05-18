import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { RoomLobby } from '../../components/RoomLobby';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';

interface NineRoundResult {
    round: number;
    yourCard: number;
    opponentCard: number;
    scoreGained: number;
    yourTotal: number;
    opponentTotal: number;
    gameOver: boolean;
    winner?: 'you' | 'opponent' | 'draw';
}

interface NineGameMessage {
    type: 'round_result' | 'spectating' | 'spectate_update';
    round?: number;
    yourCard?: number;
    opponentCard?: number;
    scoreGained?: number;
    yourTotal?: number;
    opponentTotal?: number;
    gameOver?: boolean;
    winner?: 'you' | 'opponent' | 'draw';
    state?: { round: number; hands: [number[], number[]]; scores: [number, number]; history: { round: number; p1Card: number; p2Card: number; p1Gained: number; p2Gained: number }[]; winner: string | null };
}

export const PvpGame = ({ nickname, initialAction }: { nickname: string; initialAction?: InitialAction }) => {
    const [hand, setHand] = useState<number[]>([]);
    const [submitted, setSubmitted] = useState(false);
    const [scores, setScores] = useState<[number, number]>([0, 0]);
    const [history, setHistory] = useState<NineRoundResult[]>([]);
    const [spectateState, setSpectateState] = useState<NineGameMessage['state'] | null>(null);

    const resetGame = useCallback(() => {
        setHand([]);
        setSubmitted(false);
        setScores([0, 0]);
        setHistory([]);
        setSpectateState(null);
    }, []);

    const handleGameMessage = useCallback((msg: NineGameMessage) => {
        if (msg.type === 'round_result' && msg.yourCard !== undefined) {
            setSubmitted(false);
            setHistory(prev => [...prev, msg as NineRoundResult]);
            setScores([msg.yourTotal ?? 0, msg.opponentTotal ?? 0]);
        }
        else if (msg.type === 'spectating' || msg.type === 'spectate_update') {
            if (msg.state) { setSpectateState(msg.state); }
        }
        if (msg.gameOver) { setGameEnded(); }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const { connected, phase, roomId, opponentNickname, spectateNicknames, error, clearError, send, createRoom, joinRoom, spectateRoom, rematch, setGameEnded, rematchRequests, totalScores, myIndex } =
        useGameRoom<NineGameMessage>({ game: 'nine', nickname, onGameMessage: handleGameMessage, onReset: resetGame, initialAction });

    useEffect(() => {
        if (phase === 'playing' && hand.length === 0) { setHand([1, 2, 3, 4, 5, 6, 7, 8, 9]); }
    }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

    const playCard = useCallback((card: number) => {
        if (submitted) { return; }
        setHand(prev => prev.filter(c => c !== card));
        setSubmitted(true);
        send({ type: 'move', card });
    }, [submitted, send]);

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
    const hasScores = totalScores.p1Wins > 0 || totalScores.p2Wins > 0 || totalScores.draws > 0;

    if (isSpectating && spectateState) {
        const [s1, s2] = spectateState.scores;
        return (
            <Stack gap="md">
                <Text>{spectateNicknames[0]} vs {spectateNicknames[1]}</Text>
                <Group><Text>第 {spectateState.round} 轮 · {spectateNicknames[0]}: {s1} vs {spectateNicknames[1]}: {s2}</Text></Group>
                <Group>
                    <Text size="sm">{spectateNicknames[0]} 剩余：{spectateState.hands[0].join(' ')}</Text>
                    <Text size="sm">{spectateNicknames[1]} 剩余：{spectateState.hands[1].join(' ')}</Text>
                </Group>
                {spectateState.history.map(r => (
                    <Text key={r.round} size="sm">第{r.round}轮：{spectateNicknames[0]} 出 {r.p1Card}，{spectateNicknames[1]} 出 {r.p2Card}，各得 {r.p1Gained}/{r.p2Gained}</Text>
                ))}
                {spectateState.winner && <Text fw={700}>{spectateState.winner === 'player1' ? spectateNicknames[0] : spectateState.winner === 'player2' ? spectateNicknames[1] : '平局'}！</Text>}
            </Stack>
        );
    }

    const rematchHint = !rematchRequests.myRequest && !rematchRequests.opponentRequest ? null
        : rematchRequests.myRequest && rematchRequests.opponentRequest ? '双方已准备'
            : rematchRequests.myRequest ? '你已请求再来一局，等待对手…'
                : '对手请求再来一局';

    return (
        <Stack gap="md">
            {error && <Text c="red" size="sm" onClick={clearError}>{error}</Text>}
            <Text fw={500}>第 {roundNum} 轮 · 你：{scores[0]} | 对手：{scores[1]}</Text>
            <Text size="sm">对手：{opponentNickname}</Text>
            {hasScores && (
                <Text size="sm" c="dimmed">
                    总比分：你 {myWins} 胜 · 对手 {oppWins} 胜
                    {totalScores.draws > 0 && ` · ${totalScores.draws} 平`}
                </Text>
            )}
            {phase !== 'ended' && (
                submitted
                    ? <Text c="dimmed">已出牌，等待对手…</Text>
                    : (
                            <Group>{hand.map(card => (
                                <Button key={card} variant="outline" onClick={() => { playCard(card); }}>{card}</Button>
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
                            <Text size="sm">你：{r.yourCard} vs 对手：{r.opponentCard}，得{r.scoreGained}分</Text>
                        </Group>
                    ))}
                </Stack>
            )}
            {phase === 'ended' && lastRound?.winner && (
                <Text fw={700} c={lastRound.winner === 'you' ? 'green' : lastRound.winner === 'draw' ? 'blue' : 'red'}>
                    {lastRound.winner === 'you' ? '你赢了！' : lastRound.winner === 'draw' ? '平局！' : `${opponentNickname} 赢了！`}
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
