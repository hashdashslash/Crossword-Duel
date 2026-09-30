/**
 * Builds server/words/fill.txt — the scored word list that fills the big
 * Sunday-size daily grid — from WordNet (Princeton), the word-list package and
 * the game's own curated lists. Re-run after changing the rules below:
 *   npm run words:fill
 *
 * Each line is "WORD score". Higher scores are more familiar words; the grid
 * filler prefers them and only falls back to lower ones when it must.
 *   90  in the game's curated word lists
 *   40–85  WordNet words, by how often they appear in its tagged sample texts
 *   50–75  plurals and verb forms of those words
 *   45–70  common two- and three-word phrases (ICECREAM, HOTDOG)
 *   75  hand-picked short words in server/words/fill-extra.txt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import wordListPath from 'word-list';
import { DIFFICULTIES, THEMES } from '../shared/config.js';
import { ROOT } from '../server/app.js';
import { loadWordBank, wordsFor } from '../server/words/wordBank.js';
import { isBlocked, isCrosswordese } from '../server/words/blocked.js';

const require = createRequire(import.meta.url);
const DICT = join(dirname(require.resolve('wordnet-db/package.json')), 'dict');
const MIN_LEN = 3;
const MAX_LEN = 21;

const dictionary = new Set(readFileSync(wordListPath, 'utf8').split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean));

// How many times each lemma was tagged in WordNet's sample texts (a rough frequency).
const tagCount = new Map<string, number>();
for (const line of readFileSync(join(DICT, 'index.sense'), 'utf8').split('\n')) {
  if (!line) continue;
  const [key, , , count] = line.split(' ');
  const lemma = key!.slice(0, key!.indexOf('%'));
  tagCount.set(lemma, (tagCount.get(lemma) ?? 0) + Number(count));
}

// Lemma → number of senses (all parts of speech), and which parts of speech it has.
const senses = new Map<string, number>();
const partsOfSpeech = new Map<string, Set<string>>();
for (const pos of ['noun', 'verb', 'adj', 'adv']) {
  for (const line of readFileSync(join(DICT, `index.${pos}`), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.split(' ');
    senses.set(f[0]!, (senses.get(f[0]!) ?? 0) + Number(f[2]));
    const key = f[0]!.toUpperCase();
    partsOfSpeech.set(key, (partsOfSpeech.get(key) ?? new Set()).add(pos));
  }
}

const scores = new Map<string, number>();
const offer = (word: string, score: number) => {
  if (word.length < MIN_LEN || word.length > MAX_LEN || !/^[A-Z]+$/.test(word)) return;
  if (isBlocked(word) || isCrosswordese(word)) return;
  if (score > (scores.get(word) ?? 0)) scores.set(word, score);
};

/** Score for a single-word WordNet lemma, or 0 if it is too obscure to use. */
function lemmaScore(lemma: string): number {
  const word = lemma.toUpperCase();
  const tags = tagCount.get(lemma) ?? 0;
  const n = senses.get(lemma) ?? 0;
  const inDict = dictionary.has(word);
  let s = 0;
  if (tags >= 50) s = 85;
  else if (tags >= 15) s = 78;
  else if (tags >= 4) s = 70;
  else if (tags >= 1) s = 62;
  else if (inDict && n >= 2) s = 52;
  else if (inDict) s = 40;
  // Short entries are where junk hides (abbreviations, symbols), so they must be real dictionary words.
  if (word.length <= 4 && !inDict) s = 0;
  if (word.length === 3 && tags < 1 && n < 2) s = 0;
  return s;
}

const base = new Map<string, number>();
for (const lemma of senses.keys()) {
  if (!/^[a-z]+$/.test(lemma)) continue;
  const s = lemmaScore(lemma);
  if (s) {
    base.set(lemma.toUpperCase(), s);
    offer(lemma.toUpperCase(), s);
  }
}

