/**
 * Deterministic freeform (criss-cross) grid builder.
 *
 * How it works:
 *  1. Put one fairly long word across the middle.
 *  2. Repeatedly look at every unused candidate word and every spot where it
 *     could cross a letter already on the board. Reject any spot that would
 *     touch other letters side-by-side (that would create accidental words)
 *     or push the grid past its size limits. Score the rest (more crossings
 *     and a tighter, squarer grid score higher) and place the best one.
 *  3. Stop at 15 words. Run the independent validator on the result.
 *  4. Repeat many times and keep the best-scoring valid grid.
 */
import { CONFIG } from '../../shared/config.js';
import { assignNumbers } from './numbering.js';
import { shuffle, type Rng } from './rng.js';
import type { Direction, Grid, GridStats, PlacedWord } from './types.js';
import { validateGrid, type GridLimits } from './validate.js';

interface Cell {
  letter: string;
  across?: number; // index of the across word using this cell
  down?: number; // index of the down word using this cell
}

interface Candidate {
  answer: string;
  row: number;
  col: number;
  direction: Direction;
  crossed: number[];
}

const step = (dir: Direction): [number, number] => (dir === 'across' ? [0, 1] : [1, 0]);
const cellKey = (r: number, c: number) => `${r},${c}`;

class Board {
  cells = new Map<string, Cell>();
  words: Omit<PlacedWord, 'number'>[] = [];
  crossCount: number[] = [];
  minR = 0; maxR = -1; minC = 0; maxC = -1;
  /** Where each letter sits, so we only test spots that actually cross something. */
  byLetter = new Map<string, [number, number][]>();

  constructor(private limits: GridLimits) {}

  get rows() { return this.maxR - this.minR + 1; }
  get cols() { return this.maxC - this.minC + 1; }

  at(r: number, c: number) { return this.cells.get(cellKey(r, c)); }

  /** Returns the words this placement would cross, or null if it is not allowed. */
  check(answer: string, row: number, col: number, dir: Direction): number[] | null {
    const [dr, dc] = step(dir);
    const len = answer.length;
    const endR = row + dr * (len - 1);
    const endC = col + dc * (len - 1);

    // Size limits for the grown bounding box.
    if (this.words.length) {
      const rows = Math.max(this.maxR, endR) - Math.min(this.minR, row) + 1;
      const cols = Math.max(this.maxC, endC) - Math.min(this.minC, col) + 1;
      if (rows > this.limits.maxRows || cols > this.limits.maxCols) return null;
    }

    // The squares just before and after the word must be empty.
    if (this.at(row - dr, col - dc) || this.at(endR + dr, endC + dc)) return null;

    const crossed: number[] = [];
    for (let i = 0; i < len; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const cell = this.at(r, c);
      if (cell) {
        if (cell.letter !== answer[i]) return null;
        if (cell[dir] !== undefined) return null; // would overlap a word running the same way
        crossed.push(dir === 'across' ? cell.down! : cell.across!);
      } else {
        // An empty square we fill must not touch letters on either side,
        // otherwise two letters would sit together and form a non-word.
        if (this.at(r + dc, c + dr) || this.at(r - dc, c - dr)) return null;
      }
    }
    if (this.words.length && crossed.length === 0) return null;
    if (crossed.length === len) return null;
    return crossed;
  }

  place(answer: string, row: number, col: number, dir: Direction, crossed: number[]) {
    const idx = this.words.length;
    const [dr, dc] = step(dir);
    this.words.push({ answer, row, col, direction: dir });
    this.crossCount.push(crossed.length);
    for (const w of crossed) this.crossCount[w]!++;
    for (let i = 0; i < answer.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const k = cellKey(r, c);
      const existing = this.cells.get(k);
      if (existing) {
        existing[dir] = idx;
      } else {
        this.cells.set(k, { letter: answer[i]!, [dir]: idx });
        const list = this.byLetter.get(answer[i]!) ?? [];
        list.push([r, c]);
        this.byLetter.set(answer[i]!, list);
      }
    }
    if (idx === 0) {
      this.minR = row; this.minC = col; this.maxR = row + dr * (answer.length - 1); this.maxC = col + dc * (answer.length - 1);
    } else {
      this.minR = Math.min(this.minR, row);
      this.minC = Math.min(this.minC, col);
      this.maxR = Math.max(this.maxR, row + dr * (answer.length - 1));
      this.maxC = Math.max(this.maxC, col + dc * (answer.length - 1));
    }
  }

