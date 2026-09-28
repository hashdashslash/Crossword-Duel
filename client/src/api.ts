import type { Difficulty } from '../../shared/config';
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

export const createDaily = (date: string) => post<{ puzzle: PuzzleView; number: number; date: string }>('/api/daily', { date });

export const createPractice = (difficulty: Difficulty) => post<PuzzleView>('/api/practice', { difficulty });

export const checkPractice = (id: string, entries: Entries) => post<CheckResult>(`/api/practice/${id}/check`, { entries });
