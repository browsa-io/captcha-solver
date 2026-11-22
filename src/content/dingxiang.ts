// Dingxiang (顶象) rotate puzzle, ported from Browsa's in-session solver: "drag the
// slider to turn the disc into place". The widget is drawn in the page (.dx_captcha_rotate_*): a disc picture over a
// picture with a dark hole where it belongs, and a slider bar that turns the disc by 360 degrees over its whole
// travel. RotateTask (no model) gives the turn; the knob is dragged by that share of the bar. The pictures are
// Dingxiang's own files, fetched by the background from Dingxiang's hosts only. Dingxiang's server answers the slide
// (cap.dingxiang-inc.com /api/v1): the bar shows its success state (and the pop-up closes), or a fail state and a
// new picture.
import type { Ctx } from './main';
import { report, solveTask } from '../lib/msg';
import { boxOf, idle, sleep, slide, visible } from '../lib/input';
import { providerScripts } from '../lib/origin';

const BUDGET_S = 60;
const TRIES = 4;
const P = 'dx_captcha_rotate_';

const shownBlock = (el: Element | null | undefined) => !!el && (el as HTMLElement).style.display === 'block' && visible(el);

/** The rotate puzzle on screen (its wrapper), or null. A page can hold several Dingxiang widgets; only the one whose
 * main box is shown counts. */
export function active(doc: Document = document): HTMLElement | null {
  for (const w of Array.from(doc.querySelectorAll<HTMLElement>('.' + P + 'wrapper'))) {
    if (shownBlock(w.querySelector('.' + P + 'main-box'))) return w;
  }
  return null;
}

export function barState(w: HTMLElement): 'success' | 'fail' | '' {
  if (shownBlock(w.querySelector('.' + P + 'bar-success'))) return 'success';
  if (shownBlock(w.querySelector('.' + P + 'bar-fail'))) return 'fail';
  return '';
}

export function challengeKey(w: HTMLElement | null): string {
  const img = w?.querySelector<HTMLImageElement>('.' + P + 'bg img');
  return img ? (img.getAttribute('src') || '').split('/').pop()!.slice(0, 24) : '';
}

async function fetchImage(ctx: Ctx, url: string): Promise<string | null> {
  const r = await ctx.bg<{ ok: boolean; data?: string }>('fetchImage', { url, kind: 'dxrotate' });
  return r && r.ok && r.data ? r.data : null;
}

async function round(ctx: Ctx, w: HTMLElement, tried: number): Promise<string> {
  const sub = w.querySelector<HTMLElement>('.' + P + 'sub-slider');
  const disc = sub?.querySelector<HTMLImageElement>('img');
  const bg = w.querySelector<HTMLImageElement>('.' + P + 'bg img');
  const knob = w.querySelector<HTMLElement>('.' + P + 'slider');
  const bar = w.querySelector<HTMLElement>('.' + P + 'bar');
  if (!sub || !disc || !bg || !knob || !bar || !disc.src || !bg.src) return 'unread';
  const turned = /rotate\(\s*(-?[0-9.]+)deg/.exec(sub.style.transform || '');
  if (turned && Math.abs(parseFloat(turned[1])) > 0.5) return 'unread';     // the disc is still turned from a try
  const [b64disc, b64bg] = await Promise.all([fetchImage(ctx, disc.src), fetchImage(ctx, bg.src)]);
  if (!b64disc || !b64bg) return 'picture_fetch';
  const sb = boxOf(sub), bb = boxOf(bg);
  // still being laid out (seen live 22 Nov: a zero-width picture was sent and refused as invalid): look again
  if (bb[2] < 50 || sb[2] < 10 || !bg.complete || !disc.complete) return 'unread';
  const discCss = parseFloat(sub.style.width) || sb[2];          // its own size (its box grows when turned)
  const r = await solveTask('dxrotate', { type: 'RotateTask', imageDisc: b64disc, imageBackground: b64bg,
    discCssWidth: discCss, bgCssWidth: bb[2],
    discCenter: [Math.round((sb[0] + sb[2] / 2 - bb[0]) * 10) / 10, Math.round((sb[1] + sb[3] / 2 - bb[1]) * 10) / 10] });
  if (r.errorId) return r.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE' ? 'unread' : (r.errorCode || 'api').toLowerCase();
  let ang = Number(r.solution.angle) || 0;
  if (tried) ang = (ang + (tried % 2 ? 20 : -20) + 360) % 360;     // the same picture after a refused turn
  const travel = boxOf(bar)[2] - boxOf(knob)[2];
  await idle(0.3, 0.7);
  await slide(knob, Math.max(1, (ang / 360) * travel));
  return 'acted';
}

async function solve(ctx: Ctx): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let rounds = 0, unread = 0, lastKey = '', lastAct = 0;
  const seen = new Map<string, number>();
  while (elapsed() < BUDGET_S) {
    const w = active();
    if (!w) {
      if (rounds) return { solved: true, reason: 'solved', rounds };      // the pop-up closes after the pass
      if (elapsed() > 20) return { solved: false, reason: 'no_widget', rounds };
      await sleep(1.0);
      continue;
    }
    const state = barState(w);
    if (state === 'success') return { solved: true, reason: 'solved', rounds };
    const key = challengeKey(w);
    if ((key === lastKey && performance.now() - lastAct < 4000) || state === 'fail') { await sleep(0.6); continue; }
    if (rounds >= TRIES) return { solved: false, reason: 'rejected', rounds };
    await idle(0.7, 1.4);
    rounds++;
    const tried = seen.get(key) || 0;
    const acted = await round(ctx, w, tried);
    report('dxrotate', 'round', { n: rounds, error: acted === 'acted' || acted === 'unread' ? '' : acted });
    lastKey = key;
    lastAct = performance.now();
    if (acted === 'acted') { seen.set(key, tried + 1); await sleep(1.5); continue; }
    rounds--;
    if (acted !== 'unread') return { solved: false, reason: acted, rounds };
    if (++unread >= 3) return { solved: false, reason: 'not_read', rounds };
    await sleep(1.5);
  }
  const w = active();
  return { solved: !!w && barState(w) === 'success', reason: 'timeout', rounds };
}

export async function runDingxiang(ctx: Ctx) {
  let busy = false;
  let doneFor = '';
  const go = async (why: 'auto' | 'button') => {
    const w = active();
    if (busy || !w || barState(w) === 'success') return;
    busy = true;
    const t0 = performance.now();
    const anchor = boxOf(w);
    try {
      const may = await ctx.start('dxrotate', why, { verified: providerScripts('dxrotate'), anchor });
      if (!may.ok) return;
      const r = await solve(ctx);
      ctx.end('dxrotate', r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds, seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
      doneFor = challengeKey(active());
    }
  };
  ctx.onManual('dxrotate', () => { const w = active(); return !!w && barState(w) !== 'success'; }, () => go('button'),
    () => { const w = active(); return w ? boxOf(w) : null; });
  for (;;) {
    await sleep(0.8);
    if (busy || !ctx.cfg.auto || ctx.skipAuto('dxrotate')) continue;
    if (!document.querySelector('.' + P + 'wrapper')) continue;
    const w = active();
    if (!w || barState(w) === 'success' || (doneFor && doneFor === challengeKey(w))) continue;
    await go('auto');
  }
}
