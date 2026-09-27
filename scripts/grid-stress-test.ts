/**
 * Generates many games per difficulty and re-checks every grid independently.
 *
 *   npm run grid:stress                 (200 games per difficulty)
 *   npm run grid:stress -- 1000         (1000 games per difficulty)
 *   npm run grid:stress -- 500 hard     (only one difficulty)
 */
import { CONFIG, DIFFICULTIES, type Difficulty } from '../shared/config.js';
import { generateGamePuzzles, GridGenerationError } from '../server/grid/puzzles.js';
import type { Grid } from '../server/grid/types.js';
import { validateGrid, validatePair } from '../server/grid/validate.js';
import { areRelated, loadWordBank } from '../server/words/wordBank.js';
import { gridToText } from './grid-print.js';

const count = Number(process.argv[2] ?? 200);
const only = process.argv[3] as Difficulty | undefined;
const difficulties = only ? [only] : DIFFICULTIES;
const bank = loadWordBank();

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
const tally = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

let anyProblem = false;

for (const difficulty of difficulties) {
  const bankSet = new Set(bank[difficulty]);
  const times: number[] = [];
  const redraws: number[] = [];
  const sizes: string[] = [];
  const densities: number[] = [];
  const twoPlusShare: number[] = [];
  const crossings: number[] = [];
  const wordLengths: number[] = [];
  const areaGaps: number[] = [];
  const letterGaps: number[] = [];
  const problems: string[] = [];
  let failures = 0;
  let sample: Grid | null = null;

  for (let i = 0; i < count; i++) {
    let result;
    try {
      result = generateGamePuzzles(difficulty);
    } catch (e) {
      if (e instanceof GridGenerationError) { failures++; continue; }
      throw e;
    }
    times.push(result.elapsedMs);
    redraws.push(result.redraws);
    sample ??= result.gridA;

    for (const grid of [result.gridA, result.gridB]) {
      const v = validateGrid(grid);
      if (!v.ok) problems.push(`seed ${result.seed}: ${v.errors.join('; ')}`);
      sizes.push(`${v.stats.cols}×${v.stats.rows}`);
      densities.push(v.stats.density);
      twoPlusShare.push(v.stats.wordsWithTwoPlusCrossings / grid.words.length);
      crossings.push(v.stats.crossings);
      for (const w of grid.words) {
        wordLengths.push(w.answer.length);
        if (!bankSet.has(w.answer)) problems.push(`seed ${result.seed}: ${w.answer} is not in the ${difficulty} bank`);
      }
    }
    for (const e of validatePair(result.gridA, result.gridB)) problems.push(`seed ${result.seed}: ${e}`);

    const all = [...result.gridA.words, ...result.gridB.words].map((w) => w.answer);
    if (new Set(all).size !== CONFIG.wordsPerGrid * 2) problems.push(`seed ${result.seed}: not 30 unique words`);
    for (let x = 0; x < all.length; x++) {
      for (let y = x + 1; y < all.length; y++) {
        if (areRelated(all[x]!, all[y]!)) problems.push(`seed ${result.seed}: related words ${all[x]} / ${all[y]}`);
      }
    }

    const sa = validateGrid(result.gridA).stats;
    const sb = validateGrid(result.gridB).stats;
    areaGaps.push(Math.abs(sa.area - sb.area) / Math.max(sa.area, sb.area));
    letterGaps.push(Math.abs(sa.totalLetters - sb.totalLetters) / Math.max(sa.totalLetters, sb.totalLetters));
  }

  const passed = count - failures - new Set(problems.map((p) => p.split(':')[0])).size;
  const passRate = (passed / count) * 100;
  if (passRate < 100) anyProblem = true;

  console.log(`\n══════════ ${difficulty.toUpperCase()} · ${count} games · ${bank[difficulty].length} words in bank ══════════`);
  console.log(`Pass rate:              ${passRate.toFixed(1)}%  (${passed}/${count})`);
  console.log(`Generation failures:    ${failures}`);
  console.log(`Rule violations found:  ${problems.length}`);
  console.log(`Build time (ms):        avg ${avg(times).toFixed(0)} · p95 ${pct(times, 0.95)} · max ${Math.max(0, ...times)}`);
  console.log(`Word redraws needed:    avg ${avg(redraws).toFixed(2)} · max ${Math.max(0, ...redraws)}`);
  console.log(`Grid sizes (wide×tall): ${tally(sizes).slice(0, 8).map(([s, n]) => `${s} (${n})`).join(', ')}`);
  console.log(`Density (letters):      avg ${(avg(densities) * 100).toFixed(0)}% · min ${(Math.min(1, ...densities) * 100).toFixed(0)}%`);
  console.log(`Crossings per grid:     avg ${avg(crossings).toFixed(1)} · min ${Math.min(Infinity, ...crossings)}`);
  console.log(`Words crossing 2+:      avg ${(avg(twoPlusShare) * 100).toFixed(0)}% · min ${(Math.min(1, ...twoPlusShare) * 100).toFixed(0)}%`);
  console.log(`Answer length:          avg ${avg(wordLengths).toFixed(1)} · ${tally(wordLengths.map(String)).sort((a, b) => +a[0] - +b[0]).map(([l, n]) => `${l}:${n}`).join(' ')}`);
  console.log(`A vs B size gap:        avg ${(avg(areaGaps) * 100).toFixed(0)}% · max ${(Math.max(0, ...areaGaps) * 100).toFixed(0)}%`);
  console.log(`A vs B letter gap:      avg ${(avg(letterGaps) * 100).toFixed(0)}% · max ${(Math.max(0, ...letterGaps) * 100).toFixed(0)}%`);
  for (const p of problems.slice(0, 10)) console.log(`  ✗ ${p}`);
  if (sample) console.log('\nSample grid:\n' + gridToText(sample));
}

console.log(anyProblem ? '\nRESULT: problems found (see above).\n' : '\nRESULT: every grid passed every check.\n');
process.exit(anyProblem ? 1 : 0);
