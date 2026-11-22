// One short, plain line for every way a solve can end without a pass, shown in the page (notice) and in the popup's
// recent list. Never a raw code. Links go to the place where the person can fix it. The words are in
// _locales/en/messages.json (keys r_<reason>).
import { KIND_INFO, type Kind } from './config';
import { hasMsg, t, type MsgKey } from './i18n';

export const LINKS = {
  signup: 'https://app.browsa.io/signup',
  keys: 'https://app.browsa.io/dashboard/keys',
  credits: 'https://app.browsa.io/dashboard/credits',
  welcome: 'https://browsa.io/extension',
};

export type Action = 'allow_text' | 'deny_text' | 'enable_site' | 'solve' | 'options';
export interface Explained {
  text: string;
  tone: 'error' | 'info' | 'ask';
  link?: { label: string; href: string };
  actions?: Array<{ label: string; action: Action }>;
}

/** The API's error, made finer by its description where one code covers several cases a person fixes differently
 * (a wrong key, a used-up free trial, a site that is not served). Lower case; unknown codes pass through. */
export function refine(code: unknown, description: unknown = ''): string {
  const c = String(code || '').toUpperCase();
  const d = String(description || '').toLowerCase();
  if (c === 'ERROR_KEY_DENIED_ACCESS') {
    if (/free trial/.test(d) && /used up/.test(d)) return 'trial_used';
    if (/not served/.test(d)) return 'site_blocked';
    if (/not verified/.test(d)) return 'account_unverified';
    if (/suspended/.test(d)) return 'account_suspended';
    if (/bought credits/.test(d)) return 'needs_credits';
  }
  if (c === 'ERROR_KEY_TEMP_BLOCKED' && /free trial/.test(d)) return 'trial_daily';
  return c.toLowerCase();
}

// reason -> tone, the link that fixes it, the buttons. The text is r_<key>; several reasons share one line.
interface Shape { key?: string; tone: Explained['tone']; link?: [MsgKey, string]; actions?: Array<[MsgKey, Action]>; name?: boolean; again?: boolean }
const S: Record<string, Shape> = {
  unsupported: { tone: 'info' },
  error_task_not_supported: { key: 'type_off_service', tone: 'info' },
  no_key: { tone: 'error', link: ['a_get_key', LINKS.signup] },
  error_key_denied_access: { tone: 'error', link: ['a_open_keys', LINKS.keys] },
  trial_used: { tone: 'error', link: ['a_buy_credits', LINKS.credits] },
  trial_daily: { tone: 'error', link: ['a_buy_credits', LINKS.credits] },
  needs_credits: { tone: 'error', link: ['a_buy_credits', LINKS.credits] },
  account_unverified: { tone: 'error', link: ['a_open_dashboard', LINKS.keys] },
  account_suspended: { tone: 'error' },
  site_blocked: { tone: 'info' },
  error_zero_balance: { tone: 'error', link: ['a_buy_credits', LINKS.credits] },
  error_budget_exceeded: { tone: 'error', link: ['a_credits', LINKS.credits] },
  error_key_temp_blocked: { key: 'key_limit', tone: 'error' },
  error_rate_limit: { key: 'rate_limit', tone: 'error' },
  site_off: { tone: 'info', actions: [['a_turn_on', 'enable_site']] },
  site_not_listed: { tone: 'info', actions: [['a_options', 'options']] },
  type_off: { tone: 'info', name: true },
  auto_off: { tone: 'info', name: true, actions: [['a_solve', 'solve']] },
  off: { tone: 'info' },
  needs_trusted: { tone: 'info', name: true },
  no_trusted: { tone: 'info', name: true },
  ask_site: { tone: 'ask', actions: [['a_solve', 'allow_text'], ['a_not_here', 'deny_text']] },
  text_no: { tone: 'info' },
  page_limit: { tone: 'info' },
  site_limit: { tone: 'info' },
  cooldown: { tone: 'info' },
  already_solved: { tone: 'info' },
  unverified: { tone: 'info' },
  geetest_network: { tone: 'error' },
  offline: { tone: 'error' },
  network_error: { tone: 'error' },
  error_service_unavaliable: { key: 'service_down', tone: 'error' },
  refused: { tone: 'error' },
  audio_only: { tone: 'info' },
  audio_challenge: { key: 'audio_only', tone: 'info' },
  click_puzzle: { key: 'other_puzzle', tone: 'info' },
  other_puzzle: { tone: 'info' },
  error_captcha_unsolvable: { key: 'unreadable', tone: 'error', again: true },
  unreadable: { tone: 'error', again: true },
  no_picture: { key: 'unreadable', tone: 'error', again: true },
  picture_fetch: { key: 'unreadable', tone: 'error', again: true },
  timeout: { tone: 'error', again: true },
  error_task_timeout: { key: 'timeout', tone: 'error', again: true },
  rounds: { key: 'timeout', tone: 'error', again: true },
  not_taken: { tone: 'error', name: true },
  refused_by_site: { tone: 'error' },
  hold_failed: { tone: 'error', again: true },
  new_puzzle: { tone: 'error', again: true },
  no_captcha: { tone: 'info' },
  closed: { tone: 'info' },
  expired: { tone: 'info', again: true },
  mark_image: { tone: 'info' },
  mark_input_first: { tone: 'info' },
  mark_saved: { tone: 'info' },
  mark_failed: { tone: 'error' },
  error_already_reported: { tone: 'info' },
  error_report_too_late: { tone: 'info' },
  error_report_not_solved: { tone: 'info' },
  error_report_limit: { tone: 'info' },
  error_taskid_invalid: { tone: 'info' },
  failed: { tone: 'error', again: true },
};

