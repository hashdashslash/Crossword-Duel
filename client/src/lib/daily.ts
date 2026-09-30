/** Daily puzzle results and streak, kept in this browser only. */
import { formatTime } from '../solve/Timer';
import { local } from './storage';

const KEY = 'cd.daily';
const PROGRESS_KEY = 'cd.daily.progress';

/** Solve time (ms) by local date, e.g. { "2026-09-28": 271000 }. */
type Results = Record<string, number>;

/** Today's date on this device, as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function load(): Results {
  try {
    const r = JSON.parse(local.get(KEY) ?? '') as Results;
    if (r && typeof r === 'object') return r;
  } catch { /* empty or corrupt */ }
  return {};
}

export function dailyResult(date: string): number | null {
  return load()[date] ?? null;
}

export function saveDailyResult(date: string, ms: number) {
  const r = load();
  if (r[date] !== undefined) return; // the first solve counts
  r[date] = ms;
  local.set(KEY, JSON.stringify(r));
}

/** Days in a row solved, ending today (or yesterday, if today isn't solved yet). */
export function dailyStreak(today = new Date()): number {
  const r = load();
  const day = new Date(today);
  if (r[localDate(day)] === undefined) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (r[localDate(day)] !== undefined) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

export function dailyShareText(number: number, ms: number, streak: number, origin: string): string {
  const streakPart = streak > 1 ? ` · 🔥 ${streak}-day streak` : '';
  return `Crossword Duel Daily #${number} · ${formatTime(ms)}${streakPart}\n${origin}/daily`;
}

/** A daily puzzle the player started but hasn't finished (so they can come back to it). */
export interface DailyProgress {
  date: string;
  entries: string[][];
  elapsedMs: number;
}

export function loadDailyProgress(date: string): DailyProgress | null {
  try {
    const p = JSON.parse(local.get(PROGRESS_KEY) ?? '') as DailyProgress;
    if (p && p.date === date && Array.isArray(p.entries) && typeof p.elapsedMs === 'number') return p;
  } catch { /* none, or corrupt */ }
  return null;
}

export function saveDailyProgress(progress: DailyProgress) {
  local.set(PROGRESS_KEY, JSON.stringify(progress));
}

export function clearDailyProgress() {
  local.remove(PROGRESS_KEY);
}
