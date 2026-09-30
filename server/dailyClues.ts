/**
 * Clues for the daily puzzle, written to the project's crossword playbook
 * (plans/daily-crossword-playbook.md in the project files):
 *
 *   1. The AI writes several candidate clues per answer, each a different technique.
 *   2. Code rejects candidates that break hard rules: too long, giving away the
 *      answer, using another grid answer as a word, repeating a recent daily's
 *      clue or a well-known published one, or misdirection on an answer that
 *      crosses a less familiar word.
 *   3. Two independent AI critics (an editor and a test solver) score every
 *      candidate on accuracy, fairness, freshness, surface and delight (0–3
 *      each). A clue is kept only if both score it 9+ of 15 with no zero and
 *      neither doubts its facts.
 *   4. The best clue per answer is picked, then swapped where needed so no one
 *      clue pattern ("?" puns, "e.g." clues, fill-in-the-blanks…) is more than
 *      a tenth of the puzzle.
 *
 * Answers left without a passing clue get one more round, with the rejected
 * clues to avoid. The day's clues are saved in the database (and kept in
 * memory) so every player sees the same ones, even after a restart. Without
 * the AI, dictionary clues fill in, and those are not saved, so the AI gets
 * another try later.
 */
import { createHash } from 'node:crypto';
import { cleanClue, clueContainsAnswer } from '../shared/rules.js';
import type { ClueAI, ClueScore, CrosswordClueRequest } from './ai/types.js';
import type { Db } from './db/index.js';
import { loadFillWords } from './grid/sunday.js';
import type { Grid } from './grid/types.js';
import { fixedClue } from './practice.js';

/** Answers per AI request. Smaller batches finish faster and run side by side. */
const BATCH = 20;
/** AI requests running at once (keeps clear of rate limits). */
const PARALLEL = 6;
/** Give up on the AI after this long and use what passed so far. */
const WRITE_TIMEOUT_MS = 25 * 60_000;
/** A day's clues are only saved if the AI wrote at least this share of them. */
const SAVE_THRESHOLD = 0.9;
/** Retry an unsaved day (AI failed) after this long. */
const RETRY_AFTER_MS = 10 * 60_000;
/** The playbook's clue length limit. */
const MAX_CLUE = 100;
/** Don't repeat a clue the daily used for the same answer within this many days. */
const HISTORY_DAYS = 90;
/** Answers scoring below this in the word list count as less familiar; their crossings get straight clues. */
const FAMILIAR_SCORE = 45;
/** Each critic's total (of 15) a clue needs. */
const PASS_TOTAL = 9;
/** No clue pattern may be more than this share of the puzzle. */
const TEMPLATE_SHARE = 0.1;

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

/** Little words a clue may share with a grid answer (the playbook's "function words"). */
const FUNCTION_WORDS = new Set(`A AN THE AND OR NOR BUT YET SO FOR OF IN ON AT TO BY UP AS IS IT BE AM ARE WAS WERE BEEN HAS HAD HAVE DO DOES DID
NOT NO ALL ANY ONE ONES SOME WHO WHOM WHAT WHEN WHERE WHY HOW THAT THIS THESE THOSE ITS HIS HER HERS THEY THEM THEIR YOU YOUR
WE US OUR ME MY HE SHE FROM INTO ONTO WITH THAN THEN THERE OFF OUT OVER CAN MAY MIGHT WILL WOULD SHOULD COULD MUST SAY EG
PERHAPS MAYBE ABOUT AFTER BEFORE`.split(/\s+/));

/** Well-known published clues (the playbook's own examples among them), never to be used as ours. */
const STOCK_CLUES = [
  'tap', 'continental divide', 'unlike eagles', 'place for a sucker', 'character flaw?', 'power outage?', 'grateful?',
  'what might keep a watch on you', 'subway riders handhold', 'part of a bike helmet', 'nabisco cookie', 'twist lick dunk cookie',
  'snack since 1912', 'it has 12 flowers on each side', 'sandwich often given a twist', 'dine', 'aloe ___', 'take sides?',
  'put away the dishes?', 'have a little lamb?', 'clear your cookies?', 'arm of the sea?', 'inner calm', 'address of the very first palindrome?',
  'it might turn into a different story', 'before making ones debut?', 'do the rite thing?', 'take up again say', 'enjoy bread',
  'feline pet', 'uh-oh!', 'what a dreamboat!', 'started ahead of time', 'in abundance',
].map(normalize);

