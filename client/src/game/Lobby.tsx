import { useState, type ReactNode } from 'react';
import { CONFIG, poolSeconds, THEME_LABELS, THEMES, TIMER_MODES, type TimerMode } from '../../../shared/config';
import type { GameView, PlayerInfo } from '../../../shared/protocol';
import { DifficultyPicker, LABELS } from '../components/DifficultyPicker';
import { Logo, MuteButton } from '../components/ui';
import { describeRecord, useHeadToHead } from '../lib/record';
import { formatTime } from '../solve/Timer';
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
          {opponentHere && <HeadToHeadLine opponent={opponent} />}
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
          <label className="field">
            <span>Word theme {me.isHost ? '' : <span className="muted">(the host chooses)</span>}</span>
            {me.isHost ? (
              <select className="select" value={view.theme} onChange={(e) => socket.emit('lobby:theme', e.target.value as typeof view.theme)}>
                {THEMES.map((t) => <option key={t} value={t}>{THEME_LABELS[t]}</option>)}
              </select>
            ) : (
              <p className="difficulty-read">{THEME_LABELS[view.theme]}</p>
            )}
          </label>
          <div className="field">
            <span>Clue timer {me.isHost ? '' : <span className="muted">(the host chooses)</span>}</span>
            {me.isHost ? (
              <TimerModePicker value={view.timerMode} onChange={(m) => socket.emit('lobby:timer-mode', m)} />
            ) : (
              <p className="difficulty-read">{TIMER_LABELS[view.timerMode]}</p>
            )}
            <p className="muted small-print timer-help">{TIMER_HELP[view.timerMode]()}</p>
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

const TIMER_LABELS: Record<TimerMode, string> = { perWord: 'Per word', pool: 'Shared clock' };
const TIMER_HELP: Record<TimerMode, () => string> = {
  perWord: () => `${CONFIG.secondsPerClue} seconds for each word, one at a time.`,
  pool: () => `${formatTime(poolSeconds() * 1000)} for all ${CONFIG.wordsPerGrid} words. Jump between words and revise any clue.`,
};

function TimerModePicker({ value, onChange }: { value: TimerMode; onChange: (m: TimerMode) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Clue timer">
      {TIMER_MODES.map((m) => (
        <button key={m} role="radio" aria-checked={m === value} className={m === value ? 'on' : ''} onClick={() => onChange(m)}>
          {TIMER_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function HeadToHeadLine({ opponent }: { opponent: PlayerInfo }) {
  const record = useHeadToHead(opponent);
  if (!record) return null;
  return <p className="head-to-head muted">Your record vs {record.name}: <b>{describeRecord(record)}</b></p>;
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
