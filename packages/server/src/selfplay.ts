import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface SelfplayGameRow {
    id: number;
    batch_id: string;
    black_model: string;
    white_model: string;
    winner: 'black' | 'white' | 'draw';
    moves: number[];
    num_moves: number;
    time_limit_ms: number;
    duration_ms: number;
    created_at: string;
}

const dbPath = () => process.env['SELFPLAY_DB'] ?? join(homedir(), '.games', 'selfplay.sqlite');

const openDb = (): DatabaseSync | null => {
    const p = dbPath();
    if (!existsSync(p)) return null;
    return new DatabaseSync(p, { readOnly: true });
};

const withDb = <T>(fn: (p: { db: DatabaseSync }) => T, fallback: T): T => {
    const db = openDb();
    if (!db) return fallback;
    try {
        return fn({ db });
    }
    finally {
        db.close();
    }
};

export const listBatches = (): { batch_id: string; games: number }[] =>
    withDb(({ db }) => {
        const rows = db
            .prepare('SELECT batch_id, COUNT(*) AS games FROM games GROUP BY batch_id ORDER BY MAX(id) DESC')
            .all() as { batch_id: string; games: number }[];
        return rows;
    }, []);

export interface EloRating {
    model: string;
    rating: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
}

export const getEloRatings = (): EloRating[] =>
    withDb(({ db }) => {
        try {
            return db.prepare(
                'SELECT model, rating, games, wins, losses, draws FROM elo_ratings ORDER BY rating DESC',
            ).all() as unknown as EloRating[];
        }
        catch {
            return [];
        }
    }, []);

export const getStats = (p: { batch_id: string }): {
    batch_id: string;
    games: number;
    models: { model: string; games: number; wins: number; draws: number; losses: number; winRate: number; elo: number | null }[];
    matrix: { black_model: string; white_model: string; games: number; blackWins: number; whiteWins: number; draws: number }[];
} => {
    const { rows, elo } = withDb(({ db }) => {
        const query = p.batch_id === 'all'
            ? db.prepare('SELECT black_model, white_model, winner FROM games')
            : db.prepare('SELECT black_model, white_model, winner FROM games WHERE batch_id = ?');
        const rows = (p.batch_id === 'all' ? query.all() : query.all(p.batch_id)) as {
            black_model: string; white_model: string; winner: string;
        }[];
        let elo: EloRating[] = [];
        try {
            elo = db.prepare('SELECT model, rating, games, wins, losses, draws FROM elo_ratings').all() as unknown as EloRating[];
        }
        catch {
            elo = [];
        }
        return { rows, elo };
    }, { rows: [], elo: [] });
    const eloOf = (model: string): number | null =>
        elo.find(e => e.model === model)?.rating ?? null;
    const per = new Map<string, { games: number; wins: number; draws: number; losses: number }>();
    const mat = new Map<string, { black_model: string; white_model: string; games: number; blackWins: number; whiteWins: number; draws: number }>();
    const bump = (model: string) => {
        const e = per.get(model) ?? { games: 0, wins: 0, draws: 0, losses: 0 };
        per.set(model, e);
        return e;
    };
    for (const r of rows) {
        const b = bump(r.black_model);
        const w = bump(r.white_model);
        b.games += 1;
        w.games += 1;
        if (r.winner === 'draw') {
            b.draws += 1;
            w.draws += 1;
        }
        else if (r.winner === 'black') {
            b.wins += 1;
            w.losses += 1;
        }
        else {
            w.wins += 1;
            b.losses += 1;
        }
        const key = `${r.black_model}||${r.white_model}`;
        const m = mat.get(key) ?? { black_model: r.black_model, white_model: r.white_model, games: 0, blackWins: 0, whiteWins: 0, draws: 0 };
        m.games += 1;
        if (r.winner === 'draw') m.draws += 1;
        else if (r.winner === 'black') m.blackWins += 1;
        else m.whiteWins += 1;
        mat.set(key, m);
    }
    const models = [...per.entries()]
        .map(([model, s]) => ({ model, ...s, winRate: s.games ? s.wins / s.games : 0, elo: eloOf(model) }))
        .sort((x, y) => y.winRate - x.winRate || y.wins - x.wins);
    return { batch_id: p.batch_id, games: rows.length, models, matrix: [...mat.values()] };
};

export const listGames = (p: {
    batch_id: string; black_model?: string; white_model?: string; winner_model?: string; limit?: number; offset?: number;
}): { total: number; games: Omit<SelfplayGameRow, 'moves'>[] } =>
    withDb(({ db }) => {
        const conds: string[] = [];
        const args: (string | number)[] = [];
        if (p.batch_id !== 'all') {
            conds.push('batch_id = ?');
            args.push(p.batch_id);
        }
        if (p.black_model) {
            conds.push('black_model = ?');
            args.push(p.black_model);
        }
        if (p.white_model) {
            conds.push('white_model = ?');
            args.push(p.white_model);
        }
        if (p.winner_model) {
            conds.push('((winner = \'black\' AND black_model = ?) OR (winner = \'white\' AND white_model = ?))');
            args.push(p.winner_model, p.winner_model);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM games ${where}`).get(...args) as { n: number }).n;
        const limit = Math.min(Math.max(1, p.limit ?? 50), 200);
        const offset = Math.max(0, p.offset ?? 0);
        const games = db.prepare(
            `SELECT id, batch_id, black_model, white_model, winner, num_moves, time_limit_ms, duration_ms, created_at
             FROM games ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ).all(...args, limit, offset) as Omit<SelfplayGameRow, 'moves'>[];
        return { total, games };
    }, { total: 0, games: [] });

export const getGame = (p: { id: number }): SelfplayGameRow | null =>
    withDb(({ db }) => {
        const row = db.prepare('SELECT * FROM games WHERE id = ?').get(p.id) as
            | (Omit<SelfplayGameRow, 'moves'> & { moves: string })
            | undefined;
        if (!row) return null;
        return { ...row, moves: JSON.parse(row.moves) as number[] };
    }, null);
