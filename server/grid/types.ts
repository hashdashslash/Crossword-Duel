export type Direction = 'across' | 'down';

export interface PlacedWord {
  /** Uppercase answer, e.g. "GARDEN". */
  answer: string;
  row: number;
  col: number;
  direction: Direction;
  /** Clue number shown in the grid (assigned after placement). */
  number: number;
}

export interface Grid {
  rows: number;
  cols: number;
  /** cells[row][col] is a letter, or null for a black square. */
  cells: (string | null)[][];
  words: PlacedWord[];
}

export interface GridStats {
  rows: number;
  cols: number;
  area: number;
  letterCells: number;
  density: number;
  totalLetters: number;
  longWords: number;
  crossings: number;
  wordsWithTwoPlusCrossings: number;
  largestEmptySquare: number;
}

export interface GamePuzzles {
  gridA: Grid;
  gridB: Grid;
}
