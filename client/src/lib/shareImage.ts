/**
 * Draws a shareable picture of a finished game: who won, both final times,
 * and both boards as mini grids (coloured squares, so no answers are given away).
 * Made in the browser, so it works for guest games too.
 */
import type { GameResult, PlayerResult, RevealGrid } from '../../../shared/protocol';
import { formatTime } from '../solve/Timer';

const W = 1080;
const C = {
  bg: '#f7f5f0',
  card: '#ffffff',
  ink: '#16181d',
  muted: '#6b6f78',
  blue: '#2463eb',
  blueSoft: '#dbe6ff',
  right: '#2463eb',
  wrong: '#e0463c',
  empty: '#e6e3dc',
  block: '#16181d',
  line: '#e4e1da',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** The headline for someone who wasn't in the game (the picture is for sharing). */
export function resultHeadline(result: GameResult): { title: string; sub: string } {
  const [a, b] = result.players as [PlayerResult, PlayerResult];
  const winner = result.players.find((p) => p.id === result.winnerId);
  const loser = result.players.find((p) => p.id !== result.winnerId);
  const quitter = result.players.find((p) => p.id === result.endedBy)?.name;
  if (!winner || !loser) return { title: `${a.name} and ${b.name} drew`, sub: 'Dead heat' };
  let sub = '';
  if (result.reason === 'resign') sub = `${quitter} resigned`;
  else if (result.reason === 'forfeit') sub = `${quitter} left the game`;
  else if (winner.finalMs !== null && loser.finalMs !== null) sub = `by ${formatTime(loser.finalMs - winner.finalMs)}`;
  else if (winner.finalMs !== null) sub = `${loser.name} didn't finish`;
  return { title: `${winner.name} beat ${loser.name}`, sub };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, opts: { weight?: number; color?: string; align?: CanvasTextAlign; max?: number } = {}) {
  ctx.font = `${opts.weight ?? 400} ${size}px ${FONT}`;
  ctx.fillStyle = opts.color ?? C.ink;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'alphabetic';
  let out = s;
  if (opts.max) while (out.length > 1 && ctx.measureText(out).width > opts.max) out = out.slice(0, -2) + '…';
  ctx.fillText(out, x, y);
}

function miniGrid(ctx: CanvasRenderingContext2D, grid: RevealGrid, cx: number, top: number, maxW: number, maxH: number) {
  const size = Math.floor(Math.min(maxW / grid.cols, maxH / grid.rows));
  const gw = size * grid.cols;
  const x0 = Math.round(cx - gw / 2);
  const gap = Math.max(1, Math.round(size * 0.08));
  ctx.fillStyle = C.block;
  roundRect(ctx, x0 - 6, top - 6, gw + 12, size * grid.rows + 12, 10);
  ctx.fill();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const answer = grid.cells[r]?.[c];
      if (answer == null) continue;
      const entry = grid.entries[r]?.[c] ?? '';
      ctx.fillStyle = !entry ? C.empty : entry === answer ? C.right : C.wrong;
      ctx.fillRect(x0 + c * size + gap / 2, top + r * size + gap / 2, size - gap, size - gap);
    }
  }
  return size * grid.rows;
}

function playerCard(ctx: CanvasRenderingContext2D, p: PlayerResult, solved: RevealGrid | undefined, x: number, y: number, w: number, h: number, won: boolean) {
  ctx.fillStyle = C.card;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();
  if (won) {
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 6;
    roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 26);
    ctx.stroke();
  }
  const cx = x + w / 2;
  let cy = y + 64;
  if (won) {
    ctx.fillStyle = C.blue;
    roundRect(ctx, cx - 70, y + 26, 140, 40, 20);
    ctx.fill();
    text(ctx, 'WINNER', cx, y + 55, 24, { weight: 800, color: '#fff' });
    cy += 40;
  }
  text(ctx, p.name, cx, cy + 12, 44, { weight: 700, max: w - 48 });
  text(ctx, p.finalMs !== null ? formatTime(p.finalMs) : 'DNF', cx, cy + 100, 88, { weight: 800, color: won ? C.blue : C.ink });
  const bits = [
    `${p.wordsCorrect}/${p.totalWords} words`,
    p.hintsUsed ? `${p.hintsUsed} hint${p.hintsUsed === 1 ? '' : 's'}` : 'no hints',
  ];
  if (p.flagged.length) bits.push(`${p.flagged.length} flagged`);
  text(ctx, bits.join(' · '), cx, cy + 150, 28, { color: C.muted, max: w - 40 });
  if (solved) miniGrid(ctx, solved, cx, cy + 190, w - 70, 520);
}

/** Renders the picture and returns it as a PNG. */
export async function renderResultImage(result: GameResult, footer: string): Promise<Blob> {
  // players[g] wrote grids[g], so each player solved the other grid.
  // Cards fit their content: the stats, then the grid at the largest size that fits the width.
  const cardW = 480;
  const top = 380;
  const header = (i: number) => (result.winnerId === result.players[i]!.id ? 294 : 254);
  const gridH = (g?: RevealGrid) => (g ? Math.floor(Math.min((cardW - 70) / g.cols, 520 / g.rows)) * g.rows + 40 : 0);
  const cardH = Math.max(...result.players.map((_, i) => header(i) + gridH(result.grids.length === 2 ? result.grids[1 - i] : undefined))) + 30;
  const H = top + cardH + 150;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Logo: a 3×3 grid of squares, like the app's.
  const pattern = [0, 1, 0, 1, 2, 1, 0, 1, 0];
  const s = 26;
  const lx = W / 2 - (3 * s) / 2;
  pattern.forEach((v, i) => {
    ctx.fillStyle = v === 1 ? C.blue : v === 2 ? C.block : '#fff';
    ctx.fillRect(lx + (i % 3) * s + 2, 50 + Math.floor(i / 3) * s + 2, s - 4, s - 4);
  });
  text(ctx, 'Crossword Duel', W / 2, 190, 40, { weight: 700, color: C.muted });

  const { title, sub } = resultHeadline(result);
  text(ctx, title, W / 2, 270, 68, { weight: 800, max: W - 80 });
  if (sub) text(ctx, sub, W / 2, 326, 38, { color: C.muted, max: W - 80 });

  result.players.forEach((p, i) => {
    const solved = result.grids.length === 2 ? result.grids[1 - i] : undefined;
    playerCard(ctx, p, solved, i === 0 ? 40 : W - 40 - cardW, top, cardW, cardH, result.winnerId === p.id);
  });

  // Legend and footer.
  const ly = top + cardH + 48;
  const items: [string, string][] = [[C.right, 'Right'], [C.wrong, 'Wrong'], [C.empty, 'Empty']];
  let x = W / 2 - 250;
  for (const [color, label] of items) {
    ctx.fillStyle = color;
    ctx.fillRect(x, ly - 22, 26, 26);
    text(ctx, label, x + 40, ly, 28, { color: C.muted, align: 'left' });
    x += 180;
  }
  text(ctx, footer, W / 2, H - 28, 28, { color: C.muted, max: W - 80 });

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), 'image/png'));
}

/** Shares the picture with the phone's share sheet, or downloads it. */
export async function shareResultImage(result: GameResult, footer: string, text?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await renderResultImage(result, footer);
  const file = new File([blob], 'crossword-duel-result.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
