/**
 * Pure scoring rules: final times, the "can't win any more" check, and the
 * winner with tie-breaks. No timers or sockets here, so it is easy to test.
 */
import { CONFIG } from '../../shared/config.js';

export interface ScoreInput {
  id: string;
  /** Server time of the correct submission, if any. */
  finishedAt: number | null;
  hintsUsed: number;
  /** Clues this player wrote that the review flagged. */
  flaggedCount: number;
  wordsCorrect: number;
}

export const penaltyMs = (p: Pick<ScoreInput, 'hintsUsed' | 'flaggedCount'>) =>
  p.hintsUsed * CONFIG.hintPenaltySeconds * 1000 + p.flaggedCount * CONFIG.flaggedCluePenaltySeconds * 1000;

export function finalMs(p: ScoreInput, startedAt: number): number | null {
  return p.finishedAt === null ? null : p.finishedAt - startedAt + penaltyMs(p);
}

/**
 * While one player has finished, the other can no longer win once their
 * running time plus known penalties reaches the finished player's final time
 * (a tie would go to the earlier submission, i.e. the finished player).
 */
export function cannotWin(finished: ScoreInput, running: ScoreInput, startedAt: number, now: number): boolean {
  const target = finalMs(finished, startedAt);
  if (target === null) return false;
  return now - startedAt + penaltyMs(running) >= target;
}

export interface Outcome {
  winnerId: string | null;
  tieBreak: 'submission' | 'hints' | 'words' | null;
}

/** Decides the winner once the game is over for time-based reasons. */
export function decideWinner(a: ScoreInput, b: ScoreInput, startedAt: number): Outcome {
  const fa = finalMs(a, startedAt);
  const fb = finalMs(b, startedAt);

  if (fa !== null && fb !== null) {
    if (fa !== fb) return { winnerId: fa < fb ? a.id : b.id, tieBreak: null };
    if (a.finishedAt !== b.finishedAt) return { winnerId: a.finishedAt! < b.finishedAt! ? a.id : b.id, tieBreak: 'submission' };
    if (a.hintsUsed !== b.hintsUsed) return { winnerId: a.hintsUsed < b.hintsUsed ? a.id : b.id, tieBreak: 'hints' };
    return { winnerId: null, tieBreak: null };
  }
  // Only one finished: they win (the other ran out of time or could no longer catch up).
  if (fa !== null) return { winnerId: a.id, tieBreak: null };
  if (fb !== null) return { winnerId: b.id, tieBreak: null };

  // Neither finished (time limit): more correct words, then fewer hints, else a draw.
  if (a.wordsCorrect !== b.wordsCorrect) return { winnerId: a.wordsCorrect > b.wordsCorrect ? a.id : b.id, tieBreak: 'words' };
  if (a.hintsUsed !== b.hintsUsed) return { winnerId: a.hintsUsed < b.hintsUsed ? a.id : b.id, tieBreak: 'hints' };
  return { winnerId: null, tieBreak: null };
}
