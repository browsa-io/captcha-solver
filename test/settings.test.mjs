// The settings: per-type solve and by-itself switches, site lists, retries, the button, export and import, and
// what the panel says about the key, the free trial and a solve's cost.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from './load.mjs';

const C = await load('src/lib/config.ts');
const F = await load('src/lib/config.ts', { target: 'firefox' });
const R = await load('src/lib/reasons.ts');
const M = await load('src/lib/money.ts');
const G = await load('src/lib/guard.ts');

const cfg = (over = {}) => C.merge(C.DEFAULTS, { apiKey: 'agt_live_x', ...over });

test('defaults: every type solves by itself once it is on; one extra try after 3 s; button next to the captcha', () => {
  const d = C.DEFAULTS;
  for (const k of C.KINDS) assert.equal(d.autoTypes[k], true, k);
  assert.equal(d.retries, 1);
  assert.equal(d.retryDelay, 3);
  assert.equal(d.button, 'beside');
  assert.equal(d.siteMode, 'all');
  assert.deepEqual(d.custom, {});
});

test('listed types are on for a new install; the rest are off until they pass', () => {
  for (const k of C.KINDS) assert.equal(C.DEFAULTS.types[k], C.LISTED.includes(k), k);
  assert.deepEqual(C.LISTED, ['recaptcha', 'text', 'geetest', 'awswaf', 'altcha', 'gt4match', 'gt4gobang', 'gt4nine', 'gt4svg',
    'tcslide', 'tcclick', 'ydslide', 'ydinference', 'ydicon', 'dxrotate', 'mtcaptcha', 'cutcaptcha']);
  for (const k of ['gt4icon', 'cybersiara', 'presshold', 'hcaptcha', 'rcaudio', 'turnstile', 'cfchallenge', 'datadome']) assert.equal(C.listed(k), false, k);
  // the list is per browser: in Firefox reCAPTCHA (under the bar in a driven Firefox) and AWS WAF (no puzzle shown) wait
  assert.deepEqual(F.LISTED, ['text', 'geetest', 'altcha', 'ydslide', 'ydinference', 'ydicon', 'dxrotate', 'mtcaptcha']);
  for (const k of F.KINDS) assert.equal(F.DEFAULTS.types[k], F.LISTED.includes(k), 'firefox ' + k);
  assert.equal(F.gate(F.merge(F.DEFAULTS, { apiKey: 'agt_live_x', types: { recaptcha: true } }), 'recaptcha', 'a.com'), '', 'one switch away in Firefox');
  assert.equal(C.gate(cfg(), 'text', 'a.com'), '', 'picture text: on for a new install (the site is still asked first)');
  assert.equal(C.gate(cfg({ types: { text: false } }), 'text', 'a.com'), 'type_off');
});

test('"solve" and "by itself" are separate per type', () => {
  const c = cfg({ autoTypes: { recaptcha: false } });
  assert.equal(C.gate(c, 'recaptcha', 'a.com'), '', 'still solved (the Solve button)');
  assert.equal(C.autoOn(c, 'recaptcha'), false);
  assert.equal(C.autoOn(c, 'geetest'), true);
  assert.equal(C.autoOn(cfg({ auto: false }), 'geetest'), false, 'Manual mode: nothing by itself');
  const off = cfg({ types: { geetest: false } });
  assert.equal(C.gate(off, 'geetest', 'a.com'), 'type_off');
});

test('sites: a skip list, or only the listed sites (subdomains follow their site)', () => {
  assert.equal(C.gate(cfg({ skip: ['bank.example'] }), 'geetest', 'login.bank.example'), 'site_off');
  const only = cfg({ siteMode: 'allow', only: ['shop.example'] });
  assert.equal(C.gate(only, 'geetest', 'shop.example'), '');
  assert.equal(C.gate(only, 'geetest', 'www.shop.example'), '');
  assert.equal(C.gate(only, 'geetest', 'other.example'), 'site_not_listed');
  assert.equal(R.verdictFor('site_not_listed'), 'skipped');
  assert.equal(C.gate(cfg({ siteMode: 'allow', only: [] }), 'geetest', 'a.com'), 'site_not_listed', 'an empty allow list allows nothing');
  // the skip list still wins inside the allow list
  assert.equal(C.gate(cfg({ siteMode: 'allow', only: ['a.com'], skip: ['x.a.com'] }), 'geetest', 'x.a.com'), 'site_off');
});

