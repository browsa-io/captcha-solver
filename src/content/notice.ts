// The small in-page notice: why a captcha was not solved, or the one question the extension asks ("Solve picture
// captchas on this site?"). Drawn only by the top frame, in a closed shadow root (the page's styles and scripts
// cannot reach into it), next to the captcha when its position is known, else in the bottom-right corner. A frame
// inside the page (reCAPTCHA's, hCaptcha's) sends its notice through the background to the top frame.
//
// The automation build also writes the outcome on the top document for scripts to wait on:
//   <html data-browsa-captcha="solving:<kind> | solved:<kind> | typed:<kind> | failed:<kind>:<reason> | ...">
// and dispatches a `browsa-captcha` event on document with { state, kind, reason }. The store build never does
// (it would tell every site the extension is installed).
import { type Kind, IS_AUTOMATION } from '../lib/config';
import { explain, type Action } from '../lib/reasons';
import { bg } from '../lib/msg';
import { deepAll } from '../lib/dom';

export interface Notice { reason: string; kind?: Kind; manual?: boolean; anchor?: [number, number, number, number] | null; frameUrl?: string }

const isTop = window === window.top;
const shown = new Set<string>();         // one notice per kind and reason per page, unless the person pressed Solve

export function notify(n: Notice) {
  const key = `${n.kind || ''}:${n.reason}`;
  if (!n.manual && shown.has(key)) return;
  shown.add(key);
  if (isTop) render(n);
  else void bg('notice', { notice: { ...n, frameUrl: location.href } });
}

/** The automation build's result signal (top frame). Sub-frames send it through the background. */
export function signal(state: string, kind: Kind | string, reason = '') {
  if (!IS_AUTOMATION) return;
  if (!isTop) { void bg('signal', { state, kind, reason }); return; }
  writeSignal(state, kind, reason);
}

export function writeSignal(state: string, kind: string, reason = '') {
  if (!IS_AUTOMATION || !isTop) return;
  const v = [state, kind, reason].filter(Boolean).join(':');
  document.documentElement.setAttribute('data-browsa-captcha', v);
  document.dispatchEvent(new CustomEvent('browsa-captcha', { detail: { state, kind, reason } }));
}

/** Where a child frame sits in this (top) page, from its address: only direct children are found. */
export function frameRect(url: string): DOMRect | null {
  return frameEl(url)?.getBoundingClientRect() || null;
}

/** The child frame element with this address; frames inside shadow roots too (Cloudflare's check page). */
export function frameEl(url: string): HTMLIFrameElement | null {
  return findFrame(Array.from(document.querySelectorAll('iframe, frame')) as HTMLIFrameElement[], url)
    || findFrame(deepAll<HTMLIFrameElement>('iframe, frame'), url);
}

function findFrame(frames: HTMLIFrameElement[], url: string): HTMLIFrameElement | null {
  const strip = (u: string) => u.split('#')[0];
  const hit = frames.find((f) => f.src === url) || frames.find((f) => f.src && strip(f.src) === strip(url))
    || frames.find((f) => f.src && url.startsWith(strip(f.src).split('?')[0]) && f.getBoundingClientRect().width > 0);
  return hit || null;
}

// ---------------------------------------------------------------- drawing (top frame)

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let timer = 0;

const CSS = `
:host { all: initial; }
.n { position: fixed; z-index: 2147483647; max-width: 340px; box-sizing: border-box; display: flex; align-items: center;
  gap: 8px; flex-wrap: wrap; padding: 8px 10px 8px 12px; border-radius: 8px; background: #0f1713; color: #e6efe9;
  border: 1px solid #2a3630; box-shadow: 0 6px 24px rgba(0,0,0,.35); font: 13px/1.35 -apple-system, "Segoe UI", Roboto,
  Helvetica, Arial, sans-serif; letter-spacing: 0; text-align: left; opacity: 0; transform: translateY(4px);
  transition: opacity .16s ease, transform .16s ease; }
.n.in { opacity: 1; transform: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #9aa8a0; flex: none; }
.error .dot { background: #f0706a; } .ask .dot { background: #3ddc84; }
.from { color: #8b9a92; font-size: 11px; width: 100%; margin: -2px 0 -2px 16px; }
.msg { flex: 1 1 180px; min-width: 0; }
a, button { font: inherit; font-weight: 600; color: #3ddc84; background: none; border: 0; padding: 2px 4px; cursor: pointer;
  text-decoration: none; border-radius: 4px; }
a:hover, button:hover { text-decoration: underline; }
button.solid { background: #3ddc84; color: #0b1a12; padding: 3px 10px; }
button.solid:hover { text-decoration: none; filter: brightness(1.06); }
.x { color: #8b9a92; font-weight: 400; font-size: 15px; line-height: 1; padding: 2px 4px; }
:focus-visible { outline: 2px solid #3ddc84; outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .n { transition: none; } }
`;