// Inflected forms of good words, when the dictionary has them and they fit the
// base word's part of speech: plurals and -S verbs of nouns and verbs, -ED and
// -ING of verbs only, -ER and -EST of adjectives only. That keeps out invented
// forms like DUED (DUE isn't a verb), WEIRED (a weir is a noun) and INSISTER.
const stems = (w: string): { stem: string; needs: string[] }[] => {
  const out: { stem: string; needs: string[] }[] = [];
  const add = (suffix: string, needs: string[], ...repl: string[]) => {
    if (!w.endsWith(suffix)) return;
    const stem = w.slice(0, -suffix.length);
    for (const r of repl) out.push({ stem: stem + r, needs });
    // STOPPED → STOP, BIGGEST → BIG (never for plurals: RAGGS is not RAG + S).
    if (!needs.includes('noun') && /([B-DF-HJ-NP-TV-Z])\1$/.test(stem)) out.push({ stem: stem.slice(0, -1), needs });
  };
  const plural = ['noun', 'verb'], verb = ['verb'], adj = ['adj'];
  add('S', plural, ''); add('ES', plural, ''); add('IES', plural, 'Y');
  add('ED', verb, '', 'E'); add('D', verb, ''); add('IED', verb, 'Y');
  add('ING', verb, '', 'E');
  add('ER', adj, '', 'E'); add('R', adj, ''); add('IER', adj, 'Y');
  add('EST', adj, '', 'E'); add('ST', adj, ''); add('IEST', adj, 'Y');
  return out;
};
for (const word of dictionary) {
  if (base.has(word) || word.length < 4) continue;
  let best = 0;
  for (const { stem, needs } of stems(word)) {
    if (stem.length >= 3 && needs.some((pos) => partsOfSpeech.get(stem)?.has(pos))) best = Math.max(best, base.get(stem) ?? 0);
  }
  if (best >= 60) offer(word, best - 10);
}

// Multi-word phrases, written solid as crosswords do (ICE CREAM → ICECREAM).
for (const lemma of senses.keys()) {
  const parts = lemma.split('_');
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^[a-z]+$/.test(p))) continue;
  const partScores = parts.map((p) => (p.length <= 2 ? (['a', 'of', 'in', 'on', 'up', 'to', 'at', 'by', 'go', 'do', 'no', 'it', 'me', 'my', 'be', 'or', 'as', 'so', 'we', 'an', 'is'].includes(p) ? 80 : 0) : base.get(p.toUpperCase()) ?? 0));
  const weakest = Math.min(...partScores);
  const tags = tagCount.get(lemma) ?? 0;
  if (tags >= 1 && weakest >= 62) offer(lemma.replace(/_/g, '').toUpperCase(), 70);
  else if (weakest >= 78 && parts.length === 2 && lemma.length <= 11) offer(lemma.replace(/_/g, '').toUpperCase(), 55);
  else if (weakest >= 70 && parts.length === 2 && lemma.length <= 11 && (senses.get(lemma) ?? 0) >= 2) offer(lemma.replace(/_/g, '').toUpperCase(), 45);
}

// Hand-picked extras, then the game's own curated lists.
for (const line of readFileSync(join(ROOT, 'server/words/fill-extra.txt'), 'utf8').split('\n')) {
  if (!line.startsWith('#')) for (const w of line.trim().split(/\s+/)) if (w) offer(w.toUpperCase(), 75);
}
const bank = loadWordBank();
for (const d of DIFFICULTIES) for (const w of bank[d]) offer(w, 90);
for (const t of THEMES) if (t !== 'any') for (const w of wordsFor('medium', t)) offer(w, 90);

const lines = [...scores].sort((a, b) => a[0].localeCompare(b[0])).map(([w, s]) => `${w} ${s}`);
const out = join(ROOT, 'server/words/fill.txt');
writeFileSync(out, `# Generated by scripts/build-fill-words.ts (npm run words:fill). WORD score\n${lines.join('\n')}\n`);

const byLen = new Map<number, number>();
for (const w of scores.keys()) byLen.set(w.length, (byLen.get(w.length) ?? 0) + 1);
console.log(`Wrote ${scores.size} words to ${out}`);
console.log([...byLen].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}:${n}`).join('  '));
