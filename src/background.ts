// Background (service worker in Chrome, event page in Firefox).
//   - begin: whether a solve may start (settings, the site's yes for picture text, provider origin, limits). Every
//     API call belongs to a begun solve; a page cannot start one, only the extension's own content script can.
//   - createTask: the one place a request leaves for the API. It carries the key, the captcha's picture(s) and
//     question, and the site's host name only (no path, no query, no cookies, no page content).
//   - fetchImage: a captcha's own picture or sound files, from that provider's hosts only (origin.ts FILE_HOSTS).
//   - capture: a crop of the visible tab, for a captcha picture a canvas cannot read.
//   - trusted: plays a planned pointer gesture through chrome.debugger (opt-in, Chrome only).
//   - the solve log, the badge, the key's state, notices sent on to the top frame, the Solve button's fan-out.
import { type Config, type CustomText, type Kind, IS_AUTOMATION, KIND_INFO, autoOn, gate, load, save, hostIn } from './lib/config';
import { Guard } from './lib/guard';
import { LINKS, refine, verdictFor } from './lib/reasons';
import { fileAllowed, providerFrame } from './lib/origin';
import { t } from './lib/i18n';

const API_TIMEOUT_MS = 40_000;     // the longest held call (25 s) and room for a slow answer; then "couldn't reach Browsa"
const ALIVE_MS = 20_000;           // while a call is out, the background says it is busy (see api())
const WAIT_S = 25;                 // the API holds a call this long at most (GET /types: features.waitSeconds.max)
const TOKEN_BUDGET_MS = 150_000;   // a task answered later (token types): held calls one after another, no timer
export const REPORT_WINDOW_MS = 15 * 60_000;   // the API takes a report for 15 minutes after the solve
const USER_FIX = /^ERROR_(RATE_LIMIT|BUDGET_EXCEEDED|SERVICE_UNAVALIABLE|TASK_TIMEOUT)$/;
const LOG_MAX = 50;
const SESSION_TTL_MS = 5 * 60_000;

const hostOf = (u?: string) => {
  try { return u ? new URL(u).hostname.toLowerCase() : ''; } catch { return ''; }
};

// ---------------------------------------------------------------- install, automation config

async function applyAutomationConfig() {
  if (!IS_AUTOMATION) return;
  try {
    const r = await fetch(chrome.runtime.getURL('automation.json'));
    const c = (await r.json()) as Partial<Config>;
    if (!c.apiKey || /your_key_here/.test(String(c.apiKey))) delete c.apiKey;   // keeps a key set at run time
    await save(c);
  } catch (e) {
    console.warn('automation.json not applied', e);
  }
}
chrome.runtime.onInstalled.addListener((d) => {
  void applyAutomationConfig();
  menus();
  // a first install opens the welcome page (what it does, the three steps); never in automation runs
  if (d.reason === 'install' && !IS_AUTOMATION) void chrome.tabs.create({ url: LINKS.welcome + '?from=install' }).catch(() => undefined);
});
chrome.runtime.onStartup?.addListener(() => { void applyAutomationConfig(); });

// ---------------------------------------------------------------- guard (limits, permission, pause, solved pictures)

const guard = new Guard();
const session = (chrome.storage as any).session as chrome.storage.StorageArea | undefined;
const guardReady = (async () => {
  try { guard.load(((await session?.get('guard')) || {}).guard as any); } catch { /* memory only */ }
})();
function saveGuard() { session?.set({ guard: guard.s }).catch(() => undefined); }

// ---------------------------------------------------------------- the key's state (popup: red when refused)

export interface Trial { total: number; used: number; left: number; dailyLimit?: number; usedToday?: number }
export interface KeyState {
  state: 'ok' | 'refused' | 'no_credits' | 'trial_used' | 'offline' | 'unknown' | 'none';
  balance?: number; unit?: string; at: number; code?: string; tail?: string; trial?: Trial; fix?: string;
}

async function setKeyState(k: Omit<KeyState, 'at'>) {
  await chrome.storage.local.set({ keyState: { ...k, at: Date.now() } });
}

