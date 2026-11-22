// A CSS selector for an element the person pointed at (right-click: "this picture is a captcha", "the answer goes
// in this field"), short and stable across page loads: an id that is not generated, a name, else a short path of
// tags from the nearest ancestor with a stable id. Checked to match exactly that one element before it is kept.

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, '\\$1'));
// ids that change on every load (long digit runs, hashes, framework counters) are not worth remembering
const stableId = (id: string) => !!id && id.length <= 60 && !/\d{4,}|[0-9a-f]{12,}|^(:r|ember|react-|radix-|headlessui-)/i.test(id);

function only(doc: Document | ShadowRoot, sel: string, el: Element): boolean {
  try { const all = doc.querySelectorAll(sel); return all.length === 1 && all[0] === el; } catch { return false; }
}

export function selectorFor(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id') || '';
  if (stableId(id) && only(root, '#' + esc(id), el)) return '#' + esc(id);
  for (const attr of ['name', 'alt', 'aria-label', 'placeholder', 'title']) {
    const v = el.getAttribute(attr);
    if (v && v.length <= 80) {
      const sel = `${tag}[${attr}="${v.replace(/["\\]/g, '\\$&')}"]`;
      if (only(root, sel, el)) return sel;
    }
  }
  for (const c of Array.from(el.classList)) {
    if (c.length <= 40 && !/\d{4,}/.test(c) && only(root, `${tag}.${esc(c)}`, el)) return `${tag}.${esc(c)}`;
  }
  // a path: tag:nth-of-type up to an ancestor with a stable id (or the top), at most 6 steps
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 6; depth++) {
    const cid = cur.getAttribute('id') || '';
    if (depth > 0 && stableId(cid) && root.querySelectorAll('#' + esc(cid)).length === 1) {
      parts.unshift('#' + esc(cid));
      break;
    }
    const parent: Element | null = cur.parentElement;
    const name = cur.tagName.toLowerCase();
    if (!parent) { parts.unshift(name); break; }
    const same = Array.from(parent.children).filter((x) => x.tagName === cur!.tagName);
    parts.unshift(same.length > 1 ? `${name}:nth-of-type(${same.indexOf(cur) + 1})` : name);
    cur = parent;
  }
  const path = parts.join(' > ');
  return only(root, path, el) ? path : '';
}
