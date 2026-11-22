// Every sentence a person reads comes from _locales/<lang>/messages.json (English is complete; another language
// is one more file). In the browser the text is the browser's choice of locale (chrome.i18n); where that API is
// missing (unit tests) the bundled English is used, so the two can never differ.
import en from '../_locales/en/messages.json';

export type MsgKey = keyof typeof en;
const EN = en as Record<string, { message: string }>;

export function t(key: MsgKey, ...subs: Array<string | number>): string {
  const args = subs.map(String);
  let s = '';
  try { s = (globalThis as any).chrome?.i18n?.getMessage?.(key, args) || ''; } catch { s = ''; }
  if (s) return s;
  return (EN[key]?.message || String(key)).replace(/\$(\d)/g, (_m, n) => args[Number(n) - 1] ?? '');
}

export const hasMsg = (key: string): key is MsgKey => Object.prototype.hasOwnProperty.call(EN, key);

/** Fills a page's text from its data-i18n attributes: data-i18n (text), data-i18n-title, data-i18n-placeholder,
 * data-i18n-label (aria-label). */
export function localize(root: ParentNode = document) {
  const each = (attr: string, set: (el: HTMLElement, text: string) => void) => {
    root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
      const k = el.getAttribute(attr) || '';
      if (hasMsg(k)) set(el, t(k));
    });
  };
  each('data-i18n', (el, s) => { el.textContent = s; });
  each('data-i18n-title', (el, s) => { el.title = s; });
  each('data-i18n-placeholder', (el, s) => { (el as HTMLInputElement).placeholder = s; });
  each('data-i18n-label', (el, s) => { el.setAttribute('aria-label', s); });
}
