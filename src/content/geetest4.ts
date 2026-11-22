// GeeTest v4 puzzles other than the slide (0.3.0), ported from Browsa's in-session solver.
// Each kind is its own type with its own switch; the reading and the arithmetic
// are the API's (the same functions the cloud browsers use), the clicks are a hand's (lib/input.ts):
//   gt4match   IconCrush: what is on each tile (its icon's picture address) -> GeeTestGridTask -> click two tiles
//   gt4gobang  gobang: each cell's ball -> GeeTestGridTask -> click the ball, then the empty cell
//   gt4icon    icons in order: GeeTest's picture and reference icons (its files) -> GeeTestIconTask -> clicks, Confirm
//   gt4nine    nine photos: GeeTest's 3 x 3 picture file and the reference icon -> GeeTestNineTask -> clicks, Confirm
//   gt4svg     matching shape: the panel's three animation frames, drawn from GeeTest's own SVG in the page (no
//              screenshot), and the reference -> GeeTestShapeTask -> the tile clicked while its frame shows, Confirm
import type { Ctx } from './main';
import type { Kind } from '../lib/config';
import { report, solveTask } from '../lib/msg';
import { boxOf, click, clickBox, hover, idle, rng, sleep, visible, type Box } from '../lib/input';

export type Gt4Kind = 'gt4match' | 'gt4gobang' | 'gt4icon' | 'gt4nine' | 'gt4svg';
export const GT4_KINDS: Gt4Kind[] = ['gt4match', 'gt4gobang', 'gt4icon', 'gt4nine', 'gt4svg'];

const BUDGET_S = 80;
const TRIES = 4;
const VERDICT_S = 8;      // GeeTest answers a click puzzle within a second or two: a pass or a new challenge
const FOLD_WAIT_S = 8;    // a folded panel: how long to wait for the success state before opening it again
const URL_RE = /url\("?([^")]+)"?\)/;

const has = (el: Element | null | undefined, c: string) => !!el && el.classList.contains(c);
const urlOf = (el: Element | null) => {
  if (!el) return '';
  const st = (el as HTMLElement).style?.backgroundImage || (el.ownerDocument.defaultView || window).getComputedStyle(el).backgroundImage || '';
  const m = URL_RE.exec(st);
  return m ? m[1] : '';
};

/** The puzzle GeeTest's v4 panel holds (it is in the page, hidden, before the button is clicked): 'geetest' for the
 * slide (and the one-click check), a gt4 kind, 'other' for a kind not solved here (word and phrase, Chinese only),
 * '' when there is no panel. */
export function panelKind(doc: Document = document): Kind | 'other' | '' {
  const sub = doc.querySelector('.geetest_subitem');
  if (!sub) return '';
  if (has(sub, 'geetest_slide') || has(sub, 'geetest_ai')) return 'geetest';
  if (has(sub, 'geetest_match')) return 'gt4match';
  if (has(sub, 'geetest_winlinze')) return 'gt4gobang';
  if (has(sub, 'geetest_nine')) return 'gt4nine';
  if (has(sub, 'geetest_svg')) return 'gt4svg';
  if (has(sub, 'geetest_click')) return /\/(word|phrase)\//.test(urlOf(sub.querySelector('.geetest_bg'))) ? 'other' : 'gt4icon';
  return 'other';
}

/** Changes when GeeTest puts up a new challenge (geetest_kinds.challenge_key). */
export function challengeKey(doc: Document = document): string {
  const box = doc.querySelector('.geetest_subitem');
  if (!box) return '';
  const parts: string[] = [];
  for (const n of Array.from(box.querySelectorAll('*'))) {
    const u = (n as HTMLElement).style?.backgroundImage ? urlOf(n) : '';
    if (u) parts.push(u.slice(-40));
    else if (n.tagName === 'IMG') parts.push(((n as HTMLImageElement).getAttribute('src') || '').slice(-40));
    parts.push(...Array.from(n.classList).filter((c) => /^geetest_item_\d+$/.test(c)));
  }
  const ref = doc.querySelector('.geetest_ques_tips img');
  if (ref) parts.push((ref.getAttribute('src') || '').slice(-40));
  return parts.join('|');
}

