// CyberSiARA (SiaraShield, mycybersiara.com): the animated letters. The
// widget lives in the page (div.SiaraShield, its scripts from mycybersiara.com); when the site opens its challenge, a
// dialog (#myModal) shows an animation of noise in which the letters only appear over time (img#Img_Original, a GIF)
// and a field (#Input_Captcha). The GIF is fetched by the background from CyberSiARA's own hosts only and sent as
// CyberSiaraTask, whose frames are averaged on the server (the noise cancels, the letters stay) and read; the
// letters are typed key by key and the widget sends them itself when the last one is typed. Done when the widget
// marks the visitor verified or puts its token in the form; a wrong answer (#WrongcptchaDiv) brings a new
// animation, answered by the stronger model first. The dialog closes itself after about 30 s, so it is quick.
import type { Ctx } from './main';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, idle, sleep, slide, typeInto, visible } from '../lib/input';
import { providerScripts } from '../lib/origin';

const BUDGET_S = 60;
const MAX_ROUNDS = 3;
const GIF = /^https:\/\/([a-z0-9-]+\.)*mycybersiara\.com\/.*SiaraShield[\w.-]*\.gif/i;

const q = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s);

export const widget = (doc: Document = document) => q('.SiaraShield', doc);

/** The open challenge dialog (null while it is closed). */
export function modal(doc: Document = document): HTMLElement | null {
  if (!widget(doc)) return null;
  const m = q('#myModal', doc);
  return m && m.classList.contains('cs-modal-open') && visible(m) ? m : null;
}

export function parts(doc: Document = document) {
  const m = modal(doc);
  if (!m) return { img: null, input: null, refresh: null };
  const img = q<HTMLImageElement>('img#Img_Original', m);
  return {
    img: img && GIF.test(img.src) ? img : null,
    input: q<HTMLInputElement>('input#Input_Captcha', m),
    refresh: q('#a_Refresh', m),
  };
}

export function token(doc: Document = document): string {
  return q<HTMLInputElement>('input#CyberSiaraToken', doc)?.value || '';
}

/** The vendor's server accepted this visitor: its token is in the form, or its slider row carries the verified mark. */
export function passed(doc: Document = document): boolean {
  return !!token(doc) || !!q('.cs-slider-verify-text.cs-verified-box', doc);
}

export const wrong = (doc: Document = document) => { const w = q('#WrongcptchaDiv', doc); return !!w && visible(w); };

/** A challenge on screen now: the open dialog with its animation and field (the widget's hidden parts are in every
 * page that embeds it; they are not a captcha until the site opens them). */
export function present(doc: Document = document): boolean {
  const p = parts(doc);
  return !!p.img && !!p.input && !passed(doc);
}

async function gif(ctx: Ctx, url: string): Promise<string | null> {
  const r = await ctx.bg<{ ok: boolean; data?: string }>('fetchImage', { url, kind: 'cybersiara' });
  return r && r.ok && r.data ? r.data : null;
}

async function solve(ctx: Ctx): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  let rounds = 0;
  let last = '';
  let reason = 'timeout';
  // some security levels show "Slide to Verify" first
  if (!modal()) {
    const sl = q<HTMLInputElement>('input#sliderp.CyberDrag');
    if (sl && visible(sl)) {
      const b = boxOf(sl);
      const knob = document.elementFromPoint(b[0] + Math.min(18, b[3] / 2), b[1] + b[3] / 2) || sl;
      await idle(0.4, 0.9);
      await slide(knob, b[2] - 30);
    }
  }
  while ((performance.now() - t0) / 1000 < BUDGET_S && rounds < MAX_ROUNDS) {
    if (passed()) return { solved: true, reason: 'solved', rounds };
    const { img, input, refresh } = parts();
    if (!img || !input) {
      if (rounds && !modal()) { await sleep(1.0); if (passed()) return { solved: true, reason: 'solved', rounds }; }
      if ((performance.now() - t0) / 1000 > 15 && !rounds) return { solved: false, reason: 'no_challenge', rounds };
      await sleep(0.6);
      continue;
    }
    if (img.src === last) {
      // the same animation after a miss: a new one with the widget's own refresh link
      if ((wrong() || reason === 'unreadable') && refresh && visible(refresh)) { await idle(0.3, 0.7); await click(refresh); }
      await sleep(1.2);
      if (reason === 'unreadable') last = '';
      continue;
    }
    last = img.src;
    const data = await gif(ctx, img.src);
    if (!data) { reason = 'picture_fetch'; return { solved: false, reason, rounds }; }
    rounds++;
    report('cybersiara', 'round', { n: rounds });
    const r = await solveTask('cybersiara', { type: 'CyberSiaraTask', body: data, escalate: rounds > 1 });
    if (r.errorId) {
      if (r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') return { solved: false, reason: String(r.errorCode || 'api_error').toLowerCase(), rounds };
      reason = 'unreadable';
      continue;
    }
    const answer = String(r.solution?.text || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!answer) { reason = 'unreadable'; continue; }
    await idle(0.15, 0.35);
    await typeInto(input, answer);
    // the widget posts the answer when the last letter is typed; its server's verdict shows in the page
    let v = '';
    for (let i = 0; i < 24; i++) {
      await sleep(0.4);
      if (passed()) return { solved: true, reason: 'solved', rounds };
      if (wrong()) { v = 'rejected'; break; }
      // the widget closes its dialog itself once its server took the letters (a refusal keeps it open and marks it)
      if (i >= 2 && !modal() && !wrong()) { await sleep(0.8); if (!wrong()) return { solved: true, reason: 'solved', rounds }; }
    }
    reason = v || 'no_verdict';
    await sleep(1.0);
  }
  return { solved: passed(), reason: passed() ? 'solved' : (rounds >= MAX_ROUNDS ? 'rounds' : reason), rounds };
}

export async function runCyberSiara(ctx: Ctx) {
  if (!ctx.isTop) return;
  let busy = false;
  let shown = '';                                // one automatic solve per animation the site opens
  const go = async (why: 'auto' | 'button') => {
    if (busy || !present()) return;
    busy = true;
    const t0 = performance.now();
    const m = modal();
    const anchor = m ? boxOf(m) : null;
    try {
      // the widget's own scripts (from CyberSiARA's hosts), not a look-alike drawn by the page
      const may = await ctx.start('cybersiara', why, { verified: providerScripts('cybersiara'), anchor });
      if (!may.ok) return;
      const r = await solve(ctx);
      ctx.end('cybersiara', r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds,
        seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('cybersiara', present, () => go('button'), () => { const m = modal(); return m ? boxOf(m) : null; });
  for (;;) {
    await sleep(0.7);
    if (busy || !widget() || !ctx.cfg.auto || ctx.skipAuto('cybersiara')) continue;
    const p = parts();
    if (p.img && p.input && !passed() && p.img.src !== shown) { shown = p.img.src; await go('auto'); }
  }
}
