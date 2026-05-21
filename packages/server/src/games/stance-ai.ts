import type { StanceName, Pos } from '@games/shared';
import { ALL_STANCES, STANCES, eqPos, makeContext, skillAttackTargets, skillMoveOptions } from '@games/shared';

const getMoveOptions = (card: StanceName, pos: Pos, pi: number): Pos[] =>
    skillMoveOptions(STANCES[card], makeContext({ from: pos, to: pos, playerIndex: pi as 0 | 1 }));
const getAttackOptions = (card: StanceName, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillAttackTargets(STANCES[card], makeContext({ from: originalPos ?? pos, to: pos, playerIndex: pi as 0 | 1 }));
const isNoMove = (card: StanceName): boolean => STANCES[card].move(makeContext()).length === 0;
const isDodge = (card: StanceName): boolean => Boolean(STANCES[card].immune);
const isCharge = (card: StanceName): boolean => Boolean(STANCES[card].charge);

const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

export const getAiDeckSelect = (): { stances: StanceName[] } => ({ stances: shuffle([...ALL_STANCES]).slice(0, 5) });

export const getAiMove = (state: { hand: StanceName[]; positions: [Pos, Pos]; pi: number }): { card: StanceName; moveTo: Pos; attackAt: Pos | null } | null => {
    const { hand, positions, pi } = state;
    const myPos = positions[pi];
    const oppPos = positions[1 - pi];

    // Prefer moves that hit the opponent
    for (const card of shuffle([...hand])) {
        if (isCharge(card)) { return { card, moveTo: myPos, attackAt: null }; }
        const moveOpts = isNoMove(card) ? [myPos] : getMoveOptions(card, myPos, pi);
        for (const moveTo of shuffle(moveOpts)) {
            if (isDodge(card)) { return { card, moveTo, attackAt: null }; }
            const attackCells = getAttackOptions(card, moveTo, pi, myPos);
            if (attackCells.length === 0) {
                // Auto-attack landing position (e.g. monkey)
                if (eqPos(moveTo, oppPos)) { return { card, moveTo, attackAt: null }; }
                continue;
            }
            const hit = attackCells.find(c => c.row === oppPos.row && c.col === oppPos.col);
            if (hit) { return { card, moveTo, attackAt: hit }; }
        }
    }

    // Fallback: random valid move
    const card = hand[Math.floor(Math.random() * hand.length)];
    if (isCharge(card)) { return { card, moveTo: myPos, attackAt: null }; }
    const moveOpts = isNoMove(card) ? [myPos] : getMoveOptions(card, myPos, pi);
    const moveTo = moveOpts.length > 0 ? moveOpts[Math.floor(Math.random() * moveOpts.length)] : myPos;
    if (isDodge(card)) { return { card, moveTo, attackAt: null }; }
    const attackOpts = getAttackOptions(card, moveTo, pi, myPos);
    const attackAt = attackOpts.length > 0 ? attackOpts[Math.floor(Math.random() * attackOpts.length)] : null;
    return { card, moveTo, attackAt };
};