/** What an API error says about the key itself ('' when it says nothing: a limit, a blocked site, the network). */
function keyStateFrom(r: any): KeyState['state'] | '' {
  const reason = refine(r?.errorCode, r?.errorDescription);
  if (reason === 'error_key_denied_access') return 'refused';
  if (reason === 'trial_used') return 'trial_used';
  if (reason === 'error_zero_balance') return 'no_credits';
  return '';
}

// ---------------------------------------------------------------- API

async function api(cfg: Config, method: string, body: Record<string, unknown>): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  // Firefox stops an idle background page after 30 s even while a request of its own is still out, and the solve
  // waiting for the answer then ends with no answer at all (seen in Firefox on GeeTest, 2 of 8 solves). A cheap
  // extension call every 20 s says the page is in use, so a slow request ends by its own timeout, in words.
  const alive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => undefined); }, ALIVE_MS);
  stats.started++;
  saveStats();
  try {
    const r = await fetch(cfg.apiBase.replace(/\/+$/, '') + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ clientKey: cfg.apiKey, ...body }), signal: ctl.signal,
    });
    return await r.json();
  } catch (e) {
    if (ctl.signal.aborted) stats.timeouts++;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    // (no "charged" here: only the API can say whether something was charged)
    return { errorId: 1, errorCode: offline ? 'OFFLINE' : 'NETWORK_ERROR',
      errorDescription: String((e as Error)?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
    clearInterval(alive);
    stats.ended++;
    saveStats();
  }
}

async function balance() {
  const cfg = await load();
  if (!cfg.apiKey) { await setKeyState({ state: 'none' }); return { errorId: 1, errorCode: 'NO_KEY' }; }
  const r = await api(cfg, 'getBalance', {});
  const tail = cfg.apiKey.slice(-6);
  const old = (await chrome.storage.local.get('keyState')).keyState as KeyState | undefined;
  if (r && !r.errorId) {
    const n = Number(r.balance);
    // the free trial, when the API reports it (a workspace that has not bought credits yet)
    const tr = r.trial && typeof r.trial === 'object' && Number(r.trial.total) > 0 ? {
      total: Number(r.trial.total), used: Number(r.trial.used) || 0,
      left: Math.max(0, Number(r.trial.left ?? Number(r.trial.total) - (Number(r.trial.used) || 0))),
      dailyLimit: Number(r.trial.dailyLimit) || undefined, usedToday: Number(r.trial.usedToday) || 0 } as Trial : undefined;
    let state: KeyState['state'] = n <= 0 ? 'no_credits' : 'ok';
    if (tr && tr.left <= 0) state = 'trial_used';
    // a trial the API said was used up stays so (an older API does not report the trial with the balance)
    else if (!tr && old && old.state === 'trial_used' && old.tail === tail && Date.now() - old.at < 6 * 3600_000) state = 'trial_used';
    await setKeyState({ state, balance: n, unit: r.unit || 'usd', tail, trial: tr });
  } else {
    const s = keyStateFrom(r);
    const off = r?.errorCode === 'OFFLINE' || r?.errorCode === 'NETWORK_ERROR';
    await setKeyState({ state: s || (off ? 'offline' : 'unknown'), code: r?.errorCode, tail, fix: typeof r?.fix === 'string' ? r.fix.slice(0, 200) : undefined,
      balance: off ? old?.balance : undefined, unit: off ? old?.unit : undefined, trial: off ? old?.trial : undefined });
  }
  return r;
}

async function createTask(sender: chrome.runtime.MessageSender, kind: Kind, task: Record<string, unknown>) {
  const cfg = await load();
  const tabId = sender.tab?.id ?? -1;
  const host = hostOf(sender.tab?.url);
  const s = sessions.get(`${tabId}:${kind}`);
  // only a solve the extension began (begin: settings, permission, limits) may call the API
  if (!s || Date.now() - s.start > SESSION_TTL_MS) return { errorId: 1, errorCode: 'NOT_STARTED', errorDescription: 'no solve in progress' };
  if (!cfg.enabled || !cfg.apiKey) return { errorId: 1, errorCode: cfg.apiKey ? 'EXTENSION_OFF' : 'NO_KEY' };
  if (!s.charged) {
    await guardReady;
    s.charged = true;
    guard.charged(tabId, host);
    saveGuard();
  }
  // Only the captcha itself and the site's host name: never the page's address beyond its host, its cookies,
  // its HTML or anything typed into it.
  const clean = { ...task, websiteURL: host ? `https://${host}/` : undefined };
  const t0 = Date.now();
  // One call: the API answers a picture task inside createTask, and holds the call (waitSeconds) for a task that
  // takes longer. A task still running after that is waited for with held getTaskResult calls: no poll timer.
  let r = await api(cfg, 'createTask', { task: clean, waitSeconds: WAIT_S });
  while (r && !r.errorId && r.taskId && r.status === 'processing' && Date.now() - t0 < TOKEN_BUDGET_MS) {
    r = { taskId: r.taskId, ...(await api(cfg, 'getTaskResult', { taskId: r.taskId, waitSeconds: WAIT_S })) };
  }
  if (r && !r.errorId && r.status === 'processing') r = { errorId: 1, errorCode: 'ERROR_TASK_TIMEOUT', taskId: r.taskId };
  stats.calls++;
  stats.ms += Date.now() - t0;
  if (r && r.errorId) {
    stats.errors++;
    const reason = refine(r.errorCode, r.errorDescription);
    // the API's own "what to do", for the errors where it is written for the person (not for a developer)
    const forPerson = USER_FIX.test(String(r.errorCode || '')) && reason === String(r.errorCode).toLowerCase();
    s.error = { code: String(r.errorCode || ''), reason, fix: forPerson && typeof r.fix === 'string' ? r.fix.slice(0, 240) : undefined,
      charged: typeof r.charged === 'boolean' ? r.charged : undefined };
    const ks = keyStateFrom(r);
    if (ks) await setKeyState({ state: ks, code: r.errorCode, tail: cfg.apiKey.slice(-6), fix: s.error.fix });
  } else if (r) {
    // what this answer cost (the API says; nothing is guessed) and its id, for the "that was wrong" report
    const c = r.cost;
    if (c && typeof c === 'object' && c.charged && Number(c.amount) > 0) {
      s.cost += Number(c.amount);
      s.unit = String(c.unit || 'credits');
    }
    if (c && typeof c === 'object') s.costKnown = true;
    if (typeof r.taskId === 'string' && r.taskId) s.taskIds.push(r.taskId);
  }
  return r;
}

/** "That was wrong": tells the API the last answer of this solve was refused by the site. The API decides about a
 * refund (once, within its limits); the row keeps what it answered. */
async function reportWrong(at: number) {
  const cfg = await load();
  const got = await chrome.storage.local.get('log');
  const row = ((got.log as LogRow[]) || []).find((x) => x.at === at);
  if (!row || !row.taskId || row.reported) return { ok: false, reason: 'no_task' };
  const r = await api(cfg, 'reportIncorrect', { taskId: row.taskId });
  const fresh = (((await chrome.storage.local.get('log')).log as LogRow[]) || []).slice();
  const j = fresh.findIndex((x) => x.at === at);
  if (j < 0) return { ok: false, reason: 'no_task' };
  if (r && !r.errorId) {
    const amount = r.refunded && r.refund && Number(r.refund.amount) > 0 ? Number(r.refund.amount) : 0;
    fresh[j] = { ...fresh[j], reported: 'sent', refunded: amount || undefined, refundUnit: amount ? String(r.refund.unit || 'credits') : undefined,
      reportNote: typeof r.message === 'string' ? r.message.slice(0, 200) : undefined, reportFix: undefined };
  } else {
    const code = String(r?.errorCode || 'NETWORK_ERROR');
    // an answer that cannot be reported any more is final; a network error can be tried again
    const final = /^ERROR_(ALREADY_REPORTED|REPORT_TOO_LATE|REPORT_NOT_SOLVED|REPORT_LIMIT|TASKID_INVALID)$/.test(code);
    fresh[j] = { ...fresh[j], reported: final ? 'refused' : undefined, reportNote: refine(code, r?.errorDescription),
      reportFix: typeof r?.fix === 'string' ? r.fix.slice(0, 200) : undefined };
  }
  await chrome.storage.local.set({ log: fresh });
  if (r && !r.errorId) void balance();
  return { ok: !!(r && !r.errorId), row: fresh[j] };
}

// Counters for the measuring harness (diagnostics only; session storage, gone when the browser closes): API calls
// started and ended (a call that started and never ended was cut off), and how many ran into the timeout.
const stats = { calls: 0, errors: 0, ms: 0, trustedGestures: 0, trustedKeys: 0, started: 0, ended: 0, timeouts: 0 };
(globalThis as any).__browsaCaptchaStats = stats;
function saveStats() { ((chrome.storage as any).session as chrome.storage.StorageArea | undefined)?.set({ stats: { ...stats } }).catch(() => undefined); }

// ---------------------------------------------------------------- pictures

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchImage(url: string, kind: Kind) {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, error: 'bad url' }; }
  if (!fileAllowed(kind, u.href)) return { ok: false, error: 'host not allowed' };
  try {
    const r = await fetch(u.href, { credentials: 'omit', cache: 'force-cache' });
    if (!r.ok) return { ok: false, error: 'http ' + r.status };
    return { ok: true, data: b64(await r.arrayBuffer()) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 80) };
  }
}

