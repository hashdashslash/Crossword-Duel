/**
 * The daily puzzle: one grid per calendar day, the same for everyone.
 * Players send their own local date, so the puzzle changes at their midnight.
 */
import { CONFIG } from '../shared/config.js';
import { DAILY_START, dailyNumber } from '../shared/daily.js';
import type { PuzzleView } from '../shared/puzzle.js';
import { generateSingleGrid } from './grid/puzzles.js';
import type { Grid } from './grid/types.js';
import { fixedClue, startSoloGame } from './practice.js';

const DAY_MS = 86_400_000;

export const isDateString = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** A stable 32-bit seed from the date string. */
function seedFor(date: string): number {
  let h = 2166136261;
  for (const ch of `daily:${date}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const grids = new Map<string, Grid>();

export function dailyGrid(date: string): Grid {
  let grid = grids.get(date);
  if (!grid) {
    grid = generateSingleGrid(CONFIG.dailyDifficulty, { seed: seedFor(date) });
    grids.set(date, grid);
    if (grids.size > 7) grids.delete(grids.keys().next().value!);
  }
  return grid;
}

/**
 * Starts today's puzzle. Dates before day #1 or more than a day ahead of the
 * server (time zones) are refused.
 */
export function createDaily(date: unknown): { puzzle: PuzzleView; number: number; date: string } | { error: string } {
  if (!isDateString(date)) return { error: 'Invalid date.' };
  const serverTomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
  if (date < DAILY_START || date > serverTomorrow) return { error: "That day's puzzle isn't available." };
  const seed = seedFor(date);
  const puzzle = startSoloGame(dailyGrid(date), (answer, i) => fixedClue(answer, seed + i));
  return { puzzle, number: dailyNumber(date), date };
}
