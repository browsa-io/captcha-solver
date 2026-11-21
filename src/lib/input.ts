// Acting on the page like a hand. Two ways, same plans (lib/human.ts):
//   dom      pointer and mouse events dispatched in the captcha's own frame (works in Chrome and Firefox; the
//            events are not isTrusted)
//   trusted  the same gesture sent to the background, which plays it through chrome.debugger's
//            Input.dispatchMouseEvent / dispatchKeyEvent (isTrusted, the same input Browsa's cloud browsers send);
//            Chrome only, opt-in (debugger permission; the browser shows a "debugging" bar)
import { bg } from './msg';
import { clickPoint, entryPoint, holdTime, planMove, planSlide, planTyping, prePress, type Point, type Rng, type Step } from './human';

export const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, s * 1000)));
export const rng: Rng = Math.random;

export type Box = [number, number, number, number];
export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return [r.left, r.top, r.width, r.height];
}

export function visible(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el as HTMLElement).isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

/** visible() without the type narrowing (for "this or that one is visible"). */
export const shows = (el: Element | null | undefined): boolean => visible(el);

interface Gesture { steps: Array<{ t: number; type: 'move' | 'down' | 'up'; x: number; y: number; buttons: number }> }

let trusted = false;
export function setTrusted(on: boolean) { trusted = on; }

// ---------------------------------------------------------------- dom events

let hovered: Element | null = null;
let last: Point | null = null;
let downTarget: Element | null = null;

function screenOffset(): Point {
  return [window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2),
    window.screenY + Math.max(0, window.outerHeight - window.innerHeight)];
}

function fire(target: Element, type: string, x: number, y: number, buttons: number, extra: MouseEventInit = {}) {
  const [ox, oy] = screenOffset();
  const init: PointerEventInit = {
    bubbles: !/enter|leave/.test(type), cancelable: !/enter|leave/.test(type), composed: true, view: window,
    clientX: x, clientY: y, screenX: Math.round(x + ox), screenY: Math.round(y + oy), buttons,
    button: /down|up|click/.test(type) ? 0 : (type.startsWith('pointer') ? -1 : 0),
    detail: /down|up|click/.test(type) && type.startsWith('mouse') || type === 'click' ? 1 : 0,
    movementX: last ? Math.round(x - last[0]) : 0, movementY: last ? Math.round(y - last[1]) : 0, ...extra,
  };
  const ev = type.startsWith('pointer')
    ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1,
      pressure: buttons ? 0.5 : 0 })
    : new MouseEvent(type, init);
  target.dispatchEvent(ev);
}

function at(x: number, y: number): Element {
  return document.elementFromPoint(x, y) || document.documentElement;
}

function domMove(x: number, y: number, buttons: number) {
  const t = at(x, y);
  if (t !== hovered) {
    if (hovered) {
      fire(hovered, 'pointerout', x, y, buttons);
      fire(hovered, 'pointerleave', x, y, buttons);
      fire(hovered, 'mouseout', x, y, buttons);
      fire(hovered, 'mouseleave', x, y, buttons);
    }
    fire(t, 'pointerover', x, y, buttons);
    fire(t, 'pointerenter', x, y, buttons);
    fire(t, 'mouseover', x, y, buttons);
    fire(t, 'mouseenter', x, y, buttons);
    hovered = t;
  }
  fire(t, 'pointermove', x, y, buttons);
  fire(t, 'mousemove', x, y, buttons);
  last = [x, y];
}

function domDown(x: number, y: number) {
  const t = at(x, y);
  downTarget = t;
  fire(t, 'pointerdown', x, y, 1);
  fire(t, 'mousedown', x, y, 1);
  const f = (t as HTMLElement).closest?.('a,button,input,textarea,select,[tabindex]') as HTMLElement | null;
  if (f && typeof f.focus === 'function') f.focus({ preventScroll: true });
}

function domUp(x: number, y: number) {
  const t = at(x, y);
  fire(t, 'pointerup', x, y, 0);
  fire(t, 'mouseup', x, y, 0);
  if (downTarget && (downTarget === t || downTarget.contains(t) || t.contains(downTarget))) fire(t, 'click', x, y, 0);
  downTarget = null;
}

async function play(g: Gesture) {
  if (trusted) {
    const r = await bg<{ ok: boolean; error?: string }>('trusted', { gesture: g, frameUrl: location.href });
    if (r && r.ok) {
      const end = g.steps[g.steps.length - 1];
      if (end) last = [end.x, end.y];
      return;
    }
    trusted = false;                       // debugger refused (permission, another debugger): fall back once
  }
  const t0 = performance.now();
  for (const s of g.steps) {
    const wait = s.t - (performance.now() - t0) / 1000;
    if (wait > 0.002) await sleep(wait);
    if (s.type === 'move') domMove(s.x, s.y, s.buttons);
    else if (s.type === 'down') domDown(s.x, s.y);
    else domUp(s.x, s.y);
  }
}

// ---------------------------------------------------------------- gestures

function from(): Point {
  return last || entryPoint(window.innerWidth, window.innerHeight, rng);
}

function viewport(): Point { return [window.innerWidth, window.innerHeight]; }

