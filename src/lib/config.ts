// Settings, kept in chrome.storage.local. The automation build ships them in automation.json (read once, at
// install or start) so a Puppeteer / Playwright / Selenium run needs no clicks in the popup.

export type Kind = 'recaptcha' | 'text' | 'geetest' | 'awswaf' | 'hcaptcha' | 'turnstile' | 'cfchallenge' | 'altcha'
  | 'presshold' | 'datadome'
  // 0.3.0: every family Browsa's engine solves, each with its own switch (listed per browser once measured)
  | 'rcaudio' | 'gt4match' | 'gt4gobang' | 'gt4icon' | 'gt4nine' | 'gt4svg' | 'tcslide' | 'tcclick' | 'ydslide'
  | 'ydinference' | 'ydicon' | 'dxrotate' | 'mtcaptcha' | 'cutcaptcha' | 'cybersiara';

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
  altcha: { name: 'ALTCHA', credits: false },
  presshold: { name: 'Press & hold', credits: false, trusted: true },
  datadome: { name: 'DataDome slider', credits: true },
  rcaudio: { name: 'reCAPTCHA audio', credits: true },
  gt4match: { name: 'GeeTest IconCrush', credits: true },
  gt4gobang: { name: 'GeeTest gobang', credits: true },
  gt4icon: { name: 'GeeTest icons', credits: true },
  gt4nine: { name: 'GeeTest nine photos', credits: true },
  gt4svg: { name: 'GeeTest shapes', credits: true },
  tcslide: { name: 'Tencent slide', credits: true },
  tcclick: { name: 'Tencent click', credits: true },
  ydslide: { name: 'NetEase slide', credits: true },
  ydinference: { name: 'NetEase tile swap', credits: true },
  ydicon: { name: 'NetEase icons', credits: true },
  dxrotate: { name: 'Dingxiang rotate', credits: true },
  mtcaptcha: { name: 'MTCaptcha', credits: true },
  cutcaptcha: { name: 'Cutcaptcha', credits: true, trusted: true },   // its check takes only real input (22 Nov: DOM events never got past the box)
  cybersiara: { name: 'CyberSiARA', credits: true },
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
  audioFirst: boolean;                // reCAPTCHA: go to the audio challenge from the first round (measuring only; no control)
  autoTypes: Record<Kind, boolean>;   // per type: solve by itself (when `auto` is on); off = that type waits for Solve
  siteMode: 'all' | 'allow';          // 'allow': only the hosts in `only` are touched
  only: string[];                     // the allow list (a host also allows its subdomains)
  retries: number;                    // extra tries after a solve that failed (0 to 3)
  retryDelay: number;                 // seconds before each extra try (1 to 60)
  button: ButtonPos;                  // where the in-page Solve button shows when a captcha waits for a click
  custom: Record<string, CustomText>; // host -> a picture captcha the person pointed out (right-click)
}

export type ButtonPos = 'beside' | 'top-right' | 'bottom-right' | 'bottom-left' | 'off';
export const BUTTON_POS: ButtonPos[] = ['beside', 'top-right', 'bottom-right', 'bottom-left', 'off'];
/** CSS selectors of a picture captcha and its answer field, as the person marked them on a site. */
export interface CustomText { img: string; input: string }
export const RETRIES_MAX = 3;
export const RETRY_DELAY: [number, number] = [1, 60];

declare const __API_BASE__: string;
declare const __AUTOMATION__: boolean;
declare const __TARGET__: string;

export const IS_AUTOMATION = typeof __AUTOMATION__ === 'boolean' ? __AUTOMATION__ : false;
export const TARGET = typeof __TARGET__ === 'string' ? __TARGET__ : 'chrome';
export const IS_FIREFOX = TARGET === 'firefox';

// Types are on by default only once they reached the bar through the extension itself: at least 15 attempts on
// fresh challenges, at least 90% accepted by the site's or the provider's own server. The rest ship off and
// unlisted; Options ("Not ready yet") can switch them on. Measured rows: README "Measured".
//
// 0.2.0's six types keep their 0.2.0 lists (image text listed again on 22 Nov: Chrome 14 of 15, Firefox 15 of 15).
// 0.3.0 (22 Nov 2026, Chrome headless, the live service): GeeTest v4 IconCrush, gobang, nine photos and matching
// shape; Tencent slide and click; NetEase Yidun slide, swap and icons; Dingxiang rotate; MTCaptcha; Cutcaptcha
// (Trusted input). Off, with their numbers: GeeTest v4 icons (14 of 16), hCaptcha
// (14 of 15 headless, but 4 of 7 in a window, where it serves scenes the service fails on),
// CyberSiARA (14 of 14, but only 14 of 30 visits showed the letters: under 15 attempts), Press & hold (the check
// never appeared to the measuring connection), the reCAPTCHA audio fallback (12 of 12, but Google showed a picture
// challenge in only 12 of 27 visits: under 15 attempts).
//
// The list is per browser, because the measuring is. Firefox lists a type only when a 5-attempt check passed 5 of
// 5 there. Not in Firefox: reCAPTCHA and AWS WAF (0.2.0: under the bar / no puzzle shown), and with them the audio
// fallback; GeeTest v4's other puzzles (0 of 5); Tencent (its demo never opened the puzzle in Firefox);
// Cutcaptcha (needs Trusted input, which Firefox does not have).
const MEASURED: Kind[] = ['recaptcha', 'text', 'geetest', 'awswaf', 'altcha',
  'gt4match', 'gt4gobang', 'gt4nine', 'gt4svg', 'tcslide', 'tcclick', 'ydslide', 'ydinference', 'ydicon', 'dxrotate',
  'mtcaptcha', 'cutcaptcha'];