test('numbers are kept in range, unknown values fall back', () => {
  assert.equal(cfg({ retries: 99 }).retries, 3);
  assert.equal(cfg({ retries: -1 }).retries, 0);
  assert.equal(cfg({ retries: 'x' }).retries, 1);
  assert.equal(cfg({ retryDelay: 0 }).retryDelay, 1);
  assert.equal(cfg({ retryDelay: 500 }).retryDelay, 60);
  assert.equal(cfg({ button: 'middle' }).button, 'beside');
  assert.equal(cfg({ button: 'off' }).button, 'off');
  assert.equal(cfg({ siteMode: 'x' }).siteMode, 'all');
  assert.equal(cfg({ apiBase: 'javascript:alert(1)' }).apiBase, 'https://captcha.browsa.io');
  assert.equal(cfg({ enabled: 'yes' }).enabled, true, 'not a boolean: the default stays');
});

test('only what the retry setting is for is tried again', () => {
  for (const r of ['error_captcha_unsolvable', 'timeout', 'network_error', 'new_puzzle', 'geetest_network']) assert.equal(R.retryable(r), true, r);
  for (const r of ['error_zero_balance', 'error_key_denied_access', 'trial_used', 'trial_daily', 'site_blocked', 'site_off', 'refused',
    'refused_by_site', 'unsupported', 'closed', 'no_key', 'offline']) assert.equal(R.retryable(r), false, r);
});

test('export leaves the key out unless asked; import takes only known, checked fields and keeps the key', () => {
  const c = cfg({ apiKey: 'agt_live_secret', skip: ['a.com'], retries: 2, custom: { 'x.com': { img: '#c', input: '#a' } } });
  const out = C.exported(c);
  assert.equal(out.apiKey, undefined);
  assert.equal(out.browsaCaptchaSolver, 1);
  assert.equal(C.exported(c, true).apiKey, 'agt_live_secret');
  const back = C.imported(JSON.stringify(out), cfg({ apiKey: 'agt_live_mine' }));
  assert.equal(back.config.apiKey, 'agt_live_mine');
  assert.deepEqual(back.config.skip, ['a.com']);
  assert.equal(back.config.retries, 2);
  assert.deepEqual(back.config.custom, { 'x.com': { img: '#c', input: '#a' } });
  assert.equal(C.imported('not json', c).error, 'not_json');
  assert.equal(C.imported('{"skip":["a.com"]}', c).error, 'not_settings');
  assert.equal(C.imported('[1]', c).error, 'not_settings');
  const hostile = C.imported(JSON.stringify({ browsaCaptchaSolver: 1, apiBase: 'http://evil.example', retries: 1e9, evil: 'x',
    types: { recaptcha: 'yes', nope: true }, custom: { 'A.com': { img: 'x'.repeat(999), input: '#a' }, 'b.com': { img: '' } }, skip: 'a.com' }), c);
  assert.equal(hostile.config.apiBase, 'https://captcha.browsa.io', 'a plain http server is not taken');
  assert.equal(hostile.config.retries, 3);
  assert.equal(hostile.config.evil, undefined);
  assert.equal(hostile.config.types.recaptcha, true, 'not a boolean: the default');
  assert.equal(hostile.config.types.nope, undefined);
  assert.equal(hostile.config.custom['a.com'].img.length, 300);
  assert.equal(hostile.config.custom['b.com'], undefined);
  assert.deepEqual(hostile.config.skip, []);
});

