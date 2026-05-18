import { type Card, compareHands, evaluateBest, evaluateBestRemoving, rankAllCombos } from './poker.js';

const pickRandomFrom = <T>(arr: T[], topN: number): T => {
    const n = Math.min(topN, arr.length);
    return arr[Math.floor(Math.random() * n)];
};

export const getAiMove = (state: { hand: Card[]; opponentHand: Card[] }): { type: 'move'; hand: Card[]; mine: Card } | null => {
    if (state.hand.length < 5 || state.opponentHand.length === 0) { return null; } // eslint-disable-line @stylistic/max-statements-per-line

    const combos = rankAllCombos(state.hand);
    const topHand = pickRandomFrom(combos, 3);
    const selected = topHand.indices.map(i => state.hand[i]);

    const fullEval = evaluateBest(state.opponentHand);
    const mineScores = state.opponentHand.map((_, i) => {
        const without = evaluateBestRemoving(state.opponentHand, i);
        return compareHands(fullEval, without);
    });
    const ranked = state.opponentHand.map((card, i) => ({ card, score: mineScores[i] }))
        .sort((a, b) => b.score - a.score);
    const mine = pickRandomFrom(ranked, 3).card;

    return { type: 'move', hand: selected, mine };
};
