/**
 * One game room: two players, and the whole game from lobby to reveal.
 * The server is the source of truth for answers, timers and scoring; players
 * only ever receive a GameView built for them (never the answers they solve).
 */
import { randomUUID } from 'node:crypto';
import { CONFIG, poolSeconds, type Difficulty, type Theme, type TimerMode } from '../../shared/config.js';
import type { CellPos, PuzzleView } from '../../shared/puzzle.js';
import type {
  BestClueVote, EndReason, FlaggedClue, GameResult, GameView, NextResult, Phase, PlayerInfo, RevealGrid,
} from '../../shared/protocol.js';
import { cleanClue, clueContainsAnswer } from '../../shared/rules.js';
import type { ClueAI, QuickCheckResult, ReviewItem, ReviewVerdict } from '../ai/types.js';
import { withTimeout } from '../ai/types.js';
import { AIError } from '../ai/anthropic.js';
import { lookupDefinition, type Sense } from '../words/definitions.js';
import { wordsFor } from '../words/wordBank.js';
import { addBestClue } from '../words/clueLibrary.js';

/** Definitions the AI wrote for words missing from the dictionary (shared by all games). */
const aiDefinitions = new Map<string, Sense[]>();
import { generateGamePuzzles } from '../grid/puzzles.js';
import type { Grid, PlacedWord } from '../grid/types.js';
import { checkEntries } from '../solve/check.js';
import { cannotWin, decideWinner, finalMs, type ScoreInput } from './scoring.js';

interface WordSlot {
  /** Index into the grid's words array. */
  gridIndex: number;
  answer: string;
  draft: string;
  text: string;
  done: boolean;
  blank: boolean;
}

interface WritingState {
  slots: WordSlot[];
  index: number;
  deadline: number | null;
  introDone: boolean;
  introDeadline: number;
  /** Pool mode: server time when all writing ends. */
  poolDeadline: number | null;
  timer?: NodeJS.Timeout;
  checkCache: Map<string, QuickCheckResult>;
  /** AI checks used on the current word (capped to protect API spend). */
  checksThisWord: number;
}

const MAX_CHECKS_PER_WORD = 6;

interface SolvingState {
  entries: string[][];
  hintsUsed: number;
  hints: Record<number, string>;
  hintPending: boolean;
  finishedAt: number | null;
}

/** The clue a solver actually sees for one word (after review). */
interface FinalClue {
  text: string;
  original: string;
  flagged: boolean;
  explanation: string;
  prefilled: boolean;
}

export interface Player {
  id: string;
  token: string;
  /** Account id when the player is signed in; undefined for guests. */
  userId?: string;
  name: string;
  sockets: Set<string>;
  connected: boolean;
  left: boolean;
  ready: boolean;
  reconnectDeadline: number | null;
  reconnectTimer?: NodeJS.Timeout;
  writing?: WritingState;
  solving?: SolvingState;
}

export interface RoomDeps {
  ai: ClueAI;
  /** Pushes a fresh GameView to one player's open connections. */
  send: (player: Player, view: GameView) => void;
}

