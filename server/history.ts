/**
 * Game history for signed-in players: saving finished games, the history
 * list, one game's full review, profiles and head-to-head records.
 */
import type { Express, Request, Response } from 'express';
import type { PublicUser } from '../shared/account.js';
import type { GameMeta, HistoryEntry, Outcome, Profile, SavedGame } from '../shared/history.js';
import type { GameResult } from '../shared/protocol.js';
import type { Accounts } from './accounts/accounts.js';
import type { Db } from './db/index.js';

export interface FinishedGame {
  result: GameResult;
  meta: GameMeta;
  /** Account ids by seat (same order as result.players); undefined for guests. */
  userIds: (string | undefined)[];
}

const outcomeFor = (result: GameResult, playerId: string): Outcome =>
  result.winnerId === null ? 'draw' : result.winnerId === playerId ? 'win' : 'loss';

export class History {
  constructor(private db: Db) {}

  /** Saves a finished game if any player is signed in. Never throws. */
  async save(game: FinishedGame): Promise<void> {
    if (!game.userIds.some(Boolean)) return;
    const { result, meta } = game;
    try {
      await this.db.transaction(async (query) => {
        await query(
          `INSERT INTO games (id, difficulty, theme, timer_mode, reason, result) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [result.id, meta.difficulty, meta.theme, meta.timerMode, result.reason, JSON.stringify(result)],
        );
        for (const [seat, p] of result.players.entries()) {
          await query(
            `INSERT INTO game_players (game_id, seat, player_id, user_id, name, outcome, final_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [result.id, seat, p.id, game.userIds[seat] ?? null, p.name, outcomeFor(result, p.id), p.finalMs],
          );
        }
      });
    } catch (e) {
      console.error('[history] could not save game', result.id, (e as Error).message);
    }
  }

