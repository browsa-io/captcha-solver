// Altcha: a checkbox that starts a proof of work in the page; the page's own script does the work and the site's
// server checks it when the form is sent. The extension only ticks the box like a hand and waits for "verified".
// No API call and no credits.
import type { Ctx } from './main';
import { click, idle, shows, sleep, visible } from '../lib/input';
import { deepAll, shadowOf } from '../lib/dom';

function widgets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('altcha-widget')).filter((w) => shows(w) || shows(w.firstElementChild));
}

function parts(w: HTMLElement): { box: HTMLInputElement | null; state: string } {
  const root: ParentNode = shadowOf(w) || w;
  const box = deepAll<HTMLInputElement>('input[type="checkbox"]', root)[0] || null;
  const st = deepAll<HTMLElement>('[data-state]', root)[0];
  return { box, state: (st?.getAttribute('data-state') || '').toLowerCase() };
}

export async function runAltcha(ctx: Ctx) {
  const done = new WeakSet<HTMLElement>();
  let busy = false;
  const go = async (why: 'auto' | 'button') => {
    if (busy) return;
    const w = widgets().find((x) => !done.has(x) && parts(x).state !== 'verified');
    if (!w) return;
    const { box } = parts(w);
    if (!box) return;
    busy = true;
    done.add(w);
    const t0 = performance.now();
    try {
      const r = w.getBoundingClientRect();
      const may = await ctx.start('altcha', why, { verified: w.matches(':defined'),
        anchor: [r.left, r.top, r.width, r.height] });
      if (!may.ok) return;
      await idle(0.6, 1.4);
      await click(shows(box) ? box : (box.closest('label') || box));
      for (let i = 0; i < 120; i++) {                       // the proof of work: usually 1-5 s
        await sleep(0.5);
        const s = parts(w).state;
        if (s === 'verified') { ctx.end('altcha', 'solved', { rounds: 1, seconds: (performance.now() - t0) / 1000 }); return; }
        if (s === 'error' || s === 'expired') { ctx.end('altcha', 'failed', { reason: 'refused_by_site', seconds: (performance.now() - t0) / 1000 }); return; }
        if (i === 6 && (s === 'unverified' || s === '')) await click(box);   // the first click was not taken
      }
      ctx.end('altcha', 'failed', { reason: 'timeout', seconds: (performance.now() - t0) / 1000 });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('altcha', () => widgets().some((x) => parts(x).state !== 'verified'), () => go('button'));
  for (;;) {
    await sleep(1.0);
    if (busy || !ctx.cfg.auto || ctx.skipAuto('altcha')) continue;
    if (!document.querySelector('altcha-widget')) continue;
    if (widgets().some((x) => !done.has(x) && parts(x).state !== 'verified' && parts(x).box)) await go('auto');
  }
}
