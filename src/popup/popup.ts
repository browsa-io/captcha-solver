import { type Config, type Kind, KINDS, KIND_INFO, IS_FIREFOX, hostIn, hostSkipped, listed, load, save } from '../lib/config';
import { LINKS, VERDICTS, explain } from '../lib/reasons';
import { hasMsg, localize, t } from '../lib/i18n';
import { amount, balanceLine, keyNotice } from '../lib/money';
import type { KeyState, LogRow } from '../background';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const nameOf = (k: string, label?: string) => label || (KIND_INFO as Record<string, { name: string }>)[k]?.name || t('captcha');
const REPORT_WINDOW_MS = 15 * 60_000;

let cfg: Config;
let host = '';
let keyState: KeyState | null = null;
let wantKeyField = false;

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

function maskKey(k: string) { return k ? k.slice(0, 9) + '••••' + k.slice(-4) : ''; }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function link(label: string, href: string) {
  const a = el('a', '', label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

/** The second line of a row: why it did not pass (with the API's own "what to do"), what it cost, and the report. */
function detail(r: LogRow): HTMLElement | null {
  const v = VERDICTS[r.verdict] || VERDICTS.failed;
  const w = el('span', 'why' + (v.tone === 'bad' ? ' bad' : ''));
  if (r.verdict === 'typed') w.append(t('typed_note') + ' ');
  else if (r.verdict !== 'solved') {
    const e = explain(r.reason || (r.verdict === 'unsupported' ? 'unsupported' : 'failed'), String(r.kind));
    w.append(e.text + (r.verdict === 'unsupported' && r.label ? ` (${r.label})` : '') + ' ');
    if (e.link) w.append(link(e.link.label, e.link.href), ' ');
    if (r.fix && !e.link) w.append(el('span', 'fix', r.fix + ' '));
  }
  if (typeof r.cost === 'number') w.append(el('span', 'cost', r.cost > 0 ? t('cost_charged', amount(r.cost, r.unit)) : t('cost_free')), ' ');
  if (r.reported === 'sent') {
    w.append(el('span', 'rep', t('rep_sent') + ' ' + (r.reportNote || (r.refunded ? t('rep_refund', amount(r.refunded, r.refundUnit)) : t('rep_no_refund')))));
  } else if (r.reportNote) {
    w.append(el('span', 'rep', explain(r.reportNote).text + (r.reportFix ? ' ' + r.reportFix : '')));
  }
  // one click: "the site refused this answer". Only an answer the API gave, for as long as the API takes a report.
  if (r.taskId && !r.reported && typeof r.cost === 'number' && r.cost > 0 && Date.now() - r.at < REPORT_WINDOW_MS) {
    const b = el('button', 'link wrong', t('a_wrong'));
    b.type = 'button';
    b.title = t('t_wrong');
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = t('rep_sending');
      await chrome.runtime.sendMessage({ cmd: 'reportWrong', at: r.at }).catch(() => null);   // the row is redrawn from storage
    });
    w.append(b);
  }
  return w.childNodes.length ? w : null;
}

async function renderLog() {
  const got = await chrome.storage.local.get('log');
  const rows = (got.log as LogRow[]) || [];
  const ol = $('log');
  ol.replaceChildren();
  if (!rows.length) { ol.append(el('li', 'empty', t('log_empty'))); return; }
  for (const r of rows.slice(0, 25)) {
    const li = document.createElement('li');
    const v = VERDICTS[r.verdict] || VERDICTS.failed;
    li.append(el('span', 't', ago(r.at)), el('span', 'w', `${nameOf(String(r.kind), r.label)} · ${r.host}`),
      el('span', 's', r.seconds ? r.seconds.toFixed(1) + 's' : ''), el('span', 'v ' + v.tone, t(v.label)));
    const d = detail(r);
    if (d) li.append(d);
    li.title = `${r.host} · ${nameOf(String(r.kind), r.label)}${r.rounds > 1 ? ' · ' + t('n_rounds', r.rounds) : ''}`;
    ol.append(li);
  }
}

function renderKey() {
  const has = !!cfg.apiKey;
  const st = has ? keyState?.state || 'unknown' : 'none';
  $('onboard').hidden = has || wantKeyField;
  $('keyBox').hidden = !has && !wantKeyField;
  const key = $<HTMLInputElement>('apiKey');
  key.placeholder = has ? maskKey(cfg.apiKey) : t('ph_key');
  $('keyRow').classList.toggle('set', has);
  $('keyRow').classList.toggle('bad', st === 'refused');
  const msg = $('keyMsg');
  msg.replaceChildren();
  msg.className = 'keymsg';
  const n = has ? keyNotice(keyState) : null;
  msg.hidden = !n;
  if (n) {
    msg.classList.add(n.tone);
    msg.append(n.text + ' ');
    if (n.link) msg.append(link(n.link.label, n.link.href));
  }
  const bal = $('balance');
  const b = balanceLine(has ? keyState : null);
  bal.className = 'bal' + (b.tone ? ' ' + b.tone : '');
  bal.textContent = b.text;
  bal.title = b.title || '';
}

