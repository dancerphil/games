import { useCallback, useState } from 'react';
import { Button, Group, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { Markdown } from '@hero-u/mantine';
import { GameConnecting } from '../../components/GameConnecting';
import { RematchSection } from '../../components/RematchSection';
import { RoomWaiting } from '../../components/RoomWaiting';
import { useGameRoom } from '../../hooks/useGameRoom';
import { useNickname } from '../../hooks/useNickname';
import type { InitialAction } from '../../hooks/useGameRoom';

interface GuessMsg {
    type: string;
    role?: 'ai' | 'questioner' | 'answerer';
    text?: string;
    ended?: boolean;
}

interface ChatMsg {
    role: 'ai' | 'questioner' | 'answerer';
    text: string;
    ended?: boolean;
}

interface GuessPvpGameProps {
    initialAction: InitialAction;
}

export const GuessPvpGame = ({ initialAction }: GuessPvpGameProps) => {
    const [nickname] = useNickname();
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [inputText, setInputText] = useState('');

    const { connected, phase, roomId, role, opponentNickname, send, rematch, rematchRequests, setGameEnded } = useGameRoom<GuessMsg>({
        game: 'guess',
        nickname: nickname ?? '',
        initialAction,
        onGameMessage: (msg) => {
            if (msg.type === 'guess_message' && msg.role && msg.text !== undefined) {
                setMessages(prev => [...prev, { role: msg.role!, text: msg.text!, ended: msg.ended }]);
                if (msg.ended) { setGameEnded(); }
            }
        },
        onReset: () => { setMessages([]); },
    });

    const handleSend = useCallback(() => {
        const text = inputText.trim();
        if (!text || phase !== 'playing') { return; }
        send({ type: 'move', text });
        setInputText('');
    }, [inputText, phase, send]);

    if (!connected || phase === 'lobby') { return <GameConnecting />; }
    if (phase === 'waiting') { return <RoomWaiting roomId={roomId} />; }

    const roleHint = role === 'answerer' ? '你是回答方，请想好一个人物' : '你是提问方，请开始提问';

    return (
        <Stack gap="md" w="100%" maw={600}>
            <Text size="sm" c="dimmed">{roleHint}。对手：{opponentNickname}</Text>
            <ScrollArea h={400} p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
                <Stack gap="xs">
                    {messages.map((msg, i) => {
                        const isMine = msg.role === role;
                        return (
                            <Group key={i} justify={isMine ? 'flex-end' : 'flex-start'}>
                                <Paper
                                    p="xs"
                                    radius="md"
                                    maw="80%"
                                    bg={isMine ? 'blue.6' : 'gray.1'}
                                    style={{ color: isMine ? 'white' : 'inherit' }}
                                >
                                    {msg.role === 'ai'
                                        ? <Markdown>{msg.text}</Markdown>
                                        : <Text size="sm">{msg.text}</Text>
                                    }
                                </Paper>
                            </Group>
                        );
                    })}
                </Stack>
            </ScrollArea>
            {phase === 'playing' && (
                <Group gap="xs">
                    <TextInput
                        flex={1}
                        placeholder={role === 'questioner' ? '输入问题…' : '回答是/否…'}
                        value={inputText}
                        onChange={e => setInputText(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { handleSend(); } }}
                    />
                    <Button onClick={handleSend} disabled={!inputText.trim()}>发送</Button>
                </Group>
            )}
            {phase === 'ended' && (
                <RematchSection
                    hint={rematchRequests.opponentRequest ? '对手想再玩一局' : null}
                    onRematch={rematch}
                />
            )}
        </Stack>
    );
};

