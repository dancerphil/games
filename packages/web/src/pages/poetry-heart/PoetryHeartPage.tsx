import { useCallback, useMemo, useState } from 'react';
import { Anchor, Box, Loader, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { useNickname } from '../../hooks/useNickname';
import { useGameRoom } from '../../hooks/useGameRoom';
import { PoetryHeart } from '@games/shared';
import type { Slip, PoetryHeartState } from '@games/shared';
const { POEM_MAP, POEMS } = PoetryHeart;
const { canCollect, getHighlightSlipId, getUnlocks } = PoetryHeart;
const TOTAL = POEMS.length;
import { ComponentDesk } from './ComponentDesk';
import { ComponentHandStack } from './ComponentHandStack';
import { ComponentHoverInfo } from './ComponentHoverInfo';
import { GameConnecting } from '../../components/GameConnecting';

interface Msg {
    type: string;
    state?: PoetryHeartState;
    slipId?: string;
    slip?: Slip;
    poemId?: string;
    collected?: string[];
}

export const PoetryHeartPage = ({ roomId, isCreator, isSpectate, initialState }: { roomId?: string; isCreator?: boolean; isSpectate?: boolean; initialRole?: string; initialState?: PoetryHeartState }) => {
    const [nickname] = useNickname();
    const [desk, setDesk] = useState<PoetryHeartState>(() => initialState ?? { slips: [], collected: [] });
    const [hand, setHand] = useState<Slip[]>([]);
    const [hoverId, setHoverId] = useState<string | null>(null);
    const [collectAnim, setCollectAnim] = useState<string | null>(null);

    const handleGameMessage = useCallback((msg: Msg) => {
        if ((msg.type === 'room_created' || msg.type === 'game_start' || msg.type === 'room_joined') && msg.state) {
            setDesk(msg.state as PoetryHeartState);
        }
        else if (msg.type === 'spectating' && (msg as { state: PoetryHeartState }).state) {
            setDesk((msg as { state: PoetryHeartState }).state);
        }
        else if (msg.type === 'spectate_update' && (msg as { state: PoetryHeartState }).state) {
            setDesk((msg as { state: PoetryHeartState }).state);
        }
        else if (msg.type === 'desk_remove' && msg.slipId) {
            setDesk((prev: PoetryHeartState) => ({ ...prev, slips: prev.slips.filter((s: Slip) => s.id !== msg.slipId) }));
        }
        else if (msg.type === 'desk_add' && msg.slip) {
            setDesk((prev: PoetryHeartState) => ({ ...prev, slips: [...prev.slips, msg.slip!] }));
        }
        else if (msg.type === 'collected' && msg.poemId) {
            setDesk((prev: PoetryHeartState) => ({ ...prev, collected: msg.collected ?? [...prev.collected, msg.poemId!] }));
        }
        else if (msg.type === 'game_over' && msg.collected) {
            setDesk((prev: PoetryHeartState) => ({ ...prev, collected: msg.collected! }));
        }
    }, []);

    const { connected, phase, send } = useGameRoom<Msg>({
        game: 'poetry-heart',
        nickname,
        roomId,
        isCreator,
        isSpectate,
        onGameMessage: handleGameMessage,
    });

    const unlocks = useMemo(() => getUnlocks(desk.collected.length), [desk.collected.length]);
    const highlightId = useMemo(() => getHighlightSlipId({ hand, slips: desk.slips, collectedCount: desk.collected.length }), [hand, desk.slips, desk.collected.length]);

    const hoverSlip = useMemo(() => {
        if (!hoverId) { return null; }
        return desk.slips.find((s: Slip) => s.id === hoverId) ?? hand.find((s: Slip) => s.id === hoverId) ?? null;
    }, [hoverId, desk.slips, hand]);

    const tryCollect = useCallback((nextHand: Slip[]) => {
        const pid = canCollect(nextHand);
        if (!pid) { return nextHand; }
        setCollectAnim(pid);
        setTimeout(() => setCollectAnim(null), 900);
        send({ type: 'move', data: { type: 'collect', poemId: pid } } as unknown as object);
        return [];
    }, [send]);

    const onPick = useCallback((slip: Slip) => {
        if (hand.length >= 4) { return; }
        send({ type: 'move', data: { type: 'pick', slipId: slip.id } } as unknown as object);
        setDesk((prev: PoetryHeartState) => {
            if (!prev.slips.some((s: Slip) => s.id === slip.id)) { return prev; }
            return { ...prev, slips: prev.slips.filter((s: Slip) => s.id !== slip.id) };
        });
        setHand((prev: Slip[]) => {
            const next = [...prev, slip];
            if (next.length === 4) { return tryCollect(next); }
            return next;
        });
    }, [hand.length, send, tryCollect]);

    const onDrop = useCallback((pt: { x: number; y: number }) => {
        if (hand.length === 0) { return; }
        const top = hand[hand.length - 1]!;
        const placed: Slip = { ...top, x: pt.x, y: pt.y, r: (Math.random() - 0.5) * 16 };
        send({ type: 'move', data: { type: 'drop', slip: placed, x: pt.x, y: pt.y } } as unknown as object);
        setHand((prev: Slip[]) => prev.slice(0, -1));
        setDesk((prev: PoetryHeartState) => ({ ...prev, slips: [...prev.slips, placed] }));
    }, [hand, send]);

    if (!connected) { return <GameConnecting />; }
    const isWaiting = phase === 'waiting';
    const isDone = desk.collected.length >= TOTAL;

    return (
        <Box style={{ position: 'relative', width: '100%', height: '100dvh', overflow: 'hidden', background: '#e8dcc6' }}>
            <Box style={{ position: 'absolute', top: 6, left: 10, zIndex: 9 }}>
                <Anchor component={Link} to="/" size="sm">← 返回</Anchor>
            </Box>

            <ComponentHoverInfo slip={hoverSlip} unlocks={unlocks} />

            {isDone && (
                <Box style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 5, display: 'flex', justifyContent: 'center' }}>
                    <Text fw={700} size="lg" style={{ background: 'rgba(255,255,255,0.9)', padding: '4px 10px', borderRadius: 8 }}>恭喜集齐{TOTAL}首！</Text>
                </Box>
            )}

            {desk.slips.length === 0 ? (
                <Stack align="center" justify="center" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    <Loader />
                    <Text c="dimmed" size="sm">同步桌面中…</Text>
                </Stack>
            ) : (
                <ComponentDesk
                    slips={desk.slips}
                    highlightId={highlightId}
                    collectAnim={collectAnim}
                    showTitleDot={unlocks.title}
                    onPick={onPick}
                    onDrop={onDrop}
                    onHover={setHoverId}
                />
            )}

            <ComponentHandStack hand={hand} />

            <Box style={{ position: 'absolute', top: 86, right: 10, zIndex: 6, maxWidth: 240, maxHeight: '44vh', overflow: 'auto', background: 'rgba(255,255,255,0.92)', padding: 8, borderRadius: 8 }}>
                <Text size="xs" fw={600}>已收纳 {desk.collected.length} / {TOTAL} {isDone && '· 已集齐'}</Text>
                {isWaiting && <Text size="xs" c="dimmed">房间 {roomId}</Text>}
                {desk.collected.length > 0 ? desk.collected.map((pid: string) => {
                    const po = POEM_MAP.get(pid);
                    return <Text key={pid} size="xs" c="dimmed">· {po?.title} · {po?.author}</Text>;
                }) : <Text size="xs" c="dimmed" mt={4}>暂无</Text>}
            </Box>
        </Box>
    );
};
