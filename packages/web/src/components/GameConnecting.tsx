import { Loader, Stack, Text } from '@mantine/core';

export const GameConnecting = () => (
    <Stack align="center" gap="md">
        <Loader size="sm" />
        <Text c="dimmed" size="sm">连接中…</Text>
    </Stack>
);