function normalize(clue: string): string {
  return clue.toLowerCase().replace(/[‘’'".,:;!()[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/** The clue's pattern, for keeping the puzzle varied (null = no particular pattern). */
export function clueTemplate(clue: string): string | null {
  if (/\?$/.test(clue)) return 'question';
  if (/_{2,}/.test(clue)) return 'blank';
  if (/^\[.*\]$/.test(clue)) return 'bracket';
  if (/(,|\b)\s*(e\.g\.|for example|for one|for instance|say|maybe|perhaps)$/i.test(clue)) return 'example';
  if (/^(one|someone|something|it|they|thing|person) (who|that|with|might|may|of)\b/i.test(clue)) return 'one who';
  if (/^[\w'-]+$/.test(clue)) return 'one word';
  if (/::/.test(clue)) return 'analogy';
  return null;
}

/** Why a candidate breaks a hard rule, or null if it doesn't. */
export function candidateProblem(raw: string, answer: string, rules: { gridAnswers: Set<string>; recent: string[]; straight: boolean }): string | null {
  const clue = acceptClue(raw, answer);
  if (!clue) return 'too long, empty, or gives the answer away';
  for (const token of clue.toUpperCase().split(/[^A-Z]+/)) {
    if (token.length >= 3 && !FUNCTION_WORDS.has(token) && token !== answer && rules.gridAnswers.has(token)) return `uses the grid answer ${token}`;
  }
  const n = normalize(clue);
  if (STOCK_CLUES.includes(n)) return 'a well-known published clue';
  if (rules.recent.some((r) => normalize(r) === n)) return 'used for this answer in a recent daily';
  if (rules.straight && clue.endsWith('?')) return 'misdirection next to a less familiar answer';
  return null;
}

/** For each answer, whether it crosses a less familiar answer (so it needs a straight clue). */
export function straightAnswers(grid: Grid): boolean[] {
  const score = new Map(loadFillWords().map((w) => [w.word, w.score]));
  const at = new Map<string, number[]>();
  grid.words.forEach((w, i) => {
    for (let k = 0; k < w.answer.length; k++) {
      const key = w.direction === 'across' ? `${w.row},${w.col + k}` : `${w.row + k},${w.col}`;
      at.set(key, [...(at.get(key) ?? []), i]);
    }
  });
  const unfamiliar = grid.words.map((w) => (score.get(w.answer) ?? 0) < FAMILIAR_SCORE);
  const straight = grid.words.map(() => false);
  for (const ids of at.values()) {
    if (ids.length === 2 && (unfamiliar[ids[0]!] || unfamiliar[ids[1]!])) {
      straight[ids[0]!] ||= unfamiliar[ids[1]!]!;
      straight[ids[1]!] ||= unfamiliar[ids[0]!]!;
    }
  }
  return straight;
}

/** A candidate that passed the hard rules, with both critics' scores. */
export interface Scored { clue: string; scores: ClueScore[] }

const total = (s: ClueScore) => s.accuracy + s.fairness + s.freshness + s.surface + s.delight;
const noZero = (s: ClueScore) => Math.min(s.accuracy, s.fairness, s.freshness, s.surface, s.delight) > 0;

/** Both critics scored it, both gave 9+ of 15 with no zero, and neither doubts its facts. */
export function passes(c: Scored): boolean {
  return c.scores.length === 2 && c.scores.every((s) => total(s) >= PASS_TOTAL && noZero(s) && s.facts !== 'unsure');
}

/** Usable if nothing better: no zero on accuracy or fairness, and no doubtful facts. */
function usable(c: Scored): boolean {
  return c.scores.length > 0 && c.scores.every((s) => s.accuracy > 0 && s.fairness > 0 && s.facts !== 'unsure');
}

const rank = (c: Scored) => c.scores.reduce((sum, s) => sum + total(s), 0) / Math.max(1, c.scores.length);

/**
 * Picks one clue per answer (null where none passed): the best-scoring
 * passing clue, then swaps the cheapest ones so no clue pattern exceeds its
 * share of the puzzle.
 */
export function pickClues(pools: Scored[][], opts: { lenient?: boolean } = {}): (string | null)[] {
  const ok = pools.map((pool) => pool.filter(opts.lenient ? usable : passes).sort((a, b) => rank(b) - rank(a)));
  const choice: number[] = ok.map((pool) => (pool.length ? 0 : -1));
  const cap = Math.max(1, Math.ceil(pools.length * TEMPLATE_SHARE));
  const used = new Set<string>();
  // No two answers share a clue.
  choice.forEach((c, i) => {
    let k = c;
    while (k >= 0 && k < ok[i]!.length && used.has(normalize(ok[i]![k]!.clue))) k++;
    choice[i] = k >= 0 && k < ok[i]!.length ? k : -1;
    if (choice[i]! >= 0) used.add(normalize(ok[i]![choice[i]!]!.clue));
  });
  const templateOf = (i: number) => (choice[i]! >= 0 ? clueTemplate(ok[i]![choice[i]!]!.clue) : null);
  for (let guard = 0; guard < pools.length * 4; guard++) {
    const counts = new Map<string, number>();
    choice.forEach((_, i) => { const t = templateOf(i); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); });
    const over = [...counts].find(([, n]) => n > cap)?.[0];
    if (!over) break;
    // The cheapest swap out of the over-used pattern into one with room.
    let best: { i: number; k: number; loss: number } | null = null;
    choice.forEach((c, i) => {
      if (templateOf(i) !== over) return;
      ok[i]!.forEach((cand, k) => {
        const t = clueTemplate(cand.clue);
        if (k === c || t === over || (t && (counts.get(t) ?? 0) >= cap) || used.has(normalize(cand.clue))) return;
        const loss = rank(ok[i]![c]!) - rank(cand);
        if (!best || loss < best.loss) best = { i, k, loss };
      });
    });
    if (!best) break;
    const { i, k } = best as { i: number; k: number };
    used.delete(normalize(ok[i]![choice[i]!]!.clue));
    used.add(normalize(ok[i]![k]!.clue));
    choice[i] = k;
  }
  return choice.map((c, i) => (c >= 0 ? ok[i]![c]!.clue : null));
}

/** Runs the tasks, at most PARALLEL at a time. */
async function limited(tasks: (() => Promise<void>)[]): Promise<void> {
  const queue = [...tasks];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) await task();
  }));
}

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

