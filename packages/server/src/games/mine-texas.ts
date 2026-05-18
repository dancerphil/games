import type { WebSocket } from 'ws';
import type { Room } from '../types.js';
import { send } from '../send.js';
import { type Card, dealHands, evaluateBest, findBestIndices, formatCard, handWinner } from './poker.js';

interface Selection {
    hand: Card[];
    mine: Card;
}

interface RoundResult {
    round: number;
    p1Cards: Card[];
    p2Cards: Card[];
    p1Best: string;
    p2Best: string;
    handWinner: number;
    p1Mine: Card;
    p2Mine: Card;
    p1MineHit: boolean;
    p2MineHit: boolean;
    p1Gained: number;
    p2Gained: number;
}

interface MineTexasState {
    round: number;
    hands: [Card[], Card[]];
    selections: [Selection | null, Selection | null];
    scores: [number, number];
    history: RoundResult[];
    winner: 'player1' | 'player2' | null;
}

export const ROLES: [string, string] = ['player1', 'player2'];

const WIN_SCORE = 10;

const describeHand = (cards: Card[]): string => {
    const e = evaluateBest(cards);
    const names = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
    return names[e.category] ?? '未知';
};

export const initState = (): MineTexasState => ({
    round: 1,
    hands: dealHands(),
    selections: [null, null],
    scores: [0, 0],
    history: [],
    winner: null,
});

const sendPlayerResult = (
    p: WebSocket, i: number, isPlayer1: boolean, oppIdx: number,
    state: MineTexasState, rr: RoundResult,
    gameOver: boolean, myWinner: string | undefined,
    handOutcome: string,
) => {
    const hands = !gameOver
        ? [isPlayer1 ? state.hands[0] : state.hands[1], isPlayer1 ? state.hands[1] : state.hands[0]] as [Card[], Card[]]
        : undefined;
    const bestCards = hands
        ? [findBestIndices(state.hands[i]).map(idx => state.hands[i][idx]), findBestIndices(state.hands[1 - i]).map(idx => state.hands[1 - i][idx])] as [Card[], Card[]]
        : undefined;
    send(p, {
        type: 'round_result',
        round: rr.round,
        yourCards: isPlayer1 ? rr.p1Cards : rr.p2Cards,
        opponentCards: isPlayer1 ? rr.p2Cards : rr.p1Cards,
        yourBest: isPlayer1 ? rr.p1Best : rr.p2Best,
        opponentBest: isPlayer1 ? rr.p2Best : rr.p1Best,
        handOutcome,
        yourMine: isPlayer1 ? rr.p1Mine : rr.p2Mine,
        opponentMine: isPlayer1 ? rr.p2Mine : rr.p1Mine,
        yourMineHit: isPlayer1 ? rr.p1MineHit : rr.p2MineHit,
        opponentMineHit: isPlayer1 ? rr.p2MineHit : rr.p1MineHit,
        scoreGained: isPlayer1 ? rr.p1Gained : rr.p2Gained,
        yourTotal: state.scores[i],
        opponentTotal: state.scores[oppIdx],
        gameOver,
        winner: myWinner,
        yourBestIndices: isPlayer1 ? findBestIndices(rr.p1Cards) : findBestIndices(rr.p2Cards),
        ...(hands ? { hands, bestCards } : {}),
    });
};

