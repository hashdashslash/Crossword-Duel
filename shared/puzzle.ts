/**
 * What a solver's browser is allowed to know about a puzzle.
 * Answers are never included — only the shape, numbers and clues.
 */
export type Direction = 'across' | 'down';

export interface ClueView {
  number: number;
  direction: Direction;
  row: number;
  col: number;
  length: number;
  text: string;
  /** Pre-filled and locked (used later when a clue writer leaves a clue blank). */
  prefilled?: string;
}

export interface PuzzleView {
  id: string;
  rows: number;
  cols: number;
  /** true = white square (holds a letter), false = black square. */
  open: boolean[][];
  clues: ClueView[];
}

/** A cell position as [row, col]. */
export type CellPos = [number, number];

export interface CheckResult {
  solved: boolean;
  blanks: CellPos[];
  wrong: CellPos[];
  /** Server-measured time since the puzzle started. */
  elapsedMs: number;
}
