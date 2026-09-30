/**
 * Sunday-size grids for the daily puzzle: 21×21, black squares placed with
 * rotational symmetry like a newspaper crossword, every white square in both
 * an across and a down word, and every answer 3+ letters.
 *
 * How it works:
 *  1. Pattern: start with an all-white grid and add symmetric pairs of black
 *     squares: first to break up over-long answers and stacks of long answers
 *     (which are very hard to fill), then anywhere legal until the word count
 *     reaches the target range, then at word ends to shorten long answers.
 *  2. Fill: a backtracking search over the slots. Each slot keeps the words
 *     that still fit and each square the letters that still fit, and every
 *     choice narrows its neighbours (constraint propagation). It fills the
 *     slot with the fewest options first (favouring slots that caused trouble
 *     before), tries familiar words that leave the crossings the most room,
 *     and restarts with fresh randomness if a search runs too long.
 *  3. If a region won't fill, add a black square there and try again, as a
 *     human constructor would.
 *  4. Polish: swap obscure answers for familiar ones where the grid allows.
 *
 * This is too slow for the server (minutes per grid), so the daily grids are
 * built ahead of time by scripts/build-daily-grids.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignNumbers } from './numbering.js';
import { createRng, shuffle, type Rng } from './rng.js';
import type { Direction, Grid } from './types.js';

export interface SundayOptions {
  size: number;
  minWords: number;
  maxWords: number;
  /** Longest allowed answer. */
  maxLength: number;
  /** At most this many answers longer than `longAt` letters. */
  maxLong: number;
  longAt: number;
  /** No all-white square block bigger than this (big open areas are very hard to fill). */
  maxOpenSquare: number;
}

export const SUNDAY: SundayOptions = {
  size: 21, minWords: 120, maxWords: 140, maxLength: 15, maxLong: 8, longAt: 9, maxOpenSquare: 5,
};

// ── Pattern ─────────────────────────────────────────────────

/** Patterns leave this many words of room under the limit, for black squares the filler adds. */
const SPLIT_ROOM = 8;
/** No three answers of STACK_LEN+ letters side by side (overlapping by STACK_OVERLAP+), and no two of LONG_STACK+. */
const STACK_LEN = 7;
const STACK_OVERLAP = 5;
const LONG_STACK = 9;

/** true = black square. */
export type Pattern = boolean[][];

interface Run { dir: Direction; row: number; col: number; len: number }

export function runsOf(p: Pattern): Run[] {
  const n = p.length;
  const out: Run[] = [];
  for (const dir of ['across', 'down'] as const) {
    for (let a = 0; a < n; a++) {
      let start = -1;
      for (let b = 0; b <= n; b++) {
        const black = b === n || (dir === 'across' ? p[a]![b] : p[b]![a]);
        if (!black && start < 0) start = b;
        if (black && start >= 0) {
          out.push(dir === 'across' ? { dir, row: a, col: start, len: b - start } : { dir, row: start, col: a, len: b - start });
          start = -1;
        }
      }
    }
  }
  return out;
}

function connected(p: Pattern): boolean {
  const n = p.length;
  let start: [number, number] | null = null;
  let whites = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!p[r]![c]) { whites++; start ??= [r, c]; }
  if (!start) return false;
  const seen = new Set<number>([start[0] * n + start[1]]);
  const stack = [start];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n || p[rr]![cc] || seen.has(rr * n + cc)) continue;
      seen.add(rr * n + cc);
      stack.push([rr, cc]);
    }
  }
  return seen.size === whites;
}

