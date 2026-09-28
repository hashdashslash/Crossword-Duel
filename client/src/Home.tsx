import { useState } from 'react';
import { CONFIG, type Difficulty } from '../../shared/config';
import { validateName } from '../../shared/rules';
import { DifficultyPicker } from './components/DifficultyPicker';
import { Logo } from './components/ui';
import { getSocket } from './game/socket';
import { tokenKey } from './game/useGame';
import { navigate } from './lib/router';
import { local, session } from './lib/storage';

export const NAME_KEY = 'cd.name';

export function NameField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span>Your name</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, CONFIG.nameMaxLength + 5))}
        maxLength={CONFIG.nameMaxLength}
        placeholder="e.g. Sam"
        autoComplete="nickname"
        autoFocus={autoFocus}
      />
    </label>
  );
}

export function Home() {
  const [name, setName] = useState(() => local.get(NAME_KEY) ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(() => (local.get('cd.difficulty') as Difficulty) || 'medium');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = () => {
    const check = validateName(name);
    if (!check.ok) return setError(check.error);
    setError('');
    setBusy(true);
    local.set(NAME_KEY, check.name);
    local.set('cd.difficulty', difficulty);
    getSocket().emit('room:create', { name: check.name, difficulty }, (res) => {
      setBusy(false);
      if (!res.ok) return setError(res.error);
      session.set(tokenKey(res.code), res.token);
      navigate(`/g/${res.code}`);
    });
  };

  const join = () => {
    const clean = code.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length !== 4) return setError('Game codes are 4 letters.');
    const check = validateName(name);
    if (check.ok) local.set(NAME_KEY, check.name);
    navigate(`/g/${clean}`);
  };

  return (
    <div className="page-center">
      <div className="narrow">
        <Logo />
        <h1>Crossword Duel</h1>
        <p className="tagline">Write clues. Swap puzzles. Race to solve.</p>

        <div className="panel">
          <NameField value={name} onChange={setName} />
          <div className="field">
            <span>Difficulty</span>
            <DifficultyPicker value={difficulty} onChange={setDifficulty} />
          </div>
          <button className="primary big" onClick={create} disabled={busy}>Create a game</button>
          <p className="muted small-print">You'll get a link to send to your opponent.</p>
        </div>

        <div className="panel join-panel">
          <label className="field">
            <span>Have a code?</span>
            <div className="inline-field">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="ABCD"
                aria-label="Game code"
                autoCapitalize="characters"
                className="code-input"
                onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
              />
              <button className="ghost" onClick={join}>Join</button>
            </div>
          </label>
        </div>

        {error && <p className="message center">{error}</p>}

        <div className="home-links">
          <button className="link" onClick={() => navigate('/practice')}>Practice solo</button>
          <HowToPlay />
        </div>
      </div>
    </div>
  );
}

function HowToPlay() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>How to play</button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="card dialog how" onClick={(e) => e.stopPropagation()}>
            <h2>How to play</h2>
            <ol>
              <li>Create a game and send the link to a friend. Both click <b>Ready</b>.</li>
              <li>You each get {CONFIG.wordsPerGrid} secret words. Write a clue for each — {CONFIG.secondsPerClue} seconds per word.</li>
              <li>Swap! Solve the crossword built from your opponent's clues.</li>
              <li>Lowest final time wins. Hints cost +{CONFIG.hintPenaltySeconds}s. Unfair clues (unconnected or factually wrong) cost their writer +{CONFIG.flaggedCluePenaltySeconds}s.</li>
            </ol>
            <p className="muted">Tricky clues slow your opponent down — that's the strategy. Inside jokes are fair game.</p>
            <div className="card-actions"><button className="primary" onClick={() => setOpen(false)}>Got it</button></div>
          </div>
        </div>
      )}
    </>
  );
}
