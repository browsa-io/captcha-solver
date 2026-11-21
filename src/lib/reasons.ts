// One short, plain line for every way a solve can end without a pass, shown in the page (notice) and in the popup's
// recent list. Never a raw code. Links go to the place where the person can fix it.
import { KIND_INFO, type Kind } from './config';

export const LINKS = {
  signup: 'https://app.browsa.io/signup',
  keys: 'https://app.browsa.io/dashboard/keys',
  credits: 'https://app.browsa.io/dashboard/credits',
  welcome: 'https://browsa.io/extension',
};

export type Action = 'allow_text' | 'deny_text' | 'enable_site' | 'solve';
export interface Explained {
  text: string;
  tone: 'error' | 'info' | 'ask';
  link?: { label: string; href: string };
  actions?: Array<{ label: string; action: Action }>;
}

const SOLVE_AGAIN = 'Press Solve to try again.';

export function explain(reason: string, kind?: Kind | string): Explained {
  const name = kind && (KIND_INFO as Record<string, { name: string }>)[kind] ? KIND_INFO[kind as Kind].name : 'This captcha';
  const r = String(reason || '').toLowerCase();
  switch (r) {
    case 'unsupported':
    case 'error_task_not_supported':
      return { text: "This captcha type isn't supported yet", tone: 'info' };
    case 'no_key':
      return { text: 'Add your Browsa API key', tone: 'error', link: { label: 'Get a free key', href: LINKS.signup } };
    case 'error_key_denied_access':
      return { text: 'Your key was refused. Check it in the dashboard.', tone: 'error', link: { label: 'Open keys', href: LINKS.keys } };
    case 'error_zero_balance':
      return { text: 'Out of credits', tone: 'error', link: { label: 'Buy credits', href: LINKS.credits } };
    case 'error_budget_exceeded':
      return { text: "Your workspace's monthly limit is reached", tone: 'error', link: { label: 'Credits', href: LINKS.credits } };
    case 'error_key_temp_blocked':
    case 'error_rate_limit':
      return { text: "Your key's solving limit is reached for now. Try again later.", tone: 'error' };
    case 'site_off':
      return { text: 'Solving is off on this site', tone: 'info', actions: [{ label: 'Turn on', action: 'enable_site' }] };
    case 'type_off':
      return { text: `${name} solving is off (switch it on in the panel)`, tone: 'info' };
    case 'off':
      return { text: 'The solver is switched off', tone: 'info' };
    case 'needs_trusted':
      return { text: `${name} needs "Trusted input" (panel, Advanced)`, tone: 'info' };
    case 'no_trusted':
      return { text: `${name} needs real pointer input, which this browser does not offer`, tone: 'info' };
    case 'ask_site':
      return { text: 'Solve picture captchas on this site?', tone: 'ask',
        actions: [{ label: 'Solve', action: 'allow_text' }, { label: 'Not here', action: 'deny_text' }] };
    case 'text_no':
      return { text: 'Picture captchas are not solved on this site. Press Solve to solve one.', tone: 'info' };
    case 'page_limit':
      return { text: 'Paused after 3 solves on this page. Press Solve to go on.', tone: 'info' };
    case 'site_limit':
      return { text: 'Paused after 10 solves on this site in an hour. Press Solve to go on.', tone: 'info' };
    case 'cooldown':
      return { text: 'Waiting 30 s after your last answer. Press Solve to solve now.', tone: 'info' };
    case 'already_solved':
      return { text: 'This picture was already solved', tone: 'info' };
    case 'unverified':
      return { text: "This doesn't come from the captcha's own provider, so it isn't solved by itself. Press Solve to solve it.", tone: 'info' };
    case 'geetest_network':
      return { text: "GeeTest couldn't reach its server. Try again in a moment.", tone: 'error' };
    case 'network_error':
    case 'error_service_unavaliable':
      return { text: "Couldn't reach Browsa. Check your connection.", tone: 'error' };
    case 'refused':
      return { text: 'Google refused this browser for now. Try again later.', tone: 'error' };
    case 'audio_only':
    case 'audio_challenge':
      return { text: 'Only a sound puzzle was offered, which is not supported', tone: 'info' };
    case 'click_puzzle':
    case 'other_puzzle':
      return { text: "This puzzle type isn't supported yet", tone: 'info' };
    case 'error_captcha_unsolvable':
    case 'unreadable':
    case 'no_picture':
    case 'picture_fetch':
      return { text: "Couldn't read this captcha. " + SOLVE_AGAIN, tone: 'error' };
    case 'timeout':
    case 'rounds':
      return { text: 'Took too long. ' + SOLVE_AGAIN, tone: 'error' };
    case 'not_taken':
      return { text: `${name} did not take the click. Trusted input (panel, Advanced) can help.`, tone: 'error' };
    case 'refused_by_site':
      return { text: "The site's check refused this browser for now", tone: 'error' };
    case 'hold_failed':
      return { text: 'The hold was not accepted. ' + SOLVE_AGAIN, tone: 'error' };
    case 'new_puzzle':
      return { text: 'The site asked again. ' + SOLVE_AGAIN, tone: 'error' };
    case 'no_captcha':
      return { text: 'No captcha found on this page', tone: 'info' };
    case 'closed':
      return { text: 'The puzzle was closed before it was solved', tone: 'info' };
    case 'expired':
      return { text: 'The captcha expired. ' + SOLVE_AGAIN, tone: 'info' };
    default:
      return { text: "Couldn't solve it. " + SOLVE_AGAIN, tone: 'error' };
  }
}

/** What the popup says about each verdict (the reason, when there is one, is the second line). */
export const VERDICTS: Record<string, { label: string; tone: 'ok' | 'typed' | 'bad' | 'muted' }> = {
  solved: { label: 'Solved', tone: 'ok' },
  typed: { label: 'Answer typed', tone: 'typed' },
  failed: { label: 'Failed', tone: 'bad' },
  skipped: { label: 'Not solved', tone: 'muted' },
  unsupported: { label: 'Not supported', tone: 'muted' },
  paused: { label: 'Paused', tone: 'muted' },
};

/** Reasons that are not a failure of the solver: the row says "Not solved" / "Paused", not "Failed". */
export function verdictFor(reason: string): 'skipped' | 'unsupported' | 'paused' | 'failed' {
  const r = String(reason || '').toLowerCase();
  if (['unsupported', 'error_task_not_supported', 'click_puzzle', 'other_puzzle', 'audio_only', 'audio_challenge', 'no_trusted'].includes(r)) return 'unsupported';
  if (['page_limit', 'site_limit', 'cooldown', 'ask_site', 'text_no', 'unverified', 'already_solved'].includes(r)) return 'paused';
  if (['site_off', 'type_off', 'off', 'needs_trusted', 'no_key'].includes(r)) return 'skipped';
  return 'failed';
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
