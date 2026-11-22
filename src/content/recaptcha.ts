// reCAPTCHA v2 (checkbox, invisible, Enterprise) in its own frames, ported from Browsa's server-side solver.
//   anchor frame  ticks the checkbox like a hand and reports its state (checked / expired) to the background
//   bframe        the picture puzzle: 3x3 (one 300 px picture), 4x4 (one 450 px picture) and reloading tiles
//                 (100 px pictures), each answered by ReCaptchaV2Classification; clicks, Verify, next round
// The pictures are read from the frame's own <img> elements (same origin, so a canvas can read them): no extra
// request to Google, nothing from the page around the widget.
import type { Ctx } from './main';
import { canvasData, report, solveTask } from '../lib/msg';
import { click, idle, pressEnter, sleep, typeInto, visible } from '../lib/input';

const ANCHOR = /\/recaptcha\/(api2|enterprise)\/anchor/;
const BFRAME = /\/recaptcha\/(api2|enterprise)\/bframe/;
export const isAnchor = (u: string) => ANCHOR.test(u);
export const isBframe = (u: string) => BFRAME.test(u);

const BUDGET_S = 150;          // the engine's budget and round cap
const MAX_ROUNDS = 16;
const DYN_MAX_CLICKS = 24;
const DYN_TILE_WAIT_S = 7;
const NO_GRID_S = 15;
// The audio fallback ('rcaudio', its own switch): after this many picture rounds without a pass, or a picture the
// service does not know, Google's audio challenge is asked for and its clip read by AudioTask (as the engine does,
// CAPTCHA_AUDIO_AFTER_ROUNDS). At most AUDIO_MAX_ROUNDS clips per solve.
const AUDIO_AFTER = 3;
const AUDIO_MAX_ROUNDS = 4;

// ---------------------------------------------------------------- anchor

export function anchorState(): string {
  const a = document.querySelector('#recaptcha-anchor');
  if (!a) return 'none';
  if (a.getAttribute('aria-checked') === 'true' || a.classList.contains('recaptcha-checkbox-checked')) return 'checked';
  if (a.classList.contains('recaptcha-checkbox-expired')) return 'expired';
  if (a.classList.contains('recaptcha-checkbox-loading')) return 'loading';
  return 'unchecked';
}

export async function runAnchor(ctx: Ctx) {
  let a: Element | null = null;
  for (let i = 0; i < 40 && !(a = document.querySelector('#recaptcha-anchor')); i++) await sleep(0.25);
  if (!a) return;
  const invisible = /[?&]size=invisible/.test(location.href);
  let sent = '';
  let clickedAt = 0;
  const send = () => {
    const s = invisible ? 'invisible' : anchorState();
    if (s !== sent) {
      sent = s;
      void ctx.bg('anchor', { kind: 'recaptcha', state: s });
      if (s === 'checked' && clickedAt) ctx.end('recaptcha', 'solved', { seconds: (performance.now() - clickedAt) / 1000 });
    }
  };
  new MutationObserver(send).observe(a, { attributes: true });
  send();
  setInterval(send, 1000);
  if (invisible) return;

  let seen = false;
  new IntersectionObserver((es) => { seen = es.some((e) => e.isIntersecting); }).observe(document.documentElement);
  let ticks = 0;
  const open = () => { const s = anchorState(); return s === 'unchecked' || s === 'expired'; };
  const tick = async (why: 'auto' | 'button') => {
    if (!open()) return;
    if (why === 'auto' && ticks >= 3) return;   // a checkbox that keeps expiring is left to the person
    // this frame is Google's own (the background checks the frame's address, which a page cannot fake)
    const may = await ctx.start('recaptcha', why, { verified: true });
    if (!may.ok) return;
    ticks++;
    if (!clickedAt) clickedAt = performance.now();
    await idle(0.6, 1.6);
    await click(document.querySelector('#recaptcha-anchor')!);
  };
  ctx.onManual('recaptcha', () => open() && visible(document.querySelector('#recaptcha-anchor')), () => tick('button'));
  for (;;) {
    await sleep(0.5);
    if (!ctx.cfg.auto || ctx.skipAuto('recaptcha')) continue;
    if (!seen || !visible(document.querySelector('#recaptcha-anchor'))) continue;
    const s = anchorState();
    if (s === 'unchecked' || s === 'expired') await tick('auto');
  }
}

// ---------------------------------------------------------------- bframe

