import type { Difficulty } from '../../shared/config.js';

export interface QuickCheckResult {
  valid: boolean;
  /** One short sentence for the clue writer (only when invalid). */
  reason: string;
}

export interface ReviewItem {
  id: string;
  answer: string;
  clue: string;
}

export interface ReviewVerdict {
  id: string;
  flagged: boolean;
  explanation: string;
  /** A fair replacement clue (only when flagged). */
  replacement: string;
}

export interface ClueAI {
  readonly mode: 'anthropic' | 'mock';
  quickCheck(answer: string, clue: string, signal: AbortSignal): Promise<QuickCheckResult>;
  review(items: ReviewItem[], signal: AbortSignal): Promise<ReviewVerdict[]>;
  /** A new clue for `answer` that differs from every clue in `avoid`. */
  alternativeClue(answer: string, avoid: string[], difficulty: Difficulty, signal: AbortSignal): Promise<string>;
  /** Short dictionary-style definitions (used when the built-in dictionary has no entry). */
  define(word: string, signal: AbortSignal): Promise<{ pos: string; text: string }[]>;
  /**
   * Several original candidate clues per answer for the daily puzzle, each in
   * a different style. May return fewer than asked for; the caller fills gaps.
   */
  writeCrosswordClues(items: CrosswordClueRequest[], context: CrosswordClueContext, signal: AbortSignal): Promise<CrosswordCandidates[]>;
  /**
   * Scores candidate clues against the playbook's rubric. `critic` picks one
   * of two independent passes (0: editor, 1: test solver).
   */
  reviewCrosswordClues(items: CrosswordClueReviewItem[], critic: 0 | 1, signal: AbortSignal): Promise<CrosswordClueReview[]>;
}

export interface CrosswordClueRequest {
  id: string;
  answer: string;
  /** Crosses a less familiar answer, so it needs a straight, fair clue (no misdirection). */
  straight?: boolean;
  /** Clues not to repeat: this answer's clues from recent daily puzzles, or ones an editor rejected. */
  avoid?: string[];
}

export interface CrosswordClueContext {
  /** Every answer in the grid; no clue may use one of them as a word. */
  gridAnswers: string[];
}

export interface CrosswordCandidates {
  id: string;
  candidates: { clue: string; technique: string }[];
}

export interface CrosswordClueReviewItem {
  id: string;
  answer: string;
  clues: string[];
}

/** Rubric scores for one clue: each criterion 0 (bad) to 3 (excellent). */
export interface ClueScore {
  accuracy: number;
  fairness: number;
  freshness: number;
  surface: number;
  delight: number;
  /** Whether the clue relies on a fact, and if so whether the critic is sure it is true. */
  facts: 'none' | 'sure' | 'unsure';
}

export interface CrosswordClueReview {
  id: string;
  /** One score per clue, in the order given. */
  scores: (ClueScore & { index: number })[];
}

/** Runs `fn` with an abort signal that fires after `ms`; rejects on timeout. */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
