/**
 * Re-checks every daily grid against the current word list and rules, and
 * fixes the ones that fail in place (so each day keeps its grid number):
 * first by refilling the patch around each bad answer, and if that fails, by
 * building a fresh grid for that day.
 *
 *   npm run daily:repair              (fix grids that break the rules)
 *   npm run daily:repair -- --polish  (also try harder to swap obscure answers for familiar ones)
 *
 * Run it after taking words out of the fill list (for example, new
 * crosswordese). It uses one worker per CPU core.
 */
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DAILY_GRIDS_PATH } from '../server/daily.js';
import { createRng } from '../server/grid/rng.js';
import { generateSundayGrid, gridFromRows, gridToLine, polishGrid, repairGrid } from '../server/grid/sunday.js';
import { validateSundayGrid } from '../server/grid/sundayCheck.js';

interface Job { index: number; line: string; polish: boolean }
interface Done { index: number; line: string; how: 'ok' | 'repaired' | 'rebuilt' | 'polished' }

function fix(job: Job): Done {
  const done = fixRules(job);
  if (!job.polish) return done;
  // A harder polish pass: bigger patches and more search around each obscure answer.
  const grid = gridFromRows(done.line.split('/'));
  const pattern = grid.cells.map((r) => r.map((c) => c === null));
  const polished = gridToLine(polishGrid(pattern, grid, createRng(job.index * 31 + 7)));
  if (polished === done.line || validateSundayGrid(gridFromRows(polished.split('/'))).length) return done;
  return { ...done, line: polished, how: done.how === 'ok' ? 'polished' : done.how };
}

function fixRules({ index, line }: Job): Done {
  const grid = gridFromRows(line.split('/'));
  if (!validateSundayGrid(grid).length) return { index, line, how: 'ok' };
  for (let attempt = 0; attempt < 4; attempt++) {
    const repaired = repairGrid(grid, createRng(index * 7919 + attempt));
    if (repaired && !validateSundayGrid(repaired).length) return { index, line: gridToLine(repaired), how: 'repaired' };
  }
  for (let seed = 500_000 + index * 7919; ; seed += 104_729) {
    const fresh = generateSundayGrid(seed);
    if (!validateSundayGrid(fresh).length) return { index, line: gridToLine(fresh), how: 'rebuilt' };
  }
}

if (process.env.DAILY_REPAIR_WORKER) {
  process.on('message', (job: Job) => process.send!(fix(job)));
  process.send!('ready');
} else {
  const text = readFileSync(DAILY_GRIDS_PATH, 'utf8').split('\n');
  const header = text.filter((l) => l.startsWith('# '));
  const lines = text.filter((l) => l.trim() && !l.startsWith('# '));
  const polish = process.argv.includes('--polish');
  const queue: Job[] = lines.map((line, index) => ({ index, line, polish }));
  const counts = { ok: 0, repaired: 0, rebuilt: 0, polished: 0 };
  let running = 0;
  const save = () => writeFileSync(DAILY_GRIDS_PATH, `${[...header, ...lines].join('\n')}\n`);
  for (let w = 0; w < Math.min(cpus().length, queue.length); w++) {
    const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, DAILY_REPAIR_WORKER: '1' } });
    running++;
    child.on('message', (msg: 'ready' | Done) => {
      if (msg !== 'ready') {
        counts[msg.how]++;
        if (msg.how !== 'ok') {
          lines[msg.index] = msg.line;
          save();
          console.log(`grid ${msg.index + 1}: ${msg.how}`);
        }
      }
      const job = queue.shift();
      if (job) child.send(job);
      else child.kill();
    });
    child.on('exit', () => {
      if (--running === 0) {
        if (new Set(lines).size !== lines.length) console.warn('warning: two days now share a grid');
        console.log(`Done: ${counts.ok} unchanged, ${counts.polished} polished, ${counts.repaired} repaired, ${counts.rebuilt} rebuilt.`);
      }
    });
  }
}
