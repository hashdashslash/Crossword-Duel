/**
 * Builds one game's pair of grids and prints them.
 *   npm run grid:demo                    (medium, random)
 *   npm run grid:demo -- hard            (pick a difficulty)
 *   npm run grid:demo -- easy 12345      (difficulty + seed, to reproduce a game)
 */
import { DIFFICULTIES, type Difficulty } from '../shared/config.js';
import { generateGamePuzzles } from '../server/grid/puzzles.js';
import { gridToText } from './grid-print.js';

const difficulty = (process.argv[2] ?? 'medium') as Difficulty;
if (!DIFFICULTIES.includes(difficulty)) {
  console.error(`Difficulty must be one of: ${DIFFICULTIES.join(', ')}`);
  process.exit(1);
}
const seedArg = process.argv[3];
const result = generateGamePuzzles(difficulty, { seed: seedArg ? Number(seedArg) : undefined });

console.log(`\n${difficulty.toUpperCase()} game · seed ${result.seed} · built in ${result.elapsedMs} ms\n`);
console.log(gridToText(result.gridA, 'GRID A (Player 1 writes clues, Player 2 solves)'));
console.log();
console.log(gridToText(result.gridB, 'GRID B (Player 2 writes clues, Player 1 solves)'));
console.log();