interface Tile { td: HTMLElement; img: HTMLImageElement | null; selected: boolean; loading: boolean; src: string }
interface Puzzle {
  refused: string; target: string; desc: string; grid: number; dynamic: boolean; single: boolean;
  tiles: Tile[]; errors: string[]; payload: string; audio: boolean; audioSrc: string; audioError: string;
}

const text = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const shown = (el: Element) => (el as HTMLElement).style.display !== 'none' && visible(el);

export function parsePuzzle(doc: Document = document): Puzzle {
  const pz: Puzzle = { refused: '', target: '', desc: '', grid: 0, dynamic: false, single: false, tiles: [], errors: [],
    payload: '', audio: false, audioSrc: '', audioError: '' };
  const dos = doc.querySelector('.rc-doscaptcha-header-text, .rc-doscaptcha-body-text');
  if (dos && visible(dos)) {
    pz.refused = text(dos) || 'refused';
    return pz;
  }
  const desc = doc.querySelector('.rc-imageselect-desc-no-canonical, .rc-imageselect-desc, .rc-imageselect-instructions');
  if (desc) {
    pz.desc = text(desc);
    pz.target = text(desc.querySelector('strong')) || pz.desc;
  }
  pz.dynamic = /none left/i.test(pz.desc);
  const table = doc.querySelector('table[class*="rc-imageselect-table"]');
  if (table) pz.grid = /table-44/.test(table.className) ? 16 : /table-42/.test(table.className) ? 8 : 9;
  pz.single = pz.grid === 16;
  doc.querySelectorAll<HTMLElement>('td.rc-imageselect-tile').forEach((td) => {
    const img = td.querySelector('img');
    pz.tiles.push({ td, img, selected: td.classList.contains('rc-imageselect-tileselected'),
      loading: td.classList.contains('rc-imageselect-dynamic-selected'), src: img?.src || '' });
  });
  if (pz.tiles.length && !pz.grid) pz.grid = pz.tiles.length;
  // other languages than English: a replaced tile (100 px picture) or one fading out also says "reloading"
  if (doc.querySelector('img.rc-image-tile-11, td.rc-imageselect-dynamic-selected')) pz.dynamic = true;
  if (!pz.tiles.length && doc.querySelector('#audio-response, .rc-audiochallenge-play-button')) {
    pz.audio = true;
    pz.audioSrc = doc.querySelector<HTMLAudioElement>('#audio-source')?.src
      || doc.querySelector<HTMLAnchorElement>('.rc-audiochallenge-tdownload-link')?.href || '';
    const err = Array.from(doc.querySelectorAll('.rc-audiochallenge-error-message')).find((n) => shown(n));
    pz.audioError = err ? text(err) : '';
  }
  pz.payload = pz.tiles.length ? pz.tiles[0].src.slice(-48) : '';
  for (const [cls, name] of [['rc-imageselect-incorrect-response', 'try_again'], ['rc-imageselect-error-select-more', 'select_more'],
    ['rc-imageselect-error-dynamic-more', 'check_new'], ['rc-imageselect-error-select-something', 'select_something']]) {
    doc.querySelectorAll('.' + cls).forEach((n) => { if (shown(n)) pz.errors.push(name); });
  }
  return pz;
}

let rc: Ctx | null = null;

