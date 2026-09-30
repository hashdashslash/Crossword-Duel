import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CONFIG } from '../../../shared/config';
import type { CellPos, PuzzleView } from '../../../shared/puzzle';
import { Confirm } from '../components/ui';
import { sfx } from '../lib/sound';
import { useIsTouch } from '../useIsTouch';
import { ClueLists, type HintProps } from './ClueList';
import { Grid, type CellError } from './Grid';
import { Keyboard } from './Keyboard';
import {
  activeClueIndex, arrow, backspace, buildBoard, clickCell, emptyEntries, firstCursor,
  isWordFilled, jumpToClue, nextWord, toggleDirection, typeLetter, type Arrow, type Cursor, type Entries,
} from './navigation';
import { Timer } from './Timer';

export interface CheckOutcome {
  solved: boolean;
  blanks: CellPos[];
  wrong: CellPos[];
}

export interface HintSupport {
  left: number;
  byClue: Record<number, string>;
  /** Resolves to an error message, or null on success. */
  request: (clueIdx: number) => Promise<string | null>;
}

interface Props {
  puzzle: PuzzleView;
  label: string;
  /** Shorter title for the cramped phone header. */
  shortLabel?: string;
  /** Local-clock time the solve started. */
  startedAt: number;
  /** Freezes the timer at this value. */
  finalMs?: number;
  initialEntries?: Entries;
  onEntriesChange?: (entries: Entries) => void;
  onCheck: (entries: Entries) => Promise<CheckOutcome>;
  onSolved?: () => void;
  onExit?: () => void;
  /** Replaces the "3/15 words" line, e.g. "You 3/15 · Opponent 7/15". */
  progress?: (filled: number, total: number) => ReactNode;
  hints?: HintSupport;
  onResign?: () => void;
  headerExtra?: ReactNode;
  banner?: ReactNode;
  overlay?: ReactNode;
  /** No more typing (finished, or game over). */
  readOnly?: boolean;
}

