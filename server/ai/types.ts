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
