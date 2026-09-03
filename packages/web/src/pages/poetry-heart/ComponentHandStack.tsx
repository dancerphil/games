import { Box, Text } from '@mantine/core';
import type { Slip } from '@games/shared';

export const ComponentHandStack = (p: { hand: Slip[] }) => {
    const ordered = [...p.hand].reverse();
    return (
        <Box style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 7, display: 'flex', gap: 8, alignItems: 'flex-end', pointerEvents: 'none' }}>
            {p.hand.length === 0 ? (
                <Box style={{ background: 'rgba(255,255,255,0.92)', padding: '6px 10px', borderRadius: 8, border: '1px solid #c9b896' }}>
                    <Text size="sm" c="dimmed">0/4</Text>
                </Box>
            ) : (
                <Box style={{ display: 'flex', gap: 6 }}>
                    {ordered.map(s => (
                        <Box
                            key={s.id}
                            style={{
                                width: 38, height: 132,
                                background: '#fff8e1', border: '1px solid #c9b896', borderRadius: 6,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                            }}
                        >
                            <Text size="sm" fw={600} c="#3b2f1a" style={{ writingMode: 'vertical-rl', textOrientation: 'upright', fontFamily: 'serif' }}>{s.text}</Text>
                        </Box>
                    ))}
                    <Box style={{ alignSelf: 'center', background: 'rgba(255,255,255,0.92)', padding: '4px 6px', borderRadius: 6 }}>
                        <Text size="xs" c="dimmed">{p.hand.length}/4</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
};
