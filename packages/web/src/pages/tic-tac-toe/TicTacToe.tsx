import { useCallback, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { RoomWaiting } from '../../components/RoomWaiting';
import { useGameRoom } from '../../hooks/useGameRoom';
import type { InitialAction } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';
import { TicTacToeBoard } from './TicTacToeBoard';
import type { Board, Player, TttGameMessage } from './wsTypes';

const EMPTY_BOARD: Board = Array(9).fill(null) as Board;

export const TicTacToe = ({ initialAction }: { initialAction?: InitialAction }) => {
    const [nickname] = useNickname();
    const [board, setBoard] = useState<Board>([...EMPTY_BOARD]);
    const [currentTurn, setCurrentTurn] = useState<Player>('X');
    const [winner, setWinner] = useState<Player | null | undefined>(undefined);

    const resetGame = useCallback(() => {
        setBoard([...EMPTY_BOARD]);
        setCurrentTurn('X');
        setWinner(undefined);
    }, []);

    const handleGameMessage = useCallback((msg: TttGameMessage) => {
        if (msg.type === 'move') {
            setBoard((prev) => {
                const next = [...prev] as Board;
                next[msg.position] = msg.player;
                return next;
            });
            setCurrentTurn(msg.player === 'X' ? 'O' : 'X');
        }
        else if (msg.type === 'game_over') {
            setWinner(msg.winner);
            setGameEnded();
        }
        else if (msg.type === 'spectating' || msg.type === 'spectate_update') {
            setBoard(msg.state.board as Board);
            setCurrentTurn(msg.state.currentTurn);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const { connected, phase, roomId, role, opponentNickname, spectateNicknames, send, rematch, setGameEnded, rematchRequests, totalScores, myIndex } =
        useGameRoom<TttGameMessage>({ game: 'tic-tac-toe', nickname, onGameMessage: handleGameMessage, onReset: resetGame, initialAction });

    const handleCellClick = useCallback((index: number) => {
        if (phase !== 'playing' || currentTurn !== role) { return; }
        send({ type: 'move', position: index });
    }, [phase, currentTurn, role, send]);

    if (!connected || phase === 'lobby') { return <GameConnecting />; }
    if (phase === 'waiting') { return <RoomWaiting roomId={roomId} />; }

    const isSpectating = phase === 'spectating';
    const [p1Name, p2Name] = spectateNicknames;
    const isDraw = winner === null;
    const statusText = phase === 'ended'
        ? winner === role ? '你赢了！' : isDraw ? '平局！' : `${opponentNickname} 赢了！`
        : isSpectating
            ? `${currentTurn === 'X' ? p1Name : p2Name}（${currentTurn}）的回合`
            : currentTurn === role ? '轮到你了' : `${opponentNickname} 的回合`;

    const myWins = myIndex === 0 ? totalScores.p1Wins : totalScores.p2Wins;
    const oppWins = myIndex === 0 ? totalScores.p2Wins : totalScores.p1Wins;
    const hasScores = totalScores.p1Wins > 0 || totalScores.p2Wins > 0 || totalScores.draws > 0;

    const rematchHint = !rematchRequests.myRequest && !rematchRequests.opponentRequest ? null
        : rematchRequests.myRequest && rematchRequests.opponentRequest ? '双方已准备'
            : rematchRequests.myRequest ? '你已请求再来一局，等待对手…'
                : '对手请求再来一局';

    return (
        <Stack align="center" gap="lg">
            <Text size="lg" fw={500}>{statusText}</Text>
            {hasScores && (
                <Group gap="xs">
                    <Text size="sm" c="dimmed">
                        总比分：你 {myWins} 胜 · 对手 {oppWins} 胜
                        {totalScores.draws > 0 && ` · ${totalScores.draws} 平`}
                    </Text>
                </Group>
            )}
            {isSpectating
                ? <Text size="sm" c="dimmed">{p1Name}（X）vs {p2Name}（O）观战中</Text>
                : <Text size="sm" c="dimmed">你是 {role}，对手：{opponentNickname}</Text>}
            <TicTacToeBoard
                board={board}
                onCellClick={handleCellClick}
                disabled={phase === 'ended' || isSpectating || currentTurn !== role}
            />
            {phase === 'ended' && <RematchSection hint={rematchHint} onRematch={rematch} />}
        </Stack>
    );
};
