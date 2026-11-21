// What may start a solve: settings, the site's yes for picture text, provider origin, limits, the pause after a
// typed answer, and pictures already solved (src/lib/guard.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from './load.mjs';

const G = await load('src/lib/guard.ts');
const C = await load('src/lib/config.ts');

const cfg = (over = {}) => C.merge(C.DEFAULTS, { apiKey: 'agt_live_x', ...over });
const clock = () => { let t = 1_000_000; const f = () => t; f.add = (ms) => { t += ms; }; return f; };
const ask = (o) => ({ kind: 'recaptcha', why: 'auto', host: 'shop.example', tabId: 7, verified: true, ...o });

test('settings come first: off, no key, skipped site, type off, needs trusted input', () => {
  const g = new G.Guard();
  assert.deepEqual(g.decide(cfg({ enabled: false }), ask({})), { ok: false, reason: 'off' });
  assert.deepEqual(g.decide(C.merge(C.DEFAULTS, {}), ask({})), { ok: false, reason: 'no_key' });
  assert.deepEqual(g.decide(cfg({ skip: ['hop.example'] }), ask({ host: 'shop.example' })).ok, true, 'skip matches whole labels only');
  assert.deepEqual(g.decide(cfg({ skip: ['shop.example'] }), ask({ host: 'a.shop.example' })), { ok: false, reason: 'site_off' });
  assert.deepEqual(g.decide(cfg({ skip: ['shop.example'] }), ask({ why: 'button' })), { ok: false, reason: 'site_off' },
    'the Solve button on a skipped site says so (not a failure)');
  assert.deepEqual(g.decide(cfg(), ask({ kind: 'hcaptcha' })), { ok: false, reason: 'unsupported' }, 'unlisted types ship off and read as not supported');
  assert.deepEqual(g.decide(cfg({ types: { geetest: false } }), ask({ kind: 'geetest' })), { ok: false, reason: 'type_off' }, 'a listed type switched off');
  assert.deepEqual(g.decide(cfg({ types: { presshold: true } }), ask({ kind: 'presshold' })), { ok: false, reason: 'needs_trusted' });
  assert.equal(g.decide(cfg({ types: { presshold: true }, trustedInput: true }), ask({ kind: 'presshold' })).ok, true);
});

test('picture text: never automatic on a site the person did not allow; the Solve button always works', () => {
  const g = new G.Guard();
  const t = ask({ kind: 'text', verified: false, sig: 'aa' });
  assert.deepEqual(g.decide(cfg(), t), { ok: false, reason: 'ask_site' });
  assert.deepEqual(g.decide(cfg({ textNo: ['shop.example'] }), t), { ok: false, reason: 'text_no' });
  assert.equal(g.decide(cfg(), { ...t, why: 'button' }).ok, true);
  assert.equal(g.decide(cfg({ textSites: ['shop.example'] }), t).ok, true);
});

test('provider widgets: automatic only when the origin was verified; free kinds need no check', () => {
  const g = new G.Guard();
  assert.deepEqual(g.decide(cfg(), ask({ kind: 'geetest', verified: false })), { ok: false, reason: 'unverified' });
  assert.equal(g.decide(cfg(), ask({ kind: 'geetest', verified: false, why: 'button' })).ok, true);
  assert.equal(g.decide(cfg(), ask({ kind: 'geetest', verified: true })).ok, true);
  assert.equal(g.decide(cfg({ types: { turnstile: true } }), ask({ kind: 'turnstile', verified: false })).ok, true);
});

test('limits: 3 automatic solves per page load, 10 per site per hour, the button goes past both', () => {
  const now = clock();
  const g = new G.Guard(now);
  for (let i = 0; i < 3; i++) { assert.equal(g.decide(cfg(), ask({})).ok, true); g.charged(7, 'shop.example'); }
  assert.deepEqual(g.decide(cfg(), ask({})), { ok: false, reason: 'page_limit' });
  assert.equal(g.decide(cfg(), ask({ why: 'button' })).ok, true);
  g.newPage(7);
  assert.equal(g.decide(cfg(), ask({})).ok, true);
  for (let i = 0; i < 7; i++) { g.newPage(7); g.charged(7, 'shop.example'); }
  g.newPage(7);
  assert.deepEqual(g.decide(cfg(), ask({})), { ok: false, reason: 'site_limit' });
  assert.equal(g.decide(cfg(), ask({ host: 'other.example' })).ok, true, 'per site');
  now.add(G.SITE_WINDOW_MS + 1);
  assert.equal(g.decide(cfg(), ask({})).ok, true, 'the hour rolls');
  // free kinds are not counted or limited
  for (let i = 0; i < 20; i++) g.charged(7, 'shop.example');
  assert.equal(g.decide(cfg({ types: { altcha: true } }), ask({ kind: 'altcha' })).ok, true);
});

test('after a typed answer: 30 s pause for the next picture, longer after a submit; one picture never paid twice', () => {
  const now = clock();
  const g = new G.Guard(now);
  const c = cfg({ textSites: ['shop.example'] });
  const t = (sig, why = 'auto') => g.decide(c, ask({ kind: 'text', verified: false, sig, why }));
  assert.equal(t('p1').ok, true);
  g.charged(7, 'shop.example');
  g.typed(7, 'shop.example', 'p1', 'K7P2QX');
  assert.deepEqual(t('p2'), { ok: false, reason: 'cooldown' }, 'a refreshed picture right after submit waits');
  assert.equal(t('p2', 'button').ok, true, 'unless the person presses Solve');
  assert.deepEqual(t('p1'), { ok: false, reason: 'already_solved' });
  assert.deepEqual(t('p1', 'button'), { ok: true, answer: 'K7P2QX' }, 'the button types the remembered answer, no new call');
  now.add(25_000);
  g.submitted(7, 'shop.example');
  now.add(25_000);
  assert.deepEqual(t('p3'), { ok: false, reason: 'cooldown' }, 'the submit restarted the pause');
  now.add(6_000);
  assert.equal(t('p3').ok, true);
  assert.deepEqual(g.decide(c, ask({ kind: 'text', verified: false, sig: 'p3', tabId: 8 })).ok, true, 'per tab');
});

test('state survives a reload of the background (load)', () => {
  const g = new G.Guard();
  g.charged(7, 'a.example');
  const h = new G.Guard();
  h.load(JSON.parse(JSON.stringify(g.s)));
  assert.equal(h.s.page['7'], 1);
  h.load(undefined);
  assert.equal(h.s.page['7'], 1);
});