/** Word runs through (r, c) in both directions must be 0 or 3+ long. */
function shortRunNear(p: Pattern, r: number, c: number): boolean {
  const n = p.length;
  const runLen = (r0: number, c0: number, dr: number, dc: number) => {
    if (r0 < 0 || c0 < 0 || r0 >= n || c0 >= n || p[r0]![c0]) return 0;
    let a = 0;
    while (r0 - dr * (a + 1) >= 0 && c0 - dc * (a + 1) >= 0 && !p[r0 - dr * (a + 1)]![c0 - dc * (a + 1)]) a++;
    let b = 0;
    while (r0 + dr * (b + 1) < n && c0 + dc * (b + 1) < n && !p[r0 + dr * (b + 1)]![c0 + dc * (b + 1)]) b++;
    return a + b + 1;
  };
  for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
    // The runs on either side of the new black square, along this direction.
    for (const s of [-1, 1]) {
      const len = runLen(r + dr * s, c + dc * s, dr, dc);
      if (len > 0 && len < 3) return true;
    }
  }
  return false;
}

function isLegal(p: Pattern): boolean {
  const runs = runsOf(p);
  if (runs.some((r) => r.len < 3)) return false;
  return connected(p);
}

function setPair(p: Pattern, r: number, c: number, black: boolean) {
  const n = p.length;
  p[r]![c] = black;
  p[n - 1 - r]![n - 1 - c] = black;
}

