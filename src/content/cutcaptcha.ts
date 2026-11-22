// Cutcaptcha (cutcaptcha.net), ported from Browsa's in-session solver. The widget is
// drawn in the page, in a closed shadow root under div.cutcaptcha[data-sitekey="cc_..."], and only once its host
// comes near the window. A click on its box starts the widget's own background check; a visitor it trusts is ticked,
// the others get a jigsaw: a picture with more holes than pieces, the pieces in a tray under it. The picture and the
// pieces are data: pictures in the dialog; JigsawTask matches each piece to its hole (no model) and each piece is
// dragged by a point on itself into its place; then Verify. Done when the box says aria-checked="true" and the
// form's cutcaptcha-response field holds the token Cutcaptcha's server issued.
import type { Ctx } from './main';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, drag, idle, sleep, visible, type Box } from '../lib/input';
import { deepAll } from '../lib/dom';
import { providerScripts } from '../lib/origin';

const BUDGET_S = 75;
const MAX_ROUNDS = 3;
const DRAW_WAIT_S = 10;

/** The element the site put the widget in: div.cutcaptcha with one of the vendor's site keys (cc_...). */
export const host = (doc: ParentNode = document) =>
  Array.from(doc.querySelectorAll<HTMLElement>('div.cutcaptcha[data-sitekey]')).find((h) => /^cc_/.test(h.dataset.sitekey || '')) || null;
const box = (h: HTMLElement) => deepAll<HTMLElement>('.cc__box[role="checkbox"]', h)[0] || null;
const token = (h: HTMLElement) => (h.querySelector<HTMLInputElement>('input[name="cutcaptcha-response"]')?.value || '');
export const checked = (h: HTMLElement) => box(h)?.getAttribute('aria-checked') === 'true' && token(h).length > 10;
const label = (h: HTMLElement) => (deepAll('.cc__label', h)[0]?.textContent || '').trim().toLowerCase();

/** The jigsaw dialog while it is open (it holds the picture and at least one piece): inside the widget, or a dialog
 * the widget put elsewhere in the page. */
function dialog(h: HTMLElement): HTMLElement | null {
  for (const root of [h, document.body]) {
    const d = deepAll<HTMLElement>('.ccm__panel', root).find((p) => visible(p) && deepAll('.ccm__pic', p).length);
    if (d) return d;
  }
  return null;
}

const dataOf = (img: HTMLImageElement | null) => {
  const m = /^data:image\/[\w+.-]+;base64,(.+)$/s.exec(img?.getAttribute('src') || '');
  return m ? m[1] : null;
};

function parts(dlg: HTMLElement): { pic: HTMLImageElement | null; pieces: Array<{ el: HTMLElement; img: HTMLImageElement }> } {
  const pic = (deepAll<HTMLImageElement>('img.ccm__pic', dlg)[0] || deepAll<HTMLElement>('.ccm__pic', dlg).map((e) => e.querySelector('img'))[0] || null) as HTMLImageElement | null;
  const pieces = deepAll<HTMLElement>('.ccm__piece', dlg).map((el) => ({ el, img: el.querySelector('img') as HTMLImageElement })).filter((p) => !!p.img);
  return { pic, pieces };
}

const press = async (dlg: HTMLElement, cls: string) => {
  const b = deepAll<HTMLElement>('.' + cls, dlg).find((x) => visible(x));
  if (!b) return false;
  await click(b);
  return true;
};

