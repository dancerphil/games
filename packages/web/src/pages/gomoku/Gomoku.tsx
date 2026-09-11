import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Group, Select, Stack, Text } from '@mantine/core';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { RoomWaiting } from '../../components/RoomWaiting';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';
import { GomokuBoard } from './GomokuBoard';
import { fetchModelCards, toModelOptions } from './models';
import type { ModelOption } from './models';
import type { GomokuBoard as BoardType, GomokuMessage, GomokuPlayer } from './wsTypes';

const BOARD_SIZE = 15;
const COLS = 'ABCDEFGHIJKLMNO';
const EMPTY: BoardType = Array(BOARD_SIZE * BOARD_SIZE).fill(null) as BoardType;

export const Gomoku = ({ initialAction, roomId, isCreator, isSpectate, initialRole }: {
    initialAction?: InitialAction; roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string;
}) => {
    const [nickname] = useNickname();
    const [board, setBoard] = useState<BoardType>([...EMPTY]);
    const boardRef = useRef<BoardType>([...EMPTY]);
    const [moves, setMoves] = useState<{ pos: number; player: GomokuPlayer }[]>([]);
    const [currentTurn, setCurrentTurn] = useState<GomokuPlayer>('black');
    const [winner, setWinner] = useState<GomokuPlayer | null | undefined>(undefined);
    const [winningLine, setWinningLine] = useState<number[] | null>(null);
    const [lastMove, setLastMove] = useState<number | null>(null);
    const [models, setModels] = useState<ModelOption[]>([]);
    const [modelId, setModelId] = useState('heuristic-v2');

    useEffect(() => {
        fetchModelCards().then((cards) => {
            if (!cards.length) return;
            setModels(toModelOptions(cards));
            const best = cards.find(c => c.available);
            if (best) setModelId(best.model);
        }).catch(() => {});
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const syncBoard = useCallback((next: BoardType) => {
        const added: { pos: number; player: GomokuPlayer }[] = [];
        for (let i = 0; i < next.length; i++) {
            if (next[i] && !boardRef.current[i]) added.push({ pos: i, player: next[i] as GomokuPlayer });
        }
        boardRef.current = next;
        setBoard(next);
        if (added.length) setMoves(prev => [...prev, ...added]);
    }, []);

    const reset = useCallback(() => {
        boardRef.current = [...EMPTY];
        setBoard([...EMPTY]);
        setMoves([]);
        setCurrentTurn('black');
        setWinner(undefined);
        setWinningLine(null);
        setLastMove(null);
    }, []);

    const handleGameMessage = useCallback((msg: GomokuMessage) => {
        if (msg.type === 'move') {
            const pos = msg.row * BOARD_SIZE + msg.col;
            const next = [...boardRef.current] as BoardType;
            next[pos] = msg.player;
            syncBoard(next);
            setLastMove(pos);
            setCurrentTurn(msg.player === 'black' ? 'white' : 'black');
        }
        else if (msg.type === 'game_over') {
            setWinner(msg.winner);
            setWinningLine(msg.winningLine);
            setGameEnded();
        }
        else if (msg.type === 'spectating' || msg.type === 'spectate_update') {
            syncBoard(msg.state.board as BoardType);
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
                <Select label="AI 模型" data={models} value={modelId} onChange={handleModelChange} w={260} />
                <RoomWaiting roomId={stateRoomId || roomId || ''} onAddAi={onAddAi} />
                <Text size="xs" c="dimmed">落子于交点 · 2s 时限 MCTS</Text>
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
            <Select data={models} value={modelId} onChange={handleModelChange} w={260} label="模型" disabled={isSpectating} />
            {hasScores && (
                <Text size="sm" c="dimmed">总比分：你 {myWins} 胜 · 对手 {oppWins} 胜{totalScores.draws > 0 && ` · ${totalScores.draws} 平`}</Text>
            )}
            {isSpectating
                ? <Text size="sm" c="dimmed">{p1Name}（黑）vs {p2Name}（白）观战中</Text>
                : <Text size="sm" c="dimmed">你是 {roleLabel}棋 · 对手：{opponentNickname || 'AI'}</Text>}
            <GomokuBoard board={board} winningLine={winningLine} lastMove={lastMove} onCellClick={handleCellClick} disabled={boardDisabled} />
            {moves.length > 0 && (
                <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', maxWidth: 'min(92vw, 480px)', userSelect: 'all', lineHeight: 1.7 }}>
                    {moves.map((m, i) => `${i + 1}.${m.player === 'black' ? '●' : '○'}${COLS[m.pos % BOARD_SIZE]}${BOARD_SIZE - Math.floor(m.pos / BOARD_SIZE)}`).join(' ')}
                </Text>
            )}
            <Text size="xs" c="dimmed">15×15 交点落子 · 五子连珠 · 2s MCTS · {modelId}</Text>
            {phase === 'ended' && <RematchSection hint={rematchHint} onRematch={rematch} />}
        </Stack>
    );
};
