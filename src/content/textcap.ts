// Image-text captchas ("type the characters"), ported from Browsa's server-side solver. Detection is the engine's
// strict rule (a picture whose own attributes say captcha, then an answer-like field; or a field that says captcha,
// then an inline picture), because a loose rule fired on ordinary pages. The answer is typed key by key; the page's
// own form decides (Enter only when the setting says so).
//
// Any page can draw such a picture, so this is the one type that never costs credits by itself on a new site: the
// first time, the notice asks "Solve picture captchas on this site?"; the Solve button always works. A picture is
// solved once (its fingerprint and answer are remembered); after an answer was typed, and again after the person
// submits, the next picture on the page waits 30 s unless the person presses Solve.
import type { Ctx } from './main';
import { canvasData, capture, solveTask } from '../lib/msg';
import { boxOf, idle, pressEnter, sleep, typeInto, visible } from '../lib/input';
import { fingerprint } from '../lib/reasons';
import type { CustomText } from '../lib/config';

const hints = (el: Element, keys: string[]) => keys.map((k) => el.getAttribute(k) || '').join(' ').toLowerCase();
const isTextInput = (el: Element): el is HTMLInputElement =>
  el.tagName === 'INPUT' && ['text', ''].includes((el.getAttribute('type') || 'text').toLowerCase());

function strongImg(el: Element): el is HTMLImageElement {
  if (el.tagName !== 'IMG') return false;
  const src = (el.getAttribute('src') || '').toLowerCase();
  return hints(el, ['alt', 'id', 'class', 'src', 'title', 'name']).includes('captcha') && !src.endsWith('.svg');
}

function inlineImg(el: Element): el is HTMLImageElement {
  const src = (el.getAttribute('src') || '').toLowerCase();
  return el.tagName === 'IMG' && (src.startsWith('data:image') || src.startsWith('blob:')) && !src.startsWith('data:image/svg');
}

function answerLike(el: Element): boolean {
  return isTextInput(el) && /captcha|answer|code|characters|text/.test(hints(el, ['placeholder', 'name', 'id', 'aria-label']));
}

/** The picture and field the person marked on this site (right-click), when both are on the page now. */
export function customParts(custom: CustomText | undefined, doc: Document = document): [HTMLImageElement, HTMLInputElement] | null {
  if (!custom) return null;
  try {
    const img = doc.querySelector(custom.img), input = doc.querySelector(custom.input);
    const field = input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA');
    return img && img.tagName === 'IMG' && field ? [img as HTMLImageElement, input as HTMLInputElement] : null;
  } catch {
    return null;                                       // a selector that no longer parses
  }
}

/** textcap.captcha_parts: (picture, answer field) or null. */
export function captchaParts(doc: Document = document, custom?: CustomText): [HTMLImageElement, HTMLInputElement] | null {
  const marked = customParts(custom, doc);
  if (marked) return marked;
  // a provider widget with its own solver is not a picture-text captcha (CyberSiARA's letters, MTCaptcha)
  const own = (el: Element) => !el.closest('.SiaraShield, #myModal.tooltiptextCyber, .mtcap-main');
  const inputs = Array.from(doc.querySelectorAll('input')).filter((i) => isTextInput(i) && own(i));
  const capInputs = inputs.filter((i) => hints(i, ['placeholder', 'name', 'id', 'aria-label', 'class']).includes('captcha'));
  const img = Array.from(doc.querySelectorAll('img')).find((i) => strongImg(i) && own(i));
  if (img) {
    const inp = capInputs[0] || inputs.find(answerLike);
    return inp ? [img, inp] : null;
  }
  if (capInputs.length) {
    const im = Array.from(doc.querySelectorAll('img')).find((i) => inlineImg(i) && own(i));
    if (im) return [im, capInputs[0]];
  }
  return null;
}