/** Where a frame's viewport sits in the tab. With webNavigation (asked for with Trusted input) any depth; without
 * it, a direct child of the top page, found by the frame's own address. */
async function frameOffset(tabId: number, frameId: number, frameUrl = '', depth = 0): Promise<[number, number] | null> {
  if (!frameId) return [0, 0];
  if (depth > 6) return null;
  if (chrome.webNavigation) {
    const f = await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
    if (f) {
      const r = await chrome.tabs.sendMessage(tabId, { cmd: 'iframeRect', url: f.url }, { frameId: f.parentFrameId }).catch(() => null);
      if (r) {
        const up = await frameOffset(tabId, f.parentFrameId, '', depth + 1);
        if (up) return [up[0] + r.x, up[1] + r.y];
      }
    }
  }
  if (!frameUrl) return null;
  const r = await chrome.tabs.sendMessage(tabId, { cmd: 'iframeRect', url: frameUrl }, { frameId: 0 }).catch(() => null);
  return r ? [r.x, r.y] : null;
}

async function capture(sender: chrome.runtime.MessageSender, boxes: number[][], dpr: number, frameUrl: string) {
  const tab = sender.tab;
  if (!tab || tab.id === undefined) return { ok: false };
  const off = await frameOffset(tab.id, sender.frameId || 0, frameUrl || sender.url || '');
  if (!off) return { ok: false, error: 'frame offset unknown' };
  try {
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const images: string[] = [];
    for (const [x, y, w, h] of boxes) {
      const c = new OffscreenCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
      c.getContext('2d')!.drawImage(bmp, (x + off[0]) * dpr, (y + off[1]) * dpr, w * dpr, h * dpr, 0, 0, c.width, c.height);
      images.push(b64(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()));
    }
    return { ok: true, images };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 80) };
  }
}

