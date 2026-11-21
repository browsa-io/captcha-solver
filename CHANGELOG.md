# Changelog

## Unreleased

- Source published under the MIT license (github.com/browsa-io/captcha-solver).
- `scripts/package.mjs` builds store zips that are identical on every machine; `scripts/hashes.mjs` prints every
  file's sha256 and compares a build with a published package (.zip, .crx or .xpi).

## 0.1.1 (21 Nov 2026)

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
