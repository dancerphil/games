import { Box, Group, Text } from '@mantine/core';
import { PoetryHeart } from '@games/shared';
import type { Slip, PoetryHeartSkillUnlocks } from '@games/shared';
type SkillUnlocks = PoetryHeartSkillUnlocks;
const { POEM_MAP } = PoetryHeart;

const SEQ = ['一', '二', '三', '四'] as const;

const MANTINE_COLOR_ROTATE = ['blue', 'yellow', 'violet', 'lime', 'indigo', 'red', 'green', 'grape', 'teal', 'orange', 'cyan', 'pink'] as const;
const titleColorVar = (poemId: string) => {
    let h = 0;
    for (let i = 0; i < poemId.length; i++) { h = (h * 31 + poemId.charCodeAt(i)) % MANTINE_COLOR_ROTATE.length; }
    return `var(--mantine-color-${MANTINE_COLOR_ROTATE[h]!}-6)`;
};

export const ComponentHoverInfo = (p: { slip: Slip | null; unlocks: SkillUnlocks }) => {
    if (!p.slip) { return null; }
    const poem = POEM_MAP.get(p.slip.poemId);
    const titleColor = poem ? titleColorVar(p.slip.poemId) : undefined;
    return (
        <Box style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 8, background: 'rgba(255,255,255,0.96)', padding: '8px 14px', borderRadius: 10, pointerEvents: 'none', minWidth: 240 }}>
            <Group gap={6} wrap="nowrap" justify="center">
                {p.unlocks.title && poem && <Text size="sm" fw={600} style={{ color: titleColor }}>《{poem.title}》</Text>}
                {p.unlocks.author && poem && <Text size="sm" c="blue">· {poem.author}</Text>}
                {p.unlocks.seq ? <Text size="sm" fw={700} c="dimmed">{SEQ[p.slip.lineIdx]}</Text> : null}
                <Text fw={700} size="sm" c="#3b2f1a" style={{ fontFamily: 'serif' }}>{p.slip.text}</Text>
            </Group>
        </Box>
    );
};
