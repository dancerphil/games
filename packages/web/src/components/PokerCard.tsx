import { Badge } from '@mantine/core';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_COLORS = ['#222', '#c00', '#25f', '#0a0'];

const cardSuit = (n: number) => Math.floor(n / 13);
const cardRank = (n: number) => n % 13;

export const formatCard = (n: number): string =>
    `${SUITS[cardSuit(n)]}${RANKS[cardRank(n)]}`;

interface PokerCardProps {
    card: number;
    selected?: boolean;
    recommended?: boolean;
    onClick?: () => void;
    small?: boolean;
}

export const PokerCard = ({ card, selected, recommended, onClick, small }: PokerCardProps) => {
    const color = SUIT_COLORS[cardSuit(card)];
    const text = formatCard(card);
    const variant = selected ? 'filled' : recommended ? 'light' : 'outline';
    return (
        <Badge
            variant={variant}
            color={variant === 'filled' ? undefined : undefined}
            size={small ? 'md' : 'xl'}
            style={{
                cursor: onClick ? 'pointer' : 'default',
                color: variant === 'filled' ? '#fff' : color,
                backgroundColor: variant === 'filled' ? color : undefined,
                borderColor: color,
                userSelect: 'none',
                fontSize: small ? 14 : 18,
                fontWeight: 600,
                padding: small ? '4px 6px' : '8px 12px',
                ...(selected ? { opacity: 1 } : {}),
            }}
            onClick={onClick}
        >
            {text}
        </Badge>
    );
};
