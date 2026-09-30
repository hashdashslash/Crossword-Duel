/**
 * The Sunday-size daily puzzle: the pre-built grids, the AI-written clues
 * (saved once per day) and the /api/daily route.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockClueAI } from '../server/ai/mock.js';
import type { ClueScore, CrosswordClueRequest, CrosswordClueReviewItem } from '../server/ai/types.js';
import { createGameServer } from '../server/app.js';
import { createDaily, dailyGrid, loadDailyGrids, pacificClock } from '../server/daily.js';
import { acceptClue, candidateProblem, clueTemplate, dailyClues, pickClues, type Scored } from '../server/dailyClues.js';
import { embedded, migrate } from '../server/db/index.js';
import { createRng } from '../server/grid/rng.js';
import { gridFromRows, loadFillWords, repairGrid } from '../server/grid/sunday.js';
import { validateSundayGrid } from '../server/grid/sundayCheck.js';

const good: ClueScore = { accuracy: 3, fairness: 3, freshness: 2, surface: 3, delight: 2, facts: 'none' };
const weak: ClueScore = { accuracy: 1, fairness: 2, freshness: 1, surface: 2, delight: 1, facts: 'none' };

/**
 * A pretend AI: writes a few candidates per answer (one breaking a hard rule),
 * and its critics like everything except clues starting with "Meh".
 */
class FakeWriter extends MockClueAI {
  override readonly mode = 'anthropic' as unknown as 'mock';
  calls = 0;
  critiques = 0;
  avoided: string[][] = [];
  override async writeCrosswordClues(items: CrosswordClueRequest[]) {
    this.calls++;
    this.avoided.push(...items.map((i) => i.avoid ?? []));
    return items.map((i) => ({
      id: i.id,
      candidates: [
        { technique: 'I', clue: i.answer === 'SEA' ? 'Sea breeze source' : `Meh clue ${i.id}` },
        { technique: 'B', clue: `Witty clue number ${i.id}` },
        { technique: 'I', clue: `Second clue ${i.id}` },
        { technique: 'I', clue: 'Dine' },
      ],
    }));
  }
  override async reviewCrosswordClues(items: CrosswordClueReviewItem[]) {
    this.critiques++;
    return items.map((i) => ({
      id: i.id,
      scores: i.clues.map((c, index) => ({ index, ...(c.startsWith('Meh') ? weak : c.startsWith('Second') ? { ...good, delight: 1 } : good) })),
    }));
  }
}

describe('daily grid library', () => {
  it('has at least a year of valid 21×21 grids with 120–140 answers', () => {
    const all = loadDailyGrids();
    expect(all.length).toBeGreaterThanOrEqual(365);
    expect(new Set(all.map((g) => g.join('/'))).size).toBe(all.length);
    for (const rows of all) {
      const grid = gridFromRows(rows);
      expect(validateSundayGrid(grid)).toEqual([]);
    }
  });

  it('swaps a newly banned word out of a grid', { timeout: 60_000 }, () => {
    const grid = dailyGrid('2026-10-03');
    const banned = grid.words.find((w) => w.answer.length === 5)!.answer;
    const words = loadFillWords().filter((w) => w.word !== banned);
    const allowed = new Set(words.map((w) => w.word));
    let repaired = null;
    for (let seed = 1; !repaired && seed <= 4; seed++) repaired = repairGrid(grid, createRng(seed), words);
    expect(repaired).not.toBeNull();
    expect(repaired!.words.every((w) => allowed.has(w.answer))).toBe(true);
    expect(repaired!.cells.map((r) => r.map((c) => c === null))).toEqual(grid.cells.map((r) => r.map((c) => c === null)));
  });

  it('numbers answers across then down, like a newspaper', () => {
    const grid = dailyGrid('2026-09-28');
    expect(grid.rows).toBe(21);
    const across = grid.words.filter((w) => w.direction === 'across');
    expect(grid.words.slice(0, across.length)).toEqual(across);
    expect(across.map((w) => w.number)).toEqual([...across.map((w) => w.number)].sort((a, b) => a - b));
    expect(grid.words[0]!.number).toBe(1);
  });
});

