export interface ModelCard {
    model: string;
    available: boolean;
    elo: number | null;
    eloGames: number;
}

export interface ModelOption {
    value: string;
    label: string;
    disabled?: boolean;
}

export const toModelOptions = (cards: ModelCard[]): ModelOption[] => cards.map(m => ({
    value: m.model,
    label: !m.available ? `${m.model}（缺权重）` : m.elo == null ? `${m.model}（未定级）` : `${m.model}（${Math.round(m.elo)}）`,
    disabled: !m.available,
}));

export const fetchModelCards = async (): Promise<ModelCard[]> => {
    const r = await fetch('/api/gomoku/models');
    return r.json();
};
