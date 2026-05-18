export const getAiMove = (state: { hand: number[] }): { type: 'move'; card: number } | null => {
    if (state.hand.length === 0) {
        return null;
    }
    const card = state.hand[Math.floor(Math.random() * state.hand.length)];
    return { type: 'move', card };
};
