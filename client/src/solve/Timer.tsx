import { useEffect, useState } from 'react';

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = String(total % 60).padStart(2, '0');
  // Sunday-size daily puzzles can take over an hour: 1:05:09.
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${Math.floor(total / 60)}:${s}`;
}

/** Shows elapsed time since `startedAt`; freezes at `finalMs` once set. */
export function Timer({ startedAt, finalMs }: { startedAt: number; finalMs?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (finalMs !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [finalMs]);
  return <span className="timer" aria-label="Elapsed time">{formatTime(finalMs ?? now - startedAt)}</span>;
}