export function passed(): boolean {
  for (const el of Array.from(document.querySelectorAll('[class*="geetest_"]'))) {
    const cs = Array.from(el.classList);
    if (cs.includes('geetest_lock_success')) return true;
    if (cs.includes('geetest_success') && cs.some((c) => /^geetest_(box|captcha|btn_click)/.test(c))) return true;
  }
  const btn = document.querySelector('.geetest_btn_click');
  return !!btn && /success/i.test(btn.textContent || '');
}

// ---------------------------------------------------------------- reading

async function file(ctx: Ctx, kind: Kind, url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url.split(',')[1] || null;
  const r = await ctx.bg<{ ok: boolean; data?: string }>('fetchImage', { url, kind });
  return r && r.ok && r.data ? r.data : null;
}

function dims(b64: string): Promise<[number, number] | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res([im.naturalWidth, im.naturalHeight]);
    im.onerror = () => res(null);
    im.src = 'data:image/*;base64,' + b64;
    setTimeout(() => res(null), 5000);
  });
}

/** Rank values into 0..n-1 (rows by top, columns by left). */
// rows and columns by position, a few pixels of tolerance: a panel that is still scaling in (or a window of another
// size) puts cells of one row at fractions of a pixel apart, which whole-pixel rounding split into two rows (seen in
// a windowed Chrome, 22 Nov: gobang "cells not read")
const rank = (vals: number[]) => {
  const s = [...vals].sort((a, b) => a - b);
  const starts: number[] = [];
  for (const v of s) if (!starts.length || v - starts[starts.length - 1] > 6) starts.push(v);
  return (v: number) => { let i = -1; for (const [k, st] of starts.entries()) if (v >= st - 0.5) i = k; return i; };
};

function grid<T extends Element>(cells: T[], side: number): T[][] | null {
  if (cells.length !== side * side) return null;
  const bx = cells.map((c) => boxOf(c));
  const ry = rank(bx.map((b) => b[1])), cx = rank(bx.map((b) => b[0]));
  const g: T[][] = Array.from({ length: side }, () => new Array(side));
  for (const [i, c] of cells.entries()) {
    const r = ry(bx[i][1]), col = cx(bx[i][0]);
    if (r < 0 || r >= side || col < 0 || col >= side || g[r][col]) return null;
    g[r][col] = c;
  }
  return g;
}

const shrink = (b: Box, f: number): Box => [b[0] + b[2] * (1 - f) / 2, b[1] + b[3] * (1 - f) / 2, b[2] * f, b[3] * f];

async function submit(): Promise<boolean> {
  const s = document.querySelector('.geetest_submit');
  if (!visible(s)) return false;
  await idle(0.3, 0.7);
  await click(s);
  return true;
}

interface Round { acted: boolean; note: string; error?: string }

// ---------------------------------------------------------------- one round of each kind

async function roundGrid(kind: 'gt4match' | 'gt4gobang'): Promise<Round> {
  const sub = document.querySelector('.geetest_subitem');
  if (!sub) return { acted: false, note: 'no panel' };
  let cells: Element[][] | null;
  let names: string[][];
  if (kind === 'gt4match') {
    // IconCrush: nine tiles, each with one icon drawn on it; an icon belongs to the tile its middle sits in (after a
    // swap the icon elements' order no longer follows the tiles)
    cells = grid(Array.from(sub.querySelectorAll('.geetest_backimg')), 3);
    if (!cells) return { acted: false, note: 'tiles not read' };
    const icons = Array.from(sub.querySelectorAll('[class*="geetest_img-"]')).filter((n) => Array.from(n.classList).some((c) => /^geetest_img-\d+$/.test(c)));
    names = cells.map((row) => row.map(() => ''));
    for (const ic of icons) {
      const b = boxOf(ic);
      const mx = b[0] + b[2] / 2, my = b[1] + b[3] / 2;
      let hit = 0;
      for (const [r, row] of cells.entries()) for (const [c, t] of row.entries()) {
        const tb = boxOf(t);
        if (mx >= tb[0] && mx <= tb[0] + tb[2] && my >= tb[1] && my <= tb[1] + tb[3]) {
          names[r][c] = urlOf(ic) || Array.from(ic.classList).find((x) => /^geetest_item_\d+$/.test(x)) || '?';
          hit++;
        }
      }
      if (hit !== 1) return { acted: false, note: 'icon outside the tiles' };
    }
    if (names.some((row) => row.some((x) => !x))) return { acted: false, note: 'a tile without an icon' };
  } else {
    cells = grid(Array.from(sub.querySelectorAll('.geetest_itemimg')), 5);
    if (!cells) return { acted: false, note: 'cells not read' };
    names = cells.map((row) => row.map((c) => (has(c, 'geetest_isEmpty') ? '' : (urlOf(c).split('/').pop() || '?'))));
  }
  const r = await solveTask(kind, { type: 'GeeTestGridTask', kind: kind === 'gt4match' ? 'match' : 'winlinze', grid: names });
  if (r.errorId) return { acted: false, note: 'api', error: r.errorCode || 'api' };
  const [a, b] = [r.solution.from as number[], r.solution.to as number[]];
  const f = kind === 'gt4match' ? 0.5 : 0.6;
  await clickBox(shrink(boxOf(cells[a[0]][a[1]]), f));
  await idle(0.35, 0.8);
  await clickBox(shrink(boxOf(cells[b[0]][b[1]]), f));
  return { acted: true, note: `${a} -> ${b}` };
}

