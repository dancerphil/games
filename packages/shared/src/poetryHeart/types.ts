export interface Slip {
    id: string;
    poemId: string;
    lineIdx: number;
    text: string;
    x: number;
    y: number;
    r: number;
}

export interface PoetryHeartState {
    slips: Slip[];
    collected: string[];
}

export interface SkillUnlocks { seq: boolean; author: boolean; title: boolean; highlight: boolean }

export const SKILL_THRESHOLDS = { seq: 1, author: 3, title: 6, highlight: 10 } as const;
