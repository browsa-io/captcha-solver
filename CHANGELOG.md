# Changelog

## 0.3.0 (22 Nov 2026)

Every family Browsa's own solver handles in its cloud browsers, in the extension, through the captcha API. 0.2.0 was
never uploaded: 0.3.0 replaces it and carries everything 0.2.0 had.

How it was measured: the store package (the automation build for Cutcaptcha, which needs Trusted input), a fresh
profile per attempt, the live service (`captcha.browsa.io`), a home connection in Indonesia, 22 Nov 2026. Chrome for
Testing 159 headless (`--headless=new`, an ordinary Chrome user agent), at least 15 attempts per type on fresh
challenges, counted only when the site's or the provider's own server accepted the answer; a type is on for a new
install and listed only at 15 or more attempts and 9 in 10 accepted. Each type was then checked in a windowed Chrome-family browser
(version 143, in a Linux container with a virtual display, never on a screen), and in Firefox 160 headless with 5 attempts; a type
is listed in Firefox only when all 5 passed there. A type below the bar had one fix and one more run, no more. Medians
are seconds from page load to the widget's pass; credits are what the API charged per accepted solve.

| Type | Chrome headless: accepted, median | Credits per solve | Windowed check (container) | Firefox (5) | Listed |
|---|---|---|---|---|---|
| GeeTest v4 IconCrush | 16 of 16, 14.6 s | 0.008 | 5 of 5, 14.7 s | 0 of 5 | Chrome |
| GeeTest v4 gobang | 16 of 16, 15.2 s | 0.008 | 5 of 5, 11.4 s | 0 of 3 | Chrome |
| GeeTest v4 nine photos | 16 of 16, 18.6 s | 0.01 | 3 of 4, 39 s | - | Chrome |
| GeeTest v4 matching shape | 16 of 16, 17.1 s | 0.01 | 6 of 6, 15.8 s | - | Chrome |
| GeeTest v4 icons in order | 14 of 16, 25.7 s | 0.0207 | 3 of 5, 39.6 s | - | off |
| Tencent slide | 16 of 16, 24.2 s | 0.008 | 4 of 4, 21.4 s | - | Chrome |
| Tencent click in order | 16 of 16, 33.9 s | 0.0119 | 4 of 4, 27.4 s | - | Chrome |
| NetEase Yidun slide | 15 of 15, 12.4 s (first run 13 of 15) | 0.008 | 5 of 5, 20 s | 5 of 5, 12.7 s | Chrome and Firefox |
| NetEase Yidun swap two tiles | 14 of 15, 20.0 s | 0.0114 | 5 of 5, 20.1 s | 5 of 5, 13.1 s | Chrome and Firefox |
| NetEase Yidun icons in order | 15 of 15, 20 s (first run 12 of 15) | 0.0153 | 5 of 5, 20.1 s | 5 of 5, 18.3 s | Chrome and Firefox |
| Dingxiang rotate | 15 of 16, 30.9 s (first run 11 of 13) | 0.008 | 5 of 5, 30.9 s | 5 of 5, 31.5 s | Chrome and Firefox |
| MTCaptcha | 15 of 15, 12.5 s | 0.0113 | 4 of 5, 9.2 s | 5 of 5, 24.2 s | Chrome and Firefox |
| Cutcaptcha jigsaw (Trusted input, Chrome) | 14 of 15, the solve itself 5.8 s (read after a fixed wait) | 0.008 a jigsaw (5 of 14 passes); a tick is free | - | - | Chrome |
| hCaptcha | 14 of 15, 14.8 s | 0.0321 | 4 of 5, 79.2 s | 5 of 5, 12.4 s | off |
| CyberSiARA animated letters | 14 of 14, 93.2 s | 0.01 | - | - | off |
| reCAPTCHA audio fallback | 12 of 12, 18.2 s | 0.01 | - | 0 of 2 | off |

The six 0.2.0 types (reCAPTCHA v2, GeeTest v3 and v4 slides, image text, AWS WAF, ALTCHA) keep their 0.2.0 numbers and
lists; they were not measured again. In the windowed check each passed 2 of 2. In headless Chrome one reCAPTCHA
attempt was not passed: Google gave that browser 16 picture rounds and refused it (0.23 credits), which is why the
windowed check exists.

