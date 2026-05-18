import { useEffect, useState } from 'react';
import { SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { useNickname } from '../../hooks/useNickname';
import { useAppStore } from '../../store';
import { GameCard } from './GameCard';
import { GAMES } from './types';
import type { RoomInfo } from './types';

export const HomePage = () => {
    const [nickname, setNickname] = useNickname();
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const onlineCount = useAppStore(s => s.onlineCount);

    useEffect(() => {
        const base = import.meta.env['VITE_API_BASE'] ?? '';
        const fetchRooms = () => {
            fetch(`${base}/api/rooms`).then(r => r.json() as Promise<RoomInfo[]>).then(setRooms).catch(() => {});
        };
        fetchRooms();
        const interval = setInterval(fetchRooms, 3000);
        return () => {
            clearInterval(interval);
        };
    }, []);

    return (
        <Stack p="xl" gap="lg" maw={900} mx="auto">
            <Title order={1}>Games</Title>
            <TextInput
                label="昵称"
                placeholder="输入你的昵称"
                value={nickname}
                onChange={e => setNickname(e.currentTarget.value)}
                maw={240}
            />
            {onlineCount > 0 && <Text size="sm" c="dimmed">当前在线：{onlineCount} 人</Text>}
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                {GAMES.map(game => (
                    <GameCard
                        key={game.key}
                        game={game}
                        rooms={rooms.filter(r => r.gameType === game.key)}
                    />
                ))}
            </SimpleGrid>
        </Stack>
    );
};
