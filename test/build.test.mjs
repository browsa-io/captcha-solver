// The packages: manifests per target, no remote code, the automation result signal, the key from the environment.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from './load.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = (args, env = {}) => {
  const out = 't-' + Math.random().toString(36).slice(2);
  execFileSync('node', ['scripts/build.mjs', `--out=${out}`, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: 'pipe' });
  const dir = path.join(root, 'dist', out);
  return { dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

test('Chrome store build: version, short name, debugger only optional', () => {
  const b = build([]);
  try {
    assert.equal(b.manifest.version, pkg.version);
    assert.equal(b.manifest.short_name, 'Browsa Solver');
    assert.deepEqual(b.manifest.permissions, ['storage']);
    assert.deepEqual(b.manifest.optional_permissions, ['debugger', 'webNavigation']);
    assert.equal(b.manifest.background.service_worker, 'background.js');
    const js = fs.readFileSync(path.join(b.dir, 'content.js'), 'utf8');
    assert.ok(!/data-browsa-captcha/.test(js.replace(/\/\/.*$/gm, '')) || /IS_AUTOMATION|false/.test(js), 'store build');
    for (const f of ['background.js', 'content.js', 'popup.js']) {
      const s = fs.readFileSync(path.join(b.dir, f), 'utf8');
      assert.ok(!/\beval\(|new Function\(|importScripts\(/.test(s), `${f}: no remote or generated code`);
      assert.ok(!/Chromium/.test(fs.readFileSync(path.join(b.dir, 'popup.html'), 'utf8')), 'no browser engine name in the panel');
    }
  } finally { b.done(); }
});

test('Firefox build: event page, gecko id, no debugger anywhere', () => {
  const b = build(['--target=firefox']);
  try {
    assert.deepEqual(b.manifest.background, { scripts: ['background.js'] });
    assert.equal(b.manifest.browser_specific_settings.gecko.id, 'captcha-solver@browsa.io');
    assert.equal(b.manifest.browser_specific_settings.gecko.strict_min_version, '121.0');
    assert.ok(!JSON.stringify(b.manifest).includes('debugger'));
    assert.equal(b.manifest.minimum_chrome_version, undefined);
  } finally { b.done(); }
});

test('automation build: the key comes from BROWSA_API_KEY, never needs to be in a committed file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-'));
  const conf = path.join(tmp, 'automation.json');
  fs.writeFileSync(conf, JSON.stringify({ enabled: true, auto: true }));
  const b = build([`--automation=${conf}`], { BROWSA_API_KEY: 'agt_live_from_env' });
  try {
    const a = JSON.parse(fs.readFileSync(path.join(b.dir, 'automation.json'), 'utf8'));
    assert.equal(a.apiKey, 'agt_live_from_env');
    assert.ok(b.manifest.permissions.includes('debugger'));
    assert.match(b.manifest.name, /automation/);
  } finally { b.done(); fs.rmSync(tmp, { recursive: true }); }
});

test('automation result signal: <html data-browsa-captcha> and a browsa-captcha event; never in the store build', async () => {
  const fake = () => {
    const doc = new EventTarget();
    doc.documentElement = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    globalThis.document = doc;
    globalThis.window = globalThis;
    globalThis.top = globalThis;
    return doc;
  };
  const doc = fake();
  const auto = await load('src/content/notice.ts', { automation: true });
  const seen = [];
  doc.addEventListener('browsa-captcha', (e) => seen.push(e.detail));
  auto.writeSignal('failed', 'text', 'error_key_denied_access');
  assert.equal(doc.documentElement.attrs['data-browsa-captcha'], 'failed:text:error_key_denied_access');
  auto.writeSignal('solved', 'recaptcha');
  assert.equal(doc.documentElement.attrs['data-browsa-captcha'], 'solved:recaptcha');
  assert.deepEqual(seen.map((s) => s.state), ['failed', 'solved']);
  const doc2 = fake();
  const store = await load('src/content/notice.ts', { automation: false });
  store.writeSignal('solved', 'recaptcha');
  assert.equal(doc2.documentElement.attrs['data-browsa-captcha'], undefined);
});
