// The settings page: everything the panel has no room for. Each control saves as it changes.
import { type ButtonPos, type Config, type Kind, KINDS, KIND_INFO, IS_FIREFOX, apiBaseProblem, exported, imported, listed, load, save } from '../lib/config';
import { localize, t, type MsgKey } from '../lib/i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let cfg: Config;
let savedTimer = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

async function update(c: Partial<Config>) {
  cfg = await save(c);
  render();
  const s = $('saved');
  s.textContent = t('saved');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => { s.textContent = ''; }, 1600);
}

function typeRow(k: Kind): HTMLTableRowElement {
  const tr = el('tr');
  tr.dataset.type = k;
  const name = el('th', '', KIND_INFO[k].name);
  name.scope = 'row';
  const na = IS_FIREFOX && !!KIND_INFO[k].trusted;
  const box = (field: 'types' | 'autoTypes', label: MsgKey) => {
    const td = el('td');
    const i = el('input');
    i.type = 'checkbox';
    i.dataset.field = field;
    i.setAttribute('aria-label', t(label, KIND_INFO[k].name));
    i.disabled = na;
    i.addEventListener('change', () => update({ [field]: { ...cfg[field], [k]: i.checked } } as Partial<Config>));
    td.append(i);
    return td;
  };
  const note = na ? t('t_no_trusted_firefox') : KIND_INFO[k].trusted ? t('cost_free_trusted') : KIND_INFO[k].credits ? t('cost_credits') : t('cost_in_page');
  tr.append(name, box('types', 'l_solve_type'), box('autoTypes', 'l_auto_type'), el('td', 'note', note));
  return tr;
}

const lines = (v: string) => v.split(/[\s,]+/).filter(Boolean);

function render() {
  for (const tr of Array.from(document.querySelectorAll<HTMLTableRowElement>('tr[data-type]'))) {
    const k = tr.dataset.type as Kind;
    tr.querySelectorAll<HTMLInputElement>('input').forEach((i) => {
      const field = i.dataset.field as 'types' | 'autoTypes';
      i.checked = !!cfg[field][k] && !(IS_FIREFOX && KIND_INFO[k].trusted);
      // "by itself" means nothing for a type that is not solved at all
      if (field === 'autoTypes' && !(IS_FIREFOX && KIND_INFO[k].trusted)) i.disabled = !cfg.types[k];
    });
  }
  const set = (id: string, v: string) => { const e = $<HTMLInputElement>(id); if (document.activeElement !== e) e.value = v; };
  set('retries', String(cfg.retries));
  set('retryDelay', String(cfg.retryDelay));
  $<HTMLInputElement>('retryDelay').disabled = cfg.retries === 0;
  $<HTMLSelectElement>('button').value = cfg.button;
  document.querySelectorAll<HTMLInputElement>('input[name=siteMode]').forEach((r) => { r.checked = r.value === cfg.siteMode; });
  $('skipField').hidden = cfg.siteMode !== 'all';
  $('onlyField').hidden = cfg.siteMode !== 'allow';
  set('skip', cfg.skip.join('\n'));
  set('only', cfg.only.join('\n'));
  set('textSites', cfg.textSites.join('\n'));
  const ul = $('custom');
  ul.replaceChildren();
  const hosts = Object.keys(cfg.custom).sort();
  if (!hosts.length) ul.append(el('li', 'empty', t('o_custom_none')));
  for (const h of hosts) {
    const li = el('li');
    const rm = el('button', 'ghost sm', t('a_remove'));
    rm.type = 'button';
    rm.setAttribute('aria-label', t('l_remove_site', h));
    rm.addEventListener('click', () => {
      const custom = { ...cfg.custom };
      delete custom[h];
      void update({ custom });
    });
    li.append(el('span', 'host', h), el('code', '', `${cfg.custom[h].img} → ${cfg.custom[h].input}`), rm);
    ul.append(li);
  }
  $<HTMLInputElement>('trustedInput').checked = cfg.trustedInput;
  $('trustedRow').hidden = IS_FIREFOX;
  $('permDebugger').hidden = IS_FIREFOX;
  $('trustedNote').textContent = IS_FIREFOX ? t('o_trusted_firefox') : t('o_trusted_hint');
  $<HTMLInputElement>('submitText').checked = cfg.submitText;
  set('apiBase', cfg.apiBase);
}

async function main() {
  localize();
  document.title = t('options_title');
  cfg = await load();
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  for (const k of KINDS) (listed(k) ? $('typeRows') : $('unlistedRows')).append(typeRow(k));
  render();

  const number = (id: 'retries' | 'retryDelay') => $(id).addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (v !== '') void update({ [id]: Number(v) } as Partial<Config>).then(() => { (e.target as HTMLInputElement).value = String(cfg[id]); });
  });
  number('retries');
  number('retryDelay');
  $('button').addEventListener('change', (e) => update({ button: (e.target as HTMLSelectElement).value as ButtonPos }));
  document.querySelectorAll<HTMLInputElement>('input[name=siteMode]').forEach((r) => {
    r.addEventListener('change', () => { if (r.checked) void update({ siteMode: r.value as Config['siteMode'] }); });
  });
  for (const id of ['skip', 'only', 'textSites'] as const) {
    $(id).addEventListener('change', (e) => update({ [id]: lines((e.target as HTMLTextAreaElement).value) } as Partial<Config>));
  }
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

  const baseCheck = () => {
    const inp = $<HTMLInputElement>('apiBase');
    const v = inp.value.trim();
    const problem = v ? apiBaseProblem(v) : 'server_needed';
    inp.classList.toggle('bad', !!problem);
    inp.setAttribute('aria-invalid', String(!!problem));
    const m = $('apiBaseMsg');
    m.hidden = !problem;
    m.className = 'fieldmsg';
    m.textContent = problem ? t(problem as MsgKey) : '';
    return problem ? '' : v;
  };
  $('apiBase').addEventListener('input', baseCheck);
  $('apiBase').addEventListener('change', async () => {
    const v = baseCheck();
    if (v && v !== cfg.apiBase) {
      await update({ apiBase: v });
      void chrome.runtime.sendMessage({ cmd: 'balance' }).catch(() => null);
    }
  });

  $('export').addEventListener('click', () => {
    const data = JSON.stringify(exported(cfg, $<HTMLInputElement>('exportKey').checked), null, 2) + '\n';
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'browsa-solver-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('backupMsg').textContent = t($<HTMLInputElement>('exportKey').checked ? 'o_exported_key' : 'o_exported');
  });
  $('import').addEventListener('click', () => $<HTMLInputElement>('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    const r = imported(await f.text(), cfg);
    if (!r.config) { $('backupMsg').textContent = t(r.error === 'not_json' ? 'o_import_not_json' : 'o_import_not_settings'); return; }
    await chrome.storage.local.set({ config: r.config });
    cfg = await load();
    render();
    $('backupMsg').textContent = t('o_imported');
  });
  chrome.storage.onChanged.addListener((ch) => { if (ch.config) void load().then((c) => { cfg = c; render(); }); });
}

void main();
