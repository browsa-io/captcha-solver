import { type Config, type Kind, KINDS, KIND_INFO, IS_FIREFOX, apiBaseProblem, hostIn, hostSkipped, listed, load, save } from '../lib/config';
import { LINKS, VERDICTS, explain } from '../lib/reasons';
import type { KeyState, LogRow } from '../background';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const nameOf = (k: string, label?: string) => label || (KIND_INFO as Record<string, { name: string }>)[k]?.name || 'Captcha';

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

async function renderLog() {
  const got = await chrome.storage.local.get('log');
  const rows = (got.log as LogRow[]) || [];
  const ol = $('log');
  ol.replaceChildren();
  if (!rows.length) { ol.append(el('li', 'empty', 'No solves yet')); return; }
  for (const r of rows.slice(0, 25)) {
    const li = document.createElement('li');
    const v = VERDICTS[r.verdict] || VERDICTS.failed;
    li.append(el('span', 't', ago(r.at)), el('span', 'w', `${nameOf(String(r.kind), r.label)} · ${r.host}`),
      el('span', 's', r.seconds ? r.seconds.toFixed(1) + 's' : ''), el('span', 'v ' + v.tone, v.label));
    // the reason, on its own line (not only on hover), in words
    let why = '';
    let link: { label: string; href: string } | undefined;
    if (r.verdict === 'typed') why = 'Typed into the field. The site checks it when you send the form.';
    else if (r.verdict !== 'solved') {
      const e = explain(r.reason || (r.verdict === 'unsupported' ? 'unsupported' : 'failed'), String(r.kind));
      why = e.text + (r.verdict === 'unsupported' && r.label ? ` (${r.label})` : '');
      link = e.link;
    }
    if (why) {
      const w = el('span', 'why' + (v.tone === 'bad' ? ' bad' : ''), why);
      if (link) {
        const a = el('a', '', link.label);
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener';
        w.append(a);
      }
      li.append(w);
    }
    li.title = `${r.host} · ${nameOf(String(r.kind), r.label)}${r.rounds ? ` · ${r.rounds} round${r.rounds > 1 ? 's' : ''}` : ''}`;
    ol.append(li);
  }
}

