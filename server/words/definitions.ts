/**
 * Short word definitions, shown to a player while they write a clue.
 * Definitions come from WordNet 3.1 (Princeton University; see
 * server/words/DEFINITIONS-LICENSE.txt), built by `npm run words:define`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Sense {
  pos: string;
  text: string;
}

export type Definitions = Record<string, Sense[]>;

let cache: Definitions | null = null;

export function loadDefinitions(): Definitions {
  if (cache) return cache;
  const file = join(dirname(fileURLToPath(import.meta.url)), 'definitions.json');
  cache = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Definitions) : {};
  return cache;
}

export function lookupDefinition(word: string): Sense[] | null {
  return loadDefinitions()[word.toUpperCase()] ?? null;
}
