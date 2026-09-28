import { useEffect, useState } from 'react';
import { THEME_LABELS } from '../../shared/config';
import type { HistoryEntry, Profile as ProfileData, SavedGame } from '../../shared/history';
import { getHistory, getProfile, getSavedGame, getSharedGame } from './api';
import { LABELS } from './components/DifficultyPicker';
import { Loading, Logo } from './components/ui';
import { Final, ShareButtons, SolvedGrid } from './game/Reveal';
import { resultHeadline } from './lib/shareImage';
import { useAuth } from './lib/auth';
import { navigate } from './lib/router';
import { formatTime } from './solve/Timer';

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const OUTCOME = { win: 'Won', loss: 'Lost', draw: 'Draw' } as const;

export function BackBar() {
  return <button className="ghost small back-link" onClick={() => (history.length > 1 ? history.back() : navigate('/'))}>← Back</button>;
}

/** One row in a list of games. Clickable when `link` is true. */
export function GameRow({ g, link = true }: { g: HistoryEntry; link?: boolean }) {
  const body = (
    <>
      <span className={`outcome ${g.outcome}`}>{OUTCOME[g.outcome]}</span>
      <span className="game-row-main">
        <span>vs <b>{g.opponent.username ?? g.opponent.name}</b>{!g.opponent.username && <span className="muted"> (guest)</span>}</span>
        <span className="muted small-print">
          {dateLabel(g.finishedAt)} · {LABELS[g.difficulty]}{g.theme !== 'any' ? ` · ${THEME_LABELS[g.theme]}` : ''}
        </span>
      </span>
      <span className="game-row-times tabular">
        {g.yourFinalMs !== null ? formatTime(g.yourFinalMs) : 'DNF'}
        <span className="muted"> / {g.opponentFinalMs !== null ? formatTime(g.opponentFinalMs) : 'DNF'}</span>
      </span>
    </>
  );
  return link
    ? <button className="game-row" onClick={() => navigate(`/games/${g.id}`)}>{body}</button>
    : <div className="game-row">{body}</div>;
}

