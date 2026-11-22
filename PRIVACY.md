# Privacy

Version 0.3.0. The extension talks to one service, Browsa's captcha API (`https://captcha.browsa.io` unless you change
the server in Options), and only in the cases below. An automated test (`test/e2e`) records every request the browser
makes during an install, a solve and a report, and fails if any goes to another host.

## When it sends something

- **Solving a captcha.** Only after a solve was allowed to start:
  - reCAPTCHA (its pictures and its audio challenge), hCaptcha, MTCaptcha and DataDome: automatically, when the
    widget's own frame comes from the provider's address (google.com / recaptcha.net, hcaptcha.com, mtcaptcha.com,
    captcha-delivery.com). The address is checked, not the look.
  - GeeTest, AWS WAF, Tencent, NetEase Yidun, Dingxiang, Cutcaptcha and CyberSiARA: automatically, when the page
    loaded the provider's own scripts (geetest.com, awswaf.com, Tencent's captcha.qcloud.com / captcha.gtimg.com,
    NetEase's dun.163.com / 126.net / 127.net hosts, dingxiang-inc.com, cutcaptcha.net, mycybersiara.com).
  - Picture-text captchas: automatically only on sites where you answered "Solve" to the question the extension
    shows the first time, or where you marked the picture yourself (right-click); on any other site only when you
    press Solve. You can change the list in Options.
  - Anything, when you press Solve (the panel's button, the button on the page, or Alt+Shift+S).
  - At most 3 automatic solves per page load and 10 per site per hour; after an answer was typed, the next picture on
    that page waits 30 s; a picture already solved is never sent again.
  - Never on a site in your skip list, or outside your allow list when you chose "only the sites below", or for a type
    you switched off.
- **Checking your key.** When you open the panel, when you change the key and after a paid solve: your key only
  (`getBalance`). The answer is your balance and, on a free trial, how many free solves are left.
- **Reporting a wrong answer.** Only when you press "That was wrong" on a solve: your key and that answer's id
  (`reportIncorrect`). Nothing about the page.

## What a solve sends

- the captcha's own picture or pictures and its question (for example "traffic lights"); for a puzzle, what the
  puzzle shows and where its parts sit (the tiles' pictures and sizes on the page, the reference icons, for GeeTest's
  IconCrush and gobang only which icon is on which tile); for reCAPTCHA's audio challenge (used only when picture
  rounds keep failing and its switch is on), Google's sound clip. For hCaptcha this is a crop
  of the visible tab limited to hCaptcha's challenge frame (and, for its animated puzzles, a few more crops half a
  second apart); for any other captcha whose picture a page script cannot read, a crop of just that picture. The
  rest of the screenshot never leaves the browser;
- the host name of the site the captcha is on (for example `example.com`), never the full address;
- your Browsa API key, so the solve is counted for your workspace.

## What it never sends

Cookies, the page's HTML or text, form contents, passwords, your browsing history, or anything from pages without a
supported captcha. ALTCHA, Cloudflare Turnstile, Cloudflare's check page and Press & hold are handled in the page
itself: nothing is sent for them. There is no analytics, no error reporting and no remote code: everything that runs
is in the package.

## What it fetches

A captcha's own puzzle files, from that provider's own servers only, the same files the page already loaded:
GeeTest's pictures, Tencent's, NetEase Yidun's and Dingxiang's pictures, and CyberSiARA's animation. On install it opens
`https://browsa.io/extension` (the welcome page) in a new tab.

## What is kept

Browsa does not store captcha pictures: a solve keeps its type, the site's host, sizes, timing and model cost, and its
answer is deleted after 10 minutes. A report keeps the answer's id, the type, the host and
"incorrect".

In your browser's extension storage, on this device only: settings (types, sites you skip or allow, tries after a
failure, the button's place), your key, the key's last check (state, balance, free solves left), the sites you allowed
or declined for picture text, the selectors of pictures you marked (per site), and the last 50 solves (time, site,
type, result, reason, what the API charged, the answer's id for a report). In the browser's session storage, cleared
when the browser closes: the per-page and per-site counters, and for 30 minutes the fingerprint and answer of each
picture-text captcha already solved (so the Solve button can type it again without paying twice).

Export (Options) writes your settings to a file you choose; your key is left out unless you tick "Include my API
key". Import reads such a file from your device. Neither sends anything.

## Permissions

| Permission | Why |
|---|---|
| Read and change data on all sites | A captcha can appear on any site, inside a frame served by its provider (Google, MTCaptcha, hCaptcha) or drawn by the provider's script (GeeTest, AWS, Tencent, NetEase, Dingxiang, Cutcaptcha, CyberSiARA). The extension has to look for one on the page you are on, read only its picture, and click or type only in it. It cannot know the sites in advance, so it cannot ask for a shorter list. The same access lets it send the picture to the captcha API, fetch a provider's own puzzle files from that provider's servers, and take a crop of the visible tab for a picture a page script cannot read. |
| Storage | Settings, your key and the last 50 solves, on this device. |
| Context menus | The two right-click entries: "this picture is a captcha" and "the answer goes in this field". |
| Debugger, webNavigation (Chrome, optional) | Asked for only when you switch on "Trusted input" in Options: real pointer and key events for sites that refuse page events. Nothing is read through it. Not in the Firefox package. |

## Trusted input

Off unless you turn it on (Chrome only). It lets the extension send pointer and key events through Chrome's debugger
interface; Chrome shows a bar while it is attached. Nothing is read through it. Press & hold and Cutcaptcha need it.

## Automation build

The unpacked automation build (not the store package) also writes the outcome of each solve on the page
(`<html data-browsa-captcha="...">`) for the automation script to read. The store build never does.

Questions: support@browsa.io.
