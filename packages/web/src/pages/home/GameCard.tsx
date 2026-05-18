import { Badge, Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { useAppStore } from '../../store';
import { useNickname } from '../../hooks/useNickname';
import type { GameInfo, RoomInfo } from './types';

interface GameCardProps {
    game: GameInfo;
    rooms: RoomInfo[];
}

export const GameCard = ({ game, rooms }: GameCardProps) => {
    const [nickname] = useNickname();
    const { enterGame } = useAppStore();
    return (
        <Card shadow="sm" padding="md" radius="md" withBorder>
            <Stack gap="xs">
                <Group gap="xs" align="baseline">
                    <Text fw={700}>{game.label}</Text>
                    <Tooltip label={game.tooltip} multiline maw={240} events={{ hover: true, touch: true }}>
                        <Text size="xs" c="dimmed" style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>规则</Text>
                    </Tooltip>
                </Group>
                <Group>
                    {game.aiModes
                        ? game.aiModes.map(ai => (
                            <Button
                                key={ai.mode}
                                size="sm"
                                disabled={!nickname}
                                onClick={() => { enterGame(game.key, { type: 'create_ai', mode: ai.mode }); }}
                            >
                                {ai.label}
                            </Button>
                        ))
                        : (
                            <Button
                                size="sm"
                                disabled={!nickname}
                                onClick={() => { enterGame(game.key, { type: 'create_ai' }); }}
                            >
                                vs AI
                            </Button>
                        )
                    }
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!nickname}
                        onClick={() => { enterGame(game.key, { type: 'create' }); }}
                    >
                        创建房间
                    </Button>
                </Group>
                <Stack gap={4}>
                    <Text size="xs" fw={500} c="dimmed">在线房间</Text>
                    {rooms.length === 0 && (
                        <Text size="xs" c="dimmed">无</Text>
                    )}
                    {rooms.map(room => (
                        <Group key={room.id} justify="space-between" gap="xs" wrap="nowrap">
                            <Text size="xs" truncate maw={120}>
                                {room.player1Nickname}
                                {room.player2Nickname && ` vs ${room.player2Nickname}`}
                            </Text>
                            <Group gap={4}>
                                <Badge size="xs" color={room.status === 'waiting' ? 'yellow' : 'green'}>
                                    {room.status === 'waiting' ? '等待中' : '游戏中'}
                                </Badge>
                                {room.status === 'waiting' && (
                                    <Button
                                        size="compact-xs"
                                        disabled={!nickname}
                                        onClick={() => { enterGame(room.gameType, { type: 'join', roomId: room.id }); }}
                                    >
                                        加入
                                    </Button>
                                )}
                                {room.status === 'playing' && (
                                    <Button
                                        size="compact-xs"
                                        variant="light"
                                        onClick={() => { enterGame(room.gameType, { type: 'spectate', roomId: room.id }); }}
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
};
