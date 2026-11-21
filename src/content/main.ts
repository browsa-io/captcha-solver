// Runs in every frame. Finds out which captcha this frame can hold and starts only that watcher:
//   a provider's own frame (reCAPTCHA, hCaptcha, Cloudflare, DataDome; checked by the frame's address), else the
//   page watchers (GeeTest, AWS WAF, image text, Altcha, press and hold). Nothing is read or sent until a supported
//   captcha is on screen, and nothing costs credits until the background agrees (begin).
import { type Config, type Kind, gate, load, merge, DEFAULTS } from '../lib/config';
import { begin, bg, report, type Verdict, type Why } from '../lib/msg';
import { setTrusted } from '../lib/input';
import { notify, listenTop, frameEl, signal } from './notice';
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
  /** The Solve button: `present` says whether this frame holds that captcha now; `run` solves it. */
  onManual(kind: Kind, present: () => boolean, run: () => unknown): void;
  on(cmd: string, cb: (m: any) => void): void;    // messages from the background
}

declare global { interface Window { __browsaCaptcha?: boolean } }

// refusals that need no notice when nobody pressed Solve (the person chose them)
const QUIET = new Set(['off', 'type_off', 'site_off', 'text_no', 'already_solved', 'not_started', 'unsupported', 'no_trusted']);

async function start() {
  if (window.__browsaCaptcha) return;
  window.__browsaCaptcha = true;
  const where = await bg<{ host?: string; title?: string }>('whereAmI');
  const manual: Array<{ kind: Kind; present: () => boolean; run: () => unknown }> = [];
  const handlers: Record<string, Array<(m: any) => void>> = {};
  const blocked = new Map<Kind, { reason: string; until: number }>();
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
      return QUIET.has(gate(ctx.cfg, kind, ctx.host)) || ctx.blockedAuto(kind);
    },
    end(kind, verdict, data = {}) {
      const { anchor, ...rest } = data;
      report(kind, 'end', { verdict, ...rest });
      if (verdict !== 'solved' && verdict !== 'typed') notify({ reason: String(rest.reason || 'failed'), kind, manual: true, anchor });
    },
    onManual: (kind, present, run) => { manual.push({ kind, present, run }); },
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
        let here = false;
        try { here = w.present(); } catch { here = false; }
        if (here) { found.push(w.kind); void w.run(); }
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

  const u = location.href;
  if (isAnchor(u)) return void runAnchor(ctx);
  if (isBframe(u)) return void runBframe(ctx);
  if (/^https:\/\/(www\.)?(google\.com|recaptcha\.net)\/recaptcha\//.test(u)) return;
  if (isHcFrame(u)) return void runHcaptcha(ctx);
  if (isTurnstileFrame(u)) return void runTurnstile(ctx);
  if (isDataDomeFrame(u)) return void runDataDome(ctx);
  // tiny frames (ads, trackers) hold none of these
  if (!ctx.isTop && (window.innerWidth < 120 || window.innerHeight < 60)) return;
  void runGeetest(ctx);
  void runAwsWaf(ctx);
  void runText(ctx);
  void runAltcha(ctx);
  void runPressHold(ctx);
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