/** Builds a symmetric black-square pattern, or null if this attempt got stuck. */
export function buildPattern(rng: Rng, opts: SundayOptions = SUNDAY): Pattern | null {
  const n = opts.size;
  const p: Pattern = Array.from({ length: n }, () => new Array(n).fill(false));
  const tryBlack = (r: number, c: number): boolean => {
    if (p[r]![c]) return false;
    setPair(p, r, c, true);
    if (shortRunNear(p, r, c) || shortRunNear(p, n - 1 - r, n - 1 - c) || !connected(p)) {
      setPair(p, r, c, false);
      return false;
    }
    return true;
  };
  const k = opts.maxOpenSquare + 1;
  /** Cells inside an all-white k×k block (the top-left corner of each block's middle). */
  const openBlocks = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r + k <= n; r++) {
      for (let c = 0; c + k <= n; c++) {
        let open = true;
        for (let i = 0; i < k && open; i++) for (let j = 0; j < k && open; j++) if (p[r + i]![c + j]) open = false;
        if (open) out.push([r + 1 + Math.floor(rng() * (k - 2)), c + 1 + Math.floor(rng() * (k - 2))]);
      }
    }
    return out;
  };
  const tooLong = () => {
    const runs = runsOf(p);
    const over = runs.filter((r) => r.len > opts.maxLength);
    if (over.length) return over;
    const long = runs.filter((r) => r.len > opts.longAt);
    if (long.length > opts.maxLong) return long;
    // Long answers side by side (stacks) cross only each other's letters, which our
    // word list can rarely fill: no three medium-long answers stacked, and no two long ones.
    const stacked: Run[] = [];
    const big = runs.filter((r) => r.len >= STACK_LEN);
    const line = (r: Run) => (r.dir === 'across' ? [r.row, r.col] : [r.col, r.row]) as [number, number];
    const overlap = (a: Run, b: Run) => {
      const [, as] = line(a);
      const [, bs] = line(b);
      return Math.min(as + a.len, bs + b.len) - Math.max(as, bs);
    };
    const neighbour = (a: Run, d: number) => big.find((b) => b.dir === a.dir && line(b)[0] === line(a)[0] + d && overlap(a, b) >= STACK_OVERLAP);
    for (const a of big) {
      const up = neighbour(a, -1);
      const down = neighbour(a, 1);
      if (up && down) stacked.push(a);
      else if (down && a.len >= LONG_STACK && down.len >= LONG_STACK) stacked.push(rng() < 0.5 ? a : down);
    }
    return stacked;
  };

  // 1. Break up runs that are too long.
  for (let guard = 0; guard < 2000; guard++) {
    const over = tooLong();
    if (!over.length) break;
    const run = over[Math.floor(rng() * over.length)]!;
    // Split it (leaving 3+ letters each side) or trim one end.
    const spots = [0, run.len - 1];
    for (let i = 3; i <= run.len - 4; i++) spots.push(i);
    const i = spots[Math.floor(rng() * spots.length)]!;
    const [r, c] = run.dir === 'across' ? [run.row, run.col + i] : [run.row + i, run.col];
    tryBlack(r, c);
  }
  if (tooLong().length) return null;
  for (let guard = 0; guard < 2000; guard++) {
    const open = openBlocks();
    if (!open.length) break;
    const [r, c] = open[Math.floor(rng() * open.length)]!;
    tryBlack(r, c);
  }
  if (openBlocks().length || tooLong().length) return null;

  // 2. Add blacks until the word count reaches the low end of the range (the filler may add more later).
  const target = opts.minWords + Math.floor(rng() * 6);
  const cells = shuffle(Array.from({ length: n * n }, (_, i) => i), rng);
  for (const i of cells) {
    if (runsOf(p).length >= target) break;
    const r = Math.floor(i / n);
    const c = i % n;
    // Keep blacks away from other blacks' corners to avoid ugly clumps.
    const blackNeighbours = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dr, dc]) => p[r + dr!]?.[c + dc!]).length;
    if (blackNeighbours > 1) continue;
    tryBlack(r, c);
  }
  // 3. Trim long answers by adding black squares at word ends, which shortens
  //    words without adding more (real Sunday grids have ~75+ black squares).
  const targetBlacks = 76 + Math.floor(rng() * 6);
  const blacks = () => p.flat().filter(Boolean).length;
  for (let guard = 0; guard < 400 && blacks() < targetBlacks; guard++) {
    const runs = runsOf(p);
    const lenAt = new Map<number, number>();
    for (const run of runs) {
      for (let i = 0; i < run.len; i++) {
        const k = run.dir === 'across' ? run.row * n + run.col + i : (run.row + i) * n + run.col;
        lenAt.set(k, (lenAt.get(k) ?? 0) + run.len);
      }
    }
    // Squares next to a black square or the edge, in the longest words.
    const ends = [...lenAt].filter(([k]) => {
      const r = Math.floor(k / n);
      const c = k % n;
      return [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dr, dc]) => { const rr = r + dr!; const cc = c + dc!; return rr < 0 || cc < 0 || rr >= n || cc >= n || p[rr]![cc]; });
    }).sort((a, b) => b[1] - a[1] + (rng() - 0.5) * 6);
    let placed = false;
    for (const [k] of ends.slice(0, 12)) {
      const r = Math.floor(k / n);
      const c = k % n;
      if (!tryBlack(r, c)) continue;
      // Leave room under the word limit for the filler to add black squares later.
      if (runsOf(p).length > opts.maxWords - SPLIT_ROOM) { setPair(p, r, c, false); continue; }
      placed = true;
      break;
    }
    if (!placed) break;
  }

  if (tooLong().length) return null;
  const words = runsOf(p).length;
  if (words < opts.minWords || words > opts.maxWords || !isLegal(p)) return null;
  return p;
}

/** Rebuilds a grid from its rows ("#" = black square), numbering the words. */
export function gridFromRows(rows: string[]): Grid {
  const n = rows.length;
  const pattern: Pattern = rows.map((r) => [...r].map((ch) => ch === '#'));
  const cells = rows.map((r) => [...r].map((ch) => (ch === '#' ? null : ch)));
  const words = assignNumbers(runsOf(pattern).map((run) => ({
    answer: Array.from({ length: run.len }, (_, i) => (run.dir === 'across' ? cells[run.row]![run.col + i] : cells[run.row + i]![run.col])).join(''),
    row: run.row, col: run.col, direction: run.dir, number: 0,
  })));
  words.sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === 'across' ? -1 : 1));
  return { rows: n, cols: rows[0]!.length, cells, words };
}

/** The grid as one line of text (rows joined by "/"), for the daily grid library. */
export function gridToLine(grid: Grid): string {
  return grid.cells.map((r) => r.map((c) => c ?? '#').join('')).join('/');
}

