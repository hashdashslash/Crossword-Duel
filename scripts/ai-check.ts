/**
 * Checks that the Anthropic API key in .env works: the key, account credit,
 * and access to each AI model the game uses. Costs a tiny fraction of a cent.
 *   npm run ai:check
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicClueAI, runAISelfTest } from '../server/ai/anthropic.js';
import { ROOT } from '../server/app.js';

if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('\nNo ANTHROPIC_API_KEY found. Put it in a file called .env in the project folder (see .env.example).\n');
  process.exit(1);
}

const ai = new AnthropicClueAI();
console.log('\nChecking your Anthropic API setup…\n');
const { ok, lines } = await runAISelfTest(ai);
for (const line of lines) console.log(line);
if (ok) {
  console.log('\nTrying a real hint…');
  try {
    const clue = await ai.alternativeClue('GARDEN', ['Where flowers grow'], 'easy', AbortSignal.timeout(20000));
    console.log(`  ✓ hint for GARDEN: "${clue}"`);
  } catch (e) {
    console.log(`  ✗ hint failed: ${(e as Error).message}`);
  }
}
console.log(ok ? '\nAll good — the AI features should work.\n' : '\nSomething is wrong — see the ✗ lines above.\n');
process.exit(ok ? 0 : 1);
