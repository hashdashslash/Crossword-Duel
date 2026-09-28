/** Saved games, history and profiles (shared by the server and the browser). */
import type { Difficulty, Theme, TimerMode } from './config.js';
import type { EndReason, GameResult } from './protocol.js';

export type Outcome = 'win' | 'loss' | 'draw';

export interface GameMeta {
  difficulty: Difficulty;
  theme: Theme;
  timerMode: TimerMode;
}

export interface HistoryEntry extends GameMeta {
  id: string;
  finishedAt: string;
  reason: EndReason;
  outcome: Outcome;
  yourFinalMs: number | null;
  opponent: { name: string; username: string | null };
  opponentFinalMs: number | null;
}

export interface SavedGame {
  result: GameResult;
  finishedAt: string;
  meta: GameMeta;
  /** The viewer's player id in `result`. */
  you: string;
  /** Account usernames by seat (null for guests). */
  usernames: (string | null)[];
}

export interface Profile {
  username: string;
  memberSince: string;
  wins: number;
  losses: number;
  draws: number;
  recent: HistoryEntry[];
}
