/** Builds the HTTP + real-time server (used by index.ts and by tests). */
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { DIFFICULTIES, type Difficulty } from '../shared/config.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.js';
import type { ClueAI } from './ai/types.js';
import { attachGameServer } from './game/socket.js';
import { checkPractice, createPractice } from './practice.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createGameServer(opts: { ai: ClueAI }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/config', (_req, res) => {
    res.json({ aiMode: opts.ai.mode });
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
  const game = attachGameServer(io, opts);
  return { http, io, rooms: game.rooms };
}
