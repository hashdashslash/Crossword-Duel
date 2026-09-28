/**
 * Loads the curated word lists (easy.txt, medium.txt, hard.txt).
 * Each file is plain text: one word per line; lines starting with # are comments.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, DIFFICULTIES, THEMES, type Difficulty, type Theme } from '../../shared/config.js';
import { shuffle, type Rng } from '../grid/rng.js';

const WORDS_DIR = dirname(fileURLToPath(import.meta.url));

export function wordFilePath(difficulty: Difficulty): string {
  return join(WORDS_DIR, `${difficulty}.txt`);
}

export function parseWordFile(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.toUpperCase());
}

export type WordBank = Record<Difficulty, string[]>;

let cached: WordBank | null = null;

export function loadWordBank(): WordBank {
  if (cached) return cached;
  const bank = {} as WordBank;
  for (const d of DIFFICULTIES) {
    const valid = new RegExp(`^[A-Z]{${CONFIG.wordMinLength},${CONFIG.wordMaxLength}}$`);
    bank[d] = [...new Set(parseWordFile(readFileSync(wordFilePath(d), 'utf8')))].filter((w) => valid.test(w));
  }
  cached = bank;
  return bank;
}

export function themeFilePath(theme: Exclude<Theme, 'any'>): string {
  return join(WORDS_DIR, 'themes', `${theme}.txt`);
}

const themeCache = new Map<Theme, string[]>();

/** The words a game draws from: a theme's list, or the difficulty list for 'any'. */
export function wordsFor(difficulty: Difficulty, theme: Theme = 'any'): string[] {
  if (theme === 'any' || !THEMES.includes(theme)) return loadWordBank()[difficulty];
  let words = themeCache.get(theme);
  if (!words) {
    const valid = new RegExp(`^[A-Z]{${CONFIG.wordMinLength},${CONFIG.wordMaxLength}}$`);
    words = [...new Set(parseWordFile(readFileSync(themeFilePath(theme), 'utf8')))].filter((w) => valid.test(w));
    themeCache.set(theme, words);
  }
  return words;
}

/**
 * Two answers are "related" if one contains the other (CAT / CATS / SCATTER)
 * or they share most of a stem (BAKE / BAKER / BAKING). Related words are never
 * used in the same game, so one answer can't give away another.
 */
export function areRelated(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true;
  let prefix = 0;
  while (prefix < a.length && a[prefix] === b[prefix]) prefix++;
  return prefix >= 3 && prefix >= Math.min(a.length, b.length) - 2;
}

/** Draws up to `count` random words, none related to each other or to `exclude`. */
export function drawUnrelated(words: readonly string[], count: number, rng: Rng, exclude: readonly string[] = []): string[] {
  const chosen: string[] = [];
  for (const w of shuffle(words, rng)) {
    if (chosen.length >= count) break;
    if (exclude.some((x) => areRelated(x, w))) continue;
    if (chosen.some((x) => areRelated(x, w))) continue;
    chosen.push(w);
  }
  return chosen;
}
