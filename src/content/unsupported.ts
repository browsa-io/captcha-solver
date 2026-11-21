// Captchas the extension knows by sight but does not solve, so the Solve button can say so instead of doing
// nothing. Read only, and only when the person presses Solve. Arkose (FunCaptcha) is never solved: it guards
// sign-up, sign-in and account-recovery pages, by decision.
import { deepAll } from '../lib/dom';

const FRAME_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)(arkoselabs\.com|funcaptcha\.com)$/, 'Arkose'],
  [/(^|\.)mtcaptcha\.com$/, 'MTCaptcha'],
  [/(^|\.)captcha\.(qcloud|qq)\.com$|(^|\.)turing\.captcha\.qcloud\.com$/, 'Tencent captcha'],
  [/(^|\.)friendlycaptcha\.(com|eu)$/, 'Friendly Captcha'],
  [/(^|\.)captchafox\.com$/, 'CaptchaFox'],
  [/(^|\.)leminnow\.com$/, 'Lemin'],
];
const ELEMENTS: Array<[string, string]> = [
  ['#FunCaptcha, [id^="arkose"], [data-pkey]', 'Arkose'],
  ['.frc-captcha', 'Friendly Captcha'],
  ['.mtcaptcha', 'MTCaptcha'],
  ['#div_for_keycaptcha', 'KeyCaptcha'],
  ['#lemin-cropped-captcha', 'Lemin'],
  ['.captchafox', 'CaptchaFox'],
];

const host = (u: string) => { try { return new URL(u, location.href).hostname.toLowerCase(); } catch { return ''; } };

export function unsupportedHere(): string[] {
  const out = new Set<string>();
  for (const f of deepAll<HTMLIFrameElement>('iframe')) {
    const h = host(f.src || '');
    for (const [re, name] of FRAME_HOSTS) if (h && re.test(h)) out.add(name);
  }
  for (const [sel, name] of ELEMENTS) if (document.querySelector(sel)) out.add(name);
  // a frame of one of these providers, where this script also runs
  const me = location.hostname.toLowerCase();
  for (const [re, name] of FRAME_HOSTS) if (re.test(me)) out.add(name);
  return [...out];
}
