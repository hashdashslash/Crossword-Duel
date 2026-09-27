import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { activeClueIndex, clueCells, type Board, type Cursor, type Entries } from './navigation';

export type CellError = 'blank' | 'wrong';

interface Props {
  board: Board;
  entries: Entries;
  cursor: Cursor;
  errors: Map<string, CellError>;
  onCellClick: (row: number, col: number) => void;
  /** Largest cell size in px (desktop). */
  maxCell?: number;
}

const MIN_CELL = 28;

export function Grid({ board, entries, cursor, errors, onCellClick, maxCell = 46 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(36);

  // Fit the grid to the available width (never below the tappable minimum).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth - 2; // outer border
      setCell(Math.max(MIN_CELL, Math.min(maxCell, Math.floor(width / board.cols))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [board.cols, maxCell]);

  // Keep the active square in view (matters on phones where the grid scrolls).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cursor.row, cursor.col]);

  const activeIdx = activeClueIndex(board, cursor);
  const inWord = new Set(activeIdx === undefined ? [] : clueCells(board.clues[activeIdx]!).map(([r, c]) => `${r},${c}`));
  const numbers = new Map(board.clues.map((c) => [`${c.row},${c.col}`, c.number]));

  return (
    <div className="grid-wrap" ref={wrapRef}>
      <div
        className="grid"
        role="grid"
        aria-label="Crossword grid"
        style={{
          gridTemplateColumns: `repeat(${board.cols}, ${cell}px)`,
          gridTemplateRows: `repeat(${board.rows}, ${cell}px)`,
          ['--cell' as string]: `${cell}px`,
        }}
      >
        {board.open.map((row, r) =>
          row.map((open, c) => {
            const key = `${r},${c}`;
            if (!open) return <div key={key} className="cell black" aria-hidden />;
            const isActive = cursor.row === r && cursor.col === c;
            const classes = ['cell'];
            if (isActive) classes.push('active');
            else if (inWord.has(key)) classes.push('in-word');
            const err = errors.get(key);
            if (err) classes.push(`err-${err}`);
            if (board.locked[r]![c]) classes.push('locked');
            return (
              <div
                key={key}
                ref={isActive ? activeRef : undefined}
                className={classes.join(' ')}
                role="gridcell"
                aria-selected={isActive}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onCellClick(r, c);
                }}
              >
                {numbers.has(key) && <span className="num">{numbers.get(key)}</span>}
                <span className="letter">{entries[r]![c]}</span>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
