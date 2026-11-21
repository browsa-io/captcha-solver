# Privacy

Version 0.1.1. The extension talks to one service, Browsa's captcha API (`https://captcha.browsa.io` unless you change
the server under Advanced), and only in the cases below.

## When it sends something

- **Solving a captcha.** Only after a solve was allowed to start:
  - reCAPTCHA, hCaptcha and DataDome: automatically, when the widget's own frame comes from the provider's address
    (google.com / recaptcha.net, hcaptcha.com, captcha-delivery.com). The address is checked, not the look.
  - GeeTest and AWS WAF: automatically, when the page loaded the provider's own scripts (geetest.com, awswaf.com).
  - Picture-text captchas: automatically only on sites where you answered "Solve" to the question the extension
    shows the first time (you can change the list under Advanced); on any other site only when you press Solve.
  - Anything, when you press Solve (the popup button or Alt+Shift+S).
  - At most 3 automatic solves per page load and 10 per site per hour; after an answer was typed, the next picture on
    that page waits 30 s; a picture already solved is never sent again.
- **Checking your key.** When you open the panel and when you change the key: your key only (`getBalance`).

## What a solve sends

- the captcha's own picture or pictures and its question (for example "traffic lights"). For hCaptcha this is a crop
  of the visible tab limited to hCaptcha's challenge frame (and, for its animated puzzles, a few more crops half a
  second apart); for any other captcha whose picture a page script cannot read, a crop of just that picture. The
  rest of the screenshot never leaves the browser;
- the host name of the site the captcha is on (for example `example.com`), never the full address;
- your Browsa API key, so the solve is counted for your workspace.

## What it never sends

Cookies, the page's HTML or text, form contents, passwords, your browsing history, or anything from pages without a
supported captcha. Cloudflare Turnstile, Cloudflare's check page, Altcha and Press & hold are solved in the page
itself: nothing is sent for them.

## What it fetches

GeeTest's own puzzle pictures, from GeeTest's servers, the same files the page already loaded. On install it opens
`https://browsa.io/extension` (the welcome page) in a new tab.

## What is kept

Browsa does not store captcha pictures: a solve keeps its type, the site's host, sizes, timing and model cost, and its
answer is deleted after 10 minutes. Failed solves are free.

In your browser's extension storage: settings, your key, the key's last check (state and balance), the sites you
allowed or declined for picture text, and the last 50 solves (time, site, type, result, reason). In the browser's
session storage, cleared when the browser closes: the per-page and per-site counters, and for 30 minutes the
fingerprint and answer of each picture-text captcha already solved (so the Solve button can type it again without
paying twice).

## Trusted input

Off unless you turn it on (Chrome only). It lets the extension send pointer and key events through Chrome's debugger
interface; Chrome shows a bar while it is attached. Nothing is read through it. Press & hold needs it.

## Automation build

The unpacked automation build (not the store package) also writes the outcome of each solve on the page
(`<html data-browsa-captcha="...">`) for the automation script to read. The store build never does.

Questions: support@browsa.io.