function renderKey() {
  const has = !!cfg.apiKey;
  const st = has ? keyState?.state || 'unknown' : 'none';
  $('onboard').hidden = has || wantKeyField;
  $('keyBox').hidden = !has && !wantKeyField;
  const key = $<HTMLInputElement>('apiKey');
  key.placeholder = has ? maskKey(cfg.apiKey) : 'Paste your Browsa API key';
  $('keyRow').classList.toggle('set', has);
  $('keyRow').classList.toggle('bad', st === 'refused');
  const msg = $('keyMsg');
  msg.replaceChildren();
  msg.className = 'keymsg';
  msg.hidden = true;
  const say = (cls: string, text: string, label: string, href: string) => {
    msg.hidden = false;
    msg.classList.add(cls);
    msg.append(text + ' ');
    const a = el('a', '', label);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    msg.append(a);
  };
  if (st === 'refused') say('bad', 'Your key was refused. Check it in the dashboard, or paste a new one.', 'Open keys', LINKS.keys);
  else if (st === 'no_credits') say('warn', 'Out of credits. Solving starts again when you add some.', 'Buy credits', LINKS.credits);
  const bal = $('balance');
  bal.className = 'bal';
  if (st === 'refused') { bal.textContent = 'Key refused'; bal.classList.add('bad'); }
  else if (st === 'no_credits') { bal.textContent = '0 credits'; bal.classList.add('warn'); }
  else if (st === 'ok' && keyState && typeof keyState.balance === 'number') {
    const n = keyState.balance;
    bal.textContent = keyState.unit === 'credits'
      ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} credits`
      : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    bal.title = 'Balance';
  } else bal.textContent = '';
}

function renderTypes() {
  const box = $('types');
  if (!box.childElementCount) {
    for (const k of KINDS.filter((x) => listed(x) || cfg.types[x])) {
      const label = el('label', '');
      const i = el('input', '') as HTMLInputElement;
      i.type = 'checkbox';
      i.dataset.type = k;
      const na = IS_FIREFOX && !!KIND_INFO[k].trusted;
      if (na) { i.disabled = true; label.classList.add('na'); label.title = 'Needs real pointer input, which Firefox does not offer to add-ons'; }
      i.addEventListener('change', () => update({ types: { ...cfg.types, [k]: i.checked } }));
      label.append(i, el('span', '', KIND_INFO[k].name));
      box.append(label);
    }
  }
  box.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = cfg.types[i.dataset.type as Kind] && !i.disabled; });
  const hint = $('typeHint');
  hint.hidden = !(cfg.types.presshold && !cfg.trustedInput && !IS_FIREFOX);
  hint.textContent = 'Press & hold needs Trusted input (Advanced).';
}

function render() {
  document.body.classList.toggle('off', !cfg.enabled);
  $('offBar').hidden = cfg.enabled;
  ($('enabled') as HTMLInputElement).checked = cfg.enabled;
  renderKey();
  document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
    b.setAttribute('aria-checked', String((b.dataset.mode === 'auto') === cfg.auto));
  });
  renderTypes();
  $('siteRow').hidden = !host;
  $('host').textContent = host;
  $<HTMLInputElement>('skipSite').checked = hostSkipped(host, cfg.skip);
  $<HTMLInputElement>('textSite').checked = hostIn(host, cfg.textSites);
  $<HTMLInputElement>('trustedInput').checked = cfg.trustedInput;
  $('trustedRow').hidden = IS_FIREFOX;
  $('trustedNote').textContent = IS_FIREFOX
    ? 'Firefox does not let add-ons send real pointer events, so Trusted input is not available here.'
    : "Real pointer events through the browser's debugger, for sites that refuse page events. The browser shows a bar while it is on.";
  $<HTMLInputElement>('submitText').checked = cfg.submitText;
  $<HTMLTextAreaElement>('skip').value = cfg.skip.join('\n');
  $<HTMLTextAreaElement>('textSites').value = cfg.textSites.join('\n');
  if (document.activeElement !== $('apiBase')) $<HTMLInputElement>('apiBase').value = cfg.apiBase;
  $<HTMLButtonElement>('solve').disabled = !cfg.enabled || !cfg.apiKey || keyState?.state === 'refused';
  $<HTMLButtonElement>('solve').title = !cfg.apiKey ? 'Add your API key first' : keyState?.state === 'refused'
    ? 'Your key was refused' : 'Solve on this page (Alt+Shift+S)';
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
  cfg = await load();
  keyState = ((await chrome.storage.local.get('keyState')).keyState as KeyState) || null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : ''; } catch { host = ''; }
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
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
  document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
    b.addEventListener('click', () => update({ auto: b.dataset.mode === 'auto' }));
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
  $('skip').addEventListener('change', (e) => update({ skip: (e.target as HTMLTextAreaElement).value.split(/[\s,]+/) }));
  $('textSites').addEventListener('change', (e) => update({ textSites: (e.target as HTMLTextAreaElement).value.split(/[\s,]+/) }));
  const baseCheck = () => {
    const inp = $<HTMLInputElement>('apiBase');
    const v = inp.value.trim();
    const problem = v ? apiBaseProblem(v) : 'Needed: the address of the solving server';
    inp.classList.toggle('bad', !!problem);
    const m = $('apiBaseMsg');
    m.hidden = !problem && v === cfg.apiBase;
    m.className = 'fieldmsg' + (problem ? '' : ' ok');
    m.textContent = problem || 'Saved';
    return problem ? '' : v;
  };
  $('apiBase').addEventListener('input', baseCheck);
  $('apiBase').addEventListener('change', async () => {
    const v = baseCheck();
    if (v && v !== cfg.apiBase) {
      await update({ apiBase: v });
      $('apiBaseMsg').hidden = false;
      void chrome.runtime.sendMessage({ cmd: 'balance' }).catch(() => null);
    }
  });
  $('submitText').addEventListener('change', (e) => update({ submitText: (e.target as HTMLInputElement).checked }));
  $('trustedInput').addEventListener('change', async (e) => {
    const box = e.target as HTMLInputElement;
    if (box.checked && chrome.permissions) {
      // asked only here, on the person's click: the debugger lets the extension send real pointer events
      const granted = await chrome.permissions.request({ permissions: ['debugger', 'webNavigation'] as any }).catch(() => false);
      if (!granted) { box.checked = false; return; }
    }
    void update({ trustedInput: box.checked });
  });
  $('solve').addEventListener('click', async () => {
    if (tab?.id === undefined) return;
    const b = $<HTMLButtonElement>('solve');
    b.disabled = true;
    status('Looking for a captcha…');
    const r = await chrome.runtime.sendMessage({ cmd: 'solveTab', tabId: tab.id }).catch(() => null);
    if (r && r.ok) status('Solving: ' + (r.found as string[]).map((k) => nameOf(k)).join(', '));
    else if (r && r.reason === 'unsupported') status(`This captcha type isn't supported yet${r.label ? ` (${r.label})` : ''}`);
    else if (r && r.reason === 'no_captcha') status('No captcha found on this page');
    else if (r && r.reason) status(explain(r.reason, r.found?.[0]).text);
    else status("This page can't be reached by the extension");
    setTimeout(() => { b.disabled = false; render(); }, 1500);
    setTimeout(() => status(''), 8000);
  });
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.log) void renderLog();
    if (ch.keyState) { keyState = (ch.keyState.newValue as KeyState) || null; render(); }
    if (ch.config) void load().then((c) => { cfg = c; render(); });
  });
}

void main();
