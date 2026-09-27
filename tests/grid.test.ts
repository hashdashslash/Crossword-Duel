import { describe, expect, it } from 'vitest';
import { CONFIG, DIFFICULTIES } from '../shared/config.js';
import { assignNumbers } from '../server/grid/numbering.js';
import { generateGamePuzzles } from '../server/grid/puzzles.js';
import type { Grid, PlacedWord } from '../server/grid/types.js';
import { validateGrid, validatePair } from '../server/grid/validate.js';
import { areRelated, loadWordBank } from '../server/words/wordBank.js';

/** Builds a Grid from word placements, for hand-made test cases. */
function makeGrid(rows: number, cols: number, words: Omit<PlacedWord, 'number'>[]): Grid {
  const cells: (string | null)[][] = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const w of words) {
    for (let i = 0; i < w.answer.length; i++) {
      const r = w.direction === 'down' ? w.row + i : w.row;
      const c = w.direction === 'across' ? w.col + i : w.col;
      cells[r]![c] = w.answer[i]!;
    }
  }
  return { rows, cols, cells, words: assignNumbers(words.map((w) => ({ ...w, number: 0 }))) };
}

const loose = { ...CONFIG.grid, minRows: 1, minCols: 1, minDensity: 0, maxEmptySquare: 99, maxAspectRatio: 99, minShareWithTwoCrossings: 0 };

describe('validateGrid', () => {
  it('accepts a simple valid crossing', () => {
    const g = makeGrid(3, 3, [
      { answer: 'CAT', row: 0, col: 0, direction: 'across' },
      { answer: 'CAR', row: 0, col: 0, direction: 'down' },
    ]);
    expect(validateGrid(g, loose, 2).errors).toEqual([]);
  });

  it('catches accidental words formed by side-by-side letters', () => {
    // CAT across on row 0 and DOG across on row 1 sit directly under each other.
    const g = makeGrid(3, 3, [
      { answer: 'CAT', row: 0, col: 0, direction: 'across' },
      { answer: 'DOG', row: 1, col: 0, direction: 'across' },
      { answer: 'CDX', row: 0, col: 0, direction: 'down' },
    ]);
    const { errors } = validateGrid(g, loose, 3);
    expect(errors.some((e) => e.includes('accidental'))).toBe(true);
  });

  it('catches words that are not connected', () => {
    const g = makeGrid(3, 7, [
      { answer: 'CAT', row: 0, col: 0, direction: 'across' },
      { answer: 'DOG', row: 0, col: 4, direction: 'across' },
    ]);
    const { errors } = validateGrid(g, loose, 2);
    expect(errors.some((e) => e.includes('crosses no other word'))).toBe(true);
    expect(errors.some((e) => e.includes('connected'))).toBe(true);
  });

  it('catches a word that runs into another letter', () => {
    // CAT followed directly by an S from a down word makes "CATS" on screen.
    const g = makeGrid(3, 4, [
      { answer: 'CAT', row: 0, col: 0, direction: 'across' },
      { answer: 'SUN', row: 0, col: 3, direction: 'down' },
      { answer: 'COW', row: 0, col: 0, direction: 'down' },
    ]);
    expect(validateGrid(g, loose, 3).ok).toBe(false);
  });

  it('catches wrong clue numbers', () => {
    const g = makeGrid(3, 3, [
      { answer: 'CAT', row: 0, col: 0, direction: 'across' },
      { answer: 'CAR', row: 0, col: 0, direction: 'down' },
    ]);
    g.words[0]!.number = 7;
    expect(validateGrid(g, loose, 2).errors).toContain('clue numbers are wrong');
  });

  it('enforces size limits', () => {
    const g = makeGrid(3, 3, [
      { answer: 'CAT', row: 0, col: 0, direction: 'across' },
      { answer: 'CAR', row: 0, col: 0, direction: 'down' },
    ]);
    const { errors } = validateGrid(g, { ...loose, minRows: 9, minCols: 9 }, 2);
    expect(errors.some((e) => e.includes('too small'))).toBe(true);
  });
});

describe('numbering', () => {
  it('shares a number when across and down start in the same square', () => {
    const words = assignNumbers([
      { answer: 'CAT', row: 0, col: 0, direction: 'across', number: 0 },
      { answer: 'CAR', row: 0, col: 0, direction: 'down', number: 0 },
      { answer: 'TOE', row: 0, col: 2, direction: 'down', number: 0 },
    ]);
    expect(words.map((w) => w.number)).toEqual([1, 1, 2]);
  });
});

describe('word bank', () => {
  const bank = loadWordBank();

  it('has plenty of words at every difficulty', () => {
    for (const d of DIFFICULTIES) expect(bank[d].length).toBeGreaterThan(400);
  });

  it('never repeats a word across difficulties', () => {
    const all = DIFFICULTIES.flatMap((d) => bank[d]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('treats plurals and shared stems as related', () => {
    expect(areRelated('CAT', 'CATS')).toBe(true);
    expect(areRelated('BAKER', 'BAKING')).toBe(true);
    expect(areRelated('CAT', 'DOG')).toBe(false);
  });
});

describe('generateGamePuzzles', () => {
  for (const d of DIFFICULTIES) {
    it(`builds valid, balanced ${d} grids`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const { gridA, gridB } = generateGamePuzzles(d, { seed });
        expect(validateGrid(gridA).errors).toEqual([]);
        expect(validateGrid(gridB).errors).toEqual([]);
        expect(validatePair(gridA, gridB)).toEqual([]);
        const all = [...gridA.words, ...gridB.words].map((w) => w.answer);
        expect(new Set(all).size).toBe(CONFIG.wordsPerGrid * 2);
      }
    });
  }

  it('is reproducible from a seed', () => {
    const a = generateGamePuzzles('medium', { seed: 99 });
    const b = generateGamePuzzles('medium', { seed: 99 });
    expect(a.gridA).toEqual(b.gridA);
    expect(a.gridB).toEqual(b.gridB);
  });
});
