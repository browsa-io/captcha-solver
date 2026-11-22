// hCaptcha, in its own frames from hcaptcha.com (the background checks the asking frame's address).
//   checkbox frame   ticked like a hand; its state (checked) is the pass, shared through the background
//   challenge frame  the frame as the person sees it (a crop of the visible tab) and its instruction go to
//                    HCaptchaTask, which answers clicks and drags in the frame's CSS px; they are played
//                    like a hand, then hCaptcha's own Next / Verify. An unclear picture or a puzzle family the server
//                    does not answer is swapped with hCaptcha's own refresh, a few times at most.
import type { Ctx } from './main';
import { capture, report, solveTask } from '../lib/msg';
import { click, clickBox, drag, idle, sleep, visible } from '../lib/input';
import { PROVIDER_FRAMES } from '../lib/origin';

export const isHcFrame = (u: string) => PROVIDER_FRAMES.hcaptcha!(u) && /frame=(checkbox|challenge)/.test(u);
const isCheckbox = (u: string) => /frame=checkbox/.test(u);

const BUDGET_S = 150;
const MAX_ROUNDS = 6;
const MAX_REFRESH = 5;            // as Browsa's cloud browsers: another challenge rather than a guess, 5 times at most

function checkboxState(): string {
  const c = document.querySelector('#checkbox');
  if (!c) return 'none';
  return c.getAttribute('aria-checked') === 'true' ? 'checked' : 'unchecked';
}

async function runCheckbox(ctx: Ctx) {
  let c: Element | null = null;
  for (let i = 0; i < 40 && !(c = document.querySelector('#checkbox')); i++) await sleep(0.25);
  if (!c) return;
  let sent = '';
  let clickedAt = 0;
  const send = () => {
    const s = checkboxState();
    if (s === sent) return;
    sent = s;
    void ctx.bg('anchor', { kind: 'hcaptcha', state: s });
    if (s === 'checked' && clickedAt) ctx.end('hcaptcha', 'solved', { seconds: (performance.now() - clickedAt) / 1000 });
  };
  new MutationObserver(send).observe(c, { attributes: true });
  setInterval(send, 1000);
  send();
  let ticks = 0;
  const tick = async (why: 'auto' | 'button') => {
    if (checkboxState() !== 'unchecked') return;
    if (why === 'auto' && ticks >= 2) return;
    const may = await ctx.start('hcaptcha', why, { verified: true });
    if (!may.ok) return;
    ticks++;
    if (!clickedAt) clickedAt = performance.now();
    await idle(0.6, 1.5);
    await click(document.querySelector('#checkbox')!);
  };
  ctx.onManual('hcaptcha', () => checkboxState() === 'unchecked' && visible(document.querySelector('#checkbox')), () => tick('button'));
  for (;;) {
    await sleep(0.6);
    if (!ctx.cfg.auto || ctx.skipAuto('hcaptcha')) continue;
    if (checkboxState() === 'unchecked' && visible(document.querySelector('#checkbox'))) await tick('auto');
  }
}

const promptText = () => {
  for (const sel of ['.prompt-text', '.challenge-prompt', '.prompt-padding']) {
    const t = (document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
};
const submitButton = () => document.querySelector<HTMLElement>('.button-submit');
const refreshButton = () => document.querySelector<HTMLElement>('.refresh, [aria-label*="refresh" i], [title*="refresh" i]');

async function shot(): Promise<string | null> {
  const imgs = await capture([[0, 0, window.innerWidth, window.innerHeight]]);
  return imgs ? imgs[0] : null;
}

async function runChallenge(ctx: Ctx) {
  let open = false;
  new IntersectionObserver((es) => { open = es.some((e) => e.isIntersecting && e.intersectionRect.height > 150); })
    .observe(document.documentElement);
  let anchor = 'unknown';
  ctx.on('anchor', (m) => { if (m.kind === 'hcaptcha') anchor = String(m.state); });
  let busy = false;
  const present = () => open && !!promptText() && visible(submitButton());

  const solve = async (why: 'auto' | 'button') => {
    if (busy || !present()) return;
    busy = true;
    const t0 = performance.now();
    let rounds = 0, refreshes = 0;
    const elapsed = () => (performance.now() - t0) / 1000;
    const done = (verdict: 'solved' | 'failed' | 'unsupported', reason: string) =>
      ctx.end('hcaptcha', verdict, { reason, rounds, seconds: elapsed() });
    try {
      const may = await ctx.start('hcaptcha', why, { verified: true });
      if (!may.ok) return;
      await idle(0.8, 1.4);
      let lastPrompt = '';
      while (elapsed() < BUDGET_S && rounds < MAX_ROUNDS) {
        if (anchor === 'checked') return;                       // the checkbox frame reports the pass
        if (!present()) {
          await sleep(1.0);
          if (!present()) {
            const r = await ctx.bg<{ state?: string }>('anchorState', { kind: 'hcaptcha' });
            if (r?.state === 'checked' || anchor === 'checked') return;
            // the pop-up closed without a tick: an invisible widget passes this way
            if (rounds) done(r?.state === 'unknown' ? 'solved' : 'failed', r?.state === 'unknown' ? 'solved' : 'closed');
            return;
          }
        }
        const question = promptText();
        const image = await shot();
        if (!image) { done('failed', 'no_picture'); return; }
        // the frame as shown (its CSS size: the actions come back in it), and its instruction; the server answers
        // with the in-session solvers (HCaptchaTask) or says to ask for another challenge
        const task: Record<string, unknown> = { type: 'HCaptchaTask', image, prompt: question,
          frameWidth: window.innerWidth, frameHeight: window.innerHeight };
        rounds++;
        report('hcaptcha', 'round', { n: rounds });
        const r = await solveTask('hcaptcha', task);
        if (r.errorId) {
          const code = r.errorCode || '';
          if ((code === 'ERROR_CAPTCHA_UNSOLVABLE' || code === 'ERROR_TASK_NOT_SUPPORTED') && refreshes < MAX_REFRESH && refreshButton()) {
            refreshes++;
            rounds--;                                         // a refresh is not an answered round
            await idle(0.5, 1.0);
            await click(refreshButton()!);
            await sleep(2.0);
            continue;
          }
          done(code === 'ERROR_TASK_NOT_SUPPORTED' ? 'unsupported' : 'failed', (code || 'api').toLowerCase());
          return;
        }
        for (const a of (r.solution?.actions || []) as Array<{ type: string; x?: number; y?: number; from?: number[]; to?: number[] }>) {
          if (a.type === 'click' && typeof a.x === 'number' && typeof a.y === 'number') {
            await clickBox([a.x - 4, a.y - 4, 8, 8]);
            await idle(0.25, 0.6);
          } else if (a.type === 'drag' && a.from && a.to) {
            await drag([a.from[0], a.from[1]], [a.to[0], a.to[1]]);
            await idle(0.3, 0.7);
          }
        }
        await idle(0.4, 0.9);
        const b = submitButton();
        if (b && visible(b)) await click(b);
        lastPrompt = question;
        await sleep(2.2);
        void lastPrompt;
      }
      done('failed', rounds >= MAX_ROUNDS ? 'rounds' : 'timeout');
    } finally {
      busy = false;
    }
  };
  ctx.onManual('hcaptcha', present, () => solve('button'));
  for (;;) {
    await sleep(0.6);
    if (busy || !ctx.cfg.auto || ctx.skipAuto('hcaptcha')) continue;
    if (present()) await solve('auto');
  }
}

export async function runHcaptcha(ctx: Ctx) {
  if (isCheckbox(location.href)) return runCheckbox(ctx);
  return runChallenge(ctx);
}
