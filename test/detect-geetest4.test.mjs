// GeeTest v4's other puzzles (0.3.0): the panel's kind is read from the widget's own classes, but a solve that
// costs credits starts by itself only when the page loaded GeeTest's own scripts (origin.ts); a page that copies
// the class names, an article about GeeTest and ordinary pages are left alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { load } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = (name) => new JSDOM(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'), { url: 'https://shop.example/page' });
const boot = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://shop.example/' });
for (const k of ['window', 'document', 'location', 'HTMLElement', 'Element', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: boot.window[k], configurable: true, writable: true });
}

const G4 = await load('src/content/geetest4.ts');
const O = await load('src/lib/origin.ts');
const C = await load('src/lib/config.ts');
const G = await load('src/lib/guard.ts');

const panel = (cls, inner = '') => new JSDOM(`<div class="geetest_box"><div class="geetest_subitem_ab12 geetest_subitem ${cls}">${inner}</div></div>`).window.document;

test('the v4 panel kind from its classes (the panel is in the page before the button is clicked)', () => {
  assert.equal(G4.panelKind(panel('geetest_match')), 'gt4match');
  assert.equal(G4.panelKind(panel('geetest_winlinze')), 'gt4gobang');
  assert.equal(G4.panelKind(panel('geetest_nine')), 'gt4nine');
  assert.equal(G4.panelKind(panel('geetest_svg')), 'gt4svg');
  assert.equal(G4.panelKind(panel('geetest_slide')), 'geetest');
  assert.equal(G4.panelKind(panel('geetest_click', '<div class="geetest_bg" style="background-image:url(https://static.geetest.com/x/icon/1/a.jpg)"></div>')), 'gt4icon');
  // the Chinese-only word and phrase puzzles are not solved here
  assert.equal(G4.panelKind(panel('geetest_click', '<div class="geetest_bg" style="background-image:url(https://static.geetest.com/x/word/1/a.jpg)"></div>')), 'other');
  // a hashed class alone is not the kind
  assert.equal(G4.panelKind(panel('geetest_match_ab12')), 'other');
});

test('ordinary pages and an article about GeeTest hold no panel', () => {
  for (const f of ['geetest4-article.html', 'plain-login.html', 'article-about-captchas.html', 'checkout-form.html', 'heavy.html', 'blank.html']) {
    assert.equal(G4.panelKind(page(f).window.document), '', f);
  }
});

test('a page that copies the class names: read as a panel, but nothing starts by itself (no GeeTest script)', () => {
  const doc = page('geetest4-lookalike.html').window.document;
  assert.equal(G4.panelKind(doc), 'gt4match');
  const scripts = Array.from(doc.scripts).map((s) => s.src);
  for (const k of ['gt4match', 'gt4gobang', 'gt4icon', 'gt4nine', 'gt4svg']) {
    assert.equal(O.providerScripts(k, scripts), false, k);
    assert.equal(O.providerScripts(k, ['https://static.geetest.com/v4/gt4.js']), true, k);
    assert.equal(O.providerScripts(k, ['https://static.geetest.com.example/v4/gt4.js', 'https://cdn.example/static.geetest.com/gt4.js']), false, k);
    const g = new G.Guard(() => 1000);
    const cfg = { ...C.DEFAULTS, apiKey: 'agt_live_x', types: { ...C.DEFAULTS.types, [k]: true } };
    assert.deepEqual(g.decide(cfg, { kind: k, why: 'auto', host: 'shop.example', tabId: 1, verified: false }), { ok: false, reason: 'unverified' }, k);
    assert.deepEqual(g.decide(cfg, { kind: k, why: 'auto', host: 'shop.example', tabId: 1, verified: true }), { ok: true }, k);
  }
});

test('pictures are fetched only from GeeTest\'s own static hosts, for these kinds', () => {
  for (const k of ['gt4match', 'gt4gobang', 'gt4icon', 'gt4nine', 'gt4svg']) {
    assert.ok(O.fileAllowed(k, 'https://static.geetest.com/captcha_v4/policy/x/nine/1/a.jpg'), k);
    assert.equal(O.fileAllowed(k, 'http://static.geetest.com/a.jpg'), false, k);
    assert.equal(O.fileAllowed(k, 'https://static.geetest.com.evil.example/a.jpg'), false, k);
    assert.equal(O.fileAllowed(k, 'https://shop.example/a.jpg'), false, k);
  }
});

test('the challenge key changes with the pictures', () => {
  const a = panel('geetest_click', '<div class="geetest_bg" style="background-image:url(https://static.geetest.com/x/icon/1/a.jpg)"></div>');
  const b = panel('geetest_click', '<div class="geetest_bg" style="background-image:url(https://static.geetest.com/x/icon/1/b.jpg)"></div>');
  assert.notEqual(G4.challengeKey(a), G4.challengeKey(b));
  assert.equal(G4.challengeKey(page('blank.html').window.document), '');
});
