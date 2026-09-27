import { useEffect, useState } from 'react';
import type { GameResult, GameView } from '../../../shared/protocol';
import { validateName } from '../../../shared/rules';
import { Loading, Logo } from '../components/ui';
import { NAME_KEY, NameField } from '../Home';
import { navigate } from '../lib/router';
import { local, session } from '../lib/storage';
import { useNow } from '../lib/useNow';
import { DevPanel } from './DevPanel';
import { Lobby } from './Lobby';
import { Reveal } from './Reveal';
import { Solving } from './Solving';
import { tokenKey, useGame } from './useGame';
import { Writing } from './Writing';

export function GamePage({ code }: { code: string }) {
  const game = useGame(code);
  const { view, status, socket } = game;
  // Keep showing the reveal until this player moves on, even if the room returns to the lobby.
  const [shownResult, setShownResult] = useState<GameResult | null>(null);

  useEffect(() => {
    if (view?.phase === 'finished' && view.result) setShownResult(view.result);
  }, [view?.phase, view?.result]);

  const leave = () => {
    socket.emit('room:leave');
    session.remove(tokenKey(code));
    navigate('/');
  };

  if (status === 'needs-join') return <JoinForm code={code} join={game.join} />;
  if (status === 'gone') return <Gone message={game.error} />;
  if (!view) return <Loading text="Connecting…" />;

  const me = view.players.find((p) => p.id === view.you)!;
  const opponent = view.players.find((p) => p.id !== view.you);
  const banner = (
    <>
      {status === 'offline' && <div className="banner">Connection lost — reconnecting…</div>}
      {opponent && !opponent.connected && !opponent.left && opponent.reconnectDeadline && view.phase !== 'finished' && (
        <OpponentReconnecting name={opponent.name} deadline={game.toLocal(opponent.reconnectDeadline)} />
      )}
    </>
  );

  let screen;
  if (shownResult) {
    screen = (
      <Reveal
        result={shownResult}
        view={view}
        onRematch={() => {
          socket.emit('game:rematch');
          setShownResult(null);
        }}
        onHome={leave}
      />
    );
  } else if (view.phase === 'lobby') {
    screen = <Lobby view={view} me={me} opponent={opponent} socket={socket} onLeave={leave} banner={banner} />;
  } else if (view.phase === 'writing' && view.writing) {
    screen = <Writing view={view} writing={view.writing} socket={socket} toLocal={game.toLocal} banner={banner} opponentName={opponent?.name ?? 'Opponent'} />;
  } else if (view.phase === 'reviewing') {
    screen = <><div className="fixed-banner">{banner}</div><Loading text="Building your puzzles…" sub="Checking clues and setting the grids" /></>;
  } else if (view.phase === 'solving' && view.solving) {
    screen = <Solving view={view} solving={view.solving} socket={socket} toLocal={game.toLocal} banner={banner} opponentName={opponent?.name ?? 'Opponent'} />;
  } else {
    screen = <Loading text="Loading…" />;
  }

  return (
    <>
      {screen}
      {view.devTools && view.players.some((p) => p.isBot) && <DevPanel view={view} socket={socket} />}
    </>
  );
}

function OpponentReconnecting({ name, deadline }: { name: string; deadline: number }) {
  const now = useNow(500);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <div className="banner" role="status">
      {name} is reconnecting… <span className="tabular">{left}s</span>
    </div>
  );
}

function JoinForm({ code, join }: { code: string; join: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState(() => local.get(NAME_KEY) ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const check = validateName(name);
    if (!check.ok) return setError(check.error);
    setBusy(true);
    local.set(NAME_KEY, check.name);
    const err = await join(check.name);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="page-center">
      <div className="narrow">
        <Logo />
        <h1>You're invited</h1>
        <p className="tagline">Join game <span className="code-chip">{code}</span> on Crossword Duel.</p>
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <NameField value={name} onChange={setName} autoFocus />
          <button className="primary big" type="submit" disabled={busy}>Join game</button>
          {error && <p className="message">{error}</p>}
        </form>
        <div className="home-links"><button className="link" onClick={() => navigate('/')}>Back to home</button></div>
      </div>
    </div>
  );
}

function Gone({ message }: { message: string }) {
  return (
    <div className="page-center">
      <div className="narrow">
        <Logo />
        <h1>Game unavailable</h1>
        <p className="tagline">{message || 'This game has ended or the link is wrong.'}</p>
        <button className="primary big" onClick={() => navigate('/')}>Go home</button>
      </div>
    </div>
  );
}

export type { GameView };
