import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Group, NumberInput, Select, Stack, Text, Card } from '@mantine/core';
import { useAppStore } from '../../store';
import { GomokuBoard } from './GomokuBoard';
import { fetchModelCards, toModelOptions } from './models';
import type { ModelOption } from './models';

const BOARD_SIZE = 15;

interface BattleMove { row: number; col: number; player: string }
interface BattleGame {
    gameIndex: number;
    history: BattleMove[];
    board: (string | null)[];
    winner: string | null;
    finished: boolean;
}

export const GomokuBattle = () => {
    const { connected, send, setMessageHandler } = useAppStore();
    const [models, setModels] = useState<ModelOption[]>([]);
    const [blackModel, setBlackModel] = useState('nn-v6-full');
    const [whiteModel, setWhiteModel] = useState('nn-v6-base');
    const [numGames, setNumGames] = useState<number>(1);
    const [running, setRunning] = useState(false);
    const [games, setGames] = useState<BattleGame[]>([]);
    const [selected, setSelected] = useState(0);
    const [step, setStep] = useState<number | null>(null);
    const [results, setResults] = useState<{ blackWins: number; whiteWins: number; draws: number } | null>(null);

    useEffect(() => {
        fetchModelCards().then((cards) => {
            if (!cards.length) return;
            setModels(toModelOptions(cards));
            const avail = cards.filter(c => c.available);
            if (avail.length) setBlackModel(avail[0]!.model);
            if (avail.length > 1) setWhiteModel(avail[1]!.model);
        }).catch(() => {});
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const handler = (raw: Record<string, unknown>) => {
            const type = raw['type'] as string;
            if (type === 'battle_started') {
                setGames([]);
                setResults(null);
                setSelected(0);
                setStep(null);
                setRunning(true);
            }
            else if (type === 'battle_game_started') {
                const idx = raw['gameIndex'] as number;
                setGames((prev) => {
                    const next = [...prev];
                    next[idx] = { gameIndex: idx, history: [], board: Array(BOARD_SIZE * BOARD_SIZE).fill(null), winner: null, finished: false };
                    return next;
                });
                setSelected(idx);
            }
            else if (type === 'battle_move') {
                const idx = raw['gameIndex'] as number;
                const board = raw['board'] as (string | null)[];
                const history = raw['history'] as BattleMove[];
                setGames((prev) => {
                    const next = [...prev];
                    if (!next[idx]) next[idx] = { gameIndex: idx, history: [], board: Array(15 * 15).fill(null), winner: null, finished: false };
                    next[idx] = { ...next[idx], board, history, finished: false };
                    return next;
                });
                setSelected(idx);
                setStep(null);
            }
            else if (type === 'battle_game_over') {
                const idx = raw['gameIndex'] as number;
                const winner = raw['winner'] as string | null;
                const board = raw['board'] as (string | null)[];
                const history = raw['history'] as BattleMove[];
                setGames((prev) => {
                    const next = [...prev];
                    next[idx] = { gameIndex: idx, history, board, winner, finished: true };
                    return next;
                });
            }
            else if (type === 'battle_finished') {
                setResults(raw['results'] as { blackWins: number; whiteWins: number; draws: number });
                setRunning(false);
            }
            else if (type === 'battle_error') {
                setRunning(false);
            }
        };
        setMessageHandler(handler);
        return () => setMessageHandler(null);
    }, [setMessageHandler]);

    const handleStart = useCallback(() => {
        if (!connected || running) return;
        send({ type: 'battle_start', blackModel, whiteModel, numGames } as unknown as Record<string, unknown>);
    }, [connected, running, blackModel, whiteModel, numGames, send]);

    const selectedGame = games[selected];
    const displayBoard = (() => {
        if (!selectedGame) return Array(BOARD_SIZE * BOARD_SIZE).fill(null) as (string | null)[];
        if (step === null || step >= selectedGame.history.length) return selectedGame.board;
        const b: (string | null)[] = Array(BOARD_SIZE * BOARD_SIZE).fill(null);
        for (let i = 0; i <= step; i++) {
            const m = selectedGame.history[i];
            b[m.row * BOARD_SIZE + m.col] = m.player;
        }
        return b;
    })();
    const displayLastMove = (() => {
        if (!selectedGame || selectedGame.history.length === 0) return null;
        const idx = step === null ? selectedGame.history.length - 1 : step;
        const m = selectedGame.history[idx];
        if (!m) return null;
        return m.row * BOARD_SIZE + m.col;
    })();
    const isDraw = selectedGame?.winner === null && selectedGame?.finished;

    return (
        <Stack align="center" gap="md" p="md">
            <Text fw={700} size="lg">自对弈</Text>
            <Group gap="sm" wrap="wrap" justify="center">
                <Select label="黑方" data={models} value={blackModel} onChange={v => v && setBlackModel(v)} w={220} disabled={running} />
                <Select label="白方" data={models} value={whiteModel} onChange={v => v && setWhiteModel(v)} w={220} disabled={running} />
                <NumberInput label="盘数" value={numGames} onChange={v => setNumGames(typeof v === 'number' ? v : 1)} min={1} max={20} w={100} disabled={running} />
                <Button onClick={handleStart} disabled={!connected || running} mt={22} color={running ? 'gray' : 'blue'}>
                    {running ? '对弈中...' : '开始'}
                </Button>
            </Group>

            {results && (
                <Text size="sm" c="dimmed">
                    结果：黑 {results.blackWins} 胜 · 白 {results.whiteWins} 胜{results.draws > 0 && ` · ${results.draws} 平`} / {games.length} 盘
                </Text>
            )}

            {games.length > 0 && (
                <Group align="flex-start" gap="md" wrap="wrap" justify="center">
                    <Stack gap="xs">
                        {games.map(g => (
                            <Card
                                key={g.gameIndex}
                                withBorder
                                padding="xs"
                                radius="md"
                                style={{
                                    cursor: 'pointer',
                                    borderColor: selected === g.gameIndex ? '#228be6' : undefined,
                                    background: g.finished ? (g.winner ? '#fff' : '#f8f9fa') : '#fff9db',
                                }}
                                onClick={() => { setSelected(g.gameIndex); setStep(null); }}
                            >
                                <Group gap="xs" justify="space-between" wrap="nowrap">
                                    <Text size="sm" fw={selected === g.gameIndex ? 700 : 400}>第 {g.gameIndex + 1} 盘</Text>
                                    <Badge size="xs" color={g.finished ? (g.winner === 'black' ? 'dark' : g.winner === 'white' ? 'gray' : 'yellow') : 'blue'}>
                                        {g.finished ? (g.winner ? `${g.winner === 'black' ? '黑' : '白'}胜` : '平局') : `${g.history.length} 手`}
                                    </Badge>
                                </Group>
                                <Text size="xs" c="dimmed">{g.history.length ? `${g.history[0].player === 'black' ? '黑' : '白'}先` : ''} · {g.history.length} 步</Text>
                            </Card>
                        ))}
                    </Stack>

                    <Stack align="center" gap="xs">
                        <Group gap="xs">
                            <Badge color="dark" variant="filled">黑: {blackModel}</Badge>
                            <Badge color="gray" variant="filled">白: {whiteModel}</Badge>
                        </Group>
                        {selectedGame && (
                            <Text size="sm">
                                {selectedGame.finished
                                    ? isDraw ? '平局' : `${selectedGame.winner === 'black' ? '黑' : '白'}胜`
                                    : `进行中 · ${selectedGame.history.length} 手`}
                                {selectedGame.history.length > 0 && ` · ${step === null ? '终局' : `第 ${step + 1} 手`}`}
                            </Text>
                        )}
                        <GomokuBoard
                            board={displayBoard}
                            winningLine={null}
                            lastMove={displayLastMove}
                            onCellClick={() => {}}
                            disabled
                        />
                        {selectedGame && selectedGame.history.length > 0 && (
                            <Group gap="xs">
                                <Button size="xs" variant="light" onClick={() => setStep(0)} disabled={step === 0}>
                                    第一步
                                </Button>
                                <Button size="xs" variant="light" onClick={() => setStep(s => (s === null ? selectedGame.history.length - 1 : Math.max(0, (s ?? 0) - 1)))} disabled={step === 0}>
                                    上一步
                                </Button>
                                <Button size="xs" variant="light" onClick={() => setStep(s => (s === null ? 0 : Math.min(selectedGame.history.length - 1, (s ?? -1) + 1)))} disabled={step === null}>
                                    下一步
                                </Button>
                                <Button size="xs" variant="subtle" onClick={() => setStep(null)}>终局</Button>
                                <Text size="xs" c="dimmed">{selectedGame.history.length} 步</Text>
                            </Group>
                        )}
                        {selectedGame && (
                            <Box style={{ maxHeight: 120, overflowY: 'auto', width: 'min(92vw, 320px)' }}>
                                <Group gap={4} wrap="wrap">
                                    {selectedGame.history.map((m, i) => (
                                        <Badge
                                            key={i}
                                            size="xs"
                                            color={m.player === 'black' ? 'dark' : 'gray'}
                                            variant={step === i ? 'filled' : 'light'}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => setStep(i)}
                                        >
                                            {i + 1}. {m.player === 'black' ? '●' : '○'} {String.fromCharCode(65 + m.col)}{15 - m.row}
                                        </Badge>
                                    ))}
                                </Group>
                            </Box>
                        )}
                    </Stack>
                </Group>
            )}

            {!running && games.length === 0 && (
                <Text size="sm" c="dimmed">选择双方模型与盘数后开始，可回放每盘落子</Text>
            )}
        </Stack>
    );
};
