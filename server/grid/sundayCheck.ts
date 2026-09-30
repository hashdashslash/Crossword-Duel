/**
 * Independent checker for daily (Sunday-size) grids. It re-derives everything
 * from the letters and reports every rule that is broken.
 */
import { isBlocked } from '../words/blocked.js';
import { loadFillWords, runsOf, SUNDAY, type Pattern } from './sunday.js';
import type { Grid } from './types.js';

let known: Set<string> | null = null;

export function validateSundayGrid(grid: Grid, opts = SUNDAY): string[] {
  const errors: string[] = [];
  const n = opts.size;
  if (grid.rows !== n || grid.cols !== n || grid.cells.length !== n || grid.cells.some((r) => r.length !== n)) {
    return [`grid must be ${n}×${n}`];
  }
  const p: Pattern = grid.cells.map((r) => r.map((c) => c === null));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (p[r]![c] !== p[n - 1 - r]![n - 1 - c]) errors.push(`black squares are not symmetric at ${r},${c}`);
      const ch = grid.cells[r]![c];
      if (ch !== null && !/^[A-Z]$/.test(ch!)) errors.push(`bad letter at ${r},${c}`);
    }
  }
  const runs = runsOf(p);
  if (runs.some((run) => run.len < 3)) errors.push('an answer is shorter than 3 letters');
  if (runs.length < opts.minWords || runs.length > opts.maxWords) errors.push(`${runs.length} answers (need ${opts.minWords}–${opts.maxWords})`);
  if (grid.words.length !== runs.length) errors.push('word list does not match the grid');

  // Every white square is in an across and a down answer (checked), and the whites are connected.
  const covered = new Map<string, number>();
  for (const run of runs) {
    for (let i = 0; i < run.len; i++) {
      const k = run.dir === 'across' ? `${run.row},${run.col + i}` : `${run.row + i},${run.col}`;
      covered.set(k, (covered.get(k) ?? 0) + 1);
    }
  }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!p[r]![c] && covered.get(`${r},${c}`) !== 2) errors.push(`square ${r},${c} is unchecked`);
  const whites = [...covered.keys()];
  const seen = new Set([whites[0]]);
  const stack = [whites[0]!];
  while (stack.length) {
    const [r, c] = stack.pop()!.split(',').map(Number) as [number, number];
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = `${r + dr},${c + dc}`;
      if (covered.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  if (seen.size !== whites.length) errors.push('the white squares are not all connected');

  known ??= new Set(loadFillWords().map((w) => w.word));
  const answers = grid.words.map((w) => w.answer);
  if (new Set(answers).size !== answers.length) errors.push('an answer appears twice');
  for (const a of answers) {
    if (!known.has(a)) errors.push(`${a} is not in the word list`);
    if (isBlocked(a)) errors.push(`${a} is a blocked word`);
  }
  return errors;
}