function renderTypes() {
  const box = $('types');
  if (box.querySelectorAll('label').length === 0) {
    for (const k of KINDS.filter((x) => listed(x) || cfg.types[x])) {
      const label = el('label', '');
      const i = el('input', '') as HTMLInputElement;
      i.type = 'checkbox';
      i.dataset.type = k;
      const na = IS_FIREFOX && !!KIND_INFO[k].trusted;
      if (na) { i.disabled = true; label.classList.add('na'); label.title = t('t_no_trusted_firefox'); }
      i.addEventListener('change', () => update({ types: { ...cfg.types, [k]: i.checked } }));
      label.append(i, el('span', '', KIND_INFO[k].name));
      box.append(label);
    }
  }
  box.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = cfg.types[i.dataset.type as Kind] && !i.disabled; });
  const hint = $('typeHint');
  hint.hidden = !(cfg.types.presshold && !cfg.trustedInput && !IS_FIREFOX);
  hint.textContent = t('hint_presshold');
}

function render() {
  document.body.classList.toggle('off', !cfg.enabled);
  $('offBar').hidden = cfg.enabled;
  ($('enabled') as HTMLInputElement).checked = cfg.enabled;
  renderKey();
  document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
    const on = (b.dataset.mode === 'auto') === cfg.auto;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;                       // one tab stop; the arrow keys move between the two
  });
  renderTypes();
  $('siteRow').hidden = !host;
  $('host').textContent = host;
  $<HTMLInputElement>('skipSite').checked = hostSkipped(host, cfg.skip);
  $<HTMLInputElement>('textSite').checked = hostIn(host, cfg.textSites);
  const st = keyState?.state;
  const solve = $<HTMLButtonElement>('solve');
  solve.disabled = !cfg.enabled || !cfg.apiKey || st === 'refused';
  solve.title = !cfg.apiKey ? t('t_solve_no_key') : st === 'refused' ? t('t_solve_refused') : t('t_solve');
}

async function update(c: Partial<Config>) {
  cfg = await save(c);
  render();
}

function status(text: string) {
  const s = $('status');
  s.textContent = text;
  s.hidden = !text;
}

async function main() {
  localize();
  cfg = await load();
  keyState = ((await chrome.storage.local.get('keyState')).keyState as KeyState) || null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : ''; } catch { host = ''; }
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  ($('getKey') as HTMLAnchorElement).href = LINKS.signup;
  render();
  void renderLog();
  if (cfg.apiKey) void chrome.runtime.sendMessage({ cmd: 'balance' }).catch(() => null);   // re-check the key now

  $('enabled').addEventListener('change', (e) => update({ enabled: (e.target as HTMLInputElement).checked }));
  $('turnOn').addEventListener('click', () => update({ enabled: true }));
  $('haveKey').addEventListener('click', () => { wantKeyField = true; render(); $('apiKey').focus(); });
  $('saveKey').addEventListener('click', async () => {
    const v = $<HTMLInputElement>('apiKey').value.trim();
    if (!v) return;
    $<HTMLInputElement>('apiKey').value = '';
    keyState = null;                                   // the background checks the new key (storage change)
    await update({ apiKey: v });
  });
  $('apiKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('saveKey').click(); });
  const seg = Array.from(document.querySelectorAll<HTMLButtonElement>('.seg button'));
  seg.forEach((b, i) => {
    b.addEventListener('click', () => update({ auto: b.dataset.mode === 'auto' }));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const next = seg[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? seg.length - 1 : 1)) % seg.length];
      void update({ auto: next.dataset.mode === 'auto' }).then(() => next.focus());
    });
  });
  $('skipSite').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const skip = cfg.skip.filter((s) => !hostIn(host, [s]));
    if (on && host) skip.push(host);
    void update({ skip });
  });
  $('textSite').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const textSites = cfg.textSites.filter((s) => s !== host);
    if (on && host) textSites.push(host);
    void update({ textSites, textNo: cfg.textNo.filter((s) => s !== host) });
  });
  $('openOptions').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
  $('solve').addEventListener('click', async () => {
    if (tab?.id === undefined) return;
    const b = $<HTMLButtonElement>('solve');
    b.disabled = true;
    status(t('st_looking'));
    const r = await chrome.runtime.sendMessage({ cmd: 'solveTab', tabId: tab.id }).catch(() => null);
    if (r && r.ok) status(t('st_solving', (r.found as string[]).map((k) => nameOf(k)).join(', ')));
    else if (r && r.reason === 'unsupported') status(explain('unsupported').text + (r.label ? ` (${r.label})` : ''));
    else if (r && r.reason) status(explain(r.reason, r.found?.[0]).text);
    else status(t('st_unreachable'));
    setTimeout(() => { b.disabled = false; render(); }, 1500);
    setTimeout(() => status(''), 8000);
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.log) void renderLog();
    if (ch.keyState) { keyState = (ch.keyState.newValue as KeyState) || null; render(); }
    if (ch.config) void load().then((c) => { cfg = c; render(); });
  });
  void hasMsg;
}

void main();