// ---------------------------------------------------------------- trusted input (chrome.debugger, opt-in)

const attached = new Set<number>();
const dbg = (chrome as any).debugger as typeof chrome.debugger | undefined;
dbg?.onDetach.addListener((src) => { if (src.tabId !== undefined) attached.delete(src.tabId); });
const pause = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | { ok: false; error: string }> {
  return Promise.race([p, new Promise<{ ok: false; error: string }>((r) => setTimeout(() => r({ ok: false, error: 'timeout' }), ms))]);
}

async function withDebugger(tabId: number): Promise<boolean> {
  if (!dbg) return false;
  if (attached.has(tabId)) return true;
  try {
    await dbg.attach({ tabId }, '1.3');
    attached.add(tabId);
    return true;
  } catch {
    return false;
  }
}

async function trustedGesture(sender: chrome.runtime.MessageSender, steps: any[], frameUrl: string) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !(await withDebugger(tabId))) return { ok: false };
  const off = await frameOffset(tabId, sender.frameId || 0, frameUrl || sender.url || '');
  if (!off) return { ok: false };
  const t0 = performance.now();
  for (const s of steps) {
    await pause(s.t * 1000 - (performance.now() - t0));
    const type = s.type === 'move' ? 'mouseMoved' : s.type === 'down' ? 'mousePressed' : 'mouseReleased';
    await dbg!.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type, x: s.x + off[0], y: s.y + off[1], button: s.type === 'move' ? (s.buttons ? 'left' : 'none') : 'left',
      buttons: s.buttons, clickCount: s.type === 'move' ? 0 : 1, pointerType: 'mouse',
      force: s.buttons ? 0.5 : 0,                    // a real mouse reports 0.5 while pressed (press_hold.py)
    });
  }
  stats.trustedGestures++;
  return { ok: true };
}