async function roundIcon(ctx: Ctx): Promise<Round> {
  const sub = document.querySelector('.geetest_subitem');
  const bgEl = sub && sub.querySelector('.geetest_bg');
  const refs = Array.from(document.querySelectorAll<HTMLImageElement>('.geetest_ques_tips img')).map((i) => i.getAttribute('src') || '');
  if (!bgEl || !visible(bgEl) || !refs.length) return { acted: false, note: 'picture or references not read' };
  const [bg, ...rs] = await Promise.all([file(ctx, 'gt4icon', urlOf(bgEl)), ...refs.map((u) => file(ctx, 'gt4icon', u))]);
  if (!bg || rs.some((x) => !x)) return { acted: false, note: 'picture_fetch' };
  const size = await dims(bg);
  if (!size) return { acted: false, note: 'picture not decoded' };
  // GeeTest files each reference under its category ('.../icon/20260825/boats_watercraft/<hash>.png')
  const hints = refs.map((u) => { const p = u.split('/'); return /\/icon\//.test(u) && p.length > 2 ? p[p.length - 2].replace(/_/g, ' ') : ''; });
  const r = await solveTask('gt4icon', { type: 'GeeTestIconTask', image: bg, references: rs, hints });
  if (r.errorId) return { acted: false, note: 'api', error: r.errorCode || 'api' };
  const bb = boxOf(bgEl);
  const kx = bb[2] / size[0], ky = bb[3] / size[1];
  await idle(0.4, 0.9);
  for (const [x, y] of r.solution.points as number[][]) {
    const px = bb[0] + x * kx + (rng() - 0.5) * 3, py = bb[1] + y * ky + (rng() - 0.5) * 3;
    await clickBox([px - 2, py - 2, 4, 4]);
    await idle(0.35, 0.8);
  }
  await submit();
  return { acted: true, note: `${refs.length} icons` };
}

async function roundNine(ctx: Ctx): Promise<Round> {
  const sub = document.querySelector('.geetest_subitem.geetest_nine');
  const tiles = sub ? Array.from(sub.querySelectorAll('.geetest_item')).filter((t) => visible(t)) : [];
  const ref = document.querySelector<HTMLImageElement>('.geetest_ques_tips img');
  const picEl = sub && sub.querySelector('.geetest_item_img');
  if (tiles.length !== 9 || !ref || !picEl) return { acted: false, note: `grid not read (${tiles.length} tiles)` };
  const [pic, refB] = await Promise.all([file(ctx, 'gt4nine', urlOf(picEl)), file(ctx, 'gt4nine', ref.getAttribute('src') || '')]);
  if (!pic || !refB) return { acted: false, note: 'picture_fetch' };
  const size = await dims(pic);
  if (!size) return { acted: false, note: 'picture not decoded' };
  // the file is the 3 x 3 photos as the panel lays them out (with the gaps): the tiles' boxes, in its pixels
  const bx = tiles.map((t) => boxOf(t));
  const x0 = Math.min(...bx.map((b) => b[0])), y0 = Math.min(...bx.map((b) => b[1]));
  const w = Math.max(...bx.map((b) => b[0] + b[2])) - x0;
  const k = size[0] / w;
  const order = bx.map((b, i) => i).sort((i, j) => (Math.round(bx[i][1]) - Math.round(bx[j][1])) || (bx[i][0] - bx[j][0]));
  const tileBoxes = order.map((i) => [(bx[i][0] - x0) * k, (bx[i][1] - y0) * k, bx[i][2] * k, bx[i][3] * k].map((v) => Math.round(v * 10) / 10));
  const m = /\b(\d)\b/.exec(document.querySelector('.geetest_text_tips')?.textContent || '');
  const count = m ? Number(m[1]) : 3;
  const r = await solveTask('gt4nine', { type: 'GeeTestNineTask', image: pic, reference: refB, count, tileBoxes });
  if (r.errorId) return { acted: false, note: 'api', error: r.errorCode || 'api' };
  await idle(0.4, 0.9);
  for (const o of r.solution.objects as number[]) {
    await clickBox(shrink(boxOf(tiles[order[o]]), 0.6));
    await idle(0.3, 0.7);
  }
  await submit();
  return { acted: true, note: `${count} of 9` };
}

/** The frames of GeeTest's shape panel: its SVG holds one group per animation frame (only one shown at a time);
 * each is drawn on a canvas from a copy of the SVG holding that group alone. */
function frameGroups(svg: SVGSVGElement): SVGGElement[] {
  return Array.from(svg.children).filter((g) => g.tagName.toLowerCase() === 'g' && Array.from(g.classList).some((c) => /^geetest_frame_\d/.test(c))) as SVGGElement[];
}

async function drawFrame(svg: SVGSVGElement, keep: number, scale: number): Promise<string | null> {
  const vb = (svg.getAttribute('viewBox') || '0 0 300 260').split(/\s+/).map(Number);
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.querySelectorAll('style').forEach((s) => s.remove());
  frameGroups(copy).forEach((g, i) => { if (i !== keep) g.remove(); else g.removeAttribute('class'); });
  copy.setAttribute('width', String(vb[2] * scale));
  copy.setAttribute('height', String(vb[3] * scale));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(copy);
  const im = new Image();
  const ok = await new Promise<boolean>((res) => {
    im.onload = () => res(true);
    im.onerror = () => res(false);
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    setTimeout(() => res(false), 4000);
  });
  if (!ok) return null;
  const c = document.createElement('canvas');
  c.width = vb[2] * scale;
  c.height = vb[3] * scale;
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0, c.width, c.height);
  try { return c.toDataURL('image/png').split(',')[1] || null; } catch { return null; }
}

async function roundSvg(ctx: Ctx): Promise<Round> {
  const sub = document.querySelector('.geetest_subitem.geetest_svg');
  const svg = sub && sub.querySelector<SVGSVGElement>('svg');
  const ref = document.querySelector<HTMLImageElement>('.geetest_ques_tips img');
  if (!svg || !ref) return { acted: false, note: 'panel not read' };
  const groups = frameGroups(svg);
  if (groups.length < 1 || groups.length > 4) return { acted: false, note: `${groups.length} frames` };
  const scale = 2;
  const rects = groups.map((g) => Array.from(g.querySelectorAll('rect')).filter((r) => Array.from(r.classList).some((c) => c.startsWith('geetest_grid'))));
  if (rects.some((rs) => rs.length !== 9)) return { acted: false, note: 'tiles not read' };
  const tileBoxes = rects[0].map((r) => ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a) || 0) * scale));
  const frames: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const f = await drawFrame(svg, i, scale);
    if (!f) return { acted: false, note: 'frame not drawn' };
    frames.push(f);
  }
  const refB = await file(ctx, 'gt4svg', ref.getAttribute('src') || '');
  if (!refB) return { acted: false, note: 'reference not read' };
  const r = await solveTask('gt4svg', { type: 'GeeTestShapeTask', reference: refB, frames, tileBoxes });
  if (r.errorId) return { acted: false, note: 'api', error: r.errorCode || 'api' };
  const fi = Number(r.solution.frame), ti = Number(r.solution.tile);
  const target = rects[fi] && rects[fi][ti];
  const group = groups[fi];
  if (!target || !group) return { acted: false, note: 'answer outside the panel' };
  // the pointer waits close by; the tile is clicked just after its frame comes round (each shows about 2.6 s)
  const tb = boxOf(target);
  await hover(tb[0] + tb[2] * (0.3 + rng() * 0.4) + 50, tb[1] - 18);
  const shown = () => Number(getComputedStyle(group).opacity) > 0.5;
  const t0 = performance.now();
  let prev = shown();
  let clicked = false;
  while (performance.now() - t0 < 9000) {
    const now = shown();
    if (now && (!prev || performance.now() - t0 > 7000)) {
      await clickBox(shrink(boxOf(target), 0.5));
      clicked = true;
      break;
    }
    prev = now;
    await sleep(0.06);
  }
  if (!clicked) return { acted: false, note: 'frame never came back' };
  await submit();
  return { acted: true, note: `frame ${fi + 1} tile ${ti + 1} (${r.solution.how})` };
}

