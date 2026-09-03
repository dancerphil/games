import type { WebSocket } from 'ws';
import type { Pos, StanceName } from '@games/shared';
import {
    ALL_STANCES,
    STANCES,
    eqPos,
    makeContext,
    shuffle,
    skillAttackTargets,
    skillHitCells,
    skillMoveOptions,
} from '@games/shared';
import type { Room } from '../types.js';
import { send } from '../send.js';

export const ROLES: [string, string] = ['player', 'boss'];

interface HandState { hand: StanceName[]; discard: StanceName[]; deckSelected: boolean; pendingDoubleDamage?: boolean }

export interface BossEngineState<TExtra> {
    phase: 'deck_selection' | 'playing' | 'ended';
    positions: [Pos, Pos]; // [player, primary boss unit]
    bossUnits: Pos[];
    hp: [number, number];
    handState: HandState;
    skillIndex: number;
    turn: number;
    winner: 0 | 1 | 'draw' | null;
    extra: TExtra;
}

export interface TurnInput<TExtra> {
    skillId: string;
    extra: TExtra;
    bossUnits: Pos[];
    playerFrom: Pos;
    random: () => number;
}

export interface TurnOutput<TExtra> {
    bossUnits: Pos[];
    unitMoves: { from: Pos; to: Pos }[];
    aoe: Pos[]; // flashy area for this turn's attack animation
    hazard?: Pos[]; // persistent cells that also damage (e.g. lightning trail)
    nextExtra: TExtra;
}

export interface BossDefinition<TExtra> {
    bossHp: number;
    initPlayer: Pos;
    initBossUnits: Pos[];
    initExtra: () => TExtra;
    skillSequence: string[];
    resolveTurn: (input: TurnInput<TExtra>) => TurnOutput<TExtra>;
    bossTargets?: (bossUnits: Pos[]) => Pos[]; // cells the player must hit to damage the boss (default: all units)
    startExtras?: (extra: TExtra, bossUnits: Pos[]) => Record<string, unknown>;
    resultExtras?: (extra: TExtra, output: TurnOutput<TExtra>) => Record<string, unknown>;
    spectateExtras?: (extra: TExtra, bossUnits: Pos[]) => Record<string, unknown>;
    reportMissAsZeroDamage?: boolean;
}

const playerContext = (from: Pos, to: Pos, opponent: Pos) =>
    makeContext({ from, to, playerIndex: 0, opponent });

