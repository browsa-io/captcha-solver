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
};

/** true / false for a kind that lives in a provider frame; null for a kind drawn in the page (checked by scripts). */
export function providerFrame(kind: Kind, frameUrl: string): boolean | null {
  const f = PROVIDER_FRAMES[kind];
  return f ? f(frameUrl) : null;
}

export const SCRIPT_HOSTS: Partial<Record<Kind, RegExp>> = {
  geetest: /(^|\.)(geetest|geevisit)\.com$/,
  awswaf: /(^|\.)awswaf\.com$/,
  presshold: /(^|\.)(px-cdn\.net|px-cloud\.net|perimeterx\.net|pxchk\.net|px-cdn\.com|humansecurity\.com)$/,
};
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