/** On screen and captcha-sized (not a hidden placeholder, not a hero image). */
export function plausible(img: Element): boolean {
  const [, , w, h] = boxOf(img);
  return visible(img) && w >= 40 && w <= 500 && h >= 15 && h <= 200;
}

async function pictureOf(img: HTMLImageElement): Promise<string | null> {
  const viaCanvas = await canvasData(img, 'image/png');
  if (viaCanvas) return viaCanvas;
  img.scrollIntoView({ block: 'center' });
  await sleep(0.4);
  const shot = await capture([boxOf(img)]);
  return shot ? shot[0] : null;
}

function setValue(input: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function runText(ctx: Ctx) {
  const seen = new Set<string>();        // picture addresses this page already handled (asked, refused or solved)
  let busy = false;
  let typedInto: HTMLInputElement | null = null;

  // the person submits after a typed answer: the next picture waits (no second charge for a refreshed picture)
  const submitted = () => { if (typedInto) void ctx.bg('submitted'); };
  document.addEventListener('submit', submitted, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typedInto && e.target === typedInto) submitted(); }, true);
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!typedInto || !e.isTrusted || !t) return;
    const b = t.closest('button, input[type=submit], input[type=button], [role=button]');
    if (b && (!typedInto.form || (b as HTMLButtonElement).form === typedInto.form || typedInto.form.contains(b))) submitted();
  }, true);

  // the detector's own find must look like a captcha (size); a picture the person marked only has to be on screen
  const find = (): [HTMLImageElement, HTMLInputElement] | null => {
    const custom = ctx.cfg.custom[ctx.host];
    const marked = customParts(custom);
    if (marked) return visible(marked[0]) ? marked : null;
    const p = captchaParts();
    return p && plausible(p[0]) ? p : null;
  };
  const go = async (why: 'auto' | 'button') => {
    const parts = find();
    if (busy || !parts) return;
    const [img, input] = parts;
    busy = true;
    seen.add(img.src);
    const t0 = performance.now();
    const secs = () => (performance.now() - t0) / 1000;
    const anchor = boxOf(img);
    try {
      const body = await pictureOf(img);
      if (!body) {
        if (why === 'button') ctx.end('text', 'failed', { reason: 'no_picture', seconds: secs(), anchor });
        return;
      }
      const sig = fingerprint(body);
      const may = await ctx.start('text', why, { sig, anchor });
      if (!may.ok) {
        // asked, paused or limited: the same picture is tried again once the person says yes or the pause ends
        if (['ask_site', 'cooldown', 'page_limit', 'site_limit'].includes(may.reason || '')) seen.delete(img.src);
        return;
      }
      let answer = may.answer || '';                     // the Solve button on a picture already solved: no new call
      if (!answer) {
        await idle(0.4, 0.9);
        const r = await solveTask('text', { type: 'ImageToTextTask', body, module: 'common' });
        answer = String(r.solution?.text || '').replace(/\s+/g, '');
        if (r.errorId || !answer) {
          ctx.end('text', 'failed', { reason: (r.errorCode || 'unreadable').toLowerCase(), seconds: secs(), anchor });
          return;
        }
      }
      if (input.value) setValue(input, '');               // the Solve button on a field with an old answer
      await typeInto(input, answer);
      typedInto = input;
      if (ctx.cfg.submitText) { submitted(); await pressEnter(input); }
      ctx.end('text', 'typed', { rounds: 1, seconds: secs(), sig, answer });
    } finally {
      busy = false;
    }
  };
  ctx.onManual('text', () => !!find(), () => go('button'), () => { const p = find(); return p ? boxOf(p[0]) : null; });
  for (;;) {
    await sleep(1.0);
    if (busy || !ctx.cfg.auto || ctx.skipAuto('text')) continue;
    const parts = find();
    // a new picture (first load, or a refresh after a wrong answer) whose field the person has not filled
    if (parts && !seen.has(parts[0].src) && !parts[1].value) await go('auto');
  }
}