function moves(steps: Step[], offset: number, buttons: number): Gesture['steps'] {
  return steps.map((s) => ({ t: s.t + offset, type: 'move' as const, x: s.x, y: s.y, buttons }));
}

export async function clickBox(box: Box) {
  const [x, y] = clickPoint(box, rng);
  const path = planMove(from(), [x, y], Math.min(box[2], box[3]), rng, viewport());
  const tEnd = path.length ? path[path.length - 1].t : 0;
  const press = tEnd + prePress(rng);
  const release = press + holdTime(rng);
  await play({ steps: [...moves(path, 0, 0), { t: press, type: 'down', x, y, buttons: 1 }, { t: release, type: 'up', x, y, buttons: 0 }] });
}

export async function click(el: Element) {
  await clickBox(boxOf(el));
}

export async function hover(x: number, y: number) {
  await play({ steps: moves(planMove(from(), [x, y], 40, rng, viewport()), 0, 0) });
}

/** Press the knob and slide it `dist` CSS px to the right (GeeTest). */
export async function slide(knob: Element, dist: number) {
  const b = boxOf(knob);
  const k: Point = [Math.round(b[0] + b[2] / 2), Math.round(b[1] + b[3] / 2)];
  const p = planSlide(from(), k, dist, rng, viewport());
  const tApp = p.approach.length ? p.approach[p.approach.length - 1].t : 0;
  const press = tApp + p.pressAfter;
  const dragAt = press + p.holdBefore;
  const steps = [...moves(p.approach, 0, 0), { t: press, type: 'down' as const, x: k[0], y: k[1], buttons: 1 },
    ...moves(p.drag, dragAt, 1)];
  const end = steps[steps.length - 1];
  steps.push({ t: end.t + p.releaseAfter, type: 'up', x: end.x, y: end.y, buttons: 0 });
  await play({ steps });
}

/** Press at `a`, carry the pointer to `b` on a hand's path, release (hCaptcha's drag puzzles). Viewport CSS px. */
export async function drag(a: Point, b: Point) {
  const approach = planMove(from(), a, 24, rng, viewport());
  const tApp = approach.length ? approach[approach.length - 1].t : 0;
  const press = tApp + prePress(rng);
  const carryAt = press + 0.12 + rng() * 0.15;
  const carry = planMove(a, b, 24, rng, viewport());
  const steps = [...moves(approach, 0, 0), { t: press, type: 'down' as const, x: a[0], y: a[1], buttons: 1 },
    ...moves(carry, carryAt, 1)];
  const end = steps[steps.length - 1];
  steps.push({ t: end.t + 0.08 + rng() * 0.12, type: 'up', x: b[0], y: b[1], buttons: 0 });
  await play({ steps });
}

/** Press and keep holding at a point (press and hold puzzles), until release() is called. Trusted input only:
 * returns false when the browser's debugger is not available (the puzzle checks for real input). */
export async function holdAt(x: number, y: number): Promise<{ ok: boolean; release: () => Promise<void> }> {
  const approach = planMove(from(), [x, y], 40, rng, viewport());
  const tApp = approach.length ? approach[approach.length - 1].t : 0;
  const steps = [...moves(approach, 0, 0), { t: tApp + prePress(rng), type: 'down' as const, x, y, buttons: 1 }];
  const r = await bg<{ ok: boolean }>('trusted', { gesture: { steps }, frameUrl: location.href });
  last = [x, y];
  return {
    ok: !!(r && r.ok),
    release: async () => {
      // a hand drifts a little while it holds; release where it is
      const dx = Math.round((rng() - 0.5) * 3), dy = Math.round((rng() - 0.5) * 3);
      await bg('trusted', { gesture: { steps: [{ t: 0, type: 'move', x: x + dx, y: y + dy, buttons: 1 },
        { t: 0.05, type: 'up', x: x + dx, y: y + dy, buttons: 0 }] }, frameUrl: location.href });
    },
  };
}

export const trustedOn = () => trusted;

/** Type into a field one key at a time (textcap.type_text timings). The field is clicked first. */
export async function typeInto(field: HTMLInputElement, text: string) {
  await click(field);
  await sleep(0.2 + rng() * 0.3);
  if (document.activeElement !== field) field.focus();
  const plan = planTyping(text, rng);
  if (trusted) {
    const r = await bg<{ ok: boolean }>('trustedKeys', { keys: Array.from(text), plan });
    if (r && r.ok) return;
  }
  for (const [i, ch] of Array.from(text).entries()) {
    const k = { key: ch, bubbles: true, cancelable: true, composed: true };
    field.dispatchEvent(new KeyboardEvent('keydown', k));
    const ok = document.execCommand('insertText', false, ch);
    if (!ok) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(field, field.value + ch);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    }
    await sleep(plan[i][0]);
    field.dispatchEvent(new KeyboardEvent('keyup', k));
    await sleep(plan[i][1]);
  }
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function pressEnter(field: HTMLInputElement) {
  const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit;
  field.dispatchEvent(new KeyboardEvent('keydown', k));
  field.dispatchEvent(new KeyboardEvent('keypress', k));
  field.dispatchEvent(new KeyboardEvent('keyup', k));
  field.form?.requestSubmit?.();
}

export async function idle(lo: number, hi: number) {
  await sleep(lo + (hi - lo) * rng());
}
