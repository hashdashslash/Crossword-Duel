/**
 * Starts the game server. In development Vite serves the pages and forwards
 * API and real-time traffic here; in production this also serves the built pages.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAISelfTest } from './ai/anthropic.js';
import { createClueAI } from './ai/index.js';
import { createGameServer, ROOT } from './app.js';

// Local secrets (like ANTHROPIC_API_KEY) can live in a .env file, which is never uploaded to GitHub.
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const ai = createClueAI();
const { http } = createGameServer({ ai });
const port = Number(process.env.PORT ?? 3001);
http.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(ai.mode === 'anthropic'
    ? 'AI: using the Anthropic API.'
    : 'AI: pretend mode (no ANTHROPIC_API_KEY set). Clues containing the word "wrong" are treated as bad.');
  if ('client' in ai) {
    // Check the key, credit and model access once at startup, so problems show in the log.
    void runAISelfTest(ai as Parameters<typeof runAISelfTest>[0]).then(({ ok, lines }) => {
      console.log(ok ? 'AI self-test passed:' : 'AI self-test FAILED — hints and clue checks will not work until this is fixed:');
      for (const line of lines) console.log(line);
    });
  }
});
