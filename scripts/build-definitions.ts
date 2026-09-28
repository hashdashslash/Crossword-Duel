/**
 * Builds server/words/definitions.json — short definitions for every word in
 * the word bank — from the WordNet dictionary (Princeton University).
 * Re-run after editing the word lists:
 *   npm run words:define
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { DIFFICULTIES, THEMES } from '../shared/config.js';
import type { Definitions, Sense } from '../server/words/definitions.js';
import { loadWordBank, wordsFor } from '../server/words/wordBank.js';
import { ROOT } from '../server/app.js';

const require = createRequire(import.meta.url);
const DICT = join(dirname(require.resolve('wordnet-db/package.json')), 'dict');

const POS = { noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb' } as const;
type PosFile = keyof typeof POS;

/** lemma → synset offsets (most common sense first), per part of speech. */
function readIndex(pos: PosFile): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of readFileSync(join(DICT, `index.${pos}`), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0]!;
    const synsetCount = Number(f[2]);
    const pointerCount = Number(f[3]);
    const offsets = f.slice(4 + pointerCount + 2, 4 + pointerCount + 2 + synsetCount);
    map.set(lemma, offsets);
  }
  return map;
}

/** Reads the gloss (definition) of a synset at a byte offset in data.<pos>. */
function makeReader(pos: PosFile) {
  const data = readFileSync(join(DICT, `data.${pos}`));
  return (offset: string): string => {
    const start = Number(offset);
    const end = data.indexOf(10, start);
    const line = data.subarray(start, end).toString('utf8');
    const gloss = line.slice(line.indexOf('| ') + 2);
    // Keep the definition; drop the quoted usage examples that follow it.
    return gloss.split(/;\s*"/)[0]!.replace(/\s+/g, ' ').trim();
  };
}

const indexes = Object.fromEntries((Object.keys(POS) as PosFile[]).map((p) => [p, readIndex(p)])) as Record<PosFile, Map<string, string[]>>;
const readers = Object.fromEntries((Object.keys(POS) as PosFile[]).map((p) => [p, makeReader(p)])) as Record<PosFile, (o: string) => string>;

function define(word: string): Sense[] {
  const lemma = word.toLowerCase();
  const found = (Object.keys(POS) as PosFile[])
    .map((p) => ({ p, offsets: indexes[p].get(lemma) ?? [] }))
    .filter((x) => x.offsets.length)
    .sort((a, b) => b.offsets.length - a.offsets.length); // the word's main part of speech first
  const senses: Sense[] = [];
  // Up to two senses from the main part of speech, then one from each other.
  found.forEach(({ p, offsets }, i) => {
    for (const off of offsets.slice(0, i === 0 ? 2 : 1)) {
      const text = readers[p](off);
      if (text && !senses.some((s) => s.text === text)) senses.push({ pos: POS[p], text });
    }
  });
  return senses.slice(0, 3);
}

const bank = loadWordBank();
const out: Definitions = {};
const missing: string[] = [];
const allWords = new Set([...DIFFICULTIES.flatMap((d) => bank[d]), ...THEMES.flatMap((t) => (t === 'any' ? [] : wordsFor('medium', t)))]);
for (const w of allWords) {
  const senses = define(w);
  if (senses.length) out[w] = senses;
  else missing.push(w);
}
const file = join(ROOT, 'server', 'words', 'definitions.json');
writeFileSync(file, JSON.stringify(out) + '\n');
console.log(`Wrote ${Object.keys(out).length} definitions to server/words/definitions.json`);
if (missing.length) console.log(`No WordNet entry for ${missing.length} words (the AI fills these in during games): ${missing.join(', ')}`);
