// Detection, on fixture pages (test/fixtures): every listed way a captcha is recognised finds its captcha, and
// ordinary pages (forms, an article about captchas, lookalike class names) are left alone. Provider widgets are
// recognised by the address of their own frame, so those fixtures are addresses. The same fixture pages are
// opened in real browsers by test/e2e.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { load } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = (name, url = 'https://shop.example/page') => new JSDOM(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'), { url });

// the content modules read these globals when they load
const boot = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://shop.example/' });
for (const k of ['window', 'document', 'location', 'HTMLImageElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLCanvasElement',
  'HTMLElement', 'Element', 'getComputedStyle', 'CSS']) {
  Object.defineProperty(globalThis, k, { value: boot.window[k], configurable: true, writable: true });
}
globalThis.top = globalThis.window;

const T = await load('src/content/textcap.ts');
const S = await load('src/lib/selector.ts');
const RC = await load('src/content/recaptcha.ts');
const HC = await load('src/content/hcaptcha.ts');
const TS = await load('src/content/turnstile.ts');
const DD = await load('src/content/datadome.ts');
const O = await load('src/lib/origin.ts');

const POSITIVE = ['text-basic.html', 'text-field-hint.html'];
const NEGATIVE = ['plain-login.html', 'article-about-captchas.html', 'checkout-form.html', 'svg-captcha-logo.html', 'fake-widgets.html',
  'heavy.html', 'blank.html', 'text-unmarked.html'];

test('picture text: found on pages that have one (the picture says captcha, or its field does)', () => {
  for (const f of POSITIVE) {
    const parts = T.captchaParts(page(f).window.document);
    assert.ok(parts, f);
    assert.equal(parts[0].tagName, 'IMG', f);
    assert.equal(parts[1].tagName, 'INPUT', f);
  }
  // a field that says captcha, with an inline (data:) picture
  const d = page('text-inline.html').window.document;
  d.getElementById('pic').setAttribute('src', 'data:image/png;base64,AAAA');
  assert.equal(T.captchaParts(d)[1].id, 'captcha_code');
});

test('picture text: nothing on ordinary pages, pages about captchas, lookalikes, an .svg logo', () => {
  for (const f of NEGATIVE) assert.equal(T.captchaParts(page(f).window.document), null, f);
});

test('a picture the person marked is found by its remembered selectors, and only while both are on the page', () => {
  const d = page('text-unmarked.html').window.document;
  assert.equal(T.captchaParts(d), null, 'the detector alone does not find it');
  const img = d.querySelector('img'), input = d.querySelector('input');
  const custom = { img: S.selectorFor(img), input: S.selectorFor(input) };
  assert.deepEqual(custom, { img: 'img.vpic', input: '#v' });
  const parts = T.captchaParts(d, custom);
  assert.equal(parts[0], img);
  assert.equal(parts[1], input);
  assert.equal(T.customParts(custom, page('plain-login.html').window.document), null);
  assert.equal(T.customParts({ img: 'img[[[', input: '#v' }, d), null, 'a broken selector is ignored');
  assert.equal(T.customParts({ img: '#v', input: '#v' }, d), null, 'the picture must be a picture');
});

test('selectors: a stable id, else a name, else a short path; never a generated id; always exactly one match', () => {
  const dom = new JSDOM(`<body><form id="login"><div><img src="a.png"><img src="b.png"></div>
    <input id="f_8f3a9c2b1d4e5f60a1b2" name="code"><input name="q"><input id="ok">
    <p><input class="a"><input class="a"></p></form></body>`);
  const d = dom.window.document;
  const q = (s) => d.querySelector(s);
  assert.equal(S.selectorFor(q('#ok')), '#ok');
  assert.equal(S.selectorFor(q('[name=code]')), 'input[name="code"]', 'a hash-like id is not kept');
  assert.equal(S.selectorFor(q('[name=q]')), 'input[name="q"]');
  const second = d.querySelectorAll('img')[1];
  const sel = S.selectorFor(second);
  assert.equal(sel, '#login > div > img:nth-of-type(2)');
  assert.equal(d.querySelectorAll(sel).length, 1);
  assert.equal(d.querySelector(sel), second);
  const twin = d.querySelectorAll('input.a')[1];
  assert.equal(d.querySelector(S.selectorFor(twin)), twin);
});