async function trustedKeys(sender: chrome.runtime.MessageSender, keys: string[], plan: Array<[number, number]>) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !(await withDebugger(tabId))) return { ok: false };
  for (const [i, ch] of keys.entries()) {
    await dbg!.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
    await pause(plan[i][0] * 1000);
    await dbg!.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await pause(plan[i][1] * 1000);
  }
  stats.trustedKeys++;
  return { ok: true };
}

// ---------------------------------------------------------------- solves, the log, the badge

interface Session {
  start: number; host: string; rounds: number; why: string; charged: boolean; navigated?: boolean;
  cost: number; unit: string; costKnown: boolean; taskIds: string[];
  error?: { code: string; reason: string; fix?: string; charged?: boolean };
}
const sessions = new Map<string, Session>();

export interface LogRow {
  at: number; host: string; kind: Kind | string; verdict: string; seconds: number; rounds: number; reason?: string; label?: string;
  cost?: number; unit?: string;       // what the API charged for this solve (absent: the API did not say)
  taskId?: string;                    // the last answer's id: what "that was wrong" reports
  fix?: string;                       // the API's own "what to do" for an error
  reported?: 'sent' | 'refused';      // the report went through / can no longer be made
  refunded?: number; refundUnit?: string; reportNote?: string; reportFix?: string;
}

async function logRow(row: LogRow) {
  const got = await chrome.storage.local.get('log');
  const old = (got.log as LogRow[]) || [];
  const top = old[0];
  // the same "not solved" line again within a minute (a page that keeps showing it) is not repeated
  if (top && row.verdict !== 'solved' && row.verdict !== 'typed' && top.host === row.host && top.kind === row.kind
    && top.verdict === row.verdict && top.reason === row.reason && row.at - top.at < 60_000) return;
  await chrome.storage.local.set({ log: [row, ...old].slice(0, LOG_MAX) });
}

function badge(tabId: number, good: boolean | null) {
  if (tabId < 0) return;
  if (good === null) return;
  chrome.action.setBadgeBackgroundColor({ tabId, color: good ? '#3ccf7a' : '#e5534b' }).catch(() => undefined);
  chrome.action.setBadgeText({ tabId, text: good ? '✓' : '!' }).catch(() => undefined);
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined), 6000);
}

function signalTop(tabId: number, state: string, kind: string, reason = '') {
  if (!IS_AUTOMATION || tabId < 0) return;
  chrome.tabs.sendMessage(tabId, { cmd: 'signal', state, kind, reason }, { frameId: 0 }).catch(() => undefined);
}

// Refusals that are worth a line in the popup even when nobody pressed Solve (with the one-a-minute rule above).
const LOG_AUTO_REFUSALS = new Set(['no_key', 'ask_site', 'page_limit', 'site_limit', 'unverified', 'error_key_denied_access', 'trial_used']);

