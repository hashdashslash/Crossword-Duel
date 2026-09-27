import { useEffect, useState } from 'react';
import { BOT_SPEEDS, CONFIG, type BotSpeed, type Difficulty } from '../../shared/config';
import { validateName } from '../../shared/rules';
import { DifficultyPicker } from './components/DifficultyPicker';
import { Logo } from './components/ui';
import { getSocket } from './game/socket';
import { tokenKey } from './game/useGame';
import { navigate } from './lib/router';
import { local, session } from './lib/storage';

export const NAME_KEY = 'cd.name';

export function useServerConfig() {
  const [config, setConfig] = useState<{ devTools: boolean; aiMode: string } | null>(null);
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setConfig).catch(() => setConfig({ devTools: false, aiMode: 'mock' }));
  }, []);
  return config;
}

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
  const [botSpeed, setBotSpeed] = useState<BotSpeed>('fast');
  const config = useServerConfig();

  const create = (bot: BotSpeed | null) => {
    const check = validateName(name);
    if (!check.ok) return setError(check.error);
    setError('');
    setBusy(true);
    local.set(NAME_KEY, check.name);
    local.set('cd.difficulty', difficulty);
    getSocket().emit('room:create', { name: check.name, difficulty, bot }, (res) => {
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
          <button className="primary big" onClick={() => create(null)} disabled={busy}>Create a game</button>
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

        {config?.devTools && (
          <div className="panel test-panel">
            <strong>Test mode</strong>
            <p className="muted">Play a full game against a bot. It writes simple clues (one left blank, one deliberately bad) and solves at the speed you pick.</p>
            <div className="segmented" role="radiogroup" aria-label="Bot speed">
              {BOT_SPEEDS.map((s) => (
                <button key={s} role="radio" aria-checked={s === botSpeed} className={s === botSpeed ? 'on' : ''} onClick={() => setBotSpeed(s)}>
                  {s === 'fast' ? 'Fast bot' : s === 'normal' ? 'Normal bot' : 'Slow bot'}
                </button>
              ))}
            </div>
            <button className="ghost wide" onClick={() => create(botSpeed)} disabled={busy}>Play against a bot</button>
            {config.aiMode === 'mock' && (
              <p className="muted small-print">AI is in pretend mode (no API key). Any clue containing the word “wrong” is treated as a bad clue.</p>
            )}
          </div>
        )}
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
