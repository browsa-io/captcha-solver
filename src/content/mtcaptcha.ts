// MTCaptcha, in its own frame from mtcaptcha.com. The picture of four to six
// distorted characters is the frame's own (a data: picture in the frame, nothing is fetched); MtCaptchaTask reads
// it (the stronger model first from the second picture on, as the engine does); the characters are typed key by
// key into the frame's field, which sends them to MTCaptcha's server itself. MTCaptcha's status line says
// "verified" and its token lands in the page's mtcaptcha-verifiedtoken field (the site's server checks it); a wrong
// answer brings a new picture, and the same picture again is swapped with the widget's own refresh button.
import type { Ctx } from './main';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, idle, sleep, typeInto, visible } from '../lib/input';

export const isMtFrame = (u: string) => /^https:\/\/([a-z0-9-]+\.)*mtcaptcha\.com\/mtcv1\/client\/iframe\.html/i.test(u);

const BUDGET_S = 60;
const MAX_ROUNDS = 4;

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);

/** The picture as the frame draws it: the data: picture of #mtcap-image-N (its background, or its no-CSS <img>). */
export function picture(doc: Document = document): string {
  const box = doc.querySelector<HTMLElement>('div.mtcap-image[id^="mtcap-image-"]');
  if (!box) return '';
  const m = /url\("?(data:image\/[a-z+.-]+;base64,[^")]+)"?\)/i.exec(box.style.backgroundImage || '');
  if (m) return m[1];
  const img = box.querySelector<HTMLImageElement>('img[id^="mtcap-image-nocss-"]');
  return img && /^data:image\//.test(img.src) ? img.src : '';
}

export function parts(doc: Document = document) {
  return {
    image: doc.querySelector<HTMLElement>('div.mtcap-image[id^="mtcap-image-"]'),
    input: doc.querySelector<HTMLInputElement>('input.mtcap-inputtext'),
    refresh: doc.querySelector<HTMLInputElement>('input.mtcap-statusbutton'),
  };
}

/** 'verified', 'rejected' or '' from the widget's status line (mtcaptcha.status_verdict). */
export function statusVerdict(doc: Document = document): string {
  const t = (doc.querySelector('[id^="desc4CaptchaStatus"]')?.textContent || '').toLowerCase();
  if (!t) return '';
  if (/incorrect|invalid|wrong|try again|not match|failed/.test(t)) return 'rejected';
  if (/verified|success/.test(t)) return 'verified';
  return '';
}

const present = () => { const p = parts(); return !!p.image && !!p.input && visible(p.input) && !!picture() && statusVerdict() !== 'verified'; };

async function solve(ctx: Ctx): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  let rounds = 0;
  let last = '';
  let reason = 'timeout';
  while ((performance.now() - t0) / 1000 < BUDGET_S && rounds < MAX_ROUNDS) {
    if (statusVerdict() === 'verified') return { solved: true, reason: 'solved', rounds };
    const { input, refresh } = parts();
    const pic = picture();
    if (!pic || !input) { await sleep(0.8); continue; }
    if (pic === last) {
      // a refused answer that left the same picture: a new one with the widget's own refresh button
      if (refresh && visible(refresh)) { await idle(0.4, 0.9); await click(refresh); }
      await sleep(1.5);
      last = '';
      continue;
    }
    last = pic;
    rounds++;
    report('mtcaptcha', 'round', { n: rounds });
    const r = await solveTask('mtcaptcha', { type: 'MtCaptchaTask', body: pic.split(',')[1], escalate: rounds > 1 });
    if (r.errorId) {
      if (r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') return { solved: false, reason: String(r.errorCode || 'api_error').toLowerCase(), rounds };
      reason = 'unreadable';
      continue;
    }
    const answer = String(r.solution?.text || '').replace(/[^A-Za-z0-9]/g, '');
    if (!answer) { reason = 'unreadable'; continue; }
    await idle(0.3, 0.8);
    if (input.value) { input.select(); document.execCommand('delete'); }
    await typeInto(input, answer);
    // the widget checks the answer with MTCaptcha's server as soon as it is typed; its status line says so
    let v = '';
    for (let i = 0; i < 24 && !(v = statusVerdict()); i++) await sleep(0.4);
    if (v === 'verified') return { solved: true, reason: 'solved', rounds };
    reason = v === 'rejected' ? 'rejected' : 'no_verdict';
    await sleep(1.0);                                     // the widget swaps in a new picture
  }
  return { solved: statusVerdict() === 'verified', reason: rounds >= MAX_ROUNDS ? 'rounds' : reason, rounds };
}

export async function runMtCaptcha(ctx: Ctx) {
  let busy = false;
  let done = false;
  const go = async (why: 'auto' | 'button') => {
    if (busy || !present()) return;
    busy = true;
    const t0 = performance.now();
    try {
      // this frame is MTCaptcha's own (the background checks the frame's address)
      const may = await ctx.start('mtcaptcha', why, { verified: true });
      if (!may.ok) return;
      const r = await solve(ctx);
      ctx.end('mtcaptcha', r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds,
        seconds: (performance.now() - t0) / 1000 });
      done = r.solved;
    } finally {
      busy = false;
    }
  };
  ctx.onManual('mtcaptcha', present, () => go('button'), () => { const p = parts().image; return p ? boxOf(p) : null; });
  let tries = 0;
  for (;;) {
    await sleep(0.8);
    if (busy || done || tries >= 2 || !ctx.cfg.auto || ctx.skipAuto('mtcaptcha')) continue;
    if (present()) { tries++; await go('auto'); }
  }
}
