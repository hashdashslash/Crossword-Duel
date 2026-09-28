/** Connects browsers to game rooms over Socket.IO. */
import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { DIFFICULTIES, type Difficulty } from '../../shared/config.js';
import type { ClientToServerEvents, Err, ServerToClientEvents } from '../../shared/protocol.js';
import { validateName } from '../../shared/rules.js';
import type { ClueAI } from '../ai/types.js';
import { Room, type Player } from './room.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (easily confused)

export function attachGameServer(io: IO, opts: { ai: ClueAI }) {
  const rooms = new Map<string, Room>();

  const newCode = () => {
    for (;;) {
      const code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
      if (!rooms.has(code)) return code;
    }
  };

  const createRoom = (difficulty: Difficulty) => {
    const code = newCode();
    const room = new Room(code, difficulty, {
      ai: opts.ai,
      send: (player: Player, view) => {
        for (const id of player.sockets) io.to(id).emit('state', view);
      },
    });
    rooms.set(code, room);
    return room;
  };

  // Clean up abandoned rooms.
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.isDead(now)) {
        room.dispose();
        rooms.delete(code);
      }
    }
  }, 60_000).unref();

  const fail = (error: string): Err => ({ ok: false, error });

  io.on('connection', (socket: Sock) => {
    let room: Room | null = null;
    let player: Player | null = null;

    const bind = (r: Room, p: Player) => {
      if (room && player && (room !== r || player !== p)) room.disconnect(player, socket.id);
      room = r;
      player = p;
      r.connect(p, socket.id);
    };

    /** Runs a handler only when this socket is in a room; errors never crash the server. */
    const inRoom = <A extends unknown[]>(fn: (r: Room, p: Player, ...args: A) => void) => (...args: A) => {
      if (!room || !player) return;
      try {
        fn(room, player, ...args);
      } catch (e) {
        console.error('[game] handler error', e);
      }
    };

    socket.on('room:create', (p, ack) => {
      const name = validateName(p?.name);
      if (!name.ok) return ack(fail(name.error));
      const difficulty = DIFFICULTIES.includes(p?.difficulty) ? p.difficulty : 'medium';
      const r = createRoom(difficulty);
      const me = r.addPlayer(name.name);
      ack({ ok: true, code: r.code, token: me.token });
      bind(r, me);
    });

    socket.on('room:join', (p, ack) => {
      const r = rooms.get(String(p?.code ?? '').toUpperCase());
      if (!r) return ack(fail("We couldn't find that game. Check the link or code."));
      const blocked = r.canJoin();
      if (blocked) return ack(fail(blocked));
      const name = validateName(p?.name);
      if (!name.ok) return ack(fail(name.error));
      const me = r.addPlayer(name.name);
      ack({ ok: true, token: me.token });
      bind(r, me);
    });

    socket.on('room:rejoin', (p, ack) => {
      const r = rooms.get(String(p?.code ?? '').toUpperCase());
      const me = r?.byToken(String(p?.token ?? ''));
      if (!r || !me) return ack(fail('That game is no longer available.'));
      ack({ ok: true });
      bind(r, me);
    });

    socket.on('room:leave', inRoom((r, p) => {
      r.leave(p);
      room = null;
      player = null;
    }));

    socket.on('lobby:difficulty', inRoom((r, p, d: Difficulty) => {
      if (DIFFICULTIES.includes(d)) r.setDifficulty(p, d);
    }));
    socket.on('lobby:ready', inRoom((r, p, ready: boolean) => r.setReady(p, !!ready)));

    socket.on('write:intro-done', inRoom((r, p) => r.introDone(p)));
    socket.on('write:draft', inRoom((r, p, d: { index: number; text: string }) => r.draft(p, Number(d?.index), String(d?.text ?? ''))));
    socket.on('write:next', (d, ack) => {
      if (!room || !player) return ack(fail('Not in a game.'));
      const mode = d?.mode === 'keep' || d?.mode === 'blank' ? d.mode : 'check';
      room.next(player, Number(d?.index), String(d?.text ?? ''), mode)
        .then((result) => ack({ ok: true, result }))
        .catch((e) => { console.error(e); ack(fail('Something went wrong.')); });
    });
    socket.on('write:define', (d, ack) => {
      if (!room || !player) return ack(fail('Not in a game.'));
      room.define(player, Number(d?.index))
        .then((r) => (r ? ack({ ok: true, ...r }) : ack(fail('No word to define right now.'))))
        .catch(() => ack(fail("Couldn't look that up.")));
    });
    socket.on('write:check', (d, ack) => {
      if (!room || !player) return ack(fail('Not in a game.'));
      room.check(player, Number(d?.index), String(d?.text ?? ''))
        .then((r) => ack({ ok: true, ...r }))
        .catch(() => ack({ ok: true, valid: true, reason: '' }));
    });

    socket.on('solve:entries', inRoom((r, p, entries: unknown) => r.updateEntries(p, entries)));
    socket.on('solve:submit', (entries, ack) => {
      if (!room || !player) return ack(fail('Not in a game.'));
      try {
        ack({ ok: true, ...room.submit(player, entries) });
      } catch (e) {
        console.error(e);
        ack(fail('Could not check the grid.'));
      }
    });
    socket.on('solve:hint', (clueIndex, ack) => {
      if (!room || !player) return ack(fail('Not in a game.'));
      room.hint(player, Number(clueIndex))
        .then((r) => ack(r))
        .catch((e) => { console.error(e); ack(fail("Couldn't create a hint right now. You were not charged.")); });
    });
    socket.on('solve:resign', inRoom((r, p) => r.resign(p)));
    socket.on('game:rematch', inRoom((r, p) => r.rematch(p)));

    socket.on('disconnect', () => {
      if (room && player) room.disconnect(player, socket.id);
    });
  });

  return { rooms };
}
