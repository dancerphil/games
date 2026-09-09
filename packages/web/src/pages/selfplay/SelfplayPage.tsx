import { useCallback, useEffect, useState } from 'react';
import { Anchor, Badge, Button, Card, Group, Select, Stack, Table, Text } from '@mantine/core';
import { Link } from 'react-router';
import { GomokuBoard } from '../gomoku/GomokuBoard';

const BOARD_SIZE = 15;
const PAGE_SIZE = 20;
const apiBase = import.meta.env['VITE_API_BASE'] ?? '';

interface ModelStat {
    model: string;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    elo?: number | null;
}

const eloLabel = (m: { model: string; elo?: number | null }): string =>
    m.elo == null ? `${m.model}（未定级）` : `${m.model}（${Math.round(m.elo)}）`;

interface MatrixCell {
    black_model: string;
    white_model: string;
    games: number;
    blackWins: number;
    whiteWins: number;
    draws: number;
}

interface GameSummary {
    id: number;
    batch_id: string;
    black_model: string;
    white_model: string;
    winner: 'black' | 'white' | 'draw';
    num_moves: number;
    duration_ms: number;
    created_at: string;
}

interface GameDetail extends GameSummary {
    moves: number[];
}

const winnerModel = (g: { black_model: string; white_model: string; winner: string }) =>
    g.winner === 'draw' ? null : g.winner === 'black' ? g.black_model : g.white_model;

const fetchJson = async (p: { url: string }) => (await fetch(`${apiBase}${p.url}`)).json();

