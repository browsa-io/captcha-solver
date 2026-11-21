// How a hand moves, ported from Browsa's server-side solver so the extension keeps the timings that pass there:
//   planMove     Fitts's-law duration, minimum-jerk speed, bowed Bezier path, tremor, overshoot and correction
//                (with clickPoint and holdTime)
//   planSlide    the slider track GeeTest accepted (15 of 16 v3, 15 of 16 v4)
//   planTyping   key timing
// Pure planning: no DOM, no timers. Unit-tested in test/human.test.mjs.

export type Rng = () => number;
export type Point = [number, number];
export interface Step { t: number; x: number; y: number }     // seconds from the start of the gesture

export const MAX_MOVE_S = 0.9;
export const MIN_MOVE_S = 0.15;
export const EVENT_GAP_S: [number, number] = [0.008, 0.016];
const FITTS_A_S = 0.06;
const FITTS_B_S = 0.15;
const HOLD_S: [number, number] = [0.05, 0.14];
const OVERSHOOT_FROM_PX = 300;

export const uniform = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const randint = (rng: Rng, lo: number, hi: number) => Math.floor(uniform(rng, lo, hi + 1));
const clip = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function gauss(rng: Rng, mu = 0, sigma = 1): number {
  let u = 0;
  while (u === 0) u = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function lognormal(rng: Rng, median: number, sigma: number, lo: number, hi: number): number {
  return clip(median * Math.exp(gauss(rng, 0, sigma)), lo, hi);
}

export function fittsDuration(distance: number, width: number, rng: Rng): number {
  const w = Math.max(4, width || 0);
  const mt = FITTS_A_S + FITTS_B_S * Math.log2(Math.max(0, distance) / w + 1);
  return clip(mt * Math.exp(gauss(rng, 0, 0.12)), MIN_MOVE_S, MAX_MOVE_S);
}

export function minJerk(tau: number): number {
  return tau * tau * tau * (10 - 15 * tau + 6 * tau * tau);
}

/** The pointer positions of one move from `start` to `end`; the last step is `end` (whole pixels). */
export function planMove(start: Point, end: Point, targetW: number, rng: Rng, viewport?: Point): Step[] {
  const [sx, sy] = start;
  const ex = Math.round(end[0]);
  const ey = Math.round(end[1]);
  const inside = (x: number, y: number): Point => {
    x = Math.max(0, x);
    y = Math.max(0, y);
    if (viewport) {
      x = Math.min(x, viewport[0] - 1);
      y = Math.min(y, viewport[1] - 1);
    }
    return [Math.round(x), Math.round(y)];
  };
  const dist = Math.hypot(ex - sx, ey - sy);
  if (dist < 2) return [{ t: 0, x: ex, y: ey }];
  const duration = fittsDuration(dist, targetW, rng);
  const ux = (ex - sx) / dist;
  const uy = (ey - sy) / dist;
  const side = rng() < 0.5 ? -1 : 1;
  const segments: Array<[Point, Point, number, number]> = [];
  if (dist >= OVERSHOOT_FROM_PX && rng() < 0.6) {
    const beyond = Math.min(dist * uniform(rng, 0.02, 0.06), 18);
    const drift = beyond * uniform(rng, -0.4, 0.4);
    const [ox, oy] = inside(ex + ux * beyond - uy * drift, ey + uy * beyond + ux * drift);
    const correct = uniform(rng, 0.09, 0.17);
    segments.push([[sx, sy], [ox, oy], duration - correct, uniform(rng, 0.03, 0.1)]);
    segments.push([[ox, oy], [ex, ey], correct, 0]);
  } else {
    segments.push([[sx, sy], [ex, ey], duration, uniform(rng, 0.03, 0.1)]);
  }
  const steps: Step[] = [];
  let last = inside(sx, sy);
  let t0 = 0;
  for (const [[ax, ay], [bx, by], segS, bow] of segments) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const b1 = bow * len * side * uniform(rng, 0.6, 1.2);
    const b2 = bow * len * side * uniform(rng, 0.3, 0.9);
    const c1: Point = [ax + dx * 0.3 + px * b1, ay + dy * 0.3 + py * b1];
    const c2: Point = [ax + dx * 0.7 + px * b2, ay + dy * 0.7 + py * b2];
    let t = 0;
    for (;;) {
      t += uniform(rng, EVENT_GAP_S[0], EVENT_GAP_S[1]);
      if (t > segS - EVENT_GAP_S[0]) break;
      const u = minJerk(t / segS);
      const v = 1 - u;
      let x = v * v * v * ax + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * bx;
      let y = v * v * v * ay + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * by;
      x += clip(gauss(rng, 0, 0.4), -1.5, 1.5);
      y += clip(gauss(rng, 0, 0.4), -1.5, 1.5);
      const p = inside(x, y);
      if (p[0] !== last[0] || p[1] !== last[1]) {
        steps.push({ t: t0 + t, x: p[0], y: p[1] });
        last = p;
      }
    }
    t0 = Math.min(t0 + segS, duration);
    const endP = inside(bx, by);
    const isEnd = bx === ex && by === ey;
    if (endP[0] === last[0] && endP[1] === last[1] && steps.length && isEnd) steps.pop();
    if (endP[0] !== last[0] || endP[1] !== last[1] || isEnd) {
      steps.push({ t: t0, x: endP[0], y: endP[1] });
      last = endP;
    }
  }
  return steps;
}

