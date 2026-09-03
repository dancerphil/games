import { Box, Text } from '@mantine/core';
import type { Slip } from '@games/shared';

const MANTINE_COLOR_ROTATE = ['blue', 'yellow', 'violet', 'lime', 'indigo', 'red', 'green', 'grape', 'teal', 'orange', 'cyan', 'pink'] as const;

const titleColorVar = (poemId: string) => {
    let h = 0;
    for (let i = 0; i < poemId.length; i++) { h = (h * 31 + poemId.charCodeAt(i)) % MANTINE_COLOR_ROTATE.length; }
    const c = MANTINE_COLOR_ROTATE[h]!;
    return `var(--mantine-color-${c}-6)`;
};

export const ComponentSlip = (p: { slip: Slip; highlighted: boolean; showTitleDot: boolean; onHover: (id: string | null) => void }) => {
    const { slip } = p;
    const titleShadow = p.showTitleDot ? `0 2px 8px rgba(0,0,0,0.18), 0 0 12px color-mix(in srgb, ${titleColorVar(slip.poemId)} 35%, transparent)` : '0 2px 8px rgba(0,0,0,0.18)';
    return (
        <Box
            data-slip
            data-slip-id={slip.id}
            onMouseEnter={() => p.onHover(slip.id)}
            onMouseLeave={() => p.onHover(null)}
            style={{
                'position': 'absolute',
                'left': slip.x,
                'top': slip.y,
                'width': 38,
                'height': 148,
                'background': p.highlighted ? '#fff7b2' : '#f5eed6',
                'border': `1px solid ${p.highlighted ? '#f59f00' : '#c9b896'}`,
                'borderRadius': 6,
                'boxShadow': p.highlighted ? '0 0 14px rgba(255,180,0,0.6)' : titleShadow,
                'display': 'flex',
                'alignItems': 'center',
                'justifyContent': 'center',
                'cursor': 'pointer',
                'userSelect': 'none',
                // @ts-ignore
                '--r': `${slip.r}deg`,
                'transform': `rotate(${slip.r}deg)`,
                'animation': p.highlighted ? 'poetryHeartGlow 1.2s ease-in-out infinite, poetryHeartShake 0.6s ease-in-out infinite' : undefined,
                'zIndex': p.highlighted ? 10 : 1,
            }}
        >
            <Box style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <Text
                    size="sm"
                    fw={600}
                    c="#3b2f1a"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'upright', letterSpacing: 2, lineHeight: 1.1, fontFamily: 'serif' }}
                >
                    {slip.text}
                </Text>
            </Box>
        </Box>
    );
};
