import { create } from 'zustand';

type MessageHandler = (msg: Record<string, unknown>) => void;

// Module-level WebSocket refs — not reactive, no re-render needed
let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let _messageHandler: MessageHandler | null = null;

interface AppStore {
    connected: boolean;
    onlineCount: number;
    send: (msg: object) => void;
    setMessageHandler: (handler: MessageHandler | null) => void;
    init: () => () => void;
}

export const useAppStore = create<AppStore>(set => ({
    connected: false,
    onlineCount: 0,

    send: (msg) => {
        if (_ws?.readyState === WebSocket.OPEN) { _ws.send(JSON.stringify(msg)); } // eslint-disable-line @stylistic/max-statements-per-line
    },

    setMessageHandler: (handler) => { _messageHandler = handler; },

    init: () => {
        const base = import.meta.env['VITE_API_BASE'] ?? '';
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = base ? new URL(base).host : location.host;
        const url = `${protocol}//${host}/ws`;
        let destroyed = false;

        const connect = () => {
            clearTimeout(_reconnectTimer);
            if (destroyed) { return; } // eslint-disable-line @stylistic/max-statements-per-line
            const ws = new WebSocket(url);
            _ws = ws;
            ws.onopen = () => { set({ connected: true }); };
            ws.onclose = () => {
                if (_ws !== ws) { return; } // eslint-disable-line @stylistic/max-statements-per-line
                set({ connected: false });
                if (!destroyed) { _reconnectTimer = setTimeout(connect, 1500); } // eslint-disable-line @stylistic/max-statements-per-line
            };
            ws.onerror = () => { ws.close(); }; // eslint-disable-line @stylistic/max-statements-per-line
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data as string) as Record<string, unknown>;
                if (msg['type'] === 'online_count') {
                    set({ onlineCount: msg['count'] as number });
                }
                else {
                    _messageHandler?.(msg);
                }
            };
        };
        connect();

        return () => {
            destroyed = true;
            clearTimeout(_reconnectTimer);
            _ws?.close();
            _ws = null;
        };
    },
}));
