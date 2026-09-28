/** Accounts: sign-up, sign-in, rate limits, sessions, and recognising signed-in players in games. */
import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../server/accounts/passwords.js';
import { MockClueAI } from '../server/ai/mock.js';
import { createGameServer } from '../server/app.js';
import { embedded, migrate, type Db } from '../server/db/index.js';

let db: Db;
let server: ReturnType<typeof createGameServer>;
let url = '';

beforeAll(async () => {
  db = await embedded(null);
  await migrate(db);
  server = createGameServer({ ai: new MockClueAI(), db });
  await new Promise<void>((r) => server.http.listen(0, r));
  url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.io.close();
  server.http.close();
  await db.close();
});

async function call(path: string, body?: unknown, cookie = '', ip = '10.0.0.1') {
  const res = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, body: await res.json() as Record<string, any>, cookie: setCookie.split(';')[0] ?? '' };
}

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct');
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
  });
});

describe('accounts', () => {
  it('signs up, stays signed in with the cookie, and signs out', async () => {
    expect((await call('/api/auth/me')).body).toEqual({ enabled: true, user: null });

    expect((await call('/api/auth/signup', { email: 'nope', username: 'ann', password: 'longenough' })).status).toBe(400);
    expect((await call('/api/auth/signup', { email: 'ann@example.com', username: 'a b', password: 'longenough' })).status).toBe(400);
    expect((await call('/api/auth/signup', { email: 'ann@example.com', username: 'ann', password: 'short' })).status).toBe(400);

    const made = await call('/api/auth/signup', { email: 'Ann@Example.com', username: 'Ann_1', password: 'longenough' });
    expect(made.status).toBe(200);
    expect(made.body.user.username).toBe('Ann_1');
    expect(made.cookie).toMatch(/^cd_session=.+/);

    const me = await call('/api/auth/me', undefined, made.cookie);
    expect(me.body.user.username).toBe('Ann_1');

    // Email and username are unique, ignoring case.
    expect((await call('/api/auth/signup', { email: 'ann@example.com', username: 'other', password: 'longenough' })).status).toBe(409);
    expect((await call('/api/auth/signup', { email: 'x@example.com', username: 'ann_1', password: 'longenough' })).status).toBe(409);

    const out = await call('/api/auth/logout', {}, made.cookie);
    expect(out.status).toBe(200);
    expect((await call('/api/auth/me', undefined, made.cookie)).body.user).toBeNull();

    const back = await call('/api/auth/login', { email: 'ANN@example.com', password: 'longenough' });
    expect(back.status).toBe(200);
    expect(back.body.user.username).toBe('Ann_1');
  });

  it('rate-limits failed sign-ins', async () => {
    await call('/api/auth/signup', { email: 'bob@example.com', username: 'bob', password: 'bobpassword' }, '', '10.0.0.2');
    for (let i = 0; i < 5; i++) {
      expect((await call('/api/auth/login', { email: 'bob@example.com', password: 'wrongwrong' }, '', '10.0.0.3')).status).toBe(401);
    }
    // Even the right password is refused for a while.
    const blocked = await call('/api/auth/login', { email: 'bob@example.com', password: 'bobpassword' }, '', '10.0.0.4');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many attempts/);
  });

  it('uses the account username in games and keeps guests working', async () => {
    const made = await call('/api/auth/signup', { email: 'cat@example.com', username: 'Cat', password: 'catpassword' }, '', '10.0.0.5');
    const signedIn = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: made.cookie } });
    const guest = connect(url, { transports: ['websocket'], forceNew: true });
    try {
      const created = await new Promise<{ ok: boolean; code: string }>((r) => signedIn.emit('room:create', { name: 'Typed Name', difficulty: 'easy' }, r as never));
      expect(created.ok).toBe(true);
      const room = server.rooms.get(created.code)!;
      expect(room.players[0]!.name).toBe('Cat');
      expect(room.players[0]!.userId).toBe(made.body.user.id);

      const joined = await new Promise<{ ok: boolean }>((r) => guest.emit('room:join', { code: created.code, name: 'Guesty' }, r as never));
      expect(joined.ok).toBe(true);
      expect(room.players[1]!.name).toBe('Guesty');
      expect(room.players[1]!.userId).toBeUndefined();
    } finally {
      signedIn.close();
      guest.close();
    }
  });
});

describe('without a database', () => {
  it('reports accounts as off and refuses sign-ups', async () => {
    const s = createGameServer({ ai: new MockClueAI(), db: null });
    await new Promise<void>((r) => s.http.listen(0, r));
    const base = `http://localhost:${(s.http.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(`${base}/api/auth/me`)).json()).toEqual({ enabled: false, user: null });
      const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(503);
    } finally {
      s.io.close();
      s.http.close();
    }
  });
});
