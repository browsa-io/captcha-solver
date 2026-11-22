// Tencent captcha (TCaptcha / TencentCloud "TJNCaptcha" 2.0), ported from Browsa's in-session solver.
// The 2.0 script draws its panel in the page (#tcaptcha_transform_dy, classes
// tencent-captcha-dy__*); the older one draws the same panel in a frame from turing.captcha.qcloud.com, where this
// script also runs. Two puzzles, each its own switch:
//   tcslide  the background (img_index=1) and the piece, a crop of a sprite (img_index=0) shown by
//            background-position: SliderGapTask finds the gap (no model); the knob is dragged by the gap's
//            distance less the piece's own left. Tencent keeps the picture after a miss: the next candidate.
//   tcclick  a reference strip (characters, digits or icons) and a picture: ClickOrderTask says where each item is,
//            in order; they are clicked and the confirm button pressed.
// The pictures are Tencent's own files, fetched by the background from Tencent's captcha hosts only. Tencent's
// server answers each try (cap_union_new_verify): the panel shows its success state and closes, or a new picture.
import type { Ctx } from './main';
import type { Kind } from '../lib/config';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, clickBox, idle, sleep, slide, visible } from '../lib/input';
import { providerScripts, SCRIPT_HOSTS } from '../lib/origin';
import { imageSize } from '../lib/imgsize';

const PFX = 'tencent-captcha-dy__';
const BUDGET_S = 75;
const TRIES = 4;

const q = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s);
const c = (name: string) => '.' + PFX + name;

const urlOf = (el: Element | null) => {
  if (!el) return '';
  const s = (el as HTMLElement).style.backgroundImage || getComputedStyle(el).backgroundImage || '';
  const m = /url\("?([^")]+)"?\)/.exec(s);
  return m ? m[1] : '';
};
const px = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

const container = () => document.getElementById('tcaptcha_transform_dy');
const wrap = () => document.getElementById('tCaptchaDyMainWrap');

/** The puzzle on screen: 'tcslide' | 'tcclick' | '' (none, or another kind). */
export function panelKind(doc: Document = document): Kind | '' {
  const w = doc.getElementById('tCaptchaDyMainWrap');
  if (!w) return '';
  if (w.classList.contains(PFX + 'slider-type-wrap')) return 'tcslide';
  if (w.classList.contains(PFX + 'click-type-wrap')) return 'tcclick';
  return '';
}

export function passed(doc: Document = document): boolean {
  const ok = doc.querySelector<HTMLElement>(c('verify-status-img--success'));
  return !!ok && ok.style.display !== 'none' && visible(ok);
}

/** The panel is open (shown, not yet passed) with a puzzle this script solves. */
export function panelOpen(doc: Document = document): boolean {
  const ct = doc.getElementById('tcaptcha_transform_dy');
  const w = doc.getElementById('tCaptchaDyMainWrap');
  if (ct) { if (!visible(ct) || ct.style.display === 'none') return false; } else if (!w || !visible(w)) return false;
  return !!w && visible(w) && !passed(doc) && panelKind(doc) !== '';
}

/** What tells this challenge from the next: the picture's id in its address. */
export function challengeKey(): string {
  const u = urlOf(q(c('verify-bg-img')));
  const i = u.indexOf('image=');
  return i >= 0 ? u.slice(i + 6, i + 46) : u.slice(-40);
}

/** Tencent's own script in this document (its hosts), or this document is Tencent's own frame. */
const fromTencent = () => providerScripts('tcslide') || (SCRIPT_HOSTS.tcslide || /$^/).test(location.hostname);

async function fetchImage(ctx: Ctx, kind: Kind, url: string): Promise<string | null> {
  const r = await ctx.bg<{ ok: boolean; data?: string }>('fetchImage', { url, kind });
  return r && r.ok && r.data ? r.data : null;
}

type Out = { solved: boolean; reason: string; rounds: number };
type Acted = 'acted' | 'unread' | string;      // anything else: an API error that ends the solve

async function slideRound(ctx: Ctx, tried: number): Promise<Acted> {
  const bg = q(c('verify-bg-img'));
  const fg = Array.from(document.querySelectorAll<HTMLElement>(c('fg-item'))).filter((n) => /img_index=0/.test(urlOf(n)));
  const knob = q(c('slider-block'));
  if (!bg || !fg.length || !knob || !visible(knob)) return 'unread';
  const piece = fg.reduce((a, b) => (px(a.style.left) <= px(b.style.left) ? a : b));
  const st = piece.style;
  const [pw, ph, left, top] = [px(st.width), px(st.height), px(st.left), px(st.top)];
  const pos = (st.backgroundPosition || '').split(/\s+/).map(px);
  const size = (st.backgroundSize || '').split(/\s+/).map(px);
  if (![pw, ph, left, top, pos[0], pos[1], size[0], size[1]].every(Number.isFinite)) return 'unread';
  const [b64bg, b64sprite] = await Promise.all([fetchImage(ctx, 'tcslide', urlOf(bg)), fetchImage(ctx, 'tcslide', urlOf(piece))]);
  if (!b64bg || !b64sprite) return 'picture_fetch';
  const bgBox = boxOf(bg);
  const r = await solveTask('tcslide', { type: 'SliderGapTask', imageBackground: b64bg, imageSlice: b64sprite,
    sliceSprite: { position: [pos[0], pos[1]], size: [size[0], size[1]] }, sliceCssWidth: pw, sliceCssHeight: ph,
    top, bgCssWidth: bgBox[2], candidates: 3 });
  if (r.errorId) return r.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE' ? 'unread' : (r.errorCode || 'api').toLowerCase();
  const cands: Array<{ distance: number }> = r.solution.candidates || [{ distance: r.solution.distance }];
  const g = cands[Math.min(tried, cands.length - 1)];
  await idle(0.3, 0.7);
  await slide(knob, Math.max(3, Number(g.distance) - left));
  return 'acted';
}