/** Where a person clicks inside a box [x, y, w, h]: near the centre, never twice on the same pixel. */
export function clickPoint(box: [number, number, number, number], rng: Rng): Point {
  const [x, y, w, h] = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const mx = Math.max(2, w * 0.15);
  const my = Math.max(2, h * 0.15);
  const loX = x + mx, hiX = x + w - mx, loY = y + my, hiY = y + h - my;
  if (loX > hiX || loY > hiY) return [Math.round(cx), Math.round(cy)];
  const sx = Math.min(w * 0.12, 9);
  const sy = Math.min(h * 0.12, 5);
  const px = clip(cx + clip(gauss(rng, 0, sx), -2.2 * sx, 2.2 * sx), loX, hiX);
  const py = clip(cy + clip(gauss(rng, 0, sy), -2.2 * sy, 2.2 * sy), loY, hiY);
  return [clip(Math.round(px), Math.ceil(loX), Math.floor(hiX)), clip(Math.round(py), Math.ceil(loY), Math.floor(hiY))];
}

export const holdTime = (rng: Rng) => lognormal(rng, 0.085, 0.25, HOLD_S[0], HOLD_S[1]);
export const prePress = (rng: Rng) => uniform(rng, 0.07, 0.22);          // before the press
export const thinkTime = (rng: Rng, newPage = false) =>
  newPage ? lognormal(rng, 0.55, 0.35, 0.25, 1.2) : lognormal(rng, 0.22, 0.4, 0.08, 0.6);

export interface SlidePlan {
  approach: Step[];        // to the knob, buttons up
  pressAfter: number;      // pause on the knob before the press
  holdBefore: number;      // pause after the press, before moving
  drag: Step[];            // buttons down; relative times from the first drag step
  releaseAfter: number;    // pause at the end before the release
}

/** GeeTest slide: press the knob, slide `dist` px right like a hand (fast start, slow finish, a small
 * overshoot over 30 px that settles back, a little vertical wobble), release. */
export function planSlide(from: Point, knob: Point, dist: number, rng: Rng, viewport?: Point): SlidePlan {
  const [sx, sy] = knob;
  const approach = planMove(from, knob, 30, rng, viewport);
  const pressAfter = uniform(rng, 0.12, 0.3);
  const holdBefore = uniform(rng, 0.08, 0.2);
  const over = dist > 30 ? uniform(rng, 2, 6) : 0;
  const target = dist + over;
  const n = Math.max(18, Math.floor(target / 4) + randint(rng, 0, 8));
  const total = uniform(rng, 0.55, 0.95) + target / 600;
  const drag: Step[] = [];
  let y = sy;
  let t = 0;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const p = u < 0.7 ? 1 - (1 - u) ** 3 : 1 - (1 - u) ** 2.2;
    y = clip(y + uniform(rng, -0.6, 0.6), sy - 3, sy + 3);
    drag.push({ t, x: sx + target * p, y });
    t += (total / n) * uniform(rng, 0.7, 1.3);
  }
  if (over) {
    t += uniform(rng, 0.08, 0.2);
    const m = randint(rng, 4, 8);
    for (let i = 1; i <= m; i++) {
      drag.push({ t, x: sx + target - (over * i) / m, y: y + uniform(rng, -0.4, 0.4) });
      t += uniform(rng, 0.02, 0.05);
    }
  }
  return { approach, pressAfter, holdBefore, drag, releaseAfter: uniform(rng, 0.15, 0.4) };
}

/** textcap.type_text: [key down -> key up, key up -> next key down] in seconds, per character. */
export function planTyping(text: string, rng: Rng): Array<[number, number]> {
  return Array.from(text).map(() => [uniform(rng, 0.03, 0.08), uniform(rng, 0.06, 0.22)]);
}

/** A point on the edge of a w x h frame where the pointer comes in from (a frame's first move starts there). */
export function entryPoint(w: number, h: number, rng: Rng): Point {
  const side = randint(rng, 0, 3);
  if (side === 0) return [0, uniform(rng, 0, h - 1)];
  if (side === 1) return [w - 1, uniform(rng, 0, h - 1)];
  if (side === 2) return [uniform(rng, 0, w - 1), h - 1];
  return [uniform(rng, 0, w - 1), 0];
}
