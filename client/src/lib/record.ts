/**
 * Head-to-head record against each opponent, kept in this browser only.
 * Opponents are matched by name (case-insensitive).
 */
import type { GameResult } from '../../../shared/protocol';
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { local } from './storage';

const KEY = 'cd.record';
/** Remember this many recent game ids, so a result is never counted twice. */
const MAX_SEEN = 100;

export interface HeadToHead {
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

interface Stored {
  opponents: Record<string, HeadToHead>;
  seen: string[];
}

function load(): Stored {
  try {
    const data = JSON.parse(local.get(KEY) ?? '') as Stored;
    if (data && typeof data.opponents === 'object' && Array.isArray(data.seen)) return data;
  } catch { /* empty or corrupt */ }
  return { opponents: {}, seen: [] };
}

const keyFor = (name: string) => name.replace(/ \(2\)$/, '').trim().toLowerCase();

export function recordFor(opponentName: string): HeadToHead | null {
  const r = load().opponents[keyFor(opponentName)];
  return r && r.wins + r.losses + r.draws > 0 ? r : null;
}

/** Adds a finished game to the record (once per game). Returns the updated record. */
export function recordResult(result: GameResult, you: string): HeadToHead | null {
  const opp = result.players.find((p) => p.id !== you);
  if (!opp || !result.id) return null;
  const data = load();
  const key = keyFor(opp.name);
  const entry = data.opponents[key] ?? { name: opp.name, wins: 0, losses: 0, draws: 0 };
  if (!data.seen.includes(result.id)) {
    if (result.winnerId === null) entry.draws++;
    else if (result.winnerId === you) entry.wins++;
    else entry.losses++;
    entry.name = opp.name.replace(/ \(2\)$/, '');
    data.opponents[key] = entry;
    data.seen = [...data.seen, result.id].slice(-MAX_SEEN);
    local.set(KEY, JSON.stringify(data));
  }
  return entry;
}

/** "3 wins · 2 losses · 1 draw" */
export function describeRecord(r: HeadToHead): string {
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word === 'loss' ? 'es' : 's'}`;
  return [part(r.wins, 'win'), part(r.losses, 'loss'), ...(r.draws ? [part(r.draws, 'draw')] : [])].join(' · ');
}

/**
 * Head-to-head record against an opponent: from the server for signed-in
 * players (follows them across devices), otherwise from this browser.
 * `refreshKey` refetches (e.g. a new result id).
 */
export function useHeadToHead(opponent: { name: string; username?: string } | null, refreshKey = ''): HeadToHead | null {
  const { user } = useAuth();
  const [server, setServer] = useState<HeadToHead | null>(null);
  const name = opponent?.name ?? '';
  const username = opponent?.username ?? '';
  useEffect(() => {
    setServer(null);
    if (!user || !name) return;
    let cancelled = false;
    // Give the server a moment to save a game that just ended.
    const t = setTimeout(() => {
      fetch(`/api/record?${new URLSearchParams({ name, username })}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((r: { wins: number; losses: number; draws: number } | null) => {
          if (!cancelled && r) setServer({ name: username || name.replace(/ \(2\)$/, ''), ...r });
        })
        .catch(() => {});
    }, refreshKey ? 800 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user?.id, name, username, refreshKey]);
  if (!opponent) return null;
  if (user) return server && server.wins + server.losses + server.draws > 0 ? server : null;
  return recordFor(opponent.name);
}