const ACTIVE: Phase[] = ['writing', 'reviewing', 'solving'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Room {
  players: Player[] = [];
  phase: Phase = 'lobby';
  lastActivity = Date.now();
  private grids: [Grid, Grid] | null = null;
  private finalClues: [FinalClue[], FinalClue[]] = [[], []];
  private reviewSkipped = false;
  private solveStartedAt = 0;
  private tickTimer?: NodeJS.Timeout;
  private result?: GameResult;
  private votes: Record<string, BestClueVote> = {};
  /** Clue-writing clock for the next game (the host chooses in the lobby). */
  timerMode: TimerMode = 'perWord';
  /** Word theme for the next game (the host chooses in the lobby). */
  theme: Theme = 'any';
  /** Bumped every new game so late async work from an old game is ignored. */
  private generation = 0;

  constructor(readonly code: string, public difficulty: Difficulty, private deps: RoomDeps) {}

  // ── Players & connections ─────────────────────────────────

  addPlayer(name: string, userId?: string): Player {
    const taken = this.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
    const player: Player = {
      id: randomUUID(),
      token: randomUUID(),
      userId,
      name: taken ? `${name} (2)` : name,
      sockets: new Set(),
      connected: false,
      left: false,
      ready: false,
      reconnectDeadline: null,
    };
    this.players.push(player);
    this.touch();
    return player;
  }

  canJoin(): string | null {
    if (this.phase !== 'lobby') return 'This game has already started.';
    if (this.players.filter((p) => !p.left).length >= 2) return 'This game already has two players.';
    if (this.players.some((p) => p.left)) return 'This game has ended.';
    return null;
  }

  byToken(token: string) {
    return this.players.find((p) => p.token === token && !p.left);
  }

  opponent(p: Player) {
    return this.players.find((o) => o !== p);
  }

  connect(p: Player, socketId: string) {
    p.sockets.add(socketId);
    p.connected = true;
    p.reconnectDeadline = null;
    clearTimeout(p.reconnectTimer);
    this.touch();
    this.broadcast();
  }

  disconnect(p: Player, socketId: string) {
    p.sockets.delete(socketId);
    if (p.sockets.size || p.left) return;
    this.markDisconnected(p);
  }

  private markDisconnected(p: Player) {
    p.connected = false;
    p.reconnectDeadline = Date.now() + CONFIG.reconnectWindowSeconds * 1000;
    clearTimeout(p.reconnectTimer);
    p.reconnectTimer = setTimeout(() => this.onReconnectTimeout(p), CONFIG.reconnectWindowSeconds * 1000);
    this.broadcast();
  }

  private onReconnectTimeout(p: Player) {
    if (p.connected || p.left) return;
    this.leave(p);
  }

  /** A player leaves for good (explicitly, or after failing to reconnect). */
  leave(p: Player) {
    clearTimeout(p.reconnectTimer);
    p.sockets.clear();
    p.connected = false;
    p.reconnectDeadline = null;
    if (ACTIVE.includes(this.phase)) {
      p.left = true;
      this.finish('forfeit', p);
      return;
    }
    if (this.phase === 'lobby' && this.players[0] !== p) {
      // A guest leaving the lobby frees the seat for someone else.
      this.players = this.players.filter((x) => x !== p);
      for (const o of this.players) o.ready = false;
    } else {
      p.left = true;
    }
    this.broadcast();
  }

  isDead(now: number): boolean {
    const nobodyHere = this.players.every((p) => !p.connected);
    return (nobodyHere && now - this.lastActivity > 30 * 60_000) || now - this.lastActivity > 3 * 3600_000;
  }

  dispose() {
    clearInterval(this.tickTimer);
    for (const p of this.players) {
      clearTimeout(p.reconnectTimer);
      clearTimeout(p.writing?.timer);
    }
  }

  // ── Lobby ─────────────────────────────────────────────────

  setDifficulty(p: Player, d: Difficulty) {
    if (this.phase !== 'lobby' || this.players[0] !== p) return;
    this.difficulty = d;
    for (const o of this.players) o.ready = false;
    this.touch();
    this.broadcast();
  }

  setTimerMode(p: Player, mode: TimerMode) {
    if (this.phase !== 'lobby' || this.players[0] !== p) return;
    this.timerMode = mode;
    for (const o of this.players) o.ready = false;
    this.touch();
    this.broadcast();
  }

  setTheme(p: Player, theme: Theme) {
    if (this.phase !== 'lobby' || this.players[0] !== p) return;
    this.theme = theme;
    for (const o of this.players) o.ready = false;
    this.touch();
    this.broadcast();
  }

  setReady(p: Player, ready: boolean) {
    if (this.phase !== 'lobby') return;
    p.ready = ready;
    this.touch();
    const present = this.players.filter((x) => !x.left);
    if (present.length === 2 && present.every((x) => x.ready && x.connected)) this.startGame();
    else this.broadcast();
  }

  private startGame() {
    const { gridA, gridB } = generateGamePuzzles(this.difficulty, { words: wordsFor(this.difficulty, this.theme) });
    this.grids = [gridA, gridB];
    this.generation++;
    this.result = undefined;
    this.votes = {};
    this.reviewSkipped = false;
    this.finalClues = [[], []];
    this.solveStartedAt = 0;
    this.phase = 'writing';
    const gen = this.generation;
    const now = Date.now();
    this.players.forEach((p, i) => {
      p.solving = undefined;
      p.writing = {
        slots: writingOrder(this.grids![i]!).map((gridIndex) => ({
          gridIndex, answer: this.grids![i]!.words[gridIndex]!.answer, draft: '', text: '', done: false, blank: false,
        })),
        index: 0,
        deadline: null,
        introDone: false,
        introDeadline: now + CONFIG.writingIntroSeconds * 1000,
        poolDeadline: null,
        checkCache: new Map(),
        checksThisWord: 0,
      };
      const w = p.writing;
      w.timer = setTimeout(() => { if (gen === this.generation) this.introDone(p); }, CONFIG.writingIntroSeconds * 1000);
    });
    this.touch();
    this.broadcast();
  }

  // ── Clue writing ──────────────────────────────────────────

  introDone(p: Player) {
    const w = p.writing;
    if (this.phase !== 'writing' || !w || w.introDone) return;
    w.introDone = true;
    if (this.timerMode === 'pool') this.startPoolTimer(p);
    else this.startWordTimer(p);
    this.broadcast();
  }

  private startWordTimer(p: Player) {
    const w = p.writing!;
    clearTimeout(w.timer);
    w.deadline = Date.now() + CONFIG.secondsPerClue * 1000;
    const gen = this.generation;
    const index = w.index;
    w.timer = setTimeout(() => {
      if (gen !== this.generation || w.index !== index) return;
      // Time's up: whatever is typed is submitted (blank if nothing).
      this.submitClue(p, w.slots[index]!.draft);
    }, CONFIG.secondsPerClue * 1000);
  }

  /** Pool mode: one clock for all words. When it runs out, every unfinished word takes what was typed. */
  private startPoolTimer(p: Player) {
    const w = p.writing!;
    clearTimeout(w.timer);
    const ms = poolSeconds() * 1000;
    w.poolDeadline = Date.now() + ms;
    w.deadline = w.poolDeadline;
    const gen = this.generation;
    w.timer = setTimeout(() => {
      if (gen !== this.generation || this.phase !== 'writing') return;
      this.finishPool(p);
    }, ms);
  }

  private finishPool(p: Player) {
    const w = p.writing!;
    for (const slot of w.slots) {
      if (slot.done) continue;
      const text = clueContainsAnswer(slot.draft, slot.answer) ? '' : slot.draft;
      slot.text = text;
      slot.blank = !text;
      slot.done = true;
    }
    w.index = w.slots.length;
    w.deadline = null;
    this.afterWritingChange();
  }

  /** Pool mode: move to any word (including one already written, to revise it). */
  goto(p: Player, index: number) {
    const w = p.writing;
    if (this.phase !== 'writing' || this.timerMode !== 'pool' || !w || !w.introDone || w.index >= w.slots.length) return;
    const slot = w.slots[index];
    if (!slot || index === w.index) return;
    w.index = index;
    w.checksThisWord = 0;
    if (slot.done) slot.draft = slot.text;
    this.touch();
    this.broadcast();
  }

  draft(p: Player, index: number, text: string) {
    const w = p.writing;
    if (this.phase !== 'writing' || !w || index !== w.index || !w.introDone) return;
    const slot = w.slots[index];
    if (slot && (!slot.done || this.timerMode === 'pool')) slot.draft = cleanClue(text);
  }

  async next(p: Player, index: number, raw: string, mode: 'check' | 'keep' | 'blank'): Promise<NextResult> {
    const w = p.writing;
    if (this.phase !== 'writing' || !w || !w.introDone || index !== w.index) return { status: 'stale' };
    const slot = w.slots[index]!;
    const text = mode === 'blank' ? '' : cleanClue(raw);
    slot.draft = text;
    if (!text) {
      this.submitClue(p, '');
      return { status: 'advanced' };
    }
    if (clueContainsAnswer(text, slot.answer)) {
      return { status: 'invalid', message: "Your clue can't contain the answer word." };
    }
    if (mode === 'check') {
      const verdict = await this.quickCheck(w, slot.answer, text);
      if (w.index !== index || this.phase !== 'writing') return { status: 'stale' };
      if (verdict && !verdict.valid) return { status: 'warning', reason: verdict.reason || 'This clue may not fit the answer.' };
    }
    this.submitClue(p, text);
    return { status: 'advanced' };
  }

  /**
   * A short definition of one of the player's own words, from the built-in
   * dictionary, or the AI when the dictionary has no entry.
   */
  async define(p: Player, index: number): Promise<{ word: string; senses: Sense[] } | null> {
    const slot = this.phase === 'writing' ? p.writing?.slots[index] : undefined;
    if (!slot) return null;
    const word = slot.answer;
    const known = lookupDefinition(word) ?? aiDefinitions.get(word);
    if (known) return { word, senses: known };
    try {
      const senses = await withTimeout(CONFIG.definitionTimeoutMs, (signal) => this.deps.ai.define(word, signal));
      if (senses.length) aiDefinitions.set(word, senses);
      return { word, senses };
    } catch (e) {
      console.warn(`[ai] definition for ${word} failed: ${e instanceof AIError ? e.reason : (e as Error).message}`);
      return { word, senses: [] };
    }
  }

  /** The live check that runs with 5 seconds left. Returns valid on any failure. */
  async check(p: Player, index: number, raw: string): Promise<{ valid: boolean; reason: string }> {
    const w = p.writing;
    const text = cleanClue(raw);
    if (this.phase !== 'writing' || !w || index !== w.index || !text) return { valid: true, reason: '' };
    const verdict = await this.quickCheck(w, w.slots[index]!.answer, text);
    return verdict && !verdict.valid ? { valid: false, reason: verdict.reason || 'This clue may not fit the answer.' } : { valid: true, reason: '' };
  }

  private async quickCheck(w: WritingState, answer: string, text: string): Promise<QuickCheckResult | null> {
    const key = `${answer}|${text}`;
    const cached = w.checkCache.get(key);
    if (cached) return cached;
    if (++w.checksThisWord > MAX_CHECKS_PER_WORD) return null;
    try {
      const verdict = await withTimeout(CONFIG.liveCheckTimeoutMs, (signal) => this.deps.ai.quickCheck(answer, text, signal));
      w.checkCache.set(key, verdict);
      return verdict;
    } catch (e) {
      console.warn('[ai] live check skipped:', (e as Error).message);
      return null; // too slow or failed: skip the warning silently
    }
  }

  private submitClue(p: Player, text: string) {
    const w = p.writing!;
    const slot = w.slots[w.index];
    const pool = this.timerMode === 'pool';
    if (!slot || (slot.done && !pool)) return;
    slot.text = text;
    slot.draft = text;
    slot.blank = !text;
    slot.done = true;
    w.checksThisWord = 0;
    if (pool) {
      // Next unwritten word after this one (wrapping round); all written means done.
      const n = w.slots.length;
      const next = Array.from({ length: n }, (_, k) => (w.index + 1 + k) % n).find((i) => !w.slots[i]!.done);
      w.index = next ?? n;
      if (next === undefined) {
        clearTimeout(w.timer);
        w.deadline = null;
      }
    } else {
      w.index++;
      clearTimeout(w.timer);
      w.deadline = null;
      if (w.index < w.slots.length) this.startWordTimer(p);
    }
    this.afterWritingChange();
  }

  private afterWritingChange() {
    this.touch();
    if (this.players.every((x) => x.writing && x.writing.index >= x.writing.slots.length)) {
      void this.runReview();
    } else {
      this.broadcast();
    }
  }

  // ── Review ────────────────────────────────────────────────

  private async runReview() {
    this.phase = 'reviewing';
    this.broadcast();
    const gen = this.generation;
    const started = Date.now();

    // Build the base clue list for both grids.
    const final: [FinalClue[], FinalClue[]] = [[], []];
    const items: ReviewItem[] = [];
    this.players.forEach((p, g) => {
      const grid = this.grids![g]!;
      final[g] = grid.words.map(() => ({ text: '', original: '', flagged: false, explanation: '', prefilled: true }));
      for (const slot of p.writing!.slots) {
        const fc = final[g]![slot.gridIndex]!;
        fc.original = slot.text;
        fc.text = slot.text;
        fc.prefilled = slot.blank;
        if (!slot.blank) items.push({ id: `${g}-${slot.gridIndex}`, answer: slot.answer, clue: slot.text });
      }
    });

    let verdicts: ReviewVerdict[] | null = null;
    try {
      verdicts = await withTimeout(CONFIG.reviewTimeoutMs, (signal) => this.deps.ai.review(items, signal));
    } catch (e) {
      console.warn('[ai] review skipped:', (e as Error).message);
    }
    if (gen !== this.generation) return;

    const byId = new Map((verdicts ?? []).map((v) => [v.id, v]));
    const needReplacement: { g: number; i: number; answer: string }[] = [];
    this.reviewSkipped = verdicts === null;

    for (const item of items) {
      const [g, i] = item.id.split('-').map(Number) as [number, number];
      const fc = final[g]![i]!;
      const containsAnswer = clueContainsAnswer(item.clue, item.answer);
      const v = byId.get(item.id);
      if (verdicts === null) {
        // Review failed: originals, no penalties. A clue that gives the answer away is still swapped silently.
        if (containsAnswer) needReplacement.push({ g, i, answer: item.answer });
        continue;
      }
      if (containsAnswer || v?.flagged) {
        fc.flagged = true;
        fc.explanation = containsAnswer
          ? 'The clue contained the answer word.'
          : (v?.explanation || 'The clue did not fit the answer.');
        const replacement = cleanClue(v?.replacement ?? '');
        if (replacement && !clueContainsAnswer(replacement, item.answer) && replacement.toLowerCase() !== item.clue.toLowerCase()) {
          fc.text = replacement;
        } else {
          needReplacement.push({ g, i, answer: item.answer });
        }
      }
    }

    // Any flagged clue without a usable replacement gets a fresh one.
    await Promise.all(needReplacement.map(async ({ g, i, answer }) => {
      const fc = final[g]![i]!;
      const alt = await this.generateClue(answer, [fc.original]);
      fc.text = alt ?? fallbackClue(answer);
    }));
    if (gen !== this.generation) return;

    this.finalClues = final;
    const wait = CONFIG.minBuildingScreenMs - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    if (gen !== this.generation) return;
    this.startSolving();
  }

  /** A validated AI clue for `answer`, different from `avoid`; null on failure. */
  private async generateClue(answer: string, avoid: string[]): Promise<string | null> {
    const r = await this.tryGenerateClue(answer, avoid);
    return 'clue' in r ? r.clue : null;
  }

  /** Like generateClue, but on failure returns a plain-English reason. */
  private async tryGenerateClue(answer: string, avoid: string[]): Promise<{ clue: string } | { error: string }> {
    try {
      const raw = await withTimeout(CONFIG.hintTimeoutMs, (signal) => this.deps.ai.alternativeClue(answer, avoid, this.difficulty, signal));
      const clue = cleanClue(raw);
      if (!clue || clueContainsAnswer(clue, answer)) {
        console.warn(`[ai] clue for ${answer} rejected: it contained the answer ("${clue}")`);
        return { error: 'the AI kept giving clues that contained the answer' };
      }
      if (avoid.some((a) => a.trim().toLowerCase() === clue.toLowerCase())) {
        console.warn(`[ai] clue for ${answer} rejected: it repeated an existing clue`);
        return { error: 'the AI repeated the existing clue' };
      }
      return { clue };
    } catch (e) {
      const reason = e instanceof AIError ? e.reason : /timed out/i.test((e as Error).message) ? 'the AI took too long to answer' : (e as Error).message;
      console.warn(`[ai] clue generation for ${answer} failed: ${reason}`);
      return { error: reason };
    }
  }

  // ── Solving ───────────────────────────────────────────────

  /** Grid index player i solves (they wrote the other one). */
  private solveGridIndex(p: Player) {
    return 1 - this.players.indexOf(p);
  }

  private startSolving() {
    this.phase = 'solving';
    this.solveStartedAt = Date.now();
    for (const p of this.players) {
      const g = this.solveGridIndex(p);
      const grid = this.grids![g]!;
      const entries = grid.cells.map((row) => row.map(() => ''));
      grid.words.forEach((w, i) => {
        if (this.finalClues[g]![i]!.prefilled) for (const [r, c] of wordCells(w)) entries[r]![c] = grid.cells[r]![c]!;
      });
      p.solving = { entries, hintsUsed: 0, hints: {}, hintPending: false, finishedAt: null };
    }
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.tick(), 500);
    this.touch();
    this.broadcast();
  }

  private puzzleViewFor(p: Player): PuzzleView {
    const g = this.solveGridIndex(p);
    const grid = this.grids![g]!;
    return {
      id: `${this.code}-${this.generation}`,
      rows: grid.rows,
      cols: grid.cols,
      open: grid.cells.map((row) => row.map((c) => c !== null)),
      clues: grid.words.map((w, i) => {
        const fc = this.finalClues[g]![i]!;
        return {
          number: w.number, direction: w.direction, row: w.row, col: w.col, length: w.answer.length,
          text: fc.prefilled ? 'Left blank by your opponent — filled in for you.' : fc.text,
          ...(fc.prefilled ? { prefilled: w.answer } : {}),
        };
      }),
    };
  }

  updateEntries(p: Player, raw: unknown) {
    if (this.phase !== 'solving' || !p.solving || p.solving.finishedAt !== null) return;
    p.solving.entries = this.sanitizeEntries(p, raw);
    this.touch();
    this.broadcast();
  }

  private sanitizeEntries(p: Player, raw: unknown): string[][] {
    const grid = this.grids![this.solveGridIndex(p)]!;
    const prev = p.solving!.entries;
    const rows = Array.isArray(raw) ? raw : [];
    const locked = this.lockedCells(p);
    return grid.cells.map((row, r) =>
      row.map((cell, c) => {
        if (cell === null) return '';
        if (locked.has(`${r},${c}`)) return prev[r]![c]!;
        const v = Array.isArray(rows[r]) ? rows[r][c] : '';
        const letter = typeof v === 'string' ? v.trim().toUpperCase().slice(0, 1) : '';
        return /^[A-Z]$/.test(letter) ? letter : '';
      }),
    );
  }

  private lockedCells(p: Player): Set<string> {
    const g = this.solveGridIndex(p);
    const set = new Set<string>();
    this.grids![g]!.words.forEach((w, i) => {
      if (this.finalClues[g]![i]!.prefilled) for (const [r, c] of wordCells(w)) set.add(`${r},${c}`);
    });
    return set;
  }

  submit(p: Player, raw: unknown): { solved: boolean; blanks: CellPos[]; wrong: CellPos[] } {
    if (this.phase !== 'solving' || !p.solving) return { solved: false, blanks: [], wrong: [] };
    if (p.solving.finishedAt !== null) return { solved: true, blanks: [], wrong: [] };
    p.solving.entries = this.sanitizeEntries(p, raw);
    const { blanks, wrong } = checkEntries(this.grids![this.solveGridIndex(p)]!, p.solving.entries);
    const solved = !blanks.length && !wrong.length;
    if (solved) {
      p.solving.finishedAt = Date.now();
      this.tick();
      if (this.phase === 'solving') this.broadcast();
    }
    this.touch();
    return { solved, blanks, wrong };
  }

  async hint(p: Player, clueIndex: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const s = p.solving;
    if (this.phase !== 'solving' || !s || s.finishedAt !== null) return { ok: false, error: 'Hints are not available right now.' };
    if (s.hintsUsed >= CONFIG.hintsPerGame) return { ok: false, error: 'No hints left.' };
    if (s.hintPending) return { ok: false, error: 'A hint is already on its way.' };
    const g = this.solveGridIndex(p);
    const word = this.grids![g]!.words[clueIndex];
    const fc = this.finalClues[g]![clueIndex];
    if (!word || !fc || fc.prefilled) return { ok: false, error: 'That word does not need a hint.' };
    if (s.hints[clueIndex]) return { ok: false, error: 'You already have a hint for this clue.' };

    s.hintPending = true;
    const gen = this.generation;
    const made = await this.tryGenerateClue(word.answer, [fc.text, fc.original]);
    s.hintPending = false;
    if (gen !== this.generation || this.phase !== 'solving' || s.finishedAt !== null) return { ok: false, error: 'The game has moved on.' };
    if ('error' in made) return { ok: false, error: `Couldn't create a hint: ${made.error}. You were not charged.` };
    const text = made.clue;
    s.hintsUsed++;
    s.hints[clueIndex] = text;
    this.touch();
    this.tick();
    if (this.phase === 'solving') this.broadcast();
    return { ok: true, text };
  }

  resign(p: Player) {
    if (this.phase !== 'solving' && this.phase !== 'writing' && this.phase !== 'reviewing') return;
    this.finish('resign', p);
  }

  private scoreInput(p: Player): ScoreInput {
    const writerGrid = this.players.indexOf(p);
    return {
      id: p.id,
      finishedAt: p.solving?.finishedAt ?? null,
      hintsUsed: p.solving?.hintsUsed ?? 0,
      flaggedCount: this.finalClues[writerGrid]?.filter((c) => c.flagged).length ?? 0,
      wordsCorrect: this.wordsCorrect(p),
    };
  }

  private wordsCorrect(p: Player): number {
    if (!p.solving || !this.grids) return 0;
    const grid = this.grids[this.solveGridIndex(p)]!;
    return grid.words.filter((w) => wordCells(w).every(([r, c]) => p.solving!.entries[r]![c] === grid.cells[r]![c])).length;
  }

  private filledCount(p: Player): number {
    if (!p.solving || !this.grids) return 0;
    const grid = this.grids[this.solveGridIndex(p)]!;
    return grid.words.filter((w) => wordCells(w).every(([r, c]) => !!p.solving!.entries[r]![c])).length;
  }

  /** Checks end conditions. Runs twice a second while solving. */
  private tick() {
    if (this.phase !== 'solving') return;
    const now = Date.now();
    const [a, b] = this.players.map((p) => this.scoreInput(p)) as [ScoreInput, ScoreInput];
    if (a.finishedAt !== null && b.finishedAt !== null) return this.finish('completed', null);
    if (a.finishedAt !== null && cannotWin(a, b, this.solveStartedAt, now)) return this.finish('impossible', null);
    if (b.finishedAt !== null && cannotWin(b, a, this.solveStartedAt, now)) return this.finish('impossible', null);
    if (now - this.solveStartedAt >= CONFIG.maxSolveMinutes * 60_000) return this.finish('timeout', null);
  }

  // ── End of game ───────────────────────────────────────────

  private finish(reason: EndReason, endedBy: Player | null) {
    if (this.phase === 'finished') return;
    clearInterval(this.tickTimer);
    for (const p of this.players) clearTimeout(p.writing?.timer);
    this.generation++; // cancel any in-flight AI work for this game
    this.phase = 'finished';

    const scores = this.players.map((p) => this.scoreInput(p)) as [ScoreInput, ScoreInput];
    let winnerId: string | null;
    let tieBreak: GameResult['tieBreak'] = null;
    if (endedBy) {
      winnerId = this.opponent(endedBy)?.id ?? null;
    } else {
      ({ winnerId, tieBreak } = decideWinner(scores[0], scores[1], this.solveStartedAt));
    }

    const started = this.solveStartedAt > 0;
    this.result = {
      id: randomUUID(),
      reason,
      winnerId,
      tieBreak,
      endedBy: endedBy?.id ?? null,
      reviewSkipped: this.reviewSkipped,
      players: this.players.map((p, i) => {
        const s = scores[i]!;
        const flagged: FlaggedClue[] = [];
        this.finalClues[i]?.forEach((fc, wi) => {
          if (fc.flagged) flagged.push({ answer: this.grids![i]!.words[wi]!.answer, original: fc.original, replacement: fc.text, explanation: fc.explanation });
        });
        return {
          id: p.id,
          name: p.name,
          rawMs: s.finishedAt !== null && started ? s.finishedAt - this.solveStartedAt : null,
          hintsUsed: s.hintsUsed,
          hintPenaltyMs: s.hintsUsed * CONFIG.hintPenaltySeconds * 1000,
          flagged,
          flaggedPenaltyMs: s.flaggedCount * CONFIG.flaggedCluePenaltySeconds * 1000,
          finalMs: started ? finalMs(s, this.solveStartedAt) : null,
          wordsCorrect: s.wordsCorrect,
          totalWords: CONFIG.wordsPerGrid,
        };
      }),
      grids: this.revealGrids(),
    };
    this.touch();
    this.broadcast();
  }

  private revealGrids(): RevealGrid[] {
    if (!this.grids) return [];
    return this.grids.map((grid, g) => {
      const writer = this.players[g]!;
      const solver = this.players[1 - g]!;
      return {
        writerName: writer.name,
        solverName: solver.name,
        rows: grid.rows,
        cols: grid.cols,
        cells: grid.cells,
        entries: solver.solving?.entries ?? grid.cells.map((row) => row.map(() => '')),
        clues: grid.words.map((w, i) => {
          const fc = this.finalClues[g]?.[i];
          const slot = writer.writing?.slots.find((s) => s.gridIndex === i);
          const original = fc?.original ?? slot?.text ?? '';
          const prefilled = fc ? fc.prefilled : !!slot?.blank || !slot?.done;
          return {
            number: w.number, direction: w.direction, row: w.row, col: w.col, answer: w.answer,
            text: prefilled ? '(left blank — filled in)' : (fc?.text ?? original),
            ...(fc?.flagged ? { original, explanation: fc.explanation } : {}),
            prefilled,
            ...(solver.solving?.hints[i] ? { hint: solver.solving.hints[i] } : {}),
          };
        }),
      };
    });
  }

  rematch(p: Player) {
    if (this.phase !== 'finished') return;
    const other = this.opponent(p);
    if (!other || other.left || p.left) return;
    this.phase = 'lobby';
    this.grids = null;
    this.finalClues = [[], []];
    this.solveStartedAt = 0;
    this.result = undefined;
    this.votes = {};
    for (const x of this.players) {
      x.ready = false;
      x.writing = undefined;
      x.solving = undefined;
    }
    this.touch();
    this.broadcast();
  }

  /** A "best clue" vote for one of the opponent's clues (in the grid this player solved). */
  vote(p: Player, clueIndex: number) {
    if (this.phase !== 'finished' || !this.result) return;
    // Same rules the results screen shows: a written clue that wasn't replaced.
    const clue = this.result.grids[this.solveGridIndex(p)]?.clues[clueIndex];
    if (!Number.isInteger(clueIndex) || !clue || clue.prefilled || clue.original !== undefined) return;
    this.votes = { ...this.votes, [p.id]: { clueIndex } };
    // Clues that passed the AI review are saved for practice puzzles.
    if (!this.result.reviewSkipped) addBestClue(clue.answer, clue.text);
    this.touch();
    this.broadcast();
  }

  // ── Views ─────────────────────────────────────────────────

  private touch() {
    this.lastActivity = Date.now();
  }

  broadcast() {
    for (const p of this.players) if (p.sockets.size) this.deps.send(p, this.viewFor(p));
  }

  viewFor(p: Player): GameView {
    const now = Date.now();
    const other = this.opponent(p);
    const view: GameView = {
      code: this.code,
      phase: this.phase,
      difficulty: this.difficulty,
      timerMode: this.timerMode,
      theme: this.theme,
      you: p.id,
      players: this.players.map((x, i): PlayerInfo => ({
        id: x.id, name: x.name, isHost: i === 0, connected: x.connected, ready: x.ready,
        left: x.left, reconnectDeadline: x.reconnectDeadline,
      })),
      serverNow: now,
      aiMode: this.deps.ai.mode,
    };

    if (this.phase === 'writing' && p.writing) {
      const w = p.writing;
      const slot = w.slots[w.index];
      view.writing = {
        introDone: w.introDone,
        introDeadline: w.introDone ? null : w.introDeadline,
        timerMode: this.timerMode,
        words: w.slots.map((s) => ({ answer: s.answer, done: s.done, blank: s.blank })),
        index: w.index,
        deadline: w.deadline,
        draft: slot && (!slot.done || this.timerMode === 'pool') ? slot.draft : '',
        done: w.index >= w.slots.length,
        opponentDoneCount: other?.writing ? Math.min(other.writing.index, other.writing.slots.length) : 0,
      };
    }

    if (this.phase === 'solving' && p.solving) {
      const s = p.solving;
      view.solving = {
        puzzle: this.puzzleViewFor(p),
        entries: s.entries,
        startedAt: this.solveStartedAt,
        maxEndsAt: this.solveStartedAt + CONFIG.maxSolveMinutes * 60_000,
        hintsUsed: s.hintsUsed,
        hintsLeft: CONFIG.hintsPerGame - s.hintsUsed,
        hints: s.hints,
        youFinished: s.finishedAt !== null,
        yourRawMs: s.finishedAt !== null ? s.finishedAt - this.solveStartedAt : null,
        yourFilled: this.filledCount(p),
        opponentFilled: other ? this.filledCount(other) : 0,
        opponentFinished: other?.solving?.finishedAt != null,
        total: this.grids![this.solveGridIndex(p)]!.words.length,
      };
    }

    if (this.phase === 'finished' && this.result) {
      view.result = this.result;
      view.votes = this.votes;
    }
    return view;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function wordCells(w: PlacedWord): [number, number][] {
  return Array.from({ length: w.answer.length }, (_, i) =>
    w.direction === 'across' ? [w.row, w.col + i] : [w.row + i, w.col],
  );
}

/** Clue-writing order: Across by number, then Down by number. */
function writingOrder(grid: Grid): number[] {
  const idx = grid.words.map((w, i) => ({ w, i }));
  const by = (dir: 'across' | 'down') => idx.filter((x) => x.w.direction === dir).sort((a, b) => a.w.number - b.w.number).map((x) => x.i);
  return [...by('across'), ...by('down')];
}

/** Last-resort replacement if the AI can't produce one. */
function fallbackClue(answer: string): string {
  return `${answer.length}-letter word starting with ${answer[0]} and ending with ${answer[answer.length - 1]}`;
}

