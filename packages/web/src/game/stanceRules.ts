import type { Pos, StanceName } from '@games/shared';
import { STANCES, makeContext, skillAttackTargets, skillHitCells, skillMoveOptions } from '@games/shared';

// Legacy-shaped helpers over the shared composable Skill model, shared by all stance/boss UI.
const context = (from: Pos, to: Pos, pi: number) => makeContext({ from, to, playerIndex: pi as 0 | 1 });

export const getMoveOptions = (card: StanceName, pos: Pos, pi: number): Pos[] =>
    skillMoveOptions(STANCES[card], context(pos, pos, pi));
export const getAttackOptions = (card: StanceName, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillAttackTargets(STANCES[card], context(originalPos ?? pos, pos, pi));
export const getHitCells = (card: StanceName, attackAt: Pos | null, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillHitCells(STANCES[card], context(originalPos ?? pos, pos, pi), attackAt);
export const isNoMove = (card: StanceName): boolean => STANCES[card].move(makeContext()).length === 0;
export const isCharge = (card: StanceName): boolean => Boolean(STANCES[card].charge);
export const isDodge = (card: StanceName): boolean => Boolean(STANCES[card].immune);
