import { describe, expect, it } from 'vitest';
import type { PuzzleView } from '../shared/puzzle.js';
import {
  arrow, backspace, buildBoard, clickCell, emptyEntries, jumpToClue, nextWord, typeLetter, type Cursor,
} from '../client/src/solve/navigation.js';
import { checkEntries } from '../server/solve/check.js';
import type { Grid } from '../server/grid/types.js';

/*
 * Test puzzle (4 wide × 3 tall):
 *   C A T S          1 Across CATS
 *   O . O .          1 Down COW, 2 Down TOE
 *   W . E .
 */
const puzzle: PuzzleView = {
  id: 't',
  rows: 3,
  cols: 4,
  open: [
    [true, true, true, true],
    [true, false, true, false],
    [true, false, true, false],
  ],
  clues: [
    { number: 1, direction: 'across', row: 0, col: 0, length: 4, text: 'Pets' },
    { number: 1, direction: 'down', row: 0, col: 0, length: 3, text: 'Farm animal' },
    { number: 2, direction: 'down', row: 0, col: 2, length: 3, text: 'Foot digit' },
  ],
};
const board = buildBoard(puzzle);
const at = (row: number, col: number, dir: 'across' | 'down' = 'across'): Cursor => ({ row, col, dir });

describe('navigation', () => {
  it('orders clues Across then Down', () => {
    expect(board.order).toEqual([0, 1, 2]);
  });

  it('typing fills the square and moves forward within the word', () => {
    const { entries, cursor } = typeLetter(board, emptyEntries(board), at(0, 0), 'c');
    expect(entries[0]![0]).toBe('C');
    expect(cursor).toEqual(at(0, 1));
  });

  it('typing at the end of a word stays put', () => {
    const { cursor } = typeLetter(board, emptyEntries(board), at(0, 3), 's');
    expect(cursor).toEqual(at(0, 3));
  });

  it('backspace clears, then steps back', () => {
    let e = emptyEntries(board);
    e[0]![0] = 'C';
    e[0]![1] = 'A';
    let r = backspace(board, e, at(0, 1));
    expect(r.entries[0]![1]).toBe('');
    expect(r.cursor).toEqual(at(0, 1));
    r = backspace(board, r.entries, r.cursor);
    expect(r.entries[0]![0]).toBe('');
    expect(r.cursor).toEqual(at(0, 0));
    e = r.entries;
    expect(backspace(board, e, at(0, 0)).cursor).toEqual(at(0, 0));
  });

  it('clicking the selected square toggles direction when both exist', () => {
    expect(clickCell(board, at(0, 0), 0, 0)).toEqual(at(0, 0, 'down'));
    // (0,1) only has an across word, so it cannot toggle.
    expect(clickCell(board, at(0, 1), 0, 1)).toEqual(at(0, 1));
  });

  it('clicking a new square keeps direction if possible', () => {
    expect(clickCell(board, at(0, 0, 'down'), 1, 2)).toEqual(at(1, 2, 'down'));
    expect(clickCell(board, at(0, 0, 'down'), 0, 3)).toEqual(at(0, 3, 'across'));
    expect(clickCell(board, at(0, 0), 1, 1)).toEqual(at(0, 0)); // black square
  });

  it('arrows turn first, then move, skipping black squares', () => {
    expect(arrow(board, at(0, 0), 'ArrowDown')).toEqual(at(0, 0, 'down'));
    expect(arrow(board, at(0, 0, 'down'), 'ArrowDown')).toEqual(at(1, 0, 'down'));
    expect(arrow(board, at(1, 0, 'down'), 'ArrowRight')).toEqual(at(1, 2, 'down')); // skips black (1,1)
    expect(arrow(board, at(0, 3), 'ArrowRight')).toEqual(at(0, 3));
  });

  it('Tab cycles words and lands on the first empty square', () => {
    const e = emptyEntries(board);
    e[0]![2] = 'T';
    expect(nextWord(board, e, at(0, 0), 1)).toEqual(at(0, 0, 'down'));
    expect(nextWord(board, e, at(0, 0, 'down'), 1)).toEqual(at(1, 2, 'down'));
    expect(nextWord(board, e, at(1, 2, 'down'), 1)).toEqual(at(0, 0));
    expect(nextWord(board, e, at(0, 0), -1)).toEqual(at(1, 2, 'down'));
    expect(jumpToClue(board, e, 2)).toEqual(at(1, 2, 'down'));
  });

  it('never types over or deletes pre-filled squares', () => {
    const locked = buildBoard({ ...puzzle, clues: puzzle.clues.map((c, i) => (i === 1 ? { ...c, prefilled: 'COW' } : c)) });
    const e = emptyEntries(locked);
    expect(e[1]![0]).toBe('O');
    // Typing the locked square's own letter steps over it.
    const same = typeLetter(locked, e, at(0, 0), 'c');
    expect(same.entries[0]![0]).toBe('C');
    expect(same.cursor).toEqual(at(0, 1));
    // Typing a different letter goes into the next open square.
    const other = typeLetter(locked, e, at(0, 0), 'a');
    expect(other.entries[0]![0]).toBe('C');
    expect(other.entries[0]![1]).toBe('A');
    expect(other.cursor).toEqual(at(0, 2));
    expect(backspace(locked, e, at(0, 1)).cursor).toEqual(at(0, 1));
  });
});

describe('checkEntries', () => {
  const grid: Grid = {
    rows: 3,
    cols: 4,
    cells: [
      ['C', 'A', 'T', 'S'],
      ['O', null, 'O', null],
      ['W', null, 'E', null],
    ],
    words: [],
  };

  it('reports blanks and wrong letters separately', () => {
    const entries = [
      ['C', 'A', 'X', ''],
      ['o', '', 'O', ''],
      ['W', '', 'E', ''],
    ];
    expect(checkEntries(grid, entries)).toEqual({ blanks: [[0, 3]], wrong: [[0, 2]] });
  });

  it('treats garbage input as blank', () => {
    expect(checkEntries(grid, 'nope').blanks.length).toBe(8);
  });
});
