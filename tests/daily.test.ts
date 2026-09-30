/**
 * The Sunday-size daily puzzle: the pre-built grids, the AI-written clues
 * (saved once per day) and the /api/daily route.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockClueAI } from '../server/ai/mock.js';
import type { CrosswordClueRequest } from '../server/ai/types.js';
import { createGameServer } from '../server/app.js';
import { createDaily, dailyGrid, loadDailyGrids } from '../server/daily.js';
import { acceptClue, dailyClues } from '../server/dailyClues.js';
import { embedded, migrate } from '../server/db/index.js';
import { gridFromRows } from '../server/grid/sunday.js';
import { validateSundayGrid } from '../server/grid/sundayCheck.js';

/** A pretend AI that writes numbered clues and counts how often it is asked. */
class FakeWriter extends MockClueAI {
  override readonly mode = 'anthropic' as unknown as 'mock';
  calls = 0;
  override async writeCrosswordClues(items: CrosswordClueRequest[]) {
    this.calls++;
    return items.map((i) => ({ id: i.id, clue: i.answer === 'SEA' ? 'Sea breeze source' : `Witty clue number ${i.id}` }));
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
    expect(acceptClue('x'.repeat(130), 'SEA')).toBeNull();
    expect(acceptClue('   ', 'SEA')).toBeNull();
  });

  it('asks the AI once per day, saves the clues, and reuses them after a restart', { timeout: 30_000 }, async () => {
    const db = await embedded(null);
    await migrate(db);
    const grid = dailyGrid('2026-10-01');
    const ai = new FakeWriter();
    const [a, b] = await Promise.all([dailyClues('2026-10-01', grid, { ai, db }), dailyClues('2026-10-01', grid, { ai, db })]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(grid.words.length);
    expect(a[3]).toBe('Witty clue number 3');
    const batches = ai.calls;
    expect(batches).toBeGreaterThan(1); // split into batches

    // A "restarted" server (fresh AI, empty memory for a new date key) reads the saved row instead.
    const { rows } = await db.query<{ clues: string[] }>('SELECT clues FROM daily_clues WHERE date = $1', ['2026-10-01']);
    expect(rows[0]!.clues).toEqual(a);
    await db.close();
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