export async function runBframe(ctx: Ctx) {
  rc = ctx;
  let open = false;
  let closedAt = 0;
  new IntersectionObserver((es) => {
    const now = es.some((e) => e.isIntersecting && e.intersectionRect.height > 50);
    if (open && !now) closedAt = performance.now();
    open = now;
  }).observe(document.documentElement);
  let busy = false;
  let anchor = 'unknown';
  ctx.on('anchor', (m) => { if (m.kind === 'recaptcha') anchor = String(m.state); });
  const pull = async () => {
    const r = await ctx.bg<{ state?: string }>('anchorState', { kind: 'recaptcha' });
    if (r && r.state && r.state !== 'unknown') anchor = r.state;
  };
  void pull();
  setInterval(pull, 1500);

  const solve = async (why: 'auto' | 'button') => {
    if (busy) return;
    busy = true;
    const t0 = performance.now();
    try {
      const may = await ctx.start('recaptcha', why, { verified: true });
      if (!may.ok) return;
      const r = await solveRounds(() => ({ open, closedAt, anchor }), why);
      const seconds = (performance.now() - t0) / 1000;
      if (r.audioAt) {
        // the audio fallback's own line: solved when the widget passed after its clips
        ctx.end('rcaudio', r.reason === 'solved' ? 'solved' : 'failed', { reason: r.reason, rounds: r.audio,
          seconds: (performance.now() - r.audioAt) / 1000 });
      }
      if (r.reason !== 'solved') ctx.end('recaptcha', 'failed', { reason: r.reason, rounds: r.rounds, seconds });
      else if (anchor === 'invisible' || anchor === 'unknown') ctx.end('recaptcha', 'solved', { rounds: r.rounds, seconds });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('recaptcha', () => open && (parsePuzzle().tiles.length > 0 || parsePuzzle().audio), () => solve('button'));
  for (;;) {
    await sleep(0.5);
    if (busy || !open || !ctx.cfg.auto || ctx.skipAuto('recaptcha')) continue;
    const pz = parsePuzzle();
    if (pz.tiles.length || pz.audio) await solve('auto');
  }
}

interface State { open: boolean; closedAt: number; anchor: string }

/** The grid as Google's own picture size (300 px for 3x3, 450 px for 4x4): each cell drawn from what that tile
 * shows now (its part of the shared picture, or the 100 px replacement after a reload), as a screenshot would. */
async function picture(pz: Puzzle): Promise<string | null> {
  const side = pz.grid === 16 ? 4 : 3;
  const full = side === 4 ? 450 : 300;
  if (pz.tiles.length !== side * side) return pz.tiles[0]?.img ? canvasData(pz.tiles[0].img, 'image/jpeg', 0.92) : null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = full;
    const g = c.getContext('2d')!;
    const cell = full / side;
    pz.tiles.forEach((t, i) => {
      const img = t.img;
      if (!img || !img.naturalWidth) return;
      const r = Math.floor(i / side), col = i % side;
      if (img.naturalWidth >= full - 2) g.drawImage(img, col * cell, r * cell, cell, cell, col * cell, r * cell, cell, cell);
      else g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, col * cell, r * cell, cell, cell);
    });
    return c.toDataURL('image/jpeg', 0.92).split(',')[1] || null;
  } catch {
    return null;
  }
}

// The API's last refusal in this frame (lower case), so the solve ends with the real reason (out of credits, the
// key's limit, free solves used up) instead of a general failure, and stops asking at once when asking again cannot help.
let apiError = '';
const PASSING = new Set(['error_service_unavaliable', 'network_error', 'error_rate_limit', 'error_task_timeout', 'extension_error', 'offline']);

async function classify(pz: Puzzle, escalate: boolean): Promise<number[] | null> {
  const image = await picture(pz);
  if (!image) return null;
  const r = await solveTask('recaptcha', { type: 'ReCaptchaV2Classification', image, question: pz.target, escalate });
  apiError = r.errorId && r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE' ? String(r.errorCode || 'api_error').toLowerCase() : '';
  if (r.errorId) return r.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE' ? [] : null;
  return ((r.solution?.objects || []) as number[]).map((o) => o + 1).filter((i) => i >= 1 && i <= pz.tiles.length);
}

async function tileHas(img: HTMLImageElement, target: string, escalate: boolean): Promise<boolean> {
  const image = await canvasData(img, 'image/jpeg', 0.92);
  if (!image) return false;
  const r = await solveTask('recaptcha', { type: 'ReCaptchaV2Classification', image, question: target, size: 1, escalate });
  if (r.errorId && r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') apiError = String(r.errorCode || 'api_error').toLowerCase();
  return !r.errorId && !!r.solution?.hasObject;
}

interface Rounds { reason: string; rounds: number; audio: number; audioAt: number }

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Google's clip, fetched from this frame (Google's own origin, its own cookies): the same request the player
 * makes. In Firefox the page's own fetch, so the request is the page's and not the add-on's. */
async function clip(url: string): Promise<string | null> {
  try {
    const f: typeof fetch = (globalThis as any).content?.fetch?.bind((globalThis as any).content) || fetch;
    const r = await f(url, { credentials: 'include' });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return buf.byteLength > 100 ? b64(buf) : null;
  } catch {
    return null;
  }
}

