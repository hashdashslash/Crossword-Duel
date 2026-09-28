/**
 * Single-player practice puzzles. Clues are ones players voted "best clue" in
 * duels when there are any, otherwise dictionary definitions; a word with
 * neither gets its letters scrambled.
 */
import { randomUUID } from 'node:crypto';
import type { Difficulty } from '../shared/config.js';
import { clueContainsAnswer } from '../shared/rules.js';
import type { CheckResult, PuzzleView } from '../shared/puzzle.js';
import { generateSingleGrid } from './grid/puzzles.js';
import { createRng, randomSeed, shuffle } from './grid/rng.js';
import type { Grid } from './grid/types.js';
import { checkEntries } from './solve/check.js';
import { pickBestClue } from './words/clueLibrary.js';
import { lookupDefinition } from './words/definitions.js';

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

/** The first definition that doesn't give the answer away, capitalised, or null. */
export function definitionClue(answer: string): string | null {
  for (const sense of lookupDefinition(answer) ?? []) {
    const text = sense.text.trim();
    if (!text || clueContainsAnswer(text, answer)) continue;
    return text[0]!.toUpperCase() + text.slice(1);
  }
  return null;
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

/** Starts a solo game on `grid` (its timer and answer checks live on the server). */
export function startSoloGame(grid: Grid, clueText: (answer: string, index: number) => string): PuzzleView {
  const now = Date.now();
  for (const [id, g] of games) if (now - g.startedAt > MAX_AGE_MS) games.delete(id);
  const id = randomUUID();
  const view = toPuzzleView(id, grid, clueText);
  games.set(id, { grid, view, startedAt: now });
  return view;
}

export function createPractice(difficulty: Difficulty): PuzzleView {
  const grid = generateSingleGrid(difficulty);
  const seed = randomSeed();
  return startSoloGame(grid, (answer, i) => pickBestClue(answer) ?? definitionClue(answer) ?? `Unscramble: ${scramble(answer, seed + i)}`);
}

/** Dictionary clue, or scrambled letters (the same for everyone given the same seed). */
export function fixedClue(answer: string, seed: number): string {
  return definitionClue(answer) ?? `Unscramble: ${scramble(answer, seed)}`;
}

export function checkPractice(id: string, entries: unknown): CheckResult | null {
  const game = games.get(id);
  if (!game) return null;
  const { blanks, wrong } = checkEntries(game.grid, entries);
  const solved = blanks.length === 0 && wrong.length === 0;
  if (solved && !game.solvedAt) game.solvedAt = Date.now();
  return { solved, blanks, wrong, elapsedMs: (game.solvedAt ?? Date.now()) - game.startedAt };
}