function place(box: HTMLElement, n: Notice) {
  let a: { left: number; top: number; bottom: number; right: number } | null = null;
  if (n.anchor) a = { left: n.anchor[0], top: n.anchor[1], bottom: n.anchor[1] + n.anchor[3], right: n.anchor[0] + n.anchor[2] };
  else if (n.frameUrl) {
    const r = frameRect(n.frameUrl);
    if (r && r.width > 30 && r.height > 30) a = { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = box.offsetWidth || 300, h = box.offsetHeight || 40;
  if (a && a.bottom > 0 && a.top < vh && a.right + 12 + w < vw - 8) {
    // beside the captcha, so the field under it stays free
    box.style.left = a.right + 12 + 'px';
    box.style.top = Math.max(8, Math.min(vh - h - 8, a.top)) + 'px';
  } else if (a && a.bottom > 0 && a.top < vh) {
    const top = a.bottom + 8 + h < vh ? a.bottom + 8 : Math.max(8, a.top - h - 8);
    box.style.top = top + 'px';
    box.style.left = Math.max(8, Math.min(vw - w - 8, a.left)) + 'px';
  } else {
    box.style.right = '16px';
    box.style.bottom = '16px';
  }
}

function act(action: Action) {
  const cmd = action === 'allow_text' ? 'allowText' : action === 'deny_text' ? 'denyText' : action === 'enable_site' ? 'enableSite' : 'solveTab';
  void bg(cmd);
  close();
}

function close() {
  clearTimeout(timer);
  host?.remove();
  host = null;
  root = null;
}

function render(n: Notice) {
  if (!document.documentElement) return;
  const e = explain(n.reason, n.kind);
  close();
  host = document.createElement('browsa-solver-notice');
  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const box = document.createElement('div');
  box.className = `n ${e.tone}`;
  box.setAttribute('role', e.tone === 'ask' ? 'dialog' : 'status');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-label', 'Browsa Solver');
  const from = document.createElement('span');
  from.className = 'from';
  from.textContent = 'Browsa Solver';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = e.text;
  box.append(from, dot, msg);
  if (e.link) {
    const l = document.createElement('a');
    l.href = e.link.href;
    l.target = '_blank';
    l.rel = 'noopener noreferrer';
    l.textContent = e.link.label;
    box.append(l);
  }
  for (const [i, a] of (e.actions || []).entries()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    if (i === 0) b.className = 'solid';
    b.addEventListener('click', () => act(a.action));
    box.append(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  x.addEventListener('click', close);
  box.append(x);
  root.append(style, box);
  document.documentElement.append(host);
  place(box, n);
  requestAnimationFrame(() => box.classList.add('in'));
  const ms = e.tone === 'ask' ? 60_000 : e.tone === 'error' ? 15_000 : 9_000;
  timer = window.setTimeout(close, ms);
  box.addEventListener('mouseenter', () => clearTimeout(timer));
  box.addEventListener('mouseleave', () => { clearTimeout(timer); timer = window.setTimeout(close, 6_000); });
}

/** The top frame's half: notices and signals sent on by the background from frames inside the page. */
export function listenTop(on: (cmd: string, cb: (m: any) => void) => void) {
  if (!isTop) return;
  on('notice', (m) => { const n = m.notice as Notice; const key = `${n.kind || ''}:${n.reason}`; if (n.manual || !shown.has(key)) { shown.add(key); render(n); } });
  on('signal', (m) => writeSignal(String(m.state), String(m.kind), String(m.reason || '')));
}
