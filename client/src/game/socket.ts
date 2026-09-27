import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/** One shared real-time connection for the whole app. */
export function getSocket(): GameSocket {
  socket ??= io({ transports: ['websocket', 'polling'] });
  return socket;
}
