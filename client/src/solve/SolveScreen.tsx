import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CheckResult, PuzzleView } from '../../../shared/puzzle';
import { ClueLists } from './ClueList';
import { Grid, type CellError } from './Grid';
import { Keyboard } from './Keyboard';
import {
  activeClueIndex, arrow, backspace, buildBoard, clickCell, emptyEntries, firstCursor,
  isWordFilled, jumpToClue, nextWord, toggleDirection, typeLetter, type Arrow, type Cursor, type Entries,
} from './navigation';
import { formatTime, Timer } from './Timer';
import { useIsTouch } from '../useIsTouch';

interface Props {
  puzzle: PuzzleView;
  label: string;
  /** Shorter title for the cramped phone header. */
  shortLabel?: string;
  onCheck: (entries: Entries) => Promise<CheckResult>;
  onNewPuzzle: () => void;
  onExit: () => void;
}

export function SolveScreen({ puzzle, label, shortLabel, onCheck, onNewPuzzle, onExit }: Props) {
  const board = useMemo(() => buildBoard(puzzle), [puzzle]);
  const [entries, setEntries] = useState<Entries>(() => emptyEntries(board));
  const [cursor, setCursor] = useState<Cursor>(() => firstCursor(board));
  const [errors, setErrors] = useState<Map<string, CellError>>(new Map());
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const [finalMs, setFinalMs] = useState<number>();
  const [showClues, setShowClues] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const isTouch = useIsTouch();
  const solved = finalMs !== undefined;

  // Latest state for the keyboard handler without re-binding it every render.
  const state = useRef({ entries, cursor });
  state.current = { entries, cursor };

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
    if (solved) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
  }, [apply, back, board, letter, solved]);

  const submit = async () => {
    if (checking || solved) return;
    setChecking(true);
    try {
      const result = await onCheck(entries);
      if (result.solved) {
        setErrors(new Map());
        setFinalMs(result.elapsedMs);
        setMessage('');
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

  const activeIdx = activeClueIndex(board, cursor);
  const activeClue = activeIdx === undefined ? undefined : board.clues[activeIdx];
  const filledCount = board.clues.filter((c) => isWordFilled(entries, c)).length;
  const pick = (i: number) => {
    setCursor(jumpToClue(board, entries, i));
    setShowClues(false);
  };

  return (
    <div className={`solve ${isTouch ? 'touch' : ''}`}>
      <header className="solve-header">
        <button className="ghost" onClick={onExit} aria-label="Back to menu">←</button>
        <div className="solve-title">
          <span className="label">{isTouch ? (shortLabel ?? label) : label}</span>
          <span className="progress">{filledCount}/{board.clues.length}{isTouch ? '' : ' words'}</span>
        </div>
        <Timer startedAt={startedAt} finalMs={finalMs} />
        {isTouch && (
          <button className="ghost small" onClick={() => setShowClues(true)}>Clues</button>
        )}
        <button className="primary" onClick={submit} disabled={checking || solved}>
          {checking ? 'Checking…' : 'Submit'}
        </button>
      </header>

      <div className="message" aria-live="polite">{message}</div>

      <main className="solve-main">
        <div className="board-col">
          {!isTouch && activeClue && <ClueBar clue={activeClue} onPrev={() => setCursor(nextWord(board, entries, cursor, -1))} onNext={() => setCursor(nextWord(board, entries, cursor, 1))} onToggle={() => setCursor(toggleDirection(board, cursor))} />}
          <div className="grid-scroll">
            <Grid board={board} entries={entries} cursor={cursor} errors={errors} onCellClick={(r, c) => setCursor(clickCell(board, cursor, r, c))} />
          </div>
        </div>
        {!isTouch && <ClueLists board={board} entries={entries} cursor={cursor} onPick={pick} />}
      </main>

      {isTouch && (
        <div className="touch-bottom">
          {activeClue && <ClueBar clue={activeClue} onPrev={() => setCursor(nextWord(board, entries, cursor, -1))} onNext={() => setCursor(nextWord(board, entries, cursor, 1))} onToggle={() => setCursor(toggleDirection(board, cursor))} />}
          <Keyboard onLetter={letter} onBackspace={back} />
        </div>
      )}

      {showClues && (
        <div className="sheet-backdrop" onClick={() => setShowClues(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>Clues</strong>
              <button className="ghost small" onClick={() => setShowClues(false)}>Done</button>
            </div>
            <ClueLists board={board} entries={entries} cursor={cursor} onPick={pick} />
          </div>
        </div>
      )}

      {solved && (
        <div className="overlay">
          <div className="card solved-card">
            <div className="solved-mark" aria-hidden>✓</div>
            <h2>Solved!</h2>
            <p className="solved-time">{formatTime(finalMs!)}</p>
            <div className="card-actions">
              <button className="primary" onClick={onNewPuzzle}>New puzzle</button>
              <button className="ghost" onClick={onExit}>Menu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClueBar({ clue, onPrev, onNext, onToggle }: {
  clue: { number: number; direction: string; text: string };
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
        <span>{clue.text}</span>
      </div>
      <button className="clue-bar-arrow" onPointerDown={tap(onNext)} aria-label="Next clue">›</button>
    </div>
  );
}
