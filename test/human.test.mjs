// The motion model keeps the numbers of Browsa's server-side solver (moves, slides, typing).
//   npm test          (Node 23.6+ runs the TypeScript source directly)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clickPoint, fittsDuration, holdTime, minJerk, planMove, planSlide, planTyping } from '../src/lib/human.ts';

function seeded(seed) {           // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('minimum-jerk position goes 0 to 1 with zero speed at both ends', () => {
  assert.equal(minJerk(0), 0);
  assert.equal(minJerk(1), 1);
  assert.ok(Math.abs(minJerk(0.5) - 0.5) < 1e-9);
  assert.ok(minJerk(0.01) < 0.0001 && 1 - minJerk(0.99) < 0.0001);
});

test('Fitts duration stays within 0.15 to 0.9 s and grows with distance', () => {
  const rng = seeded(1);
  for (let i = 0; i < 200; i++) {
    const d = fittsDuration(rng() * 2000, 4 + rng() * 100, rng);
    assert.ok(d >= 0.15 && d <= 0.9, String(d));
  }
  let near = 0, far = 0;
  for (let i = 0; i < 200; i++) { near += fittsDuration(30, 40, seeded(i)); far += fittsDuration(900, 40, seeded(i)); }
  assert.ok(far > near * 1.5);
});

test('a move ends exactly on the target, in time order, 8-16 ms apart, inside the viewport', () => {
  for (let s = 0; s < 50; s++) {
    const rng = seeded(s);
    const steps = planMove([5, 700], [903.4, 120.6], 40, rng, [1280, 800]);
    const end = steps[steps.length - 1];
    assert.deepEqual([end.x, end.y], [903, 121]);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i].t > steps[i - 1].t);
      assert.ok(steps[i].x >= 0 && steps[i].x < 1280 && steps[i].y >= 0 && steps[i].y < 800);
    }
    const gaps = steps.slice(1, -2).map((p, i) => p.t - steps[i].t);
    assert.ok(gaps.every((g) => g >= 0.008 - 1e-9), 'event gap');
    assert.ok(end.t >= 0.15 && end.t <= 0.9);
  }
});

test('a path is bowed, not straight', () => {
  const steps = planMove([0, 0], [600, 0], 40, seeded(7), [1280, 800]);
  const maxOff = Math.max(...steps.map((p) => Math.abs(p.y)));
  assert.ok(maxOff >= 3, `max off-line ${maxOff}`);
});

test('click points stay inside the box margin and vary', () => {
  const rng = seeded(3);
  const pts = new Set();
  for (let i = 0; i < 100; i++) {
    const [x, y] = clickPoint([100, 200, 80, 40], rng);
    assert.ok(x >= 112 && x <= 168 && y >= 206 && y <= 234, `${x},${y}`);
    pts.add(`${x},${y}`);
  }
  assert.ok(pts.size > 20);
});

test('hold time 50-140 ms', () => {
  const rng = seeded(4);
  for (let i = 0; i < 200; i++) { const h = holdTime(rng); assert.ok(h >= 0.05 && h <= 0.14); }
});

test('GeeTest slide: ends on the distance after a 2-6 px overshoot, wobble within 3 px, the engine timing', () => {
  for (let s = 0; s < 50; s++) {
    const rng = seeded(100 + s);
    const p = planSlide([10, 10], [200, 400], 157, rng, [1280, 800]);
    const end = p.drag[p.drag.length - 1];
    assert.ok(Math.abs(end.x - (200 + 157)) < 0.75, `end ${end.x}`);
    const peak = Math.max(...p.drag.map((d) => d.x)) - 200;
    assert.ok(peak >= 157 + 2 - 1e-9 && peak <= 157 + 6 + 1e-9, `overshoot ${peak - 157}`);
    assert.ok(p.drag.every((d) => Math.abs(d.y - 400) <= 3.4));
    assert.ok(p.drag.length >= 18 + 4);
    const dur = end.t;
    assert.ok(dur > 0.55 * 0.7 && dur < (0.95 + 163 / 600) * 1.3 + 0.2 + 8 * 0.05, `duration ${dur}`);
    assert.ok(p.pressAfter >= 0.12 && p.pressAfter <= 0.3 && p.releaseAfter >= 0.15 && p.releaseAfter <= 0.4);
  }
});

test('short slides do not overshoot', () => {
  const p = planSlide([0, 0], [50, 50], 20, seeded(9));
  assert.equal(Math.max(...p.drag.map((d) => d.x)), 70);
});

test('typing: 30-80 ms held, 60-220 ms between keys', () => {
  const plan = planTyping('x7Kp2', seeded(5));
  assert.equal(plan.length, 5);
  for (const [hold, gap] of plan) {
    assert.ok(hold >= 0.03 && hold <= 0.08);
    assert.ok(gap >= 0.06 && gap <= 0.22);
  }
});
