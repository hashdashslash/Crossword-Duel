/**
 * Plays real games over Socket.IO against an in-process server using the
 * pretend AI: lobby → clue writing → review → solving → hints → results.
 */
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../shared/config.js';
import type { ClientToServerEvents, GameView, ServerToClientEvents } from '../shared/protocol.js';
import { MockClueAI } from '../server/ai/mock.js';
import { createGameServer } from '../server/app.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { view: GameView | null };

// Speed things up for tests.
const cfg = CONFIG as unknown as { minBuildingScreenMs: number; reconnectWindowSeconds: number; bot: { writeSecondsMin: number; writeSecondsMax: number } };
cfg.minBuildingScreenMs = 0;
cfg.bot.writeSecondsMin = 0.01;
cfg.bot.writeSecondsMax = 0.02;

let url = '';
const server = createGameServer({ ai: new MockClueAI(), devTools: true });
const clients: Client[] = [];

beforeAll(async () => {
  await new Promise<void>((r) => server.http.listen(0, r));
  url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
});
afterAll(() => {
  clients.forEach((c) => c.close());
  server.io.close();
  server.http.close();
});

function client(): Client {
  const c = connect(url, { transports: ['websocket'], forceNew: true }) as Client;
  c.view = null;
  c.on('state', (v) => { c.view = v; });
  clients.push(c);
  return c;
}

