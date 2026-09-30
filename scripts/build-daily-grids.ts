/**
 * Builds Sunday-size (21×21) grids for the daily puzzle and adds them to
 * server/grid/daily-grids.txt. Each day uses the next grid in the file.
 *
 *   npm run daily:build            (adds grids until there are 400)
 *   npm run daily:build -- 500     (adds grids until there are 500)
 *
 * Filling a big grid takes a while, so this runs one builder per CPU core.
 * It is safe to stop and restart: finished grids are saved as they come in.
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DAILY_GRIDS_PATH } from '../server/daily.js';
import { generateSundayGrid, gridToLine } from '../server/grid/sunday.js';
import { validateSundayGrid } from '../server/grid/sundayCheck.js';

const HEADER = '# Daily puzzle grids, one per line (rows joined by "/", "#" = black square).\n# Built by scripts/build-daily-grids.ts (npm run daily:build). Line 1 is daily puzzle #1.\n';

if (process.env.DAILY_WORKER_SEED) {
  // Worker: build one grid per seed it is given and send it back.
  process.on('message', (seed: number) => {
    try {
      const started = Date.now();
      const grid = generateSundayGrid(seed);
      const problems = validateSundayGrid(grid);
      process.send!({ seed, line: problems.length ? null : gridToLine(grid), ms: Date.now() - started, problems });
    } catch (e) {
      process.send!({ seed, line: null, ms: 0, problems: [(e as Error).message] });
    }
  });
  process.send!('ready');
} else {
  const target = Number(process.argv[2] ?? 400);
  if (!existsSync(DAILY_GRIDS_PATH)) writeFileSync(DAILY_GRIDS_PATH, HEADER);
  const lines = () => readFileSync(DAILY_GRIDS_PATH, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('# '));
  const have = lines();
  const seen = new Set(have);
  let count = have.length;
  // Seeds carry on from where the file left off, so reruns make new grids.
  let nextSeed = 1_000 + count * 7919;
  const workers = Math.max(1, Math.min(cpus().length, target - count));
  console.log(`${count} grids so far; building ${Math.max(0, target - count)} more on ${workers} cores…`);
  let running = 0;
  for (let w = 0; w < workers && count < target; w++) {
    const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, DAILY_WORKER_SEED: '1' } });
    running++;
    const next = () => {
      child.send(nextSeed);
      nextSeed += 7919;
    };
    child.on('message', (msg: 'ready' | { seed: number; line: string | null; ms: number; problems: string[] }) => {
      if (msg !== 'ready') {
        if (msg.line && !seen.has(msg.line) && count < target) {
          seen.add(msg.line);
          appendFileSync(DAILY_GRIDS_PATH, `${msg.line}\n`);
          count++;
          console.log(`grid ${count}/${target} (seed ${msg.seed}, ${Math.round(msg.ms / 1000)} s)`);
        } else if (!msg.line) {
          console.log(`seed ${msg.seed} failed: ${msg.problems.join('; ')}`);
        }
      }
      if (count >= target) child.kill();
      else next();
    });
    child.on('exit', () => {
      if (--running === 0) console.log(`Done: ${count} grids in ${DAILY_GRIDS_PATH}`);
    });
  }
}
