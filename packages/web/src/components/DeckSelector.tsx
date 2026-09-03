import { SimpleGrid, Stack, Text } from '@mantine/core';
import type { StanceName } from '@games/shared';
import { ALL_STANCES } from '@games/shared';
import { StanceCard } from './StanceCard';

interface DeckSelectorProps {
    selected: Set<StanceName>;
    onToggle: (s: StanceName) => void;
    disabled?: (s: StanceName) => boolean;
    playerIndex?: 0 | 1;
    action?: React.ReactNode;
}

export const DeckSelector = ({ selected, onToggle, disabled, playerIndex = 0, action }: DeckSelectorProps) => (
    <Stack gap="sm" maw={760} w="100%">
        <Text size="sm">选择 5 张招式组成套牌（已选 {selected.size}/5）</Text>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
            {ALL_STANCES.map(s => (
                <StanceCard
                    key={s}
                    stance={s}
                    playerIndex={playerIndex}
                    selected={selected.has(s)}
                    disabled={disabled ? disabled(s) : !selected.has(s) && selected.size >= 5}
                    onClick={() => { onToggle(s); }}
                />
            ))}
        </SimpleGrid>
        {action}
    </Stack>
);
