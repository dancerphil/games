import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createInterface } from 'node:readline';

const BOARD_SIZE = 15;
const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRST';

const posToGtp = (pos: number) => {
    const r = Math.floor(pos / BOARD_SIZE);
    const c = pos % BOARD_SIZE;
    return `${GTP_COLUMNS[c]}${BOARD_SIZE - r}`;
};

const gtpToPos = (vertex: string) => {
    const v = vertex.trim().toUpperCase();
    const col = GTP_COLUMNS.indexOf(v[0]);
    const row = BOARD_SIZE - Number(v.slice(1));
    return row * BOARD_SIZE + col;
};

const findPythonDir = () => {
    const candidates = [
        path.resolve(process.cwd(), 'python'),
        path.resolve(process.cwd(), '../../python'),
        path.resolve(import.meta.dirname ?? process.cwd(), '../../../python'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(path.join(p, 'engine.py'))) return p;
    }
    return path.resolve(process.cwd(), '../../python');
};

class GomokuEngine {
    private proc: ChildProcess | null = null;
    private rl: ReturnType<typeof createInterface> | null = null;
    private queue: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
    private buffer: string[] = [];
    private currentModel: string | null = null;
    private started = false;
    private serial: Promise<void> = Promise.resolve();

    start() {
        if (this.started) return;
        this.started = true;
        this.spawn();
    }

    private spawn() {
        const pythonDir = findPythonDir();
        const enginePath = path.join(pythonDir, 'engine.py');
        const args = ['run', '--project', pythonDir, 'python', enginePath];
        this.proc = spawn('uv', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc.on('error', () => {
            // fallback to python3 direct
            this.proc = spawn('python3', [enginePath], { stdio: ['pipe', 'pipe', 'pipe'] });
            this.attach();
            return;
        });
        this.attach();
        this.proc.on('exit', () => {
            setTimeout(() => this.spawn(), 1000);
        });
    }

    private attach() {
        if (!this.proc?.stdout) return;
        this.rl = createInterface({ input: this.proc.stdout });
        this.rl.on('line', (line) => {
            const trimmed = line.trim();
            if (trimmed === '') {
                if (this.buffer.length === 0) return;
                const full = this.buffer.join('\n');
                this.buffer = [];
                const q = this.queue.shift();
                if (!q) return;
                if (full.startsWith('=')) {
                    const payload = full.slice(1).trim();
                    // strip optional id prefix
                    const parts = payload.split(/\s+/);
                    let p = payload;
                    if (parts[0] && /^\d+$/.test(parts[0])) p = payload.slice(parts[0].length).trim();
                    q.resolve(p);
                }
                else {
                    q.reject(new Error(full.slice(1).trim() || 'GTP error'));
                }
                return;
            }
            // ignore warning lines from uv before GTP starts? They go to stderr now, stdout only GTP
            if (trimmed.startsWith('warning:')) return;
            this.buffer.push(trimmed);
        });
        // stderr passthrough for debugging
        this.proc.stderr?.on('data', (d) => {
            const s = d.toString();
            if (s.includes('warning:')) return;
            process.stderr.write(`[gomoku-engine] ${s}`);
        });
    }

    private command(cmd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.queue.push({ resolve, reject });
            this.proc?.stdin?.write(cmd + '\n');
        });
    }

    async ensureReady() {
        if (!this.proc) this.spawn();
        // wait a bit for process to be ready
        for (let i = 0; i < 20; i++) {
            if (this.proc?.stdin?.writable) break;
            await new Promise(r => setTimeout(r, 100));
        }
        await this.command('boardsize 15');
        await this.command('set_time_limit 500');
    }

    async getMove(board: (string | null)[], player: string, modelId = 'heuristic-v1'): Promise<{ row: number; col: number }> {
        let release: (() => void) | undefined;
        const prev = this.serial;
        this.serial = new Promise<void>((r) => { release = r; });
        await prev;
        try {
            if (this.currentModel !== modelId) {
                await this.command(`set_model ${modelId}`);
                this.currentModel = modelId;
            }
            await this.command('clear_board');
            for (let i = 0; i < board.length; i++) {
                const v = board[i];
                if (!v) continue;
                const vertex = posToGtp(i);
                const color = v === 'black' ? 'black' : 'white';
                await this.command(`play ${color} ${vertex}`);
            }
            const vertex = await this.command(`genmove ${player}`);
            const pos = gtpToPos(vertex);
            return { row: Math.floor(pos / BOARD_SIZE), col: pos % BOARD_SIZE };
        }
        finally {
            release!();
        }
    }

    async listModels(): Promise<string[]> {
        let release: (() => void) | undefined;
        const prev = this.serial;
        this.serial = new Promise<void>((r) => { release = r; });
        await prev;
        try {
            const res = await this.command('list_models');
            return res.split(/\s+/).filter(Boolean);
        }
        finally {
            release!();
        }
    }
}

export const gomokuEngine = new GomokuEngine();
