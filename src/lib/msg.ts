// Content script <-> background messages, and what a solver reports about itself.
import type { Kind } from './config';

export async function bg<T = any>(cmd: string, data: Record<string, unknown> = {}): Promise<T> {
  try {
    return (await chrome.runtime.sendMessage({ cmd, ...data })) as T;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) } as T;
  }
}

export interface ApiAnswer { errorId: number; errorCode?: string; errorDescription?: string; solution?: any; taskId?: string }

/** One createTask call through the background, which adds the key and the site's host (nothing else). */
export async function solveTask(kind: Kind, task: Record<string, unknown>): Promise<ApiAnswer> {
  const r = await bg<ApiAnswer>('createTask', { kind, task });
  return r && typeof r.errorId === 'number' ? r : { errorId: 1, errorCode: 'EXTENSION_ERROR', errorDescription: String((r as any)?.error || 'no answer') };
}

export type Verdict = 'solved' | 'typed' | 'failed' | 'skipped' | 'unsupported' | 'paused';
export type Why = 'auto' | 'button';

export interface BeginAnswer { ok: boolean; reason?: string; answer?: string }

/** Ask the background whether a solve may start (settings, the site's yes, limits, already-solved pictures). A
 * refusal is logged there; the caller shows it with notify(). `verified`: the widget comes from its provider's own
 * frame or script (checked by origin, not by class names). */
export async function begin(kind: Kind, why: Why, opts: { verified?: boolean; sig?: string } = {}): Promise<BeginAnswer> {
  const r = await bg<BeginAnswer>('begin', { kind, why, verified: !!opts.verified, sig: opts.sig || '' });
  return r && typeof r.ok === 'boolean' ? r : { ok: false, reason: 'extension_error' };
}

/** The solve log (popup): rounds, and the end with the widget's own verdict and, for anything but a pass, why. */
export function report(kind: Kind, event: 'start' | 'round' | 'end', data: Record<string, unknown> = {}) {
  void bg('report', { kind, event, data });
}

export async function canvasData(img: HTMLImageElement | HTMLCanvasElement, type = 'image/png', q = 0.92): Promise<string | null> {
  try {
    if (img instanceof HTMLCanvasElement) return img.toDataURL(type, q).split(',')[1] || null;
    if (!img.complete || !img.naturalWidth) {
      await new Promise((r) => { img.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
    }
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c.toDataURL(type, q).split(',')[1] || null;      // throws on a cross-origin (tainted) picture
  } catch {
    return null;
  }
}

/** A part of the visible tab as JPEG base64 (the background's captureVisibleTab), for pictures a canvas cannot
 * read. Boxes are this frame's viewport CSS px; the background adds the frame's offset. */
export async function capture(boxes: Array<[number, number, number, number]>): Promise<string[] | null> {
  const r = await bg<{ ok: boolean; images?: string[] }>('capture', { boxes, dpr: window.devicePixelRatio || 1, frameUrl: location.href });
  return r && r.ok && r.images ? r.images : null;
}
