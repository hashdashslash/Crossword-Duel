/** Game history: saving finished games for signed-in players, the history list, reviews, profiles and records. */
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClientToServerEvents, GameView, ServerToClientEvents } from '../shared/protocol.js';
import { MockClueAI } from '../server/ai/mock.js';
import { createGameServer } from '../server/app.js';
import { embedded, migrate, type Db } from '../server/db/index.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { view: GameView | null };

let db: Db;
let server: ReturnType<typeof createGameServer>;
let url = '';
const clients: Client[] = [];

beforeAll(async () => {
  db = await embedded(null);
  await migrate(db);
  server = createGameServer({ ai: new MockClueAI(), db });
  await new Promise<void>((r) => server.http.listen(0, r));
  url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  clients.forEach((c) => c.close());
  server.io.close();
  server.http.close();
  await db.close();
});

async function call(path: string, cookie = '', body?: unknown, ip = '10.1.0.1') {
  const res = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, body: await res.json() as Record<string, any>, cookie: setCookie.split(';')[0] ?? '' };
}

async function signUp(username: string) {
  const r = await call('/api/auth/signup', '', { email: `${username}@example.com`, username, password: 'longenough' });
  expect(r.status).toBe(200);
  return r.cookie;
}

function client(cookie = ''): Client {
  const c = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { Cookie: cookie } : {} }) as Client;
  c.view = null;
  c.on('state', (v) => { c.view = v; });
  clients.push(c);
  return c;
}

async function until<T>(fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const emit = <R,>(c: Client, event: string, ...args: unknown[]) =>
  new Promise<R>((resolve) => (c.emit as (...a: unknown[]) => void)(event, ...args, resolve));

/** Plays a game that ends when the second player resigns. Returns the game id. */
async function playResignedGame(hostCookie: string, guestCookie: string, guestName = 'Guesty') {
  const a = client(hostCookie);
  const b = client(guestCookie);
  const created = await emit<{ ok: true; code: string }>(a, 'room:create', { name: 'Host', difficulty: 'easy' });
  expect(created.ok).toBe(true);
  expect((await emit<{ ok: boolean }>(b, 'room:join', { code: created.code, name: guestName })).ok).toBe(true);
  await until(() => a.view?.players.length === 2);
  a.emit('lobby:ready', true);
  b.emit('lobby:ready', true);
  await until(() => a.view?.phase === 'writing');
  b.emit('solve:resign');
  await until(() => a.view?.phase === 'finished');
  const id = a.view!.result!.id;
  a.close();
  b.close();
  return id;
}

describe('game history', () => {
  it('saves games with a signed-in player and shows them only to players in them', async () => {
    const ann = await signUp('ann');
    const bob = await signUp('bob');
    const eve = await signUp('eve');

    const id = await playResignedGame(ann, '');
    // Saving happens just after the game ends.
    const list = await until(async () => {
      const r = await call('/api/history', ann);
      return r.body.games?.length === 1 && r.body.games;
    });
    expect(list[0]).toMatchObject({ id, outcome: 'win', reason: 'resign', difficulty: 'easy', opponent: { name: 'Guesty', username: null } });

    const review = await call(`/api/games/${id}`, ann);
    expect(review.status).toBe(200);
    expect(review.body.result.id).toBe(id);
    expect(review.body.usernames).toEqual(['ann', null]);
    expect(review.body.result.players.find((p: { id: string }) => p.id === review.body.you).name).toBe('ann');

    // Another account and a signed-out visitor can't open it.
    expect((await call(`/api/games/${id}`, eve)).status).toBe(404);
    expect((await call(`/api/games/${id}`)).status).toBe(404);
    expect((await call('/api/history')).status).toBe(401);

    // A shared results link works for anyone, and knows when the viewer played in it.
    const shared = await call(`/api/results/${id}`);
    expect(shared.status).toBe(200);
    expect(shared.body.you).toBeNull();
    expect(shared.body.result.id).toBe(id);
    expect((await call(`/api/results/${id}`, eve)).body.you).toBeNull();
    expect((await call(`/api/results/${id}`, ann)).body.you).toBe(review.body.you);
    expect((await call('/api/results/not-a-real-game')).status).toBe(404);

    // Two accounts: both get it, and the loser sees a loss.
    const id2 = await playResignedGame(ann, bob);
    const bobs = await until(async () => {
      const r = await call('/api/history', bob);
      return r.body.games?.length === 1 && r.body.games;
    });
    expect(bobs[0]).toMatchObject({ id: id2, outcome: 'loss', opponent: { name: 'ann', username: 'ann' } });
    await until(async () => (await call('/api/history', ann)).body.games.length === 2);
    expect((await call('/api/history', ann)).body.games[0].id).toBe(id2); // newest first
  });

  it('does not save guest-only games', async () => {
    const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM games')).rows[0]!.n;
    await playResignedGame('', '', 'Nobody');
    await new Promise((r) => setTimeout(r, 200));
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM games')).rows[0]!.n).toBe(before);
  });

  it('builds profiles and head-to-head records', async () => {
    const cy = await signUp('cyd');
    const dee = await signUp('dee');
    await playResignedGame(cy, dee);
    await playResignedGame(cy, '', 'Pat');
    await playResignedGame(dee, cy); // cy resigns this one

    await until(async () => (await call('/api/profile/CYD')).body.recent?.length === 3);
    const profile = (await call('/api/profile/CYD')).body;
    expect(profile).toMatchObject({ username: 'cyd', wins: 2, losses: 1, draws: 0 });
    expect((await call('/api/profile/nobody_here')).status).toBe(404);

    expect((await call('/api/record?username=dee', cy)).body).toEqual({ wins: 1, losses: 1, draws: 0 });
    expect((await call('/api/record?name=pat', cy)).body).toEqual({ wins: 1, losses: 0, draws: 0 });
    // A guest who happens to share a name with an account doesn't count toward that account.
    expect((await call('/api/record?name=dee', cy)).body).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect((await call('/api/record?name=pat')).status).toBe(401);
  });
});

describe('without a database', () => {
  it('turns history off and games still finish', async () => {
    const s = createGameServer({ ai: new MockClueAI(), db: null });
    await new Promise<void>((r) => s.http.listen(0, r));
    const base = `http://localhost:${(s.http.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/api/history`)).status).toBe(503);
      expect((await fetch(`${base}/api/profile/ann`)).status).toBe(503);
    } finally {
      s.io.close();
      s.http.close();
    }
  });
});
