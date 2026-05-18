import { Button, CopyButton, Group, Loader, Stack, Text } from '@mantine/core';

interface RoomWaitingProps {
    roomId: string;
}

export const RoomWaiting = ({ roomId }: RoomWaitingProps) => (
    <Stack align="center" gap="md">
        <Loader size="sm" />
        <Text>等待对手加入</Text>
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
