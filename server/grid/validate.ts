/**
 * Independent grid checker. It does not trust the generator: it re-derives
 * everything from the finished grid and reports every rule that is broken.
 */
import { CONFIG } from '../../shared/config.js';
import { assignNumbers } from './numbering.js';
import type { Grid, GridStats } from './types.js';

export type GridLimits = { [K in keyof typeof CONFIG.grid]: number };

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  stats: GridStats;
}

const key = (dir: string, row: number, col: number, len: number) => `${dir}:${row}:${col}:${len}`;

export function validateGrid(
  grid: Grid,
  limits: GridLimits = CONFIG.grid,
  expectedWordCount: number = CONFIG.wordsPerGrid,
): ValidationResult {
  const errors: string[] = [];
  const { rows, cols, cells, words } = grid;

  // ── Shape ───────────────────────────────────────────────
  if (cells.length !== rows || cells.some((r) => r.length !== cols)) {
    errors.push('cells array does not match rows/cols');
    return { ok: false, errors, stats: emptyStats(grid) };
  }

  // ── Word list ───────────────────────────────────────────
  if (words.length !== expectedWordCount) errors.push(`expected ${expectedWordCount} words, got ${words.length}`);
  const answers = words.map((w) => w.answer);
  if (new Set(answers).size !== answers.length) errors.push('duplicate answers in grid');
  const lenRe = new RegExp(`^[A-Z]{${CONFIG.wordMinLength},${CONFIG.wordMaxLength}}$`);
  for (const a of answers) if (!lenRe.test(a)) errors.push(`bad answer "${a}"`);

  // ── Each word sits in the grid with matching letters ────
  const coverage: number[][][] = cells.map((r) => r.map(() => []));
  words.forEach((w, idx) => {
    const [dr, dc] = w.direction === 'across' ? [0, 1] : [1, 0];
    for (let i = 0; i < w.answer.length; i++) {
      const r = w.row + dr * i;
      const c = w.col + dc * i;
      if (r < 0 || c < 0 || r >= rows || c >= cols) {
        errors.push(`${w.answer} runs off the grid`);
        return;
      }
      if (cells[r]![c] !== w.answer[i]) errors.push(`${w.answer} letter ${i + 1} does not match the grid`);
      coverage[r]![c]!.push(idx);
    }
  });

  // ── No accidental words: every run of 2+ letters is exactly one placed word ──
  const runs = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; ) {
      if (cells[r]![c] === null) { c++; continue; }
      let end = c;
      while (end + 1 < cols && cells[r]![end + 1] !== null) end++;
      if (end > c) runs.add(key('across', r, c, end - c + 1));
      c = end + 1;
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; ) {
      if (cells[r]![c] === null) { r++; continue; }
      let end = r;
      while (end + 1 < rows && cells[end + 1]![c] !== null) end++;
      if (end > r) runs.add(key('down', r, c, end - r + 1));
      r = end + 1;
    }
  }
  const wordKeys = new Set(words.map((w) => key(w.direction, w.row, w.col, w.answer.length)));
  for (const run of runs) if (!wordKeys.has(run)) errors.push(`accidental letter run ${run}`);
  for (const wk of wordKeys) if (!runs.has(wk)) errors.push(`word ${wk} is not a clean standalone run`);

  // Every letter cell belongs to a word; no stray letters.
  let letterCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r]![c] === null) continue;
      letterCells++;
      if (coverage[r]![c]!.length === 0) errors.push(`stray letter at ${r},${c}`);
    }
  }

  // ── Crossings & connectivity ────────────────────────────
  const neighbours: Set<number>[] = words.map(() => new Set());
  let crossings = 0;
  for (const row of coverage) {
    for (const cell of row) {
      if (cell.length === 2) {
        crossings++;
        neighbours[cell[0]!]!.add(cell[1]!);
        neighbours[cell[1]!]!.add(cell[0]!);
      } else if (cell.length > 2) {
        errors.push('a square is shared by more than two words');
      }
    }
  }
  words.forEach((w, i) => {
    if (neighbours[i]!.size === 0) errors.push(`${w.answer} crosses no other word`);
  });
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length && words.length) {
    for (const n of neighbours[queue.pop()!]!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  if (words.length && seen.size !== words.length) errors.push('words do not form one connected network');

  const wordsWithTwoPlusCrossings = neighbours.filter((n) => n.size >= 2).length;
  if (words.length && wordsWithTwoPlusCrossings / words.length < limits.minShareWithTwoCrossings) {
    errors.push(`only ${wordsWithTwoPlusCrossings}/${words.length} words cross two or more others`);
  }

  // ── Size & compactness ─────────────────────────────────
  if (rows < limits.minRows || cols < limits.minCols) errors.push(`grid ${rows}×${cols} is too small`);
  if (rows > limits.maxRows || cols > limits.maxCols) errors.push(`grid ${rows}×${cols} is too large`);
  if (Math.max(rows, cols) / Math.min(rows, cols) > limits.maxAspectRatio) errors.push(`grid ${rows}×${cols} is not square enough`);
  const density = letterCells / (rows * cols);
  if (density < limits.minDensity) errors.push(`density ${density.toFixed(2)} is too sparse`);
  const largestEmptySquare = largestEmpty(cells);
  if (largestEmptySquare > limits.maxEmptySquare) errors.push(`empty area of ${largestEmptySquare}×${largestEmptySquare}`);
  if (cells[0]!.every((c) => c === null) || cells[rows - 1]!.every((c) => c === null) ||
      cells.every((r) => r[0] === null) || cells.every((r) => r[cols - 1] === null)) {
    errors.push('grid has an empty border row or column');
  }

  // ── Numbering ──────────────────────────────────────────
  const renumbered = assignNumbers(words);
  if (renumbered.some((w, i) => w.number !== words[i]!.number)) errors.push('clue numbers are wrong');

  const stats: GridStats = {
    rows, cols, area: rows * cols, letterCells, density,
    totalLetters: answers.reduce((s, a) => s + a.length, 0),
    longWords: answers.filter((a) => a.length >= CONFIG.balance.longWordLength).length,
    crossings, wordsWithTwoPlusCrossings, largestEmptySquare,
  };
  return { ok: errors.length === 0, errors, stats };
}

/** Side length of the largest all-black square (classic dynamic-programming scan). */
function largestEmpty(cells: (string | null)[][]): number {
  let best = 0;
  let prev: number[] = new Array(cells[0]?.length ?? 0).fill(0);
  for (const row of cells) {
    const cur = row.map(() => 0);
    row.forEach((cell, c) => {
      if (cell !== null) return;
      cur[c] = c === 0 ? 1 : Math.min(prev[c]!, prev[c - 1]!, cur[c - 1]!) + 1;
      best = Math.max(best, cur[c]!);
    });
    prev = cur;
  }
  return best;
}

function emptyStats(grid: Grid): GridStats {
  return {
    rows: grid.rows, cols: grid.cols, area: grid.rows * grid.cols, letterCells: 0, density: 0,
    totalLetters: 0, longWords: 0, crossings: 0, wordsWithTwoPlusCrossings: 0, largestEmptySquare: 0,
  };
}

/** Checks the rules that involve both grids together. */
export function validatePair(a: Grid, b: Grid, balance: { [K in keyof typeof CONFIG.balance]: number } = CONFIG.balance): string[] {
  const errors: string[] = [];
  const answersA = new Set(a.words.map((w) => w.answer));
  for (const w of b.words) if (answersA.has(w.answer)) errors.push(`${w.answer} appears in both grids`);

  const sa = validateGrid(a).stats;
  const sb = validateGrid(b).stats;
  if (Math.abs(sa.area - sb.area) / Math.max(sa.area, sb.area) > balance.maxAreaDifference) {
    errors.push(`grid sizes differ too much (${sa.rows}×${sa.cols} vs ${sb.rows}×${sb.cols})`);
  }
  if (Math.abs(sa.totalLetters - sb.totalLetters) / Math.max(sa.totalLetters, sb.totalLetters) > balance.maxLetterDifference) {
    errors.push(`answer lengths differ too much (${sa.totalLetters} vs ${sb.totalLetters} letters)`);
  }
  if (Math.abs(sa.longWords - sb.longWords) > balance.maxLongWordDifference) {
    errors.push(`long-word counts differ too much (${sa.longWords} vs ${sb.longWords})`);
  }
  return errors;
}

