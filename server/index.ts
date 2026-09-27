/**
 * Starts the game server. In development Vite serves the pages and forwards
 * API and real-time traffic here; in production this also serves the built pages.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClueAI } from './ai/index.js';
import { createGameServer, ROOT } from './app.js';

// Local secrets (like ANTHROPIC_API_KEY) can live in a .env file, which is never uploaded to GitHub.
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const ai = createClueAI();
/** Test tools (play against a bot) are on unless DEV_TOOLS=0. */
const devTools = process.env.DEV_TOOLS !== '0';

const { http } = createGameServer({ ai, devTools });
const port = Number(process.env.PORT ?? 3001);
http.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(ai.mode === 'anthropic'
    ? 'AI: using the Anthropic API.'
    : 'AI: pretend mode (no ANTHROPIC_API_KEY set). Clues containing the word "wrong" are treated as bad.');
  if (devTools) console.log('Test tools: on (play against a bot from the home screen).');
});
