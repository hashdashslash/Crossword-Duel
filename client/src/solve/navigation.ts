/**
 * Pure crossword-navigation logic: which word a square belongs to, where the
 * cursor goes after typing, backspace, arrows, clicks and Tab. No React here.
 */
import type { CellPos, ClueView, Direction, PuzzleView } from '../../../shared/puzzle';

export interface Cursor {
  row: number;
  col: number;
  dir: Direction;
}

export interface Board {
  rows: number;
  cols: number;
  open: boolean[][];
  clues: ClueView[];
  /** For each square, the index (into clues) of its across and down word. */
  wordAt: { across?: number; down?: number }[][];
  /** Squares that are pre-filled and cannot be typed over. */
  locked: boolean[][];
  /** Clues in play order: all Across by number, then all Down by number. */
  order: number[];
}

export type Entries = string[][];

const delta = (dir: Direction): [number, number] => (dir === 'across' ? [0, 1] : [1, 0]);
const other = (dir: Direction): Direction => (dir === 'across' ? 'down' : 'across');

export function clueCells(clue: ClueView): CellPos[] {
  const [dr, dc] = delta(clue.direction);
  return Array.from({ length: clue.length }, (_, i) => [clue.row + dr * i, clue.col + dc * i] as CellPos);
}

export function buildBoard(p: PuzzleView): Board {
  const wordAt: Board['wordAt'] = p.open.map((row) => row.map(() => ({})));
  const locked = p.open.map((row) => row.map(() => false));
  p.clues.forEach((clue, i) => {
    clueCells(clue).forEach(([r, c]) => {
      wordAt[r]![c]![clue.direction] = i;
      if (clue.prefilled) locked[r]![c] = true;
    });
  });
  const byNumber = (dir: Direction) =>
    p.clues.map((c, i) => ({ c, i })).filter(({ c }) => c.direction === dir).sort((a, b) => a.c.number - b.c.number).map(({ i }) => i);
  return { rows: p.rows, cols: p.cols, open: p.open, clues: p.clues, wordAt, locked, order: [...byNumber('across'), ...byNumber('down')] };
}

export function emptyEntries(board: Board): Entries {
  return board.open.map((row, r) =>
    row.map((_, c) => {
      const at = board.wordAt[r]![c]!;
      for (const idx of [at.across, at.down]) {
        const clue = idx === undefined ? undefined : board.clues[idx];
        if (clue?.prefilled) {
          const [dr, dc] = delta(clue.direction);
          const i = dr ? r - clue.row : c - clue.col;
          return clue.prefilled[i] ?? '';
        }
      }
      return '';
    }),
  );
}

export function activeClueIndex(board: Board, cur: Cursor): number | undefined {
  return board.wordAt[cur.row]?.[cur.col]?.[cur.dir];
}

/** The direction to use at a square: keep `preferred` if a word runs that way there. */
function dirAt(board: Board, row: number, col: number, preferred: Direction): Direction {
  return board.wordAt[row]![col]![preferred] !== undefined ? preferred : other(preferred);
}

export function firstCursor(board: Board): Cursor {
  const clue = board.clues[board.order[0]!]!;
  return { row: clue.row, col: clue.col, dir: clue.direction };
}

/** Clicking a square: select it, or toggle direction if it is already selected. */
export function clickCell(board: Board, cur: Cursor, row: number, col: number): Cursor {
  if (!board.open[row]?.[col]) return cur;
  if (cur.row === row && cur.col === col) {
    const flipped = other(cur.dir);
    return board.wordAt[row]![col]![flipped] !== undefined ? { ...cur, dir: flipped } : cur;
  }
  return { row, col, dir: dirAt(board, row, col, cur.dir) };
}

export function toggleDirection(board: Board, cur: Cursor): Cursor {
  return clickCell(board, cur, cur.row, cur.col);
}

