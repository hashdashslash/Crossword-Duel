import type { Difficulty } from '../../shared/config';
import type { HistoryEntry, Profile, SavedGame } from '../../shared/history';
import type { CheckResult, PuzzleView } from '../../shared/puzzle';
import type { Entries } from './solve/navigation';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return data as T;
}

/** Server info. `bootId` changes every time the server restarts. */
export async function getServerConfig(): Promise<{ aiMode: string; bootId: string } | null> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return data as T;
}

export const getHistory = (before?: string) => get<{ games: HistoryEntry[] }>(`/api/history${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export const getSavedGame = (id: string) => get<SavedGame>(`/api/games/${encodeURIComponent(id)}`);
export const getSharedGame = (id: string) => get<SavedGame>(`/api/results/${encodeURIComponent(id)}`);
export const getProfile = (username: string) => get<Profile>(`/api/profile/${encodeURIComponent(username)}`);

export const createDaily = (date: string) => post<{ puzzle: PuzzleView; number: number; date: string }>('/api/daily', { date });

export const createPractice = (difficulty: Difficulty) => post<PuzzleView>('/api/practice', { difficulty });

export const checkPractice = (id: string, entries: Entries) => post<CheckResult>(`/api/practice/${id}/check`, { entries });
