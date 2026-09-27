/**
 * The game server. In development it only serves the API (Vite serves the
 * pages); in production it also serves the built pages from dist/client.
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFICULTIES, type Difficulty } from '../shared/config.js';
import { checkPractice, createPractice } from './practice.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

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

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('/{*path}', (_req, res) => res.sendFile(join(clientDir, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
