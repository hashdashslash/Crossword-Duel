import { describe, expect, it } from 'vitest';
import { cannotWin, decideWinner, finalMs, type ScoreInput } from '../server/game/scoring.js';
import { cleanClue, clueContainsAnswer, validateName } from '../shared/rules.js';

describe('validateName', () => {
  it('trims, collapses spaces and enforces 1–20 characters', () => {
    expect(validateName('  Sam   Lee ')).toEqual({ ok: true, name: 'Sam Lee' });
    expect(validateName('   ').ok).toBe(false);
    expect(validateName('x'.repeat(21)).ok).toBe(false);
    expect(validateName('x'.repeat(20)).ok).toBe(true);
  });
});

describe('cleanClue', () => {
  it('caps clues at 150 characters', () => {
    expect(cleanClue('a'.repeat(200)).length).toBe(150);
  });
});

describe('clueContainsAnswer', () => {
  it('catches the answer and obvious forms', () => {
    expect(clueContainsAnswer('A garden in spring', 'GARDEN')).toBe(true);
    expect(clueContainsAnswer('Many GARDENS', 'GARDEN')).toBe(true);
    expect(clueContainsAnswer('What a gardener does', 'GARDEN')).toBe(true);
    expect(clueContainsAnswer('Baking bread', 'BAKE')).toBe(true);
    expect(clueContainsAnswer('Wild berries', 'BERRY')).toBe(true);
    expect(clueContainsAnswer('Running fast', 'RUN')).toBe(true);
    expect(clueContainsAnswer('G A R D E N', 'GARDEN')).toBe(true);
    expect(clueContainsAnswer('g-a-r-d-e-n', 'GARDEN')).toBe(true);
  });

  it('does not flag unrelated words that merely contain the letters', () => {
    expect(clueContainsAnswer('One in a million', 'LION')).toBe(false);
    expect(clueContainsAnswer('Want to eat', 'ANT')).toBe(false);
    expect(clueContainsAnswer('The art of war', 'HEART')).toBe(false);
    expect(clueContainsAnswer('Where flowers grow', 'GARDEN')).toBe(false);
  });
});

describe('scoring', () => {
  const start = 1_000_000;
  const p = (id: string, finishedAfter: number | null, hints = 0, flagged = 0, words = 0): ScoreInput => ({
    id, finishedAt: finishedAfter === null ? null : start + finishedAfter, hintsUsed: hints, flaggedCount: flagged, wordsCorrect: words,
  });

  it('adds hint and flagged-clue penalties', () => {
    expect(finalMs(p('a', 100_000, 2, 1), start)).toBe(100_000 + 60_000 + 60_000);
  });

  it('lowest final time wins', () => {
    expect(decideWinner(p('a', 100_000, 2), p('b', 150_000), start)).toEqual({ winnerId: 'b', tieBreak: null });
  });

  it('breaks ties by earlier submission, then fewer hints, else a draw', () => {
    // a: 90s + 30s = 120s (submitted at 90s); b: 120s (submitted at 120s)
    expect(decideWinner(p('a', 90_000, 1), p('b', 120_000), start)).toEqual({ winnerId: 'a', tieBreak: 'submission' });
    // Same submission time and same penalty total (2 hints = 1 flagged clue): fewer hints wins.
    expect(decideWinner(p('a', 100_000, 2), p('b', 100_000, 0, 1), start)).toEqual({ winnerId: 'b', tieBreak: 'hints' });
    expect(decideWinner(p('a', 100_000), p('b', 100_000), start)).toEqual({ winnerId: null, tieBreak: null });
  });

  it('when neither finishes, more correct words win, then fewer hints', () => {
    expect(decideWinner(p('a', null, 0, 0, 9), p('b', null, 0, 0, 12), start).winnerId).toBe('b');
    expect(decideWinner(p('a', null, 1, 0, 9), p('b', null, 3, 0, 9), start)).toEqual({ winnerId: 'a', tieBreak: 'hints' });
    expect(decideWinner(p('a', null, 1, 0, 9), p('b', null, 1, 0, 9), start).winnerId).toBeNull();
  });

  it('a finisher beats someone who ran out of time', () => {
    expect(decideWinner(p('a', null, 0, 0, 14), p('b', 1_700_000, 5, 3), start).winnerId).toBe('b');
  });

  it('detects when the running player can no longer win', () => {
    const done = p('a', 100_000, 0, 1); // final 160s
    expect(cannotWin(done, p('b', null), start, start + 150_000)).toBe(false);
    expect(cannotWin(done, p('b', null, 1), start, start + 150_000)).toBe(true); // 150 + 30 ≥ 160
    expect(cannotWin(done, p('b', null), start, start + 160_000)).toBe(true);
  });
});
