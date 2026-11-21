// What may start a solve: the settings (gate), the person's yes for picture-text captchas on a site, the origin
// check of provider widgets, per-page and per-site limits, the pause after a typed answer, and pictures already
// solved. Pure state with an injectable clock so it can be tested; the background keeps one and saves it.
import { type Config, type Kind, KIND_INFO, gate, hostIn } from './config';

export const PAGE_MAX = 3;                 // automatic solves per page load
export const SITE_MAX = 10;                // automatic solves per site per hour
export const SITE_WINDOW_MS = 3600_000;
export const COOLDOWN_MS = 30_000;         // after a typed answer / a submit: no automatic picture-text solve
export const SOLVED_KEEP_MS = 30 * 60_000; // how long a solved picture's fingerprint (and answer) is remembered

export type Why = 'auto' | 'button';
export interface Ask { kind: Kind; why: Why; host: string; tabId: number; verified: boolean; sig?: string }
export type Decision = { ok: true; answer?: string } | { ok: false; reason: string };

export interface GuardState {
  page: Record<string, number>;                     // tabId -> solves since the page loaded
  site: Record<string, number[]>;                   // host -> times of solves
  cool: Record<string, number>;                     // `${tabId}|${host}` -> no automatic text solve before
  solved: Record<string, { at: number; answer: string }>;   // picture fingerprint -> answer
}

export class Guard {
  s: GuardState = { page: {}, site: {}, cool: {}, solved: {} };
  constructor(public now: () => number = Date.now) {}

  decide(cfg: Config, a: Ask): Decision {
    const g = gate(cfg, a.kind, a.host);
    if (g) return { ok: false, reason: g };
    const t = this.now();
    const known = a.sig ? this.s.solved[a.sig] : undefined;
    if (known && t - known.at < SOLVED_KEEP_MS) {
      // never pay twice for one picture: the button types the answer again from memory, automatic solving stops
      return a.why === 'button' && known.answer ? { ok: true, answer: known.answer } : { ok: false, reason: 'already_solved' };
    }
    if (a.why === 'button') return { ok: true };     // the person asked: no limits, no question
    if (a.kind === 'text') {
      if (!hostIn(a.host, cfg.textSites)) return { ok: false, reason: hostIn(a.host, cfg.textNo) ? 'text_no' : 'ask_site' };
      if ((this.s.cool[`${a.tabId}|${a.host}`] || 0) > t) return { ok: false, reason: 'cooldown' };
    } else if (KIND_INFO[a.kind].credits && !a.verified) {
      return { ok: false, reason: 'unverified' };
    }
    if (KIND_INFO[a.kind].credits) {
      if ((this.s.page[String(a.tabId)] || 0) >= PAGE_MAX) return { ok: false, reason: 'page_limit' };
      if (this.recent(a.host).length >= SITE_MAX) return { ok: false, reason: 'site_limit' };
    }
    return { ok: true };
  }

  recent(host: string): number[] {
    const t = this.now();
    const list = (this.s.site[host] || []).filter((x) => t - x < SITE_WINDOW_MS);
    this.s.site[host] = list;
    return list;
  }

  /** A session made its first API call: it counts against the page and the site. */
  charged(tabId: number, host: string) {
    this.s.page[String(tabId)] = (this.s.page[String(tabId)] || 0) + 1;
    this.s.site[host] = [...this.recent(host), this.now()];
  }

  newPage(tabId: number) { delete this.s.page[String(tabId)]; }

  closed(tabId: number) {
    delete this.s.page[String(tabId)];
    for (const k of Object.keys(this.s.cool)) if (k.startsWith(tabId + '|')) delete this.s.cool[k];
  }

  /** An answer was typed for this picture: remember it, and pause automatic picture-text solving on the page. */
  typed(tabId: number, host: string, sig: string, answer: string) {
    const t = this.now();
    if (sig) this.s.solved[sig] = { at: t, answer };
    this.s.cool[`${tabId}|${host}`] = t + COOLDOWN_MS;
    for (const [k, v] of Object.entries(this.s.solved)) if (t - v.at > SOLVED_KEEP_MS) delete this.s.solved[k];
  }

  /** The person submitted the form after a typed answer: the next picture waits COOLDOWN_MS from now. */
  submitted(tabId: number, host: string) {
    this.s.cool[`${tabId}|${host}`] = this.now() + COOLDOWN_MS;
  }

  load(s: Partial<GuardState> | undefined) {
    if (s) this.s = { page: s.page || {}, site: s.site || {}, cool: s.cool || {}, solved: s.solved || {} };
  }
}
