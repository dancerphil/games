import { WebSocket } from 'ws';

export const send = (ws: WebSocket, msg: object) => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
};