// ── Word list ───────────────────────────────────────────────

export interface FillWord { word: string; score: number }

const FILL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'words', 'fill.txt');
let fillCache: FillWord[] | null = null;

export function loadFillWords(): FillWord[] {
  if (fillCache) return fillCache;
  fillCache = readFileSync(FILL_PATH, 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => { const [word, score] = l.split(' '); return { word: word!, score: Number(score) }; });
  return fillCache;
}

/** Words of one length, with a bitset per (position, letter) for fast pattern matching. */
class LengthIndex {
  readonly words: string[];
  readonly scores: number[];
  readonly blocks: number;
  /** bits[pos * 26 + letter] */
  readonly bits: Uint32Array[];
  readonly all: Uint32Array;

  constructor(entries: FillWord[], readonly len: number) {
    this.words = entries.map((e) => e.word);
    this.scores = entries.map((e) => e.score);
    this.blocks = Math.ceil(entries.length / 32);
    this.bits = Array.from({ length: len * 26 }, () => new Uint32Array(this.blocks));
    this.all = new Uint32Array(this.blocks);
    entries.forEach((e, i) => {
      this.all[i >>> 5]! |= 1 << (i & 31);
      for (let p = 0; p < len; p++) this.bits[p * 26 + e.word.charCodeAt(p) - 65]![i >>> 5]! |= 1 << (i & 31);
    });
  }

}

