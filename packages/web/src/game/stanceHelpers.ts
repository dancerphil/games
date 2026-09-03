import type { Pos, StanceName } from '@games/shared';
import { STANCES, makeContext, skillAttackTargets, skillHitCells, skillMoveOptions } from '@games/shared';

const ctx = (pi: number, from: Pos, to: Pos, opponent: Pos) => makeContext({ from, to, playerIndex: pi as 0 | 1, opponent });

export const getMoveOptions = (card: StanceName, pos: Pos, pi: number): Pos[] =>
    skillMoveOptions(STANCES[card], ctx(pi, pos, pos, pos));

export const getAttackOptions = (card: StanceName, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillAttackTargets(STANCES[card], ctx(pi, originalPos ?? pos, pos, pos));

export const getHitCells = (card: StanceName, attackAt: Pos | null, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillHitCells(STANCES[card], ctx(pi, originalPos ?? pos, pos, pos), attackAt);

export const isCharge = (card: StanceName): boolean => Boolean(STANCES[card].charge);
export const isNoMove = (card: StanceName): boolean => STANCES[card].move(makeContext()).length === 0;
