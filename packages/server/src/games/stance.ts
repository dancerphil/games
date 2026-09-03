import type { WebSocket } from 'ws';
import type { StanceName, Pos } from '@games/shared';
import type { Room } from '../types.js';
import { send } from '../send.js';
export type { StanceName, Pos };
import { ALL_STANCES, STANCES, eqPos, makeContext, shuffle, skillAttackTargets, skillHitCells, skillMoveOptions } from '@games/shared';

const stanceContext = (pi: number, from: Pos, to: Pos, opponent: Pos) =>
    makeContext({ from, to, playerIndex: pi as 0 | 1, opponent });
const getMoveOptions = (card: StanceName, pos: Pos, pi: number): Pos[] =>
    skillMoveOptions(STANCES[card], stanceContext(pi, pos, pos, pos));
const getAttackOptions = (card: StanceName, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillAttackTargets(STANCES[card], stanceContext(pi, originalPos ?? pos, pos, pos));
const getHitCells = (card: StanceName, attackAt: Pos | null, pos: Pos, pi: number, originalPos?: Pos): Pos[] =>
    skillHitCells(STANCES[card], stanceContext(pi, originalPos ?? pos, pos, pos), attackAt);
const isNoMove = (card: StanceName): boolean => STANCES[card].move(makeContext()).length === 0;
const isDodge = (card: StanceName): boolean => Boolean(STANCES[card].immune);
const isCharge = (card: StanceName): boolean => Boolean(STANCES[card].charge);

interface HandState { hand: StanceName[]; discard: StanceName[]; deckSelected: boolean; pendingDoubleDamage?: boolean }
interface TurnAction { card: StanceName; moveTo: Pos; attackAt: Pos | null }

interface StanceState {
    phase: 'deck_selection' | 'playing' | 'ended';
    positions: [Pos, Pos];
    hp: [number, number];
    handStates: [HandState, HandState];
    pending: [TurnAction | null, TurnAction | null];
    turn: number;
    winner: 0 | 1 | 'draw' | null;
    poisonTurns: [number, number];
}

export const ROLES: [string, string] = ['player0', 'player1'];

export const initState = (): StanceState => ({
    phase: 'deck_selection',
    positions: [{ row: 3, col: 1 }, { row: 3, col: 5 }],
    hp: [2, 2],
    handStates: [
        { hand: [], discard: [], deckSelected: false },
        { hand: [], discard: [], deckSelected: false },
    ],
    pending: [null, null],
    turn: 1,
    winner: null,
    poisonTurns: [0, 0],
});

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as StanceState;
    const player = room.players.find(p => p.ws === ws);
    if (!player) { return false; }
    const pi = player.role === 'player0' ? 0 : 1;
    const msg = data as { stances?: StanceName[]; card?: StanceName; moveTo?: Pos; attackAt?: Pos | null };

    if (state.phase === 'deck_selection') {
        const stances = msg.stances ?? [];
        if (stances.length !== 5 || new Set(stances).size !== 5) { return false; }
        if (!stances.every(s => (ALL_STANCES as string[]).includes(s))) { return false; }
        if (state.handStates[pi].deckSelected) { return false; }
        const shuffled = shuffle(stances);
        state.handStates[pi] = { hand: shuffled.slice(0, 3), discard: shuffled.slice(3), deckSelected: true };
        send(room.players[pi].ws, { type: 'deck_confirmed' });
        if (!state.handStates[0].deckSelected || !state.handStates[1].deckSelected) { return false; }
        state.phase = 'playing';
        room.players.forEach((p, i) => {
            send(p.ws, { type: 'turn_start', turn: state.turn, numPoisonRings: Math.floor(state.turn / 5), positions: state.positions, hp: state.hp, hand: state.handStates[i].hand, discard: state.handStates[i].discard, opponentHand: state.handStates[1 - i].hand, opponentDiscard: state.handStates[1 - i].discard });
        });
        return false;
    }

    if (state.phase !== 'playing') { return false; }
    const { card, moveTo, attackAt } = msg;
    if (!card || state.pending[pi] !== null) { return false; }
    if (!state.handStates[pi].hand.includes(card)) { return false; }

    const originalPos = state.positions[pi];
    let resolvedMoveTo: Pos;
    if (isNoMove(card)) {
        resolvedMoveTo = originalPos;
    }
    else {
        const moveOpts = getMoveOptions(card, originalPos, pi);
        if (!moveTo || !moveOpts.some(m => eqPos(m, moveTo))) { return false; }
        resolvedMoveTo = moveTo;
    }

    let resolvedAttackAt: Pos | null = null;
    const attackOpts = getAttackOptions(card, resolvedMoveTo, pi, originalPos);
    if (attackOpts.length === 0) {
        resolvedAttackAt = null;
    }
    else {
        if (!attackAt || !attackOpts.some(a => eqPos(a, attackAt))) { return false; }
        resolvedAttackAt = attackAt;
    }

    state.pending[pi] = { card, moveTo: resolvedMoveTo, attackAt: resolvedAttackAt };
    if (state.pending[0] === null || state.pending[1] === null) { return false; }

    const [a0, a1] = state.pending as [TurnAction, TurnAction];
    state.pending = [null, null];
    const prevPos0 = state.positions[0];
    const prevPos1 = state.positions[1];
    let np0 = a0.moveTo;
    let np1 = a1.moveTo;
    if (eqPos(np0, np1)) { np0 = prevPos0; np1 = prevPos1; }

    const p0IsDodge = isDodge(a0.card);
    const p1IsDodge = isDodge(a1.card);
    const p0Damage = state.handStates[0].pendingDoubleDamage ? 2 : 1;
    const p1Damage = state.handStates[1].pendingDoubleDamage ? 2 : 1;
    state.handStates[0].pendingDoubleDamage = false;
    state.handStates[1].pendingDoubleDamage = false;

    const p0HitsP1 = !p1IsDodge && getHitCells(a0.card, a0.attackAt, np0, 0, prevPos0).some(c => eqPos(c, np1));
    const p1HitsP0 = !p0IsDodge && getHitCells(a1.card, a1.attackAt, np1, 1, prevPos1).some(c => eqPos(c, np0));

    if (p0HitsP1) { state.hp[1] -= p0Damage; }
    if (p1HitsP0) { state.hp[0] -= p1Damage; }
    state.positions[0] = np0;
    state.positions[1] = np1;
    if (isCharge(a0.card)) { state.handStates[0].pendingDoubleDamage = true; }
    if (isCharge(a1.card)) { state.handStates[1].pendingDoubleDamage = true; }

    for (let i = 0; i < 2; i++) {
        const h = state.handStates[i];
        const played = i === 0 ? a0.card : a1.card;
        h.hand = h.hand.filter(c => c !== played);
        h.discard.push(played);
        const drawn = h.discard.shift()!;
        h.hand.push(drawn);
    }

    const numPoisonRings = Math.floor(state.turn / 5);
    const poisonDamage: [number, number] = [0, 0];
    if (numPoisonRings > 0) {
        for (let i = 0; i < 2; i++) {
            const pos = state.positions[i];
            const inPoison = Math.min(pos.row, 6 - pos.row, pos.col, 6 - pos.col) < numPoisonRings;
            if (inPoison) {
                state.poisonTurns[i]++;
                if (state.poisonTurns[i] >= 2) { state.hp[i]--; poisonDamage[i] = 1; }
            }
            else {
                state.poisonTurns[i] = 0;
            }
        }
    }

    const currentTurn = state.turn;
    const gameOver = state.hp[0] <= 0 || state.hp[1] <= 0;
    if (gameOver) {
        state.winner = state.hp[0] <= 0 && state.hp[1] <= 0 ? 'draw' : state.hp[0] <= 0 ? 1 : 0;
        state.phase = 'ended';
    }
    else {
        state.turn++;
    }

    room.players.forEach((p, i) => {
        const myA = i === 0 ? a0 : a1;
        const oppA = i === 0 ? a1 : a0;
        send(p.ws, {
            type: 'turn_result',
            turn: currentTurn,
            myCard: myA.card,
            opponentCard: oppA.card,
            myMovedTo: i === 0 ? np0 : np1,
            opponentMovedTo: i === 0 ? np1 : np0,
            myMovedFrom: i === 0 ? prevPos0 : prevPos1,
            opponentMovedFrom: i === 0 ? prevPos1 : prevPos0,
            myAttackedAt: myA.attackAt,
            opponentAttackedAt: oppA.attackAt,
            iHitOpponent: i === 0 ? p0HitsP1 : p1HitsP0,
            opponentHitMe: i === 0 ? p1HitsP0 : p0HitsP1,
            myDamage: i === 0 ? p0Damage : p1Damage,
            opponentDamage: i === 0 ? p1Damage : p0Damage,
            myPoisonDamage: poisonDamage[i],
            opponentPoisonDamage: poisonDamage[1 - i],
            positions: state.positions,
            hp: state.hp,
            gameOver,
            winner: gameOver ? state.winner : undefined,
            ...(gameOver ? {} : { hand: state.handStates[i].hand, discard: state.handStates[i].discard, opponentHand: state.handStates[1 - i].hand, opponentDiscard: state.handStates[1 - i].discard, nextTurn: state.turn, numPoisonRings: Math.floor(state.turn / 5) }),
        });
    });
    room.spectators.forEach((s) => { send(s, { type: 'spectate_update', state: getSpectateState(room) }); });
    return gameOver;
};

export const getStartData = (_room: Room): Record<string, unknown> => ({ phase: 'deck_selection' });

export const getSpectateState = (room: Room): unknown => {
    const st = room.gameState as StanceState;
    return { phase: st.phase, positions: st.positions, hp: st.hp, turn: st.turn, winner: st.winner };
};

export const getResult = (room: Room): number | 'draw' => {
    const st = room.gameState as StanceState;
    if (st.winner === 'draw') { return 'draw'; }
    return st.winner as number;
};