export function SolveScreen(props: Props) {
  const { puzzle, label, shortLabel, startedAt, finalMs, onCheck, hints, readOnly } = props;
  const board = useMemo(() => buildBoard(puzzle), [puzzle]);
  const [entries, setEntries] = useState<Entries>(() => props.initialEntries ?? emptyEntries(board));
  const [cursor, setCursor] = useState<Cursor>(() => firstCursor(board));
  const [errors, setErrors] = useState<Map<string, CellError>>(new Map());
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [showClues, setShowClues] = useState(false);
  const [confirmHint, setConfirmHint] = useState<number | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const isTouch = useIsTouch();
  const dialogOpen = confirmHint !== null || confirmResign;
  const locked = !!readOnly || dialogOpen;

  // Latest state for handlers without re-binding them every render.
  const state = useRef({ entries, cursor });
  state.current = { entries, cursor };
  const onEntriesChange = useRef(props.onEntriesChange);
  onEntriesChange.current = props.onEntriesChange;

  const apply = useCallback((next: { entries: Entries; cursor: Cursor }) => {
    const prev = state.current.entries;
    if (next.entries !== prev) {
      // Editing a square clears its error highlight.
      setErrors((errs) => {
        if (!errs.size) return errs;
        const copy = new Map(errs);
        for (const key of errs.keys()) {
          const [r, c] = key.split(',').map(Number) as [number, number];
          if (next.entries[r]![c] !== prev[r]![c]) copy.delete(key);
        }
        return copy;
      });
      setEntries(next.entries);
      onEntriesChange.current?.(next.entries);
    }
    setCursor(next.cursor);
  }, []);

  const letter = useCallback((ch: string) => {
    const { entries, cursor } = state.current;
    apply(typeLetter(board, entries, cursor, ch));
  }, [apply, board]);

  const back = useCallback(() => {
    const { entries, cursor } = state.current;
    apply(backspace(board, entries, cursor));
  }, [apply, board]);

  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const { entries, cursor } = state.current;
      if (/^[a-zA-Z]$/.test(e.key)) letter(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Delete') {
        if (!board.locked[cursor.row]![cursor.col]) {
          const next = entries.map((row) => [...row]);
          next[cursor.row]![cursor.col] = '';
          apply({ entries: next, cursor });
        }
      } else if (e.key.startsWith('Arrow')) setCursor(arrow(board, cursor, e.key as Arrow));
      else if (e.key === 'Tab') setCursor(nextWord(board, entries, cursor, e.shiftKey ? -1 : 1));
      else if (e.key === ' ') setCursor(toggleDirection(board, cursor));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, back, board, letter, locked]);

  const submit = async () => {
    if (checking || readOnly) return;
    setChecking(true);
    try {
      const result = await onCheck(state.current.entries);
      if (result.solved) {
        setErrors(new Map());
        setMessage('');
        sfx.solved();
        props.onSolved?.();
      } else {
        const errs = new Map<string, CellError>();
        for (const [r, c] of result.blanks) errs.set(`${r},${c}`, 'blank');
        for (const [r, c] of result.wrong) errs.set(`${r},${c}`, 'wrong');
        setErrors(errs);
        const parts = [];
        if (result.blanks.length) parts.push(`${result.blanks.length} empty ${result.blanks.length === 1 ? 'square' : 'squares'}`);
        if (result.wrong.length) parts.push(`${result.wrong.length} wrong ${result.wrong.length === 1 ? 'letter' : 'letters'}`);
        setMessage(`Not quite — ${parts.join(' and ')}. Keep going.`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not check the grid.');
    } finally {
      setChecking(false);
    }
  };

  const takeHint = async () => {
    if (confirmHint === null || !hints) return;
    setHintBusy(true);
    const error = await hints.request(confirmHint);
    setHintBusy(false);
    setConfirmHint(null);
    setMessage(error ?? '');
  };

  const activeIdx = activeClueIndex(board, cursor);
  const activeClue = activeIdx === undefined ? undefined : board.clues[activeIdx];
  const filledCount = board.clues.filter((c) => isWordFilled(entries, c)).length;
  const pick = (i: number) => {
    setCursor(jumpToClue(board, entries, i));
    setShowClues(false);
  };

  const canHint = (i: number) =>
    !!hints && !readOnly && hints.left > 0 && !board.clues[i]?.prefilled && !hints.byClue[i];
  const hintProps: HintProps | undefined = hints && {
    byClue: hints.byClue,
    canHint,
    onHint: (i) => { setShowClues(false); setConfirmHint(i); },
  };

  const clueBar = activeClue && activeIdx !== undefined && (
    <ClueBar
      clue={activeClue}
      hint={hints?.byClue[activeIdx]}
      showHintButton={canHint(activeIdx) && isTouch}
      onHint={() => setConfirmHint(activeIdx)}
      onPrev={() => setCursor(nextWord(board, entries, cursor, -1))}
      onNext={() => setCursor(nextWord(board, entries, cursor, 1))}
      onToggle={() => setCursor(toggleDirection(board, cursor))}
    />
  );

  return (
    <div className={`solve ${isTouch ? 'touch' : ''} ${puzzle.cols > 15 ? 'big' : ''}`}>
      <header className="solve-header">
        {props.onExit && <button className="ghost icon" onClick={props.onExit} aria-label="Back to menu">←</button>}
        <div className="solve-title">
          <span className="label">{isTouch ? (shortLabel ?? label) : label}</span>
          <span className="progress">
            {props.progress ? props.progress(filledCount, board.clues.length) : `${filledCount}/${board.clues.length}${isTouch ? '' : ' words'}`}
          </span>
        </div>
        <Timer startedAt={startedAt} finalMs={finalMs} />
        {isTouch && <span className="header-break" aria-hidden />}
        {hints && (
          <span className="hint-count" title="Hints remaining" aria-label={`${hints.left} hints left`}>
            Hints {hints.left}
          </span>
        )}
        {props.headerExtra}
        {isTouch && <button className="ghost small" onClick={() => setShowClues(true)}>Clues</button>}
        {props.onResign && !readOnly && !isTouch && (
          <button className="ghost small" onClick={() => setConfirmResign(true)}>Resign</button>
        )}
        <button className="primary submit-btn" onClick={submit} disabled={checking || readOnly}>
          {checking ? 'Checking…' : 'Submit'}
        </button>
      </header>

      {props.banner}
      <div className="message" aria-live="polite">{message}</div>

      <main className="solve-main">
        <div className="board-col">
          {!isTouch && clueBar}
          <div className="grid-scroll">
            <Grid board={board} entries={entries} cursor={cursor} errors={errors} onCellClick={(r, c) => { if (!locked) setCursor(clickCell(board, cursor, r, c)); }} />
          </div>
        </div>
        {!isTouch && <ClueLists board={board} entries={entries} cursor={cursor} onPick={pick} hints={hintProps} />}
      </main>

      {isTouch && (
        <div className="touch-bottom">
          {clueBar}
          {!readOnly && <Keyboard onLetter={letter} onBackspace={back} />}
        </div>
      )}

      {showClues && (
        <div className="sheet-backdrop" onClick={() => setShowClues(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>Clues</strong>
              <div className="sheet-actions">
                {props.onResign && !readOnly && (
                  <button className="ghost small" onClick={() => { setShowClues(false); setConfirmResign(true); }}>Resign</button>
                )}
                <button className="ghost small" onClick={() => setShowClues(false)}>Done</button>
              </div>
            </div>
            <ClueLists board={board} entries={entries} cursor={cursor} onPick={pick} hints={hintProps} />
          </div>
        </div>
      )}

      {confirmHint !== null && hints && (
        <Confirm
          title="Use a hint?"
          body={<p>This adds {CONFIG.hintPenaltySeconds} seconds to your final time. Hints remaining: {hints.left} of {CONFIG.hintsPerGame}.</p>}
          yes={hintBusy ? 'Writing a hint…' : 'Yes'}
          busy={hintBusy}
          onYes={takeHint}
          onNo={() => setConfirmHint(null)}
        />
      )}

      {confirmResign && props.onResign && (
        <Confirm
          title="Are you sure you want to resign?"
          body={<p>The game ends now and your opponent wins.</p>}
          yes="Yes, resign"
          onYes={() => { setConfirmResign(false); props.onResign!(); }}
          onNo={() => setConfirmResign(false)}
        />
      )}

      {props.overlay}
    </div>
  );
}

function ClueBar({ clue, hint, showHintButton, onHint, onPrev, onNext, onToggle }: {
  clue: { number: number; direction: string; text: string; prefilled?: string };
  hint?: string;
  showHintButton: boolean;
  onHint: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}) {
  const tap = (fn: () => void) => (e: React.PointerEvent) => { e.preventDefault(); fn(); };
  return (
    <div className="clue-bar">
      <button className="clue-bar-arrow" onPointerDown={tap(onPrev)} aria-label="Previous clue">‹</button>
      <div className="clue-bar-text" onPointerDown={tap(onToggle)}>
        <span className="clue-bar-num">{clue.number}{clue.direction === 'across' ? 'A' : 'D'}</span>
        <span className="clue-bar-body">
          <span className={clue.prefilled ? 'prefilled-text' : ''}>{clue.text}</span>
          {hint && <span className="hint-text">Hint: {hint}</span>}
        </span>
      </div>
      {showHintButton && <button className="hint-btn" onPointerDown={tap(onHint)}>Hint</button>}
      <button className="clue-bar-arrow" onPointerDown={tap(onNext)} aria-label="Next clue">›</button>
    </div>
  );
}