test('provider widgets are recognised by their own frame address: positives', () => {
  assert.ok(RC.isAnchor('https://www.google.com/recaptcha/api2/anchor?ar=1&k=6Le'));
  assert.ok(RC.isAnchor('https://www.recaptcha.net/recaptcha/enterprise/anchor?k=x'));
  assert.ok(RC.isBframe('https://www.google.com/recaptcha/api2/bframe?hl=en'));
  assert.ok(HC.isHcFrame('https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=1'));
  assert.ok(HC.isHcFrame('https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=1'));
  assert.ok(TS.isTurnstileFrame('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x/0x4AAA/dark/fbE/new/normal/auto/'));
  assert.ok(DD.isDataDomeFrame('https://geo.captcha-delivery.com/captcha/?initialCid=x'));
  assert.ok(TS.checkPageTitle('Just a moment...'));
  assert.ok(O.providerScripts('geetest', ['https://static.geetest.com/v4/gt4.js']));
  assert.ok(O.providerScripts('awswaf', ['https://abc.token.awswaf.com/abc/challenge.js']));
});

test('provider widgets: lookalike addresses and pages are not taken for one', () => {
  const no = [
    'https://shop.example/recaptcha/api2/anchor?k=x',                  // the path on another site
    'http://www.google.com/recaptcha/api2/anchor?k=x',                 // not https
    'https://www.google.com.evil.example/recaptcha/api2/anchor',
    'https://shop.example/?u=https://www.google.com/recaptcha/api2/anchor',
    'https://www.google.com/search?q=recaptcha',
  ];
  for (const u of no) {
    assert.equal(O.providerFrame('recaptcha', u), false, u);
  }
  assert.equal(HC.isHcFrame('https://www.hcaptcha.com/pricing'), false, 'the provider\'s own site is not a widget');
  assert.equal(HC.isHcFrame('https://hcaptcha.com.evil.example/x#frame=checkbox'), false);
  assert.equal(TS.isTurnstileFrame('https://www.cloudflare.com/turnstile/'), false);
  assert.equal(TS.isTurnstileFrame('https://shop.example/blank.html?challenges.cloudflare.com'), false);
  assert.equal(DD.isDataDomeFrame('https://shop.example/blank.html?captcha-delivery.com/captcha/'), false);
  assert.equal(DD.isDataDomeFrame('https://datadome.co/captcha/'), false);
  assert.equal(TS.checkPageTitle('How CAPTCHAs work'), false);
  assert.equal(O.providerScripts('geetest', ['https://shop.example/js/geetest.js', 'https://cdn.example/static.geetest.com/gt.js']), false);
  assert.equal(O.providerScripts('awswaf', ['https://shop.example/awswaf.com.js']), false);
});

test('captchas that are known but not solved are named only when their own frame or element is on the page', async () => {
  const run = async (html, url = 'https://shop.example/') => {
    const dom = new JSDOM(html, { url });
    for (const k of ['document', 'location']) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
    const U = await load('src/content/unsupported.ts');
    return U.unsupportedHere();
  };
  assert.deepEqual(await run('<iframe src="https://client-api.arkoselabs.com/fc/gc/"></iframe>'), ['Arkose']);
  assert.deepEqual(await run('<div class="frc-captcha"></div>'), ['Friendly Captcha']);
  assert.deepEqual(await run(fs.readFileSync(path.join(here, 'fixtures/article-about-captchas.html'), 'utf8')), []);
  assert.deepEqual(await run(fs.readFileSync(path.join(here, 'fixtures/plain-login.html'), 'utf8')), []);
});