function popcount(bits: Uint32Array, cap = Infinity): number {
  let n = 0;
  for (let k = 0; k < bits.length && n < cap; k++) {
    let v = bits[k]!;
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}

function popcount32(v: number): number {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function* members(bits: Uint32Array): Generator<number> {
  for (let k = 0; k < bits.length; k++) {
    let v = bits[k]!;
    while (v) {
      const low = v & -v;
      yield k * 32 + (31 - Math.clz32(low));
      v ^= low;
    }
  }
}

// ── Fill ────────────────────────────────────────────────────

interface Slot {
  dir: Direction;
  row: number;
  col: number;
  len: number;
  cells: number[]; // cell ids (r * n + c)
  /** For each position: the crossing slot. */
  cross: number[];
}

export interface FillOptions {
  /** Ignore words scoring below this. */
  minScore: number;
  /** Give up on one search after this many guesses (then restart). */
  maxSteps: number;
  restarts: number;
  /** Try at most this many words per slot before backing up. */
  branching: number;
  /** How many candidate words to test (and rank) for each slot. */
  lookahead: number;
  /** How much a familiar word counts against leaving room for crossings. */
  scoreWeight: number;
  /** Words already chosen, per slot (in runsOf order); null = to be filled. */
  fixed?: (string | null)[];
  /** Per slot: the lowest word score allowed there (when not fixed). */
  slotMinScore?: number[];
}

const DEFAULT_FILL: FillOptions = { minScore: 0, maxSteps: 400, restarts: 3, branching: 30, lookahead: 12, scoreWeight: 0.05 };
const ALL_LETTERS = (1 << 26) - 1;
const SCAN_BELOW = 64;
const LAZY_ABOVE = 150;

function slotsOf(p: Pattern): Slot[] {
  const n = p.length;
  const slots: Slot[] = runsOf(p).map((r) => ({
    dir: r.dir, row: r.row, col: r.col, len: r.len, cross: [],
    cells: Array.from({ length: r.len }, (_, i) => (r.dir === 'across' ? r.row * n + r.col + i : (r.row + i) * n + r.col)),
  }));
  const at = new Map<number, number[]>();
  slots.forEach((s, si) => s.cells.forEach((cell) => at.set(cell, [...(at.get(cell) ?? []), si])));
  for (const [si, s] of slots.entries()) s.cross = s.cells.map((cell) => at.get(cell)!.find((x) => x !== si) ?? -1);
  return slots;
}

/**
 * Fills the pattern with words. Returns the grid, or null if no fill was found
 * within the search budget.
 *
 * Every slot keeps the set of words that still fit, and every square the set
 * of letters that still fit. Choosing a word narrows the letters in its
 * squares, which narrows the crossing slots' words, and so on (constraint
 * propagation), so dead ends show up right away instead of many steps later.
 */
export function fillPattern(
  p: Pattern, rng: Rng, options: Partial<FillOptions> = {}, words: FillWord[] = loadFillWords(), report?: { hard: Run[] },
): Grid | null {
  const opts = { ...DEFAULT_FILL, ...options };
  const n = p.length;
  const slots = slotsOf(p);
  if (slots.some((s) => s.cross.includes(-1))) return null; // an unchecked square

  const lengths = [...new Set(slots.map((s) => s.len))];
  const indexes = new Map<number, LengthIndex>();
  for (const len of lengths) {
    // Familiar words first, with some shuffling so every day's grid differs.
    const entries = words.filter((w) => w.word.length === len && w.score >= opts.minScore)
      .map((w) => ({ ...w, key: w.score + rng() * 15 }))
      .sort((a, b) => b.key - a.key);
    indexes.set(len, new LengthIndex(entries, len));
  }
  const index = slots.map((s) => indexes.get(s.len)!);
  const tmp = new Map(lengths.map((l) => [l, new Uint32Array(indexes.get(l)!.blocks)]));
  // Every slot's word set lives in one flat array (fast to copy): slot si uses [offset[si], offset[si] + blocks).
  const offset = new Int32Array(slots.length + 1);
  slots.forEach((_, si) => { offset[si + 1] = offset[si]! + index[si]!.blocks; });
  const domOf = (dom: Uint32Array, si: number) => dom.subarray(offset[si]!, offset[si + 1]!);

  /** How often each slot was at a dead end; hard slots get filled earlier (the dom/wdeg heuristic). Kept across restarts. */
  const weight = new Float64Array(slots.length);
  type State = { dom: Uint32Array; mask: Int32Array };

  /** Narrows word sets and letters until nothing changes. Returns false on a dead end. */
  const propagate = (st: State, queue: number[], force = false): boolean => {
    const queued = new Uint8Array(slots.length);
    const dirty = new Uint8Array(slots.length);
    for (const q of queue) { queued[q] = 1; if (force) dirty[q] = 1; }
    const possible = new Int32Array(n);
    while (queue.length) {
      const si = queue.pop()!;
      queued[si] = 0;
      const s = slots[si]!;
      const idx = index[si]!;
      const dom = domOf(st.dom, si);
      const blocks = idx.blocks;
      // Keep only words whose letters are still allowed in every square.
      let changed = false;
      const union = tmp.get(s.len)!;
      for (let pos = 0; pos < s.len; pos++) {
        const m = st.mask[s.cells[pos]!]!;
        if (m === ALL_LETTERS) continue;
        // OR together the allowed letters' word sets, or the banned ones' if there are fewer of those.
        const keep = popcount32(m) <= 13;
        union.fill(0);
        for (let l = 0; l < 26; l++) {
          if (!(m & (1 << l)) === keep) continue;
          const b = idx.bits[pos * 26 + l]!;
          for (let k = 0; k < blocks; k++) union[k]! |= b[k]!;
        }
        for (let k = 0; k < blocks; k++) {
          const v = keep ? dom[k]! & union[k]! : dom[k]! & ~union[k]!;
          if (v !== dom[k]) { dom[k] = v; changed = true; }
        }
      }
      if (!changed && !dirty[si]) continue;
      dirty[si] = 0;
      const count = popcount(dom, LAZY_ABOVE + 1);
      if (count === 0) { weight[si]!++; return false; }
      // Big word sets rarely rule out a letter, so skip the (costly) letter check for them.
      if (count > LAZY_ABOVE) continue;
      // Letters still possible in each square, from the words that remain.
      possible.fill(0, 0, s.len);
      let only = -1;
      if (count <= SCAN_BELOW) {
        for (let k = 0; k < blocks; k++) {
          let v = dom[k]!;
          while (v) {
            const low = v & -v;
            const i = k * 32 + (31 - Math.clz32(low));
            v ^= low;
            only = i;
            const w = idx.words[i]!;
            for (let pos = 0; pos < s.len; pos++) possible[pos]! |= 1 << (w.charCodeAt(pos) - 65);
          }
        }
      } else {
        // Too many words to walk one by one: test each letter's bitset against the set instead.
        for (let pos = 0; pos < s.len; pos++) {
          const m = st.mask[s.cells[pos]!]!;
          let out = 0;
          for (let l = 0; l < 26; l++) {
            if (!(m & (1 << l))) continue;
            const b = idx.bits[pos * 26 + l]!;
            for (let k = 0; k < blocks; k++) if (dom[k]! & b[k]!) { out |= 1 << l; break; }
          }
          possible[pos] = out;
        }
      }
      if (count === 1) {
        // A settled word can't appear anywhere else in the grid.
        for (let other = 0; other < slots.length; other++) {
          if (other === si || slots[other]!.len !== s.len) continue;
          const at = offset[other]! + (only >>> 5);
          if (st.dom[at]! & (1 << (only & 31))) {
            st.dom[at]! &= ~(1 << (only & 31));
            dirty[other] = 1;
            if (!queued[other]) { queued[other] = 1; queue.push(other); }
          }
        }
      }
      for (let pos = 0; pos < s.len; pos++) {
        const cell = s.cells[pos]!;
        const m = st.mask[cell]! & possible[pos]!;
        if (m === 0) { weight[si]!++; weight[s.cross[pos]!]!++; return false; }
        if (m !== st.mask[cell]) {
          st.mask[cell] = m;
          const x = s.cross[pos]!;
          if (!queued[x]) { queued[x] = 1; queue.push(x); }
        }
      }
    }
    return true;
  };

  /** A copy of `st` with slot `si` set to word `i`, or null if that leads to a dead end. */
  const fix = (st: State, si: number, i: number): State | null => {
    const next = { dom: st.dom.slice(), mask: st.mask.slice() };
    const d = domOf(next.dom, si);
    d.fill(0);
    d[i >>> 5] = 1 << (i & 31);
    return propagate(next, [si], true) ? next : null;
  };

  for (let attempt = 0; attempt < opts.restarts; attempt++) {
    let steps = 0;
    const maxSteps = opts.maxSteps * 1.5 ** attempt;
    const root: State = { dom: new Uint32Array(offset[slots.length]!), mask: new Int32Array(n * n).fill(ALL_LETTERS) };
    for (const [si, idx] of index.entries()) {
      const d = domOf(root.dom, si);
      const word = opts.fixed?.[si];
      if (word) {
        const i = idx.words.indexOf(word);
        if (i < 0) return null;
        d[i >>> 5] = 1 << (i & 31);
      } else {
        const min = opts.slotMinScore?.[si] ?? 0;
        idx.scores.forEach((score, i) => { if (score >= min) d[i >>> 5]! |= 1 << (i & 31); });
      }
    }
    if (!propagate(root, slots.map((_, i) => i), true)) return null;

    const solve = (st: State): State | null => {
      if (++steps > maxSteps) return null;
      // The open slot with the fewest words left, relative to how often it caused trouble.
      let best = -1;
      let bestKey = Infinity;
      for (let si = 0; si < slots.length; si++) {
        const c = popcount(domOf(st.dom, si));
        if (c <= 1) continue;
        const key = c / (1 + weight[si]!) + rng() * 0.001;
        if (key < bestKey) { bestKey = key; best = si; }
      }
      if (best < 0) return st;
      // Look ahead: try the most familiar words that fit, and rank them by how
      // much room they leave the crossing slots (a word full of awkward letters
      // can ruin a whole corner).
      const idx = index[best]!;
      const s = slots[best]!;
      const ranked: { next: State; value: number }[] = [];
      const dom = domOf(st.dom, best);
      let looked = 0;
      for (let k = 0; k < dom.length && looked < opts.lookahead; k++) {
        let v = dom[k]!;
        while (v && looked < opts.lookahead) {
          const low = v & -v;
          const i = k * 32 + (31 - Math.clz32(low));
          v ^= low;
          looked++;
          const next = fix(st, best, i);
          if (!next) continue;
          let room = 0;
          for (const x of s.cross) room += Math.log2(1 + popcount(domOf(next.dom, x), 1000));
          ranked.push({ next, value: room / s.len + idx.scores[i]! * opts.scoreWeight });
        }
      }
      ranked.sort((a, b) => b.value - a.value);
      for (const { next } of ranked.slice(0, opts.branching)) {
        const done = solve(next);
        if (done) return done;
        if (steps > maxSteps) return null;
      }
      return null;
    };

    const done = solve(root);
    if (!done) continue;
    const answers = slots.map((_, si) => index[si]!.words[members(domOf(done.dom, si)).next().value as number]!);
    if (new Set(answers).size !== answers.length) continue;
    const cells = Array.from({ length: n }, () => new Array<string | null>(n).fill(null));
    slots.forEach((s, si) => s.cells.forEach((c, i) => { cells[Math.floor(c / n)]![c % n] = answers[si]![i]!; }));
    const placed = assignNumbers(slots.map((s, si) => ({ answer: answers[si]!, row: s.row, col: s.col, direction: s.dir, number: 0 })));
    // Across then down, each in number order (the order clue lists use).
    placed.sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === 'across' ? -1 : 1));
    return { rows: n, cols: n, cells, words: placed };
  }
  if (report) {
    report.hard = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([si]) => ({ dir: slots[si]!.dir, row: slots[si]!.row, col: slots[si]!.col, len: slots[si]!.len }));
  }
  return null;
}

