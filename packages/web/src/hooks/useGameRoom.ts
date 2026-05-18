import { useCallback, useEffect, useRef, useState } from 'react';

export type GameType = 'tic-tac-toe' | 'emperor-slave' | 'nine';
export type Phase = 'lobby' | 'waiting' | 'playing' | 'spectating' | 'ended';

export interface InitialAction {
    type: 'create' | 'create_ai' | 'join' | 'spectate';
    roomId?: string;
}

interface Options<TGameMsg> {
    game: GameType;
    nickname: string;
    onGameMessage: (msg: TGameMsg) => void;
    onReset?: () => void;
    initialAction?: InitialAction;
}

export const useGameRoom = <TGameMsg>({ game, nickname, onGameMessage, onReset, initialAction }: Options<TGameMsg>) => {
    const [connected, setConnected] = useState(false);
    const [phase, setPhase] = useState<Phase>('lobby');
    const [roomId, setRoomId] = useState('');
    const [role, setRole] = useState('');
    const [opponentNickname, setOpponentNickname] = useState('');
    const [spectateNicknames, setSpectateNicknames] = useState<[string, string]>(['', '']);
    const [error, setError] = useState('');
    const [rematchRequests, setRematchRequests] = useState({ myRequest: false, opponentRequest: false });
    const [totalScores, setTotalScores] = useState({ p1Wins: 0, p2Wins: 0, draws: 0 });
    const [myIndex, setMyIndex] = useState(0);
    const wsRef = useRef<WebSocket | null>(null);
    const onGameMessageRef = useRef(onGameMessage);
    onGameMessageRef.current = onGameMessage;
    const onResetRef = useRef(onReset);
    onResetRef.current = onReset;
    const initialActionDoneRef = useRef(false);

    const send = useCallback((msg: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }, []);

    const handleMessage = useCallback((raw: Record<string, unknown>) => {
        const type = raw['type'] as string;
        if (type === 'room_created') {
            setRoomId(raw['roomId'] as string);
            setRole(raw['yourRole'] as string);
            setMyIndex(0);
            setPhase('waiting');
        }
        else if (type === 'room_joined') {
            setRole(raw['yourRole'] as string);
            setOpponentNickname(raw['opponentNickname'] as string);
            setMyIndex(1);
            setPhase('playing');
        }
        else if (type === 'game_start') {
            setRole(raw['yourRole'] as string);
            setOpponentNickname(raw['opponentNickname'] as string);
            setPhase('playing');
        }
        else if (type === 'spectating') {
            setSpectateNicknames([raw['player1Nickname'] as string, raw['player2Nickname'] as string]);
            setPhase('spectating');
            onGameMessageRef.current(raw as unknown as TGameMsg);
        }
        else if (type === 'spectate_update') {
            onGameMessageRef.current(raw as unknown as TGameMsg);
        }
        else if (type === 'opponent_left') {
            setPhase('lobby');
            setOpponentNickname('');
            setRole('');
            setError('对手已离开');
            onResetRef.current?.();
        }
        else if (type === 'error') {
            setError(raw['message'] as string);
        }
        else if (type === 'rematch_update') {
            setRematchRequests({
                myRequest: raw['myRequest'] as boolean,
                opponentRequest: raw['opponentRequest'] as boolean,
            });
        }
        else if (type === 'rematch_start') {
            setRole(raw['yourRole'] as string);
            setTotalScores(raw['totalScores'] as { p1Wins: number; p2Wins: number; draws: number });
            setRematchRequests({ myRequest: false, opponentRequest: false });
            setError('');
            setPhase('playing');
            onResetRef.current?.();
        }
        else {
            onGameMessageRef.current(raw as unknown as TGameMsg);
        }
    }, []);

    useEffect(() => {
        const base = import.meta.env['VITE_API_BASE'] ?? '';
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = base ? `${protocol}//${new URL(base).host}/ws` : `${protocol}//${location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
            setConnected(true);
            if (initialAction && !initialActionDoneRef.current) {
                initialActionDoneRef.current = true;
                if (initialAction.type === 'create') {
                    ws.send(JSON.stringify({ type: 'create_room', nickname, game }));
                }
                else if (initialAction.type === 'create_ai') {
                    ws.send(JSON.stringify({ type: 'create_ai_room', nickname, game }));
                }
                else if (initialAction.type === 'join' && initialAction.roomId) {
                    ws.send(JSON.stringify({ type: 'join_room', roomId: initialAction.roomId, nickname }));
                }
                else if (initialAction.type === 'spectate' && initialAction.roomId) {
                    ws.send(JSON.stringify({ type: 'spectate_room', roomId: initialAction.roomId }));
                }
            }
        };
        ws.onclose = () => { setConnected(false); };
        ws.onmessage = (event) => {
            handleMessage(JSON.parse(event.data as string) as Record<string, unknown>);
        };
        return () => { ws.close(); };
    }, [handleMessage]); // eslint-disable-line react-hooks/exhaustive-deps

    const createRoom = useCallback(() => { send({ type: 'create_room', nickname, game }); }, [send, nickname, game]);
    const joinRoom = useCallback((id: string) => { send({ type: 'join_room', roomId: id, nickname }); }, [send, nickname]);
    const spectateRoom = useCallback((id: string) => { send({ type: 'spectate_room', roomId: id }); }, [send]);
    const rematch = useCallback(() => { send({ type: 'rematch' }); }, [send]);
    const setGameEnded = useCallback(() => { setPhase('ended'); }, []);
    const clearError = useCallback(() => { setError(''); }, []);

    return { connected, phase, roomId, role, opponentNickname, spectateNicknames, error, clearError, send, createRoom, joinRoom, spectateRoom, rematch, setGameEnded, rematchRequests, totalScores, myIndex };
};
