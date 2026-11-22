# Browsa Captcha Solver

A browser extension that solves the captcha in front of you with human-like input, using your Browsa API key.

[![ci](https://github.com/browsa-io/captcha-solver/actions/workflows/ci.yml/badge.svg)](https://github.com/browsa-io/captcha-solver/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

This repository is the extension's full source (Manifest V3, Chrome and Firefox from one codebase). The solving
service it calls, Browsa's captcha API, is not part of it.

## Install

- **Chrome** (also Brave, Edge and Opera):
  [Chrome Web Store](https://chromewebstore.google.com/detail/browsa-captcha-solver/plmcdhefocmbmnoccgoghbnidepemhdk)
- **Firefox** (140 or later): pending Mozilla review. It will be at
  [addons.mozilla.org/firefox/addon/browsa-captcha-solver](https://addons.mozilla.org/firefox/addon/browsa-captcha-solver/)
  once approved. Until then you can [build it from source](#build-from-source).

The stores may still serve an earlier version than this source; `package.json` has the version built here.

## Get a key

1. Sign up at [app.browsa.io/signup](https://app.browsa.io/signup). A new account gets 25 free solves to try it.
2. In the dashboard, open **API keys** and create a key.
3. Click the extension's icon, paste the key, **Save**.

Each answer the service gives uses Browsa credits (a picture puzzle can take several answers); an answer it cannot
give is free. The panel shows what each captcha was charged and what is left, and one click on "That was wrong"
reports the last answer of a solve a site refused (Browsa decides about refunds).

## Settings

The panel has the key, on/off, Auto or Manual, Solve, a switch per type, and this site's switches. **Options** has
the rest: for every type "Solve" and "By itself" separately, extra tries after a failed solve and the wait before
each, where the Solve button shows on the page, a skip list or "only the sites below", the sites where picture text
is solved without asking, Trusted input, the server, and export and import of the settings (your key stays out of
the file unless you tick it).

A picture captcha the extension does not recognise: right-click the picture, **Browsa Solver: this picture is a
captcha**, then right-click its field, **the answer goes in this field**. It is remembered for that site.

## What it solves today

| Type | Chrome: accepted | median | credits per solve | Firefox: accepted | median | credits per solve | On by default in |
|---|---|---|---|---|---|---|---|
| reCAPTCHA v2 (checkbox) | 31 of 33 | 14.5 s | 0.0071 | 11 of 13 | 56.6 s | about 0.1 (see below) | Chrome only |
| GeeTest v3 slide | 15 of 15 | 12 s | 0.0091 | 15 of 15 | 12.2 s | 0.0096 | Chrome and Firefox |
| GeeTest v4 slide | 15 of 15 | 16.5 s | 0.0133 | 15 of 15 | 16.6 s | 0.0133 | Chrome and Firefox |
| Image text (22 Nov) | 14 of 15 | 9.4 s | 0.01 | 15 of 15 | 9.4 s | 0.01 | Chrome and Firefox |
| AWS WAF captcha | 26 of 26 | 16 s | 0.0115 | no puzzle shown in 15 visits | - | - | Chrome only |
| ALTCHA | 30 of 30 | 4.3 s | free | 15 of 15 | 4.6 s | free | Chrome and Firefox |

Measured on 2026-11-21 (image text on 2026-11-22, after the service changed how it reads it) with the 0.2.0 store packages against the live service: 15 attempts per type and browser, a
fresh profile per attempt, a new challenge on every page load, on a home connection. Chrome is Chrome for Testing in a
window; Firefox is Firefox 160 headless under geckodriver, which reports `navigator.webdriver` as true (a person's
Firefox does not: a harder case). Median: seconds from page load to the widget's pass, accepted attempts. Credits:
what the service charged per accepted solve.

**Confirmation pass on the final build** (22 Nov, Chrome, 5 attempts each, spaced out): reCAPTCHA v2 5 of 5, GeeTest v3 5 of 5, GeeTest v4 5 of 5, AWS WAF 5 of 5, ALTCHA 5 of 5. No miss.

**A pass counts only when the site's own server accepts the answer**: Google's reCAPTCHA demo page saying
"Verification Success", a public GeeTest demo page whose server validates the result, a public image-text demo page answering "Correct!", for AWS WAF the WAF token being set and the page behind the captcha loading, and for ALTCHA
Browsa's own ALTCHA deployment checking the proof on its server. Ticking a box or dragging a slider is not counted.

Read these numbers for what they are:

- A home connection with a fresh profile is a friendly case for reCAPTCHA. From a data-centre address, or in a
  browser Google distrusts, it asks for more picture rounds.
- ALTCHA: the extension only ticks the box; the widget does its own proof of work. Free, and nothing is sent.
- The list is per browser. In Firefox, reCAPTCHA and AWS WAF are off for a new install (see "Not solved" below);
  GeeTest and ALTCHA are on.

### Not solved

- **Image text** (listed): on 21 Nov it was below the bar (82 of 98 through the extension, both browsers; every answer was typed exactly as the service gave it, so the misses were the service's readings). The service reads it with a stronger model since 21 Nov 18:34 UTC, at 0.01 credits a solve since 22 Nov. Measured again through the final extension build on 22 Nov, 15 attempts per browser on the same demo: Chrome 14 of 15, Firefox 15 of 15, median 9.4 s in both, 0.01 credits a solve. Listed again in both browsers. As before, a site is asked once before its picture captchas are solved by themselves.
- **reCAPTCHA in Firefox**: under the bar where it could be measured, so it is off for a new install of the Firefox add-on and not on its list (in Chrome it is listed). 11 of 13 accepted, median 56.6 s from page load, about 10 answers (about 0.1 credits) a solve. The Firefox in the measurement is driven by geckodriver and says so to every site (`navigator.webdriver` is true), and Google answered with more and longer picture rounds (two attempts ran out of time). A person's own Firefox does not say that and should be treated like Chrome was, but that could not be measured here: an unsigned add-on can only be loaded into a driven Firefox. The run was stopped at 13 attempts: two misses already put 15 under the bar, and the solves had used up the workspace's hourly limit of the API. One switch in Options turns it on.
- **Cloudflare Turnstile**: nothing to credit. On Browsa's own widget (a real key, managed mode; the page's server asks Cloudflare's siteverify), in a Chrome that nothing is attached to, 14 of 15 visits passed by themselves and the extension did not act in any of them. In a browser driven over the debugging protocol Cloudflare shows the checkbox and does not take the click (0 of 2 in Chrome). Off and unlisted.
- **Cloudflare's check page**: the same click; not measured again (0 of 3 on 21 Nov with 0.1.1). Off and unlisted.
- **hCaptcha**: the captcha API has no hCaptcha task today (its public type list), so there is nothing to measure. Off and unlisted.
- **DataDome slider**: the API's slider task is switched off. Off and unlisted.
- **Press & hold**: no public page with a server verdict and no API task; Chrome only (it needs Trusted input), not available in Firefox. Off and unlisted.
- **Other GeeTest v4 puzzles** (icons, match, and so on): the API offers the slide task only; another puzzle is reported as "This puzzle type isn't supported yet".
- **reCAPTCHA v3**: nothing to solve in the page (a score only), so no minimum-score setting: the service's `minScore` belongs to its token task, which the extension does not use.
- **AWS WAF in Firefox**: no Firefox number. The page used for measuring let Firefox through without a puzzle in 15 of 16 visits (the one puzzle it showed fell in the minutes when the key was at its hourly limit). Off for a new install in Firefox (one switch in Options); the code is the same as in Chrome.

These ship switched off (Options, "Not ready yet") and unlisted. A type joins a browser's list only after at least 15
attempts through the extension in that browser with at least 9 in 10 accepted by the site's server.

## How it works

![One pointer move and one slider track, as the extension plans them](docs/motion.png)

- **A content script in every frame.** It runs in each page and frame (`all_frames`), finds a supported captcha,
  and starts the one watcher that frame needs. On pages without a supported captcha it does nothing.
- **Provider checks before anything is spent.** reCAPTCHA, hCaptcha and DataDome are solved automatically only
  when the widget's frame comes from the provider's own address. GeeTest and AWS WAF are solved automatically only
  when the page loaded the provider's own scripts. Class names alone never count.
- **Human-like input.** Pointer paths follow a curved, minimum-jerk track with Fitts's-law timing, small tremor and
  overshoot. Slider drags start fast and settle. Typed answers go key by key with natural gaps
  ([`src/lib/human.ts`](src/lib/human.ts)). By default these are DOM pointer, mouse and key events in the captcha's
  own frame. With **Trusted input** (Chrome only, off by default), the same gestures go through Chrome's debugger
  interface as real input, and Chrome shows a bar while it is attached.
- **No remote code.** Everything that runs is in the package. The API returns only answers: tile numbers, text,
  or a slide distance.

### What is sent, and when

This matches [PRIVACY.md](PRIVACY.md), which is the policy.

The extension talks to one service, Browsa's captcha API (`https://captcha.browsa.io` unless you change the server
in Options), and only in these cases:

- **Solving a captcha**, after a solve was allowed to start:
  - reCAPTCHA, hCaptcha and DataDome: automatically, when the widget's own frame comes from the provider's address
    (google.com / recaptcha.net, hcaptcha.com, captcha-delivery.com).
  - GeeTest and AWS WAF: automatically, when the page loaded the provider's own scripts (geetest.com, awswaf.com).
  - Picture-text captchas: automatically only on sites where you answered "Solve" to the question the extension
    asks the first time, or where you marked the picture yourself. On any other site, only when you press Solve.
  - Anything, when you press Solve (the panel's button, the button on the page, or Alt+Shift+S).
  - At most 3 automatic solves per page load and 10 per site per hour. After an answer was typed, the next picture
    on that page waits 30 s. A picture already solved is never sent again.
- **Checking your key**, when you open the panel, when you change the key and after a paid solve: your key only.
- **Reporting a wrong answer**, only when you press "That was wrong": your key and that answer's id.

`test/e2e` checks this in real browsers: the browser's only way out is a recording proxy, and the run fails if an
install, a solve and a report reach any host other than the page, the API and the welcome page.

A solve sends the captcha's own picture or pictures and its question, the host name of the site (for example
`example.com`, never the full address), and your API key. For hCaptcha, and for any captcha whose picture a page
script cannot read, the picture is a crop of the visible tab limited to the captcha. The rest of the screenshot
never leaves the browser.

It never sends cookies, the page's HTML or text, form contents, passwords, your browsing history, or anything from
pages without a supported captcha. ALTCHA, Turnstile, Cloudflare's check page and Press & hold are handled in the
page itself, and nothing is sent for them.

Browsa does not store captcha pictures. A solve's answer is deleted after 10 minutes. What is kept, on the
server and in your browser, is listed in [PRIVACY.md](PRIVACY.md#what-is-kept).

It also fetches GeeTest's own puzzle pictures from GeeTest's servers (the same files the page already loaded), and
on install opens `https://browsa.io/extension` in a new tab.

![Sent to Browsa: the captcha's picture and question, the site's host name, your API key. Never: cookies or passwords, page content or form data, browsing history](docs/privacy.png)

## Permissions

| Permission | Why |
|---|---|
| `storage` | Settings, your key and its last check, the sites you allowed, skip or list, the pictures you marked, and the last 50 solves, on your device. Per-session counters and recently solved answers go in session storage, cleared when the browser closes. |
| `contextMenus` | The two right-click entries: "this picture is a captcha" and "the answer goes in this field". |
| Host access `<all_urls>` | Captchas appear on any site and inside the provider's own frames, so the content script must run in those frames, and the sites cannot be listed in advance. The background uses the access to send the captcha to the API, to fetch GeeTest's pictures, and to crop a captcha from the visible tab when a page script cannot read its picture. You can narrow it yourself: Options has a skip list and "only the sites below", and the browser's own site-access setting works too. |
| `debugger` (optional, Chrome) | Requested only when you switch on Trusted input. Sends pointer and key events as real input. Nothing is read through it. |
| `webNavigation` (optional, Chrome) | Requested with Trusted input. Finds where a captcha's frame sits on the page so those events land in the right place. |
| Firefox data collection | Declared for Firefox's install prompt: `authenticationInfo` (your API key), `websiteContent` (the captcha's picture and question) and `browsingActivity` (the host name of the site a captcha is solved on). |

The keyboard shortcut Alt+Shift+S presses Solve.

## Build from source

You need Node.js 22.18 or later (the tests import TypeScript directly) and, for packaging, `zip` and `unzip`.

```bash
git clone https://github.com/browsa-io/captcha-solver.git
cd captcha-solver
npm ci
npm run typecheck
npm test                  # unit tests, no browser
npm run build             # dist/chrome
npm run build:firefox     # dist/firefox
npm run e2e               # the built package in Chrome for Testing (npx playwright-core install chromium)
npm run e2e:firefox       # the same in Firefox through geckodriver (FIREFOX=<binary> picks the browser)
```

The end-to-end suite runs the built package in a fresh browser profile on local fixture pages, against a local
stand-in for the API. It needs no key and reaches nothing on the internet.

Load the build:

- **Chrome**: open `chrome://extensions`, switch on Developer mode, click **Load unpacked**, pick `dist/chrome`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, pick
  `dist/firefox/manifest.json`.

`node scripts/build.mjs --api=https://...` changes the API address compiled in as the default. Options can also
change it.

### Reproducible build

The same source builds the same files. To check a published package against this repository:

```bash
git checkout <commit>         # the commit of the version the store serves (its package.json "version")
npm ci
npm run package               # dist/browsa-captcha-solver-<version>.zip, its sha256, every file's sha256
npm run package:firefox       # dist/browsa-captcha-solver-firefox-<version>.zip, the same

# the package the Chrome Web Store serves
curl -L -o store.crx 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3Dplmcdhefocmbmnoccgoghbnidepemhdk%26uc'
node scripts/hashes.mjs dist/chrome --against=store.crx
```

Compare files, not zip files. A zip also stores file times and order, so the zip's own sha256 only matches a zip
made the same way. `npm run package` fixes both, so its zip is identical on every machine with Info-ZIP's `zip`.
The stores add their own files: a `.crx` carries `_metadata/` and an `update_url` line at the top of
`manifest.json`, and a signed `.xpi` carries `META-INF/`. `scripts/hashes.mjs` leaves those out and says so.

The tree hash, one sha256 over the per-file list, is what `find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum`
prints in the build folder. Every CI run rebuilds both packages, prints these hashes, uploads the zips as a build
artifact, and compares with the Chrome Web Store package when the store serves the same version.

## Automation (Puppeteer, Playwright, Selenium)

The automation build is an unpacked build that takes its settings from a file, so a fresh profile needs no clicks.
Keep the key in the environment, not in a file:

```bash
cp automation.example.json automation.json    # git-ignored; edit the settings, leave apiKey as is
BROWSA_API_KEY=agt_live_... npm run build:automation                       # dist/automation
BROWSA_API_KEY=agt_live_... npm run build:automation -- --target=firefox   # dist/automation-firefox
```

The key is written only into `dist/automation/automation.json`, which is git-ignored. The settings are applied on
install and on every browser start. Set `"trustedInput": true` to use Trusted input. The automation build has the
`debugger` permission without a prompt. Wait about two seconds after the browser starts before changing settings
yourself, so the install step does not overwrite them.

Branded Google Chrome 137 and later ignores `--load-extension`. Use Chrome for Testing
(`npx @puppeteer/browsers install chrome@stable`, or the browser Playwright installs). Some sites refuse a browser
whose user agent says `HeadlessChrome` before any captcha appears. Set a normal user agent if that happens.

```js
import path from 'node:path';
const ext = path.resolve('dist/automation');

// Playwright
import { chromium } from 'playwright';
const ctx = await chromium.launchPersistentContext('/tmp/profile', {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

// Puppeteer
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: false,
  executablePath: chromeForTesting,          // path to Chrome for Testing
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
```

```python
# Selenium
import os
from selenium import webdriver
opts = webdriver.ChromeOptions()
opts.binary_location = CHROME_FOR_TESTING   # path to Chrome for Testing
ext = os.path.abspath("dist/automation")
opts.add_argument("--headless=new")
opts.add_argument(f"--load-extension={ext}")
driver = webdriver.Chrome(options=opts)
```

### Knowing the result

The automation build writes each outcome on the page's top document as `<html data-browsa-captcha="...">` and fires
a `browsa-captcha` event on `document`:

```js
// solving:<type> | solved:<type> | typed:text | failed:<type>:<reason> | skipped:<type>:<reason> | paused:... | unsupported:...
await page.waitForFunction(() => /^(solved|typed|failed|skipped|unsupported)/.test(
  document.documentElement.dataset.browsaCaptcha || ''));
const state = await page.evaluate(() => document.documentElement.dataset.browsaCaptcha);   // e.g. "solved:recaptcha"
// or: document.addEventListener('browsa-captcha', (e) => e.detail /* { state, kind, reason } */)
```

Errors arrive the same way, for example `skipped:text:no_key`, `failed:text:error_key_denied_access` or
`failed:geetest:error_zero_balance`. The store build never writes this signal, because it would tell sites that
the extension is installed.

## Project layout

| Path | What it is |
|---|---|
| `src/content/` | The content script: one module per captcha type, the in-page notice, and `main.ts`, which starts them |
| `src/lib/` | Settings (`config.ts`), provider checks (`origin.ts`), what may start a solve (`guard.ts`), motion (`human.ts`), input (`input.ts`), messages (`reasons.ts`, `i18n.ts`) |
| `src/background.ts` | The only network requests: API calls, GeeTest pictures, the tab-capture fallback, the solve log |
| `src/popup/`, `src/options/` | The panel and the Options page |
| `src/_locales/en/messages.json` | Every text a person reads (English; another language is one more file) |
| `scripts/` | `build.mjs`, `package.mjs` (store zips), `hashes.mjs` (file hashes and comparison) |
| `test/` | Unit tests (`npm test`) with fixture pages in `test/fixtures`; `test/e2e/` runs the built package in Chrome and Firefox. No keys or network needed |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately to support@browsa.io
([SECURITY.md](SECURITY.md)). Changes per version: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE), Copyright (c) 2026 Browsa Technologies LLC. The license covers this code. It does not grant use of
the Browsa name or logo, or access to the Browsa API, which needs an account.

`static/fonts/hanken-grotesk.woff2` is Hanken Grotesk, Copyright 2021 The Hanken Grotesk Project Authors, under the
SIL Open Font License 1.1 (license text in [`static/fonts/OFL.txt`](static/fonts/OFL.txt)).

## Links

- Extension page: [browsa.io/extension](https://browsa.io/extension)
- Privacy policy: [browsa.io/extension/privacy](https://browsa.io/extension/privacy)
- Support: support@browsa.io
