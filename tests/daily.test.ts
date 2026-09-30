/**
 * The Sunday-size daily puzzle: the pre-built grids, the AI-written clues
 * (saved once per day) and the /api/daily route.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockClueAI } from '../server/ai/mock.js';
import type { ClueScore, CrosswordClueRequest, CrosswordClueReviewItem } from '../server/ai/types.js';
import { createGameServer } from '../server/app.js';
import { createDaily, dailyGrid, loadDailyGrids } from '../server/daily.js';
import { acceptClue, candidateProblem, clueTemplate, dailyClues, pickClues, type Scored } from '../server/dailyClues.js';
import { embedded, migrate } from '../server/db/index.js';
import { gridFromRows } from '../server/grid/sunday.js';
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
    expect(a[3]).toBe('Witty clue number 3');
    expect(ai.calls).toBeGreaterThan(1); // split into batches
    expect(ai.critiques).toBe(ai.calls * 2); // two critics per batch

    const { rows } = await db.query<{ clues: string[] }>('SELECT clues FROM daily_clues WHERE date = $1', ['2026-10-01']);
    expect(rows[0]!.clues).toEqual(a);

    // The next day (same grid, for the test) must not repeat those clues.
    const next = new FakeWriter();
    const c = await dailyClues('2026-10-02', grid, { ai: next, db, gridFor: () => grid });
    expect(next.avoided.some((list) => list.includes('Witty clue number 3'))).toBe(true);
    expect(c[3]).toBe('Second clue 3');
    await db.close();
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
