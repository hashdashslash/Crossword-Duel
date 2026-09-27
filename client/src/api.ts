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

export const createPractice = (difficulty: Difficulty) => post<PuzzleView>('/api/practice', { difficulty });

export const checkPractice = (id: string, entries: Entries) => post<CheckResult>(`/api/practice/${id}/check`, { entries });
