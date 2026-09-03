import type { Slip, SkillUnlocks } from './types.js';
import { SKILL_THRESHOLDS } from './types.js';
import { POEM_MAP } from './poems.js';

export const getUnlocks = (collectedCount: number): SkillUnlocks => ({
    seq: collectedCount >= SKILL_THRESHOLDS.seq,
    author: collectedCount >= SKILL_THRESHOLDS.author,
    title: collectedCount >= SKILL_THRESHOLDS.title,
    highlight: collectedCount >= SKILL_THRESHOLDS.highlight,
});

export const canCollect = (hand: Slip[]): string | null => {
    if (hand.length !== 4) { return null; }
    const pid = hand[0].poemId;
    for (let i = 0; i < 4; i++) {
        if (hand[i].poemId !== pid || hand[i].lineIdx !== i) { return null; }
    }
    return pid;
};

export const getHighlightSlipId = (p: { hand: Slip[]; slips: Slip[]; collectedCount: number }): string | null => {
    if (p.collectedCount < SKILL_THRESHOLDS.highlight) { return null; }
    if (p.hand.length !== 3) { return null; }
    const pid = p.hand[0].poemId;
    if (!p.hand.every(s => s.poemId === pid)) { return null; }
    const idxs = new Set(p.hand.map(s => s.lineIdx));
    if (idxs.size !== 3) { return null; }
    const missing = [0, 1, 2, 3].find(i => !idxs.has(i));
    if (missing === undefined) { return null; }
    const target = p.slips.find(s => s.poemId === pid && s.lineIdx === missing);
    return target?.id ?? null;
};

export const getPoemInfo = (poemId: string) => POEM_MAP.get(poemId) ?? null;
