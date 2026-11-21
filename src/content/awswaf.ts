// AWS WAF CAPTCHA ("Let's confirm you are human"), ported from Browsa's server-side solver: Begin, a grid of nine
// (or sixteen) cells over one canvas picture, "Choose all <thing>", Confirm. The picture is read from the canvas
// (drawn from data AWS sends; a tainted canvas falls back to a crop of the visible tab). AwsWafClassification picks
// the cells. AWS's own verdict: a right answer sets its token and the page behind loads.
import type { Ctx } from './main';
import { canvasData, capture, report, solveTask } from '../lib/msg';
import { boxOf, click, idle, sleep, visible, type Box } from '../lib/input';
import { providerScripts } from '../lib/origin';

const BUDGET_S = 90;
const MAX_ROUNDS = 4;

const root = () => document.querySelector('.amzn-captcha-root');

function target(): string {
  const t = (document.querySelector('.amzn-captcha-problem')?.textContent || '').replace(/\s+/g, ' ').trim();
  const m = /choose all\s+(.*)/i.exec(t);
  return (m ? m[1] : t).replace(/[.:]+$/, '').trim().slice(0, 80);
}

function confirmButton(): HTMLElement | null {
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('button, .btn-primary'))) {
    if (/confirm|submit/i.test(b.textContent || '') && visible(b)) return b;
  }
  return null;
}

async function cellImages(cells: HTMLElement[]): Promise<string[] | null> {
  const r = root();
  const canvas = Array.from((r || document).querySelectorAll('canvas')).find((c) => visible(c)) as HTMLCanvasElement | undefined;
  const boxes = cells.map(boxOf);
  if (canvas) {
    const cb = boxOf(canvas);
    const gx = Math.min(...boxes.map((b) => b[0])), gy = Math.min(...boxes.map((b) => b[1]));
    const gw = Math.max(...boxes.map((b) => b[0] + b[2])) - gx, gh = Math.max(...boxes.map((b) => b[1] + b[3])) - gy;
    const whole = await canvasData(canvas, 'image/jpeg', 0.9);
    if (whole && cells.length === 9 && Math.abs(cb[0] - gx) < 4 && Math.abs(cb[1] - gy) < 4 && Math.abs(cb[2] - gw) < 6 && Math.abs(cb[3] - gh) < 6) {
      return [whole];                                   // one 3x3 picture, the cells exactly over it
    }
    if (whole) {                                        // cut the canvas at the cells' positions
      try {
        const kx = canvas.width / cb[2], ky = canvas.height / cb[3];
        return boxes.map((b) => {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(b[2] * kx));
          c.height = Math.max(1, Math.round(b[3] * ky));
          c.getContext('2d')!.drawImage(canvas, (b[0] - cb[0]) * kx, (b[1] - cb[1]) * ky, c.width, c.height, 0, 0, c.width, c.height);
          return c.toDataURL('image/jpeg', 0.9).split(',')[1];
        });
      } catch { /* tainted after all: the visible tab below */ }
    }
  }
  return capture(boxes as Box[]);
}

async function solve(): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  let rounds = 0;
  const begin = document.querySelector('.amzn-captcha-verify-button');
  if (begin && visible(begin)) {
    await idle(0.5, 1.2);
    await click(begin);
    await sleep(2.5);
  }
  while ((performance.now() - t0) / 1000 < BUDGET_S && rounds < MAX_ROUNDS) {
    if (!root() || !visible(root())) return { solved: true, reason: 'solved', rounds };
    const cells = Array.from(document.querySelectorAll<HTMLElement>('.amzn-grid-cell')).filter((c) => visible(c));
    const ok = confirmButton();
    if (![9, 16].includes(cells.length) || !ok) {
      if (!cells.length && document.querySelector('audio, [class*="audio"]')) return { solved: false, reason: 'audio_only', rounds };
      await sleep(1.5);
      continue;
    }
    rounds++;
    const images = await cellImages(cells);
    if (!images) return { solved: false, reason: 'no_picture', rounds };
    const r = await solveTask('awswaf', { type: 'AwsWafClassification', images, question: 'aws:grid:' + (target() || 'the named thing') });
    report('awswaf', 'round', { n: rounds, error: r.errorCode || '' });
    if (r.errorId) return { solved: false, reason: (r.errorCode || 'api').toLowerCase(), rounds };
    for (const o of (r.solution?.objects || []) as number[]) {
      if (cells[o]) {
        await click(cells[o]);
        await idle(0.25, 0.6);
      }
    }
    await idle(0.4, 0.9);
    await click(ok);
    await sleep(3.0);
  }
  return { solved: !root(), reason: root() ? (rounds ? 'timeout' : 'no_puzzle') : 'solved', rounds };
}

export async function runAwsWaf(ctx: Ctx) {
  let busy = false;
  let tries = 0;
  const shown = () => { const r = root(); return !!r && visible(r); };
  const go = async (why: 'auto' | 'button') => {
    if (busy || !root()) return;
    busy = true;
    tries++;
    const t0 = performance.now();
    const r0 = root();
    const anchor = r0 ? boxOf(r0) : null;
    try {
      // AWS's own captcha script (from *.awswaf.com), not a look-alike drawn by the page
      const may = await ctx.start('awswaf', why, { verified: providerScripts('awswaf'), anchor });
      if (!may.ok) return;
      const r = await solve();
      ctx.end('awswaf', r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds,
        seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('awswaf', shown, () => go('button'));
  if (ctx.isTop) {
    // AWS loaded this page after our Confirm: no puzzle here means it took the answer
    const p = await ctx.bg<{ pending?: boolean; rounds?: number }>('pending', { kind: 'awswaf' });
    if (p && p.pending) {
      await sleep(2.5);
      if (!shown()) ctx.end('awswaf', 'solved', { reason: 'solved', rounds: p.rounds });
      else ctx.end('awswaf', 'failed', { reason: 'new_puzzle', rounds: p.rounds });
    }
  }
  for (;;) {
    await sleep(1.0);
    if (busy || tries >= 1 || !ctx.cfg.auto || ctx.skipAuto('awswaf')) continue;
    if (shown()) await go('auto');
  }
}
