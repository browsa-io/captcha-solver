// Runs in every frame. Finds out which captcha this frame can hold and starts only that watcher:
//   a provider's own frame (reCAPTCHA, hCaptcha, Cloudflare, DataDome; checked by the frame's address), else the
//   page watchers (GeeTest, AWS WAF, image text, Altcha, press and hold). Nothing is read or sent until a supported
//   captcha is on screen, and nothing costs credits until the background agrees (begin).
import { type Config, type Kind, autoOn, gate, load, merge, DEFAULTS } from '../lib/config';
import { begin, bg, report, type Verdict, type Why } from '../lib/msg';
import { setTrusted, type Box } from '../lib/input';
import { retryable } from '../lib/reasons';
import { selectorFor } from '../lib/selector';
import { notify, listenTop, frameEl, signal, offer } from './notice';
import { isAnchor, isBframe, runAnchor, runBframe } from './recaptcha';
import { runGeetest } from './geetest';
import { runAwsWaf } from './awswaf';
import { runText } from './textcap';
import { runHcaptcha, isHcFrame } from './hcaptcha';
import { runTurnstile, isTurnstileFrame, checkPageTitle } from './turnstile';
import { runAltcha } from './altcha';
import { runPressHold } from './presshold';
import { runDataDome, isDataDomeFrame } from './datadome';
import { unsupportedHere } from './unsupported';
import { runTencent } from './tencent';
import { runYidun } from './yidun';
import { runDingxiang } from './dingxiang';
import { runMtCaptcha, isMtFrame } from './mtcaptcha';
import { runCutcaptcha } from './cutcaptcha';
import { runCyberSiara } from './cybersiara';

export interface StartOpts { verified?: boolean; sig?: string; anchor?: [number, number, number, number] | null }

export interface Ctx {
  cfg: Config;
  host: string;                                   // the tab's site (top frame), for the skip list and limits
  title: string;                                  // the tab's title when this frame started
  isTop: boolean;
  /** '' when this kind may run here by the settings alone (no network call). */
  gate(kind: Kind): string;
  /** Ask the background to begin a solve; a refusal is shown (notice, popup line). Auto refusals are remembered
   * until the settings change, so a page is not asked about every second. */
  start(kind: Kind, why: Why, opts?: StartOpts): Promise<{ ok: boolean; reason?: string; answer?: string }>;
  /** An automatic solve of this kind was refused and nothing changed since (settings, pause end). */
  blockedAuto(kind: Kind): boolean;
  /** The automatic watcher should not try now (a quiet setting, or a refusal already shown). */
  skipAuto(kind: Kind): boolean;
  /** The end of a solve: the log line, and a notice when it did not pass. */
  end(kind: Kind, verdict: Verdict, data?: Record<string, unknown> & { reason?: string; anchor?: StartOpts['anchor'] }): void;
  bg: typeof bg;
  /** The Solve button: `present` says whether this frame holds that captcha now; `run` solves it; `box` is where
   * it is on screen (for the in-page button), when this frame knows. */
  onManual(kind: Kind, present: () => boolean, run: () => unknown, box?: () => Box | null): void;
  on(cmd: string, cb: (m: any) => void): void;    // messages from the background
}

declare global { interface Window { __browsaCaptcha?: boolean } }

// refusals that need no notice when nobody pressed Solve (the person chose them)
const QUIET = new Set(['off', 'type_off', 'site_off', 'site_not_listed', 'auto_off', 'text_no', 'already_solved', 'not_started', 'unsupported', 'no_trusted']);
const OFFER_MS = 1500;          // how often a frame says "a captcha waits here" while one does (the in-page button)