/** Answers scoring below this get a chance to be swapped for more familiar words. */
const POLISH_BELOW = 45;
const POLISH_TO = 50;

/**
 * Swaps obscure answers for familiar ones: for each low-scoring answer, clears
 * it and the answers around it (up to three crossings away) and refills just
 * that patch with familiar words, keeping the result only if it works.
 */
export function polishGrid(p: Pattern, grid: Grid, rng: Rng, words: FillWord[] = loadFillWords()): Grid {
  const slots = slotsOf(p);
  const score = new Map(words.map((w) => [w.word, w.score]));
  let current = grid;
  const tried = new Set<number>();
  for (let round = 0; round < 80; round++) {
    const answers = answersOf(p, slots, current);
    const worst = answers.map((a, si) => ({ si, sc: score.get(a) ?? 0 }))
      .filter((x) => x.sc < POLISH_BELOW && !tried.has(x.si))
      .sort((a, b) => a.sc - b.sc)[0];
    if (!worst) break;
    tried.add(worst.si);
    // The worst answer must improve; the rest of the patch mustn't get worse.
    current = refillPatch(p, slots, answers, worst.si, 24, POLISH_TO, score, rng, words, { restarts: 2, maxSteps: 200 }) ?? current;
  }
  return current;
}

/**
 * Replaces every answer that is no longer in `words` (say, a word newly
 * marked as crosswordese), refilling a patch around each, widening the patch
 * if needed, or refilling the whole grid on the same black squares. Returns
 * null if even that fails.
 */
