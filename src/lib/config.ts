// Settings, kept in chrome.storage.local. The automation build ships them in automation.json (read once, at
// install or start) so a Puppeteer / Playwright / Selenium run needs no clicks in the popup.

export type Kind = 'recaptcha' | 'text' | 'geetest' | 'awswaf' | 'hcaptcha' | 'turnstile' | 'cfchallenge' | 'altcha'
  | 'presshold' | 'datadome';

export interface KindInfo {
  name: string;
  credits: boolean;        // a solve calls Browsa's API (and is billed); false: solved in the page alone, free
  trusted?: boolean;       // needs "Trusted input" (real pointer events through the browser's debugger)
}

export const KIND_INFO: Record<Kind, KindInfo> = {
  recaptcha: { name: 'reCAPTCHA', credits: true },
  text: { name: 'Image text', credits: true },
  geetest: { name: 'GeeTest', credits: true },
  awswaf: { name: 'AWS WAF', credits: true },
  hcaptcha: { name: 'hCaptcha', credits: true },
  turnstile: { name: 'Turnstile', credits: false },
  cfchallenge: { name: 'Cloudflare check', credits: false },
  altcha: { name: 'Altcha', credits: false },
  presshold: { name: 'Press & hold', credits: false, trusted: true },
  datadome: { name: 'DataDome slider', credits: true },
};
export const KINDS = Object.keys(KIND_INFO) as Kind[];

export interface Config {
  apiKey: string;
  apiBase: string;
  enabled: boolean;
  auto: boolean;                      // solve as soon as a captcha shows; off = the Solve button only
  types: Record<Kind, boolean>;
  skip: string[];                     // hosts never touched (a host also skips its subdomains)
  textSites: string[];                // hosts where picture-text captchas are solved without a click (the person said yes)
  textNo: string[];                   // hosts where the person said no to that question (not asked again)
  trustedInput: boolean;              // Chrome: pointer and keys through chrome.debugger (isTrusted events)
  submitText: boolean;                // image text: press Enter after typing (off: the page's own form flow)
}

declare const __API_BASE__: string;
declare const __AUTOMATION__: boolean;
declare const __TARGET__: string;

export const IS_AUTOMATION = typeof __AUTOMATION__ === 'boolean' ? __AUTOMATION__ : false;
export const TARGET = typeof __TARGET__ === 'string' ? __TARGET__ : 'chrome';
export const IS_FIREFOX = TARGET === 'firefox';

// Types are on by default only once they passed on public demo pages (the site's own verdict, at least 4 of 5).
// The rest ship off and unlisted; the popup can switch them on. Measured rows: README "Measured".
export const DEFAULT_TYPES: Record<Kind, boolean> = {
  recaptcha: true, text: true, geetest: true, awswaf: true,
  hcaptcha: false, turnstile: false, cfchallenge: false, altcha: false, presshold: false, datadome: false,
};

// Types shown in the panel and named in the store texts. A type joins this list only after it passed (see above);
// the others keep their code, stay off and read as "not supported yet" to the person.
export const LISTED: Kind[] = ['recaptcha', 'text', 'geetest', 'awswaf'];
export const listed = (k: Kind) => LISTED.includes(k);

export const DEFAULTS: Config = {
  apiKey: '',
  apiBase: typeof __API_BASE__ === 'string' ? __API_BASE__ : 'https://captcha.browsa.io',
  enabled: true,
  auto: true,
  types: { ...DEFAULT_TYPES },
  skip: [],
  textSites: [],
  textNo: [],
  trustedInput: false,
  submitText: false,
};

const hostList = (v: unknown, base: string[]) =>
  Array.isArray(v) ? [...new Set(v.map((h) => String(h).trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean))] : base;

export function merge(base: Config, over: Partial<Config> | null | undefined): Config {
  const o = over || {};
  return {
    ...base, ...o,
    types: { ...base.types, ...(o.types || {}) },
    skip: hostList(o.skip, base.skip),
    textSites: hostList(o.textSites, base.textSites),
    textNo: hostList(o.textNo, base.textNo),
  };
}

export async function load(): Promise<Config> {
  const got = await chrome.storage.local.get('config');
  return merge(DEFAULTS, got.config as Partial<Config>);
}

export async function save(c: Partial<Config>): Promise<Config> {
  const next = merge(await load(), c);
  await chrome.storage.local.set({ config: next });
  return next;
}

export function hostIn(host: string, list: string[]): boolean {
  const h = (host || '').toLowerCase().replace(/\.$/, '');
  return list.some((s) => h === s || h.endsWith('.' + s));
}
export const hostSkipped = (host: string, skip: string[]) => hostIn(host, skip);

/** Why this kind may not be solved here, or '' when it may. The order is what the person should fix first. */
export function gate(c: Config, kind: Kind, host: string): string {
  if (!c.enabled) return 'off';
  if (!c.apiKey) return 'no_key';
  if (hostSkipped(host, c.skip)) return 'site_off';
  if (!c.types[kind]) return listed(kind) ? 'type_off' : 'unsupported';
  if (KIND_INFO[kind].trusted && (IS_FIREFOX || !c.trustedInput)) return IS_FIREFOX ? 'no_trusted' : 'needs_trusted';
  return '';
}

export function kindAllowed(c: Config, kind: Kind, host: string): boolean {
  return gate(c, kind, host) === '';
}

/** API server address check for the popup's Advanced field: https only (http for a local test server). */
export function apiBaseProblem(v: string): string {
  let u: URL;
  try { u = new URL(v); } catch { return 'Not a web address'; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return 'Use an https:// address';
  if (u.search || u.hash) return 'No ? or # part';
  return '';
}