test('the API error is made finer by its description: wrong key, trial used up, daily trial, site not served', () => {
  assert.equal(R.refine('ERROR_KEY_DENIED_ACCESS', 'clientKey is missing or invalid. Send your Browsa API key'), 'error_key_denied_access');
  assert.equal(R.refine('ERROR_KEY_DENIED_ACCESS', 'the free trial of 25 solves is used up: buy credits at https://app.browsa.io/dashboard/credits to keep solving'), 'trial_used');
  assert.equal(R.refine('ERROR_KEY_TEMP_BLOCKED', 'the free trial allows 10 solves a day: try again tomorrow'), 'trial_daily');
  assert.equal(R.refine('ERROR_KEY_TEMP_BLOCKED', 'daily limit of 3000 tasks reached'), 'error_key_temp_blocked');
  assert.equal(R.refine('ERROR_KEY_DENIED_ACCESS', 'this site is not served'), 'site_blocked');
  assert.equal(R.refine('ERROR_KEY_DENIED_ACCESS', 'this account is not verified yet'), 'account_unverified');
  assert.equal(R.refine('ERROR_ZERO_BALANCE', 'not enough credits'), 'error_zero_balance');
  assert.equal(R.refine('OFFLINE'), 'offline');
  // every one of them has its own plain line and, where the person can fix it, a link
  assert.match(R.explain('trial_used').text, /free solves are used up/);
  assert.equal(R.explain('trial_used').link.href, 'https://app.browsa.io/dashboard/credits');
  assert.match(R.explain('trial_daily').text, /tomorrow/);
  assert.match(R.explain('site_blocked').text, /does not solve captchas on this site/);
  assert.match(R.explain('error_task_not_supported').text, /does not solve this type right now/);
  assert.match(R.explain('error_rate_limit').text, /few seconds/);
  assert.match(R.explain('offline').text, /offline/);
  assert.match(R.explain('error_zero_balance').text, /Out of credits/);
  for (const r of ['trial_used', 'trial_daily', 'site_blocked', 'error_task_not_supported', 'error_rate_limit', 'offline', 'site_not_listed',
    'auto_off', 'mark_image', 'mark_saved', 'error_report_too_late', 'error_already_reported', 'error_report_limit']) {
    const e = R.explain(r, 'text');
    assert.ok(!/[A-Z]{3,}_|^r_/.test(e.text), `${r}: ${e.text}`);
  }
});

test('the header: trial left when the API reports one, else the balance; states in words', () => {
  const at = Date.now();
  assert.equal(M.balanceLine({ state: 'ok', balance: 1983.596, unit: 'credits', at }).text, '1,983.596 credits');
  assert.equal(M.balanceLine({ state: 'ok', balance: 100, unit: 'credits', at, trial: { total: 25, used: 4, left: 21, dailyLimit: 10, usedToday: 4 } }).text, '21 of 25 free solves left');
  assert.match(M.balanceLine({ state: 'ok', balance: 100, unit: 'credits', at, trial: { total: 25, used: 4, left: 21, dailyLimit: 10, usedToday: 4 } }).title, /100 credits.*10 a day.*4 used today/);
  assert.equal(M.balanceLine({ state: 'trial_used', at }).text, 'Free solves used up');
  assert.equal(M.balanceLine({ state: 'refused', at }).text, 'Key refused');
  assert.equal(M.balanceLine({ state: 'no_credits', at }).text, '0 credits');
  assert.equal(M.balanceLine({ state: 'offline', at }).text, 'Offline');
  assert.equal(M.balanceLine(null).text, '');
  assert.equal(M.balanceLine({ state: 'ok', balance: 1.5, unit: 'usd', at }).text, '$' + '1.5');
  assert.equal(M.keyNotice({ state: 'ok', at }), null);
  assert.equal(M.keyNotice({ state: 'trial_used', at }).link.href, 'https://app.browsa.io/dashboard/credits');
  assert.equal(M.keyNotice({ state: 'refused', at }).link.href, 'https://app.browsa.io/dashboard/keys');
  assert.match(M.keyNotice({ state: 'offline', at }).text, /connection/);
  assert.equal(M.amount(0.008, 'credits'), '0.008 credits');
  assert.equal(M.amount(0.0004, 'usd'), '$' + '0.0004');
});

test('guard: a type whose by-itself switch is off is still solved from the Solve button', () => {
  const g = new G.Guard(() => 1000);
  const c = cfg({ autoTypes: { geetest: false } });
  assert.deepEqual(g.decide(c, { kind: 'geetest', why: 'button', host: 'a.com', tabId: 1, verified: false }), { ok: true });
});
