// GeeTest v3 and v4 slide puzzles, ported from Browsa's server-side solver.
// The pictures are GeeTest's own files (their addresses from the page's resource timing for v3, from the widget's
// style for v4), fetched by the background from GeeTest's static host only. The gap is found on the server
// (GeeTestSlide: image arithmetic, no model), and the slide is a hand's track (lib/human.ts planSlide).
import type { Ctx } from './main';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, idle, sleep, slide, visible } from '../lib/input';
import { providerScripts } from '../lib/origin';

const BUDGET_S = 75;
const TRIES = 4;
const NUDGES = [3, -3, 6, -6];
const PIC = /\/pictures\/gt\/([0-9a-z]+)\/(?:(bg|slice)\/)?([0-9a-z]+)\.(webp|jpg|png)/i;

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const qv = (s: string) => { const e = q(s); return visible(e) ? e : null; };

async function fetchImage(ctx: Ctx, url: string): Promise<string | null> {
  const r = await ctx.bg<{ ok: boolean; data?: string }>('fetchImage', { url });
  return r && r.ok && r.data ? r.data : null;
}

// ---------------------------------------------------------------- v3

/** GeeTest's own "Network failure / Retry" state (its server did not answer the slide). */
export function netError(doc: Document = document): HTMLElement | null {
  const holder = doc.querySelector('.geetest_holder');
  const tip = doc.querySelector('.geetest_radar_tip_content, .geetest_panel_error_content, .geetest_box_error, .geetest_net_error');
  const bad = (holder && /geetest_radar_error|geetest_error/.test(holder.className))
    || (tip && /network|failure|网络|timed? ?out/i.test(tip.textContent || '') && visible(tip));
  if (!bad) return null;
  return (doc.querySelector<HTMLElement>('.geetest_reset_tip_content') && visible(doc.querySelector('.geetest_reset_tip_content')) ? doc.querySelector<HTMLElement>('.geetest_reset_tip_content')
    : null) || (visible(doc.querySelector('.geetest_panel_error_btn')) ? doc.querySelector<HTMLElement>('.geetest_panel_error_btn') : null)
    || (visible(doc.querySelector('.geetest_radar_tip')) ? doc.querySelector<HTMLElement>('.geetest_radar_tip') : null)
    || doc.body;
}

export function v3Passed(): boolean {
  const holder = q('.geetest_holder');
  if (holder?.classList.contains('geetest_radar_success')) return true;
  const tip = q('.geetest_radar_tip_content');
  return !!tip && /success|成功/i.test(tip.textContent || '');
}

/** The newest (picture with the gap, full picture) pair GeeTest v3 loaded in this page. */
function v3Pictures(): { bg: string; full: string } | null {
  const names = performance.getEntriesByType('resource').map((e) => e.name);
  for (let i = names.length - 1; i >= 0; i--) {
    const m = PIC.exec(names[i]);
    if (!m || (m[2] || '').toLowerCase() !== 'bg') continue;
    for (let j = names.length - 1; j >= 0; j--) {
      const f = PIC.exec(names[j]);
      if (f && !f[2] && f[1] === m[1]) return { bg: names[i], full: names[j] };
    }
  }
  return null;
}

