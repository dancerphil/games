import type { WebSocket } from 'ws';

export const send = (ws: WebSocket, msg: object) => {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
    }
};