async function begin(sender: chrome.runtime.MessageSender, kind: Kind, why: 'auto' | 'button', verified: boolean, sig: string) {
  await guardReady;
  if (!KIND_INFO[kind]) return { ok: false, reason: 'unsupported' };
  const cfg = await load();
  const tabId = sender.tab?.id ?? -1;
  const host = hostOf(sender.tab?.url);
  const key = `${tabId}:${kind}`;
  const live = sessions.get(key);
  if (live && Date.now() - live.start < SESSION_TTL_MS && !sig) {
    // another frame of the same widget joins the solve already under way (reCAPTCHA's checkbox, then its puzzle)
    return cfg.enabled && cfg.apiKey ? { ok: true } : { ok: false, reason: cfg.apiKey ? 'off' : 'no_key' };
  }
  // a provider widget is checked by the address of the frame that asks, which the browser reports and a page cannot
  // forge; a page-level widget (GeeTest, AWS WAF) by its scripts' hosts, checked in the content script
  const frameOk = providerFrame(kind, sender.url || '');
  let d: { ok: boolean; reason?: string; answer?: string } = why === 'auto' && !autoOn(cfg, kind)
    ? { ok: false, reason: 'auto_off' }
    : guard.decide(cfg, { kind, why, host, tabId, verified: frameOk === null ? verified : frameOk, sig });
  if (d.ok && cfg.apiKey && KIND_INFO[kind].credits) {
    // a key the API already refused is not sent again until it changes (the panel shows the fix)
    const ks = (await chrome.storage.local.get('keyState')).keyState as KeyState | undefined;
    if (ks && ks.tail === cfg.apiKey.slice(-6)) {
      if (ks.state === 'refused') d = { ok: false, reason: 'error_key_denied_access' };
      else if (ks.state === 'trial_used') d = { ok: false, reason: 'trial_used' };
    }
  }
  if (!d.ok) {
    if (why === 'button' || LOG_AUTO_REFUSALS.has(d.reason || 'failed')) {
      await logRow({ at: Date.now(), host, kind, verdict: verdictFor(d.reason || 'failed'), seconds: 0, rounds: 0, reason: d.reason || 'failed' });
    }
    signalTop(tabId, verdictFor(d.reason || 'failed'), kind, d.reason || 'failed');
    return d;
  }
  sessions.set(key, { start: Date.now(), host, rounds: 0, why, charged: false, cost: 0, unit: 'credits', costKnown: false, taskIds: [] });
  signalTop(tabId, 'solving', kind);
  return d;
}

async function onReport(sender: chrome.runtime.MessageSender, kind: Kind, event: string, data: any) {
  const tabId = sender.tab?.id ?? -1;
  const key = `${tabId}:${kind}`;
  const host = hostOf(sender.tab?.url);
  const s = sessions.get(key);
  if (event === 'round') {
    if (s) s.rounds = Math.max(s.rounds + 1, Number(data.n) || 0);
    return;
  }
  // a solve that only opened a widget whose puzzle belongs to another type (GeeTest v4): that type's solve takes
  // over; this one ends with no line of its own (it made no API call)
  if (event === 'handoff') {
    if (s && !s.charged) sessions.delete(key);
    return;
  }
  if (event === 'end') {
    sessions.delete(key);
    const secs = Number(data.seconds) > 0 ? Number(data.seconds) : s ? (Date.now() - s.start) / 1000 : 0;
    let verdict = String(data.verdict || 'failed');
    let reason = data.reason && data.reason !== 'solved' ? String(data.reason).toLowerCase() : undefined;
    // the API's own error behind this end: its finer reason (trial used up, site not served) and its "what to do"
    const err = s && s.error && reason === s.error.code.toLowerCase() ? s.error : undefined;
    if (err) reason = err.reason;
    if (verdict === 'failed' && reason) verdict = verdictFor(reason);
    const row: LogRow = { at: Date.now(), host: (s && s.host) || host, kind, verdict,
      seconds: Math.round(secs * 10) / 10, rounds: Number(data.rounds) || (s ? s.rounds : 0), reason };
    if (s && s.costKnown) { row.cost = Math.round(s.cost * 1000) / 1000; row.unit = s.unit; }
    if (s && s.taskIds.length) row.taskId = s.taskIds[s.taskIds.length - 1];
    if (err && err.fix) row.fix = err.fix;
    if (err && err.charged === false && row.cost === undefined) { row.cost = 0; row.unit = s ? s.unit : 'credits'; }   // the API said: not charged
    await logRow(row);
    if (s && s.cost > 0) void balance();                          // the header shows what is left after a paid solve
    badge(tabId, verdict === 'solved' || verdict === 'typed' ? true : verdict === 'failed' ? false : null);
    signalTop(tabId, verdict, kind, reason);
    if (verdict === 'typed' && tabId >= 0) {
      guard.typed(tabId, row.host, String(data.sig || ''), String(data.answer || ''));
      saveGuard();
    }
  }
}

// ---------------------------------------------------------------- the Solve button (popup, shortcut, notice)

interface Ack { found: string[]; unsupported: string[] }
const acks = new Map<number, Ack>();