async function solveV3(ctx: Ctx): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let rounds = 0;
  let clicks = 0;
  let lastBg = '';
  let netRetries = 0;
  const radar = qv('.geetest_radar_tip') || qv('.geetest_radar_btn');
  if (!radar) return { solved: false, reason: 'no_widget', rounds };
  await idle(0.4, 0.9);
  await click(radar);
  clicks++;
  while (elapsed() < BUDGET_S && rounds < TRIES) {
    await sleep(1.6);
    if (v3Passed()) return { solved: true, reason: rounds ? 'solved' : 'no_puzzle', rounds };
    const net = netError();
    if (net) {
      // GeeTest's server did not answer: press its own Retry once, then say so (do not sit out the budget)
      if (netRetries >= 1) return { solved: false, reason: 'geetest_network', rounds };
      netRetries++;
      await idle(0.6, 1.2);
      await click(net);
      clicks++;
      continue;
    }
    const bg = qv('.geetest_canvas_bg');
    const knob = qv('.geetest_slider_button');
    if (!bg || !knob) {
      if (qv('.geetest_item_img') || qv('.geetest_ques_tips')) return { solved: false, reason: 'click_puzzle', rounds };
      const again = qv('.geetest_panel_error_btn') || qv('.geetest_radar_tip');
      if (again && rounds && clicks < TRIES * 2 + 1) {
        await idle(0.6, 1.4);
        await click(again);
        clicks++;
      }
      continue;
    }
    let pics: { bg: string; full: string } | null = null;
    for (let i = 0; i < 10 && !(pics = v3Pictures()); i++) await sleep(1.0);
    if (!pics) return { solved: false, reason: 'no_pictures', rounds };
    rounds++;
    const nudge = pics.bg === lastBg ? NUDGES[Math.min(3, rounds - 2)] || 0 : 0;   // same picture after a miss
    lastBg = pics.bg;
    const [b64bg, b64full] = await Promise.all([fetchImage(ctx, pics.bg), fetchImage(ctx, pics.full)]);
    if (!b64bg || !b64full) return { solved: false, reason: 'picture_fetch', rounds };
    const bgBox = boxOf(bg);
    const r = await solveTask('geetest', { type: 'GeeTestSlide', version: 3, imageBackground: b64bg, imageFull: b64full,
      cssWidth: Math.round(bgBox[2] * 100) / 100 });
    report('geetest', 'round', { n: rounds, error: r.errorCode || '' });
    if (r.errorId) {
      if (r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') return { solved: false, reason: (r.errorCode || 'api').toLowerCase(), rounds };
      const refresh = qv('.geetest_refresh_1');
      if (refresh) { await idle(0.5, 1.0); await click(refresh); }
      continue;
    }
    const dist = Math.max(5, Number(r.solution.distance) + nudge);
    await idle(0.3, 0.7);
    await slide(knob, dist);
    clicks++;
    for (let i = 0; i < 10; i++) {                    // GeeTest's verdict shows for about a second
      await sleep(0.3);
      if (v3Passed()) break;
      const tip = q('.geetest_result_tip');
      if (tip && /fail|forbidden|lock/.test(tip.className)) break;
    }
    if (v3Passed()) return { solved: true, reason: 'solved', rounds };
    await sleep(1.0);
  }
  return { solved: v3Passed(), reason: v3Passed() ? 'solved' : (rounds ? 'timeout' : 'no_puzzle'), rounds };
}

// ---------------------------------------------------------------- v4

export function v4Passed(): boolean {
  for (const el of Array.from(document.querySelectorAll('[class*="geetest_"]'))) {
    const cs = Array.from(el.classList);
    if (cs.includes('geetest_lock_success')) return true;
    if (cs.includes('geetest_success') && cs.some((c) => /^geetest_(box|captcha|btn_click)/.test(c))) return true;
  }
  const btn = q('.geetest_btn_click');
  return !!btn && /success/i.test(btn.textContent || '');
}

const urlOf = (el: Element) => {
  const s = (el as HTMLElement).style.backgroundImage || getComputedStyle(el).backgroundImage || '';
  const m = /url\("?([^")]+)"?\)/.exec(s);
  return m ? m[1] : '';
};

