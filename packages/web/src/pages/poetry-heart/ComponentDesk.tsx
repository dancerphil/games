import { useCallback, useRef, useState } from 'react';
import { Box } from '@mantine/core';
import type { Slip } from '@games/shared';
import { ComponentSlip } from './ComponentSlip';

const SLIP_W = 38;
const SLIP_H = 148;

export const ComponentDesk = (p: {
    slips: Slip[];
    highlightId: string | null;
    collectAnim: string | null;
    showTitleDot: boolean;
    onPick: (s: Slip) => void;
    onDrop: (pt: { x: number; y: number }) => void;
    onHover: (id: string | null) => void;
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [scale] = useState(1);
    const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean; targetId: string | null } | null>(null);

    const toWorld = useCallback((clientX: number, clientY: number) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) { return { x: 0, y: 0 }; }
        return { x: (clientX - rect.left - pan.x) / scale, y: (clientY - rect.top - pan.y) / scale };
    }, [pan, scale]);

    const toWorldCenter = useCallback((clientX: number, clientY: number) => {
        const w = toWorld(clientX, clientY);
        return { x: w.x - SLIP_W / 2, y: w.y - SLIP_H / 2 };
    }, [toWorld]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        const slipEl = target.closest('[data-slip]') as HTMLElement | null;
        const targetId = slipEl?.getAttribute('data-slip-id') ?? null;
        drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false, targetId };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, [pan.x, pan.y]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!drag.current) { return; }
        const dx = e.clientX - drag.current.sx;
        const dy = e.clientY - drag.current.sy;
        if (Math.hypot(dx, dy) > 8) { drag.current.moved = true; }
        if (drag.current.moved) {
            setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
        }
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent) => {
        const d = drag.current;
        drag.current = null;
        if (!d) { return; }
        if (d.moved) { return; }
        if (d.targetId) {
            const slip = p.slips.find(s => s.id === d.targetId);
            if (slip) { p.onPick(slip); }
            return;
        }
        const w = toWorldCenter(e.clientX, e.clientY);
        p.onDrop(w);
    }, [p, toWorldCenter]);

    return (
        <Box
            ref={ref}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
                position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none',
                background: '#cbbd9a',
                cursor: 'grab',
            }}
        >
            <Box style={{ position: 'absolute', left: pan.x, top: pan.y, width: 1600, height: 1100, transform: `scale(${scale})`, transformOrigin: '0 0', border: '2px solid #b9a88a', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6), 0 4px 16px rgba(0,0,0,0.12)', background: '#f3e8c8' }}>
                <Box style={{ position: 'absolute', inset: 0, opacity: 0.15, backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 40px, rgba(0,0,0,0.04) 40px 41px)', borderRadius: 8 }} />
                {p.slips.map(s => (
                    <ComponentSlip
                        key={s.id}
                        slip={s}
                        highlighted={p.highlightId === s.id}
                        showTitleDot={p.showTitleDot}
                        onHover={p.onHover}
                    />
                ))}
                {p.collectAnim && (
                    <Box style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,255,255,0.95)', padding: '12px 18px', borderRadius: 12, pointerEvents: 'none', animation: 'poetryHeartPop 0.9s ease' }}>
                        收纳成功
                    </Box>
                )}
            </Box>
            <style>{`@keyframes poetryHeartPop{0%{transform:translate(-50%,-50%) scale(0.6);opacity:0}30%{opacity:1}100%{transform:translate(-50%,-80%) scale(1);opacity:0}} @keyframes poetryHeartGlow{0%,100%{box-shadow:0 0 0 0 rgba(255,200,0,0.0)}50%{box-shadow:0 0 18px 6px rgba(255,200,0,0.7)}} @keyframes poetryHeartShake{0%,100%{transform:rotate(var(--r)) translateX(0)}25%{transform:rotate(var(--r)) translateX(-1px)}75%{transform:rotate(var(--r)) translateX(1px)}}`}</style>
        </Box>
    );
};
