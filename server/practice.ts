/**
 * Single-player practice puzzles (Phase 2). Clues are placeholders — each one
 * is the answer's letters scrambled — until real player-written clues arrive.
 */
import { randomUUID } from 'node:crypto';
import type { Difficulty } from '../shared/config.js';
import type { CheckResult, PuzzleView } from '../shared/puzzle.js';
import { generateSingleGrid } from './grid/puzzles.js';
import { createRng, randomSeed, shuffle } from './grid/rng.js';
import type { Grid } from './grid/types.js';
import { checkEntries } from './solve/check.js';

interface PracticeGame {
  grid: Grid;
  view: PuzzleView;
  startedAt: number;
  solvedAt?: number;
}

const games = new Map<string, PracticeGame>();
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function scramble(answer: string, seed: number): string {
  const rng = createRng(seed);
  for (let i = 0; i < 10; i++) {
    const s = shuffle([...answer], rng).join('');
    if (s !== answer) return s;
  }
  return [...answer].reverse().join('');
}

export function toPuzzleView(id: string, grid: Grid, clueText: (answer: string, index: number) => string): PuzzleView {
  return {
    id,
    rows: grid.rows,
    cols: grid.cols,
    open: grid.cells.map((row) => row.map((c) => c !== null)),
    clues: grid.words.map((w, i) => ({
      number: w.number,
      direction: w.direction,
      row: w.row,
      col: w.col,
      length: w.answer.length,
      text: clueText(w.answer, i),
    })),
  };
}

export function createPractice(difficulty: Difficulty): PuzzleView {
  const now = Date.now();
  for (const [id, g] of games) if (now - g.startedAt > MAX_AGE_MS) games.delete(id);

  const grid = generateSingleGrid(difficulty);
  const id = randomUUID();
  const seed = randomSeed();
  const view = toPuzzleView(id, grid, (answer, i) => `Unscramble: ${scramble(answer, seed + i)}`);
  games.set(id, { grid, view, startedAt: now });
  return view;
}

export function checkPractice(id: string, entries: unknown): CheckResult | null {
  const game = games.get(id);
  if (!game) return null;
  const { blanks, wrong } = checkEntries(game.grid, entries);
  const solved = blanks.length === 0 && wrong.length === 0;
  if (solved && !game.solvedAt) game.solvedAt = Date.now();
  return { solved, blanks, wrong, elapsedMs: (game.solvedAt ?? Date.now()) - game.startedAt };
}