export function HistoryPage() {
  const { user, loaded } = useAuth();
  const [games, setGames] = useState<HistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = async (before?: string) => {
    try {
      const r = await getHistory(before);
      setGames((g) => [...(before ? g ?? [] : []), ...r.games]);
      setMore(r.games.length === 20);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => { if (user) void load(); }, [user?.id]);

  if (!loaded) return <Loading text="Loading…" />;
  if (!user) return <SignInNeeded what="your game history" />;
  return (
    <div className="page-center">
      <div className="narrow wide-ish">
        <BackBar />
        <h1>Your games</h1>
        {error && <p className="message">{error}</p>}
        {!games && !error && <p className="muted center">Loading…</p>}
        {games && !games.length && <p className="tagline">No games yet. Games you finish while signed in appear here.</p>}
        {games && games.length > 0 && (
          <div className="panel game-list">
            {games.map((g) => <GameRow key={g.id} g={g} />)}
            {more && <button className="ghost" onClick={() => load(games[games.length - 1]!.finishedAt)}>Show older games</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** A saved game's full review: /games/:id for players in it, or /r/:id (shared) for anyone with the link. */
export function GameReviewPage({ id, shared = false }: { id: string; shared?: boolean }) {
  const { loaded, user } = useAuth();
  const [game, setGame] = useState<SavedGame | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!loaded) return;
    (shared ? getSharedGame(id) : getSavedGame(id)).then(setGame).catch((e: Error) => setError(e.message));
  }, [id, shared, loaded, user?.id]);

  if (error) {
    return (
      <div className="page-center"><div className="narrow">
        <Logo /><h1>Game not available</h1><p className="tagline">{error}</p>
        <button className="primary big" onClick={() => navigate('/')}>Go home</button>
      </div></div>
    );
  }
  if (!game) return <Loading text="Loading game…" />;
  const { result } = game;
  const me = result.players.find((p) => p.id === game.you);
  const opp = result.players.find((p) => p.id !== game.you)!;
  const outcome = result.winnerId === null ? 'draw' : result.winnerId === me?.id ? 'win' : 'loss';
  const headline = resultHeadline(result);
  return (
    <div className="reveal grids-view">
      <header className="reveal-header review-header">
        {shared && !me ? <span /> : <BackBar />}
        <h1>{me ? `${OUTCOME[outcome]} vs ${opp.name}` : headline.title}</h1>
        <span />
      </header>
      {!me && headline.sub && <p className="center verdict-sub">{headline.sub}</p>}
      <p className="muted center">
        {dateLabel(game.finishedAt)} · {LABELS[game.meta.difficulty]}{game.meta.theme !== 'any' ? ` · ${THEME_LABELS[game.meta.theme]}` : ''}
        {' · '}{game.meta.timerMode === 'pool' ? 'Shared clock' : 'Per-word timer'}
      </p>
      <ScoreSummary game={game} />
      <div className="reveal-actions">
        {shared && !me && <button className="primary" onClick={() => navigate('/')}>Play Crossword Duel</button>}
        <ShareButtons result={result} you={game.you} saved />
      </div>
      <div className="grids-pair">
        {result.grids.map((g, i) => <SolvedGrid key={i} grid={g} />)}
      </div>
    </div>
  );
}

function ScoreSummary({ game }: { game: SavedGame }) {
  const { result } = game;
  const players = [...result.players].sort((a) => (a.id === game.you ? -1 : 1));
  const reason = result.reason === 'resign' ? 'Ended by resignation.' : result.reason === 'forfeit' ? 'Ended when a player left.' : result.reason === 'timeout' ? 'Ended at the time limit.' : '';
  return (
    <div className="panel score-summary">
      <table>
        <thead><tr><th /><th>Solve</th><th>Hints</th><th>Flagged</th><th>Final</th></tr></thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <th>{p.id === game.you ? 'You' : p.name}</th>
              <td className="tabular">{p.rawMs !== null ? formatTime(p.rawMs) : 'DNF'}</td>
              <td className="tabular">{p.hintPenaltyMs ? `+${formatTime(p.hintPenaltyMs)}` : '—'}</td>
              <td className="tabular">{p.flaggedPenaltyMs ? `+${formatTime(p.flaggedPenaltyMs)}` : '—'}</td>
              <td><Final p={p} highlight={result.winnerId === p.id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {reason && <p className="muted small-print">{reason}</p>}
      {result.players.some((p) => p.flagged.length) && (
        <div className="flagged-list">
          {result.players.flatMap((p) => p.flagged.map((f, i) => (
            <div className="flagged-card" key={`${p.id}-${i}`}>
              <div className="flagged-top">
                <span className="tag">{p.id === game.you ? 'Your clue' : `${p.name}'s clue`}</span>
                <span className="answer">{f.answer}</span>
              </div>
              <p><span className="muted">Original:</span> <s>{f.original}</s></p>
              <p><span className="muted">Solved with:</span> {f.replacement}</p>
              <p className="why">{f.explanation}</p>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}

export function ProfilePage({ username }: { username: string }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setProfile(null);
    getProfile(username).then(setProfile).catch((e: Error) => setError(e.message));
  }, [username]);

  if (error) {
    return (
      <div className="page-center"><div className="narrow">
        <Logo /><h1>Player not found</h1><p className="tagline">{error}</p>
        <button className="primary big" onClick={() => navigate('/')}>Go home</button>
      </div></div>
    );
  }
  if (!profile) return <Loading text="Loading profile…" />;
  const own = user?.username.toLowerCase() === profile.username.toLowerCase();
  const total = profile.wins + profile.losses + profile.draws;
  return (
    <div className="page-center">
      <div className="narrow wide-ish">
        <BackBar />
        <div className="profile-head">
          <span className="avatar big" aria-hidden>{profile.username[0]?.toUpperCase()}</span>
          <h1>{profile.username}</h1>
        </div>
        <div className="panel record-panel">
          <div><span className="record-num">{profile.wins}</span><span className="muted">Wins</span></div>
          <div><span className="record-num">{profile.losses}</span><span className="muted">Losses</span></div>
          <div><span className="record-num">{profile.draws}</span><span className="muted">Draws</span></div>
        </div>
        <h2 className="section-title">Recent games</h2>
        {total === 0 ? <p className="muted">No games yet.</p> : (
          <div className="panel game-list">
            {profile.recent.map((g) => <GameRow key={g.id} g={g} link={own} />)}
            {own && <button className="ghost" onClick={() => navigate('/history')}>All my games</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export function SignInNeeded({ what }: { what: string }) {
  const next = encodeURIComponent(location.pathname);
  return (
    <div className="page-center"><div className="narrow">
      <Logo /><h1>Sign in to see {what}</h1>
      <p className="tagline">Accounts are optional. Guests can keep playing as usual.</p>
      <div className="panel">
        <button className="primary big" onClick={() => navigate(`/signin?next=${next}`)}>Sign in</button>
        <button className="ghost" onClick={() => navigate(`/signup?next=${next}`)}>Create an account</button>
      </div>
    </div></div>
  );
}
