import { useState } from 'react';
import { CONFIG, type Difficulty } from '../../shared/config';
import { validateName } from '../../shared/rules';
import { DifficultyPicker } from './components/DifficultyPicker';
import { HowToPlayButton } from './components/HowToPlay';
import { Logo } from './components/ui';
import { getSocket } from './game/socket';
import { tokenKey } from './game/useGame';
import { navigate } from './lib/router';
import { dailyNumber } from '../../shared/daily';
import { dailyResult, localDate } from './lib/daily';
import { AccountBar } from './Account';
import { useAuth } from './lib/auth';
import { local, session } from './lib/storage';
import { InviteList } from './Friends';
import { useSocial } from './lib/social';

export const NAME_KEY = 'cd.name';

export function NameField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { user } = useAuth();
  if (user) {
    return (
      <div className="field">
        <span>Playing as</span>
        <p className="difficulty-read">{user.username}</p>
      </div>
    );
  }
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
  const { user } = useAuth();
  const { invites } = useSocial();

  const create = () => {
    const check = validateName(user?.username ?? name);
    if (!check.ok) return setError(check.error);
    setError('');
    setBusy(true);
    if (!user) local.set(NAME_KEY, check.name);
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
    if (check.ok && !user) local.set(NAME_KEY, check.name);
    navigate(`/g/${clean}`);
  };

  return (
    <div className="page-center">
      <div className="narrow">
        <AccountBar />
        <Logo />
        <h1>Crossword Duel</h1>
        <p className="tagline">Write clues. Swap puzzles. Race to solve.</p>

        <InviteList invites={invites} />

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

        <DailyCard />

        <div className="home-links">
          <button className="link" onClick={() => navigate('/practice')}>Practice solo</button>
          <HowToPlayButton />
        </div>
      </div>
    </div>
  );
}

function DailyCard() {
  const today = localDate();
  const done = dailyResult(today) !== null;
  return (
    <button className="panel daily-card" onClick={() => navigate('/daily')}>
      <span>
        <strong>Daily puzzle #{dailyNumber(today)}</strong>
        <span className="muted small-print">{done ? 'Solved today ✓' : 'One crossword a day, the same for everyone'}</span>
      </span>
      <span aria-hidden className="daily-arrow">→</span>
    </button>
  );
}
