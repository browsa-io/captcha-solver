// Tencent and Dingxiang (0.3.0): ordinary pages, an article about them and a page that copies their widgets' markup
// with no provider script are never solved on their own. The markup alone is not enough (a page can write it):
// an automatic solve needs the provider's own script (origin.ts), and the solve reads only what is on screen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { load } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = (name, url = 'https://shop.example/page') => new JSDOM(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'), { url });
const boot = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://shop.example/' });
for (const k of ['window', 'document', 'location', 'HTMLImageElement', 'HTMLInputElement', 'HTMLElement', 'Element', 'getComputedStyle', 'CSS']) {
  Object.defineProperty(globalThis, k, { value: boot.window[k], configurable: true, writable: true });
}

const TC = await load('src/content/tencent.ts');
const DX = await load('src/content/dingxiang.ts');
const O = await load('src/lib/origin.ts');
const IS = await load('src/lib/imgsize.ts');

const ORDINARY = ['plain-login.html', 'article-about-captchas.html', 'checkout-form.html', 'svg-captcha-logo.html', 'fake-widgets.html',
  'heavy.html', 'blank.html', 'text-unmarked.html'];

test('Tencent and Dingxiang: nothing on ordinary pages', () => {
  for (const f of ORDINARY) {
    const doc = page(f).window.document;
    assert.equal(TC.panelKind(doc), '', f);
    assert.equal(TC.panelOpen(doc), false, f);
    assert.equal(DX.active(doc), null, f);
  }
});

test('Tencent and Dingxiang: a page that writes their markup and mentions them is not theirs', () => {
  const doc = page('tencent-dingxiang-lookalike.html').window.document;
  // the copied markup reads as that kind of panel, but nothing of it is on screen (no layout), so nothing is open
  assert.equal(TC.panelKind(doc), 'tcslide');
  assert.equal(TC.panelOpen(doc), false);
  assert.equal(DX.active(doc), null);
  // and its scripts are not the providers': no automatic solve that costs credits
  const names = Array.from(doc.scripts).map((s) => s.src);
  assert.equal(O.providerScripts('tcslide', names), false);
  assert.equal(O.providerScripts('tcclick', names), false);
  assert.equal(O.providerScripts('dxrotate', names), false);
});

test('provider scripts and files: Tencent and Dingxiang hosts only', () => {
  assert.ok(O.providerScripts('tcslide', ['https://turing.captcha.qcloud.com/TJCaptcha.js']));
  assert.ok(O.providerScripts('tcclick', ['https://turing.captcha.gtimg.com/1/tgJCap.2f0b2c65.js']));
  assert.ok(O.providerScripts('dxrotate', ['https://cdn.dingxiang-inc.com/ctu-group/captcha-ui/v5/index.js']));
  assert.equal(O.providerScripts('tcslide', ['https://captcha.qcloud.com.shop.example/TJCaptcha.js']), false);
  assert.equal(O.providerScripts('dxrotate', ['https://dingxiang-inc.com.shop.example/index.js']), false);
  assert.ok(O.fileAllowed('tcslide', 'https://turing.captcha.qcloud.com/cap_union_new_getcapbysig?img_index=1&image=02'));
  assert.ok(O.fileAllowed('dxrotate', 'https://static4.dingxiang-inc.com/picture/dx/a/b/c.webp'));
  assert.equal(O.fileAllowed('tcslide', 'https://static4.dingxiang-inc.com/picture/dx/a/b/c.webp'), false);
  assert.equal(O.fileAllowed('dxrotate', 'http://static4.dingxiang-inc.com/picture/dx/a.webp'), false);
  assert.equal(O.fileAllowed('dxrotate', 'https://shop.example/dingxiang-inc.com/a.webp'), false);
});

test('picture sizes from the header (the API answers in picture pixels)', () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(672, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(IS.imageSize(png.toString('base64')), [672, 480]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0xa0, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(IS.imageSize(jpg.toString('base64')), [672, 480]);
  assert.equal(IS.imageSize(Buffer.from('not a picture at all').toString('base64')), null);
});