/** Writes candidates for `requests`, applies the hard rules, and has both critics score what's left. */
async function draftRound(grid: Grid, ai: ClueAI, requests: CrosswordClueRequest[], rules: { gridAnswers: Set<string>; recent: string[][]; straight: boolean[] },
  pools: Scored[][], rejected: string[][], signal: AbortSignal) {
  const gridAnswers = [...rules.gridAnswers];
  const fresh = new Map<number, string[]>();
  await limited(batches(requests).map((batch) => async () => {
    try {
      for (const { id, candidates } of await ai.writeCrosswordClues(batch, { gridAnswers }, signal)) {
        const i = Number(id);
        const answer = grid.words[i]?.answer;
        if (!answer || !batch.some((b) => b.id === id)) continue;
        const kept: string[] = [];
        for (const { clue } of candidates) {
          const problem = candidateProblem(clue, answer, { gridAnswers: rules.gridAnswers, recent: rules.recent[i]!, straight: rules.straight[i]! });
          const clean = acceptClue(clue, answer);
          if (problem || !clean) { if (clean) rejected[i]!.push(clean); continue; }
          if (!kept.includes(clean) && !pools[i]!.some((p) => p.clue === clean)) kept.push(clean);
        }
        fresh.set(i, kept);
      }
    } catch (e) {
      console.warn('[daily] a batch of candidate clues failed:', (e as Error).message);
    }
  }));
  const items = [...fresh].filter(([, clues]) => clues.length).map(([i, clues]) => ({ id: String(i), answer: grid.words[i]!.answer, clues }));
  const scores = new Map<number, (ClueScore | undefined)[][]>(items.map((it) => [Number(it.id), it.clues.map(() => [undefined, undefined])]));
  await limited(([0, 1] as const).flatMap((critic) => batches(items).map((batch) => async () => {
    try {
      for (const { id, scores: list } of await ai.reviewCrosswordClues(batch, critic, signal)) {
        const slots = scores.get(Number(id));
        if (!slots || !batch.some((b) => b.id === id)) continue;
        for (const s of list) if (slots[s.index]) slots[s.index]![critic] = s;
      }
    } catch (e) {
      console.warn(`[daily] critic ${critic + 1} failed on a batch:`, (e as Error).message);
    }
  })));
  for (const it of items) {
    const i = Number(it.id);
    it.clues.forEach((clue, k) => {
      const scored = { clue, scores: scores.get(i)![k]!.filter((x): x is ClueScore => !!x) };
      pools[i]!.push(scored);
      if (!passes(scored)) rejected[i]!.push(clue);
    });
  }
}

