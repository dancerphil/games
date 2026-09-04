import { useCallback, useEffect, useState } from 'react';
import { Badge, Group, Select, Stack, Text } from '@mantine/core';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { RoomWaiting } from '../../components/RoomWaiting';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';
import { GomokuBoard } from './GomokuBoard';
import type { GomokuBoard as BoardType, GomokuMessage, GomokuPlayer } from './wsTypes';

const BOARD_SIZE = 15;
const EMPTY: BoardType = Array(BOARD_SIZE * BOARD_SIZE).fill(null) as BoardType;

export const Gomoku = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: {
    initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string;
}) => {
    const [nickname] = useNickname();
    const [board, setBoard] = useState<BoardType>([...EMPTY]);
    const [currentTurn, setCurrentTurn] = useState<GomokuPlayer>('black');
    const [winner, setWinner] = useState<GomokuPlayer | null | undefined>(undefined);
    const [winningLine, setWinningLine] = useState<number[] | null>(null);
    const [lastMove, setLastMove] = useState<number | null>(null);
    const [models, setModels] = useState<string[]>(['heuristic-v1']);
    const [modelId, setModelId] = useState('heuristic-v1');

    useEffect(() => {
        fetch('/api/gomoku/models').then(r => r.json()).then((d: string[]) => {
            if (Array.isArray(d) && d.length) {
                setModels(d);
                if (!d.includes(modelId)) setModelId(d[0]);
            }
        }).catch(() => {});
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const reset = useCallback(() => {
        setBoard([...EMPTY]);
        setCurrentTurn('black');
        setWinner(undefined);
        setWinningLine(null);
        setLastMove(null);
    }, []);

    const handleGameMessage = useCallback((msg: GomokuMessage) => {
        if (msg.type === 'move') {
            const pos = msg.row * BOARD_SIZE + msg.col;
            setBoard((prev) => {
                const next = [...prev] as BoardType;
                next[pos] = msg.player;
                return next;
            });
            setLastMove(pos);
            setCurrentTurn(msg.player === 'black' ? 'white' : 'black');
        }
        else if (msg.type === 'game_over') {
            setWinner(msg.winner);
            setWinningLine(msg.winningLine);
            setGameEnded();
        }
        else if (msg.type === 'spectating' || msg.type === 'spectate_update') {
            setBoard(msg.state.board as BoardType);
            setCurrentTurn(msg.state.currentTurn);
            setWinner(msg.state.winner ?? undefined);
            setWinningLine(msg.state.winningLine);
            setLastMove(msg.state.lastMove);
            if (msg.state.winner !== null && msg.state.winner !== undefined) { setGameEnded(); }
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const { connected, phase, roomId: stateRoomId, role, opponentNickname, spectateNicknames, send, rematch, addAi, setGameEnded, rematchRequests, totalScores, myIndex } =
        useGameRoom<GomokuMessage>({ game: 'gomoku', roomId, isCreator, isSpectate, initialRole, nickname, onGameMessage: handleGameMessage, onReset: reset, initialAction });

    const handleCellClick = useCallback((p: { row: number; col: number }) => {
        if (phase !== 'playing' || currentTurn !== role) return;
        send({ type: 'move', row: p.row, col: p.col });
    }, [phase, currentTurn, role, send]);

    const handleModelChange = useCallback((v: string | null) => {
        if (!v) return;
        setModelId(v);
        send({ type: 'set_model', modelId: v } as unknown as Record<string, unknown>);
    }, [send]);

    const onAddAi = useCallback(() => {
        send({ type: 'set_model', modelId } as unknown as Record<string, unknown>);
        addAi();
    }, [addAi, modelId, send]);

    if (!connected || phase === 'lobby') return <GameConnecting />;
    if (phase === 'waiting') {
        return (
            <Stack align="center" gap="md">
                <Select label="AI 模型" data={models} value={modelId} onChange={handleModelChange} w={220} />
                <RoomWaiting roomId={stateRoomId || roomId || ''} onAddAi={onAddAi} />
                <Text size="xs" c="dimmed">落子于交点 · 0.5s 时限 MCTS</Text>
            </Stack>
        );
    }

    const isSpectating = phase === 'spectating';
    const [p1Name, p2Name] = spectateNicknames;
    const isDraw = winner === null;
    const turnLabel = currentTurn === 'black' ? '黑' : '白';
    const roleLabel = role === 'black' ? '黑' : role === 'white' ? '白' : role;

    const statusText = phase === 'ended'
        ? isDraw ? '平局！' : winner === role ? '你赢了！' : `${opponentNickname} 获胜！`
        : isSpectating
            ? `${currentTurn === 'black' ? p1Name : p2Name}（${turnLabel}）回合`
            : currentTurn === role ? `轮到你（${turnLabel}）` : `等待 ${opponentNickname}（${turnLabel}）`;

    const myWins = myIndex === 0 ? totalScores.p1Wins : totalScores.p2Wins;
    const oppWins = myIndex === 0 ? totalScores.p2Wins : totalScores.p1Wins;
    const hasScores = totalScores.p1Wins > 0 || totalScores.p2Wins > 0 || totalScores.draws > 0;
    const rematchHint = !rematchRequests.myRequest && !rematchRequests.opponentRequest ? null
        : rematchRequests.myRequest && rematchRequests.opponentRequest ? '双方已准备'
            : rematchRequests.myRequest ? '你已请求再来一局，等待对手…'
                : '对手请求再来一局';

    const boardDisabled = phase === 'ended' || isSpectating || currentTurn !== role || winner !== undefined;

    return (
        <Stack align="center" gap="md">
            <Group gap="xs">
                <Badge color={currentTurn === 'black' ? 'dark' : 'gray'} variant="filled">{turnLabel}棋回合</Badge>
                <Text size="lg" fw={600}>{statusText}</Text>
            </Group>
            <Select data={models} value={modelId} onChange={handleModelChange} w={220} label="模型" disabled={isSpectating} />
            {hasScores && (
                <Text size="sm" c="dimmed">总比分：你 {myWins} 胜 · 对手 {oppWins} 胜{totalScores.draws > 0 && ` · ${totalScores.draws} 平`}</Text>
            )}
            {isSpectating
                ? <Text size="sm" c="dimmed">{p1Name}（黑）vs {p2Name}（白）观战中</Text>
                : <Text size="sm" c="dimmed">你是 {roleLabel}棋 · 对手：{opponentNickname || 'AI'}</Text>}
            <GomokuBoard board={board} winningLine={winningLine} lastMove={lastMove} onCellClick={handleCellClick} disabled={boardDisabled} />
            <Text size="xs" c="dimmed">15×15 交点落子 · 五子连珠 · 0.5s MCTS · {modelId}</Text>
            {phase === 'ended' && <RematchSection hint={rematchHint} onRematch={rematch} />}
        </Stack>
    );
};
