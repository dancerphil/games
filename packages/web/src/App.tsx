import { useEffect } from 'react';
import { Anchor, Button, Group, Stack, Title } from '@mantine/core';
import { useAppStore } from './store';
import type { GameType, InitialAction } from './hooks/useGameRoom';
import { HomePage } from './pages/home/HomePage';
import { EmperorSlave } from './pages/emperor-slave/EmperorSlave';
import { MineTexas } from './pages/mine-texas/MineTexas';
import { Nine } from './pages/nine/Nine';
import { TicTacToe } from './pages/tic-tac-toe/TicTacToe';
import { StancePage } from './pages/stance/StancePage';
import { BossBlastPage } from './pages/boss/BossBlastPage';
import { BossTornadoPage } from './pages/boss-tornado/BossTornadoPage';
import { BossThunderPage } from './pages/boss-thunder/BossThunderPage';
import { BossSpacetimePage } from './pages/boss-spacetime/BossSpacetimePage';
import { BossTidalPage } from './pages/boss-tidal/BossTidalPage';
import { BossSiegePage } from './pages/boss-siege/BossSiegePage';

const GAME_TITLES: Record<GameType, string> = {
    'tic-tac-toe': '井字棋',
    'emperor-slave': '国王与奴隶',
    'nine': '九张牌',
    'mine-texas': '地雷德扑',
    'stance': '招式对战',
    'boss-blast': 'Boss战',
    'boss-tornado': 'Boss战',
    'boss-thunder': 'Boss战',
    'boss-spacetime': 'Boss战',
    'boss-tidal': 'Boss战',
    'boss-siege': 'Boss战',
};

type BossGame = 'boss-blast' | 'boss-tornado' | 'boss-thunder' | 'boss-spacetime' | 'boss-tidal' | 'boss-siege';

const BossHub = ({ game, initialAction }: { game: BossGame; initialAction: InitialAction }) => {
    const { enterGame } = useAppStore();
    return (
        <Stack align="center" gap="sm">
            <Group gap="xs">
                <Button size="xs" variant={game === 'boss-blast' ? 'filled' : 'outline'} onClick={() => { if (game !== 'boss-blast') { enterGame('boss-blast', { type: 'create_ai' }); } }}>爆破</Button>
                <Button size="xs" variant={game === 'boss-tornado' ? 'filled' : 'outline'} onClick={() => { if (game !== 'boss-tornado') { enterGame('boss-tornado', { type: 'create_ai' }); } }}>龙卷</Button>
                <Button size="xs" variant={game === 'boss-thunder' ? 'filled' : 'outline'} onClick={() => { if (game !== 'boss-thunder') { enterGame('boss-thunder', { type: 'create_ai' }); } }}>雷神</Button>
                <Button size="xs" variant={game === 'boss-spacetime' ? 'filled' : 'outline'} onClick={() => { if (game !== 'boss-spacetime') { enterGame('boss-spacetime', { type: 'create_ai' }); } }}>时空</Button>
                <Button size="xs" variant={game === 'boss-tidal' ? 'filled' : 'outline'} onClick={() => { if (game !== 'boss-tidal') { enterGame('boss-tidal', { type: 'create_ai' }); } }}>潮汐</Button>
                <Button size="xs" variant={game === 'boss-siege' ? 'filled' : 'outline'} onClick={() => { if (game !== 'boss-siege') { enterGame('boss-siege', { type: 'create_ai' }); } }}>围攻</Button>
            </Group>
            {game === 'boss-blast' && <BossBlastPage initialAction={initialAction} />}
            {game === 'boss-tornado' && <BossTornadoPage initialAction={initialAction} />}
            {game === 'boss-thunder' && <BossThunderPage initialAction={initialAction} />}
            {game === 'boss-spacetime' && <BossSpacetimePage initialAction={initialAction} />}
            {game === 'boss-tidal' && <BossTidalPage initialAction={initialAction} />}
            {game === 'boss-siege' && <BossSiegePage initialAction={initialAction} />}
        </Stack>
    );
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
            {game === 'stance' && <StancePage initialAction={initialAction} />}
            {(game === 'boss-blast' || game === 'boss-tornado' || game === 'boss-thunder' || game === 'boss-spacetime' || game === 'boss-tidal' || game === 'boss-siege') && <BossHub game={game as BossGame} initialAction={initialAction} />}
        </Stack>
    );
};
