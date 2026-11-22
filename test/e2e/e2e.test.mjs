// End to end: the built store package (dist/chrome, dist/firefox) in a real browser with a fresh profile, on local
// fixture pages, against a local stand-in for the captcha API. Nothing here reaches the internet: the browser's
// only way out is a recording proxy, which is also how "nothing is sent anywhere else" is checked.
//
//   npm run build && npm run build:firefox
//   BROWSER=chrome  node --test test/e2e/e2e.test.mjs
//   BROWSER=firefox node --test test/e2e/e2e.test.mjs      (HEADED=1 shows the window; SHOTS=<dir> keeps screenshots)
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ANSWER, MARK, startApi, startProxy, startSite } from './servers.mjs';
import { sleep, start } from './browsers.mjs';

const BROWSER = process.env.BROWSER === 'firefox' ? 'firefox' : 'chrome';
const SHOTS = process.env.SHOTS || '';
const KEY = 'agt_live_e2e_0123456789abcdef';
// hosts a browser talks to by itself (updates, safe browsing, settings): not the extension's doing
const VENDOR = BROWSER === 'firefox' ? /(^|\.)(mozilla\.(com|org|net)|firefox\.com|mozgcp\.net)$/ : /(^|\.)(google\.com|googleapis\.com|gstatic\.com|gvt1\.com|googleusercontent\.com)$/;

let site, api, proxy;
before(async () => { site = await startSite(); api = await startApi(); proxy = await startProxy(site.port, api.port); });
after(() => { site.close(); api.close(); proxy.close(); });

const tasks = () => api.calls('/createTask').length;
const value = (d, sel = 'input[type=text]') => d.js((s) => document.querySelector(s)?.value || '', sel);
const shot = async (d, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await d.shot(path.join(SHOTS, `${BROWSER}-${name}.png`)); } };