  /** Every legal spot where this word could cross something already placed. */
  candidates(answer: string): Candidate[] {
    const out: Candidate[] = [];
    for (let i = 0; i < answer.length; i++) {
      for (const [r, c] of this.byLetter.get(answer[i]!) ?? []) {
        const cell = this.at(r, c)!;
        const dir: Direction = cell.across !== undefined ? 'down' : 'across';
        if (cell.across !== undefined && cell.down !== undefined) continue; // already a crossing
        const [dr, dc] = step(dir);
        const row = r - dr * i;
        const col = c - dc * i;
        const crossed = this.check(answer, row, col, dir);
        if (crossed) out.push({ answer, row, col, direction: dir, crossed });
      }
    }
    return out;
  }

  toGrid(): Grid {
    const cells: (string | null)[][] = Array.from({ length: this.rows }, () => new Array(this.cols).fill(null));
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(',').map(Number) as [number, number];
      cells[r - this.minR]![c - this.minC] = cell.letter;
    }
    const words = assignNumbers(
      this.words.map((w) => ({ ...w, row: w.row - this.minR, col: w.col - this.minC, number: 0 })),
    );
    return { rows: this.rows, cols: this.cols, cells, words };
  }
}

/** Scores a possible placement. Higher is better. */
function scorePlacement(board: Board, cand: Candidate, rng: Rng, limits: GridLimits): number {
  const [dr, dc] = step(cand.direction);
  const endR = cand.row + dr * (cand.answer.length - 1);
  const endC = cand.col + dc * (cand.answer.length - 1);
  const rows = Math.max(board.maxR, endR) - Math.min(board.minR, cand.row) + 1;
  const cols = Math.max(board.maxC, endC) - Math.min(board.minC, cand.col) + 1;
  const growth = rows * cols - board.rows * board.cols;

  // Aim for a grid that is compact but reaches the minimum size.
  const targetRows = Math.round((limits.minRows + limits.maxRows) / 2) - 1;
  const targetCols = limits.maxCols - 1;
  const overshoot = Math.max(0, rows - targetRows) + Math.max(0, cols - targetCols);
  const aspect = Math.max(rows, cols) / Math.min(rows, cols);

  let score = cand.crossed.length * 14;
  // Crossing a word that has only one crossing so far makes the network sturdier.
  for (const w of cand.crossed) if (board.crossCount[w]! < 2) score += 6;
  score -= growth * 0.12;
  score -= overshoot * 4;
  if (aspect > limits.maxAspectRatio) score -= (aspect - limits.maxAspectRatio) * 30;
  score += cand.answer.length * 0.6;
  score += rng() * 6; // variety, so repeated attempts explore different shapes
  return score;
}

/** One greedy build attempt. Returns null if the words could not all be placed. */
export function buildOnce(pool: string[], rng: Rng, wordCount = CONFIG.wordsPerGrid, limits: GridLimits = CONFIG.grid): Grid | null {
  const board = new Board(limits);
  const words = shuffle(pool, rng);

  // Seed: a reasonably long word, placed across.
  const seedChoices = words.filter((w) => w.length >= 6 && w.length <= limits.maxCols);
  const seed = seedChoices[0] ?? words[0]!;
  board.place(seed, 0, 0, 'across', []);
  const remaining = new Set(words.filter((w) => w !== seed));

  while (board.words.length < wordCount) {
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const word of remaining) {
      for (const cand of board.candidates(word)) {
        const s = scorePlacement(board, cand, rng, limits);
        if (s > bestScore) { bestScore = s; best = cand; }
      }
    }
    if (!best) return null;
    board.place(best.answer, best.row, best.col, best.direction, best.crossed);
    remaining.delete(best.answer);
  }
  return board.toGrid();
}

/** How good a finished, valid grid is. Used to pick the best of many attempts. */
export function gridQuality(stats: GridStats): number {
  const aspect = Math.max(stats.rows, stats.cols) / Math.min(stats.rows, stats.cols);
  return stats.density * 100 + stats.wordsWithTwoPlusCrossings * 3 + stats.crossings * 1.5
    - (aspect - 1) * 25 - stats.largestEmptySquare * 2;
}

export interface ScoredGrid {
  grid: Grid;
  stats: GridStats;
  quality: number;
}

/** Runs many build attempts on one word pool and returns every grid that passes validation. */
export function buildValidGrids(pool: string[], rng: Rng, attempts: number = CONFIG.grid.attemptsPerGrid): ScoredGrid[] {
  const out: ScoredGrid[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < attempts; i++) {
    const grid = buildOnce(pool, rng);
    if (!grid) continue;
    const result = validateGrid(grid);
    if (!result.ok) continue;
    const sig = grid.cells.map((r) => r.map((c) => c ?? '.').join('')).join('/');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ grid, stats: result.stats, quality: gridQuality(result.stats) });
  }
  return out.sort((a, b) => b.quality - a.quality);
}
