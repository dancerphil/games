import { Button, Stack, Text } from '@mantine/core';

interface RematchSectionProps {
    hint: string | null;
    onRematch: () => void;
}

export const RematchSection = ({ hint, onRematch }: RematchSectionProps) => (
    <Stack align="center" gap="xs">
        {hint && <Text size="sm" c="dimmed">{hint}</Text>}
        <Button onClick={onRematch} variant="light">再来一局</Button>
    </Stack>
);