// ---------------------------------------------------------------- the solve

export interface Gt4Result { solved: boolean; reason: string; rounds: number; handoff?: Kind }

/** Solve the open (or, with open=false, still closed) v4 panel of this kind. A panel that turns into another kind
 * hands the solve over (handoff). */
export async function solveGt4(ctx: Ctx, kind: Gt4Kind, open: boolean): Promise<Gt4Result> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  let rounds = 0, unread = 0, reopened = 0;
  if (!open) {
    const btn = document.querySelector('.geetest_btn_click');
    if (!visible(btn)) return { solved: false, reason: 'no_widget', rounds };
    await idle(0.4, 0.9);
    await click(btn);
    await sleep(1.5);
  }
  while (elapsed() < BUDGET_S && rounds < TRIES) {
    if (passed()) return { solved: true, reason: rounds ? 'solved' : 'no_puzzle', rounds };
    const pk = panelKind();
    if (pk && pk !== kind) {
      if (pk === 'other') return { solved: false, reason: 'other_puzzle', rounds };
      return { solved: false, reason: 'handoff', rounds, handoff: pk as Kind };
    }
    const sub = document.querySelector('.geetest_subitem');
    if (!sub || !visible(sub)) {
      // the panel folds away while GeeTest checks an answer (the pass can take seconds to show), or closes after a
      // miss: wait for the pass, then open it again
      let ok = false;
      for (let i = 0; i < FOLD_WAIT_S / 0.5 && !ok; i++) { await sleep(0.5); ok = passed(); if (sub && visible(sub)) break; }
      if (ok) continue;
      if (sub && visible(sub)) continue;
      const btn = document.querySelector('.geetest_btn_click');
      if (visible(btn) && reopened < 3) { reopened++; await idle(0.6, 1.4); await click(btn); await sleep(1.5); continue; }
      await sleep(0.8);
      continue;
    }
    const key = challengeKey();
    // a person looks at a new panel before the first click (clicking at once was often ignored)
    await idle(0.8, 1.5);
    rounds++;
    const rd = kind === 'gt4match' || kind === 'gt4gobang' ? await roundGrid(kind)
      : kind === 'gt4icon' ? await roundIcon(ctx) : kind === 'gt4nine' ? await roundNine(ctx) : await roundSvg(ctx);
    report(kind, 'round', { n: rounds, error: rd.error || '' });
    if (rd.error) {
      if (rd.error !== 'ERROR_CAPTCHA_UNSOLVABLE') return { solved: false, reason: rd.error.toLowerCase(), rounds };
      const refresh = document.querySelector('.geetest_refresh');     // a new challenge, as a person would ask
      if (visible(refresh)) { await idle(0.5, 1.0); await click(refresh); await sleep(1.5); }
      continue;
    }
    if (!rd.acted) {
      rounds--;
      if (++unread >= 3) return { solved: false, reason: rd.note === 'picture_fetch' ? 'picture_fetch' : 'not_read', rounds };
      await sleep(1.0);
      continue;
    }
    // GeeTest's verdict: a pass, or a new challenge in the panel
    const t1 = performance.now();
    while ((performance.now() - t1) / 1000 < VERDICT_S) {
      await sleep(0.5);
      if (passed() || challengeKey() !== key) break;
    }
  }
  return { solved: passed(), reason: passed() ? 'solved' : (rounds ? 'timeout' : 'no_puzzle'), rounds };
}

/** The panel's on-screen box, for the in-page Solve button. */
export const panelBox = (): Box | null => {
  const s = document.querySelector('.geetest_btn_click') || document.querySelector('.geetest_box');
  return visible(s) ? boxOf(s) : null;
};
