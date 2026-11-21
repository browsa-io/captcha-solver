// DataDome's slider ("Slide right to complete the puzzle"), in its own frame from captcha-delivery.com: the
// background and the piece are two canvases; the gap is found on the server (VisionEngine slider_1) and the piece is
// dragged there on a hand's track. DataDome's verdict: the frame goes away and the page loads. Off by default.
import type { Ctx } from './main';
import { canvasData, capture, solveTask, report } from '../lib/msg';
import { boxOf, idle, sleep, slide, visible } from '../lib/input';
import { PROVIDER_FRAMES } from '../lib/origin';

export const isDataDomeFrame = (u: string) => PROVIDER_FRAMES.datadome!(u) && /\/captcha\//.test(u);

const BUDGET_S = 60;
const TRIES = 3;

function puzzle(): { bg: HTMLCanvasElement; piece: HTMLCanvasElement | null; handle: HTMLElement } | null {
  const scope = document.querySelector('#captcha__puzzle') || document;
  const canvases = Array.from(scope.querySelectorAll('canvas')).filter((c) => visible(c));
  if (!canvases.length) return null;
  const area = (c: HTMLCanvasElement) => c.getBoundingClientRect().width * c.getBoundingClientRect().height;
  canvases.sort((a, b) => area(b) - area(a));
  const handle = document.querySelector<HTMLElement>('.slider, .sliderIcon, [class*="slider"] [role="slider"], [class*="slider-handle"], [class*="sliderHandle"]');
  if (!handle || !visible(handle)) return null;
  return { bg: canvases[0], piece: canvases[1] || null, handle };
}

async function picture(c: HTMLCanvasElement): Promise<string | null> {
  return (await canvasData(c, 'image/png')) || ((await capture([boxOf(c)])) || [null])[0];
}

export async function runDataDome(ctx: Ctx) {
  let busy = false;
  let tries = 0;
  const go = async (why: 'auto' | 'button') => {
    const p = puzzle();
    if (busy || !p) return;
    busy = true;
    const t0 = performance.now();
    try {
      const may = await ctx.start('datadome', why, { verified: true });
      if (!may.ok) return;
      while (tries < TRIES && (performance.now() - t0) / 1000 < BUDGET_S) {
        const pz = puzzle();
        if (!pz) { await sleep(1.0); if (!puzzle()) break; continue; }
        tries++;
        const bg = await picture(pz.bg);
        const piece = pz.piece ? await picture(pz.piece) : null;
        if (!bg) { ctx.end('datadome', 'failed', { reason: 'no_picture', rounds: tries }); return; }
        const r = await solveTask('datadome', { type: 'VisionEngine', module: 'slider_1', imageBackground: bg, ...(piece ? { image: piece } : {}) });
        report('datadome', 'round', { n: tries, error: r.errorCode || '' });
        if (r.errorId) { ctx.end('datadome', 'failed', { reason: (r.errorCode || 'api').toLowerCase(), rounds: tries }); return; }
        const cssW = pz.bg.getBoundingClientRect().width;
        const dist = Number(r.solution?.distance || 0) * (cssW / (pz.bg.width || cssW));
        await idle(0.4, 0.9);
        await slide(pz.handle, Math.max(5, dist));
        await sleep(2.5);
      }
      // the pass reloads the page (the background marks the solve, the next page reports it)
      if (puzzle()) ctx.end('datadome', 'failed', { reason: 'timeout', rounds: tries, seconds: (performance.now() - t0) / 1000 });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('datadome', () => !!puzzle(), () => go('button'));
  for (;;) {
    await sleep(1.0);
    if (busy || tries >= TRIES || !ctx.cfg.auto || ctx.skipAuto('datadome')) continue;
    if (puzzle()) await go('auto');
  }
}