async function writeWithAI(grid: Grid, ai: ClueAI, seed: number, recent: string[][]): Promise<{ clues: string[]; written: number; report: string }> {
  const signal = AbortSignal.timeout(WRITE_TIMEOUT_MS);
  const rules = { gridAnswers: new Set(grid.words.map((w) => w.answer)), recent, straight: straightAnswers(grid) };
  const pools: Scored[][] = grid.words.map(() => []);
  const rejected: string[][] = grid.words.map(() => []);
  const request = (i: number, withRejected: boolean): CrosswordClueRequest => ({
    id: String(i), answer: grid.words[i]!.answer, straight: rules.straight[i] || undefined,
    avoid: [...recent[i]!, ...(withRejected ? rejected[i]!.slice(-8) : [])],
  });
  await draftRound(grid, ai, grid.words.map((_, i) => request(i, false)), rules, pools, rejected, signal);
  // One more round for answers with no passing clue, told which clues fell short.
  const short = grid.words.map((_, i) => i).filter((i) => !pools[i]!.some(passes));
  if (short.length && short.length < grid.words.length && !signal.aborted) {
    await draftRound(grid, ai, short.map((i) => request(i, true)), rules, pools, rejected, signal);
  }
  const strict = pickClues(pools);
  const lenient = pickClues(pools, { lenient: true });
  const clues = strict.map((c, i) => c ?? lenient[i] ?? null);
  const written = clues.filter(Boolean).length;
  const picked = clues.flatMap((c, i) => (c ? [pools[i]!.find((p) => p.clue === c)!] : []));
  const aha = picked.filter((p) => p.scores.length === 2 && p.scores.every((s) => s.delight === 3 && s.accuracy === 3)).length;
  const templates = new Map<string, number>();
  for (const c of clues) { const t = c && clueTemplate(c); if (t) templates.set(t, (templates.get(t) ?? 0) + 1); }
  const avg = picked.length ? (picked.reduce((s, p) => s + rank(p), 0) / picked.length).toFixed(1) : '0';
  const report = `${strict.filter(Boolean).length} passed both critics, ${written - strict.filter(Boolean).length} best-available, ${grid.words.length - written} dictionary; `
    + `average ${avg}/15, ${aha} aha clues; patterns ${[...templates].map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`;
  return { clues: clues.map((c, i) => c ?? fixedClue(grid.words[i]!.answer, seed + i)), written, report };
}

async function load(db: Db, date: string, signature: string): Promise<string[] | null> {
  const { rows } = await db.query<{ signature: string; clues: string[] }>('SELECT signature, clues FROM daily_clues WHERE date = $1', [date]);
  const row = rows[0];
  return row && row.signature === signature && Array.isArray(row.clues) ? row.clues : null;
}

/** For each answer in `grid`, the clues recent dailies gave that same answer. */
async function recentClues(db: Db | null | undefined, date: string, grid: Grid, gridFor?: (date: string) => Grid): Promise<string[][]> {
  const out = grid.words.map(() => [] as string[]);
  if (!db || !gridFor) return out;
  const since = new Date(Date.parse(`${date}T00:00:00Z`) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    const { rows } = await db.query<{ date: string; signature: string; clues: string[] }>(
      'SELECT date, signature, clues FROM daily_clues WHERE date < $1 AND date >= $2', [date, since]);
    const byAnswer = new Map<string, string[]>();
    for (const row of rows) {
      const past = gridFor(row.date);
      if (gridSignature(past) !== row.signature || !Array.isArray(row.clues)) continue;
      past.words.forEach((w, i) => { if (row.clues[i]) byAnswer.set(w.answer, [...(byAnswer.get(w.answer) ?? []), row.clues[i]!]); });
    }
    grid.words.forEach((w, i) => { out[i] = byAnswer.get(w.answer) ?? []; });
  } catch (e) {
    console.warn('[daily] could not read recent clues:', (e as Error).message);
  }
  return out;
}

/** The clues for a date's grid, in the same order as `grid.words`. */
export function dailyClues(date: string, grid: Grid, deps: { ai: ClueAI; db?: Db | null; gridFor?: (date: string) => Grid }): Promise<string[]> {
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
      const out = await writeWithAI(grid, deps.ai, seed, await recentClues(deps.db, date, grid, deps.gridFor));
      clues = out.clues;
      keep = out.written >= grid.words.length * SAVE_THRESHOLD;
      console.log(`[daily] ${date}: ${out.report}; ${Math.round((Date.now() - started) / 1000)} s${keep ? '' : ' (not saved; will retry)'}`);
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