async function start() {
  if (window.__browsaCaptcha) return;
  window.__browsaCaptcha = true;
  const where = await bg<{ host?: string; title?: string }>('whereAmI');
  const manual: Array<{ kind: Kind; present: () => boolean; run: () => unknown; box?: () => Box | null }> = [];
  const handlers: Record<string, Array<(m: any) => void>> = {};
  const blocked = new Map<Kind, { reason: string; until: number }>();
  const tries = new Map<Kind, number>();          // extra tries already made for this captcha (Options: retries)
  const here = (w: { present: () => boolean }) => { try { return w.present(); } catch { return false; } };
  const ctx: Ctx = {
    cfg: merge(DEFAULTS, {}),
    host: (where && where.host) || location.hostname,
    title: (where && where.title) || '',
    isTop: window === window.top,
    gate: (kind) => gate(ctx.cfg, kind, ctx.host),
    bg,
    async start(kind, why, opts = {}) {
      if (why === 'auto') {
        const b = blocked.get(kind);
        if (b && b.until > Date.now()) return { ok: false, reason: b.reason };
      }
      const r = await begin(kind, why, opts);
      if (r.ok) { blocked.delete(kind); return r; }
      const reason = r.reason || 'failed';
      if (why === 'auto' && reason !== 'already_solved') {
        blocked.set(kind, { reason, until: reason === 'cooldown' ? Date.now() + 31_000 : Number.MAX_SAFE_INTEGER });
      }
      if (why === 'button' || !QUIET.has(reason)) notify({ reason, kind, manual: why === 'button', anchor: opts.anchor });
      return r;
    },
    blockedAuto(kind) {
      const b = blocked.get(kind);
      return !!b && b.until > Date.now();
    },
    skipAuto(kind) {
      // settings the person chose (off, type off, site skipped) stay silent; anything else (no key...) goes on to
      // start(), which says why once
      return !autoOn(ctx.cfg, kind) || QUIET.has(gate(ctx.cfg, kind, ctx.host)) || ctx.blockedAuto(kind);
    },
    end(kind, verdict, data = {}) {
      const { anchor, ...rest } = data;
      report(kind, 'end', { verdict, ...rest });
      if (verdict === 'solved' || verdict === 'typed') { tries.delete(kind); return; }
      const reason = String(rest.reason || 'failed');
      // a failed solve is tried again by itself, as many times and after as long as the settings say
      const n = tries.get(kind) || 0;
      if (verdict === 'failed' && retryable(reason) && n < ctx.cfg.retries) {
        tries.set(kind, n + 1);
        setTimeout(() => { const w = manual.find((x) => x.kind === kind && here(x)); if (w) void w.run(); }, ctx.cfg.retryDelay * 1000);
        return;
      }
      notify({ reason, kind, manual: true, anchor });
    },
    onManual: (kind, present, run, box) => { manual.push({ kind, present, run, box }); },
    on: (cmd, cb) => { (handlers[cmd] = handlers[cmd] || []).push(cb); },
  };
  ctx.cfg = await load();
  setTrusted(ctx.cfg.trustedInput);
  chrome.storage.onChanged.addListener(async (ch) => {
    if (ch.config) {
      ctx.cfg = await load();
      setTrusted(ctx.cfg.trustedInput);
      blocked.clear();                                // new settings: auto may try again
    }
  });
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (!m || typeof m.cmd !== 'string') return;
    if (m.cmd === 'solveNow') {
      const found: Kind[] = [];
      for (const w of manual) {
        if (here(w)) { found.push(w.kind); tries.delete(w.kind); void w.run(); }
      }
      const unsupported = found.length ? [] : unsupportedHere();
      void bg('manualAck', { found, unsupported });
      reply({ ok: true, found });
      return;
    }
    if (m.cmd === 'iframeRect') {
      const f = frameEl(String(m.url || ''));
      if (!f) { reply(null); return; }
      const r = f.getBoundingClientRect();
      const s = getComputedStyle(f);
      reply({ x: r.left + f.clientLeft + parseFloat(s.paddingLeft || '0'), y: r.top + f.clientTop + parseFloat(s.paddingTop || '0') });
      return;
    }
    (handlers[m.cmd] || []).forEach((f) => f(m));
  });
  listenTop(ctx.on);
  void signal;
  if (ctx.isTop) void pagePassed(ctx);
  marking(ctx, manual);
  // The in-page Solve button: while a captcha here waits for a click (its type's auto-solve is off, or an automatic
  // solve was held back), this frame says so and the top frame draws the button. Costs nothing when types solve by
  // themselves: present() is not even asked then.
  setInterval(() => {
    if (ctx.cfg.button === 'off' || !ctx.cfg.enabled || document.hidden) return;
    for (const w of manual) {
      if (ctx.gate(w.kind)) continue;
      const b = blocked.get(w.kind);
      const held = !!b && b.until > Date.now() && b.reason !== 'ask_site';
      if ((autoOn(ctx.cfg, w.kind) && !held) || !here(w)) continue;
      let box: Box | null = null;
      try { box = w.box ? w.box() : null; } catch { box = null; }
      offer({ kind: w.kind, pos: ctx.cfg.button, box: ctx.isTop ? box : null });
    }
  }, OFFER_MS);

  const u = location.href;
  if (isAnchor(u)) return void runAnchor(ctx);
  if (isBframe(u)) return void runBframe(ctx);
  if (/^https:\/\/(www\.)?(google\.com|recaptcha\.net)\/recaptcha\//.test(u)) return;
  if (isHcFrame(u)) return void runHcaptcha(ctx);
  if (isTurnstileFrame(u)) return void runTurnstile(ctx);
  if (isDataDomeFrame(u)) return void runDataDome(ctx);
  if (isMtFrame(u)) return void runMtCaptcha(ctx);
  // tiny frames (ads, trackers) hold none of these
  if (!ctx.isTop && (window.innerWidth < 120 || window.innerHeight < 60)) return;
  void runGeetest(ctx);
  void runAwsWaf(ctx);
  void runText(ctx);
  void runAltcha(ctx);
  void runPressHold(ctx);
  void runTencent(ctx);
  void runYidun(ctx);
  void runDingxiang(ctx);
  void runCutcaptcha(ctx);
  void runCyberSiara(ctx);
}

