import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocket, WebSocketServer } from 'ws';
import type { GameType } from './types.js';
import { getRoomById, getRoomList, handleAddAi, handleCreate, handleCreateAiRoom, handleDisconnect, handleJoin, handleMove, handleRematch, handleSetGomokuModel, handleSpectate } from './rooms.js';
import { getRelayRoomList, handleRelayCreate, handleRelayDisconnect, handleRelayJoin, handleRelayMessage } from './relay.js';
import { gomokuEngine } from './games/gomoku-engine.js';

const app = new Hono();

app.use('*', cors());

app.get('/api/rooms', c => c.json(getRoomList()));
app.get('/api/rooms/:id', (c) => {
    const room = getRoomById(c.req.param('id'));
    if (!room) { return c.json({ error: 'not found' }, 404); }
    return c.json(room);
});
app.get('/api/relay-rooms', c => c.json(getRelayRoomList()));
app.get('/api/gomoku/models', async c => c.json(await gomokuEngine.listModels()));
app.get('/api/health', c => c.json('healthy'));

gomokuEngine.start();
gomokuEngine.ensureReady().catch(e => console.error('[gomoku-engine] init failed', e));

app.use('/*', serveStatic({ root: './public' }));

app.get('/*', async (c) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/ws')) { return c.notFound(); }
    const html = await readFile('./public/index.html', 'utf-8');
    return c.html(html);
});

const port = Number(process.env.PORT) || 8793;
const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Listening on http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ noServer: true });

(server as Server).on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    }
});

const broadcastOnlineCount = () => {
    const msg = JSON.stringify({ type: 'online_count', count: wss.clients.size });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) { client.send(msg); } // eslint-disable-line @stylistic/max-statements-per-line
    });
};

wss.on('connection', (ws) => {
    broadcastOnlineCount();
    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; nickname?: string; roomId?: string; game?: GameType; payload?: unknown; modelId?: string };
        if (msg.type === 'relay_create') {
            handleRelayCreate(ws);
        }
        else if (msg.type === 'relay_join' && msg.roomId) {
            handleRelayJoin(ws, msg.roomId);
        }
        else if (msg.type === 'relay') {
            handleRelayMessage(ws, msg.payload);
        }
        else if (msg.type === 'create_room' && msg.nickname && msg.game) {
            handleCreate(ws, msg.nickname, msg.game);
        }
        else if (msg.type === 'create_ai_room' && msg.nickname && msg.game) {
            handleCreateAiRoom(ws, msg.nickname, msg.game, msg.modelId);
        }
        else if (msg.type === 'join_room' && msg.roomId && msg.nickname) {
            handleJoin(ws, msg.roomId, msg.nickname);
        }
        else if (msg.type === 'spectate_room' && msg.roomId) {
            handleSpectate(ws, msg.roomId);
        }
        else if (msg.type === 'add_ai') {
            handleAddAi(ws);
        }
        else if (msg.type === 'move') {
            handleMove(ws, msg);
        }
        else if (msg.type === 'set_model' && msg.modelId) {
            handleSetGomokuModel(ws, msg.modelId);
        }
        else if (msg.type === 'rematch') {
            handleRematch(ws);
        }
    });
    ws.on('close', () => {
        if (!handleRelayDisconnect(ws)) { handleDisconnect(ws); } // eslint-disable-line @stylistic/max-statements-per-line
        broadcastOnlineCount();
    });
});
