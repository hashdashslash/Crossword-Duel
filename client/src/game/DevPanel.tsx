import { useState } from 'react';
import type { BotAction, GameView } from '../../../shared/protocol';
import type { GameSocket } from './socket';

/** Test-mode controls for the bot opponent. */
export function DevPanel({ view, socket }: { view: GameView; socket: GameSocket }) {
  const [open, setOpen] = useState(false);
  const bot = view.players.find((p) => p.isBot);
  if (!bot) return null;
  const act = (a: BotAction) => socket.emit('dev:bot', a);
  return (
    <div className={`dev-panel ${open ? 'open' : ''}`}>
      <button className="dev-toggle" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Test tools'}</button>
      {open && (
        <div className="dev-body">
          <p className="muted small-print">Bot is {bot.left ? 'gone' : bot.connected ? 'connected' : 'disconnected'} · AI: {view.aiMode === 'mock' ? 'pretend' : 'real'}</p>
          <button onClick={() => act('disconnect')} disabled={!bot.connected}>Bot: disconnect</button>
          <button onClick={() => act('reconnect')} disabled={bot.connected || bot.left}>Bot: reconnect</button>
          <button onClick={() => act('finish')} disabled={view.phase !== 'solving'}>Bot: finish solving now</button>
          <button onClick={() => act('resign')} disabled={view.phase === 'lobby' || view.phase === 'finished'}>Bot: resign</button>
        </div>
      )}
    </div>
  );
}
