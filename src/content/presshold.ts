// HUMAN's "Press & Hold" (store block pages and dialogs, "Robot or human?"), as Browsa's cloud browsers do it: the
// button sits in a frame inside a closed shadow root under #px-captcha, next to hidden decoys. It is pressed and
// held like a hand until its label says "completed", then released a moment later. The check refuses synthetic
// page events, so this needs Trusted input (the browser's debugger sends real pointer events); without it the
// notice says so. No API call and no credits; the vendor's server gives the verdict (the check goes away).
import type { Ctx } from './main';
import { holdAt, idle, sleep, visible } from '../lib/input';
import { deepAll, shadowOf } from '../lib/dom';
import { providerScripts } from '../lib/origin';
import { IS_FIREFOX } from '../lib/config';

const MAX_HOLD_S = 25;
const DONE = /completed/i;

const container = () => document.getElementById('px-captcha');

interface Button { el: HTMLElement; box: [number, number, number, number] }

/** The visible hold button (through the shadow root and the frame), in top-page CSS px. */
export function holdButton(): Button | null {
  const c = container();
  if (!c) return null;
  const roots: ParentNode[] = [c];
  const sr = shadowOf(c);
  if (sr) roots.push(sr);
  for (const r of roots) {
    for (const f of deepAll<HTMLIFrameElement>('iframe', r)) {
      const fr = f.getBoundingClientRect();
      if (fr.width < 40 || fr.height < 20 || !visible(f)) continue;          // the decoys are hidden
      let doc: Document | null = null;
      try { doc = f.contentDocument; } catch { doc = null; }
      const b = doc && (doc.querySelector<HTMLElement>('[role="button"][aria-label]') || doc.querySelector<HTMLElement>('[role="button"]'));
      if (b) {
        const br = b.getBoundingClientRect();
        if (br.width > 10) return { el: b, box: [fr.left + br.left, fr.top + br.top, br.width, br.height] };
      }
      return { el: f, box: [fr.left, fr.top, fr.width, fr.height] };      // the frame itself is the button
    }
    const b = deepAll<HTMLElement>('[role="button"]', r).find((x) => visible(x));
    if (b) { const br = b.getBoundingClientRect(); return { el: b, box: [br.left, br.top, br.width, br.height] }; }
  }
  return null;
}

const present = () => { const c = container(); return !!c && visible(c) && !!holdButton(); };

export async function runPressHold(ctx: Ctx) {
  if (!ctx.isTop) return;
  let busy = false;
  let tries = 0;
  const go = async (why: 'auto' | 'button') => {
    if (busy) return;
    const btn = holdButton();
    if (!btn) return;
    busy = true;
    tries++;
    const t0 = performance.now();
    try {
      const may = await ctx.start('presshold', why, { verified: providerScripts('presshold'), anchor: btn.box });
      if (!may.ok) return;
      if (IS_FIREFOX) { ctx.end('presshold', 'unsupported', { reason: 'no_trusted', anchor: btn.box }); return; }
      await idle(0.6, 1.4);
      const [x, y, w, h] = btn.box;
      const px = Math.round(x + w * (0.4 + Math.random() * 0.2)), py = Math.round(y + h * (0.4 + Math.random() * 0.2));
      const hold = await holdAt(px, py);
      if (!hold.ok) { ctx.end('presshold', 'skipped', { reason: 'needs_trusted', anchor: btn.box }); return; }
      const held = performance.now();
      try {
        while ((performance.now() - held) / 1000 < MAX_HOLD_S) {
          await sleep(0.25 + Math.random() * 0.15);
          const b = holdButton();
          if (!b || DONE.test(b.el.getAttribute('aria-label') || '')) { await idle(0.45, 0.9); break; }
        }
      } finally {
        await hold.release();
      }
      for (let i = 0; i < 24; i++) {                    // the vendor's server answers after the release
        await sleep(0.5);
        if (!present()) { ctx.end('presshold', 'solved', { rounds: tries, seconds: (performance.now() - t0) / 1000 }); return; }
      }
      ctx.end('presshold', 'failed', { reason: 'hold_failed', rounds: tries, seconds: (performance.now() - t0) / 1000, anchor: btn.box });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('presshold', present, () => go('button'));
  for (;;) {
    await sleep(1.0);
    if (busy || tries >= 2 || !ctx.cfg.auto || ctx.skipAuto('presshold')) continue;
    if (!document.getElementById('px-captcha')) continue;
    if (present()) await go('auto');
  }
}
