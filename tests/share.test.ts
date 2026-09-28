import { describe, expect, it } from 'vitest';
import type { GameResult, PlayerResult } from '../shared/protocol.js';
import { definitionClue } from '../server/practice.js';
import { clueContainsAnswer } from '../shared/rules.js';
import { shareText } from '../client/src/game/Reveal.js';

const player = (id: string, name: string, finalMs: number | null, hintsUsed: number): PlayerResult => ({
  id, name, rawMs: finalMs, hintsUsed, hintPenaltyMs: 0, flagged: [], flaggedPenaltyMs: 0, finalMs, wordsCorrect: 15, totalWords: 15,
});
const result = (winnerId: string | null, over: Partial<GameResult> = {}): GameResult => ({
  id: 'g1', reason: 'completed', winnerId, tieBreak: null, endedBy: null, reviewSkipped: false, grids: [],
  players: [player('a', 'Ann', 300_000, 1), player('b', 'Sam', 402_000, 0)], ...over,
});

describe('share text', () => {
  it('says who won and by how much', () => {
    const text = shareText(result('a'), 'a', 'https://example.com');
    expect(text.split('\n')[0]).toBe('Crossword Duel: Beat Sam by 1:42 🏆');
    expect(text).toContain('Me 5:00 (1 hint) · Sam 6:42 (0 hints)');
    expect(text.endsWith('https://example.com')).toBe(true);
  });
  it('handles losses, draws and resignations', () => {
    expect(shareText(result('b'), 'a', '')).toContain('Lost to Sam ❌');
    expect(shareText(result(null), 'a', '')).toContain('Drew with Sam 🤝');
    expect(shareText(result('a', { reason: 'resign', endedBy: 'b' }), 'a', '')).toContain('(they resigned)');
  });
});

describe('practice clues', () => {
  it('never contain the answer', () => {
    for (const word of ['ANCHOR', 'AIRPORT', 'ADVENTURE', 'ANGRY']) {
      const clue = definitionClue(word);
      expect(clue).toBeTruthy();
      expect(clueContainsAnswer(clue!, word)).toBe(false);
    }
  });
});
