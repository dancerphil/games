import { Anchor, Button, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useNickname } from '../../hooks/useNickname';
import type { InitialAction } from '../../hooks/useGameRoom';
import { PvpGame } from './PvpGame';

export const NinePage = () => {
    const [nickname] = useNickname();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const mode = searchParams.get('mode');
    const action = searchParams.get('action');
    const roomId = searchParams.get('room') ?? undefined;

    let initialAction: InitialAction | undefined;
    if (mode === 'ai') {
        initialAction = { type: 'create_ai' };
    }
    else if (action === 'create') {
        initialAction = { type: 'create' };
    }
    else if (action === 'join') {
        initialAction = { type: 'join', roomId };
    }
    else if (action === 'spectate') {
        initialAction = { type: 'spectate', roomId };
    }

    const hasInitialAction = initialAction !== undefined;

    return (
        <Stack align="center" p="xl" gap="lg">
            <Anchor component={Link} to="/" size="sm" c="dimmed">← 返回</Anchor>
            <Title order={1}>九张牌</Title>
            {!nickname && <Text c="orange" size="sm">请先在首页设置昵称</Text>}
            {!hasInitialAction && (
                <Button
                    variant="outline"
                    disabled={!nickname}
                    onClick={() => { navigate('/nine?mode=ai'); }}
                >
                    vs AI
                </Button>
            )}
            {hasInitialAction && nickname && <PvpGame nickname={nickname} initialAction={initialAction} />}
        </Stack>
    );
};
