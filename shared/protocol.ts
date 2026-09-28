/**
 * Everything the server and the browsers say to each other during a game.
 * The server pushes one `state` message (a GameView) to each player whenever
 * anything changes; players send the actions below.
 */
import type { Difficulty } from './config.js';
import type { CellPos, Direction, PuzzleView } from './puzzle.js';

export type Phase = 'lobby' | 'writing' | 'reviewing' | 'solving' | 'finished';

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  /** The player left the room for good. */
  left: boolean;
  /** Server time when a disconnected player forfeits / is removed. */
  reconnectDeadline: number | null;
}

export interface WritingView {
  introDone: boolean;
  introDeadline: number | null;
  /** Your own words, in writing order. */
  words: { answer: string; done: boolean; blank: boolean }[];
  index: number;
  /** Server time when the current word auto-advances. */
  deadline: number | null;
  /** What you had typed for the current word (restored after a reconnect). */
  draft: string;
  done: boolean;
  opponentDoneCount: number;
}

export interface SolvingView {
  puzzle: PuzzleView;
  entries: string[][];
  startedAt: number;
  maxEndsAt: number;
  hintsUsed: number;
  hintsLeft: number;
  /** Hint clue text, by index into puzzle.clues. */
  hints: Record<number, string>;
  youFinished: boolean;
  /** Your raw solve time once you've finished. */
  yourRawMs: number | null;
  yourFilled: number;
  opponentFilled: number;
  opponentFinished: boolean;
  total: number;
}

export interface FlaggedClue {
  answer: string;
  original: string;
  replacement: string;
  explanation: string;
}

export interface PlayerResult {
  id: string;
  name: string;
  /** Raw solve time; null if they didn't finish. */
  rawMs: number | null;
  hintsUsed: number;
  hintPenaltyMs: number;
  /** Clues this player wrote that the review flagged. */
  flagged: FlaggedClue[];
  flaggedPenaltyMs: number;
  /** Raw time plus penalties; null if they didn't finish. */
  finalMs: number | null;
  wordsCorrect: number;
  totalWords: number;
}

export type EndReason = 'completed' | 'impossible' | 'timeout' | 'resign' | 'forfeit';

export interface RevealClue {
  number: number;
  direction: Direction;
  row: number;
  col: number;
  answer: string;
  /** The clue the solver actually saw. */
  text: string;
  /** The writer's original, when the review replaced it. */
  original?: string;
  explanation?: string;
  prefilled: boolean;
  hint?: string;
}

export interface RevealGrid {
  writerName: string;
  solverName: string;
  rows: number;
  cols: number;
  cells: (string | null)[][];
  clues: RevealClue[];
}

export interface GameResult {
  reason: EndReason;
  winnerId: string | null;
  /** How a tie on final time was broken. */
  tieBreak: 'submission' | 'hints' | 'words' | null;
  /** The player who resigned, forfeited, or left. */
  endedBy: string | null;
  players: PlayerResult[];
  grids: RevealGrid[];
  /** True if the AI review failed and original clues were used without penalties. */
  reviewSkipped: boolean;
}

export interface GameView {
  code: string;
  phase: Phase;
  difficulty: Difficulty;
  you: string;
  players: PlayerInfo[];
  serverNow: number;
  aiMode: 'anthropic' | 'mock';
  writing?: WritingView;
  solving?: SolvingView;
  result?: GameResult;
}

export type Err = { ok: false; error: string };
export type Ack<T> = (res: T | Err) => void;

export type NextResult =
  | { status: 'advanced' }
  | { status: 'warning'; reason: string }
  | { status: 'invalid'; message: string }
  | { status: 'stale' };

export interface ClientToServerEvents {
  'room:create': (p: { name: string; difficulty: Difficulty }, ack: Ack<{ ok: true; code: string; token: string }>) => void;
  'room:join': (p: { code: string; name: string }, ack: Ack<{ ok: true; token: string }>) => void;
  'room:rejoin': (p: { code: string; token: string }, ack: Ack<{ ok: true }>) => void;
  'room:leave': () => void;
  'lobby:difficulty': (d: Difficulty) => void;
  'lobby:ready': (ready: boolean) => void;
  'write:intro-done': () => void;
  'write:draft': (p: { index: number; text: string }) => void;
  'write:next': (p: { index: number; text: string; mode: 'check' | 'keep' | 'blank' }, ack: Ack<{ ok: true; result: NextResult }>) => void;
  'write:check': (p: { index: number; text: string }, ack: Ack<{ ok: true; valid: boolean; reason: string }>) => void;
  'solve:entries': (entries: string[][]) => void;
  'solve:submit': (entries: string[][], ack: Ack<{ ok: true; solved: boolean; blanks: CellPos[]; wrong: CellPos[] }>) => void;
  'solve:hint': (clueIndex: number, ack: Ack<{ ok: true; text: string }>) => void;
  'solve:resign': () => void;
  'game:rematch': () => void;
}

export interface ServerToClientEvents {
  state: (view: GameView) => void;
}
