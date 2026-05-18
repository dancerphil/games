import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer } from 'ws';
import type { GameType } from './types.js';
import { getRoomList, handleCreate, handleCreateAiRoom, handleDisconnect, handleJoin, handleMove, handleRematch, handleSpectate } from './rooms.js';

const app = new Hono();

app.use('*', cors());

app.get('/api/rooms', c => c.json(getRoomList()));

app.use('/*', serveStatic({ root: './public' }));

app.get('/*', async (c) => {
    const html = await readFile('./public/index.html', 'utf-8');
    return c.html(html);
});

const port = 8789;
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

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; nickname?: string; roomId?: string; game?: GameType };
        if (msg.type === 'create_room' && msg.nickname && msg.game) {
            handleCreate(ws, msg.nickname, msg.game);
        }
        else if (msg.type === 'create_ai_room' && msg.nickname && msg.game) {
            handleCreateAiRoom(ws, msg.nickname, msg.game);
        }
        else if (msg.type === 'join_room' && msg.roomId && msg.nickname) {
            handleJoin(ws, msg.roomId, msg.nickname);
        }
        else if (msg.type === 'spectate_room' && msg.roomId) {
            handleSpectate(ws, msg.roomId);
        }
        else if (msg.type === 'move') {
            handleMove(ws, msg);
        }
        else if (msg.type === 'rematch') {
            handleRematch(ws);
        }
    });
    ws.on('close', () => {
        handleDisconnect(ws);
    });
});
