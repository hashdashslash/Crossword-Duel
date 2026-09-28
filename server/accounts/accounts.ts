/**
 * Optional accounts: sign-up (email, username, password), sign-in, sign-out.
 * Sessions are a random token in an httpOnly cookie; only its hash is stored.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { checkEmail, checkPassword, checkUsername, type PublicUser } from '../../shared/account.js';
import type { Db } from '../db/index.js';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './passwords.js';
import { RateLimiter } from './rateLimit.js';

export const SESSION_COOKIE = 'cd_session';
const SESSION_DAYS = 30;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Parses a Cookie header into name → value. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* ignore malformed */ }
  }
  return out;
}

export class Accounts {
  // Failed sign-ins: 5 per email and 20 per IP address, per 15 minutes. Sign-ups: 10 per IP per hour.
  private loginByEmail = new RateLimiter(5, 15 * 60_000);
  private loginByIp = new RateLimiter(20, 15 * 60_000);
  private signupByIp = new RateLimiter(10, 60 * 60_000);

  constructor(readonly db: Db) {}

  async userForToken(token: string | undefined): Promise<PublicUser | null> {
    if (!token) return null;
    const { rows } = await this.db.query<{ id: string; username: string }>(
      `SELECT u.id::text AS id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    return rows[0] ?? null;
  }

  /** The signed-in user for an HTTP request or socket handshake, or null. Never throws. */
  async userFromCookie(cookieHeader: string | undefined): Promise<PublicUser | null> {
    try {
      return await this.userForToken(parseCookies(cookieHeader)[SESSION_COOKIE]);
    } catch (e) {
      console.warn('[accounts] session lookup failed:', (e as Error).message);
      return null;
    }
  }

  async findUserByUsername(username: string): Promise<PublicUser | null> {
    const { rows } = await this.db.query<PublicUser>('SELECT id::text AS id, username FROM users WHERE lower(username) = lower($1)', [username.trim()]);
    return rows[0] ?? null;
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [sha256(token), userId],
    );
    // Tidy up expired sessions now and then.
    if (Math.random() < 0.05) await this.db.query('DELETE FROM sessions WHERE expires_at < now()');
    return token;
  }

  async signUp(emailRaw: unknown, usernameRaw: unknown, password: unknown, ip: string): Promise<{ user: PublicUser; token: string } | { error: string; status: number }> {
    const problem = checkEmail(emailRaw) ?? checkUsername(usernameRaw) ?? checkPassword(password);
    if (problem) return { error: problem, status: 400 };
    if (this.signupByIp.blocked(ip)) return { error: 'Too many sign-ups from here. Please try again later.', status: 429 };
    const email = String(emailRaw).trim();
    const username = String(usernameRaw).trim();
    const { rows: taken } = await this.db.query<{ email: string; username: string }>(
      'SELECT email, username FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($2)',
      [email, username],
    );
    if (taken.some((t) => t.username.toLowerCase() === username.toLowerCase())) return { error: 'That username is taken.', status: 409 };
    if (taken.length) return { error: 'An account with that email already exists. Try signing in.', status: 409 };
    const hash = await hashPassword(String(password));
    this.signupByIp.hit(ip);
    try {
      const { rows } = await this.db.query<PublicUser>(
        'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id::text AS id, username',
        [email, username, hash],
      );
      const user = rows[0]!;
      return { user, token: await this.createSession(user.id) };
    } catch (e) {
      if (/unique|duplicate/i.test((e as Error).message)) return { error: 'That email or username is already in use.', status: 409 };
      throw e;
    }
  }

  async signIn(emailRaw: unknown, password: unknown, ip: string): Promise<{ user: PublicUser; token: string } | { error: string; status: number }> {
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
    const pass = typeof password === 'string' ? password : '';
    const wait = Math.max(this.loginByEmail.retryAfter(email), this.loginByIp.retryAfter(ip));
    if (wait) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`, status: 429 };
    const { rows } = await this.db.query<{ id: string; username: string; password_hash: string }>(
      'SELECT id::text AS id, username, password_hash FROM users WHERE lower(email) = $1',
      [email],
    );
    const row = rows[0];
    // Check a dummy hash when the email is unknown, so timing doesn't reveal which emails exist.
    const ok = await verifyPassword(pass, row?.password_hash ?? (await DUMMY_HASH_PROMISE));
    if (!row || !ok) {
      this.loginByEmail.hit(email);
      this.loginByIp.hit(ip);
      return { error: 'Wrong email or password.', status: 401 };
    }
    this.loginByEmail.reset(email);
    return { user: { id: row.id, username: row.username }, token: await this.createSession(row.id) };
  }

  async signOut(token: string | undefined) {
    if (token) await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }
}

function setSessionCookie(req: Request, res: Response, token: string | null) {
  const secure = req.secure || process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  const parts = [
    `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? SESSION_DAYS * 86_400 : 0}`,
    ...(secure ? ['Secure'] : []),
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

/** Adds /api/auth/* routes. With no database, `me` reports accounts as off and the rest refuse. */
export function attachAuthRoutes(app: Express, accounts: Accounts | null) {
  const guard = (fn: (a: Accounts, req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    if (!accounts) {
      res.status(503).json({ error: 'Accounts are not available right now. You can still play as a guest.' });
      return;
    }
    try {
      await fn(accounts, req, res);
    } catch (e) {
      console.error('[accounts]', e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };

  app.get('/api/auth/me', async (req, res) => {
    const user = accounts ? await accounts.userFromCookie(req.headers.cookie) : null;
    res.json({ enabled: !!accounts, user });
  });

  app.post('/api/auth/signup', guard(async (a, req, res) => {
    const r = await a.signUp(req.body?.email, req.body?.username, req.body?.password, req.ip ?? '');
    if ('error' in r) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    setSessionCookie(req, res, r.token);
    res.json({ user: r.user });
  }));

  app.post('/api/auth/login', guard(async (a, req, res) => {
    const r = await a.signIn(req.body?.email, req.body?.password, req.ip ?? '');
    if ('error' in r) {
      res.status(r.status).json({ error: r.error });
      return;
    }
    setSessionCookie(req, res, r.token);
    res.json({ user: r.user });
  }));

  app.post('/api/auth/logout', guard(async (a, req, res) => {
    await a.signOut(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    setSessionCookie(req, res, null);
    res.json({ ok: true });
  }));
}