async function solveTab(tabId: number) {
  const host = hostOf((await chrome.tabs.get(tabId).catch(() => null))?.url);
  acks.set(tabId, { found: [], unsupported: [] });
  await chrome.tabs.sendMessage(tabId, { cmd: 'solveNow' }).catch(() => undefined);
  await pause(1600);                          // every frame answers with what it found (manualAck)
  const a = acks.get(tabId) || { found: [], unsupported: [] };
  acks.delete(tabId);
  if (a.found.length) {
    const found = [...new Set(a.found)] as Kind[];
    // every captcha found is off by a setting: the panel says which setting, not "Solving"
    const cfg = await load();
    const why = found.map((k) => gate(cfg, k, host)).filter(Boolean);
    if (why.length === found.length) return { ok: false, reason: why[0], found };
    return { ok: true, found };
  }
  if (a.unsupported.length) {
    const label = [...new Set(a.unsupported)].join(', ');
    await logRow({ at: Date.now(), host, kind: 'unsupported', label, verdict: 'unsupported', seconds: 0, rounds: 0, reason: 'unsupported' });
    chrome.tabs.sendMessage(tabId, { cmd: 'notice', notice: { reason: 'unsupported', manual: true } }, { frameId: 0 }).catch(() => undefined);
    signalTop(tabId, 'unsupported', 'unsupported', label);
    return { ok: false, reason: 'unsupported', label };
  }
  chrome.tabs.sendMessage(tabId, { cmd: 'notice', notice: { reason: 'no_captcha', manual: true } }, { frameId: 0 }).catch(() => undefined);
  return { ok: false, reason: 'no_captcha' };
}

// ---------------------------------------------------------------- messages

const anchors = new Map<string, string>();     // `${tabId}:${kind}` -> the checkbox frame's state

