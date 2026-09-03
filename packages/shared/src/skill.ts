import type { Pos } from './geometry.js';
import { eqPos, keepInBounds, manhattan } from './geometry.js';

export interface SkillContext {
    from: Pos; // actor position before moving
    to: Pos; // actor position after moving (attack is evaluated here)
    playerIndex: 0 | 1; // facing orientation
    opponent: Pos; // primary target position
    state: Record<string, unknown>; // persistent per-actor state for stateful skills
    random: () => number; // [0, 1)
}

export type MovePattern = (ctx: SkillContext) => Pos[];

export interface AttackPattern {
    targets: (ctx: SkillContext) => Pos[];
    hitCells: (ctx: SkillContext, target: Pos | null) => Pos[];
}

export interface Skill {
    id: string;
    move: MovePattern;
    attack: AttackPattern;
    immune?: boolean; // immune to damage this turn (dodge)
    charge?: boolean; // next attack deals +1 damage (charge)
}

const ORIGIN: Pos = { row: 3, col: 3 };

export const makeContext = (overrides: Partial<SkillContext> = {}): SkillContext => ({
    from: ORIGIN,
    to: ORIGIN,
    playerIndex: 0,
    opponent: ORIGIN,
    state: {},
    random: Math.random,
    ...overrides,
});

export const skillMoveOptions = (skill: Skill, ctx: SkillContext): Pos[] => keepInBounds(skill.move(ctx));
export const skillAttackTargets = (skill: Skill, ctx: SkillContext): Pos[] => keepInBounds(skill.attack.targets(ctx));
export const skillHitCells = (skill: Skill, ctx: SkillContext, target: Pos | null): Pos[] =>
    keepInBounds(skill.attack.hitCells(ctx, target));

export const hasNoMove = (skill: Skill, ctx: SkillContext): boolean => skillMoveOptions(skill, ctx).length === 0;

// How an autonomous actor (a boss unit) chooses where to move among its options.
export type MoveStrategy = 'stationary' | 'toward' | 'hunt';

const nearest = (candidates: Pos[], target: Pos): Pos =>
    candidates.reduce((best, candidate) => (manhattan(candidate, target) < manhattan(best, target) ? candidate : best));

export interface MoverResolution { from: Pos; to: Pos; aoe: Pos[] }

// Resolve a single self-driven mover (most bosses): pick a destination per strategy, then compute its AOE.
export const resolveMover = (skill: Skill, ctxAtFrom: SkillContext, strategy: MoveStrategy): MoverResolution => {
    const options = skillMoveOptions(skill, ctxAtFrom);
    const candidates = options.length > 0 ? options : [ctxAtFrom.from];
    const aoeAt = (to: Pos): Pos[] => skillHitCells(skill, { ...ctxAtFrom, to }, null);
    let to: Pos;
    if (strategy === 'stationary') {
        to = ctxAtFrom.from;
    }
    else if (strategy === 'hunt') {
        to = candidates.find(candidate => aoeAt(candidate).some(cell => eqPos(cell, ctxAtFrom.opponent)))
            ?? nearest(candidates, ctxAtFrom.opponent);
    }
    else {
        to = nearest(candidates, ctxAtFrom.opponent);
    }
    return { from: ctxAtFrom.from, to, aoe: aoeAt(to) };
};

// Resolve a single random selection (a boss unit running a player stance with no tactics).
export const resolveRandom = (skill: Skill, ctxAtFrom: SkillContext, random: () => number): MoverResolution => {
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
    const options = skillMoveOptions(skill, ctxAtFrom);
    const to = options.length > 0 ? pick(options) : ctxAtFrom.from;
    const ctxAtTo = { ...ctxAtFrom, to };
    const targets = skillAttackTargets(skill, ctxAtTo);
    const target = targets.length > 0 ? pick(targets) : null;
    return { from: ctxAtFrom.from, to, aoe: skillHitCells(skill, ctxAtTo, target) };
};
