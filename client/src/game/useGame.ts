/**
 * Keeps this browser tab connected to its game: joins/rejoins the room,
 * reconnects automatically, and tracks the latest GameView plus the
 * difference between this device's clock and the server's.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from '../../../shared/protocol';
import { getServerConfig } from '../api';
import { session } from '../lib/storage';
import { getSocket, type GameSocket } from './socket';

export const tokenKey = (code: string) => `cd.token.${code}`;
/** The server's boot id when this tab joined the game (to spot restarts). */
const bootKey = (code: string) => `cd.boot.${code}`;

export type Connection = 'connecting' | 'online' | 'offline' | 'needs-join' | 'gone';

/** Remembers which server run this tab's game lives on. */
async function rememberBoot(code: string) {
  const cfg = await getServerConfig();
  if (cfg?.bootId && !session.get(bootKey(code))) session.set(bootKey(code), cfg.bootId);
}

/** True if the server has restarted since this tab joined the game. */
async function serverRestarted(code: string): Promise<boolean> {
  const before = session.get(bootKey(code));
  if (!before) return false;
  const cfg = await getServerConfig();
  return !!cfg?.bootId && cfg.bootId !== before;
}

export function useGame(code: string) {
  const socket = getSocket();
  const [view, setView] = useState<GameView | null>(null);
  const [status, setStatus] = useState<Connection>('connecting');
  const [error, setError] = useState('');
  /** The server announced it is shutting down (an update or restart). */
  const [restarting, setRestarting] = useState(false);
  /** The game was lost because the server restarted. */
  const [restarted, setRestarted] = useState(false);
  const offset = useRef(0);

  const rejoin = useCallback(() => {
    const token = session.get(tokenKey(code));
    if (!token) {
      setStatus('needs-join');
      return;
    }
    socket.emit('room:rejoin', { code, token }, (res) => {
      if (res.ok) {
        setStatus('online');
        setRestarting(false);
        void rememberBoot(code);
      } else {
        session.remove(tokenKey(code));
        void serverRestarted(code).then((yes) => {
          session.remove(bootKey(code));
          setRestarted(yes);
          setError(res.error);
          setStatus('gone');
        });
      }
    });
  }, [code, socket]);

  useEffect(() => {
    const onState = (v: GameView) => {
      if (v.code !== code) return;
      offset.current = v.serverNow - Date.now();
      setView(v);
    };
    const onConnect = () => rejoin();
    const onDisconnect = () => setStatus((s) => (s === 'online' ? 'offline' : s));
    const onRestarting = () => setRestarting(true);
    socket.on('state', onState);
    socket.on('server:restarting', onRestarting);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) rejoin();
    return () => {
      socket.off('state', onState);
      socket.off('server:restarting', onRestarting);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [code, rejoin, socket]);

  const join = useCallback((name: string) => new Promise<string | null>((resolve) => {
    socket.emit('room:join', { code, name }, (res) => {
      if (res.ok) {
        session.set(tokenKey(code), res.token);
        void rememberBoot(code);
        setStatus('online');
        resolve(null);
      } else resolve(res.error);
    });
  }), [code, socket]);

  /** Converts a server timestamp into this device's clock. */
  const toLocal = useCallback((serverTime: number) => serverTime - offset.current, []);

  return { socket: socket as GameSocket, view, status, error, restarting, restarted, join, toLocal };
}