async function solveV4(ctx: Ctx): Promise<{ solved: boolean; reason: string; rounds: number }> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let rounds = 0;
  let lastKey = '';
  let lastSlide = 0;
  const btn = qv('.geetest_btn_click');
  if (!btn) return { solved: false, reason: 'no_widget', rounds };
  await idle(0.4, 0.9);
  await click(btn);
  let netRetries = 0;
  while (elapsed() < BUDGET_S && rounds < TRIES) {
    await sleep(1.5);
    if (v4Passed()) return { solved: true, reason: rounds ? 'solved' : 'no_puzzle', rounds };
    const net = netError();
    if (net) {
      if (netRetries >= 1) return { solved: false, reason: 'geetest_network', rounds };
      netRetries++;
      await idle(0.6, 1.2);
      await click(net);
      continue;
    }
    const bg = qv('.geetest_bg');
    const sl = q('.geetest_slice_bg');
    const slBox = qv('.geetest_slice');
    const knob = qv('.geetest_btn');
    if (!bg || !sl || !slBox || !knob) {
      const other = Array.from(document.querySelectorAll('.geetest_subitem')).find((n) => visible(n) && !n.classList.contains('geetest_slide'));
      if (other) return { solved: false, reason: 'other_puzzle', rounds };
      continue;
    }
    const key = urlOf(bg);
    const sliceUrl = urlOf(sl);
    if (!key || !sliceUrl) continue;
    let nudge = 0;
    if (key === lastKey && rounds) {
      if (performance.now() - lastSlide < 3000) { await sleep(0.8); continue; }
      nudge = NUDGES[Math.min(3, rounds - 1)];
    }
    const [b64bg, b64sl] = await Promise.all([fetchImage(ctx, key), fetchImage(ctx, sliceUrl)]);
    if (!b64bg || !b64sl) return { solved: false, reason: 'picture_fetch', rounds };
    rounds++;
    lastKey = key;
    const bgBox = boxOf(bg);
    const sBox = boxOf(slBox);
    const top = parseFloat((slBox as HTMLElement).style.top || '') || (sBox[1] - bgBox[1]);
    const r = await solveTask('geetest', { type: 'GeeTestSlide', version: 4, imageBackground: b64bg, imageSlice: b64sl,
      top, bgCssWidth: bgBox[2], sliceCssWidth: sBox[2] });
    report('geetest', 'round', { n: rounds, error: r.errorCode || '' });
    if (r.errorId) {
      if (r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') return { solved: false, reason: (r.errorCode || 'api').toLowerCase(), rounds };
      continue;
    }
    await idle(0.3, 0.7);
    await slide(knob, Math.max(5, Number(r.solution.distance) + nudge));
    lastSlide = performance.now();
    for (let i = 0; i < 6 && !v4Passed(); i++) await sleep(0.3);
    if (v4Passed()) return { solved: true, reason: 'solved', rounds };
    await sleep(0.4);
  }
  return { solved: v4Passed(), reason: v4Passed() ? 'solved' : (rounds ? 'timeout' : 'no_puzzle'), rounds };
}

// ---------------------------------------------------------------- watcher

const widget = () => qv('.geetest_btn_click') || qv('.geetest_radar_tip') || qv('.geetest_radar_btn') || qv('.geetest_holder');

export async function runGeetest(ctx: Ctx) {
  let busy = false;
  let doneFor = '';                         // one automatic attempt per widget; the Solve button retries
  const go = async (why: 'auto' | 'button') => {
    if (busy) return;
    const v4 = !!qv('.geetest_btn_click');
    const v3 = !v4 && !!(qv('.geetest_radar_tip') || qv('.geetest_radar_btn'));
    if (!v3 && !v4) return;
    if (v3 ? v3Passed() : v4Passed()) return;
    busy = true;
    const t0 = performance.now();
    const w = widget();
    const anchor = w ? boxOf(w) : null;
    try {
      // GeeTest's own script (from GeeTest's hosts), not a look-alike drawn by the page
      const may = await ctx.start('geetest', why, { verified: providerScripts('geetest'), anchor });
      if (!may.ok) return;
      const r = v4 ? await solveV4(ctx) : await solveV3(ctx);
      ctx.end('geetest', r.solved ? 'solved' : 'failed', { reason: r.reason, rounds: r.rounds,
        seconds: (performance.now() - t0) / 1000, anchor });
    } finally {
      busy = false;
      doneFor = location.href;
    }
  };
  ctx.onManual('geetest', () => !!(qv('.geetest_btn_click') || qv('.geetest_radar_tip') || qv('.geetest_radar_btn')), () => go('button'));
  for (;;) {
    await sleep(0.8);
    if (busy || doneFor === location.href || !ctx.cfg.auto || ctx.skipAuto('geetest')) continue;
    if (qv('.geetest_btn_click') || qv('.geetest_radar_tip') || qv('.geetest_radar_btn')) await go('auto');
  }
}
