// What the panel says about the key, the balance and the free trial. Numbers come from the API's answers only
// (getBalance, a task's cost block): the extension never works out a price or a remaining count by itself.
import type { KeyState } from '../background';
import { LINKS } from './reasons';
import { t } from './i18n';

const num = (n: number, max = 3) => n.toLocaleString('en-US', { maximumFractionDigits: max });

/** An amount in the unit the API named: credits for a Browsa key, dollars otherwise. */
export function amount(n: number, unit = 'credits'): string {
  return unit === 'usd' ? '$' + num(n, 6) : t('n_credits', num(n));
}

export interface Line { text: string; tone: '' | 'bad' | 'warn'; title?: string }

/** The header's one line: the free trial that is left when the API reports one, else the balance. */
export function balanceLine(k: KeyState | null | undefined): Line {
  if (!k) return { text: '', tone: '' };
  if (k.state === 'refused') return { text: t('bal_refused'), tone: 'bad' };
  if (k.state === 'trial_used') return { text: t('bal_trial_used'), tone: 'warn' };
  if (k.state === 'no_credits') return { text: t('bal_zero'), tone: 'warn' };
  const bal = typeof k.balance === 'number' ? amount(k.balance, k.unit) : '';
  if (k.state === 'offline') return { text: t('bal_offline'), tone: 'warn', title: bal };
  if (k.state !== 'ok') return { text: '', tone: '' };
  if (k.trial) {
    const day = k.trial.dailyLimit ? ' ' + t('trial_daily_title', k.trial.dailyLimit, k.trial.usedToday || 0) : '';
    return { text: t('bal_trial', k.trial.left, k.trial.total), tone: '', title: [bal, day.trim()].filter(Boolean).join(' · ') };
  }
  return { text: bal, tone: '', title: t('t_balance') };
}

export interface Notice { text: string; tone: 'bad' | 'warn'; link?: { label: string; href: string } }

/** The box under the header when the key needs something from the person, else null. */
export function keyNotice(k: KeyState | null | undefined): Notice | null {
  switch (k?.state) {
    case 'refused': return { text: t('key_refused'), tone: 'bad', link: { label: t('a_open_keys'), href: LINKS.keys } };
    case 'trial_used': return { text: t('key_trial_used'), tone: 'warn', link: { label: t('a_buy_credits'), href: LINKS.credits } };
    case 'no_credits': return { text: t('key_no_credits'), tone: 'warn', link: { label: t('a_buy_credits'), href: LINKS.credits } };
    case 'offline': return { text: t('key_offline'), tone: 'warn' };
    default: return null;
  }
}
