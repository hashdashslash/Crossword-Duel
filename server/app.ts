/** Builds the HTTP + real-time server (used by index.ts and by tests). */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { DIFFICULTIES, type Difficulty } from '../shared/config.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import type { ClueAI } from './ai/types.js';
import { Accounts, attachAuthRoutes } from './accounts/accounts.js';
import type { Db } from './db/index.js';
import { attachHistoryRoutes, History } from './history.js';
import { attachFriendRoutes, Friends } from './friends.js';
import { attachGameServer } from './game/socket.js';
import { createDaily } from './daily.js';
import { checkPractice, createPractice } from './practice.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Changes every time the server starts. Games live in memory, so a browser that
 * sees a different id knows the server restarted and its game was lost.
 */
export const BOOT_ID = randomUUID();

export function createGameServer(opts: { ai: ClueAI; db?: Db | null }) {
  const app = express();
  // Render sits behind one proxy; this makes req.ip the player's address (for rate limits).
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  const accounts = opts.db ? new Accounts(opts.db) : null;
  attachAuthRoutes(app, accounts);
  const history = opts.db ? new History(opts.db) : null;
  attachHistoryRoutes(app, accounts, history);
  const friends = accounts && opts.db ? new Friends(opts.db, accounts) : null;
  let notify: (userId: string) => void = () => {};
  attachFriendRoutes(app, accounts, friends, (id) => notify(id));

  app.get('/api/config', (_req, res) => {
    res.json({ aiMode: opts.ai.mode, bootId: BOOT_ID });
  });

  app.post('/api/practice', (req, res) => {
    const difficulty = req.body?.difficulty as Difficulty;
    if (!DIFFICULTIES.includes(difficulty)) {
      res.status(400).json({ error: 'Unknown difficulty' });
      return;
    }
    try {
      res.json(createPractice(difficulty));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not build a puzzle. Please try again.' });
    }
  });

  app.post('/api/daily', async (req, res) => {
    try {
      const daily = await createDaily(req.body?.date, opts, { resumeMs: req.body?.resumeMs });
      if ('error' in daily) {
        res.status(400).json(daily);
        return;
      }
      res.json(daily);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not build the daily puzzle. Please try again.' });
    }
  });

  app.post('/api/practice/:id/check', (req, res) => {
    const result = checkPractice(req.params.id, req.body?.entries);
    if (!result) {
      res.status(404).json({ error: 'This puzzle has expired. Start a new one.' });
      return;
    }
    res.json(result);
  });

  const clientDir = join(ROOT, 'dist', 'client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get('/{*path}', (_req, res) => res.sendFile(join(clientDir, 'index.html')));
  }

  const http = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    // Quick detection of dropped connections (phones sleeping, Wi-Fi changes).
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  const game = attachGameServer(io, { ai: opts.ai, accounts, friends, onFinished: history ? (g) => void history.save(g) : undefined });
  notify = game.notify;
  return { http, io, rooms: game.rooms, accounts, history, friends };
}