async function until<T>(fn: () => T | undefined | null | false, ms = 8000): Promise<T> {
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

/** Creates a room with two humans and gets both to the writing phase. */
async function startGame() {
  const a = client();
  const b = client();
  const created = await emit<{ ok: true; code: string; token: string }>(a, 'room:create', { name: 'Alice', difficulty: 'easy', bot: null });
  expect(created.ok).toBe(true);
  const joined = await emit<{ ok: boolean }>(b, 'room:join', { code: created.code, name: 'alice' });
  expect(joined.ok).toBe(true);
  await until(() => b.view?.players.length === 2);
  expect(b.view!.players.map((p) => p.name)).toEqual(['Alice', 'alice (2)']);
  a.emit('lobby:ready', true);
  b.emit('lobby:ready', true);
  await until(() => a.view?.phase === 'writing' && b.view?.phase === 'writing');
  return { a, b, code: created.code };
}

/** Writes all clues; `special` can override the text/mode for particular word indexes. */
async function writeAll(c: Client, special: Record<number, (answer: string) => Promise<void>> = {}) {
  c.emit('write:intro-done');
  await until(() => c.view?.writing?.introDone);
  const answers = c.view!.writing!.words.map((w) => w.answer);
  for (let i = 0; i < answers.length; i++) {
    await until(() => c.view?.writing?.index === i);
    if (special[i]) await special[i]!(answers[i]!);
    else {
      const r = await emit<{ ok: true; result: { status: string } }>(c, 'write:next', { index: i, text: `Qzx placeholder ${i}`, mode: 'check' });
      expect(r.result.status).toBe('advanced');
    }
  }
  return answers;
}

/** The answer for each clue of a puzzle, given the writer's answers in writing order. */
function answersFor(view: GameView, writerAnswers: string[]) {
  const clues = view.solving!.puzzle.clues.map((c, i) => ({ c, i }));
  const order = [
    ...clues.filter((x) => x.c.direction === 'across').sort((p, q) => p.c.number - q.c.number),
    ...clues.filter((x) => x.c.direction === 'down').sort((p, q) => p.c.number - q.c.number),
  ];
  const map = new Map<number, string>();
  order.forEach((x, k) => map.set(x.i, writerAnswers[k]!));
  return map;
}

function solvedEntries(view: GameView, writerAnswers: string[]) {
  const p = view.solving!.puzzle;
  const entries = p.open.map((row) => row.map(() => ''));
  for (const [i, answer] of answersFor(view, writerAnswers)) {
    const c = p.clues[i]!;
    for (let k = 0; k < answer.length; k++) {
      const r = c.direction === 'down' ? c.row + k : c.row;
      const col = c.direction === 'across' ? c.col + k : c.col;
      entries[r]![col] = answer[k]!;
    }
  }
  return entries;
}

describe('full game', () => {
  it('plays from lobby to results, with warnings, blanks, penalties, hints and rematch', async () => {
    const { a, b } = await startGame();

    const [answersA, answersB] = await Promise.all([
      writeAll(a, {
        // Word 0: the live check warns (pretend AI flags "wrong"); keep it anyway.
        0: async () => {
          const r = await emit<{ ok: true; result: { status: string } }>(a, 'write:next', { index: 0, text: 'This is wrong on purpose', mode: 'check' });
          expect(r.result.status).toBe('warning');
          const k = await emit<{ ok: true; result: { status: string } }>(a, 'write:next', { index: 0, text: 'This is wrong on purpose', mode: 'keep' });
          expect(k.result.status).toBe('advanced');
        },
        // Word 1: left blank → pre-filled for the opponent.
        1: async () => {
          const r = await emit<{ ok: true; result: { status: string } }>(a, 'write:next', { index: 1, text: '', mode: 'check' });
          expect(r.result.status).toBe('advanced');
        },
        // Word 2: a clue containing the answer is refused.
        2: async (answer) => {
          const r = await emit<{ ok: true; result: { status: string } }>(a, 'write:next', { index: 2, text: `The ${answer.toLowerCase()}s`, mode: 'check' });
          expect(r.result.status).toBe('invalid');
          await emit(a, 'write:next', { index: 2, text: 'Qzx placeholder two', mode: 'check' });
        },
      }),
      writeAll(b),
    ]);

    await until(() => a.view?.phase === 'solving' && b.view?.phase === 'solving');

    // Answers are never sent to the player solving them.
    const aJson = JSON.stringify(a.view!.solving);
    for (const ans of answersB) expect(aJson).not.toContain(`"${ans}"`);

    // B sees A's blank word pre-filled, and A's flagged clue replaced.
    const bClues = b.view!.solving!.puzzle.clues;
    expect(bClues.filter((c) => c.prefilled).length).toBe(1);
    expect(bClues.some((c) => c.text.includes('wrong'))).toBe(false);
    expect(b.view!.solving!.opponentFilled).toBe(0);
    expect(a.view!.solving!.opponentFilled).toBe(1); // B starts with the pre-filled word done

    // A takes a hint.
    const hint = await emit<{ ok: boolean; text: string }>(a, 'solve:hint', 0);
    expect(hint.ok).toBe(true);
    await until(() => a.view?.solving?.hintsLeft === CONFIG.hintsPerGame - 1);

    // A submits an incomplete grid, then the full solution.
    const wrongTry = await emit<{ ok: true; solved: boolean; blanks: unknown[] }>(a, 'solve:submit', a.view!.solving!.entries);
    expect(wrongTry.solved).toBe(false);
    expect(wrongTry.blanks.length).toBeGreaterThan(0);
    const aDone = await emit<{ ok: true; solved: boolean }>(a, 'solve:submit', solvedEntries(a.view!, answersB));
    expect(aDone.solved).toBe(true);
    await until(() => b.view?.solving?.opponentFinished);
    expect(b.view!.phase).toBe('solving'); // A has +90s of penalties, so B can still win

    const bDone = await emit<{ ok: true; solved: boolean }>(b, 'solve:submit', solvedEntries(b.view!, answersA));
    expect(bDone.solved).toBe(true);
    await until(() => a.view?.phase === 'finished' && b.view?.phase === 'finished');

    const result = a.view!.result!;
    const [ra, rb] = result.players;
    expect(result.reason).toBe('completed');
    expect(result.winnerId).toBe(rb!.id);
    expect(ra!.hintsUsed).toBe(1);
    expect(ra!.flagged.length).toBe(1);
    expect(ra!.flagged[0]!.original).toBe('This is wrong on purpose');
    expect(ra!.finalMs).toBe(ra!.rawMs! + 30_000 + 60_000);
    expect(rb!.finalMs).toBe(rb!.rawMs);
    expect(result.grids.length).toBe(2);
    expect(result.grids[0]!.clues.some((c) => c.prefilled)).toBe(true);

    // Rematch sends both back to the lobby, not ready.
    a.emit('game:rematch');
    await until(() => b.view?.phase === 'lobby');
    expect(b.view!.players.every((p) => !p.ready)).toBe(true);
  }, 30_000);

  it('ends immediately when a player resigns', async () => {
    const { a, b } = await startGame();
    b.emit('solve:resign');
    await until(() => a.view?.phase === 'finished');
    expect(a.view!.result!.reason).toBe('resign');
    expect(a.view!.result!.winnerId).toBe(a.view!.you);
  });

  it('ends the game at once when the first finisher has no penalties', async () => {
    const { a, b } = await startGame();
    const [answersA, answersB] = await Promise.all([writeAll(a), writeAll(b)]);
    void answersA;
    await until(() => a.view?.phase === 'solving');
    await emit(a, 'solve:submit', solvedEntries(a.view!, answersB));
    await until(() => b.view?.phase === 'finished');
    expect(b.view!.result!.reason).toBe('impossible');
    expect(b.view!.result!.winnerId).toBe(a.view!.you);
  }, 20_000);

  it('forfeits a player who does not reconnect in time, and restores one who does', async () => {
    cfg.reconnectWindowSeconds = 1;
    try {
      const { a, b, code } = await startGame();
      const tokenB = await (async () => {
        // Rejoin with a fresh socket using B's token (simulates a page reload).
        const b2 = client();
        const token = (server.rooms.get(code)!.players[1]!).token;
        b.close();
        await until(() => a.view?.players[1]?.connected === false);
        const r = await emit<{ ok: boolean }>(b2, 'room:rejoin', { code, token });
        expect(r.ok).toBe(true);
        await until(() => b2.view?.phase === 'writing');
        await until(() => a.view?.players[1]?.connected === true);
        b2.close();
        return token;
      })();
      expect(tokenB).toBeTruthy();
      await until(() => a.view?.phase === 'finished', 5000);
      expect(a.view!.result!.reason).toBe('forfeit');
      expect(a.view!.result!.winnerId).toBe(a.view!.you);
    } finally {
      cfg.reconnectWindowSeconds = 60;
    }
  }, 15_000);

  it('plays against the test bot', async () => {
    const a = client();
    const created = await emit<{ ok: true; code: string }>(a, 'room:create', { name: 'Solo', difficulty: 'medium', bot: 'fast' });
    expect(created.ok).toBe(true);
    await until(() => a.view?.players.length === 2);
    a.emit('lobby:ready', true);
    await until(() => a.view?.phase === 'writing');
    await writeAll(a);
    await until(() => a.view?.phase === 'solving', 10_000);
    // The bot left one clue blank and wrote one bad clue.
    expect(a.view!.solving!.puzzle.clues.filter((c) => c.prefilled).length).toBe(1);
    a.emit('dev:bot', 'finish');
    // The bot has a +60s penalty for its bad clue, so the game waits for the human.
    await until(() => a.view?.solving?.opponentFinished);
    expect(a.view!.phase).toBe('solving');
    a.emit('solve:resign');
    await until(() => a.view?.phase === 'finished');
    const bot = a.view!.result!.players[1]!;
    expect(bot.rawMs).not.toBeNull();
    expect(bot.flagged.length).toBe(1);
  }, 20_000);
});
