/**
 * Head-to-head record against each opponent, kept in this browser only.
 * Opponents are matched by name (case-insensitive).
 */
import type { GameResult } from '../../../shared/protocol';
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
