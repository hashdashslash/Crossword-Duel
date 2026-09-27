import type { Grid } from '../server/grid/types.js';

/** Renders a grid as text: letters, with ■ for black squares. */
export function gridToText(grid: Grid, title = ''): string {
  const lines: string[] = [];
  if (title) lines.push(title);
  lines.push(`${grid.cols} wide × ${grid.rows} tall`);
  for (const row of grid.cells) lines.push('  ' + row.map((c) => c ?? '■').join(' '));
  const byDir = (dir: 'across' | 'down') =>
    grid.words
      .filter((w) => w.direction === dir)
      .sort((a, b) => a.number - b.number)
      .map((w) => `${w.number}. ${w.answer}`)
      .join('   ');
  lines.push(`  Across: ${byDir('across')}`);
  lines.push(`  Down:   ${byDir('down')}`);
  return lines.join('\n');
}