GeeTest nine photos and MTCaptcha each had one container visit where no puzzle reached the extension; checked again in
a windowed Chrome for Testing on the measuring Mac: 5 of 5 each. GeeTest gobang's first container check was 3 of 5
("cells not read"): fixed (rows and columns read with a few pixels of tolerance), then 5 of 5. Confirmation pass on the
final build in a windowed Chrome, 1 attempt per listed type: 16 of 17, the miss reCAPTCHA v2 (Google's long picture
rounds for this connection that day; 0.15 credits).

**New**
- **GeeTest v4**: IconCrush, gobang, nine photos and the matching shape, each its own type and switch. The icon
  puzzle is built and off (below).
- **Tencent** slide and click in order; **NetEase Yidun** slide, swap two tiles and icons in order; **Dingxiang**
  rotate (see the table); **MTCaptcha**; **hCaptcha** (the families its demo serves today, read by the API's
  `HCaptchaTask`, 0.03 credits an answer); **Cutcaptcha** (Chrome, with Trusted input: its check takes only real
  input).
- **reCAPTCHA audio fallback** (its own switch): after three picture rounds without a pass, Google's audio challenge;
  the clip goes to the API's `AudioTask` (0.01 credits) and the words are typed.
- Each new type answers through a task of Browsa's captcha API that uses the same code as Browsa's cloud browsers.
  The extension reads what the page shows (the provider's own picture files, fetched from that provider's hosts
  only; the tiles' sizes; a frame's picture) and acts with the same hand-like pointer and keys as before.

**Not listed, with their numbers** (each ships off; Options, "Not ready yet")
- **hCaptcha**: 14 of 15 in headless Chrome (median 14.8 s, 0.03 credits a solve), 5 of 5 in Firefox, but worse in a
  window: 4 of 5 in the container (median 79 s, about 0.32 credits a solve) and 0 of 3 in a windowed Chrome on the
  measuring Mac (a fourth visit was stopped by hand). In a window hCaptcha's demo served mostly its "click the item
  connected to ..." scenes, which the service failed on after six answers each, every answer billed. The service has
  refused that family for free since 11:00 UTC (the extension then asks hCaptcha for another challenge);
  a windowed check after that fix was cut short by the workspace's hourly task limit: of its 1 counted visit, 0 passed (a picture family the service refused after six answers, 0.18 credits). Off; one switch in Options.
- **reCAPTCHA audio fallback**: 12 of 12 accepted (median 18.2 s, 0.01 credits), but Google showed a picture challenge
  (where the fallback starts) in only 12 of 27 visits; the other visits passed on the tick alone, so 15 attempts were
  not reached. Firefox: the clip could not be fetched (0 of 2). Off; one switch in Options.
- **GeeTest v4 icons in order**: 14 of 16 (median 25.7 s), 3 of 5 in the windowed check. Off.
- **CyberSiARA**: 14 of 14 accepted, but its device check let most fresh browsers through without the letters: 14
  attempts in 30 visits, under 15. Off.
- **Press & hold (HUMAN)**: the check never appeared to the measuring connection in 6 visits of a store's search
  pages; nothing to measure. Off (Chrome only, Trusted input).
- **In Firefox**: GeeTest v4's other puzzles (IconCrush 0 of 5, gobang 0 of 3: not solved in Firefox), Tencent (its
  demo never opened the puzzle in a headless Firefox: no attempt in 10 visits), Cutcaptcha (needs Trusted input).
  These are Chrome only.

**Changed**
- Permissions are unchanged. The background may now fetch a captcha's own picture files from each provider's own
  hosts (GeeTest, Tencent, NetEase Yidun, Dingxiang, CyberSiARA), the same files the page loaded; every other host is
  refused (`src/lib/origin.ts`, `FILE_HOSTS`).
- What is sent: for the new types, what the puzzle shows (its pictures, the tiles' sizes and positions; for GeeTest's
  IconCrush and gobang only which icon is on which tile) and, for the audio fallback, Google's sound clip. The privacy
  text says so.
- The test browsers run headless, never in a window.

