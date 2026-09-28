/**
 * Every tunable number in the game lives here.
 * Change a value, restart the server, and the whole game uses it.
 */
export const CONFIG = {
  // ── Game rules ────────────────────────────────────────────
  wordsPerGrid: 15,
  secondsPerClue: 30,
  clueCharLimit: 150,
  /** The live counter turns blue once this many characters are typed. */
  clueCounterWarnAt: 130,
  /** The live AI check runs automatically when this many seconds remain (if a clue is typed). */
  liveCheckAtSecondsLeft: 5,
  hintsPerGame: 5,
  hintPenaltySeconds: 30,
  flaggedCluePenaltySeconds: 60,
  reconnectWindowSeconds: 60,
  maxSolveMinutes: 30,

  /** Seconds a player may read the clue-writing rules before their first word starts anyway. */
  writingIntroSeconds: 20,
  /** Live clue check: give up (and skip the warning) after this long. */
  liveCheckTimeoutMs: 2500,
  /** Full clue review: give up (use original clues, no penalties) after this long. */
  reviewTimeoutMs: 15000,
  /** Hint generation: give up (no charge) after this long. */
  hintTimeoutMs: 15000,
  /** The "Building your puzzles…" screen shows for at least this long. */
  minBuildingScreenMs: 2500,

  // ── AI ────────────────────────────────────────────────────
  ai: {
    /** Fast model for the live clue warning (needs ~1–2 s). */
    quickCheckModel: 'claude-haiku-4-5',
    /** Model for the full clue review that decides penalties. */
    reviewModel: 'claude-opus-5',
    /** Model for hint clues and replacement clues. */
    hintModel: 'claude-opus-5',
    /** If the main model errors or is slow, the request is retried once on this faster model. */
    fallbackModel: 'claude-haiku-4-5',
    /** How long the main model gets before switching to the fallback model (ms). */
    reviewPrimaryMs: 10000,
    hintPrimaryMs: 6000,
    /**
     * How strict the clue review is. 'lenient' follows the game rules: flag only
     * unconnected or factually wrong clues, and allow when in doubt.
     * 'strict' is reserved for a future strict mode.
     */
    reviewStrictness: 'lenient' as 'lenient' | 'strict',
  },

  // ── Player names ──────────────────────────────────────────
  nameMinLength: 1,
  nameMaxLength: 20,

  // ── Word selection ────────────────────────────────────────
  wordMinLength: 3,
  wordMaxLength: 10,
  /**
   * The generator is offered this many candidate words per grid and places
   * the best-fitting 15. Unused candidates go back in the bank.
   */
  candidatePoolPerGrid: 26,

  // ── Grid size & quality ───────────────────────────────────
  grid: {
    minRows: 9,
    minCols: 9,
    maxRows: 15,
    /**
     * Width is capped lower than height so that every cell is at least ~28px
     * wide on a small (360px) phone: floor((360 - 2 × 8px margin) / 28) = 12.
     * Taller grids are fine because the solving screen scrolls vertically.
     */
    maxCols: 12,
    /** Longest side ÷ shortest side. 1.0 is a perfect square. */
    maxAspectRatio: 1.5,
    /** Share of the bounding box that must be letters (not black squares). */
    minDensity: 0.36,
    /** Largest square block of black cells allowed (e.g. 5 means no 6×6 empty area). */
    maxEmptySquare: 5,
    /** At least this share of words must cross two or more other words. */
    minShareWithTwoCrossings: 0.6,
    /** Build this many candidate grids and keep the best one. */
    attemptsPerGrid: 40,
    /** Give up and redraw words after this many failed batches. */
    maxWordRedraws: 30,
  },

  // ── Fairness between Grid A and Grid B ────────────────────
  balance: {
    /** Bounding-box areas may differ by at most this share of the larger one. */
    maxAreaDifference: 0.2,
    /** Total letters across all 15 answers may differ by at most this share. */
    maxLetterDifference: 0.1,
    /** Number of long (8+ letter) answers may differ by at most this. */
    maxLongWordDifference: 2,
    longWordLength: 8,
  },
} as const;

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
