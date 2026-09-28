/** Friends (requests by username) and direct in-app game invites. */
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameInvite } from '../shared/friends.js';
import type { ClientToServerEvents, GameView, ServerToClientEvents } from '../shared/protocol.js';
import { MockClueAI } from '../server/ai/mock.js';
import { createGameServer } from '../server/app.js';
import { embedded, migrate, type Db } from '../server/db/index.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { view: GameView | null; changes: number; declined: string[] };

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

async function call(path: string, cookie = '', body?: unknown) {
  const res = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.2.0.1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { status: res.status, body: await res.json() as Record<string, any>, cookie: setCookie.split(';')[0] ?? '' };
}

async function signUp(username: string) {
  const r = await call('/api/auth/signup', '', { email: `${username}@example.com`, username, password: 'longenough' });
  expect(r.status).toBe(200);
  return { cookie: r.cookie, id: r.body.user.id as string };
}

async function client(cookie = ''): Promise<Client> {
  const c = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { Cookie: cookie } : {} }) as Client;
  c.view = null;
  c.changes = 0;
  c.declined = [];
  c.on('state', (v) => { c.view = v; });
  c.on('social:changed', () => { c.changes++; });
  c.on('invite:declined', ({ username }) => { c.declined.push(username); });
  clients.push(c);
  await new Promise<void>((r) => c.on('connect', () => r()));
  return c;
}

