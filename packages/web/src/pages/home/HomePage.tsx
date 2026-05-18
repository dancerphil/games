import { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, SimpleGrid, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useNavigate } from 'react-router';
import { useNickname } from '../../hooks/useNickname';
import type { GameType } from '../../hooks/useGameRoom';

interface RoomInfo {
    id: string;
    gameType: GameType;
    status: 'waiting' | 'playing';
    player1Nickname: string;
    player2Nickname: string;
}

interface GameInfo {
    key: GameType;
    label: string;
    tooltip: string;
}

const GAMES: GameInfo[] = [
    { key: 'tic-tac-toe', label: '井字棋', tooltip: '双方轮流在 3×3 格子中落子，先将三子连成一线者获胜，格子占满则为平局' },
    { key: 'emperor-slave', label: '国王与奴隶', tooltip: '共 5 回合。国王方持 1 张国王 + 4 张平民，奴隶方持 1 张奴隶 + 4 张平民。奴隶遇国王则奴隶方胜，平民遇奴隶则国王方胜，其余继续' },
    { key: 'nine', label: '九张牌', tooltip: '双方各有 1~9 九张牌，每回合同出一张，点数大者获得两张牌点数之和，9 回合后总分高者胜' },
];

export const HomePage = () => {
    const [nickname, setNickname] = useNickname();
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const navigate = useNavigate();

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

    const getRoomsForGame = (game: GameType) => rooms.filter(r => r.gameType === game);

    return (
        <Stack p="xl" gap="lg" maw={900} mx="auto">
            <Title order={1}>Games</Title>
            <TextInput
                label="昵称"
                placeholder="输入你的昵称"
                value={nickname}
                onChange={(e) => { setNickname(e.currentTarget.value); }}
                maw={240}
            />

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                {GAMES.map((game) => {
                    const gameRooms = getRoomsForGame(game.key);
                    return (
                        <Card key={game.key} shadow="sm" padding="md" radius="md" withBorder>
                            <Stack gap="xs">
                                <Tooltip label={game.tooltip} multiline maw={240}>
                                    <Text fw={700} style={{ cursor: 'help' }}>{game.label}</Text>
                                </Tooltip>
                                <Group>
                                    <Button
                                        disabled={!nickname}
                                        onClick={() => { navigate(`/${game.key}?mode=ai`); }}
                                    >
                                        vs AI
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        disabled={!nickname}
                                        onClick={() => { navigate(`/${game.key}?action=create`); }}
                                    >
                                        创建房间
                                    </Button>
                                </Group>
                                <Stack gap={4}>
                                    <Text size="xs" fw={500} c="dimmed">在线房间</Text>
                                    {gameRooms.length === 0 && (
                                        <Text size="xs" c="dimmed">无</Text>
                                    )}
                                    {gameRooms.map(room => (
                                        <Group key={room.id} justify="space-between" gap="xs" wrap="nowrap">
                                            <Stack gap={0}>
                                                <Text size="xs" truncate maw={120}>
                                                    {room.player1Nickname}
                                                    {room.player2Nickname && ` vs ${room.player2Nickname}`}
                                                </Text>
                                            </Stack>
                                            <Group gap={4}>
                                                <Badge size="xs" color={room.status === 'waiting' ? 'yellow' : 'green'}>
                                                    {room.status === 'waiting' ? '等待中' : '游戏中'}
                                                </Badge>
                                                {room.status === 'waiting' && (
                                                    <Button
                                                        size="compact-xs"
                                                        disabled={!nickname}
                                                        onClick={() => { navigate(`/${room.gameType}?action=join&room=${room.id}`); }}
                                                    >
                                                        加入
                                                    </Button>
                                                )}
                                                {room.status === 'playing' && (
                                                    <Button
                                                        size="compact-xs"
                                                        variant="light"
                                                        onClick={() => { navigate(`/${room.gameType}?action=spectate&room=${room.id}`); }}
                                                    >
                                                        观战
                                                    </Button>
                                                )}
                                            </Group>
                                        </Group>
                                    ))}
                                </Stack>
                            </Stack>
                        </Card>
                    );
                })}
            </SimpleGrid>
        </Stack>
    );
};
