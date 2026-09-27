/**
 * Checks the word bank files after you edit them.
 *   npm run words:check
 *
 * Errors (must fix): bad characters or length, a word listed twice, a word in
 * two difficulty files, or a word not found in a standard English dictionary
 * (usually a typo, a proper noun, or an abbreviation).
 */
import { readFileSync } from 'node:fs';
import wordListPath from 'word-list';
import { CONFIG, DIFFICULTIES, type Difficulty } from '../shared/config.js';
import { parseWordFile, wordFilePath } from '../server/words/wordBank.js';

const dictionary = new Set(readFileSync(wordListPath, 'utf8').split('\n').map((w) => w.trim().toUpperCase()));
const valid = new RegExp(`^[A-Z]{${CONFIG.wordMinLength},${CONFIG.wordMaxLength}}$`);
const owner = new Map<string, Difficulty>();
let errors = 0;

for (const d of DIFFICULTIES) {
  const words = parseWordFile(readFileSync(wordFilePath(d), 'utf8'));
  const seen = new Set<string>();
  const lengths = new Map<number, number>();
  const problems: string[] = [];

  for (const w of words) {
    if (!valid.test(w)) problems.push(`"${w}" must be ${CONFIG.wordMinLength}-${CONFIG.wordMaxLength} letters A-Z`);
    else if (!dictionary.has(w)) problems.push(`"${w}" is not in the dictionary`);
    if (seen.has(w)) problems.push(`"${w}" is listed twice`);
    const other = owner.get(w);
    if (other && other !== d) problems.push(`"${w}" is also in ${other}.txt`);
    seen.add(w);
    owner.set(w, d);
    lengths.set(w.length, (lengths.get(w.length) ?? 0) + 1);
  }

  const mix = [...lengths].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}:${n}`).join(' ');
  console.log(`${d.padEnd(6)} ${String(seen.size).padStart(4)} words   lengths ${mix}`);
  for (const p of problems) console.log(`   ✗ ${p}`);
  errors += problems.length;
}

console.log(errors ? `\n${errors} problem(s) found.` : '\nAll word lists look good.');
process.exit(errors ? 1 : 0);
