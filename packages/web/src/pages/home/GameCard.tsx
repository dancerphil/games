import { ActionIcon, Badge, Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../store';
import { useNickname } from '../../hooks/useNickname';
import type { GameInfo, RoomInfo } from './types';

interface GameCardProps {
    game: GameInfo;
    rooms: RoomInfo[];
}

export const GameCard = ({ game, rooms }: GameCardProps) => {
    const [nickname] = useNickname();
    const navigate = useNavigate();
    const { send, setMessageHandler } = useAppStore();

    const handleEnter = (key: typeof game.key) => {
        let done = false;
        const handler = (msg: Record<string, unknown>) => {
            if (done) { return; }
            if (msg['type'] === 'room_created') {
                done = true;
                setMessageHandler(null);
                void navigate(`/room/${msg['roomId'] as string}`, { state: { isCreator: true, yourRole: msg['yourRole'] as string, initialState: msg['state'] as unknown } });
            }
            else if (msg['type'] === 'error') {
                done = true;
                setMessageHandler(null);
            }
        };
        setMessageHandler(handler);
        send({ type: 'create_room', nickname, game: key });
        setTimeout(() => { if (!done) { setMessageHandler(null); } }, 5000);
    };

    return (
        <Card shadow="sm" padding="md" radius="md" withBorder>
            <Stack gap="xs">
                <Group justify="space-between" align="center">
                    <Group gap="xs" align="baseline">
                        <Text fw={700}>{game.label}</Text>
                        <Tooltip label={game.tooltip} multiline maw={240} events={{ hover: true, focus: true, touch: true }}>
                            <Text size="xs" c="dimmed" style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>规则</Text>
                        </Tooltip>
                    </Group>
                    <ActionIcon size="sm" variant="light" disabled={!nickname} onClick={() => { handleEnter(game.key); }} aria-label="进入房间">
                        <IconPlus size={14} />
                    </ActionIcon>
                </Group>
                {rooms.length > 0 && (
                    <Stack gap={4}>
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
                                            onClick={() => { void navigate(`/room/${room.id}`); }}
                                        >
                                            加入
                                        </Button>
                                    )}
                                    {room.status === 'playing' && (
                                        <Button
                                            size="compact-xs"
                                            variant="light"
                                            onClick={() => { void navigate(`/room/${room.id}`, { state: { isSpectate: true } }); }}
                                        >
                                            观战
                                        </Button>
                                    )}
                                </Group>
                            </Group>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    );
};