export const handleMove = (room: Room, ws: WebSocket, data: unknown): boolean => {
    const state = room.gameState as MineTexasState;
    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx === -1 || state.selections[idx] !== null) { return false; } // eslint-disable-line @stylistic/max-statements-per-line

    const d = data as { hand: Card[]; mine: Card };
    if (!d.hand || d.hand.length !== 5 || d.mine === undefined) { return false; } // eslint-disable-line @stylistic/max-statements-per-line
    if (!d.hand.every(c => state.hands[idx].includes(c))) { return false; } // eslint-disable-line @stylistic/max-statements-per-line
    if (!state.hands[1 - idx].includes(d.mine)) { return false; } // eslint-disable-line @stylistic/max-statements-per-line

    state.selections[idx] = { hand: d.hand, mine: d.mine };

    if (state.selections[0] === null || state.selections[1] === null) { return false; } // eslint-disable-line @stylistic/max-statements-per-line

    const s1 = state.selections[0];
    const s2 = state.selections[1];
    state.selections = [null, null];

    const hw = handWinner(s1.hand, s2.hand);
    const p1MineHit = s2.hand.includes(s1.mine);
    const p2MineHit = s1.hand.includes(s2.mine);
    const p1Gained = (hw === 1 ? 1 : 0) + (p1MineHit ? 1 : 0);
    const p2Gained = (hw === 2 ? 1 : 0) + (p2MineHit ? 1 : 0);
    state.scores[0] += p1Gained;
    state.scores[1] += p2Gained;

    const roundResult: RoundResult = {
        round: state.round,
        p1Cards: s1.hand,
        p2Cards: s2.hand,
        p1Best: describeHand(s1.hand),
        p2Best: describeHand(s2.hand),
        handWinner: hw,
        p1Mine: s1.mine,
        p2Mine: s2.mine,
        p1MineHit,
        p2MineHit,
        p1Gained,
        p2Gained,
    };
    state.history.push(roundResult);

    const gameOver = state.scores[0] >= WIN_SCORE || state.scores[1] >= WIN_SCORE;
    if (gameOver) {
        state.winner = state.scores[0] > state.scores[1] ? 'player1' : 'player2';
    }
    else {
        state.round++;
        state.hands = dealHands();
    }

    room.players.forEach((p, i) => {
        const oppIdx = 1 - i;
        const isPlayer1 = i === 0;
        let myWinner: string | undefined;
        if (gameOver && state.winner) {
            myWinner = state.winner === (isPlayer1 ? 'player1' : 'player2') ? 'you' : 'opponent';
        }
        const handOutcome = hw === 0 ? 'draw' : (isPlayer1 ? hw === 1 : hw === 2) ? 'win' : 'lose';
        sendPlayerResult(p.ws, i, isPlayer1, oppIdx, state, roundResult, gameOver, myWinner, handOutcome);
    });
    room.spectators.forEach((s) => {
        send(s, { type: 'spectate_update', state: getSpectateState(room) });
    });
    return gameOver;
};

export const getSpectateState = (room: Room): unknown => {
    const st = room.gameState as MineTexasState;
    return {
        round: st.round,
        hands: st.hands.map(h => h.map(formatCard)),
        scores: st.scores,
        history: st.history.map(r => ({
            round: r.round,
            p1Cards: r.p1Cards.map(formatCard),
            p2Cards: r.p2Cards.map(formatCard),
            p1Best: r.p1Best,
            p2Best: r.p2Best,
            p1Mine: formatCard(r.p1Mine),
            p2Mine: formatCard(r.p2Mine),
            p1MineHit: r.p1MineHit,
            p2MineHit: r.p2MineHit,
            p1Gained: r.p1Gained,
            p2Gained: r.p2Gained,
        })),
        winner: st.winner,
    };
};

export const getResult = (room: Room): number | 'draw' => {
    const st = room.gameState as MineTexasState;
    if (st.winner === null) { return 'draw'; } // eslint-disable-line @stylistic/max-statements-per-line
    return st.winner === 'player1' ? 0 : 1;
};

export const getStartData = (room: Room): { hands: [Card[], Card[]]; bestCards: [Card[], Card[]] } => {
    const st = room.gameState as MineTexasState;
    return {
        hands: st.hands,
        bestCards: [
            findBestIndices(st.hands[0]).map(i => st.hands[0][i]),
            findBestIndices(st.hands[1]).map(i => st.hands[1][i]),
        ],
    };
};
