/**
 * Clues for the daily puzzle. The AI writes them once per day in the style of
 * a Sunday newspaper crossword; they are saved in the database (and kept in
 * memory) so every player sees the same clues, even after a restart.
 *
 * Without the AI (test mode, or if it fails), dictionary clues fill in, and
 * those are not saved, so the AI gets another try later.
 */
import { createHash } from 'node:crypto';
import { cleanClue, clueContainsAnswer } from '../shared/rules.js';
import type { ClueAI, CrosswordClueRequest } from './ai/types.js';
import type { Db } from './db/index.js';
import type { Grid } from './grid/types.js';
import { fixedClue } from './practice.js';

/** Answers per AI request. Smaller batches finish faster and run side by side. */
const BATCH = 35;
/** Give up on the AI after this long and use dictionary clues for the gaps. */
const WRITE_TIMEOUT_MS = 240_000;
/** A day's clues are only saved if the AI wrote at least this share of them. */
const SAVE_THRESHOLD = 0.9;
/** Retry an unsaved day (AI failed) after this long. */
const RETRY_AFTER_MS = 10 * 60_000;
const MAX_CLUE = 120;

interface Entry { signature: string; clues: string[]; saved: boolean; at: number }
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<string[]>>();

/** Identifies the grid, so saved clues are never used with a different grid. */
export function gridSignature(grid: Grid): string {
  return createHash('sha256').update(grid.words.map((w) => `${w.direction[0]}${w.number}${w.answer}`).join(',')).digest('hex').slice(0, 16);
}

/** A usable clue, or null if it is empty, too long or gives the answer away. */
export function acceptClue(raw: string, answer: string): string | null {
  const clue = cleanClue(raw.replace(/^["“]+(.*)["”]+$/, '$1'));
  if (!clue || clue.length > MAX_CLUE || clueContainsAnswer(clue, answer)) return null;
  return clue;
}

async function writeWithAI(grid: Grid, ai: ClueAI, seed: number): Promise<{ clues: string[]; written: number }> {
  const clues: (string | null)[] = grid.words.map(() => null);
  const ask = async (items: CrosswordClueRequest[], signal: AbortSignal) => {
    try {
      for (const { id, clue } of await ai.writeCrosswordClues(items, signal)) {
        const i = Number(id);
        const answer = grid.words[i]?.answer;
        if (answer && clues[i] === null) clues[i] = acceptClue(clue, answer);
      }
    } catch (e) {
      console.warn('[daily] a batch of clues failed:', (e as Error).message);
    }
  };
  const signal = AbortSignal.timeout(WRITE_TIMEOUT_MS);
  const all = grid.words.map((w, i) => ({ id: String(i), answer: w.answer }));
  const batches: CrosswordClueRequest[][] = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  await Promise.all(batches.map((b) => ask(b, signal)));
  // One more try for anything missing or rejected.
  const missing = all.filter((item) => clues[Number(item.id)] === null);
  if (missing.length && missing.length < all.length && !signal.aborted) await ask(missing, signal);
  const written = clues.filter(Boolean).length;
  return { clues: clues.map((c, i) => c ?? fixedClue(grid.words[i]!.answer, seed + i)), written };
}

async function load(db: Db, date: string, signature: string): Promise<string[] | null> {
  const { rows } = await db.query<{ signature: string; clues: string[] }>('SELECT signature, clues FROM daily_clues WHERE date = $1', [date]);
  const row = rows[0];
  return row && row.signature === signature && Array.isArray(row.clues) ? row.clues : null;
}

/** The clues for a date's grid, in the same order as `grid.words`. */
export function dailyClues(date: string, grid: Grid, deps: { ai: ClueAI; db?: Db | null }): Promise<string[]> {
  const signature = gridSignature(grid);
  const cached = memory.get(date);
  if (cached && cached.signature === signature && (cached.saved || Date.now() - cached.at < RETRY_AFTER_MS)) return Promise.resolve(cached.clues);
  const running = inflight.get(date);
  if (running) return running;

  const seed = Number.parseInt(signature.slice(0, 8), 16);
  const job = (async () => {
    const saved = deps.db ? await load(deps.db, date, signature).catch(() => null) : null;
    if (saved && saved.length === grid.words.length) {
      memory.set(date, { signature, clues: saved, saved: true, at: Date.now() });
      return saved;
    }
    let clues: string[];
    let keep = false;
    if (deps.ai.mode === 'anthropic') {
      const started = Date.now();
      const out = await writeWithAI(grid, deps.ai, seed);
      clues = out.clues;
      keep = out.written >= grid.words.length * SAVE_THRESHOLD;
      console.log(`[daily] ${date}: AI wrote ${out.written}/${grid.words.length} clues in ${Math.round((Date.now() - started) / 1000)} s${keep ? '' : ' (not saved; will retry)'}`);
    } else {
      clues = grid.words.map((w, i) => fixedClue(w.answer, seed + i));
    }
    if (keep && deps.db) {
      await deps.db.query(
        `INSERT INTO daily_clues (date, signature, clues) VALUES ($1, $2, $3)
         ON CONFLICT (date) DO UPDATE SET signature = EXCLUDED.signature, clues = EXCLUDED.clues, created_at = now()`,
        [date, signature, JSON.stringify(clues)],
      ).catch((e) => console.warn('[daily] could not save clues:', (e as Error).message));
    }
    memory.set(date, { signature, clues, saved: keep, at: Date.now() });
    for (const d of [...memory.keys()].sort().slice(0, Math.max(0, memory.size - 5))) memory.delete(d);
    return clues;
  })().finally(() => inflight.delete(date));
  inflight.set(date, job);
  return job;
}
