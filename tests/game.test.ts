/**
 * Plays real games over Socket.IO against an in-process server using the
 * pretend AI: lobby → clue writing → review → solving → hints → results.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, type Theme } from '../shared/config.js';
import type { ClientToServerEvents, GameView, ServerToClientEvents } from '../shared/protocol.js';
import { MockClueAI } from '../server/ai/mock.js';
import { createGameServer } from '../server/app.js';
import { clueLibrarySaved } from '../server/words/clueLibrary.js';
import { wordsFor } from '../server/words/wordBank.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { view: GameView | null };

// Keep saved best clues out of the project folder.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cd-test-'));

// Speed things up for tests.
const cfg = CONFIG as unknown as { minBuildingScreenMs: number; reconnectWindowSeconds: number };
cfg.minBuildingScreenMs = 0;

let url = '';
const server = createGameServer({ ai: new MockClueAI() });
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
async function startGame(opts: { pool?: boolean; theme?: Theme } = {}) {
  const a = client();
  const b = client();
  const created = await emit<{ ok: true; code: string; token: string }>(a, 'room:create', { name: 'Alice', difficulty: 'easy' });
  expect(created.ok).toBe(true);
  const joined = await emit<{ ok: boolean }>(b, 'room:join', { code: created.code, name: 'alice' });
  expect(joined.ok).toBe(true);
  await until(() => b.view?.players.length === 2);
  expect(b.view!.players.map((p) => p.name)).toEqual(['Alice', 'alice (2)']);
  if (opts.pool) {
    b.emit('lobby:timer-mode', 'pool'); // only the host may change it
    a.emit('lobby:timer-mode', 'pool');
    await until(() => b.view?.timerMode === 'pool');
  }
  if (opts.theme) {
    a.emit('lobby:theme', opts.theme);
    await until(() => b.view?.theme === opts.theme);
  }
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
  // The writer can look up a definition of their current word.
  const def = await emit<{ ok: boolean; word: string; senses: { pos: string; text: string }[] }>(c, 'write:define', { index: 0 });
  expect(def.ok).toBe(true);
  expect(def.word).toBe(answers[0]);
  expect(def.senses.length).toBeGreaterThan(0);
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
    // Each board shows what its solver entered (both solved everything correctly here).
    for (const g of result.grids) {
      expect(g.entries).toEqual(g.cells.map((row) => row.map((cell) => cell ?? '')));
    }
    expect(result.grids[0]!.clues.some((c) => c.prefilled)).toBe(true);
    expect(result.id).toBeTruthy();

    // Best-clue votes: B solved A's grid (grids[0]); blank and flagged clues can't be picked.
    const aGrid = result.grids[0]!;
    const blankIdx = aGrid.clues.findIndex((c) => c.prefilled);
    const flaggedIdx = aGrid.clues.findIndex((c) => c.original !== undefined);
    const goodIdx = aGrid.clues.findIndex((c) => !c.prefilled && c.original === undefined);
    b.emit('game:vote', blankIdx);
    b.emit('game:vote', flaggedIdx);
    b.emit('game:vote', goodIdx);
    await until(() => a.view?.votes?.[rb!.id]);
    expect(a.view!.votes![rb!.id]!.clueIndex).toBe(goodIdx);
    expect(a.view!.votes![ra!.id]).toBeUndefined();
    // The voted clue is saved for practice puzzles.
    await clueLibrarySaved();
    const saved = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'best-clues.json'), 'utf8')) as Record<string, string[]>;
    expect(saved[aGrid.clues[goodIdx]!.answer]).toEqual([aGrid.clues[goodIdx]!.text]);

    // Rematch sends both back to the lobby, not ready.
    a.emit('game:rematch');
    await until(() => b.view?.phase === 'lobby');
    expect(b.view!.players.every((p) => !p.ready)).toBe(true);
  }, 30_000);

  it('lets players jump between words and revise clues with a shared clock', async () => {
    const { a, b } = await startGame({ pool: true });
    for (const c of [a, b]) c.emit('write:intro-done');
    await until(() => a.view?.writing?.introDone && b.view?.writing?.introDone);
    const w = a.view!.writing!;
    expect(w.timerMode).toBe('pool');
    expect(w.deadline! - a.view!.serverNow).toBeGreaterThan((CONFIG.wordsPerGrid * CONFIG.secondsPerClue - 5) * 1000);
    const n = w.words.length;
    const next = (c: Client, index: number, text: string) =>
      emit<{ ok: true; result: { status: string } }>(c, 'write:next', { index, text, mode: 'check' });

    // A writes word 0, jumps to the last word, writes it, then comes back to revise word 0.
    expect((await next(a, 0, 'Qzx qqa')).result.status).toBe('advanced');
    await until(() => a.view?.writing?.index === 1);
    a.emit('write:goto', n - 1);
    await until(() => a.view?.writing?.index === n - 1);
    expect((await next(a, n - 1, 'Qzx qqb')).result.status).toBe('advanced');
    await until(() => a.view?.writing?.index === 1); // next unwritten word, wrapping round
    a.emit('write:goto', 0);
    await until(() => a.view?.writing?.index === 0);
    expect(a.view!.writing!.draft).toBe('Qzx qqa');
    expect((await next(a, 0, 'Qzx qqc')).result.status).toBe('advanced');
    await until(() => a.view?.writing?.index === 1);
    for (let i = 1; i < n - 1; i++) {
      await until(() => a.view?.writing?.index === i);
      await next(a, i, `Qzx qqw ${i}`);
    }
    await until(() => a.view?.writing?.done);

    // B writes everything in order.
    for (let i = 0; i < n; i++) {
      await until(() => b.view?.writing?.index === i);
      await next(b, i, `Qzx b ${i}`);
    }
    await until(() => b.view?.phase === 'solving');
    const clues = b.view!.solving!.puzzle.clues.map((c) => c.text);
    expect(clues).toContain('Qzx qqc');
    expect(clues).not.toContain('Qzx qqa');
  }, 20_000);

  it('uses the theme the host picks', async () => {
    const { a, b } = await startGame({ theme: 'animals' });
    const animals = new Set(wordsFor('medium', 'animals'));
    for (const c of [a, b]) for (const w of c.view!.writing!.words) expect(animals.has(w.answer)).toBe(true);
  });

  it('ends immediately when a player resigns', async () => {
    const { a, b } = await startGame();
    b.emit('solve:resign');
    await until(() => a.view?.phase === 'finished');
    // Nobody solved anything, so both boards come back empty.
    expect(a.view!.result!.grids.every((g) => g.entries.flat().every((l) => l === ''))).toBe(true);
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
});

describe('server info', () => {
  it('reports a boot id so browsers can tell when the server restarted', async () => {
    const res = await fetch(`${url}/api/config`);
    const body = await res.json() as { bootId: string };
    expect(body.bootId).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('practice', () => {
  it('uses dictionary definitions as clues, never giving the answer away', async () => {
    const res = await fetch(`${url}/api/practice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty: 'medium' }),
    });
    const view = await res.json() as { clues: { text: string }[] };
    const scrambled = view.clues.filter((c) => c.text.startsWith('Unscramble:')).length;
    expect(scrambled).toBeLessThan(view.clues.length / 2);
  });
});

describe('daily puzzle', () => {
  const daily = (date: string) => fetch(`${url}/api/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  type Daily = { number: number; puzzle: { id: string; open: boolean[][]; clues: { text: string }[] } };

  it('gives everyone the same puzzle for a date, and a new one the next day', async () => {
    const [one, two, next] = (await Promise.all(['2026-09-28', '2026-09-28', '2026-09-29'].map(async (d) => (await daily(d)).json()))) as [Daily, Daily, Daily];
    expect(one.number).toBe(1);
    expect(one.puzzle.id).not.toBe(two.puzzle.id); // separate timers
    expect(one.puzzle.open).toEqual(two.puzzle.open);
    expect(one.puzzle.clues.map((c) => c.text)).toEqual(two.puzzle.clues.map((c) => c.text));
    expect(next.puzzle.clues.map((c) => c.text)).not.toEqual(one.puzzle.clues.map((c) => c.text));
  });

  it('refuses dates before the first puzzle or far in the future', async () => {
    expect((await daily('2026-01-01')).status).toBe(400);
    expect((await daily('2999-01-01')).status).toBe(400);
    expect((await daily('nonsense')).status).toBe(400);
  });
});
