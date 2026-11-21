// Reading widgets that live in shadow roots, closed ones included (Cloudflare's checkbox, Altcha): content scripts
// may open them (chrome.dom.openOrClosedShadowRoot in Chrome, element.openOrClosedShadowRoot() in Firefox). Read
// only; nothing is added to the page.

export function shadowOf(el: Element): ShadowRoot | null {
  const c = (globalThis as any).chrome;
  try { if (c?.dom?.openOrClosedShadowRoot) { const r = c.dom.openOrClosedShadowRoot(el); if (r) return r; } } catch { /* not a host */ }
  try { const f = (el as any).openOrClosedShadowRoot; if (typeof f === 'function') { const r = f.call(el); if (r) return r; } } catch { /* idem */ }
  return (el as HTMLElement).shadowRoot || null;
}

/** querySelectorAll through every shadow root under `root` (depth-first, document order within each root). */
export function deepAll<T extends Element = HTMLElement>(sel: string, root: ParentNode = document, limit = 4000): T[] {
  const out: T[] = [];
  const walk = (r: ParentNode, depth: number) => {
    if (depth > 8) return;
    out.push(...Array.from(r.querySelectorAll<T>(sel)));
    const all = r.querySelectorAll('*');
    for (let i = 0; i < all.length && i < limit; i++) {
      const s = shadowOf(all[i]);
      if (s) walk(s, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export const deepOne = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  deepAll<T>(sel, root)[0] || null;