export function repairGrid(grid: Grid, rng: Rng, words: FillWord[] = loadFillWords()): Grid | null {
  const p: Pattern = grid.cells.map((r) => r.map((c) => c === null));
  const slots = slotsOf(p);
  const score = new Map(words.map((w) => [w.word, w.score]));
  // The banned answers still sit in the grid outside each patch, so the filler
  // must know them; a negative score keeps them out of every refilled slot.
  const banned = [...new Set(answersOf(p, slots, grid).filter((a) => !score.has(a)))];
  words = [...words, ...banned.map((word) => ({ word, score: -1 }))];
  let current = grid;
  for (;;) {
    const answers = answersOf(p, slots, current);
    const bad = answers.findIndex((a) => !score.has(a));
    if (bad < 0) return current;
    let fixed: Grid | null = null;
    for (const size of [24, 40, 64]) {
      fixed = refillPatch(p, slots, answers, bad, size, 0, score, rng, words, { restarts: 3, maxSteps: 400, minScore: -1 });
      if (fixed) break;
    }
    if (!fixed) {
      // Too tangled to patch: refill the whole grid on the same black squares.
      const fresh = fillPattern(p, rng, {}, words.filter((w) => w.score >= 0));
      return fresh && polishGrid(p, fresh, rng, words.filter((w) => w.score >= 0));
    }
    current = fixed;
  }
}

