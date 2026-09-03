import { POEMS } from './poems.js';
import type { Slip } from './types.js';

export const DESK_W = 1600;
export const DESK_H = 1100;
const SLIP_W = 38;
const SLIP_H = 148;

const mulberry32 = (seed: number) => {
    let t = seed;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
};

export const createInitialSlips = (p: { seed?: number } = {}): Slip[] => {
    const rand = mulberry32(p.seed ?? Date.now());
    const slips: Slip[] = [];
    for (const poem of POEMS) {
        poem.lines.forEach((text, lineIdx) => {
            slips.push({
                id: `${poem.id}-${lineIdx}`,
                poemId: poem.id,
                lineIdx,
                text,
                x: rand() * (DESK_W - SLIP_W - 20) + 10,
                y: rand() * (DESK_H - SLIP_H - 20) + 10,
                r: (rand() - 0.5) * 16,
            });
        });
    }
    for (let i = slips.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = slips[i]!;
        slips[i] = slips[j]!;
        slips[j] = tmp;
    }
    return slips;
};
