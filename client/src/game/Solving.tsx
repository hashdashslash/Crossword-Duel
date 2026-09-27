import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LABELS } from '../components/DifficultyPicker';
import { MuteButton } from '../components/ui';
import type { GameView, SolvingView } from '../../../shared/protocol';
import { SolveScreen, type CheckOutcome } from '../solve/SolveScreen';
import type { Entries } from '../solve/navigation';
import { formatTime } from '../solve/Timer';
import type { GameSocket } from './socket';

interface Props {
  view: GameView;
  solving: SolvingView;
  socket: GameSocket;
  toLocal: (serverTime: number) => number;
  banner: ReactNode;
  opponentName: string;
}

export function Solving({ view, solving, socket, toLocal, banner, opponentName }: Props) {
  const startedAt = useMemo(() => toLocal(solving.startedAt), [solving.startedAt, toLocal]);
  const [minimized, setMinimized] = useState(false);

  // Send grid changes to the server (batched), so progress and reconnects stay in sync.
  const pending = useRef<Entries | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = () => {
    if (pending.current) socket.emit('solve:entries', pending.current);
    pending.current = null;
  };
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onEntriesChange = (entries: Entries) => {
    pending.current = entries;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 150);
  };

  const onCheck = (entries: Entries) => new Promise<CheckOutcome>((resolve, reject) => {
    clearTimeout(timer.current);
    pending.current = null;
    socket.emit('solve:submit', entries, (res) => {
      if (res.ok) resolve(res);
      else reject(new Error(res.error));
    });
  });

  const requestHint = (clueIdx: number) => new Promise<string | null>((resolve) => {
    socket.emit('solve:hint', clueIdx, (res) => resolve(res.ok ? null : res.error));
  });

  const finished = solving.youFinished;

  return (
    <SolveScreen
      key={solving.puzzle.id}
      puzzle={solving.puzzle}
      label={`Duel · ${LABELS[view.difficulty]}`}
      shortLabel={LABELS[view.difficulty]}
      startedAt={startedAt}
      finalMs={finished ? solving.yourRawMs ?? undefined : undefined}
      initialEntries={solving.entries}
      onEntriesChange={onEntriesChange}
      onCheck={onCheck}
      readOnly={finished}
      progress={(filled, total) => (
        <>You {finished ? total : filled}/{total} · <span className="opp-progress">{opponentName} {solving.opponentFilled}/{total}</span></>
      )}
      hints={{ left: solving.hintsLeft, byClue: solving.hints, request: requestHint }}
      onResign={() => socket.emit('solve:resign')}
      headerExtra={<MuteButton />}
      banner={<>
        {banner}
        {finished && minimized && (
          <button className="banner as-button" onClick={() => setMinimized(false)}>
            You finished! Waiting for {opponentName} ({solving.opponentFilled}/{solving.total})
          </button>
        )}
      </>}
      overlay={finished && !minimized && (
        <div className="overlay">
          <div className="card finished-card">
            <div className="solved-mark" aria-hidden>✓</div>
            <h2>You finished!</h2>
            <p className="solved-time">{formatTime(solving.yourRawMs ?? 0)}</p>
            <p className="muted">Waiting for {opponentName}…</p>
            <div className="opp-meter" aria-label={`${opponentName} has filled ${solving.opponentFilled} of ${solving.total} words`}>
              <div className="opp-meter-bar"><span style={{ width: `${(solving.opponentFilled / solving.total) * 100}%` }} /></div>
              <span className="tabular">{solving.opponentFilled}/{solving.total}</span>
            </div>
            <button className="ghost small" onClick={() => setMinimized(true)}>Look at my grid</button>
          </div>
        </div>
      )}
    />
  );
}