**Tests**
- Detection fixtures for every new family (an ordinary page, and pages that only mention the provider or copy its
  class names without its scripts): 63 unit tests. The end-to-end suite (6 tests, the network test among them) passes
  in Chrome and Firefox; Firefox lint 0 errors, 0 warnings, 0 notices.

## 0.2.0 (22 Nov 2026, packaged, never uploaded: 0.3.0 replaces it)

Every type was measured again through the store package itself, in Chrome and in Firefox, on fresh challenges, counted
only when the site's own server accepted the answer. A type is on for a new install and listed, per browser, only with
at least 15 attempts and at least 9 in 10 accepted there. The numbers are all attempts made with the final builds.

| Type | Chrome: accepted | median | credits per solve | Firefox: accepted | median | credits per solve | Listed | How the verdict is read |
|---|---|---|---|---|---|---|---|---|
| reCAPTCHA v2 (checkbox) | **31 of 33** | 14.5 s | 0.0071 | **11 of 13** | 56.6 s | about 0.1 (see below) | Chrome only | Google's demo: its server answers "Verification Success" |
| GeeTest v3 slide | **15 of 15** | 12 s | 0.0091 | **15 of 15** | 12.2 s | 0.0096 | Chrome and Firefox | a public demo whose server validates with GeeTest |
| GeeTest v4 slide | **15 of 15** | 16.5 s | 0.0133 | **15 of 15** | 16.6 s | 0.0133 | Chrome and Firefox | a public demo whose server validates with GeeTest |
| Image text (22 Nov) | **14 of 15** | 9.4 s | 0.01 | **15 of 15** | 9.4 s | 0.01 | Chrome and Firefox | a public demo whose server answers "Correct!" / "Incorrect!" |
| AWS WAF captcha | **26 of 26** | 16 s | 0.0115 | **no puzzle shown in 15 visits** | - | - | Chrome only | AWS sets its token and serves the page behind the puzzle |
| ALTCHA | **30 of 30** | 4.3 s | free | **15 of 15** | 4.6 s | free | Chrome and Firefox | Browsa's own ALTCHA deployment: its server checks the proof |

**Confirmation pass on the final build** (22 Nov, Chrome, 5 attempts each, spaced out): reCAPTCHA v2 5 of 5, GeeTest v3 5 of 5, GeeTest v4 5 of 5, AWS WAF 5 of 5, ALTCHA 5 of 5. No miss.

**New**
- **ALTCHA** is listed in both browsers: the box is ticked like a hand and the page's own proof of work runs. Free,
  nothing is sent.
- **Options page** (panel, "Options"): for every type, "Solve" and "By itself" are separate switches; extra tries
  after a failed solve (0 to 3) and the wait before each; where the Solve button shows on the page; a skip list, or
  "only the sites below"; the sites where picture text is solved without asking; Trusted input; the server; export
  and import of the settings (the key stays out of the file unless you tick it).
- **A Solve button on the page**, shown only while a captcha waits for a click (Manual mode, or a type that does not
  solve by itself), next to the captcha or in a corner.
- **Right-click a picture captcha the detector missed**: "this picture is a captcha", then right-click its field,
  "the answer goes in this field". Remembered for the site (Options, Sites), removable.
- **What each solve cost**, in the panel's recent list, as the API charged it ("0.01 credits." or "Not charged.").
- **"That was wrong"**: one click on a paid solve the site refused tells Browsa. The panel shows what Browsa
  answered (reported, and whether anything was given back). Browsa decides about refunds; the extension promises
  none.
- **Free trial in the header**: "21 of 25 free solves left" when the service reports a trial with the balance (it
  does once the captcha API carries the `trial` field added with this release; until then the header shows the
  balance in credits).
- **Plain words for every failure, with what to do**: no key, key refused, free solves used up, today's free solves
  used, out of credits, monthly limit, a type the service has switched off, a site Browsa does not serve, too many
  solves at once, offline, the service unreachable. Where the API says what to do (its `fix`) and whether anything
  was charged (its `charged`), that is what is shown.
- One call per solve: the request is held by the API until the answer is ready (`waitSeconds`); there is no poll
  timer anywhere.
- Every text comes from `_locales/en/messages.json` (English complete; another language is one more file).

