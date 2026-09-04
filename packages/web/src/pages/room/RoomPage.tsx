import { useEffect, useState } from 'react';
import { Anchor, Stack, Title, Loader, Text } from '@mantine/core';
import { useParams, useLocation, Link } from 'react-router';
import type { GameType } from '@games/shared';
import { TicTacToe } from '../tic-tac-toe/TicTacToe';
import { EmperorSlave } from '../emperor-slave/EmperorSlave';
import { Nine } from '../nine/Nine';
import { MineTexas } from '../mine-texas/MineTexas';
import { StancePage } from '../stance/StancePage';
import { BossBlastPage } from '../boss/BossBlastPage';
import { BossTornadoPage } from '../boss-tornado/BossTornadoPage';
import { BossThunderPage } from '../boss-thunder/BossThunderPage';
import { BossSpacetimePage } from '../boss-spacetime/BossSpacetimePage';
import { BossTidalPage } from '../boss-tidal/BossTidalPage';
import { BossSiegePage } from '../boss-siege/BossSiegePage';
import { PoetryHeartPage } from '../poetry-heart/PoetryHeartPage';
import { Gomoku } from '../gomoku/Gomoku';
import type { PoetryHeartState } from '@games/shared';

const GAME_TITLES: Record<GameType, string> = {
    'poetry-heart': '文心',
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
    'gomoku': '五子棋',
};

interface RoomInfo {
    id: string;
    gameType: GameType;
    status: string;
}

export const RoomPage = () => {
    const { roomId = '' } = useParams<{ roomId: string }>();
    const location = useLocation() as { state?: { isCreator?: boolean; yourRole?: string; isSpectate?: boolean; initialState?: unknown } };
    const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const base = import.meta.env['VITE_API_BASE'] ?? '';
        fetch(`${base}/api/rooms/${roomId}`)
            .then(async (r) => {
                if (!r.ok) { throw new Error('房间不存在'); }
                return r.json() as Promise<RoomInfo>;
            })
            .then(setRoomInfo)
            .catch((e: Error) => setError(e.message));
    }, [roomId]);

    if (error) {
        return (
            <Stack align="center" p="xl" gap="lg">
                <Text c="red">{error}</Text>
                <Anchor component={Link} to="/">返回首页</Anchor>
            </Stack>
        );
    }
    if (!roomInfo) {
        return (
            <Stack align="center" p="xl">
                <Loader />
            </Stack>
        );
    }

    const isCreator = Boolean(location.state?.isCreator);
    const isSpectate = Boolean(location.state?.isSpectate);
    const initialRole = location.state?.yourRole as string | undefined;
    const initialState = location.state?.initialState as PoetryHeartState | undefined;
    const gameProps = { roomId, isCreator, isSpectate, initialRole };
    const poetryHeartProps = { roomId, isCreator, isSpectate, initialRole, initialState };

    if (roomInfo.gameType === 'poetry-heart') {
        return <PoetryHeartPage {...poetryHeartProps} />;
    }

    return (
        <Stack align="center" p="xl" gap="lg">
            <Anchor component={Link} to="/">← 返回</Anchor>
            <Title order={1}>{GAME_TITLES[roomInfo.gameType]}</Title>
            {roomInfo.gameType === 'tic-tac-toe' && <TicTacToe {...gameProps} />}
            {roomInfo.gameType === 'emperor-slave' && <EmperorSlave {...gameProps} />}
            {roomInfo.gameType === 'nine' && <Nine {...gameProps} />}
            {roomInfo.gameType === 'mine-texas' && <MineTexas {...gameProps} />}
            {roomInfo.gameType === 'stance' && <StancePage {...gameProps} />}
            {roomInfo.gameType === 'boss-blast' && <BossBlastPage {...gameProps} />}
            {roomInfo.gameType === 'boss-tornado' && <BossTornadoPage {...gameProps} />}
            {roomInfo.gameType === 'boss-thunder' && <BossThunderPage {...gameProps} />}
            {roomInfo.gameType === 'boss-spacetime' && <BossSpacetimePage {...gameProps} />}
            {roomInfo.gameType === 'boss-tidal' && <BossTidalPage {...gameProps} />}
            {roomInfo.gameType === 'boss-siege' && <BossSiegePage {...gameProps} />}
            {roomInfo.gameType === 'gomoku' && <Gomoku {...gameProps} />}
        </Stack>
    );
};
