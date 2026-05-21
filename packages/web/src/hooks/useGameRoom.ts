import { useCallback, useEffect, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useAppStore } from '../store';

export type GameType = 'tic-tac-toe' | 'emperor-slave' | 'nine' | 'mine-texas' | 'stance' | 'boss-blast' | 'boss-tornado' | 'boss-thunder' | 'boss-spacetime' | 'boss-tidal' | 'boss-siege';
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
    const { connected, send, setMessageHandler } = useAppStore();
    const [phase, setPhase] = useState<Phase>('lobby');
    const [roomId, setRoomId] = useState('');
    const [role, setRole] = useState('');
    const [opponentNickname, setOpponentNickname] = useState('');
    const [spectateNicknames, setSpectateNicknames] = useState<[string, string]>(['', '']);
    const [rematchRequests, setRematchRequests] = useState({ myRequest: false, opponentRequest: false });
    const [totalScores, setTotalScores] = useState({ p1Wins: 0, p2Wins: 0, draws: 0 });
    const [myIndex, setMyIndex] = useState(0);
    const sentRef = useRef(false);
    const onGameMessageRef = useRef(onGameMessage);
    onGameMessageRef.current = onGameMessage;
    const onResetRef = useRef(onReset);
    onResetRef.current = onReset;

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
            onGameMessageRef.current(raw as unknown as TGameMsg);
        }
        else if (type === 'game_start') {
            setRole(raw['yourRole'] as string);
            setOpponentNickname(raw['opponentNickname'] as string);
            setPhase('playing');
            onGameMessageRef.current(raw as unknown as TGameMsg);
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
            notifications.show({ color: 'red', message: '对手已离开' });
            onResetRef.current?.();
        }
        else if (type === 'error') {
            notifications.show({ color: 'red', message: raw['message'] as string });
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
            setPhase('playing');
            onResetRef.current?.();
        }
        else {
            onGameMessageRef.current(raw as unknown as TGameMsg);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setMessageHandler(handleMessage);
        return () => { setMessageHandler(null); }; // eslint-disable-line @stylistic/max-statements-per-line
    }, [setMessageHandler, handleMessage]);

    useEffect(() => {
        if (!connected || sentRef.current || !initialAction || !nickname) { return; }
        sentRef.current = true;
        if (initialAction.type === 'create') { send({ type: 'create_room', nickname, game }); } // eslint-disable-line @stylistic/max-statements-per-line
        else if (initialAction.type === 'create_ai') { send({ type: 'create_ai_room', nickname, game }); } // eslint-disable-line @stylistic/max-statements-per-line
        else if (initialAction.type === 'join' && initialAction.roomId) { send({ type: 'join_room', roomId: initialAction.roomId, nickname }); } // eslint-disable-line @stylistic/max-statements-per-line
        else if (initialAction.type === 'spectate' && initialAction.roomId) { send({ type: 'spectate_room', roomId: initialAction.roomId }); } // eslint-disable-line @stylistic/max-statements-per-line
    }, [connected, nickname]); // eslint-disable-line react-hooks/exhaustive-deps

    const rematch = useCallback(() => { send({ type: 'rematch' }); }, [send]); // eslint-disable-line @stylistic/max-statements-per-line
    const setGameEnded = useCallback(() => { setPhase('ended'); }, []); // eslint-disable-line @stylistic/max-statements-per-line

    return { connected, phase, roomId, role, opponentNickname, spectateNicknames, send, rematch, setGameEnded, rematchRequests, totalScores, myIndex };
};
