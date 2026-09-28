/**
 * Clues players voted "best clue" in duels, reused as practice clues.
 * Stored as JSON in DATA_DIR (default: ./data). On hosts without a persistent
 * disk (like Render's free plan) the file starts empty after every restart.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanClue, clueContainsAnswer } from '../../shared/rules.js';

/** Keep at most this many clues per word (newest win). */
const MAX_PER_WORD = 20;

type Library = Record<string, string[]>;

let library: Library | null = null;
let writing: Promise<void> = Promise.resolve();

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), 'data');
}

function file(): string {
  return join(dataDir(), 'best-clues.json');
}

function load(): Library {
  if (library) return library;
  try {
    library = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Library) : {};
  } catch (e) {
    console.warn('[clues] could not read the best-clue library, starting empty:', (e as Error).message);
    library = {};
  }
  return library;
}

function save() {
  const snapshot = JSON.stringify(load());
  writing = writing.then(async () => {
    try {
      mkdirSync(dataDir(), { recursive: true });
      await writeFile(file(), snapshot);
    } catch (e) {
      console.warn('[clues] could not save the best-clue library:', (e as Error).message);
    }
  });
}

/** Adds a voted clue. Ignores blanks, clues that give the answer away, and repeats. */
export function addBestClue(answer: string, raw: string) {
  const word = answer.toUpperCase();
  const clue = cleanClue(raw);
  if (!clue || clueContainsAnswer(clue, word)) return;
  const lib = load();
  const list = lib[word] ?? [];
  if (list.some((c) => c.toLowerCase() === clue.toLowerCase())) return;
  lib[word] = [...list, clue].slice(-MAX_PER_WORD);
  save();
}

/** A random player-voted clue for `answer`, or null if there are none. */
export function pickBestClue(answer: string, rng: () => number = Math.random): string | null {
  const list = load()[answer.toUpperCase()];
  if (!list?.length) return null;
  return list[Math.floor(rng() * list.length)]!;
}

/** For tests: forget the in-memory copy so the next call re-reads DATA_DIR. */
export function resetClueLibraryCache() {
  library = null;
}

/** Resolves once pending writes have finished (for tests and shutdown). */
export function clueLibrarySaved(): Promise<void> {
  return writing;
}