/** Settings straight into the extension's storage, from one of its own pages (what Options does, without the clicks). */
async function conf(d, over = {}) {
  await d.goto(d.ext('options.html'));
  await d.js(async (c) => { await chrome.storage.local.set({ config: c }); }, { apiBase: api.base, apiKey: KEY, textSites: ['test'], retries: 0, types: { text: true }, ...over });   // (picture text switched on: Options, "Not ready yet")
  await sleep(400);
}
async function config(d) {
  await d.goto(d.ext('options.html'));
  return d.js(async () => (await chrome.storage.local.get('config')).config);
}
async function rows(d) {
  trace('rows');
  await d.goto(d.ext('popup.html'));
  await sleep(500);
  return d.js(() => Array.from(document.querySelectorAll('#log li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
}
const trace = (...a) => { if (process.env.E2E_TRACE) console.error(new Date().toISOString().slice(11, 23), ...a); };
const open = (d, host, page = 'text-basic.html') => { trace('open', host, page); return d.goto(`http://${host}/${page}?token=${MARK}-URL`); };
const solved = async (d, sel) => {
  await d.until((s) => (document.querySelector(s)?.value || '').length === 5, [sel || 'input[type=text]'], 15_000, 'the answer typed');
  await sleep(900);                                       // the last key is up and the solve is written to the log
};
async function session(fn) {
  const d = await start(BROWSER, { proxyPort: proxy.port });
  try { await sleep(1200); await fn(d); } finally { await d.close(); }
}

test(`${BROWSER}: first run, from install to a solved captcha the site accepts, a report, and nothing sent elsewhere`, async () => {
  api.state.trial = { total: 25, used: 4, usedToday: 4, dailyLimit: 10 };
  api.state.requests.length = 0;
  proxy.seen.length = 0;
  await session(async (d) => {
    // install opens the welcome page (and nothing else)
    for (let i = 0; i < 40 && !proxy.seen.some((r) => r.host === 'browsa.io'); i++) await sleep(250);
    assert.equal(proxy.seen.filter((r) => r.host === 'browsa.io' && r.method === 'CONNECT').length >= 1, true, 'the welcome page opens on install');
    assert.equal((await d.pages()).length, 2, 'one new tab, the welcome page');

    // no key: a captcha page costs nothing and sends nothing; the panel says what to do
    await open(d, 'a.test');
    await sleep(3500);
    assert.equal(api.state.requests.length, 0, 'no key: nothing is sent to the API');
    assert.equal(await value(d), '');
    await d.goto(d.ext('popup.html'));
    await sleep(500);
    assert.equal(await d.js(() => document.getElementById('onboard').hidden), false);
    assert.match(await d.text('#onboard'), /Get a free key/);
    assert.equal(await d.js(() => document.getElementById('getKey').href), 'https://app.browsa.io/signup');
    assert.equal(await d.js(() => document.getElementById('solve').disabled), true);
    assert.match(await d.text('#log li'), /Not solved.*Add your Browsa API key.*Get a free key/);
    await shot(d, '1-no-key');

    // the server address (Options), then the key (panel): the trial that is left shows at once
    await d.goto(d.ext('options.html'));
    await d.fill('#apiBase', api.base);
    await d.key('Tab');
    await d.until(async () => (await chrome.storage.local.get('config')).config?.apiBase?.startsWith('http://127.0.0.1'), [], 5000, 'the server saved');
    await d.goto(d.ext('popup.html'));
    await d.click('#haveKey');
    await d.fill('#apiKey', KEY);
    await d.click('#saveKey');
    await d.until(() => document.getElementById('balance').textContent === '21 of 25 free solves left', [], 8000, 'the trial line');
    assert.match(await d.js(() => document.getElementById('balance').title), /100 credits.*10 a day/);
    await shot(d, '2-key-saved-trial');

    // picture text is on for a new install (listed in both browsers)
    await d.goto(d.ext('options.html'));
    assert.equal(await d.js(() => document.querySelector('#typeRows tr[data-type=text] input[data-field=types]').checked), true);

    // a picture captcha on a new site: asked first, nothing sent
    await open(d, 'a.test');
    await sleep(3500);
    assert.equal(tasks(), 0, 'a picture captcha is not sent before the person says yes for the site');
    assert.match((await rows(d))[0], /Paused.*Solve picture captchas on this site\?/);
    await d.goto(d.ext('options.html'));
    await d.fill('#textSites', 'test');
    await d.key('Tab');
    await sleep(500);

    // solved: typed like a person, and the SITE says Correct!
    await open(d, 'a.test');
    await solved(d);
    assert.equal(await value(d), ANSWER);
    await shot(d, '3-solved-on-page');
    await d.click('#send');
    await d.until(() => /Correct!|Incorrect!/.test(document.getElementById('out').textContent), [], 8000, "the site's verdict");
    assert.equal(await d.text('#out'), 'Correct!', "the site's own check accepts the answer");
    assert.equal(tasks(), 1);

    // the panel: what it cost (the API's number), what is left, and the one-click report
    const r = await rows(d);
    assert.match(r[0], /Image text · a\.test.*Answer typed.*0\.004 credits\..*That was wrong/);
    await d.until(() => document.getElementById('balance').textContent === '20 of 25 free solves left', [], 8000, 'the trial count after a solve');
    await shot(d, '4-panel-after-solve');
    await d.click('#log li button.wrong');
    await d.until(() => /Reported\./.test(document.querySelector('#log li').textContent), [], 8000, 'the report answer');
    assert.match(await d.text('#log li'), /Reported\. Recorded\. 0\.004 credits were given back for this solve\./, "the API's own answer is shown");
    assert.equal(await d.js(() => document.querySelectorAll('#log li button.wrong').length), 0, 'one report per solve');
    assert.equal(api.state.reports.length, 1);
    await shot(d, '5-panel-reported');
    await sleep(800);
  });

  // ---- what left the browser during all of that
  const sent = api.calls('/createTask');
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['clientKey', 'task', 'waitSeconds']);
  assert.deepEqual(Object.keys(sent[0].body.task).sort(), ['body', 'module', 'type', 'websiteURL']);
  assert.equal(sent[0].body.task.websiteURL, 'https://a.test/', 'the host name only: no path, no query');
  for (const r of api.state.requests) {
    assert.ok(!r.raw.includes(MARK), `${r.path}: no page text, form value, cookie or address beyond the host`);
    assert.equal(r.headers.cookie, undefined, `${r.path}: no cookies`);
    assert.ok(['/createTask', '/getBalance', '/reportIncorrect'].includes(r.path), r.path);
  }
  const hosts = [...new Set(proxy.seen.map((r) => `${r.kind}:${r.host}`))];
  const other = hosts.filter((h) => {
    const [kind, host] = h.split(':');
    return !(kind === 'site' || kind === 'api' || host === 'browsa.io' || VENDOR.test(host));
  });
  assert.deepEqual(other, [], `requests to hosts other than the page, the API and the welcome page (all seen: ${hosts.join(', ')})`);
  assert.ok(proxy.seen.filter((r) => r.host === 'browsa.io').every((r) => r.method === 'CONNECT'), 'browsa.io: only the welcome tab');
  assert.ok(proxy.seen.filter((r) => r.kind === 'site').every((r) => !/SECRET/.test(r.url) || r.url.includes(`token=${MARK}-URL`)), 'the page itself was not changed');
});

test(`${BROWSER}: every failure says what happened and what to do, in words`, async () => {
  api.state.trial = null;
  const E = api.err;
  const cases = [
    ['out of credits', E('ERROR_ZERO_BALANCE', 'not enough credits', 'Buy credits at https://app.browsa.io/dashboard/credits, then retry.'), /Failed.*Out of credits.*Buy credits/],
    ['type switched off at the service', E('ERROR_TASK_NOT_SUPPORTED', 'this task type is switched off', 'Use a type name exactly as GET /types lists it, with status live.'), /Not supported.*does not solve this type right now/],
    ['site blocked', E('ERROR_KEY_DENIED_ACCESS', 'this site is not served', 'Send your Browsa API key (agt_live_...) as clientKey; the description says which rule refused it.'), /Not solved.*does not solve captchas on this site/],
    ['rate limit', E('ERROR_RATE_LIMIT', 'too many requests for this key, slow down', 'Slow down and retry in a few seconds.'), /Failed.*Too many solves at once.*Slow down and retry in a few seconds\./],
    ['daily trial limit', E('ERROR_KEY_TEMP_BLOCKED', 'the free trial allows 10 solves a day: try again tomorrow, or buy credits at https://app.browsa.io/dashboard/credits', 'Wait for the limit named in the description to reset, or ask support@browsa.io for a higher one.'), /Failed.*Today's free solves are used.*Buy credits/],
    ['monthly limit', E('ERROR_BUDGET_EXCEEDED', 'the monthly spending limit is reached', 'Raise the monthly limit in the dashboard, or wait for the 1st of next month (UTC).'), /Failed.*monthly limit is reached/],
    ['service unreachable', 'drop', /Failed.*Couldn't reach Browsa\. Check your connection\./],
  ];
  await session(async (d) => {
    await conf(d);
    let n = 0;
    for (const [name, answer, expect] of cases) {
      const before = tasks();
      if (answer === 'drop') api.state.down = true; else api.state.next.push(answer);
      await open(d, `f${++n}.test`);
      for (let i = 0; i < 60 && tasks() === before; i++) await sleep(200);
      // (a browser sends a request again by itself when its connection is cut, so the cut case may count two)
      if (answer === 'drop') assert.ok(tasks() >= before + 1, name); else assert.equal(tasks(), before + 1, `${name}: one call`);
      const made = tasks();
      await sleep(answer === 'drop' ? 2500 : 1200);
      api.state.down = false;
      const r = await rows(d);
      assert.match(r[0], expect, name);
      // "Not charged." is the API's own word (its charged field); a cut connection gives no such word, so none is shown
      if (answer === 'drop') assert.doesNotMatch(r[0], /charged/i, name); else assert.match(r[0], /Not charged\./, name);
      assert.ok(!/ERROR_|_[a-z]+_/.test(r[0]), `${name}: no codes in "${r[0]}"`);
      assert.doesNotMatch(await d.text('#balance'), /Key refused/, `${name}: the key itself is fine`);
      await sleep(300);
      if (answer !== 'drop') assert.equal(tasks(), made, `${name}: not tried again (retries are 0 here)`);
      if (name === 'out of credits') { await shot(d, '6-out-of-credits'); await d.fill('#apiKey', KEY + 'b'); await d.click('#saveKey'); await sleep(600); }
    }

    // the free trial is used up: said once with the fix, the header says so, and no further call is made
    let before = tasks();
    api.state.next.push(E('ERROR_KEY_DENIED_ACCESS', 'the free trial of 25 solves is used up: buy credits at https://app.browsa.io/dashboard/credits to keep solving', 'Send your Browsa API key (agt_live_...) as clientKey; the description says which rule refused it.'));
    await open(d, 'g1.test');
    for (let i = 0; i < 60 && tasks() === before; i++) await sleep(200);
    await sleep(1200);
    let r = await rows(d);
    assert.match(r[0], /Failed.*Your free solves are used up\. Buy credits to keep solving\..*Buy credits/);
    api.state.trial = { total: 25, used: 25, usedToday: 3, dailyLimit: 10 };
    await d.goto(d.ext('popup.html'));
    await d.until(() => document.getElementById('balance').textContent === 'Free solves used up', [], 6000, 'the header');
    assert.match(await d.text('#keyMsg'), /free solves are used up.*Buy credits/);
    await shot(d, '7-trial-used-up');
    before = tasks();
    await open(d, 'g2.test');
    await sleep(3500);
    assert.equal(tasks(), before, 'a used-up trial is not sent to the API again');
    api.state.trial = null;

    // a key the API refuses: red in the header, the fix, Solve disabled, nothing sent for a captcha
    await d.goto(d.ext('popup.html'));
    await d.fill('#apiKey', 'not-a-key');
    await d.click('#saveKey');
    await d.until(() => document.getElementById('balance').textContent === 'Key refused', [], 6000, 'the refused key');
    assert.match(await d.text('#keyMsg'), /key was refused.*Open keys/);
    assert.equal(await d.js(() => document.getElementById('solve').disabled), true);
    await shot(d, '8-key-refused');
    before = tasks();
    await open(d, 'g3.test');
    await sleep(3500);
    assert.equal(tasks(), before, 'a refused key is not sent again');
    assert.match((await rows(d))[0], /Your key was refused\. Check it in the dashboard\..*Open keys/);
  });
});

test(`${BROWSER}: settings do what they say`, async () => {
  api.state.trial = null;
  api.state.next.length = 0;
  const unsolvable = api.err('ERROR_CAPTCHA_UNSOLVABLE', 'the picture could not be read', 'Send a new task; when it keeps failing for one site, check websiteURL and websiteKey against the live widget.');
  const button = (d) => d.js(() => !!document.querySelector('browsa-solver-button'));
  await session(async (d) => {
    // retries: one more try after the delay, then typed; with 0 it stays failed
    await conf(d, { retries: 1, retryDelay: 1 });
    let before = tasks();
    api.state.next.push(unsolvable);
    await open(d, 's1.test');
    await solved(d);
    assert.equal(tasks(), before + 2, 'tried again once');
    let r = await rows(d);
    assert.match(r[0], /Answer typed/);
    assert.match(r[1], /Failed.*Couldn't read this captcha/);
    await conf(d, { retries: 0 });
    before = tasks();
    api.state.next.push(unsolvable);
    await open(d, 's2.test');
    await sleep(5000);
    assert.equal(tasks(), before + 1, 'retries 0: one call');
    assert.equal(await value(d), '');

    // "by itself" off for the type: nothing is sent; the Solve button waits on the page where the setting puts it
    await conf(d, { autoTypes: { text: false }, button: 'bottom-left' });
    before = tasks();
    await open(d, 's3.test');
    await d.until(() => !!document.querySelector('browsa-solver-button'), [], 6000, 'the Solve button');
    await sleep(1500);
    assert.equal(tasks(), before, 'by itself is off: not solved until asked');
    await shot(d, '9-solve-button');
    let h = await d.js(() => window.innerHeight);
    await d.clickAt(40, h - 32);
    await solved(d);
    assert.equal(tasks(), before + 1);
    await conf(d, { autoTypes: { text: false }, button: 'beside' });
    await open(d, 's4.test');
    await d.until(() => !!document.querySelector('browsa-solver-button'), [], 6000, 'the Solve button');
    const box = await d.js(() => { const b = document.querySelector('img').getBoundingClientRect(); return { left: b.left, bottom: b.bottom }; });
    await sleep(600);
    await d.clickAt(box.left + 24, box.bottom + 8 + 16);                 // under the picture's left edge
    await solved(d);
    await conf(d, { autoTypes: { text: false }, button: 'off' });
    before = tasks();
    await open(d, 's5.test');
    await sleep(3500);
    assert.equal(await button(d), false, 'no button');
    assert.equal(tasks(), before);

    // Manual mode: nothing by itself; the button offers
    await conf(d, { auto: false, button: 'top-right' });
    before = tasks();
    await open(d, 's6.test');
    await d.until(() => !!document.querySelector('browsa-solver-button'), [], 6000, 'the Solve button in Manual mode');
    assert.equal(tasks(), before);
    const w = await d.js(() => window.innerWidth);
    await d.clickAt(w - 50, 32);
    await solved(d);

    // sites: skipped, type off, and "only the sites below"
    await conf(d, { skip: ['s7.test'] });
    before = tasks();
    await open(d, 's7.test');
    await sleep(3500);
    assert.equal(tasks(), before, 'a skipped site is not touched');
    assert.equal(await button(d), false);
    await conf(d, { types: { text: false } });
    await open(d, 's8.test');
    await sleep(3500);
    assert.equal(tasks(), before, 'a type that is off is not solved');
    assert.equal(await button(d), false);
    await conf(d, { siteMode: 'allow', only: ['s9.test'] });
    await open(d, 's10.test');
    await sleep(3500);
    assert.equal(tasks(), before, 'not in the allow list: not touched');
    await open(d, 's9.test');
    await solved(d);
    assert.equal(tasks(), before + 1);

    // right-click marking: a picture the detector misses, then its field; remembered for the site
    await conf(d, { textSites: [] });
    before = tasks();
    await open(d, 'm1.test', 'text-unmarked.html');
    await sleep(3000);
    assert.equal(tasks(), before, 'the detector alone does not find this one');
    const menu = async (cmd) => {                        // what a click on the menu entry does (background -> the frame)
      await d.tab(1);
      await d.goto(d.ext('options.html'));
      await d.js(async (c) => { const all = await chrome.tabs.query({}); const tab = all.find((x) => /m1\.test/.test(x.url || '')); await chrome.tabs.sendMessage(tab.id, { cmd: c }, { frameId: 0 }); }, cmd);
      await d.tab(0);
    };
    await d.js(() => document.querySelector('img').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true })));
    await menu('markImage');
    await d.js(() => document.querySelector('input[type=text]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true })));
    await menu('markInput');
    await solved(d);
    assert.equal(tasks(), before + 1);
    await d.click('button[type=submit]');
    await d.until(() => /Correct!/.test(document.getElementById('out').textContent), [], 8000, "the site's verdict");
    const c = await config(d);
    assert.deepEqual(c.custom['m1.test'], { img: 'img.vpic', input: '#v' });
    assert.ok(c.textSites.includes('m1.test'), 'marking a site is the yes for that site');
    assert.match(await d.text('#custom'), /m1\.test.*img\.vpic → #v.*Remove/);
    await d.tab(1);                                      // (another tab: this one pauses 30 s after a sent answer, as designed)
    await open(d, 'm1.test', 'text-unmarked.html');     // remembered: the next visit is solved by itself
    await solved(d);
    assert.equal(tasks(), before + 2);
    await d.tab(0);
    await d.goto(d.ext('options.html'));
    await d.click('#custom button');
    await sleep(500);
    assert.equal((await config(d)).custom['m1.test'], undefined, 'Remove forgets the site');
  });
});

test(`${BROWSER}: the Options page (each control saves, numbers stay in range, export and import)`, async () => {
  await session(async (d) => {
    await conf(d, { textSites: [] });
    await d.goto(d.ext('options.html'));
    assert.equal(await d.js(() => document.querySelectorAll('#typeRows tr').length), await d.js(() => document.querySelectorAll('#typeRows input[data-field=types]').length));
    assert.ok(await d.js(() => document.querySelectorAll('#typeRows tr').length) >= (BROWSER === 'firefox' ? 2 : 4));
    await d.click('#moreTypes summary');                  // the types that are not ready yet (in Firefox reCAPTCHA is one of them)
    assert.ok(await d.js(() => document.querySelectorAll('#unlistedRows tr').length) >= 4, 'the types that are not ready are there to try');
    // per type: "Solve" and "By itself" are two switches; by itself is greyed when the type is off
    await d.click('tr[data-type=geetest] input[data-field=autoTypes]');
    await sleep(400);
    let c = await config(d);
    assert.equal(c.autoTypes.geetest, false);
    assert.equal(c.types.geetest, true);
    await d.click('tr[data-type=altcha] input[data-field=types]');
    await sleep(400);
    assert.equal(await d.js(() => document.querySelector('tr[data-type=altcha] input[data-field=autoTypes]').disabled), true);
    await d.fill('#retries', '9');
    await d.key('Tab');
    await d.until(() => !document.getElementById('retryDelay').disabled, [], 4000, 'the delay field (it is greyed while tries are 0)');
    await d.fill('#retryDelay', '0');
    await d.key('Tab');
    await sleep(500);
    assert.equal(await value(d, '#retries'), '3', 'shown as kept');
    await d.js(() => { const s = document.getElementById('button'); s.value = 'top-right'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await d.click('input[name=siteMode][value=allow]');
    await sleep(300);
    assert.equal(await d.js(() => document.getElementById('skipField').hidden), true);
    await d.fill('#only', 'shop.example\nWWW.Other.example');
    await d.key('Tab');
    await sleep(400);
    await d.click('#submitText');
    await sleep(400);
    c = await config(d);
    assert.equal(c.retries, 3);
    assert.equal(c.retryDelay, 1);
    assert.equal(c.button, 'top-right');
    assert.equal(c.siteMode, 'allow');
    assert.deepEqual(c.only, ['shop.example', 'www.other.example']);
    assert.equal(c.submitText, true);
    assert.equal(c.types.altcha, false);
    // a server address that is not https is refused with a reason, and not saved
    await d.fill('#apiBase', 'http://captcha.example');
    await d.key('Tab');
    await sleep(300);
    assert.equal(await d.text('#apiBaseMsg'), 'Use an https:// address');
    assert.equal((await config(d)).apiBase, api.base);

    // export: a file without the key unless asked; import: checked, the key kept
    const exported = async (withKey) => {
      await d.goto(d.ext('options.html'));
      if (withKey) await d.click('#exportKey');
      await d.js(() => { window.__out = null; const real = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { b.text().then((t) => { window.__out = t; }); return real(b); }; });
      await d.click('#export');
      return JSON.parse(await d.until(() => window.__out, [], 5000, 'the exported file'));
    };
    const plain = await exported(false);
    assert.equal(plain.apiKey, undefined, 'the key stays out');
    assert.equal(plain.browsaCaptchaSolver, 1);
    assert.equal(plain.retries, 3);
    assert.equal((await exported(true)).apiKey, KEY);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-imp-'));
    const good = path.join(dir, 'settings.json'), bad = path.join(dir, 'bad.json');
    fs.writeFileSync(good, JSON.stringify({ ...plain, retries: 2, skip: ['Bank.example'], siteMode: 'all', button: 'off', nonsense: true }));
    fs.writeFileSync(bad, '{"hello": "world"}');
    await d.goto(d.ext('options.html'));
    await d.files('#importFile', bad);
    await d.until(() => /not exported from Browsa Solver/.test(document.getElementById('backupMsg').textContent), [], 5000, 'the refusal');
    await d.files('#importFile', good);
    await d.until(() => document.getElementById('backupMsg').textContent === 'Imported.', [], 5000, 'the import');
    c = await config(d);
    assert.equal(c.retries, 2);
    assert.deepEqual(c.skip, ['bank.example']);
    assert.equal(c.button, 'off');
    assert.equal(c.apiKey, KEY, 'the key on this device is kept');
    assert.equal(c.nonsense, undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    await shot(d, '10-options');
  });
});

test(`${BROWSER}: ordinary pages are left alone (forms, an article about captchas, lookalike class names, a heavy page)`, async () => {
  api.state.next.length = 0;
  await session(async (d) => {
    await conf(d);
    const before = api.state.requests.filter((r) => r.path !== '/getBalance').length;
    for (const f of ['plain-login.html', 'article-about-captchas.html', 'checkout-form.html', 'svg-captcha-logo.html', 'heavy.html', 'blank.html', 'fake-widgets.html', 'tencent-dingxiang-lookalike.html']) {
      await open(d, 'n.test', f);
      await sleep(3200);
      assert.equal(api.state.requests.filter((r) => r.path !== '/getBalance').length, before, `${f}: nothing sent`);
      if (f === 'fake-widgets.html' || f === 'tencent-dingxiang-lookalike.html') continue;           // lookalikes may get the "not from the provider" notice; never a solve
      assert.equal(await d.js(() => document.querySelectorAll('browsa-solver-notice, browsa-solver-button').length), 0, `${f}: nothing added to the page`);
      assert.equal(await d.js(() => document.documentElement.getAttribute('data-browsa-captcha')), null, `${f}: no mark on the page`);
    }
    const r = await rows(d);
    assert.ok(r.every((x) => !/Solved|Answer typed|Failed/.test(x)), `no solve was started: ${JSON.stringify(r)}`);
  });
});

test(`${BROWSER}: the panel and Options work by keyboard, name every control, keep contrast, and are dark`, async () => {
  api.state.trial = { total: 25, used: 4, usedToday: 4, dailyLimit: 10 };
  await session(async (d) => {
    await conf(d);
    await open(d, 'k.test');
    await solved(d);
    for (const page of ['popup.html', 'options.html']) {
      await d.goto(d.ext(page));
      await sleep(700);
      const audit = await d.js(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('details:not([open]) > :not(summary)'); };
        const controls = Array.from(document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary')).filter(vis);
        const name = (e) => (e.getAttribute('aria-label') || (e.labels && Array.from(e.labels).map((l) => l.textContent).join(' ')) || e.textContent || e.title || e.getAttribute('placeholder') || '').trim();
        const unnamed = controls.filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 90));
        // contrast of every visible text against what is painted behind it
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const p = cx.getImageData(0, 0, 1, 1).data; return [p[0], p[1], p[2], p[3] / 255]; };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
        const bgOf = (e) => { const stack = []; for (let x = e; x; x = x.parentElement) stack.push(getComputedStyle(x).backgroundColor); let c = [255, 255, 255, 1]; for (const s of stack.reverse()) { const k = rgba(s); if (k[3] > 0) c = over(k, c); } return c; };
        const low = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const e = n.parentElement;
          if (!n.textContent.trim() || seen.has(e) || !vis(e) || e.closest(':disabled, .na')) continue;
          seen.add(e);
          const s = getComputedStyle(e);
          const bg = bgOf(e), fg = over(rgba(s.color), bg);
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          const ratio = (a + 0.05) / (b + 0.05);
          const big = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
          if (ratio < (big ? 3 : 4.5)) low.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 40)}"`);
        }
        const body = bgOf(document.body);
        return { unnamed, low, controls: controls.filter((e) => !e.disabled && e.tabIndex >= 0 && !(e.type === 'radio' && !e.checked)).length, bodyLum: lum(body),
          lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length,
          scheme: getComputedStyle(document.documentElement).colorScheme };
      });
      assert.deepEqual(audit.unnamed, [], `${page}: every control has a name`);
      assert.deepEqual(audit.low, [], `${page}: text contrast at least 4.5 to 1 (3 to 1 for large text)`);
      assert.ok(audit.bodyLum < 0.03, `${page}: dark (${audit.bodyLum.toFixed(3)})`);
      assert.match(audit.scheme, /dark/, page);
      assert.equal(audit.lang, 'en');
      assert.equal(audit.h1, 1, `${page}: one heading`);
      assert.equal(audit.main, 1, `${page}: a main landmark`);
      // Tab reaches every control, each with a visible focus ring
      await d.js(() => { document.activeElement?.blur(); window.__focus = []; document.addEventListener('focusin', (e) => { const s = getComputedStyle(e.target); window.__focus.push({ tag: e.target.tagName, ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 }); }, true); });
      for (let i = 0; i < audit.controls + 2; i++) await d.key('Tab');
      const focus = await d.js(() => window.__focus);
      assert.ok(focus.length >= audit.controls, `${page}: Tab reached ${focus.length} of ${audit.controls} controls`);
      assert.ok(focus.every((f) => f.ring), `${page}: a focus ring on every stop`);
    }
    // the mode switch is one tab stop; the arrow keys choose
    await d.goto(d.ext('popup.html'));
    await sleep(500);
    await d.js(() => document.querySelector('.seg button[aria-checked=true]').focus());
    await d.key('ArrowRight');
    await d.until(() => document.querySelector('.seg button[data-mode=manual]').getAttribute('aria-checked') === 'true' && document.activeElement?.dataset.mode === 'manual', [], 4000, 'Manual chosen by arrow key');
    assert.equal((await config(d)).auto, false);
  });
});