async function solveRounds(state: () => State, why: 'auto' | 'button' = 'auto'): Promise<Rounds> {
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  const out = (reason: string): Rounds => ({ reason, rounds, audio: audioRounds, audioAt });
  let rounds = 0;
  // the audio fallback
  let audioMode = false;
  let audioRounds = 0;
  let audioAt = 0;
  let lastClip = '';
  let clipAt = 0;
  const audioOn = () => !!rc && rc.gate('rcaudio') === '';
  const toAudio = async (): Promise<boolean> => {
    const btn = document.querySelector('#recaptcha-audio-button');
    if (!rc || !btn || !visible(btn)) return false;
    const may = await rc.start('rcaudio', why, { verified: true });
    if (!may.ok) return false;
    audioMode = true;
    audioAt = performance.now();
    report('rcaudio', 'round', { n: 0, from: rounds });
    await idle(0.5, 1.1);
    await click(btn);
    await idle(1.2, 2.0);
    return true;
  };
  let lastPayload = '';
  let same = 0;
  let audioSwitches = 0;
  let lastGrid = performance.now();
  await idle(1.0, 1.6);                                    // let the pop-up finish opening
  while (elapsed() < BUDGET_S && rounds < MAX_ROUNDS) {
    const st = state();
    if (st.anchor === 'checked') return out('solved');
    if (!st.open) {
      if (performance.now() - st.closedAt < 1500) { await sleep(0.4); continue; }
      // the pop-up closed: for an invisible widget that is the pass; with a checkbox, its tick says
      await sleep(1.2);
      const a = state().anchor;
      return out(a === 'checked' || a === 'invisible' || a === 'unknown' ? 'solved' : 'closed');
    }
    const pz = parsePuzzle();
    if (pz.refused) return out('refused');
    if (pz.audio && audioMode) {
      // one clip: fetched here, read by AudioTask, typed, Verify (Enter when the button is out of view)
      const input = document.querySelector<HTMLInputElement>('#audio-response');
      if (!pz.audioSrc || !input) { await sleep(0.6); continue; }
      if (pz.audioSrc === lastClip && performance.now() - clipAt < 10_000) { await sleep(0.8); continue; }
      if (audioRounds >= AUDIO_MAX_ROUNDS) return out('audio_rounds');
      lastClip = pz.audioSrc;
      clipAt = performance.now();
      audioRounds++;
      report('rcaudio', 'round', { n: audioRounds, error: pz.audioError });
      const body = await clip(pz.audioSrc);
      if (!body) return out('audio_fetch');
      const r = await solveTask('rcaudio', { type: 'AudioTask', body });
      if (r.errorId) {
        if (r.errorCode !== 'ERROR_CAPTCHA_UNSOLVABLE') return out(String(r.errorCode || 'api_error').toLowerCase());
        const reload = document.querySelector('#recaptcha-reload-button');       // a new clip, like a person who could not make it out
        if (reload && visible(reload)) { await idle(0.5, 1.0); await click(reload); }
        continue;
      }
      const answer = String(r.solution?.text || '').trim();
      if (!answer) continue;
      input.value = '';
      await typeInto(input, answer);
      await idle(0.4, 0.9);
      const verify = document.querySelector<HTMLElement>('#recaptcha-verify-button');
      const vr = verify?.getBoundingClientRect();
      if (verify && vr && visible(verify) && vr.bottom <= window.innerHeight && vr.right <= window.innerWidth) await click(verify);
      else await pressEnter(input);
      await idle(1.2, 1.8);
      continue;
    }
    if (pz.audio) {
      const b = document.querySelector('#recaptcha-image-button');
      if (b && audioSwitches < 2) {
        audioSwitches++;
        await idle(0.5, 1.1);
        await click(b);
        await idle(1.2, 1.8);
        continue;
      }
      return out('audio_challenge');
    }
    if (!pz.tiles.length || pz.tiles.some((t) => t.loading || !t.img?.complete)) {
      if (!pz.tiles.length && performance.now() - lastGrid > NO_GRID_S * 1000) return out('no_grid');
      await sleep(0.6);
      continue;
    }
    lastGrid = performance.now();
    if (pz.payload === lastPayload && !pz.errors.length) {
      same++;
      if (same < 4) { await sleep(0.7); continue; }
    }
    lastPayload = pz.payload;
    same = 0;
    // the pictures keep failing (or the harness asks for audio from the start): Google's audio challenge instead
    if (!audioMode && audioOn() && ((rc && rc.cfg.audioFirst) || rounds >= AUDIO_AFTER) && await toAudio()) continue;
    rounds++;
    const escalate = pz.errors.length > 0 || rounds >= 3;       // the engine's switch to the stronger model
    report('recaptcha', 'round', { n: rounds, grid: pz.grid, dynamic: pz.dynamic });
    const picked = await classify(pz, escalate);
    if (picked === null) {
      // a refusal that asking again cannot change (the key, the credits, a limit, the type switched off): stop now
      // a picture the service does not know: the audio challenge, when that is switched on
      if (apiError === 'error_unknown_question' && !audioMode && audioOn() && await toAudio()) continue;
      if (apiError && !PASSING.has(apiError)) return out(apiError);
      await sleep(1.0);
      if (rounds >= 3 && elapsed() > 30) return out(apiError || 'api_error');
      continue;
    }
    if (pz.dynamic) {
      await dynamicRound(pz, picked, escalate, t0);
    } else {
      const want = new Set(picked);
      const already = pz.tiles.map((t, i) => (t.selected ? i + 1 : 0)).filter(Boolean);
      const order = [...want].sort((a, b) => a - b).filter((i) => !already.includes(i));
      for (const [k, i] of order.entries()) {
        await click(pz.tiles[i - 1].td);
        await idle(0.18, 0.55);
        if (k === 0 && pz.tiles[i - 1].td.classList.contains('rc-imageselect-dynamic-selected')) {
          // the tile went away to reload: a reloading-tile puzzle after all (non-English instructions)
          await dynamicRound({ ...pz, dynamic: true }, order.slice(1), escalate, t0, i);
          break;
        }
      }
      for (const i of already) {
        if (want.has(i)) continue;
        await click(pz.tiles[i - 1].td);
        await idle(0.18, 0.55);
      }
    }
    await idle(0.5, 1.1);
    const verify = document.querySelector('#recaptcha-verify-button');
    if (verify && visible(verify)) await click(verify);
    await idle(0.9, 1.4);
  }
  return out(rounds >= MAX_ROUNDS ? 'rounds' : 'timeout');
}