describe('daily clues', () => {
  it('rejects clues that give the answer away or run long', () => {
    expect(acceptClue('Where waves come from', 'SEA')).toBe('Where waves come from');
    expect(acceptClue('"Salty expanse"', 'SEA')).toBe('Salty expanse');
    expect(acceptClue('Sea breeze source', 'SEA')).toBeNull();
    expect(acceptClue('x'.repeat(101), 'SEA')).toBeNull();
    expect(acceptClue('   ', 'SEA')).toBeNull();
  });

  it('picks each answer the best clue both critics pass, and saves the day', { timeout: 30_000 }, async () => {
    const db = await embedded(null);
    await migrate(db);
    const grid = dailyGrid('2026-10-01');
    const ai = new FakeWriter();
    const [a, b] = await Promise.all([dailyClues('2026-10-01', grid, { ai, db }), dailyClues('2026-10-01', grid, { ai, db })]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(grid.words.length);
    expect(a![3]).toBe('Witty clue number 3');
    expect(ai.calls).toBeGreaterThan(1); // split into batches
    expect(ai.critiques).toBe(ai.calls * 2); // two critics per batch

    const { rows } = await db.query<{ clues: string[] }>('SELECT clues FROM daily_clues WHERE date = $1', ['2026-10-01']);
    expect(rows[0]!.clues).toEqual(a);

    // The next day (same grid, for the test) must not repeat those clues.
    const next = new FakeWriter();
    const c = await dailyClues('2026-10-02', grid, { ai: next, db, gridFor: () => grid });
    expect(next.avoided.some((list) => list.includes('Witty clue number 3'))).toBe(true);
    expect(c![3]).toBe('Second clue 3');
    await db.close();
  });

  it('never serves stand-in clues when the AI fails: the day waits and is retried', { timeout: 30_000 }, async () => {
    class BrokenWriter extends FakeWriter {
      override async writeCrosswordClues(): Promise<never> {
        this.calls++;
        throw new Error('AI unavailable');
      }
    }
    const db = await embedded(null);
    await migrate(db);
    const ai = new BrokenWriter();
    const res = await createDaily('2026-09-29', { ai, db }, { waitMs: 20_000 });
    expect(res).toEqual({ pending: true });
    const { rows } = await db.query('SELECT 1 FROM daily_clues WHERE date = $1', ['2026-09-29']);
    expect(rows).toHaveLength(0);
    // Asking again right away doesn't hammer the AI; the day is retried a few minutes later.
    const calls = ai.calls;
    expect(await createDaily('2026-09-29', { ai, db }, { waitMs: 20_000 })).toEqual({ pending: true });
    expect(ai.calls).toBe(calls);
    await db.close();
  });

  it('keeps what a failed attempt wrote: the retry only asks for the missing answers, less and less often', { timeout: 30_000 }, async () => {
    class FlakyWriter extends FakeWriter {
      fail = true;
      asked: string[] = [];
      override async writeCrosswordClues(items: CrosswordClueRequest[]) {
        this.asked.push(...items.map((i) => i.id));
        if (this.fail && items.some((i) => i.id === '0')) throw new Error('AI busy');
        return super.writeCrosswordClues(items);
      }
    }
    const date = '2026-10-07';
    const grid = dailyGrid(date);
    const ai = new FlakyWriter();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expect(await dailyClues(date, grid, { ai })).toBeNull();
      const firstBatch = new Set(Array.from({ length: 20 }, (_, i) => String(i))); // the batch that failed
      expect(new Set(ai.asked).size).toBe(grid.words.length);

      // The second failure doubles the wait to 10 minutes.
      vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
      ai.asked = [];
      expect(await dailyClues(date, grid, { ai })).toBeNull();
      expect(new Set(ai.asked)).toEqual(firstBatch);
      vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
      ai.asked = [];
      expect(await dailyClues(date, grid, { ai })).toBeNull();
      expect(ai.asked).toEqual([]);

      vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
      ai.fail = false;
      ai.asked = [];
      const clues = await dailyClues(date, grid, { ai });
      expect(clues).toHaveLength(grid.words.length);
      expect(new Set(ai.asked)).toEqual(firstBatch); // only the answers that were missing
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks up after a restart instead of paying for the same clues twice', { timeout: 30_000 }, async () => {
    const db = await embedded(null);
    await migrate(db);
    const date = '2026-10-08';
    const grid = dailyGrid(date);
    // The first server writes the candidates, then goes down while the critics are working.
    class CutOff extends FakeWriter {
      override reviewCrosswordClues(): Promise<never> {
        return new Promise(() => {});
      }
    }
    const first = new CutOff();
    void dailyClues(date, grid, { ai: first, db });
    for (let i = 0; i < 100; i++) {
      const { rows } = await db.query<{ draft: { pending: unknown[] } }>('SELECT draft FROM daily_drafts WHERE date = $1', [date]);
      if (rows[0]?.draft.pending.length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(first.calls).toBeGreaterThan(0);

    // A fresh server (nothing in memory) finishes the job without writing anything again.
    vi.resetModules();
    const fresh = await import('../server/dailyClues.js');
    const second = new FakeWriter();
    const clues = await fresh.dailyClues(date, grid, { ai: second, db });
    expect(clues).toHaveLength(grid.words.length);
    expect(second.calls).toBe(0);
    expect(second.critiques).toBeGreaterThan(0);
    const { rows } = await db.query('SELECT 1 FROM daily_drafts WHERE date = $1', [date]);
    expect(rows).toHaveLength(0); // cleared once the day is saved
    await db.close();
  });

  it('keeps the server awake on Render while it writes, and lets it sleep after', { timeout: 30_000 }, async () => {
    const realFetch = globalThis.fetch;
    const pings: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      pings.push(String(url));
      return new Response('{}');
    }) as typeof fetch;
    process.env.RENDER_EXTERNAL_URL = 'https://duel.example';
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let finish = () => {};
      const gate = new Promise<void>((r) => { finish = r; });
      class Slow extends FakeWriter {
        override async writeCrosswordClues(items: CrosswordClueRequest[]) {
          await gate;
          return super.writeCrosswordClues(items);
        }
      }
      const date = '2026-10-09';
      const job = dailyClues(date, dailyGrid(date), { ai: new Slow() });
      await new Promise((r) => setTimeout(r, 50));
      vi.advanceTimersByTime(4 * 60_000);
      expect(pings).toEqual(['https://duel.example/api/config']);
      finish();
      expect(await job).not.toBeNull();
      vi.advanceTimersByTime(10 * 60_000);
      expect(pings).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = realFetch;
      delete process.env.RENDER_EXTERNAL_URL;
    }
  });

  it('still uses AI-written clues when the critics are down', { timeout: 30_000 }, async () => {
    class NoCritics extends FakeWriter {
      override async reviewCrosswordClues(): Promise<never> {
        throw new Error('critic unavailable');
      }
    }
    const grid = dailyGrid('2026-10-06');
    const clues = await dailyClues('2026-10-06', grid, { ai: new NoCritics() });
    expect(clues).toHaveLength(grid.words.length);
    expect(clues!.every((c) => !c.startsWith('Unscramble'))).toBe(true);
  });

  it('rejects candidates that break the hard rules', () => {
    const rules = { gridAnswers: new Set(['OCEAN', 'TIDE', 'SEA']), recent: ['Salty expanse'], straight: false };
    expect(candidateProblem('Where waves come from', 'SEA', rules)).toBeNull();
    expect(candidateProblem('It rolls in with the tide', 'SEA', rules)).toMatch(/TIDE/);
    expect(candidateProblem('The tide and the moon', 'OCEAN', rules)).toMatch(/TIDE/);
    expect(candidateProblem('Salty expanse', 'SEA', rules)).toMatch(/recent/);
    expect(candidateProblem('Character flaw?', 'TYPO', rules)).toMatch(/published/);
    expect(candidateProblem('Wet blanket?', 'SEA', { ...rules, straight: true })).toMatch(/misdirection/);
    expect(candidateProblem('x'.repeat(101), 'SEA', rules)).not.toBeNull();
  });

  it('keeps any one clue pattern to a tenth of the puzzle', () => {
    const pools: Scored[][] = Array.from({ length: 30 }, (_, i) => [
      { clue: `Pun number ${i}?`, scores: [good, good] },
      { clue: `Plain clue ${i}`, scores: [{ ...good, delight: 1 }, { ...good, delight: 1 }] },
    ]);
    const picked = pickClues(pools);
    expect(picked.filter((c) => c && clueTemplate(c) === 'question')).toHaveLength(3);
    expect(picked.every(Boolean)).toBe(true);
  });

  it('drops a clue either critic fails or doubts', () => {
    const pools: Scored[][] = [[
      { clue: 'Loved by one critic', scores: [good, weak] },
      { clue: 'Shaky fact', scores: [good, { ...good, facts: 'unsure' }] },
      { clue: 'Solid clue', scores: [{ ...good, delight: 1 }, { ...good, delight: 1 }] },
    ]];
    expect(pickClues(pools)).toEqual(['Solid clue']);
  });

  it('tells the time in California, daylight saving included', () => {
    expect(pacificClock(new Date('2026-10-01T09:30:00Z'))).toEqual({ date: '2026-10-01', hour: 2 }); // PDT
    expect(pacificClock(new Date('2026-12-01T10:15:00Z'))).toEqual({ date: '2026-12-01', hour: 2 }); // PST
    expect(pacificClock(new Date('2026-12-01T07:59:00Z'))).toEqual({ date: '2026-11-30', hour: 23 });
  });

  it('falls back to dictionary clues without the AI', async () => {
    const res = await createDaily('2026-09-30', { ai: new MockClueAI() });
    if (!('puzzle' in res)) throw new Error('expected a puzzle');
    expect(res.puzzle.clues).toHaveLength(dailyGrid('2026-09-30').words.length);
    expect(res.puzzle.clues.every((c) => c.text.length > 0)).toBe(true);
  });
});

describe('/api/daily', () => {
  const server = createGameServer({ ai: new MockClueAI() });
  let url = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.http.listen(0, r));
    url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.io.close();
    server.http.close();
  });
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('serves a Sunday-size puzzle with 120–140 clues', async () => {
    const res = await post('/api/daily', { date: '2026-09-30' });
    const daily = await res.json() as { number: number; puzzle: { rows: number; cols: number; clues: unknown[] } };
    expect(daily.number).toBe(3);
    expect([daily.puzzle.rows, daily.puzzle.cols]).toEqual([21, 21]);
    expect(daily.puzzle.clues.length).toBeGreaterThanOrEqual(120);
    expect(daily.puzzle.clues.length).toBeLessThanOrEqual(140);
  });

  it('continues the timer of a resumed solve', async () => {
    const res = await post('/api/daily', { date: '2026-09-30', resumeMs: 125_000 });
    const { puzzle } = await res.json() as { puzzle: { id: string } };
    const check = await (await post(`/api/practice/${puzzle.id}/check`, { entries: [] })).json() as { elapsedMs: number };
    expect(check.elapsedMs).toBeGreaterThanOrEqual(125_000);
    expect(check.elapsedMs).toBeLessThan(135_000);
  });
});
