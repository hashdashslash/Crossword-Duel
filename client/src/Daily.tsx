import { useEffect, useRef, useState } from 'react';
import { dailyNumber } from '../../shared/daily';
import type { PuzzleView } from '../../shared/puzzle';
import { checkPractice, createDaily } from './api';
import { Loading, Logo, MuteButton } from './components/ui';
import {
  clearDailyProgress, dailyResult, dailyShareText, dailyStreak, loadDailyProgress, localDate, saveDailyProgress, saveDailyResult,
} from './lib/daily';
import { navigate } from './lib/router';
import { SolveScreen } from './solve/SolveScreen';
import { formatTime } from './solve/Timer';

type Screen =
  | { name: 'menu' }
  | { name: 'loading'; text: string }
  | { name: 'solve'; puzzle: PuzzleView; number: number; date: string; startedAt: number; entries?: string[][] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Saved letters fit this puzzle (same shape), so they can be put back. */
const fits = (entries: string[][] | undefined, puzzle: PuzzleView) =>
  !!entries && entries.length === puzzle.rows && entries.every((row, r) => row.length === puzzle.cols && row.every((ch, c) => typeof ch === 'string' && (puzzle.open[r]![c] || ch === '')));

export function Daily() {
  const [today] = useState(() => localDate());
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [error, setError] = useState('');
  const [finalMs, setFinalMs] = useState<number>();
  const [solvedMs, setSolvedMs] = useState(() => dailyResult(today));
  const number = dailyNumber(today);
  const lastElapsed = useRef(0);

  const [progress, setProgress] = useState(() => loadDailyProgress(today));
  /** The unfinished solve's latest letters, saved (with the time so far) as they change and when leaving. */
  const latest = useRef<{ date: string; entries: string[][]; startedAt: number } | null>(null);
  const saveProgress = () => {
    const l = latest.current;
    if (l) saveDailyProgress({ date: l.date, entries: l.entries, elapsedMs: Date.now() - l.startedAt });
  };
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') saveProgress(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveProgress);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveProgress);
      saveProgress();
    };
  }, []);

  const start = async () => {
    setError('');
    setScreen({ name: 'loading', text: "Loading today's puzzle…" });
    const saved = solvedMs === null ? loadDailyProgress(today) : null;
    try {
      const [daily] = await Promise.all([
        (async () => {
          // The clues are written once a day; if they're not ready yet, wait for them.
          for (let tries = 0; tries < 40; tries++) {
            const res = await createDaily(today, saved?.elapsedMs);
            if (!('pending' in res)) return res;
            setScreen({ name: 'loading', text: "Writing today's clues… this can take a minute or two." });
            await sleep(3000);
          }
          throw new Error("Today's clues are taking longer than usual. Please try again in a few minutes.");
        })(),
        sleep(500),
      ]);
      const entries = fits(saved?.entries, daily.puzzle) ? saved!.entries : undefined;
      setScreen({ name: 'solve', puzzle: daily.puzzle, number: daily.number, date: daily.date, startedAt: Date.now() - (entries ? saved!.elapsedMs : 0), entries });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the daily puzzle.');
      setScreen({ name: 'menu' });
    }
  };

  if (screen.name === 'loading') return <Loading text={screen.text} />;

  if (screen.name === 'solve') {
    return (
      <SolveScreen
        key={screen.puzzle.id}
        puzzle={screen.puzzle}
        label={`Daily puzzle #${screen.number}`}
        shortLabel={`Daily #${screen.number}`}
        startedAt={screen.startedAt}
        initialEntries={screen.entries}
        onEntriesChange={(entries) => {
          if (finalMs !== undefined || solvedMs !== null) return;
          latest.current = { date: screen.date, entries, startedAt: screen.startedAt };
          saveProgress();
        }}
        finalMs={finalMs}
        readOnly={finalMs !== undefined}
        onCheck={async (entries) => {
          const r = await checkPractice(screen.puzzle.id, entries);
          lastElapsed.current = r.elapsedMs;
          return r;
        }}
        onSolved={() => {
          saveDailyResult(screen.date, lastElapsed.current);
          latest.current = null;
          clearDailyProgress();
          setSolvedMs(dailyResult(screen.date));
          setFinalMs(lastElapsed.current);
        }}
        onExit={() => {
          saveProgress();
          latest.current = null;
          setProgress(loadDailyProgress(today));
          setScreen({ name: 'menu' });
        }}
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
        <p className="tagline">A Sunday-size crossword every day, the same for everyone: a 21×21 grid with 120 to 140 answers and clues written to make you think. Your progress is saved on this device, so you can come back to it.</p>
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
              <button className="primary big" onClick={start}>{progress ? "Continue today's puzzle" : "Start today's puzzle"}</button>
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
