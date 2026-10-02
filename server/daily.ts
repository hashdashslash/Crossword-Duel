/**
 * The daily puzzle: one Sunday-size crossword per calendar day, the same for
 * everyone. Players send their own local date, so the puzzle changes at their
 * midnight.
 *
 * Grids are built ahead of time (npm run daily:build) because filling a 21×21
 * grid takes far more computing than the server has to spare. The clues are
 * written by the AI once per day and saved, so every player gets the same ones.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../shared/config.js';
import { DAILY_START, dailyNumber } from '../shared/daily.js';
import type { PuzzleView } from '../shared/puzzle.js';
import type { ClueAI } from './ai/types.js';
import type { Db } from './db/index.js';
import { dailyClues, dailyCluesSaved } from './dailyClues.js';
import { gridFromRows } from './grid/sunday.js';
import type { Grid } from './grid/types.js';
import { startSoloGame } from './practice.js';

const DAY_MS = 86_400_000;
export const DAILY_GRIDS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'grid', 'daily-grids.txt');

export const isDateString = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

let library: string[][] | null = null;

/** The pre-built grids, one per line (rows joined by "/", "#" for black squares). */
export function loadDailyGrids(): string[][] {
  library ??= readFileSync(DAILY_GRIDS_PATH, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('# '))
    .map((l) => l.trim().split('/'));
  return library;
}

const grids = new Map<string, Grid>();

/** The grid for a date. Day #1 uses the first grid in the library; the library repeats if it runs out. */
export function dailyGrid(date: string): Grid {
  const cached = grids.get(date);
  if (cached) return cached;
  const all = loadDailyGrids();
  const grid = gridFromRows(all[(dailyNumber(date) - 1) % all.length]!);
  grids.set(date, grid);
  if (grids.size > 7) grids.delete(grids.keys().next().value!);
  return grid;
}

/** Dates before day #1 or more than a day ahead of the server (time zones) are refused. */
export function dailyDateError(date: unknown): string | null {
  if (!isDateString(date)) return 'Invalid date.';
  const serverTomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
  if (date < DAILY_START || date > serverTomorrow) return "That day's puzzle isn't available.";
  return null;
}

export type DailyResponse =
  | { puzzle: PuzzleView; number: number; date: string }
  | { pending: true }
  | { error: string };

/**
 * Starts the day's puzzle. If its clues are still being written, answers
 * `{ pending: true }` after `waitMs` so the browser can ask again.
 * `resumeMs` continues the timer of a solve the player started earlier.
 */
export async function createDaily(
  date: unknown, deps: { ai: ClueAI; db?: Db | null }, opts: { resumeMs?: unknown; waitMs?: number } = {},
): Promise<DailyResponse> {
  const error = dailyDateError(date);
  if (error) return { error };
  const day = date as string;
  const grid = dailyGrid(day);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clues = await Promise.race([
    dailyClues(day, grid, { ...deps, gridFor: dailyGrid }),
    new Promise<null>((r) => { timer = setTimeout(() => r(null), opts.waitMs ?? 20_000); }),
  ]).finally(() => clearTimeout(timer));
  if (!clues) return { pending: true };
  const resumeMs = typeof opts.resumeMs === 'number' && Number.isFinite(opts.resumeMs) ? Math.min(Math.max(0, opts.resumeMs), DAY_MS) : 0;
  const puzzle = startSoloGame(grid, (_answer, i) => clues[i]!, resumeMs);
  return { puzzle, number: dailyNumber(day), date: day };
}

/** The daily clues are written and edited at this hour, Pacific time. */
export const WRITE_HOUR_PACIFIC = 2;

/** The date and hour in California (Pacific time, with daylight saving). */
export function pacificClock(now = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Writes and edits the daily clues ahead of time, so players rarely wait:
 * every night at 2am Pacific for the next day (the first places on Earth
 * reach it about then), retrying later if the AI fails. After a restart it
 * also makes sure the days players could be on right now are ready.
 */
export function prepareDailyClues(deps: { ai: ClueAI; db?: Db | null }) {
  if (!CONFIG.dailyPuzzle || deps.ai.mode !== 'anthropic') return;
  const prepare = async (dates: string[]): Promise<boolean> => {
    let allSaved = true;
    for (const date of dates) {
      if (dailyDateError(date)) continue;
      try {
        await dailyClues(date, dailyGrid(date), { ...deps, gridFor: dailyGrid });
        allSaved &&= dailyCluesSaved(date);
      } catch (e) {
        allSaved = false;
        console.warn(`[daily] could not prepare clues for ${date}:`, (e as Error).message);
      }
    }
    return allSaved;
  };
  // Yesterday, today and tomorrow in UTC cover every time zone.
  void prepare([0, 1, -1].map((offset) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)));

  let doneFor = '';
  let running = false;
  const nightly = async () => {
    const { date, hour } = pacificClock();
    if (hour < WRITE_HOUR_PACIFIC || doneFor === date || running) return;
    running = true;
    try {
      if (await prepare([date, addDays(date, 1)])) doneFor = date;
    } finally {
      running = false;
    }
  };
  setInterval(() => void nightly(), 10 * 60_000).unref();
}
