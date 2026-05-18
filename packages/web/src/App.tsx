import { useEffect } from 'react';
import { Anchor, Stack, Title } from '@mantine/core';
import { useAppStore } from './store';
import { GuessPvpGame } from './pages/guess/GuessPage';
import { HomePage } from './pages/home/HomePage';
import { EmperorSlave } from './pages/emperor-slave/EmperorSlave';
import { MineTexas } from './pages/mine-texas/MineTexas';
import { Nine } from './pages/nine/Nine';
import { TicTacToe } from './pages/tic-tac-toe/TicTacToe';

const GAME_TITLES: Record<string, string> = {
    'tic-tac-toe': '井字棋',
    'emperor-slave': '国王与奴隶',
    'nine': '九张牌',
    'mine-texas': '地雷德扑',
    'guess': '猜人物',
};

export const App = () => {
    const { game, initialAction, exitGame, init } = useAppStore();

    useEffect(() => init(), []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!game || !initialAction) {
        return <HomePage />;
    }

    return (
        <Stack align="center" p="xl" gap="lg">
            <Anchor size="sm" c="dimmed" style={{ cursor: 'pointer' }} onClick={exitGame}>← 返回</Anchor>
            <Title order={1}>{GAME_TITLES[game]}</Title>
            {game === 'tic-tac-toe' && <TicTacToe initialAction={initialAction} />}
            {game === 'emperor-slave' && <EmperorSlave initialAction={initialAction} />}
            {game === 'nine' && <Nine initialAction={initialAction} />}
            {game === 'mine-texas' && <MineTexas initialAction={initialAction} />}
            {game === 'guess' && <GuessPvpGame initialAction={initialAction} />}
        </Stack>
    );
};
