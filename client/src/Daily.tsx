import { useRef, useState } from 'react';
import { dailyNumber } from '../../shared/daily';
import type { PuzzleView } from '../../shared/puzzle';
import { checkPractice, createDaily } from './api';
import { Loading, Logo, MuteButton } from './components/ui';
import { dailyResult, dailyShareText, dailyStreak, localDate, saveDailyResult } from './lib/daily';
import { navigate } from './lib/router';
import { SolveScreen } from './solve/SolveScreen';
import { formatTime } from './solve/Timer';

type Screen = { name: 'menu' } | { name: 'loading' } | { name: 'solve'; puzzle: PuzzleView; number: number; date: string; startedAt: number };

export function Daily() {
  const [today] = useState(() => localDate());
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [error, setError] = useState('');
  const [finalMs, setFinalMs] = useState<number>();
  const [solvedMs, setSolvedMs] = useState(() => dailyResult(today));
  const number = dailyNumber(today);
  const lastElapsed = useRef(0);

  const start = async () => {
    setError('');
    setScreen({ name: 'loading' });
    try {
      const [daily] = await Promise.all([createDaily(today), new Promise((r) => setTimeout(r, 500))]);
      setScreen({ name: 'solve', puzzle: daily.puzzle, number: daily.number, date: daily.date, startedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the daily puzzle.');
      setScreen({ name: 'menu' });
    }
  };

  if (screen.name === 'loading') return <Loading text="Loading today's puzzle…" />;

  if (screen.name === 'solve') {
    return (
      <SolveScreen
        key={screen.puzzle.id}
        puzzle={screen.puzzle}
        label={`Daily puzzle #${screen.number}`}
        shortLabel={`Daily #${screen.number}`}
        startedAt={screen.startedAt}
        finalMs={finalMs}
        readOnly={finalMs !== undefined}
        onCheck={async (entries) => {
          const r = await checkPractice(screen.puzzle.id, entries);
          lastElapsed.current = r.elapsedMs;
          return r;
        }}
        onSolved={() => {
          saveDailyResult(screen.date, lastElapsed.current);
          setSolvedMs(dailyResult(screen.date));
          setFinalMs(lastElapsed.current);
        }}
        onExit={() => setScreen({ name: 'menu' })}
        headerExtra={<MuteButton />}
        overlay={finalMs !== undefined && (
          <div className="overlay">
            <div className="card solved-card">
              <div className="solved-mark" aria-hidden>✓</div>
              <h2>Solved!</h2>
              <p className="solved-time">{formatTime(finalMs)}</p>
              <StreakLine />
              <div className="card-actions">
                <ShareDaily number={screen.number} ms={solvedMs ?? finalMs} />
                <button className="ghost" onClick={() => navigate('/')}>Home</button>
              </div>
            </div>
          </div>
        )}
      />
    );
  }

  return (
    <div className="page-center">
      <div className="narrow">
        <button className="ghost small back-link" onClick={() => navigate('/')}>← Home</button>
        <Logo />
        <h1>Daily puzzle #{number}</h1>
        <p className="tagline">One crossword a day, the same for everyone. Clues are dictionary definitions.</p>
        <div className="panel">
          {solvedMs !== null ? (
            <>
              <p className="daily-done">You solved today's puzzle in <b>{formatTime(solvedMs)}</b>.</p>
              <StreakLine />
              <ShareDaily number={number} ms={solvedMs} />
              <p className="muted small-print">A new puzzle arrives at midnight.</p>
              <button className="ghost" onClick={start}>Play it again (just for fun)</button>
            </>
          ) : (
            <>
              <StreakLine />
              <button className="primary big" onClick={start}>Start today's puzzle</button>
            </>
          )}
          {error && <p className="message">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function StreakLine() {
  const streak = dailyStreak();
  if (!streak) return null;
  return <p className="streak">🔥 {streak}-day streak</p>;
}

function ShareDaily({ number, ms }: { number: number; ms: number }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const text = dailyShareText(number, ms, dailyStreak(), location.origin);
    if ('share' in navigator) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy your result:', text);
    }
  };
  return <button className="primary" onClick={share}>{copied ? 'Copied!' : 'Share'}</button>;
}
