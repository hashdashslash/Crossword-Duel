import { useEffect, useRef } from 'react';
import type { Direction } from '../../../shared/puzzle';
import { activeClueIndex, isWordFilled, type Board, type Cursor, type Entries } from './navigation';

export interface HintProps {
  byClue: Record<number, string>;
  canHint: (clueIdx: number) => boolean;
  onHint: (clueIdx: number) => void;
}

interface Props {
  board: Board;
  entries: Entries;
  cursor: Cursor;
  onPick: (clueIdx: number) => void;
  hints?: HintProps;
}

export function ClueLists(props: Props) {
  return (
    <div className="clue-lists">
      <ClueList dir="across" {...props} />
      <ClueList dir="down" {...props} />
    </div>
  );
}

function ClueList({ dir, board, entries, cursor, onPick, hints }: Props & { dir: Direction }) {
  const activeRef = useRef<HTMLLIElement>(null);
  const activeIdx = activeClueIndex(board, cursor);
  const crossDir: Direction = cursor.dir === 'across' ? 'down' : 'across';
  const crossIdx = board.wordAt[cursor.row]?.[cursor.col]?.[crossDir];
  const items = board.order.filter((i) => board.clues[i]!.direction === dir);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <section className="clue-list">
      <h2>{dir === 'across' ? 'Across' : 'Down'}</h2>
      <ol>
        {items.map((i) => {
          const clue = board.clues[i]!;
          const classes = ['clue'];
          if (i === activeIdx) classes.push('active');
          else if (i === crossIdx) classes.push('cross');
          if (isWordFilled(entries, clue)) classes.push('filled');
          if (clue.prefilled) classes.push('prefilled');
          const hint = hints?.byClue[i];
          return (
            <li key={i} ref={i === activeIdx ? activeRef : undefined} className={classes.join(' ')} onClick={() => onPick(i)}>
              <span className="clue-num">{clue.number}</span>
              <span className="clue-body">
                <span className="clue-text">{clue.text}</span>
                {hint && <span className="hint-text">Hint: {hint}</span>}
              </span>
              {hints?.canHint(i) && (
                <button
                  className="hint-btn"
                  onClick={(e) => { e.stopPropagation(); hints.onHint(i); }}
                  aria-label={`Hint for ${clue.number} ${dir}`}
                >
                  Hint
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
