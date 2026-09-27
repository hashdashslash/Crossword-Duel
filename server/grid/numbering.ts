import type { PlacedWord } from './types.js';

/**
 * Standard crossword numbering: scan left-to-right, top-to-bottom and give each
 * starting square the next number. An across and a down word that start in the
 * same square share a number.
 */
export function assignNumbers(words: PlacedWord[]): PlacedWord[] {
  const starts = [...new Set(words.map((w) => w.row * 10_000 + w.col))].sort((a, b) => a - b);
  const numberAt = new Map(starts.map((key, i) => [key, i + 1]));
  return words.map((w) => ({ ...w, number: numberAt.get(w.row * 10_000 + w.col)! }));
}