**Changed**
- **Image text costs 0.01 credits a solve** (the service's price since 22 Nov; it was 0.004). It stays listed: it was
  measured again on 22 Nov after the service changed how it reads (see "Image text" below).
- The panel is smaller: key, on/off, mode, Solve, the type switches, this site, recent solves. Everything else moved
  to Options.
- Keyboard and screen readers: every control has a name, Tab reaches each one with a visible ring (the on/off
  switch had none), the Auto/Manual switch takes the arrow keys, text contrast is at least 4.5 to 1.
- Permissions: `contextMenus` is new (the two right-click entries). Host access is unchanged; README "Permissions"
  says why it cannot be narrower.
- Firefox: needs Firefox 140 or later (the first with the built-in data consent the add-on declares); the consent
  now also names the host name of the site a captcha is solved on (`browsingActivity`); the Browsa "B" icons;
  `static/fonts/OFL.txt` names the right font.
- Store packages are reproducible for both browsers and the Firefox source zip (`npm run package:store`).

**Tests**
- Detection fixtures, positive and negative (ordinary forms, an article about captchas, lookalike class names, an
  `.svg` logo, a heavy page), as unit tests and again in real browsers.
- An end-to-end suite that loads the built package in Chrome for Testing and in Firefox, on local fixture pages,
  against a local stand-in for the API: first run, every failure message, every setting, Options, ordinary pages
  left alone, keyboard and contrast. It runs in CI for both browsers.
- A network test: the browser's only way out is a recording proxy; an install, a solve and a report may reach the
  page, the API and the welcome page, and nothing else.

**Not listed, and why** (each ships off; Options, "Not ready yet"), and image text
- **Image text** (listed): on 21 Nov it was below the bar (82 of 98 through the extension, both browsers; every answer was typed exactly as the service gave it, so the misses were the service's readings). The service reads it with a stronger model since 21 Nov 18:34 UTC, at 0.01 credits a solve since 22 Nov. Measured again through the final extension build on 22 Nov, 15 attempts per browser on the same demo: Chrome 14 of 15, Firefox 15 of 15, median 9.4 s in both, 0.01 credits a solve. Listed again in both browsers. As before, a site is asked once before its picture captchas are solved by themselves.
- **reCAPTCHA in Firefox**: under the bar where it could be measured, so it is off for a new install of the Firefox add-on and not on its list (in Chrome it is listed). 11 of 13 accepted, median 56.6 s from page load, about 10 answers (about 0.1 credits) a solve. The Firefox in the measurement is driven by geckodriver and says so to every site (`navigator.webdriver` is true), and Google answered with more and longer picture rounds (two attempts ran out of time). A person's own Firefox does not say that and should be treated like Chrome was, but that could not be measured here: an unsigned add-on can only be loaded into a driven Firefox. The run was stopped at 13 attempts: two misses already put 15 under the bar, and the solves had used up the workspace's hourly limit of the API. One switch in Options turns it on.
- **Cloudflare Turnstile**: nothing to credit. On Browsa's own widget (a real key, managed mode; the page's server asks Cloudflare's siteverify), in a Chrome that nothing is attached to, 14 of 15 visits passed by themselves and the extension did not act in any of them. In a browser driven over the debugging protocol Cloudflare shows the checkbox and does not take the click (0 of 2 in Chrome). Off and unlisted.
- **Cloudflare's check page**: the same click; not measured again (0 of 3 on 21 Nov with 0.1.1). Off and unlisted.
- **hCaptcha**: the captcha API has no hCaptcha task today (`GET /types`), so there is nothing to measure. Off and unlisted.
- **DataDome slider**: the API's slider task is switched off (`VisionEngine`, "off until a measured run passes"). Off and unlisted.
- **Press & hold**: no public page with a server verdict and no API task; Chrome only (it needs Trusted input), not available in Firefox. Off and unlisted.
- **Other GeeTest v4 puzzles** (icons, match, and so on): the API offers the slide task only; another puzzle is reported as "This puzzle type isn't supported yet".
- **reCAPTCHA v3**: nothing to solve in the page (a score only), so no minimum-score setting: the service's `minScore` belongs to its token task, which the extension does not use.
- **AWS WAF in Firefox**: no Firefox number. The page used for measuring let Firefox through without a puzzle in 15 of 16 visits (the one puzzle it showed fell in the minutes when the key was at its hourly limit). Off for a new install in Firefox (one switch in Options); the code is the same as in Chrome.
- A first measuring pass the same day found Firefox dropping 2 of 15 GeeTest v4 solves: Firefox stopped the add-on's
  background page 30 s into a pending request. Fixed before the numbers above were taken (the background now says it
  is busy while a request is out; a request ends by its own 40 s timeout; that failure is tried again).
- Source published under the MIT license (github.com/browsa-io/captcha-solver); `scripts/package.mjs` builds store
  zips that are identical on every machine; `scripts/hashes.mjs` prints every file's sha256 and compares a build with
  a published package (.zip, .crx or .xpi).

## 0.1.1 (21 Nov 2026, packaged, never uploaded: 0.2.0 replaces it)

From an independent end-user test of 0.1.0 as published.

**Says why, where you are**
- A small notice next to the captcha (dark, in its own closed shadow root) and a readable line in the panel's recent
  list for every solve that did not pass: type not supported, no key ("Get a free key"), key refused ("Open keys"),
  out of credits ("Buy credits"), monthly limit, solving off on this site ("Turn on", shown as "Not solved", not
  "Failed"), limits reached, GeeTest's network failure, a puzzle the site would not take.
- Pressing Solve always does something visible: it solves, says which setting is off, names an unsupported type
  (Arkose, MTCaptcha, Friendly Captcha, KeyCaptcha, Lemin, CaptchaFox, Tencent), or says no captcha was found.
- GeeTest "Network failure" after the slide: presses GeeTest's own Retry once, then reports it (about 8 s, was 76 s).

**Onboarding**
- A first install opens https://browsa.io/extension.
- With no key the panel shows one line, "Get a free key" (sign-up) and "I have a key" (the key field).

**Pages cannot spend your credits**
- Picture-text captchas are solved on their own only on sites where you said yes to "Solve picture captchas on this
  site?" (asked once, in the notice); the Solve button always works.
- Provider widgets solve on their own only when they come from the provider: reCAPTCHA, hCaptcha and DataDome by the
  frame's address, GeeTest and AWS WAF by the hosts of the page's scripts. Class names no longer count.
- At most 3 automatic solves per page load and 10 per site per hour, with a notice when reached.
- After an answer is typed, and again after you submit, the next picture on the page waits 30 s unless you press
  Solve. A picture already solved is never sent again (the Solve button types the remembered answer).
- A key the API refused is not sent again until it changes.

**Panel**
- Header: the short name "Browsa Solver", the balance on one line, a red "Key refused" state with the fix and Solve
  disabled, checked again when the key changes; "0 credits" with "Buy credits".
- "Typed" is now "Answer typed", with "The site checks it when you send the form."
- Off: the whole panel dims with "The solver is off" and a Turn on button.
- Settings are now "Advanced": Trusted input, Enter after typing, skipped sites, sites allowed for picture text, and
  the server address with a validation message.
- Per-site "Picture text" switch next to "Skip site".

**New types** (off by default until they pass on public pages)
- Cloudflare Turnstile and Cloudflare's check page: the checkbox is clicked like a hand (no API call).
- Altcha: ticks the box and waits for the page's proof of work (no API call).
- Press & hold (HUMAN): held until it fills; needs Trusted input (no API call).
- hCaptcha: checkbox, and picture challenges through the new `HCaptchaClassification` API task.
- DataDome slider: gap from the API's slider task, then a hand's drag.
- reCAPTCHA v3 has nothing to solve in the browser (a score only); Arkose is detected and reported, never solved.

**Automation build**
- Outcome on the page for scripts: `<html data-browsa-captcha="solving:recaptcha | solved:recaptcha | failed:text:error_key_denied_access | ...">`
  and a `browsa-captcha` event on `document`. Never in the store build.
- The key can come from `BROWSA_API_KEY` at build time instead of a file.

**Firefox**
- `npm run build -- --target=firefox`: event page, add-on id `captcha-solver@browsa.io`, Firefox 121+, data-collection
  declaration; Trusted input and Press & hold are not available there (no debugger API) and the panel says so.

## 0.1.0 (17 Nov 2026)

First release: reCAPTCHA v2, GeeTest v3/v4 slides, AWS WAF, image text.
