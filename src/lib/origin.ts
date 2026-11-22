// Where a captcha really comes from. Automatic solving that costs credits runs only for a widget served by its
// provider: a frame whose own address is the provider's (the browser reports it; a page cannot fake a frame's
// origin), or, for widgets drawn in the page itself, scripts the page loaded from the provider's hosts. Class names
// alone never count: any page can write <div class="geetest_...">.
import type { Kind } from './config';

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const https = (u: string) => /^https:\/\//i.test(u);

export const PROVIDER_FRAMES: Partial<Record<Kind, (u: string) => boolean>> = {
  recaptcha: (u) => https(u) && /^(www\.)?(google\.com|recaptcha\.net)$/.test(host(u)) && /\/recaptcha\/(api2|enterprise)\//.test(u),
  hcaptcha: (u) => https(u) && /(^|\.)hcaptcha\.com$/.test(host(u)),
  turnstile: (u) => https(u) && host(u) === 'challenges.cloudflare.com',
  cfchallenge: (u) => https(u) && host(u) === 'challenges.cloudflare.com',
  datadome: (u) => https(u) && /(^|\.)captcha-delivery\.com$/.test(host(u)),
  rcaudio: (u) => https(u) && /^(www\.)?(google\.com|recaptcha\.net)$/.test(host(u)) && /\/recaptcha\/(api2|enterprise)\//.test(u),
  mtcaptcha: (u) => https(u) && /(^|\.)mtcaptcha\.com$/.test(host(u)) && /\/mtcv1\/client\/iframe\.html/.test(u),
};

/** true / false for a kind that lives in a provider frame; null for a kind drawn in the page (checked by scripts). */
export function providerFrame(kind: Kind, frameUrl: string): boolean | null {
  const f = PROVIDER_FRAMES[kind];
  return f ? f(frameUrl) : null;
}

const GEETEST = /(^|\.)(geetest|geevisit)\.com$/;
const TENCENT = /(^|\.)(captcha\.qcloud\.com|captcha\.qq\.com|captcha\.gtimg\.com)$/;
const YIDUN = /(^|\.)(cstaticdun\.126\.net|dun\.163yun\.com|dun\.163\.com|necaptcha\.nosdn\.127\.net|necaptcha-nosdn\.126\.net)$/;
export const SCRIPT_HOSTS: Partial<Record<Kind, RegExp>> = {
  geetest: GEETEST,
  awswaf: /(^|\.)awswaf\.com$/,
  presshold: /(^|\.)(px-cdn\.net|px-cloud\.net|perimeterx\.net|pxchk\.net|px-cdn\.com|humansecurity\.com)$/,
  gt4match: GEETEST, gt4gobang: GEETEST, gt4icon: GEETEST, gt4nine: GEETEST, gt4svg: GEETEST,
  tcslide: TENCENT, tcclick: TENCENT,
  ydslide: YIDUN, ydinference: YIDUN, ydicon: YIDUN,
  dxrotate: /(^|\.)dingxiang-inc\.com$/,
  cutcaptcha: /(^|\.)cutcaptcha\.net$/,
  cybersiara: /(^|\.)mycybersiara\.com$/,
};

// Hosts the background may fetch a captcha's own picture (or sound) files from, per kind: the provider's static
// hosts only. Anything else is refused; a picture on another host is read from the page (canvas) or the tab.
const GEETEST_FILES = /^(static|static\d*|gcaptcha4|api|apiv6)\.(geetest|geevisit)\.com$/i;
export const FILE_HOSTS: Partial<Record<Kind, RegExp>> = {
  geetest: GEETEST_FILES, gt4match: GEETEST_FILES, gt4gobang: GEETEST_FILES, gt4icon: GEETEST_FILES,
  gt4nine: GEETEST_FILES, gt4svg: GEETEST_FILES,
  tcslide: TENCENT, tcclick: TENCENT,
  ydslide: YIDUN, ydinference: YIDUN, ydicon: YIDUN,
  dxrotate: /(^|\.)dingxiang-inc\.com$/,
  cybersiara: /(^|\.)mycybersiara\.com$/,
};

/** May the background fetch this file for a solve of this kind? https and the kind's own hosts only. */
export function fileAllowed(kind: Kind, url: string): boolean {
  const re = FILE_HOSTS[kind];
  return !!re && https(url) && re.test(host(url));
}
// HUMAN's press-and-hold is often served from the site's own address (a first-party path like /px/PXabc123/captcha/)
const FIRST_PARTY_PATH: Partial<Record<Kind, RegExp>> = { presshold: /\/px\/[A-Za-z0-9]+\/(captcha|init)/i };

/** Did this document load scripts from the provider's hosts? (resource timing and script tags; read only) */
export function providerScripts(kind: Kind, names?: string[]): boolean {
  const re = SCRIPT_HOSTS[kind];
  if (!re) return false;
  const list = names || [
    ...performance.getEntriesByType('resource').map((e) => e.name),
    ...Array.from(document.scripts).map((s) => s.src).filter(Boolean),
  ];
  const fp = FIRST_PARTY_PATH[kind];
  return list.some((u) => https(u) && (re.test(host(u)) || (!!fp && fp.test(u))));
}
