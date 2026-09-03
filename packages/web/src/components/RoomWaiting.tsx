import { Button, CopyButton, Group, Loader, Stack, Text } from '@mantine/core';

interface RoomWaitingProps {
    roomId: string;
    onAddAi?: () => void;
    addAiLabel?: string;
}

export const RoomWaiting = ({ roomId, onAddAi, addAiLabel = '添加 AI' }: RoomWaitingProps) => (
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
        {onAddAi && (
            <Button size="sm" onClick={onAddAi}>
                {addAiLabel}
            </Button>
        )}
    </Stack>
);
