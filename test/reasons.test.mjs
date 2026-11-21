// Every way a solve ends without a pass has a plain line (never a raw code), and the fix is linked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from './load.mjs';

const R = await load('src/lib/reasons.ts');
const O = await load('src/lib/origin.ts');
const C = await load('src/lib/config.ts');

const ALL = ['unsupported', 'error_task_not_supported', 'no_key', 'error_key_denied_access', 'error_zero_balance',
  'error_budget_exceeded', 'error_key_temp_blocked', 'error_rate_limit', 'site_off', 'type_off', 'off', 'needs_trusted',
  'no_trusted', 'ask_site', 'text_no', 'page_limit', 'site_limit', 'cooldown', 'already_solved', 'unverified',
  'geetest_network', 'network_error', 'refused', 'audio_only', 'click_puzzle', 'error_captcha_unsolvable', 'timeout',
  'no_captcha', 'not_taken', 'refused_by_site', 'hold_failed', 'new_puzzle', 'closed', 'no_picture', 'something_new'];

test('plain words, no codes, no dashes', () => {
  for (const r of ALL) {
    const e = R.explain(r, 'recaptcha');
    assert.ok(e.text.length > 8, r);
    assert.ok(!/[A-Z]{3,}_|_[a-z]+_/.test(e.text), `${r}: ${e.text}`);
    assert.ok(!/—/.test(e.text), r);
    assert.ok(e.text.length < 110, r);
  }
});

test('the case list from the user test', () => {
  assert.equal(R.explain('unsupported').text, "This captcha type isn't supported yet");
  assert.equal(R.explain('no_key').text, 'Add your Browsa API key');
  assert.equal(R.explain('no_key').link.href, 'https://app.browsa.io/signup');
  assert.match(R.explain('error_key_denied_access').text, /key was refused.*dashboard/i);
  assert.equal(R.explain('error_key_denied_access').link.href, 'https://app.browsa.io/dashboard/keys');
  assert.equal(R.explain('error_zero_balance').link.href, 'https://app.browsa.io/dashboard/credits');
  assert.equal(R.explain('site_off').text, 'Solving is off on this site');
  assert.deepEqual(R.explain('ask_site').actions.map((a) => a.action), ['allow_text', 'deny_text']);
  assert.match(R.explain('geetest_network').text, /GeeTest/);
  assert.match(R.explain('page_limit').text, /3 solves/);
  assert.match(R.explain('site_limit').text, /10 solves/);
});

test('verdicts: a skipped site or a limit is not a failure', () => {
  assert.equal(R.verdictFor('site_off'), 'skipped');
  assert.equal(R.verdictFor('type_off'), 'skipped');
  assert.equal(R.verdictFor('page_limit'), 'paused');
  assert.equal(R.verdictFor('ask_site'), 'paused');
  assert.equal(R.verdictFor('unsupported'), 'unsupported');
  assert.equal(R.verdictFor('error_key_denied_access'), 'failed');
  assert.equal(R.VERDICTS.skipped.label, 'Not solved');
});

test('fingerprint: stable, different pictures differ', () => {
  assert.equal(R.fingerprint('abc'), R.fingerprint('abc'));
  assert.notEqual(R.fingerprint('abc'), R.fingerprint('abd'));
  assert.match(R.fingerprint('x'.repeat(50_000)), /^[0-9a-f]{16}$/);
});

test('provider frames are checked by address, not by look', () => {
  const ok = (k, u) => O.providerFrame(k, u);
  assert.equal(ok('recaptcha', 'https://www.google.com/recaptcha/api2/anchor?k=x'), true);
  assert.equal(ok('recaptcha', 'https://www.recaptcha.net/recaptcha/enterprise/bframe?k=x'), true);
  assert.equal(ok('recaptcha', 'https://evil.example/recaptcha/api2/anchor'), false);
  assert.equal(ok('recaptcha', 'https://www.google.com.evil.example/recaptcha/api2/anchor'), false);
  assert.equal(ok('recaptcha', 'http://www.google.com/recaptcha/api2/anchor'), false);
  assert.equal(ok('hcaptcha', 'https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox'), true);
  assert.equal(ok('hcaptcha', 'https://hcaptcha.com.evil.example/'), false);
  assert.equal(ok('turnstile', 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2'), true);
  assert.equal(ok('turnstile', 'https://challenges.cloudflare.com.evil.example/'), false);
  assert.equal(ok('datadome', 'https://geo.captcha-delivery.com/captcha/?initialCid=x'), true);
  assert.equal(ok('geetest', 'https://anything'), null, 'page-level kinds are checked by script hosts');
});

test('page-level widgets: scripts from the provider hosts', () => {
  assert.equal(O.providerScripts('geetest', ['https://static.geetest.com/static/js/gt.0.5.0.js']), true);
  assert.equal(O.providerScripts('geetest', ['https://gcaptcha4.geetest.com/load?captcha_id=x']), true);
  assert.equal(O.providerScripts('geetest', ['https://evil.example/geetest.com/gt.js', 'https://geetest.com.evil.example/x.js']), false);
  assert.equal(O.providerScripts('awswaf', ['https://abc.us-east-1.captcha.awswaf.com/abc/jsapi.js']), true);
  assert.equal(O.providerScripts('awswaf', ['http://abc.captcha.awswaf.com/x.js']), false);
  assert.equal(O.providerScripts('presshold', ['https://www.walmart.com/px/PXu6b0qd2S/captcha/captcha.js?a=1']), true);
  assert.equal(O.providerScripts('presshold', ['https://captcha.px-cdn.net/PXabc/captcha.js']), true);
  assert.equal(O.providerScripts('presshold', ['https://shop.example/app.js']), false);
});

test('config: host lists normalized, server address checked', () => {
  const c = C.merge(C.DEFAULTS, { skip: [' Shop.Example ', '*.foo.com', ''], textSites: ['A.com', 'a.com'] });
  assert.deepEqual(c.skip, ['shop.example', 'foo.com']);
  assert.deepEqual(c.textSites, ['a.com']);
  assert.equal(C.apiBaseProblem('https://captcha.browsa.io'), '');
  assert.equal(C.apiBaseProblem('http://127.0.0.1:8080'), '');
  assert.match(C.apiBaseProblem('http://captcha.browsa.io'), /https/);
  assert.match(C.apiBaseProblem('captcha.browsa.io'), /web address/);
  assert.equal(C.KINDS.length, 10);
  for (const k of C.KINDS) assert.equal(typeof C.DEFAULTS.types[k], 'boolean');
});
