// NetEase Yidun (易盾), ported from Browsa's in-session solver. The widget draws in the page:
// `.yidun` with a modifier for the puzzle, a picture panel (shown when the pointer is over the bar in the "float"
// layout, after a click in the others) and a bar. Three puzzles, each its own type and switch:
//   ydslide      `yidun--jigsaw`: the background and the piece (Yidun's own files) to SliderGapTask; the knob is
//                dragged so the piece's middle follows the knob's middle; a refused slide tries the next candidate
//   ydinference  `yidun--inference`: eight tiles cut from one picture file, two of them swapped; TileSwapTask finds
//                the pair from that file; one tile is dragged onto the other
//   ydicon       `yidun--icon_point`: the picture file holds the photo (top) and the reference icons (the bar shows
//                one row of them); ClickOrderTask with the photo and the bar's window on the same file, cut at the ink
// Yidun's server answers each attempt (c.dun.163.com /api/v3/check); the bar turns `yidun--success` and the page's
// NECaptchaValidate field gets the value the site's server checks.
import type { Ctx } from './main';
import type { Kind } from '../lib/config';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, clickBox, drag, hover, idle, sleep, slide, visible, type Box } from '../lib/input';
import { providerScripts } from '../lib/origin';

const BUDGET_S = 75;
const TRIES = 4;
const KINDS: Record<string, Kind> = { 'yidun--jigsaw': 'ydslide', 'yidun--inference': 'ydinference', 'yidun--icon_point': 'ydicon' };

/** Yidun widgets on the page (a `.yidun` element with a puzzle modifier). */
export function roots(doc: ParentNode = document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('.yidun')).filter((r) => Array.from(r.classList).some((c) => c.startsWith('yidun--')));
}
export function kindOf(r: Element): Kind | '' {
  for (const c of Array.from(r.classList)) if (KINDS[c]) return KINDS[c];
  return '';
}
export const passed = (r: Element) => r.classList.contains('yidun--success');
const q = <T extends HTMLElement = HTMLElement>(r: Element, s: string) => r.querySelector<T>(s);

/** The first widget on screen that has not passed (demo pages show several layouts). */
export function active(doc: ParentNode = document): HTMLElement | null {
  for (const r of roots(doc)) {
    if (passed(r)) continue;
    const ctl = q(r, '.yidun_control');
    if (ctl && visible(ctl)) return r;
  }
  return null;
}

function picKey(r: Element): string {
  const img = q<HTMLImageElement>(r, '.yidun_bg-img') || q<HTMLImageElement>(r, '.yidun_inference__img');
  return img?.src ? img.src.slice(-40) : '';
}

async function file(ctx: Ctx, kind: Kind, url: string): Promise<string | null> {
  if (!url) return null;
  const res = await ctx.bg<{ ok: boolean; data?: string }>('fetchImage', { url, kind });
  return res && res.ok && res.data ? res.data : null;
}

const center = (b: Box): [number, number] => [b[0] + b[2] * (0.35 + Math.random() * 0.3), b[1] + b[3] * (0.35 + Math.random() * 0.3)];

/** Bring the widget (bar and the panel above it) into the window, as a person scrolls to it before using it. */
function inView(r: HTMLElement) {
  const ctl = q(r, '.yidun_control') || r;
  const b = ctl.getBoundingClientRect();
  if (b.top < 200 || b.bottom > window.innerHeight - 10) ctl.scrollIntoView({ block: 'end', behavior: 'instant' as ScrollBehavior });
  const c = ctl.getBoundingClientRect();
  if (c.top < 200) window.scrollBy(0, c.top - 220);
}

/** Show the picture panel as a person does: the pointer onto the bar; a click on the bar when that is not enough. */
async function openPanel(r: HTMLElement, kind: Kind): Promise<Box | null> {
  const ctl = q(r, '.yidun_control');
  if (!ctl) return null;
  inView(r);
  for (let step = 0; step < 3; step++) {
    const panel = q(r, '.yidun_panel-placeholder');
    if (panel && visible(panel) && boxOf(panel)[3] > 40) return boxOf(panel);
    const cb = boxOf(ctl);
    if (step === 0) await hover(cb[0] + cb[2] * (0.45 + Math.random() * 0.35), cb[1] + cb[3] * (0.3 + Math.random() * 0.4));
    else if (kind !== 'ydslide') await click(ctl);
    await sleep(1.2);
  }
  return null;
}

