/**
 * Keeps this browser tab connected to its game: joins/rejoins the room,
 * reconnects automatically, and tracks the latest GameView plus the
 * difference between this device's clock and the server's.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from '../../../shared/protocol';
import { session } from '../lib/storage';
import { getSocket, type GameSocket } from './socket';

export const tokenKey = (code: string) => `cd.token.${code}`;

export type Connection = 'connecting' | 'online' | 'offline' | 'needs-join' | 'gone';

export function useGame(code: string) {
  const socket = getSocket();
  const [view, setView] = useState<GameView | null>(null);
  const [status, setStatus] = useState<Connection>('connecting');
  const [error, setError] = useState('');
  const offset = useRef(0);

  const rejoin = useCallback(() => {
    const token = session.get(tokenKey(code));
    if (!token) {
      setStatus('needs-join');
      return;
    }
    socket.emit('room:rejoin', { code, token }, (res) => {
      if (res.ok) setStatus('online');
      else {
        session.remove(tokenKey(code));
        setError(res.error);
        setStatus('gone');
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
    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) rejoin();
    return () => {
      socket.off('state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [code, rejoin, socket]);

  const join = useCallback((name: string) => new Promise<string | null>((resolve) => {
    socket.emit('room:join', { code, name }, (res) => {
      if (res.ok) {
        session.set(tokenKey(code), res.token);
        setStatus('online');
        resolve(null);
      } else resolve(res.error);
    });
  }), [code, socket]);

  /** Converts a server timestamp into this device's clock. */
  const toLocal = useCallback((serverTime: number) => serverTime - offset.current, []);

  return { socket: socket as GameSocket, view, status, error, join, toLocal };
}