/** Moves to a clue: its first empty (unlocked) square, or its first square if full. */
export function jumpToClue(board: Board, entries: Entries, clueIdx: number): Cursor {
  const clue = board.clues[clueIdx]!;
  const cells = clueCells(clue);
  const target = cells.find(([r, c]) => !entries[r]![c] && !board.locked[r]![c]) ?? cells.find(([r, c]) => !board.locked[r]![c]) ?? cells[0]!;
  return { row: target[0], col: target[1], dir: clue.direction };
}

/** Tab / Shift+Tab: next or previous word in clue order. */
export function nextWord(board: Board, entries: Entries, cur: Cursor, step: 1 | -1): Cursor {
  const idx = activeClueIndex(board, cur);
  const pos = idx === undefined ? -1 : board.order.indexOf(idx);
  const n = board.order.length;
  const nextPos = (((pos + step) % n) + n) % n;
  return jumpToClue(board, entries, board.order[nextPos]!);
}

/** Types a letter at the cursor and advances within the current word. */
export function typeLetter(board: Board, entries: Entries, cur: Cursor, letter: string): { entries: Entries; cursor: Cursor } {
  let next = entries;
  if (!board.locked[cur.row]![cur.col]) {
    next = entries.map((row) => [...row]);
    next[cur.row]![cur.col] = letter.toUpperCase();
  }
  const idx = activeClueIndex(board, cur);
  if (idx === undefined) return { entries: next, cursor: cur };
  const cells = clueCells(board.clues[idx]!);
  const here = cells.findIndex(([r, c]) => r === cur.row && c === cur.col);
  const after = cells.slice(here + 1).find(([r, c]) => !board.locked[r]![c]);
  return { entries: next, cursor: after ? { ...cur, row: after[0], col: after[1] } : cur };
}

/**
 * Backspace: clear the current square; if it was already empty, step back
 * one square in the word and clear that instead.
 */
export function backspace(board: Board, entries: Entries, cur: Cursor): { entries: Entries; cursor: Cursor } {
  const next = entries.map((row) => [...row]);
  if (entries[cur.row]![cur.col] && !board.locked[cur.row]![cur.col]) {
    next[cur.row]![cur.col] = '';
    return { entries: next, cursor: cur };
  }
  const idx = activeClueIndex(board, cur);
  if (idx === undefined) return { entries, cursor: cur };
  const cells = clueCells(board.clues[idx]!);
  const here = cells.findIndex(([r, c]) => r === cur.row && c === cur.col);
  const before = cells.slice(0, here).reverse().find(([r, c]) => !board.locked[r]![c]);
  if (!before) return { entries, cursor: cur };
  next[before[0]]![before[1]] = '';
  return { entries: next, cursor: { ...cur, row: before[0], col: before[1] } };
}

export type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * Arrow keys: pressing across the current direction first turns the cursor;
 * otherwise it moves to the next white square that way, skipping black ones.
 */
export function arrow(board: Board, cur: Cursor, key: Arrow): Cursor {
  const dir: Direction = key === 'ArrowLeft' || key === 'ArrowRight' ? 'across' : 'down';
  if (cur.dir !== dir && board.wordAt[cur.row]![cur.col]![dir] !== undefined) return { ...cur, dir };
  const [dr, dc] = key === 'ArrowUp' ? [-1, 0] : key === 'ArrowDown' ? [1, 0] : key === 'ArrowLeft' ? [0, -1] : [0, 1];
  let r = cur.row + dr;
  let c = cur.col + dc;
  while (r >= 0 && c >= 0 && r < board.rows && c < board.cols) {
    if (board.open[r]![c]) return { row: r, col: c, dir: dirAt(board, r, c, dir) };
    r += dr;
    c += dc;
  }
  return cur;
}

export function isWordFilled(entries: Entries, clue: ClueView): boolean {
  return clueCells(clue).every(([r, c]) => !!entries[r]![c]);
}
