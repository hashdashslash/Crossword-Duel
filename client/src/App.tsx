import { useState } from 'react';
import { DIFFICULTIES, type Difficulty } from '../../shared/config';
import type { PuzzleView } from '../../shared/puzzle';
import { checkPractice, createPractice } from './api';
import { SolveScreen } from './solve/SolveScreen';

type Screen = { name: 'menu' } | { name: 'loading' } | { name: 'solve'; puzzle: PuzzleView };

const DIFFICULTY_KEY = 'cd.difficulty';
const LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function savedDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem(DIFFICULTY_KEY) as Difficulty | null;
    if (d && DIFFICULTIES.includes(d)) return d;
  } catch { /* storage unavailable */ }
  return 'medium';
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [difficulty, setDifficulty] = useState<Difficulty>(savedDifficulty);
  const [error, setError] = useState('');

  const choose = (d: Difficulty) => {
    setDifficulty(d);
    try { localStorage.setItem(DIFFICULTY_KEY, d); } catch { /* ignore */ }
  };

  const start = async () => {
    setError('');
    setScreen({ name: 'loading' });
    try {
      const [puzzle] = await Promise.all([createPractice(difficulty), new Promise((r) => setTimeout(r, 700))]);
      setScreen({ name: 'solve', puzzle });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build a puzzle.');
      setScreen({ name: 'menu' });
    }
  };

  if (screen.name === 'loading') return <Loading text="Building your puzzle…" />;

  if (screen.name === 'solve') {
    return (
      <SolveScreen
        key={screen.puzzle.id}
        puzzle={screen.puzzle}
        label={`Practice · ${LABELS[difficulty]}`}
        shortLabel={LABELS[difficulty]}
        onCheck={(entries) => checkPractice(screen.puzzle.id, entries)}
        onNewPuzzle={start}
        onExit={() => setScreen({ name: 'menu' })}
      />
    );
  }

  return (
    <div className="menu">
      <div className="menu-inner">
        <Logo />
        <h1>Crossword Duel</h1>
        <p className="tagline">Write clues. Swap puzzles. Race to solve.</p>

        <div className="menu-card">
          <h2>Practice solo</h2>
          <p className="muted">Solve a generated grid. Clues are scrambled answers for now — real player clues arrive in a later phase.</p>
          <div className="segmented" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button key={d} role="radio" aria-checked={d === difficulty} className={d === difficulty ? 'on' : ''} onClick={() => choose(d)}>
                {LABELS[d]}
              </button>
            ))}
          </div>
          <button className="primary big" onClick={start}>Start puzzle</button>
          {error && <p className="message">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function Logo() {
  // A tiny 3×3 crossword as the logo.
  const pattern = [1, 1, 1, 1, 0, 1, 1, 1, 1];
  return (
    <div className="logo" aria-hidden>
      {pattern.map((on, i) => <span key={i} className={!on ? 'dark' : i % 2 ? 'blue' : ''} />)}
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div className="loading">
      <div className="loading-grid" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => <span key={i} style={{ animationDelay: `${(i % 3 + Math.floor(i / 3)) * 120}ms` }} />)}
      </div>
      <p>{text}</p>
    </div>
  );
}