export const createBossGame = <TExtra>(definition: BossDefinition<TExtra>) => {
    const skillAt = (index: number): string => definition.skillSequence[index % definition.skillSequence.length];

    const initState = (): BossEngineState<TExtra> => ({
        phase: 'deck_selection',
        positions: [definition.initPlayer, definition.initBossUnits[0]],
        bossUnits: [...definition.initBossUnits],
        hp: [2, definition.bossHp],
        handState: { hand: [], discard: [], deckSelected: false },
        skillIndex: 0,
        turn: 1,
        winner: null,
        extra: definition.initExtra(),
    });

    const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
        const state = room.gameState as BossEngineState<TExtra>;
        const player = room.players.find(currentPlayer => currentPlayer.ws === ws && !currentPlayer.isAI);
        if (!player) { return false; }
        const message = data as { stances?: StanceName[]; card?: StanceName; moveTo?: Pos; attackAt?: Pos | null };

        if (state.phase === 'deck_selection') {
            const stances = message.stances ?? [];
            if (stances.length !== 5 || new Set(stances).size !== 5) { return false; }
            if (!stances.every(stance => (ALL_STANCES as string[]).includes(stance))) { return false; }
            if (state.handState.deckSelected) { return false; }
            const shuffled = shuffle(stances);
            state.handState = { hand: shuffled.slice(0, 3), discard: shuffled.slice(3), deckSelected: true };
            state.phase = 'playing';
            send(ws, {
                type: 'boss_turn_start',
                turn: state.turn,
                positions: state.positions,
                hp: state.hp,
                hand: state.handState.hand,
                discard: state.handState.discard,
                bossSkill: skillAt(state.skillIndex),
                ...definition.startExtras?.(state.extra, state.bossUnits),
            });
            return false;
        }

        if (state.phase !== 'playing') { return false; }
        const { card, moveTo, attackAt } = message;
        if (!card || !state.handState.hand.includes(card)) { return false; }
        const cardSkill = STANCES[card];

        const playerFrom = state.positions[0];

        let playerTo: Pos;
        const moveOptions = skillMoveOptions(cardSkill, playerContext(playerFrom, playerFrom, state.positions[1]));
        if (moveOptions.length === 0) {
            playerTo = playerFrom;
        }
        else {
            if (!moveTo || !moveOptions.some(option => eqPos(option, moveTo))) { return false; }
            playerTo = moveTo;
        }

        let resolvedAttackAt: Pos | null = null;
        const attackContext = playerContext(playerFrom, playerTo, state.positions[1]);
        const attackOptions = skillAttackTargets(cardSkill, attackContext);
        if (attackOptions.length > 0 && attackAt != null) {
            if (!attackOptions.some(option => eqPos(option, attackAt))) { return false; }
            resolvedAttackAt = attackAt;
        }

        const skillId = skillAt(state.skillIndex);
        const output = definition.resolveTurn({
            skillId,
            extra: state.extra,
            bossUnits: state.bossUnits,
            playerFrom,
            random: Math.random,
        });

        const playerIsDodging = Boolean(cardSkill.immune);
        const playerDamage = state.handState.pendingDoubleDamage ? 2 : 1;
        state.handState.pendingDoubleDamage = false;

        const playerHitCells = skillHitCells(cardSkill, attackContext, resolvedAttackAt);
        const bossTargets = definition.bossTargets?.(output.bossUnits) ?? output.bossUnits;
        const iHitBoss = playerHitCells.some(cell => bossTargets.some(target => eqPos(cell, target)));
        const damageCells = output.hazard ? [...output.aoe, ...output.hazard] : output.aoe;
        const bossHitsPlayer = !playerIsDodging && damageCells.some(cell => eqPos(cell, playerTo));

        if (iHitBoss) { state.hp[1] -= playerDamage; }
        if (bossHitsPlayer) { state.hp[0] -= 1; }
        state.bossUnits = output.bossUnits;
        state.positions = [playerTo, output.bossUnits[0]];
        state.extra = output.nextExtra;
        if (cardSkill.charge) { state.handState.pendingDoubleDamage = true; }

        state.handState.hand = state.handState.hand.filter(currentCard => currentCard !== card);
        state.handState.discard.push(card);
        const drawnCard = state.handState.discard.shift();
        if (drawnCard) { state.handState.hand.push(drawnCard); }

        state.skillIndex++;
        const currentTurn = state.turn;
        const gameOver = state.hp[0] <= 0 || state.hp[1] <= 0;
        if (gameOver) {
            state.winner = state.hp[0] <= 0 && state.hp[1] <= 0 ? 'draw' : state.hp[0] <= 0 ? 1 : 0;
            state.phase = 'ended';
        }
        else {
            state.turn++;
        }

        const primaryMove = output.unitMoves[0] ?? { from: state.positions[1], to: state.positions[1] };
        send(ws, {
            type: 'boss_turn_result',
            turn: currentTurn,
            myCard: card,
            myMovedTo: playerTo,
            myMovedFrom: playerFrom,
            myAttackedAt: resolvedAttackAt,
            bossSkill: skillId,
            bossMovedFrom: primaryMove.from,
            bossMovedTo: primaryMove.to,
            bossAoe: output.aoe,
            iHitBoss,
            bossHitMe: bossHitsPlayer,
            myDamage: definition.reportMissAsZeroDamage ? (iHitBoss ? playerDamage : 0) : playerDamage,
            positions: state.positions,
            hp: state.hp,
            ...definition.resultExtras?.(state.extra, output),
            gameOver,
            winner: gameOver ? state.winner : undefined,
            ...(gameOver ? {} : {
                hand: state.handState.hand,
                discard: state.handState.discard,
                nextBossSkill: skillAt(state.skillIndex),
            }),
        });
        return gameOver;
    };

    const getStartData = (): Record<string, unknown> => ({ phase: 'deck_selection' });

    const getSpectateState = (room: Room): unknown => {
        const state = room.gameState as BossEngineState<TExtra>;
        return {
            phase: state.phase,
            positions: state.positions,
            hp: state.hp,
            turn: state.turn,
            winner: state.winner,
            ...definition.spectateExtras?.(state.extra, state.bossUnits),
        };
    };

    const getResult = (room: Room): number | 'draw' => {
        const state = room.gameState as BossEngineState<TExtra>;
        return state.winner === 'draw' ? 'draw' : (state.winner as number);
    };

    return { ROLES, initState, handleMove, getStartData, getSpectateState, getResult };
};
