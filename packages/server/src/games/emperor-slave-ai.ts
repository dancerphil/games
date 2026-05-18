type ESCard = 'king' | 'commoner' | 'slave';

interface Hand { king: number; commoner: number; slave: number }

const availableCards = (hand: Hand): ESCard[] => {
    const cards: ESCard[] = [];
    if (hand.king > 0) {
        cards.push('king');
    }
    for (let i = 0; i < hand.commoner; i++) {
        cards.push('commoner');
    }
    if (hand.slave > 0) {
        cards.push('slave');
    }
    return cards;
};

export const getAiMove = (state: { hand: Hand }): { type: 'move'; card: ESCard } | null => {
    const cards = availableCards(state.hand);
    if (cards.length === 0) {
        return null;
    }
    const card = cards[Math.floor(Math.random() * cards.length)];
    return { type: 'move', card };
};
