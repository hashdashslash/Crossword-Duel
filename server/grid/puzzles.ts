/**
 * Builds the two puzzles for a game: Grid A and Grid B, 15 words each,
 * no shared or related words, similar size and word-length mix.
 */
import { CONFIG, type Difficulty } from '../../shared/config.js';
import { loadWordBank, drawUnrelated, type WordBank } from '../words/wordBank.js';
import { buildValidGrids, type ScoredGrid } from './generator.js';
import { createRng, randomSeed, type Rng } from './rng.js';
import type { GamePuzzles, Grid } from './types.js';
import { validatePair } from './validate.js';

export interface GenerateResult extends GamePuzzles {
  seed: number;
  /** How many times the word pools had to be redrawn (0 = first try). */
  redraws: number;
  elapsedMs: number;
}

export class GridGenerationError extends Error {}

/** Deal words into two pools with matching length mixes (longest first, alternating). */
function splitPools(words: string[]): [string[], string[]] {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const a: string[] = [];
  const b: string[] = [];
  sorted.forEach((w, i) => ((i % 4 === 0 || i % 4 === 3) ? a : b).push(w));
  return [a, b];
}

function bestBalancedPair(as: ScoredGrid[], bs: ScoredGrid[]): [ScoredGrid, ScoredGrid] | null {
  let best: [ScoredGrid, ScoredGrid] | null = null;
  let bestScore = -Infinity;
  for (const a of as) {
    for (const b of bs) {
      const score = a.quality + b.quality - Math.abs(a.stats.area - b.stats.area) * 0.5;
      if (score <= bestScore) continue;
      if (validatePair(a.grid, b.grid).length) continue;
      best = [a, b];
      bestScore = score;
    }
  }
  return best;
}

export function generateGamePuzzles(
  difficulty: Difficulty,
  options: { seed?: number; bank?: WordBank } = {},
): GenerateResult {
  const started = Date.now();
  const seed = options.seed ?? randomSeed();
  const rng: Rng = createRng(seed);
  const words = (options.bank ?? loadWordBank())[difficulty];

  for (let redraw = 0; redraw < CONFIG.grid.maxWordRedraws; redraw++) {
    const pool = drawUnrelated(words, CONFIG.candidatePoolPerGrid * 2, rng);
    if (pool.length < CONFIG.candidatePoolPerGrid * 2) {
      throw new GridGenerationError(`Not enough unrelated ${difficulty} words in the bank`);
    }
    const [poolA, poolB] = splitPools(pool);
    const gridsA = buildValidGrids(poolA, rng);
    if (!gridsA.length) continue;
    const gridsB = buildValidGrids(poolB, rng);
    if (!gridsB.length) continue;
    const pair = bestBalancedPair(gridsA, gridsB);
    if (!pair) continue;
    return { gridA: pair[0].grid, gridB: pair[1].grid, seed, redraws: redraw, elapsedMs: Date.now() - started };
  }
  throw new GridGenerationError(`Could not build balanced ${difficulty} grids (seed ${seed})`);
}

/** Builds one stand-alone grid (used for single-player practice). */
export function generateSingleGrid(difficulty: Difficulty, options: { seed?: number; bank?: WordBank } = {}): Grid {
  const seed = options.seed ?? randomSeed();
  const rng = createRng(seed);
  const words = (options.bank ?? loadWordBank())[difficulty];
  for (let redraw = 0; redraw < CONFIG.grid.maxWordRedraws; redraw++) {
    const grids = buildValidGrids(drawUnrelated(words, CONFIG.candidatePoolPerGrid, rng), rng);
    if (grids.length) return grids[0]!.grid;
  }
  throw new GridGenerationError(`Could not build a ${difficulty} grid (seed ${seed})`);
}
