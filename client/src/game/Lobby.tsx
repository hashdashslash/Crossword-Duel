import { useState, type ReactNode } from 'react';
import type { GameView, PlayerInfo } from '../../../shared/protocol';
import { DifficultyPicker, LABELS } from '../components/DifficultyPicker';
import { Logo, MuteButton } from '../components/ui';
import type { GameSocket } from './socket';

interface Props {
  view: GameView;
  me: PlayerInfo;
  opponent?: PlayerInfo;
  socket: GameSocket;
  onLeave: () => void;
  banner: ReactNode;
}

export function Lobby({ view, me, opponent, socket, onLeave, banner }: Props) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/g/${view.code}`;
  const opponentHere = opponent && !opponent.left;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link:', link);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Crossword Duel', text: `Join my Crossword Duel game (code ${view.code})`, url: link });
    } catch { /* cancelled */ }
  };

  if (opponent?.left) {
    return (
      <div className="page-center">
        <div className="narrow">
          <Logo />
          <h1>Opponent left</h1>
          <p className="tagline">{opponent.name} has left the game.</p>
          <button className="primary big" onClick={onLeave}>Return home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-center lobby">
      <div className="narrow">
        <div className="top-row">
          <button className="ghost small" onClick={onLeave}>Leave</button>
          <MuteButton />
        </div>
        {banner}
        <Logo />
        <h1>Game lobby</h1>

        {me.isHost && !opponentHere && (
          <div className="panel invite">
            <strong>Invite your opponent</strong>
            <p className="muted">Send them this link:</p>
            <div className="link-box">
              <span className="link-text">{link}</span>
              <button className="primary small" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            {'share' in navigator && <button className="ghost wide" onClick={share}>Share…</button>}
            <p className="muted small-print">Or they can enter the code <span className="code-chip">{view.code}</span> on the home page.</p>
          </div>
        )}

        <div className="panel players">
          <PlayerRow player={me} you />
          {opponentHere ? <PlayerRow player={opponent} /> : (
            <div className="player-row waiting">
              <span className="avatar pulse" aria-hidden />
              <span className="muted">Waiting for opponent…</span>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="field">
            <span>Difficulty {me.isHost ? '' : <span className="muted">(the host chooses)</span>}</span>
            {me.isHost ? (
              <DifficultyPicker value={view.difficulty} onChange={(d) => socket.emit('lobby:difficulty', d)} />
            ) : (
              <p className="difficulty-read">{LABELS[view.difficulty]}</p>
            )}
          </div>
          <button
            className={me.ready ? 'ghost big wide' : 'primary big'}
            onClick={() => socket.emit('lobby:ready', !me.ready)}
            disabled={!opponentHere && !me.ready}
          >
            {me.ready ? 'Not ready' : 'Ready'}
          </button>
          <p className="muted small-print center">
            {!opponentHere ? 'You can get ready once your opponent joins.'
              : me.ready && !opponent.ready ? `Waiting for ${opponent.name} to get ready…`
              : !me.ready && opponent.ready ? `${opponent.name} is ready!`
              : 'The game starts when you are both ready.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function PlayerRow({ player, you }: { player: PlayerInfo; you?: boolean }) {
  return (
    <div className="player-row">
      <span className="avatar" aria-hidden>{player.name[0]?.toUpperCase()}</span>
      <span className="player-name">
        {player.name}
        {you && <span className="muted"> (you)</span>}
        {player.isHost && <span className="tag">Host</span>}
      </span>
      <span className={`ready-state ${player.ready ? 'on' : ''}`}>
        {!player.connected ? 'Reconnecting…' : player.ready ? 'Ready' : 'Not ready'}
      </span>
    </div>
  );
}
