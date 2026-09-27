/**
 * Pretend AI for testing without an API key. Behaviour is predictable:
 * any clue containing the word "wrong" is treated as invalid.
 */
import type { Difficulty } from '../../shared/config.js';
import type { ClueAI, QuickCheckResult, ReviewItem, ReviewVerdict } from './types.js';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
  });

const isBad = (clue: string) => /\bwrong\b/i.test(clue);

function templateClue(answer: string, variant: number): string {
  const n = answer.length;
  const first = answer[0];
  const last = answer[n - 1];
  return variant === 0
    ? `(Test clue) ${n} letters, starting with ${first}`
    : `(Test hint) ${n} letters: starts with ${first}, ends with ${last}`;
}

export class MockClueAI implements ClueAI {
  readonly mode = 'mock' as const;

  async quickCheck(_answer: string, clue: string, signal: AbortSignal): Promise<QuickCheckResult> {
    await sleep(500, signal);
    return isBad(clue)
      ? { valid: false, reason: 'Test mode: clues containing the word "wrong" are treated as invalid.' }
      : { valid: true, reason: '' };
  }

  async review(items: ReviewItem[], signal: AbortSignal): Promise<ReviewVerdict[]> {
    await sleep(1200, signal);
    return items.map((i) =>
      isBad(i.clue)
        ? { id: i.id, flagged: true, explanation: 'Test mode: this clue contains the word "wrong", so it was flagged.', replacement: templateClue(i.answer, 0) }
        : { id: i.id, flagged: false, explanation: '', replacement: '' },
    );
  }

  async alternativeClue(answer: string, avoid: string[], _d: Difficulty, signal: AbortSignal): Promise<string> {
    await sleep(700, signal);
    const first = templateClue(answer, 0);
    return avoid.includes(first) ? templateClue(answer, 1) : first;
  }
}
