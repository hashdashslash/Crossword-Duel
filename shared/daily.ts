/** Daily puzzle numbering, shared by the server and the browser. */

/** The date of daily puzzle #1. */
export const DAILY_START = '2026-09-28';
const DAY_MS = 86_400_000;

/** Puzzle number for a YYYY-MM-DD date (1 on DAILY_START). */
export function dailyNumber(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${DAILY_START}T00:00:00Z`)) / DAY_MS) + 1;
}
