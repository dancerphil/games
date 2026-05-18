import { useState } from 'react';
import { Alert, Button, CopyButton, Group, Stack, Text, TextInput } from '@mantine/core';

interface Props {
    connected: boolean;
    isWaiting: boolean;
    roomId: string;
    error: string;
    onCreateRoom: () => void;
    onJoinRoom: (roomId: string) => void;
    onSpectate: (roomId: string) => void;
}

export const RoomLobby = ({ connected, isWaiting, roomId, error, onCreateRoom, onJoinRoom, onSpectate }: Props) => {
    const [joinInput, setJoinInput] = useState('');
    const [spectateInput, setSpectateInput] = useState('');

    if (isWaiting) {
        return (
            <Stack gap="md">
                <Text>房间已创建，等待对手加入</Text>
                <Group>
                    <Text fw={700}>房间号：{roomId}</Text>
                    <CopyButton value={roomId}>
                        {({ copied, copy }) => (
                            <Button size="xs" variant="light" onClick={copy}>{copied ? '已复制' : '复制'}</Button>
                        )}
                    </CopyButton>
                </Group>
            </Stack>
        );
    }

    return (
        <Stack gap="md">
            {error && <Alert color="red" onClose={() => { /* handled by parent */ }}>{error}</Alert>}
            {!connected && <Text c="dimmed" size="sm">连接中...</Text>}
            <Button disabled={!connected} onClick={onCreateRoom}>创建房间</Button>
            <Group>
                <TextInput placeholder="房间号" value={joinInput} onChange={e => { setJoinInput(e.target.value); }} />
                <Button disabled={!connected || !joinInput} onClick={() => { onJoinRoom(joinInput); }}>加入房间</Button>
            </Group>
            <Group>
                <TextInput placeholder="房间号（观战）" value={spectateInput} onChange={e => { setSpectateInput(e.target.value); }} />
                <Button disabled={!connected || !spectateInput} variant="light" onClick={() => { onSpectate(spectateInput); }}>观战</Button>
            </Group>
        </Stack>
    );
};