const NOT_YET_IN_FIREFOX: Kind[] = ['recaptcha', 'awswaf', 'rcaudio', 'gt4match', 'gt4gobang', 'gt4nine', 'gt4svg',
  'tcslide', 'tcclick', 'cutcaptcha'];

// Types shown in the panel and named in the store texts. A type joins this list only after it passed (see above);
// the others keep their code, stay off and read as "not supported yet" to the person.
export const LISTED: Kind[] = MEASURED.filter((k) => !(IS_FIREFOX && NOT_YET_IN_FIREFOX.includes(k)));
export const listed = (k: Kind) => LISTED.includes(k);
export const DEFAULT_TYPES = Object.fromEntries(KINDS.map((k) => [k, LISTED.includes(k)])) as Record<Kind, boolean>;

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
  audioFirst: false,
  autoTypes: Object.fromEntries(Object.keys(KIND_INFO).map((k) => [k, true])) as Record<Kind, boolean>,
  siteMode: 'all',
  only: [],
  retries: 1,
  retryDelay: 3,
  button: 'beside',
  custom: {},
};

const hostList = (v: unknown, base: string[]) =>
  Array.isArray(v) ? [...new Set(v.map((h) => String(h).trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean))].slice(0, 500) : base;

const clampInt = (v: unknown, lo: number, hi: number, base: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : base;
};
const boolMap = (v: unknown, base: Record<Kind, boolean>) => {
  const out = { ...base };
  if (v && typeof v === 'object') for (const k of KINDS) if (typeof (v as any)[k] === 'boolean') out[k] = (v as any)[k];
  return out;
};
const cleanHost = (h: unknown) => String(h || '').trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
function customMap(v: unknown, base: Record<string, CustomText>): Record<string, CustomText> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return base;
  const out: Record<string, CustomText> = {};
  for (const [h, c] of Object.entries(v as Record<string, any>).slice(0, 200)) {
    const host = cleanHost(h);
    const img = String(c?.img || '').slice(0, 300), input = String(c?.input || '').slice(0, 300);
    if (host && img && input) out[host] = { img, input };
  }
  return out;
}

/** Settings from storage, an automation file or an imported file laid over `base`: only known fields, each checked
 * (types by name, numbers in range, host lists cleaned), so a broken or hostile file cannot put anything else in. */
export function merge(base: Config, over: Partial<Config> | null | undefined): Config {
  const o = (over && typeof over === 'object' ? over : {}) as Partial<Config>;
  const bool = (k: 'enabled' | 'auto' | 'trustedInput' | 'submitText' | 'audioFirst') => (typeof o[k] === 'boolean' ? (o[k] as boolean) : base[k]);
  return {
    apiKey: typeof o.apiKey === 'string' ? o.apiKey.trim().slice(0, 200) : base.apiKey,
    apiBase: typeof o.apiBase === 'string' && !apiBaseProblem(o.apiBase) ? o.apiBase : base.apiBase,
    enabled: bool('enabled'), auto: bool('auto'), trustedInput: bool('trustedInput'), submitText: bool('submitText'),
    audioFirst: bool('audioFirst'),
    types: boolMap(o.types, base.types),
    autoTypes: boolMap(o.autoTypes, base.autoTypes),
    skip: hostList(o.skip, base.skip),
    only: hostList(o.only, base.only),
    siteMode: o.siteMode === 'allow' || o.siteMode === 'all' ? o.siteMode : base.siteMode,
    textSites: hostList(o.textSites, base.textSites),
    textNo: hostList(o.textNo, base.textNo),
    retries: o.retries === undefined ? base.retries : clampInt(o.retries, 0, RETRIES_MAX, base.retries),
    retryDelay: o.retryDelay === undefined ? base.retryDelay : clampInt(o.retryDelay, RETRY_DELAY[0], RETRY_DELAY[1], base.retryDelay),
    button: BUTTON_POS.includes(o.button as ButtonPos) ? (o.button as ButtonPos) : base.button,
    custom: customMap(o.custom, base.custom),
  };
}

/** The settings as a file (export): everything but the key, which stays on this device unless asked for. */
export function exported(c: Config, withKey = false): Record<string, unknown> {
  const { apiKey, ...rest } = c;
  return { browsaCaptchaSolver: 1, ...(withKey ? { apiKey } : {}), ...rest };
}

/** An imported file's settings, or a reason it cannot be used. The key is kept unless the file carries one. */
export function imported(text: string, current: Config): { config?: Config; error?: string } {
  let j: any;
  try { j = JSON.parse(text); } catch { return { error: 'not_json' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.browsaCaptchaSolver !== 1) return { error: 'not_settings' };
  return { config: merge({ ...DEFAULTS, apiKey: current.apiKey }, j) };
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
  if (c.siteMode === 'allow' && !hostIn(host, c.only)) return 'site_not_listed';
  if (!c.types[kind]) return listed(kind) ? 'type_off' : 'unsupported';
  if (KIND_INFO[kind].trusted && (IS_FIREFOX || !c.trustedInput)) return IS_FIREFOX ? 'no_trusted' : 'needs_trusted';
  return '';
}

/** Does this type solve by itself here (the mode and the type's own switch)? The Solve button ignores this. */
export const autoOn = (c: Config, kind: Kind) => c.auto && c.autoTypes[kind] !== false;

export function kindAllowed(c: Config, kind: Kind, host: string): boolean {
  return gate(c, kind, host) === '';
}

/** API server address check (Options, Server): https only (http for a local test server). '' or a message key. */
export function apiBaseProblem(v: string): string {
  let u: URL;
  try { u = new URL(v); } catch { return 'server_not_address'; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return 'server_https';
  if (u.search || u.hash) return 'server_no_query';
  return '';
}