async function clickRound(ctx: Ctx, tried: number): Promise<Acted> {
  const bg = q(c('verify-bg-img'));
  const ref = q<HTMLImageElement>(c('header-answer') + ' img');
  const confirm = q(c('verify-confirm-btn'));
  if (!bg || !ref || !ref.src || !confirm) return 'unread';
  const [pic, strip] = await Promise.all([fetchImage(ctx, 'tcclick', urlOf(bg)), fetchImage(ctx, 'tcclick', ref.src)]);
  if (!pic || !strip) return 'picture_fetch';
  const size = imageSize(pic);
  if (!size) return 'unread';
  // the same challenge again after a refused answer: the stronger model answers first
  const r = await solveTask('tcclick', { type: 'ClickOrderTask', image: pic, referenceStrip: strip, snap: 'dark',
    what: 'black icons, digits or characters', strongFirst: tried > 0 });
  if (r.errorId) return r.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE' ? 'unread' : (r.errorCode || 'api').toLowerCase();
  const pts: Array<[number, number]> = r.solution.points || [];
  await idle(0.6, 1.2);                               // a person looks at the picture first
  for (const [x, y] of pts) {
    const b = boxOf(bg);
    const kx = b[2] / size[0], ky = b[3] / size[1];
    const cx = b[0] + x * kx, cy = b[1] + y * ky;
    await clickBox([cx - 3, cy - 3, 6, 6]);
    await idle(0.35, 0.8);
  }
  await idle(0.3, 0.7);
  if (visible(confirm)) await click(confirm);
  return 'acted';
}

async function solve(ctx: Ctx, kind: Kind): Promise<Out> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let rounds = 0, unread = 0, lastKey = '', lastAct = 0;
  const seen = new Map<string, number>();
  while (elapsed() < BUDGET_S) {
    if (passed()) return { solved: true, reason: 'solved', rounds };
    if (!panelOpen()) {
      if (rounds) return { solved: true, reason: 'solved', rounds };      // the panel closed after an answer
      await sleep(1.0);
      if (elapsed() > 20) return { solved: false, reason: 'no_widget', rounds };
      continue;
    }
    const k = panelKind();
    if (k !== kind) return { solved: false, reason: rounds ? 'other_puzzle' : 'other_puzzle', rounds };
    const key = challengeKey();
    if (key && key === lastKey && performance.now() - lastAct < 5000) { await sleep(0.6); continue; }   // the verdict is still coming
    if (rounds >= TRIES) return { solved: false, reason: 'rejected', rounds };
    await idle(0.8, 1.5);
    if (!panelOpen()) continue;
    rounds++;
    const tried = seen.get(key) || 0;
    const acted = kind === 'tcslide' ? await slideRound(ctx, tried) : await clickRound(ctx, tried);
    report(kind, 'round', { n: rounds, error: acted === 'acted' || acted === 'unread' ? '' : acted });
    lastKey = key;
    lastAct = performance.now();
    if (acted === 'acted') { seen.set(key, tried + 1); await sleep(1.2); continue; }
    rounds--;
    if (acted !== 'unread') return { solved: false, reason: acted, rounds };
    if (++unread >= 3) return { solved: false, reason: 'not_read', rounds };
    await sleep(1.5);
  }
  return { solved: passed(), reason: passed() ? 'solved' : 'timeout', rounds };
}

export async function runTencent(ctx: Ctx) {
  let busy = false;
  let doneFor = '';
  const go = async (why: 'auto' | 'button') => {
    if (busy || !panelOpen()) return;
    const kind = panelKind();
    if (!kind) return;
    busy = true;
    const t0 = performance.now();
    const w = wrap();
    const anchor = w ? boxOf(w) : null;
    try {
      const may = await ctx.start(kind, why, { verified: fromTencent(), anchor });
      if (!may.ok) return;
      const r = await solve(ctx, kind);
      ctx.end(kind, r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds, seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
      doneFor = challengeKey();
    }
  };
  for (const k of ['tcslide', 'tcclick'] as Kind[]) {
    ctx.onManual(k, () => panelOpen() && panelKind() === k, () => go('button'), () => { const w = wrap(); return w ? boxOf(w) : null; });
  }
  for (;;) {
    await sleep(0.8);
    if (busy || !ctx.cfg.auto || !container() && !wrap()) continue;
    if (!panelOpen()) continue;
    const kind = panelKind();
    if (!kind || ctx.skipAuto(kind) || doneFor === challengeKey()) continue;
    await go('auto');
  }
}