export function explain(reason: string, kind?: Kind | string): Explained {
  const name = kind && (KIND_INFO as Record<string, { name: string }>)[kind] ? KIND_INFO[kind as Kind].name : t('this_captcha');
  const r = String(reason || '').toLowerCase();
  const sh = S[r] || S.failed;
  const key = 'r_' + (sh.key || (S[r] ? r : 'failed'));
  let text = hasMsg(key) ? (sh.name ? t(key, name) : t(key)) : t('r_failed');
  if (sh.again) text += ' ' + t('solve_again');
  const out: Explained = { text, tone: sh.tone };
  if (sh.link) out.link = { label: t(sh.link[0]), href: sh.link[1] };
  if (sh.actions) out.actions = sh.actions.map(([label, action]) => ({ label: t(label), action }));
  return out;
}

/** What the popup says about each verdict (the reason, when there is one, is the second line). */
export const VERDICTS: Record<string, { label: MsgKey; tone: 'ok' | 'typed' | 'bad' | 'muted' }> = {
  solved: { label: 'v_solved', tone: 'ok' },
  typed: { label: 'v_typed', tone: 'typed' },
  failed: { label: 'v_failed', tone: 'bad' },
  skipped: { label: 'v_skipped', tone: 'muted' },
  unsupported: { label: 'v_unsupported', tone: 'muted' },
  paused: { label: 'v_paused', tone: 'muted' },
};

/** Reasons that are not a failure of the solver: the row says "Not solved" / "Paused", not "Failed". */
export function verdictFor(reason: string): 'skipped' | 'unsupported' | 'paused' | 'failed' {
  const r = String(reason || '').toLowerCase();
  if (['unsupported', 'error_task_not_supported', 'click_puzzle', 'other_puzzle', 'audio_only', 'audio_challenge', 'no_trusted'].includes(r)) return 'unsupported';
  if (['page_limit', 'site_limit', 'cooldown', 'ask_site', 'text_no', 'unverified', 'already_solved'].includes(r)) return 'paused';
  if (['site_off', 'site_not_listed', 'type_off', 'auto_off', 'off', 'needs_trusted', 'no_key', 'site_blocked'].includes(r)) return 'skipped';
  return 'failed';
}

/** A failed solve worth another try by itself (Options: "Tries after a failure"): the puzzle or the network, never
 * the key, the credits, a setting or a refusal by the site. */
export function retryable(reason: string): boolean {
  return ['error_captcha_unsolvable', 'unreadable', 'no_picture', 'picture_fetch', 'timeout', 'error_task_timeout', 'rounds',
    'new_puzzle', 'network_error', 'error_service_unavaliable', 'geetest_network', 'not_taken', 'hold_failed', 'failed', 'extension_error',
    'error_rate_limit'].includes(String(reason || '').toLowerCase());
}

/** FNV-1a (64-bit, as two 32-bit halves) of a string: the picture's fingerprint for "already solved". Works on http
 * pages too, where crypto.subtle does not exist. */
export function fingerprint(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
