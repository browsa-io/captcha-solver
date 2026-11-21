// Cloudflare Turnstile and Cloudflare's full-page check ("Verify you are human"): both are the same frame from
// challenges.cloudflare.com. Most visits pass with no click; when the frame shows its checkbox, it is clicked like a
// hand, at most three times per frame. No API call and no credits: the browser itself is what Cloudflare judges.
// The frame keeps its widget in a closed shadow root, which the content script reads (read only).
//
// Which one: the tab's title on a full-page check is Cloudflare's ("Just a moment...") and the real page loads
// after a pass; a Turnstile widget sits in an ordinary page and says "Success!".
import type { Ctx } from './main';
import { boxOf, click, clickBox, idle, shows, sleep, visible } from '../lib/input';
import { deepOne, deepAll } from '../lib/dom';
import { PROVIDER_FRAMES } from '../lib/origin';

export const isTurnstileFrame = (u: string) => PROVIDER_FRAMES.turnstile!(u);
const CHECK_TITLE = /just a moment|un instant|einen moment|un momento|um momento|attention required|checking your browser|ちょっと待|請稍候|请稍候/i;

export const checkPageTitle = (t: string) => CHECK_TITLE.test(t || '');

function state(): 'checkbox' | 'success' | 'fail' | 'working' | 'none' {
  const ok = deepOne('#success');
  if (ok && visible(ok)) return 'success';
  for (const id of ['#fail', '#expired', '#timeout']) {
    const e = deepOne(id);
    if (e && visible(e)) return 'fail';
  }
  const box = checkbox();
  if (box) return 'checkbox';
  const v = deepOne('#verifying');
  return v && visible(v) ? 'working' : 'none';
}

function checkbox(): HTMLElement | null {
  const inputs = deepAll<HTMLInputElement>('input[type="checkbox"]');
  const i = inputs.find((x) => shows(x) || shows(x.closest('label')));
  if (!i) return null;
  const label = i.closest('label');
  return (shows(i) ? i : label) as HTMLElement | null;
}

export async function runTurnstile(ctx: Ctx) {
  let kind: 'cfchallenge' | 'turnstile' = checkPageTitle(ctx.title) ? 'cfchallenge' : 'turnstile';
  // the tab's title can still be empty when the frame starts: ask again while the checkbox is up
  const refresh = async () => { const w = await ctx.bg<{ title?: string }>('whereAmI'); if (w && w.title) kind = checkPageTitle(w.title) ? 'cfchallenge' : 'turnstile'; };
  let clicks = 0;
  let busy = false;
  const t0 = performance.now();
  const go = async (why: 'auto' | 'button') => {
    if (busy) return;
    const box = checkbox();
    if (!box) return;
    busy = true;
    try {
      const may = await ctx.start(kind, why, { verified: true });
      if (!may.ok) return;
      clicks++;
      await idle(0.8, 1.8);                          // a person reads the box before clicking it
      const b = boxOf(box);
      // the visible square, not the whole label: the left part of the widget
      if (box.tagName === 'LABEL') await clickBox([b[0], b[1], Math.min(b[2], 28), b[3]]);
      else await click(box);
      const t1 = performance.now();
      while (performance.now() - t1 < 12_000) {
        await sleep(0.4);
        const s = state();
        if (s === 'success') {
          ctx.end(kind, 'solved', { rounds: clicks, seconds: (performance.now() - t0) / 1000 });
          return;
        }
        if (s === 'fail') break;
        if (s === 'checkbox' && performance.now() - t1 > 4000) break;      // the click was not taken
      }
      if (clicks >= 3 || why === 'button') {
        ctx.end(kind, 'failed', { reason: state() === 'fail' ? 'refused_by_site' : 'not_taken', rounds: clicks,
          seconds: (performance.now() - t0) / 1000 });
      }
    } finally {
      busy = false;
    }
  };
  ctx.onManual('turnstile', () => !!checkbox(), async () => { await refresh(); return go('button'); });
  for (;;) {
    await sleep(1.0);
    if (busy || clicks >= 3 || !ctx.cfg.auto) continue;
    if (checkbox()) await refresh();
    if (ctx.skipAuto(kind)) continue;
    if (performance.now() - t0 < 2500) continue;     // Cloudflare decides most visits by itself first
    if (checkbox()) await go('auto');
  }
}
