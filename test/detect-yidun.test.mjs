// NetEase Yidun and Cutcaptcha (0.3.0): the widgets are found by their own markup, and a solve that costs credits
// runs by itself only when the page loaded the vendor's own scripts. Ordinary pages, pages that merely mention the
// vendors and lookalike class names without the vendor's scripts are left alone.
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

const Y = await load('src/content/yidun.ts');
const C = await load('src/content/cutcaptcha.ts');
const O = await load('src/lib/origin.ts');
const ORDINARY = ['plain-login.html', 'article-about-captchas.html', 'checkout-form.html', 'svg-captcha-logo.html', 'fake-widgets.html',
  'heavy.html', 'blank.html', 'text-unmarked.html'];

test('Yidun and Cutcaptcha: nothing on ordinary pages', () => {
  for (const f of ORDINARY) {
    const doc = page(f).window.document;
    assert.deepEqual(Y.roots(doc), [], f);
    assert.equal(C.host(doc), null, f);
  }
});

test('Yidun: the widget and its puzzle by its modifier', () => {
  const d = new JSDOM('<div class="yidun yidun--float yidun--jigsaw"></div><div class="yidun yidun--inference yidun--success"></div>'
    + '<div class="yidun yidun--icon_point"></div><div class="yidun yidun--sms"></div><div class="yidun_tips"></div>').window.document;
  const rs = Y.roots(d);
  assert.equal(rs.length, 4);
  assert.deepEqual(rs.map((r) => Y.kindOf(r)), ['ydslide', 'ydinference', 'ydicon', '']);
  assert.equal(Y.passed(rs[1]), true);
});

test('a page that only mentions the vendors or copies their class names is not taken for their widget', () => {
  const doc = page('yidun-lookalike.html').window.document;
  // the markup is there, so the Solve button could name it, but nothing was loaded from the vendors' hosts
  assert.equal(Y.roots(doc).length, 1);
  assert.equal(C.host(doc), null, 'a site key that is not one of the vendor\'s (cc_...)');
  const scripts = Array.from(doc.scripts).map((s) => s.src);
  for (const k of ['ydslide', 'ydinference', 'ydicon', 'cutcaptcha']) assert.equal(O.providerScripts(k, scripts), false, k);
});

test('the vendors\' own hosts: scripts verified, files fetched only from them', () => {
  assert.ok(O.providerScripts('ydslide', ['https://cstaticdun.126.net/load.min.js']));
  assert.ok(O.providerScripts('ydicon', ['https://cstaticdun.126.net/2.28.5/core-optimi.m25b40.v2.28.5.min.js']));
  assert.ok(O.providerScripts('cutcaptcha', ['https://api.cutcaptcha.net/v1/api.js']));
  assert.equal(O.providerScripts('ydslide', ['https://cstaticdun.126.net.evil.example/load.min.js']), false);
  assert.equal(O.providerScripts('cutcaptcha', ['https://cutcaptcha.net.evil.example/api.js']), false);
  assert.ok(O.fileAllowed('ydslide', 'https://necaptcha.nosdn.127.net/662c2f424f9a4a639e7ca50637adddf9.jpg'));
  assert.ok(O.fileAllowed('ydinference', 'https://necaptcha-nosdn.126.net/662c2f424f9a4a639e7ca50637adddf9.jpg'));
  assert.equal(O.fileAllowed('ydslide', 'http://necaptcha.nosdn.127.net/a.jpg'), false);
  assert.equal(O.fileAllowed('ydslide', 'https://shop.example/necaptcha.nosdn.127.net/a.jpg'), false);
  assert.equal(O.fileAllowed('cutcaptcha', 'https://api.cutcaptcha.net/a.png'), false, 'Cutcaptcha\'s pictures are in the page itself');
});

test('Cutcaptcha: the host is found only with one of the vendor\'s site keys', () => {
  const d = new JSDOM('<div class="cutcaptcha" data-sitekey="cc_UpzvoVj4baSUmVWsiIkiOmTi"><input type="hidden" name="cutcaptcha-response"><div></div></div>').window.document;
  assert.ok(C.host(d));
  assert.equal(C.checked(C.host(d)), false);
});