async function solve(h: HTMLElement): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  const left = () => BUDGET_S - (performance.now() - t0) / 1000;
  let rounds = 0;
  if (checked(h)) return { solved: true, reason: 'no_puzzle', rounds };
  let b = box(h);
  if (!b && !dialog(h)) {
    // not drawn yet: bring the host near, as a visitor scrolling to the form does, and wait for the widget
    h.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    for (let i = 0; i < DRAW_WAIT_S * 2 && !(b = box(h)); i++) await sleep(0.5);
    if (!b) return { solved: false, reason: 'not_drawn', rounds };
  }
  if (!dialog(h)) {
    const r = b!.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) b!.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    await idle(0.6, 1.2);
    await click(deepAll('.cc__indicator', b!)[0] || b!);
  }
  while (left() > 0) {
    let dlg: HTMLElement | null = null;
    while (left() > 0) {                       // the widget's verdict on the click, or the jigsaw
      await sleep(0.6);
      if (checked(h)) return { solved: true, reason: rounds ? 'solved' : 'no_puzzle', rounds };
      dlg = dialog(h);
      if (dlg && parts(dlg).pieces.length) break;
      const lab = label(h);
      if (!dlg && /failed|try again|error/.test(lab)) return { solved: false, reason: 'refused', rounds };
    }
    if (!dlg) return { solved: false, reason: 'timeout', rounds };
    if (rounds >= MAX_ROUNDS) return { solved: false, reason: 'rejected', rounds };
    rounds++;
    await idle(0.8, 1.5);                      // a person looks at the picture first
    const { pic, pieces } = parts(dlg);
    const picture = dataOf(pic), pngs = pieces.map((p) => dataOf(p.img));
    if (!pic || !picture || pngs.some((x) => !x)) return { solved: false, reason: 'not_read', rounds };
    const res = await solveTask('cutcaptcha', { type: 'JigsawTask', imageBackground: picture, pieces: pngs });
    report('cutcaptcha', 'round', { n: rounds, error: res.errorCode || '' });
    if (res.errorId) {
      if (res.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') return { solved: false, reason: (res.errorCode || 'api').toLowerCase(), rounds };
      if (!(await press(dlg, 'ccm__re'))) return { solved: false, reason: 'not_read', rounds };
      await sleep(2);
      continue;
    }
    const places = res.solution.places as Array<{ x: number; y: number }>;
    const grabs = res.solution.grabs as Array<{ x: number; y: number }>;
    const first = (pic.getAttribute('src') || '').slice(-80);
    for (let i = 0; i < pieces.length; i++) {
      const pb: Box = boxOf(pic), cur: Box = boxOf(pieces[i].el);
      const scale = pb[2] / (pic.naturalWidth || pb[2]);          // CSS px per picture-file px
      const pw = pieces[i].img.naturalWidth || cur[2], ph = pieces[i].img.naturalHeight || cur[3];
      // hold the piece on a point of itself; the hand's offset inside the piece stays the same while dragging
      const gx = cur[0] + (grabs[i].x / pw) * cur[2] + (Math.random() - 0.5) * 6;
      const gy = cur[1] + (grabs[i].y / ph) * cur[3] + (Math.random() - 0.5) * 6;
      const dx = pb[0] + places[i].x * scale - cur[0], dy = pb[1] + places[i].y * scale - cur[1];
      await drag([gx, gy], [gx + dx, gy + dy]);
      await idle(0.3, 0.7);
    }
    await idle(0.3, 0.6);
    if (!(await press(dlg, 'ccm__go'))) return { solved: false, reason: 'no_verify_button', rounds };
    // the dialog closes on a pass; on a miss it shows a new picture (or the widget refuses)
    for (let i = 0; i < 40 && left() > 0; i++) {
      await sleep(0.5);
      if (checked(h)) return { solved: true, reason: 'solved', rounds };
      const d2 = dialog(h);
      const p2 = d2 ? parts(d2).pic : null;
      if (p2 && (p2.getAttribute('src') || '').slice(-80) !== first) break;
    }
  }
  return { solved: checked(h), reason: checked(h) ? 'solved' : 'timeout', rounds };
}

export async function runCutcaptcha(ctx: Ctx): Promise<void> {
  let busy = false;
  const done = new WeakSet<Element>();
  const go = async (why: 'auto' | 'button') => {
    const h = host();
    if (busy || !h || checked(h)) return;
    busy = true;
    const t0 = performance.now();
    const anchor = boxOf(h);
    try {
      // Cutcaptcha's own script (from its hosts), not a look-alike drawn by the page
      const may = await ctx.start('cutcaptcha', why, { verified: providerScripts('cutcaptcha'), anchor });
      if (!may.ok) return;
      const r = await solve(h);
      ctx.end('cutcaptcha', r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds, seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
      done.add(h);
    }
  };
  ctx.onManual('cutcaptcha', () => { const h = host(); return !!h && !checked(h); }, () => go('button'), () => { const h = host(); return h ? boxOf(h) : null; });
  for (;;) {
    await sleep(1.0);
    if (busy || !ctx.cfg.auto) continue;
    const h = host();
    if (!h || done.has(h) || checked(h) || ctx.skipAuto('cutcaptcha')) continue;
    // by itself only once the person has the widget in front of them (it draws itself when its form is scrolled
    // near); the page is never scrolled for an automatic solve. The Solve button brings it into view.
    const b = box(h);
    if (!b || !visible(b)) continue;
    const r = b.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    await go('auto');
  }
}