async function until<T>(fn: () => T | undefined | null | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const emit = <R,>(c: Client, event: string, ...args: unknown[]) =>
  new Promise<R>((resolve) => (c.emit as (...a: unknown[]) => void)(event, ...args, resolve));
const invitesOf = (c: Client) => emit<GameInvite[]>(c, 'invite:list');

async function befriend(a: { cookie: string; id: string }, b: { cookie: string; id: string }, bName: string) {
  expect((await call('/api/friends/request', a.cookie, { username: bName })).status).toBe(200);
  expect((await call(`/api/friends/${a.id}/accept`, b.cookie, {})).status).toBe(200);
}

describe('friends', () => {
  it('sends, accepts, declines and removes friend requests', async () => {
    const ann = await signUp('ann');
    const bob = await signUp('bob');
    const cat = await signUp('cat');
    const bobLive = await client(bob.cookie);

    expect((await call('/api/friends')).status).toBe(401);
    expect((await call('/api/friends/request', ann.cookie, { username: 'nobody' })).status).toBe(404);
    expect((await call('/api/friends/request', ann.cookie, { username: 'ANN' })).status).toBe(400);

    const sent = await call('/api/friends/request', ann.cookie, { username: 'BOB' });
    expect(sent.status).toBe(200);
    expect(sent.body.message).toBe('Request sent to bob.');
    expect(sent.body.list.outgoing).toEqual([{ id: bob.id, username: 'bob' }]);
    expect((await call('/api/friends/request', ann.cookie, { username: 'bob' })).status).toBe(409);
    // Bob's open tab is told to refresh, and sees the request.
    await until(() => bobLive.changes > 0);
    expect((await call('/api/friends', bob.cookie)).body.incoming).toEqual([{ id: ann.id, username: 'ann' }]);

    const accepted = await call(`/api/friends/${ann.id}/accept`, bob.cookie, {});
    expect(accepted.body.list).toEqual({ friends: [{ id: ann.id, username: 'ann' }], incoming: [], outgoing: [] });
    expect((await call('/api/friends', ann.cookie)).body.friends).toEqual([{ id: bob.id, username: 'bob' }]);
    expect((await call('/api/friends/request', bob.cookie, { username: 'ann' })).status).toBe(409);

    // Asking someone who already asked you accepts their request.
    await call('/api/friends/request', cat.cookie, { username: 'ann' });
    const mutual = await call('/api/friends/request', ann.cookie, { username: 'cat' });
    expect(mutual.body.message).toBe('You and cat are now friends.');

    // Remove, then a new request can be declined.
    await call(`/api/friends/${cat.id}/remove`, ann.cookie, {});
    expect((await call('/api/friends', cat.cookie)).body.friends).toEqual([]);
    await call('/api/friends/request', cat.cookie, { username: 'ann' });
    const declined = await call(`/api/friends/${cat.id}/remove`, ann.cookie, {});
    expect(declined.body.list.incoming).toEqual([]);
    expect((await call('/api/friends', cat.cookie)).body.outgoing).toEqual([]);
  });
});

describe('game invites', () => {
  it('invites a friend who accepts straight into the lobby', async () => {
    const host = await signUp('hosty');
    const pal = await signUp('pally');
    const stranger = await signUp('stranger');
    await befriend(host, pal, 'pally');

    const h = await client(host.cookie);
    const p = await client(pal.cookie);
    const created = await emit<{ ok: true; code: string }>(h, 'room:create', { name: 'x', difficulty: 'hard' });

    const notFriend = await emit<{ ok: boolean; error?: string }>(h, 'invite:send', { friendId: stranger.id });
    expect(notFriend).toEqual({ ok: false, error: 'You can only invite friends.' });

    const before = p.changes;
    expect(await emit(h, 'invite:send', { friendId: pal.id })).toEqual({ ok: true });
    await until(() => p.changes > before);
    const [invite, ...rest] = await invitesOf(p);
    expect(rest).toEqual([]);
    expect(invite).toMatchObject({ code: created.code, from: { id: host.id, username: 'hosty' }, difficulty: 'hard', theme: 'any' });

    // A guest can't use someone else's invite.
    const guest = await client();
    expect((await emit<{ ok: boolean }>(guest, 'invite:respond', { id: invite!.id, accept: true })).ok).toBe(false);

    const res = await emit<{ ok: boolean; code: string; token: string }>(p, 'invite:respond', { id: invite!.id, accept: true });
    expect(res).toMatchObject({ ok: true, code: created.code });
    expect(res.token).toBeTruthy();
    await until(() => h.view?.players.length === 2);
    expect(h.view!.players.map((x) => x.name)).toEqual(['hosty', 'pally']);
    expect(await invitesOf(p)).toEqual([]);
  });

  it('tells the host when a friend declines, and closes invites when the host leaves', async () => {
    const host = await signUp('hostb');
    const pal = await signUp('palb');
    await befriend(host, pal, 'palb');
    const h = await client(host.cookie);
    const p = await client(pal.cookie);

    await emit(h, 'room:create', { name: 'x', difficulty: 'easy' });
    await emit(h, 'invite:send', { friendId: pal.id });
    const [first] = await invitesOf(p);
    expect((await emit<{ ok: boolean }>(p, 'invite:respond', { id: first!.id, accept: false })).ok).toBe(true);
    await until(() => h.declined.includes('palb'));
    expect(await invitesOf(p)).toEqual([]);

    // Invite again, then the host leaves: the invite goes away and can't be accepted.
    await emit(h, 'invite:send', { friendId: pal.id });
    const [second] = await invitesOf(p);
    expect(second).toBeTruthy();
    const before = p.changes;
    h.emit('room:leave');
    await until(() => p.changes > before);
    expect(await invitesOf(p)).toEqual([]);
    const late = await emit<{ ok: boolean; error: string }>(p, 'invite:respond', { id: second!.id, accept: true });
    expect(late.ok).toBe(false);
  });

  it('closes the invite when someone joins by link, and only hosts can invite', async () => {
    const host = await signUp('hostc');
    const pal = await signUp('palc');
    await befriend(host, pal, 'palc');
    const h = await client(host.cookie);
    const p = await client(pal.cookie);
    const created = await emit<{ ok: true; code: string }>(h, 'room:create', { name: 'x', difficulty: 'easy' });
    await emit(h, 'invite:send', { friendId: pal.id });
    expect((await invitesOf(p)).length).toBe(1);

    // Link invites still work, and fill the seat.
    const guest = await client();
    expect((await emit<{ ok: boolean }>(guest, 'room:join', { code: created.code, name: 'Linky' })).ok).toBe(true);
    await until(() => h.view?.players.length === 2);
    expect(await invitesOf(p)).toEqual([]);

    // The guest isn't the host and isn't signed in.
    expect((await emit<{ ok: boolean }>(guest, 'invite:send', { friendId: pal.id })).ok).toBe(false);
    // Not in a room at all.
    expect((await emit<{ ok: boolean }>(p, 'invite:send', { friendId: host.id })).ok).toBe(false);
  });
});

describe('without a database', () => {
  it('turns friends off', async () => {
    const s = createGameServer({ ai: new MockClueAI(), db: null });
    await new Promise<void>((r) => s.http.listen(0, r));
    try {
      expect((await fetch(`http://localhost:${(s.http.address() as AddressInfo).port}/api/friends`)).status).toBe(503);
    } finally {
      s.io.close();
      s.http.close();
    }
  });
});
