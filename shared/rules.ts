/** Rules shared by the browser and the server, so both enforce them identically. */
import { CONFIG } from './config.js';

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

export function validateName(raw: unknown): NameCheck {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (name.length < CONFIG.nameMinLength) return { ok: false, error: 'Please enter a name.' };
  if (name.length > CONFIG.nameMaxLength) return { ok: false, error: `Names can be up to ${CONFIG.nameMaxLength} characters.` };
  return { ok: true, name };
}

/** Trims a clue and enforces the character limit. */
export function cleanClue(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim().slice(0, CONFIG.clueCharLimit);
}

/** Letters-only words in a clue. Runs of single letters ("G A R D E N", "G-A-R-D-E-N") are joined. */
function clueTokens(clue: string): string[] {
  const raw = clue.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const out: string[] = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1) { run += t; continue; }
    if (run) { out.push(run); run = ''; }
    out.push(t);
  }
  if (run) out.push(run);
  // Also keep the joined single-letter run alongside neighbours, e.g. "GAR DEN".
  for (let i = 0; i < raw.length - 1; i++) out.push(raw[i]! + raw[i + 1]!);
  return out;
}

/**
 * True if the clue contains the answer or an obvious form of it
 * (case-insensitive): plurals, -ed/-ing/-er endings, spelled-out letters.
 */
export function clueContainsAnswer(clue: string, answer: string): boolean {
  const a = answer.toUpperCase();
  const variants = new Set([a]);
  if (a.endsWith('E')) variants.add(a.slice(0, -1) + 'ING');
  if (a.endsWith('Y')) variants.add(a.slice(0, -1) + 'I');
  const last = a[a.length - 1]!;
  if (/[^AEIOUWXY]/.test(last)) for (const end of ['ING', 'ER', 'ED']) variants.add(a + last + end);
  return clueTokens(clue).some((token) => {
    for (const v of variants) {
      if (token === v) return true;
      if (token.startsWith(v) && token.length - v.length <= 3) return true;
    }
    return false;
  });
}
