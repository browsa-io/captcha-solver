// One small driver over two browsers, so every end-to-end test runs unchanged in both:
//   chrome   Chrome for Testing through Playwright, the built store package dist/chrome loaded unpacked
//   firefox  Firefox through geckodriver (selenium-webdriver), dist/firefox installed as a temporary add-on
// Each start is a fresh profile whose only way out is the recording proxy (servers.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import net_ from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Headless only, always (owner, 22 Nov 2026: no test browser window on this machine). Chrome's new headless mode
// loads extensions; Firefox's -headless runs add-ons the same.
const FIREFOX_UUID = '6f0c5e52-8a43-4e4c-9d1e-3b6a2c7d9e10';

function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const dirs = [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    const builds = fs.readdirSync(d).filter((x) => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      for (const rel of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = path.join(d, b, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('no Chrome for Testing found: run "npx playwright-core install chromium" or set CHROME_BIN');
}

function firefoxPath() {
  for (const p of [process.env.FIREFOX, '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox', '/snap/bin/firefox']) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';                                              // selenium finds (or fetches) one
}

function chromeVersion(bin) {
  // read from the app's Info.plist (never by starting the binary: no browser is started outside a launch)
  try {
    const plist = fs.readFileSync(path.join(path.dirname(path.dirname(bin)), 'Info.plist'), 'utf8');
    return plist.match(/CFBundleShortVersionString<\/key>\s*<string>(\d+)\./)[1];
  } catch { return '159'; }
}
let CHROME_UA = process.env.CHROME_UA || '';
// A windowed Chrome only inside a Linux container with a virtual display (Xvfb): the headed confirmation pass.
// Anywhere else (this Mac) every browser is headless, whatever the environment says.
const IN_CONTAINER = process.platform === 'linux' && fs.existsSync('/.dockerenv') && !!process.env.DISPLAY;
// REAL_WINDOW=1: one visible window on this Mac, allowed by the owner on 22 Nov 2026 (11:00 UTC) for the final checks only
const WINDOWED = (IN_CONTAINER && process.env.XVFB_HEADED === '1') || process.env.REAL_WINDOW === '1';

async function startChrome({ proxyPort, ext, headed }) {
  if (!CHROME_UA) CHROME_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion(chromePath())}.0.0.0 Safari/537.36`;
  const { chromium } = await import('playwright-core');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-e2e-c-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(), headless: !WINDOWED,
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
    // headless Chrome says "HeadlessChrome" in its user agent; a person's Chrome does not, so the test browser wears
    // the same version's ordinary string (the browser, its version and platform are unchanged)
    args: [...(WINDOWED ? ['--window-size=1280,900', '--disable-gpu'] : ['--headless=new']), `--user-agent=${CHROME_UA}`, `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
      ...(proxyPort ? [`--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>'] : ['--disable-blink-features=AutomationControlled']),
      '--window-size=1100,800', '--no-first-run', '--disable-search-engine-choice-screen'],
    viewport: { width: 1100, height: 720 },
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20_000 });
  const id = new URL(sw.url()).host;
  const tabs = [ctx.pages()[0] || await ctx.newPage()];
  let page = tabs[0];
  const d = {
    name: 'chrome',
    ext: (p) => `chrome-extension://${id}/${p}`,
    goto: async (url) => { await page.goto(url, { waitUntil: 'load', timeout: 20_000 }).catch((e) => { if (!/ERR_|interrupted|Timeout \d+ms exceeded/.test(String(e))) throw e; }); },
    js: (fn, ...args) => page.evaluate(`(${fn})(...${JSON.stringify(args)})`),
    click: (sel) => page.click(sel, { timeout: 8000 }),
    fill: async (sel, v) => { await page.fill(sel, ''); await page.type(sel, v); },
    key: (k) => page.keyboard.press(k),
    clickAt: (x, y) => page.mouse.click(x, y),
    files: (sel, file) => page.setInputFiles(sel, file),
    tab: async (i) => { while (tabs.length <= i) tabs.push(await ctx.newPage()); page = tabs[i]; await page.bringToFront(); },
    shot: (file) => page.screenshot({ path: file }),
    cookies: async () => (await ctx.cookies()).map((c) => c.name),
    pages: () => ctx.pages().map((p) => p.url()),
    // (harness only) every response of the current page whose address matches, with its body: a provider's own
    // verdict on an answer, read from the network as the browser received it
    watch: (pattern) => {
      const got = [];
      const re = new RegExp(pattern);
      page.on('response', async (r) => {
        if (!re.test(r.url())) return;
        let body = '';
        try { body = await r.text(); } catch { body = ''; }
        got.push({ url: r.url(), status: r.status(), body: body.slice(0, 8000), at: Date.now() });
      });
      return got;
    },
    page: () => page,
    close: async () => { await ctx.close().catch(() => undefined); fs.rmSync(profile, { recursive: true, force: true }); },
  };
  return d;
}

async function startFirefox({ proxyPort, ext, headed, net }) {
  const { Builder, By, Key } = await import('selenium-webdriver');
  const firefox = await import('selenium-webdriver/firefox.js');
  const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-e2e-f-')), 'addon.zip');
  execFileSync('zip', ['-qrX', zip, '.'], { cwd: ext });
  const o = new firefox.Options();
  const bin = firefoxPath();
  if (bin) o.setBinary(bin);
  o.addArguments('-headless');
  // the add-on's own pages are opened from the browser's side (WebDriver may not navigate to moz-extension: itself)
  o.windowSize({ width: 1100, height: 800 });
  if (net) o.enableBidi();
  const prefs = {
    ...(proxyPort ? { 'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': proxyPort,
      'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': proxyPort, 'network.proxy.no_proxies_on': '',
      'network.proxy.allow_hijacking_localhost': true } : {}),
    // the add-on's page addresses are known to the test (moz-extension://<uuid>/popup.html)
    'extensions.webextensions.uuids': JSON.stringify({ 'captcha-solver@browsa.io': FIREFOX_UUID }),
    'browser.shell.checkDefaultBrowser': false, 'datareporting.policy.dataSubmissionEnabled': false,
    'app.update.auto': false, 'browser.aboutwelcome.enabled': false,
    'accessibility.tabfocus': 7,          // Tab reaches links and buttons too (on macOS that is a system setting)
  };
  for (const [k, v] of Object.entries(prefs)) o.setPreference(k, v);
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  // BiDi on a port of its own (geckodriver's default, 9222, may be held by another browser on this machine)
  if (net) service.addArguments('--websocket-port', String(await new Promise((res) => { const s = net_.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); })));
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(o).setFirefoxService(service).build();
  await driver.installAddon(zip, true);
  await driver.manage().setTimeouts({ script: 20_000, pageLoad: 20_000 });
  const handles = [await driver.getWindowHandle()];
  const one = (sel) => driver.findElement(By.css(sel));
  const d = {
    name: 'firefox',
    ext: (p) => `moz-extension://${FIREFOX_UUID}/${p}`,
    goto: async (url) => {
      if (!url.startsWith('moz-extension:')) { await driver.get(url).catch((e) => { if (!/Reached error page|timeout/i.test(String(e))) throw e; }); return; }
      await driver.switchTo().window(await driver.getWindowHandle());     // this tab in front (install opened another)
      await driver.setContext(firefox.Context.CHROME);
      try {
        await driver.executeScript('gBrowser.selectedBrowser.fixupAndLoadURIString(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })', url);
      } finally { await driver.setContext(firefox.Context.CONTENT); }
      for (let i = 0; i < 60; i++) {
        const ok = await driver.executeScript('return location.href === arguments[0] && document.readyState === "complete"', url).catch(() => false);
        if (ok) return;
        await sleep(100);
      }
      throw new Error('extension page did not load: ' + url);
    },
    js: (fn, ...args) => driver.executeScript(`return (${fn}).apply(null, arguments)`, ...args),
    click: async (sel) => { const e = await one(sel); await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', e); await e.click(); },
    fill: async (sel, v) => { const e = await one(sel); await e.clear(); await e.sendKeys(v); },
    key: (k) => driver.actions().sendKeys(Key[k.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()] || k).perform(),
    clickAt: (x, y) => driver.actions().move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).click().perform(),
    files: async (sel, file) => { await (await one(sel)).sendKeys(file); },
    tab: async (i) => {
      while (handles.length <= i) { await driver.switchTo().newWindow('tab'); handles.push(await driver.getWindowHandle()); }
      await driver.switchTo().window(handles[i]);
    },
    shot: async (file) => fs.writeFileSync(file, Buffer.from(await driver.takeScreenshot(), 'base64')),
    cookies: async () => (await driver.manage().getCookies()).map((c) => c.name),
    pages: async () => { const out = []; const cur = await driver.getWindowHandle(); for (const h of await driver.getAllWindowHandles()) { await driver.switchTo().window(h); out.push(await driver.getCurrentUrl()); } await driver.switchTo().window(cur); return out; },
    close: async () => { await driver.quit().catch(() => undefined); fs.rmSync(path.dirname(zip), { recursive: true, force: true }); },
  };
  // (harness only, start(..., { net: true })) the provider's verdict requests with their bodies, through WebDriver
  // BiDi: network.responseCompleted events and the response bodies kept by a data collector (Firefox 143+)
  if (net) {
    d.watch = async (pattern) => {
      const got = [];
      const re = new RegExp(pattern);
      const bidi = await driver.getBidi();
      await bidi.send({ method: 'network.addDataCollector', params: { dataTypes: ['response'], maxEncodedDataSize: 2_000_000 } }).catch(() => undefined);
      await bidi.subscribe('network.responseCompleted');
      bidi.socket.on('message', async (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.method !== 'network.responseCompleted') return;
        const url = m.params?.request?.url || '';
        if (!re.test(url)) return;
        const r = await bidi.send({ method: 'network.getData', params: { dataType: 'response', request: m.params.request.request } }).catch(() => null);
        const bytes = r?.result?.bytes;
        const body = !bytes ? '' : bytes.type === 'base64' ? Buffer.from(bytes.value, 'base64').toString('utf8') : String(bytes.value || '');
        got.push({ url, status: m.params?.response?.status, body: body.slice(0, 8000), at: Date.now() });
      });
      return got;
    };
  }
  return d;
}

/** Start `name` ('chrome' | 'firefox') with the built extension; returns the driver plus a few shared helpers. */
export async function start(name, { proxyPort, dir, headed, net } = {}) {
  const ext = path.join(root, 'dist', dir || name);
  if (!fs.existsSync(path.join(ext, 'manifest.json'))) throw new Error(`build first: dist/${name} is missing`);
  const d = name === 'firefox' ? await startFirefox({ proxyPort, ext, headed, net }) : await startChrome({ proxyPort, ext, headed });
  d.until = async (fn, args = [], ms = 12_000, what = '') => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      try { last = await d.js(fn, ...args); } catch (e) { last = undefined; }
      if (last) return last;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what || fn.toString().slice(0, 80)} (last: ${JSON.stringify(last)})`);
  };
  d.text = (sel) => d.js((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  return d;
}