  /** A user's games, newest first. `before` is an ISO time for paging. */
  async list(userId: string, limit = 20, before?: string): Promise<HistoryEntry[]> {
    const { rows } = await this.db.query<{
      id: string; finished_at: string | Date; difficulty: string; theme: string; timer_mode: string; reason: string;
      outcome: Outcome; my_ms: number | null; opp_name: string; opp_ms: number | null; opp_username: string | null;
    }>(
      `SELECT g.id, g.finished_at, g.difficulty, g.theme, g.timer_mode, g.reason,
              me.outcome, me.final_ms AS my_ms, opp.name AS opp_name, opp.final_ms AS opp_ms, u.username AS opp_username
         FROM game_players me
         JOIN games g ON g.id = me.game_id
         JOIN game_players opp ON opp.game_id = me.game_id AND opp.seat <> me.seat
         LEFT JOIN users u ON u.id = opp.user_id
        WHERE me.user_id = $1 AND ($2::timestamptz IS NULL OR g.finished_at < $2::timestamptz)
        ORDER BY g.finished_at DESC
        LIMIT $3`,
      [userId, before ?? null, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map((r) => ({
      id: r.id,
      finishedAt: new Date(r.finished_at).toISOString(),
      difficulty: r.difficulty as HistoryEntry['difficulty'],
      theme: r.theme as HistoryEntry['theme'],
      timerMode: r.timer_mode as HistoryEntry['timerMode'],
      reason: r.reason as HistoryEntry['reason'],
      outcome: r.outcome,
      yourFinalMs: r.my_ms,
      opponent: { name: r.opp_name, username: r.opp_username },
      opponentFinalMs: r.opp_ms,
    }));
  }

  /**
   * One saved game. Private: only for a player who was in it. Shared: anyone
   * with the link (game ids are random and only ever sent to the two players).
   */
  async get(gameId: string, userId: string | null, shared = false): Promise<SavedGame | null> {
    const { rows } = await this.db.query<{ result: GameResult | string; finished_at: string | Date; difficulty: string; theme: string; timer_mode: string }>(
      'SELECT result, finished_at, difficulty, theme, timer_mode FROM games WHERE id = $1',
      [gameId],
    );
    const g = rows[0];
    if (!g) return null;
    const { rows: seats } = await this.db.query<{ player_id: string; user_id: string | null; username: string | null }>(
      'SELECT gp.player_id, gp.user_id::text AS user_id, u.username FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id WHERE gp.game_id = $1 ORDER BY gp.seat',
      [gameId],
    );
    const mine = seats.find((s) => userId && s.user_id === userId);
    if (!mine && !shared) return null;
    return {
      result: typeof g.result === 'string' ? JSON.parse(g.result) : g.result,
      finishedAt: new Date(g.finished_at).toISOString(),
      meta: { difficulty: g.difficulty as GameMeta['difficulty'], theme: g.theme as GameMeta['theme'], timerMode: g.timer_mode as GameMeta['timerMode'] },
      you: mine?.player_id ?? null,
      usernames: seats.map((s) => s.username),
    };
  }

  async profile(username: string): Promise<Profile | null> {
    const { rows: users } = await this.db.query<PublicUser & { created_at: string | Date }>(
      'SELECT id::text AS id, username, created_at FROM users WHERE lower(username) = lower($1)',
      [username],
    );
    const user = users[0];
    if (!user) return null;
    const { rows } = await this.db.query<{ outcome: Outcome; n: string | number }>(
      'SELECT outcome, count(*) AS n FROM game_players WHERE user_id = $1 GROUP BY outcome',
      [user.id],
    );
    const count = (o: Outcome) => Number(rows.find((r) => r.outcome === o)?.n ?? 0);
    return {
      username: user.username,
      memberSince: new Date(user.created_at).toISOString(),
      wins: count('win'),
      losses: count('loss'),
      draws: count('draw'),
      recent: await this.list(user.id, 10),
    };
  }

  /** Head-to-head record against an opponent: by account when they have one, else by name. */
  async record(userId: string, opponent: { userId?: string; name: string }): Promise<{ wins: number; losses: number; draws: number }> {
    const { rows } = await this.db.query<{ outcome: Outcome; n: string | number }>(
      `SELECT me.outcome, count(*) AS n
         FROM game_players me
         JOIN game_players opp ON opp.game_id = me.game_id AND opp.seat <> me.seat
        WHERE me.user_id = $1
          AND (CASE WHEN $2::bigint IS NOT NULL THEN opp.user_id = $2::bigint
                    ELSE opp.user_id IS NULL AND lower(opp.name) = lower($3) END)
        GROUP BY me.outcome`,
      [userId, opponent.userId ?? null, opponent.name.replace(/ \(2\)$/, '')],
    );
    const count = (o: Outcome) => Number(rows.find((r) => r.outcome === o)?.n ?? 0);
    return { wins: count('win'), losses: count('loss'), draws: count('draw') };
  }
}

/** /api/history, /api/games/:id, /api/profile/:username */
export function attachHistoryRoutes(app: Express, accounts: Accounts | null, history: History | null) {
  const handle = (fn: (req: Request, res: Response, user: PublicUser | null) => Promise<void>) => async (req: Request, res: Response) => {
    if (!accounts || !history) {
      res.status(503).json({ error: 'Accounts are not available right now.' });
      return;
    }
    try {
      await fn(req, res, await accounts.userFromCookie(req.headers.cookie));
    } catch (e) {
      console.error('[history]', e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };

  app.get('/api/history', handle(async (req, res, user) => {
    if (!user) {
      res.status(401).json({ error: 'Sign in to see your games.' });
      return;
    }
    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : undefined;
    res.json({ games: await history!.list(user.id, 20, before) });
  }));

  app.get('/api/games/:id', handle(async (req, res, user) => {
    const game = await history!.get(String(req.params.id), user?.id ?? null);
    if (!game) {
      res.status(404).json({ error: user ? "We couldn't find that game." : 'Sign in to see this game.' });
      return;
    }
    res.json(game);
  }));

  // Shared results link (/r/<id>): anyone with the link can view it, signed in or not.
  app.get('/api/results/:id', handle(async (req, res, user) => {
    const game = await history!.get(String(req.params.id).slice(0, 64), user?.id ?? null, true);
    if (!game) {
      res.status(404).json({ error: "We couldn't find that game." });
      return;
    }
    res.json(game);
  }));

  // Head-to-head record against the current opponent (by username when they have one, else by name).
  app.get('/api/record', handle(async (req, res, user) => {
    if (!user) {
      res.status(401).json({ error: 'Sign in to see your record.' });
      return;
    }
    const name = String(req.query.name ?? '').slice(0, 40);
    const username = typeof req.query.username === 'string' ? req.query.username : '';
    const opp = username ? await accounts!.findUserByUsername(username) : null;
    res.json(await history!.record(user.id, opp ? { userId: opp.id, name: opp.username } : { name }));
  }));

  app.get('/api/profile/:username', handle(async (req, res) => {
    const profile = await history!.profile(String(req.params.username));
    if (!profile) {
      res.status(404).json({ error: 'No player with that username.' });
      return;
    }
    res.json(profile);
  }));
}