export const SelfplayPage = () => {
    const [batches, setBatches] = useState<{ batch_id: string; games: number }[]>([]);
    const [batch, setBatch] = useState('all');
    const [models, setModels] = useState<ModelStat[]>([]);
    const [matrix, setMatrix] = useState<MatrixCell[]>([]);
    const [totalGames, setTotalGames] = useState(0);
    const [games, setGames] = useState<GameSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [filter, setFilter] = useState<string | null>(null);
    const [detail, setDetail] = useState<GameDetail | null>(null);
    const [step, setStep] = useState<number | null>(null);

    useEffect(() => {
        fetchJson({ url: '/api/selfplay/batches' }).then((d) => {
            if (Array.isArray(d)) setBatches(d);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        setPage(0);
        fetchJson({ url: `/api/selfplay/stats?batch=${encodeURIComponent(batch)}` }).then((d) => {
            setModels(d['models'] ?? []);
            setMatrix(d['matrix'] ?? []);
            setTotalGames(d['games'] ?? 0);
        }).catch(() => {});
    }, [batch]);

    useEffect(() => {
        const params = new URLSearchParams({
            batch,
            limit: String(PAGE_SIZE),
            offset: String(page * PAGE_SIZE),
        });
        if (filter) params.set('winner', filter);
        fetchJson({ url: `/api/selfplay/games?${params}` }).then((d) => {
            setGames(d['games'] ?? []);
            setTotal(d['total'] ?? 0);
        }).catch(() => {});
    }, [batch, page, filter]);

    const openGame = useCallback((p: { id: number }) => {
        fetchJson({ url: `/api/selfplay/games/${p.id}` }).then((d) => {
            setDetail(d as GameDetail);
            setStep(null);
        }).catch(() => {});
    }, []);

    const board = (() => {
        const b: (string | null)[] = Array(BOARD_SIZE * BOARD_SIZE).fill(null);
        if (!detail) return b;
        const end = step ?? detail.moves.length - 1;
        for (let i = 0; i <= end && i < detail.moves.length; i++) {
            b[detail.moves[i]!] = i % 2 === 0 ? 'black' : 'white';
        }
        return b;
    })();
    const lastMove = (() => {
        if (!detail || !detail.moves.length) return null;
        const i = step ?? detail.moves.length - 1;
        return detail.moves[i] ?? null;
    })();

    const detailWinner = detail ? winnerModel(detail) : null;

    const matrixModels = [...new Set([...matrix.map(m => m.black_model), ...matrix.map(m => m.white_model)])].sort();
    const cellOf = (black: string, white: string) => matrix.find(m => m.black_model === black && m.white_model === white);

    return (
        <Stack p="md" gap="md" maw={900} mx="auto">
            <Group justify="space-between" align="center">
                <Text fw={700} size="lg">自对弈战绩</Text>
                <Anchor component={Link} to="/" size="sm">← 首页</Anchor>
            </Group>

            <Group gap="sm">
                <Select
                    label="批次"
                    data={[
                        { value: 'all', label: '全部' },
                        ...batches.filter(b => b.batch_id !== 'all').map(b => ({ value: b.batch_id, label: `${b.batch_id} (${b.games})` })),
                    ]}
                    value={batch}
                    onChange={v => v && setBatch(v)}
                    w={220}
                />
                <Text size="sm" c="dimmed" mt={22}>共 {totalGames} 盘</Text>
            </Group>

            <Card withBorder radius="md" padding="sm">
                <Text size="sm" fw={600} mb="xs">总胜率</Text>
                <Table striped highlightOnHover withColumnBorders={false} fz="sm">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>模型</Table.Th>
                            <Table.Th>ELO</Table.Th>
                            <Table.Th>盘数</Table.Th>
                            <Table.Th>胜</Table.Th>
                            <Table.Th>平</Table.Th>
                            <Table.Th>负</Table.Th>
                            <Table.Th>胜率</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {models.map(m => (
                            <Table.Tr key={m.model}>
                                <Table.Td>{m.model}</Table.Td>
                                <Table.Td>{m.elo == null ? '–' : Math.round(m.elo)}</Table.Td>
                                <Table.Td>{m.games}</Table.Td>
                                <Table.Td>{m.wins}</Table.Td>
                                <Table.Td>{m.draws}</Table.Td>
                                <Table.Td>{m.losses}</Table.Td>
                                <Table.Td>{(m.winRate * 100).toFixed(1)}%</Table.Td>
                            </Table.Tr>
                        ))}
                        {models.length === 0 && (
                            <Table.Tr><Table.Td colSpan={7}><Text size="sm" c="dimmed">暂无数据，先跑 pnpm selfplay</Text></Table.Td></Table.Tr>
                        )}
                    </Table.Tbody>
                </Table>
            </Card>

            {matrixModels.length > 0 && (
                <Card withBorder radius="md" padding="sm" style={{ overflowX: 'auto' }}>
                    <Text size="sm" fw={600} mb="xs">配对矩阵（行黑 × 列白：黑胜 - 白胜）</Text>
                    <Table fz="xs" withColumnBorders>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>黑\白</Table.Th>
                                {matrixModels.map(m => <Table.Th key={m}>{m}</Table.Th>)}
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {matrixModels.map(b => (
                                <Table.Tr key={b}>
                                    <Table.Td><Text fw={600} size="xs">{b}</Text></Table.Td>
                                    {matrixModels.map((w) => {
                                        const c = cellOf(b, w);
                                        return (
                                            <Table.Td key={w}>
                                                {c ? `${c.blackWins}-${c.whiteWins}${c.draws ? ` (${c.draws}平)` : ''}` : '·'}
                                            </Table.Td>
                                        );
                                    })}
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Card>
            )}

            <Group gap="sm" align="end">
                <Select
                    label="只看胜者"
                    placeholder="全部"
                    data={models.map(m => ({ value: m.model, label: eloLabel(m) }))}
                    value={filter}
                    onChange={setFilter}
                    clearable
                    w={220}
                />
                <Text size="sm" c="dimmed" mb={8}>共 {total} 盘</Text>
            </Group>

            <Stack gap="xs">
                {games.map((g) => {
                    const w = winnerModel(g);
                    return (
                        <Card
                            key={g.id}
                            withBorder
                            padding="xs"
                            radius="md"
                            style={{ cursor: 'pointer', borderColor: detail?.id === g.id ? '#228be6' : undefined }}
                            onClick={() => openGame({ id: g.id })}
                        >
                            <Group gap="xs" justify="space-between" wrap="nowrap">
                                <Text size="sm">#{g.id} {g.black_model}（黑） vs {g.white_model}（白）</Text>
                                <Badge size="xs" color={w === null ? 'yellow' : 'blue'}>
                                    {w === null ? '平局' : `${w}胜`}
                                </Badge>
                            </Group>
                            <Text size="xs" c="dimmed">{g.num_moves} 手 · {Math.round(g.duration_ms / 1000)}s · {g.created_at}</Text>
                        </Card>
                    );
                })}
            </Stack>

            {total > PAGE_SIZE && (
                <Group justify="center" gap="sm">
                    <Button size="xs" variant="light" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                        上一页
                    </Button>
                    <Text size="sm">{page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</Text>
                    <Button size="xs" variant="light" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>
                        下一页
                    </Button>
                </Group>
            )}

            {detail && (
                <Stack align="center" gap="xs">
                    <Text size="sm" fw={600}>
                        #{detail.id} {detail.black_model}（黑） vs {detail.white_model}（白）·{' '}
                        {detailWinner === null ? '平局' : `${detailWinner}胜`}
                    </Text>
                    <GomokuBoard board={board} winningLine={null} lastMove={lastMove} onCellClick={() => {}} disabled />
                    <Group gap="xs">
                        <Button size="xs" variant="light" onClick={() => setStep(0)} disabled={step === 0}>
                            第一步
                        </Button>
                        <Button size="xs" variant="light" onClick={() => setStep(s => (s === null ? detail.moves.length - 1 : Math.max(0, (s ?? 0) - 1)))} disabled={step === 0}>
                            上一步
                        </Button>
                        <Button size="xs" variant="light" onClick={() => setStep(s => (s === null ? 0 : Math.min(detail.moves.length - 1, (s ?? -1) + 1)))} disabled={step === null}>
                            下一步
                        </Button>
                        <Button size="xs" variant="subtle" onClick={() => setStep(null)}>终局</Button>
                        <Text size="xs" c="dimmed">{step === null ? '终局' : `第 ${step + 1} 手`} / {detail.moves.length} 步</Text>
                    </Group>
                </Stack>
            )}
        </Stack>
    );
};