async function slideRound(ctx: Ctx, r: HTMLElement, tried: number): Promise<string> {
  const bg = q<HTMLImageElement>(r, '.yidun_bg-img'), pc = q<HTMLImageElement>(r, '.yidun_jigsaw'), knob = q(r, '.yidun_slider');
  if (!bg || !pc || !knob) return 'not_read';
  const [b64bg, b64pc] = await Promise.all([file(ctx, 'ydslide', bg.src), file(ctx, 'ydslide', pc.src)]);
  if (!b64bg || !b64pc) return 'picture_fetch';
  const bgb = boxOf(bg), pcb = boxOf(pc), kb = boxOf(knob);
  const res = await solveTask('ydslide', { type: 'SliderGapTask', imageBackground: b64bg, imageSlice: b64pc,
    top: Math.round((pcb[1] - bgb[1]) * 100) / 100, bgCssWidth: bgb[2], sliceCssWidth: pcb[2], candidates: 3 });
  report('ydslide', 'round', { n: tried + 1, error: res.errorCode || '' });
  if (res.errorId) return (res.errorCode || 'api').toLowerCase();
  const cands = (res.solution?.candidates || []) as Array<{ distance: number }>;
  const g = cands.length ? cands[Math.min(tried, cands.length - 1)].distance : Number(res.solution.distance);
  // the piece's middle follows the knob's middle (piece left = knob left - (piece w - knob w) / 2)
  const dist = Math.max(1, g + (pcb[2] - kb[2]) / 2);
  await idle(0.3, 0.7);
  await slide(knob, dist);
  return '';
}

async function inferenceRound(ctx: Ctx, r: HTMLElement): Promise<string> {
  const cells = Array.from(r.querySelectorAll<HTMLElement>('.yidun_inference')).filter((c) => visible(c));
  const img = q<HTMLImageElement>(r, '.yidun_inference__img');
  if (cells.length < 4 || !img) return 'not_read';
  const boxes = cells.map(boxOf);
  const xs = [...new Set(boxes.map((b) => Math.round(b[0])))], ys = [...new Set(boxes.map((b) => Math.round(b[1])))];
  if (xs.length * ys.length !== cells.length) return 'not_read';
  // tile i of the reading order shows the i-th part of the picture file: the file is the shuffled picture
  const order = boxes.map((b, i) => i).sort((a, b) => Math.round(boxes[a][1]) - Math.round(boxes[b][1]) || boxes[a][0] - boxes[b][0]);
  const pic = await file(ctx, 'ydinference', img.src);
  if (!pic) return 'picture_fetch';
  const res = await solveTask('ydinference', { type: 'TileSwapTask', image: pic, rows: ys.length, cols: xs.length });
  report('ydinference', 'round', { error: res.errorCode || '' });
  if (res.errorId) return (res.errorCode || 'api').toLowerCase();
  const [i, j] = res.solution.swap as [number, number];
  await idle(0.3, 0.7);
  await drag(center(boxes[order[i]]), center(boxes[order[j]]));
  return '';
}

async function iconRound(ctx: Ctx, r: HTMLElement, tried: number): Promise<string> {
  const bg = q<HTMLImageElement>(r, '.yidun_bg-img'), panel = q(r, '.yidun_panel-placeholder');
  const tip = q<HTMLImageElement>(r, '.yidun_tips__img'), ans = q(r, '.yidun_tips__answer');
  if (!bg || !panel || !tip || !ans) return 'not_read';
  const pic = await file(ctx, 'ydicon', bg.src);
  if (!pic || !bg.naturalWidth) return 'picture_fetch';
  const W = bg.naturalWidth, H = bg.naturalHeight;
  const bgb = boxOf(bg), pb = boxOf(panel), tb = boxOf(tip), ab = boxOf(ans);
  const k = W / bgb[2];
  const crop = [0, 0, W, Math.round(pb[3] * k)];
  // the bar shows one row of the reference icons: the answer box's window on the same picture file
  const kx = W / tb[2], ky = H / tb[3];
  const refCrop = [(ab[0] - tb[0]) * kx, (ab[1] - tb[1]) * ky, ab[2] * kx, ab[3] * ky].map((v) => Math.round(v * 100) / 100);
  const res = await solveTask('ydicon', { type: 'ClickOrderTask', image: pic, crop, referenceCrop: refCrop, split: 'ink',
    // Yidun's icons are faint, warped copies of the references: the stronger model first (as in the engine)
    strongFirst: true, what: 'small white or grey icons' });
  report('ydicon', 'round', { n: tried + 1, error: res.errorCode || '' });
  if (res.errorId) return (res.errorCode || 'api').toLowerCase();
  const pts = (res.solution?.points || []) as Array<[number, number]>;
  await sleep(0.6 + Math.random() * 0.6);
  const sx = pb[2] / crop[2], sy = pb[3] / crop[3];
  for (const [x, y] of pts) {
    const p = boxOf(panel);              // the panel may have moved while the answer was coming
    const cx = p[0] + x * sx + (Math.random() - 0.5) * 2.4, cy = p[1] + y * sy + (Math.random() - 0.5) * 2.4;
    await clickBox([cx - 3, cy - 3, 6, 6]);
    await idle(0.35, 0.8);
  }
  return '';
}

