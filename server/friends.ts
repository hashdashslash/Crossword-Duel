/**
 * Friends: requests by username, accept, decline and remove.
 * Changes are pushed to the other player's open tabs so their lists update live.
 */
import type { Express, Request, Response } from 'express';
import type { PublicUser } from '../shared/account.js';
import type { FriendsList } from '../shared/friends.js';
import type { Accounts } from './accounts/accounts.js';
import type { Db } from './db/index.js';

type Result = { ok: true; message?: string } | { ok: false; status: number; error: string };

export class Friends {
  constructor(private db: Db, private accounts: Accounts) {}

  async list(userId: string): Promise<FriendsList> {
    const { rows } = await this.db.query<{ id: string; username: string; status: string; mine: boolean }>(
      `SELECT u.id::text AS id, u.username, f.status, (f.requester_id = $1) AS mine
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
        WHERE f.requester_id = $1 OR f.addressee_id = $1
        ORDER BY lower(u.username)`,
      [userId],
    );
    const pick = (r: { id: string; username: string }): PublicUser => ({ id: r.id, username: r.username });
    return {
      friends: rows.filter((r) => r.status === 'accepted').map(pick),
      incoming: rows.filter((r) => r.status === 'pending' && !r.mine).map(pick),
      outgoing: rows.filter((r) => r.status === 'pending' && r.mine).map(pick),
    };
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM friendships WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [a, b],
    );
    return rows.length > 0;
  }

  /** Sends a request; if they already asked you, this accepts theirs. Returns the other user on success. */
  async request(me: PublicUser, username: string): Promise<Result & { other?: PublicUser }> {
    const other = await this.accounts.findUserByUsername(username.trim());
    if (!other) return { ok: false, status: 404, error: 'No player with that username.' };
    if (other.id === me.id) return { ok: false, status: 400, error: "That's you!" };
    const { rows } = await this.db.query<{ requester_id: string; status: string }>(
      `SELECT requester_id::text AS requester_id, status FROM friendships
        WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [me.id, other.id],
    );
    const existing = rows[0];
    if (existing?.status === 'accepted') return { ok: false, status: 409, error: `You're already friends with ${other.username}.` };
    if (existing && existing.requester_id === me.id) return { ok: false, status: 409, error: `You already sent ${other.username} a request.` };
    if (existing) {
      await this.db.query(`UPDATE friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2`, [other.id, me.id]);
      return { ok: true, other, message: `You and ${other.username} are now friends.` };
    }
    await this.db.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me.id, other.id]);
    return { ok: true, other, message: `Request sent to ${other.username}.` };
  }

  /** Accepts a pending request from `fromId`. */
  async accept(meId: string, fromId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `UPDATE friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending' RETURNING 1`,
      [fromId, meId],
    );
    return rows.length > 0;
  }

  /** Declines a request, cancels one you sent, or removes a friend: all delete the pair's row. */
  async remove(meId: string, otherId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `DELETE FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1) RETURNING 1`,
      [meId, otherId],
    );
    return rows.length > 0;
  }
}

/** /api/friends… `notify(userId)` tells that user's open tabs to refresh their lists. */
export function attachFriendRoutes(app: Express, accounts: Accounts | null, friends: Friends | null, notify: (userId: string) => void) {
  const handle = (fn: (req: Request, res: Response, user: PublicUser) => Promise<void>) => async (req: Request, res: Response) => {
    if (!accounts || !friends) {
      res.status(503).json({ error: 'Accounts are not available right now.' });
      return;
    }
    try {
      const user = await accounts.userFromCookie(req.headers.cookie);
      if (!user) {
        res.status(401).json({ error: 'Sign in to add friends.' });
        return;
      }
      await fn(req, res, user);
    } catch (e) {
      console.error('[friends]', e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const id = (req: Request) => String(req.params.id ?? '').replace(/\D/g, '').slice(0, 18);

  app.get('/api/friends', handle(async (_req, res, user) => {
    res.json(await friends!.list(user.id));
  }));

  app.post('/api/friends/request', handle(async (req, res, user) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.slice(0, 40) : '';
    if (!username.trim()) {
      res.status(400).json({ error: 'Enter a username.' });
      return;
    }
    const r = await friends!.request(user, username);
    if (!r.ok) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    notify(r.other!.id);
    res.json({ message: r.message, list: await friends!.list(user.id) });
  }));

  app.post('/api/friends/:id/accept', handle(async (req, res, user) => {
    const other = id(req);
    if (other && (await friends!.accept(user.id, other))) notify(other);
    res.json({ list: await friends!.list(user.id) });
  }));

  // Decline a request, cancel your own, or remove a friend.
  app.post('/api/friends/:id/remove', handle(async (req, res, user) => {
    const other = id(req);
    if (other && (await friends!.remove(user.id, other))) notify(other);
    res.json({ list: await friends!.list(user.id) });
  }));
}
