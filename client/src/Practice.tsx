import { useRef, useState } from 'react';
import type { Difficulty } from '../../shared/config';
import type { PuzzleView } from '../../shared/puzzle';
import { checkPractice, createPractice } from './api';
import { DifficultyPicker, LABELS } from './components/DifficultyPicker';
import { Loading, Logo, MuteButton } from './components/ui';
import { local } from './lib/storage';
import { navigate } from './lib/router';
import { SolveScreen } from './solve/SolveScreen';
import { formatTime } from './solve/Timer';

type Screen = { name: 'menu' } | { name: 'loading' } | { name: 'solve'; puzzle: PuzzleView; startedAt: number };

export function Practice() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [difficulty, setDifficulty] = useState<Difficulty>(() => (local.get('cd.difficulty') as Difficulty) || 'medium');
  const [error, setError] = useState('');
  const [finalMs, setFinalMs] = useState<number>();
  const lastElapsed = useRef(0);

  const start = async () => {
    setError('');
    setFinalMs(undefined);
    setScreen({ name: 'loading' });
    try {
      const [puzzle] = await Promise.all([createPractice(difficulty), new Promise((r) => setTimeout(r, 700))]);
      setScreen({ name: 'solve', puzzle, startedAt: Date.now() });
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
        startedAt={screen.startedAt}
        finalMs={finalMs}
        readOnly={finalMs !== undefined}
        onCheck={async (entries) => {
          const r = await checkPractice(screen.puzzle.id, entries);
          lastElapsed.current = r.elapsedMs;
          return r;
        }}
        onSolved={() => setFinalMs(lastElapsed.current)}
        onExit={() => setScreen({ name: 'menu' })}
        headerExtra={<MuteButton />}
        overlay={finalMs !== undefined && (
          <div className="overlay">
            <div className="card solved-card">
              <div className="solved-mark" aria-hidden>✓</div>
              <h2>Solved!</h2>
              <p className="solved-time">{formatTime(finalMs)}</p>
              <div className="card-actions">
                <button className="primary" onClick={start}>New puzzle</button>
                <button className="ghost" onClick={() => setScreen({ name: 'menu' })}>Menu</button>
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
        <h1>Practice solo</h1>
        <p className="tagline">Warm up on a generated grid. The clues are dictionary definitions.</p>
        <div className="panel">
          <DifficultyPicker value={difficulty} onChange={(d) => { setDifficulty(d); local.set('cd.difficulty', d); }} />
          <button className="primary big" onClick={start}>Start puzzle</button>
          {error && <p className="message">{error}</p>}
        </div>
      </div>
    </div>
  );
}