async function solve(ctx: Ctx, r: HTMLElement, kind: Kind): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let rounds = 0, unread = 0, lastKey = '', lastAct = 0;
  const seen = new Map<string, number>();
  while (elapsed() < BUDGET_S) {
    if (!r.isConnected) return { solved: false, reason: 'gone', rounds };
    if (passed(r)) return { solved: true, reason: rounds ? 'solved' : 'no_puzzle', rounds };
    const pb = await openPanel(r, kind);
    if (passed(r)) continue;
    if (!pb) {
      if (++unread >= 3) return { solved: false, reason: 'not_read', rounds };
      continue;
    }
    const key = picKey(r);
    if (key && key === lastKey && performance.now() - lastAct < 4000) { await sleep(0.6); continue; }   // the verdict is coming
    if (rounds >= TRIES) return { solved: false, reason: 'rejected', rounds };
    await idle(0.7, 1.4);                  // a person looks at the picture first
    rounds++;
    const tried = seen.get(key) || 0;
    const why = kind === 'ydslide' ? await slideRound(ctx, r, tried)
      : kind === 'ydinference' ? await inferenceRound(ctx, r) : await iconRound(ctx, r, tried);
    lastKey = key;
    lastAct = performance.now();
    if (why) {
      rounds--;
      if (why !== 'not_read' && why !== 'picture_fetch' && why !== 'error_captcha_unsolvable') return { solved: false, reason: why, rounds };
      if (++unread >= 3) return { solved: false, reason: why, rounds };
      await sleep(1.5);
      continue;
    }
    seen.set(key, tried + 1);
    for (let i = 0; i < 10 && !passed(r); i++) await sleep(0.3);
    if (passed(r)) return { solved: true, reason: 'solved', rounds };
    await sleep(1.2);
  }
  return { solved: passed(r), reason: passed(r) ? 'solved' : 'timeout', rounds };
}

export async function runYidun(ctx: Ctx): Promise<void> {
  let busy = false;
  const done = new WeakSet<Element>();      // one automatic attempt per widget; the Solve button retries
  const go = async (why: 'auto' | 'button', r: HTMLElement | null = active()) => {
    if (busy || !r) return;
    const kind = kindOf(r);
    if (!kind) return;
    busy = true;
    const t0 = performance.now();
    const anchor = boxOf(q(r, '.yidun_control') || r);
    try {
      // Yidun's own script (from Yidun's hosts), not a look-alike drawn by the page
      const may = await ctx.start(kind, why, { verified: providerScripts(kind), anchor });
      if (!may.ok) return;
      const res = await solve(ctx, r, kind);
      ctx.end(kind, res.solved ? 'solved' : 'failed', { reason: res.reason, rounds: res.rounds, seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
      done.add(r);
    }
  };
  for (const k of Object.values(KINDS)) {
    ctx.onManual(k, () => { const r = active(); return !!r && kindOf(r) === k; }, () => go('button'),
      () => { const r = active(); return r ? boxOf(q(r, '.yidun_control') || r) : null; });
  }
  for (;;) {
    await sleep(1.0);
    if (busy || !ctx.cfg.auto || !document.querySelector('.yidun')) continue;
    const r = active();
    if (!r || done.has(r)) continue;
    const kind = kindOf(r);
    if (!kind || ctx.skipAuto(kind)) continue;
    await go('auto', r);
  }
}