/** Right-click on a picture the detector missed: "this picture is a captcha", then on its field: "the answer goes
 * in this field". The two selectors are kept for the site (settings: custom) and the picture is solved at once. */
function marking(ctx: Ctx, manual: Array<{ kind: Kind; run: () => unknown }>) {
  let last: Element | null = null;
  let img = '';
  document.addEventListener('contextmenu', (e) => { last = (e.composedPath()[0] as Element) || null; }, true);
  ctx.on('markImage', () => {
    const el = last instanceof HTMLImageElement ? last : null;
    img = el ? selectorFor(el) : '';
    notify({ reason: img ? 'mark_image' : 'mark_failed', manual: true });
  });
  ctx.on('markInput', async () => {
    const el = last instanceof HTMLInputElement || last instanceof HTMLTextAreaElement ? last : null;
    if (!img) { notify({ reason: 'mark_input_first', manual: true }); return; }
    const input = el ? selectorFor(el) : '';
    if (!input) { notify({ reason: 'mark_failed', manual: true }); return; }
    await bg('customText', { custom: { img, input } });
    ctx.cfg = await load();
    img = '';
    notify({ reason: 'mark_saved', manual: true });
    const w = manual.find((x) => x.kind === 'text');
    if (w) void w.run();
  });
}

/** A check that passes by loading the real page (Cloudflare's, press and hold, DataDome): the next page says. */
async function pagePassed(ctx: Ctx) {
  for (const kind of ['cfchallenge', 'presshold', 'datadome'] as Kind[]) {
    const p = await bg<{ pending?: boolean; rounds?: number }>('pending', { kind });
    if (!p || !p.pending) continue;
    await new Promise((r) => setTimeout(r, 2500));
    const still = kind === 'cfchallenge' ? checkPageTitle(document.title)
      : kind === 'presshold' ? !!document.getElementById('px-captcha')
        : !!document.querySelector('iframe[src*="captcha-delivery.com"]');
    ctx.end(kind, still ? 'failed' : 'solved', { reason: still ? 'new_puzzle' : 'solved', rounds: p.rounds });
  }
}

void start();
