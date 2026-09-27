import type { CellPos } from '../../shared/puzzle.js';
import type { Grid } from '../grid/types.js';

/** Compares a player's entries with the answer grid. Entries are single letters or ''. */
export function checkEntries(grid: Grid, entries: unknown): { blanks: CellPos[]; wrong: CellPos[] } {
  const blanks: CellPos[] = [];
  const wrong: CellPos[] = [];
  const rows = Array.isArray(entries) ? entries : [];
  for (let r = 0; r < grid.rows; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    for (let c = 0; c < grid.cols; c++) {
      const answer = grid.cells[r]![c];
      if (answer === null || answer === undefined) continue;
      const raw = row[c];
      const letter = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!letter) blanks.push([r, c]);
      else if (letter !== answer) wrong.push([r, c]);
    }
  }
  return { blanks, wrong };
}