function answersOf(p: Pattern, slots: Slot[], g: Grid): string[] {
  const n = p.length;
  return slots.map((s) => s.cells.map((c) => g.cells[Math.floor(c / n)]![c % n]).join(''));
}

/**
 * Clears answer `center` and the answers around it (crossings, theirs, and so
 * on, up to `size` answers) and refills just that patch. The center answer
 * must score at least `centerMin`; the rest of the patch mustn't get worse.
 */
function refillPatch(p: Pattern, slots: Slot[], answers: string[], center: number, size: number, centerMin: number,
  score: Map<string, number>, rng: Rng, words: FillWord[], opts: Partial<FillOptions>): Grid | null {
  const patch = new Set([center]);
  let frontier = [center];
  while (frontier.length && patch.size < size) {
    const next: number[] = [];
    for (const si of frontier) for (const x of slots[si]!.cross) if (!patch.has(x) && patch.size < size) { patch.add(x); next.push(x); }
    frontier = next;
  }
  const fixed = answers.map((a, si) => (patch.has(si) ? null : a));
  const slotMinScore = answers.map((a, si) => (si === center ? centerMin : Math.min(POLISH_TO, score.get(a) ?? 0)));
  return fillPattern(p, rng, { ...opts, fixed, slotMinScore }, words);
}

/**
 * Adds a symmetric pair of black squares inside `run` (as near its middle as
 * the rules allow), splitting it in two. Returns false if no square works.
 */
export function splitRun(p: Pattern, run: Run, opts: SundayOptions = SUNDAY): boolean {
  const n = p.length;
  const order = Array.from({ length: run.len }, (_, i) => i).sort((a, b) => Math.abs(a - run.len / 2) - Math.abs(b - run.len / 2));
  for (const i of order) {
    const [r, c] = run.dir === 'across' ? [run.row, run.col + i] : [run.row + i, run.col];
    if (p[r]![c]) continue;
    setPair(p, r, c, true);
    if (!shortRunNear(p, r, c) && !shortRunNear(p, n - 1 - r, n - 1 - c) && connected(p) && runsOf(p).length <= opts.maxWords) return true;
    setPair(p, r, c, false);
  }
  return false;
}

/**
 * A complete Sunday-size grid for this seed. When a region won't fill, it
 * does what human constructors do: adds a black square there and tries again.
 */
export function generateSundayGrid(seed: number, opts: SundayOptions = SUNDAY, fill: Partial<FillOptions> = {}): Grid {
  const rng = createRng(seed);
  for (let tries = 0; tries < 2000; tries++) {
    const pattern = buildPattern(rng, opts);
    if (!pattern) continue;
    for (let round = 0; round < 12; round++) {
      const report = { hard: [] as Run[] };
      const grid = fillPattern(pattern, rng, fill, loadFillWords(), report);
      if (grid) return polishGrid(pattern, grid, rng);
      if (!report.hard.some((run) => splitRun(pattern, run, opts))) break;
    }
  }
  throw new Error(`Could not build a Sunday grid (seed ${seed})`);
}