async function editHosts(tabUrl: string | undefined, change: (c: Config, host: string) => Partial<Config>) {
  const host = hostOf(tabUrl);
  if (!host) return { ok: false };
  const cfg = await load();
  await save(change(cfg, host));
  return { ok: true };
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m.cmd !== 'string') return;
  // only the extension's own pages and content scripts can send here (no externally_connectable)
  if (sender.id !== chrome.runtime.id) return;
  const tabId = sender.tab?.id ?? -1;
  const run = async () => {
    switch (m.cmd) {
      case 'whereAmI': return { host: hostOf(sender.tab?.url), frameId: sender.frameId, title: sender.tab?.title || '' };
      case 'begin': return begin(sender, m.kind, m.why === 'button' ? 'button' : 'auto', !!m.verified, String(m.sig || ''));
      case 'createTask': return createTask(sender, m.kind, m.task || {});
      case 'fetchImage': return fetchImage(String(m.url || ''), (KIND_INFO[m.kind as Kind] ? m.kind : 'geetest') as Kind);
      case 'capture': return capture(sender, m.boxes || [], Number(m.dpr) || 1, String(m.frameUrl || ''));
      // a tab the browser does not draw (hidden, covered) never acknowledges debugger input: give up, the page's
      // own events are used instead
      case 'trusted': return withTimeout(trustedGesture(sender, m.gesture?.steps || [], String(m.frameUrl || '')), 20_000);
      case 'trustedKeys': return withTimeout(trustedKeys(sender, m.keys || [], m.plan || []), 30_000);
      case 'report': await onReport(sender, m.kind, m.event, m.data || {}); return { ok: true };
      case 'submitted': {
        await guardReady;
        if (tabId >= 0) { guard.submitted(tabId, hostOf(sender.tab?.url)); saveGuard(); }
        return { ok: true };
      }
      case 'notice':
        if (tabId >= 0) chrome.tabs.sendMessage(tabId, { cmd: 'notice', notice: m.notice }, { frameId: 0 }).catch(() => undefined);
        return { ok: true };
      case 'signal': signalTop(tabId, String(m.state), String(m.kind), String(m.reason || '')); return { ok: true };
      case 'manualAck': {
        const a = acks.get(tabId);
        if (a) { a.found.push(...(m.found || [])); a.unsupported.push(...(m.unsupported || [])); }
        return { ok: true };
      }
      case 'solveTab': {
        const id = typeof m.tabId === 'number' ? m.tabId : tabId;
        return id >= 0 ? solveTab(id) : { ok: false };
      }
      case 'allowText': return editHosts(sender.tab?.url, (c, h) => ({ textSites: [...c.textSites, h], textNo: c.textNo.filter((x) => x !== h) }));
      case 'denyText': return editHosts(sender.tab?.url, (c, h) => ({ textNo: [...c.textNo, h], textSites: c.textSites.filter((x) => x !== h) }));
      case 'enableSite': return editHosts(sender.tab?.url, (c, h) => ({ skip: c.skip.filter((x) => !hostIn(h, [x])) }));
      case 'anchor': {
        const k = `${tabId}:${m.kind}`;
        anchors.set(k, String(m.state));
        if (tabId >= 0) chrome.tabs.sendMessage(tabId, { cmd: 'anchor', kind: m.kind, state: m.state }).catch(() => undefined);
        return { ok: true };
      }
      case 'anchorState': return { state: anchors.get(`${tabId}:${m.kind}`) || 'unknown' };
      case 'pending': {                       // a solve that ended in a page load (AWS WAF, the Cloudflare check)
        const s = sessions.get(`${tabId}:${m.kind}`);
        return { pending: !!(s && s.navigated), rounds: s ? s.rounds : 0 };
      }
      case 'balance': return balance();
      case 'reportWrong': return reportWrong(Number(m.at));
      case 'offer':                             // a captcha waits for a click: the top frame shows the Solve button
        if (tabId >= 0) chrome.tabs.sendMessage(tabId, { cmd: 'offer', offer: { kind: m.kind, pos: m.pos, frameUrl: sender.url || '', box: null } }, { frameId: 0 }).catch(() => undefined);
        return { ok: true };
      case 'customText': return editHosts(sender.tab?.url, (c, h) => {
        const cu = m.custom as CustomText;
        return { custom: { ...c.custom, [h]: { img: String(cu?.img || ''), input: String(cu?.input || '') } },
          textSites: [...c.textSites, h], textNo: c.textNo.filter((x) => x !== h) };
      });
      case 'openOptions': void chrome.runtime.openOptionsPage(); return { ok: true };
      case 'stats': return { ...stats };
      default: return { ok: false, error: 'unknown' };
    }
  };
  run().then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'loading') return;                       // a new page in the tab: its widgets start over
  for (const k of [...anchors.keys()]) if (k.startsWith(tabId + ':')) anchors.delete(k);
  void guardReady.then(() => { guard.newPage(tabId); saveGuard(); });
  for (const [k, s] of [...sessions]) {
    if (!k.startsWith(tabId + ':')) continue;
    // AWS WAF loads the protected page after a right answer: the next page says whether the puzzle is gone
    if (k.endsWith(':awswaf') && s.rounds > 0 && !s.navigated) s.navigated = true;
    // a Cloudflare check, a press and hold or a DataDome slider passes by loading the real page
    else if (/:(cfchallenge|presshold|datadome)$/.test(k) && !s.navigated) s.navigated = true;
    else sessions.delete(k);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  void guardReady.then(() => { guard.closed(tabId); saveGuard(); });
  for (const k of [...sessions.keys()]) if (k.startsWith(tabId + ':')) sessions.delete(k);
  for (const k of [...anchors.keys()]) if (k.startsWith(tabId + ':')) anchors.delete(k);
});

// the keyboard shortcut: the same as the popup's Solve button
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'solve') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) void solveTab(tab.id);
});

// when the key changes, check it again (the popup shows the answer)
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.config) return;
  const a = (ch.config.oldValue as Config | undefined)?.apiKey, b = (ch.config.newValue as Config | undefined)?.apiKey;
  if (a !== b) void balance();
});

// ---------------------------------------------------------------- right-click: "this picture is a captcha"

// For a picture captcha the detector does not recognise: the person points at the picture, then at its answer
// field. Both are remembered for the site (as CSS selectors, in the settings) and solved like any picture captcha.
function menus() {
  const cm = chrome.contextMenus;
  if (!cm) return;
  cm.removeAll(() => {
    cm.create({ id: 'mark-image', title: t('menu_mark_image'), contexts: ['image'] });
    cm.create({ id: 'mark-input', title: t('menu_mark_input'), contexts: ['editable'] });
  });
}
chrome.runtime.onStartup?.addListener(menus);
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  const cmd = info.menuItemId === 'mark-image' ? 'markImage' : info.menuItemId === 'mark-input' ? 'markInput' : '';
  if (cmd) chrome.tabs.sendMessage(tab.id, { cmd }, { frameId: info.frameId || 0 }).catch(() => undefined);
});