/** Reloading tiles as a pipeline (as the server-side solver does it): each clicked tile is watched on its own; when its new
 * picture has loaded, only that tile is asked about, and clicked again when it matches. */
async function dynamicRound(pz: Puzzle, picked: number[], escalate: boolean, t0: number, clickedAlready = 0) {
  const srcs = new Map<number, string>(pz.tiles.map((t, i) => [i + 1, t.src]));
  const waiting = new Map<number, { src: string; at: number }>();
  if (clickedAlready) waiting.set(clickedAlready, { src: srcs.get(clickedAlready) || '', at: performance.now() });
  const reads = new Set<Promise<void>>();
  let clicksLeft = DYN_MAX_CLICKS;
  let chain: Promise<void> = Promise.resolve();
  const n = pz.tiles.length;
  const tds = () => Array.from(document.querySelectorAll<HTMLElement>('td.rc-imageselect-tile'));

  const clickTile = (i: number) => {
    chain = chain.then(async () => {
      if (clicksLeft <= 0) return;
      clicksLeft--;
      waiting.set(i, { src: srcs.get(i) || '', at: performance.now() });
      const td = tds()[i - 1];
      if (td) await click(td);
      await idle(0.12, 0.35);
    });
    return chain;
  };
  const read = async (i: number) => {
    const img = tds()[i - 1]?.querySelector('img');
    if (!img || (performance.now() - t0) / 1000 > BUDGET_S) return;
    if (!img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); setTimeout(r, 3000); });
    await idle(0.25, 0.5);                                    // the new picture fades in
    if (await tileHas(img, pz.target, escalate)) await clickTile(i);
  };
  for (const i of picked) await clickTile(i);
  await chain;
  while ((waiting.size || reads.size) && (performance.now() - t0) / 1000 < BUDGET_S) {
    await sleep(0.25);
    if (!waiting.size) continue;
    const now = tds();
    if (now.length !== n) break;                             // a new challenge replaced the grid
    for (const [i, w] of [...waiting]) {
      const td = now[i - 1];
      const img = td?.querySelector('img');
      if (img && img.src && img.src !== w.src && !td.classList.contains('rc-imageselect-dynamic-selected')) {
        waiting.delete(i);
        srcs.set(i, img.src);
        const p = read(i).catch(() => undefined).finally(() => reads.delete(p));
        reads.add(p);
      } else if (performance.now() - w.at > DYN_TILE_WAIT_S * 1000) {
        waiting.delete(i);                                    // Google left this tile as it was
      }
    }
  }
}
