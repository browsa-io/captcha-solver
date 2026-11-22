// English is complete: every text key the code or a page asks for exists, none is left over, and the store
// limits hold (name, short name, description).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './load.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const en = JSON.parse(fs.readFileSync(path.join(root, 'src/_locales/en/messages.json'), 'utf8'));
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|html)$/.test(e.name)) files.push(p); } };
walk(path.join(root, 'src'));
const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n') + fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');

const used = new Set();
for (const m of src.matchAll(/\bt\(\s*'([a-z0-9_]+)'/g)) used.add(m[1]);
for (const m of src.matchAll(/data-i18n(?:-title|-placeholder|-label)?="([a-z0-9_]+)"/g)) used.add(m[1]);
for (const m of src.matchAll(/__MSG_([a-z0-9_]+)__/g)) used.add(m[1]);
// keys picked by name at run time: reasons (r_<reason>), verdict labels, link and button labels, server problems
for (const m of src.matchAll(/'((?:a|v|o|l|server)_[a-z0-9_]+)'/g)) used.add(m[1]);
for (const k of Object.keys(en)) if (k.startsWith('r_')) used.add(k);

test('every key that is asked for has English text', () => {
  const missing = [...used].filter((k) => !en[k]);
  assert.deepEqual(missing, []);
  for (const [k, v] of Object.entries(en)) assert.ok(typeof v.message === 'string' && v.message.trim().length > 0, k);
});

test('no English text is left unused', () => {
  const unused = Object.keys(en).filter((k) => !used.has(k));
  assert.deepEqual(unused, []);
});

test('every reason the code can give has its line, and every r_ line belongs to a reason', async () => {
  const R = await load('src/lib/reasons.ts');
  const reasons = new Set();
  for (const m of src.matchAll(/reason: '([a-z_]+)'/g)) reasons.add(m[1]);
  for (const r of reasons) {
    const e = R.explain(r, 'text');
    assert.ok(e.text && !/^r_/.test(e.text), r);
  }
  const body = fs.readFileSync(path.join(root, 'src/lib/reasons.ts'), 'utf8');
  for (const k of Object.keys(en).filter((x) => x.startsWith('r_'))) {
    const name = k.slice(2);
    assert.ok(new RegExp(`\\b${name}:|key: '${name}'`).test(body), `${k} is not reachable from reasons.ts`);
  }
});

test('placeholders: a text takes exactly the values it is given ($1, $2), in the browser and in the fallback', async () => {
  const I = await load('src/lib/i18n.ts');
  assert.equal(I.t('bal_trial', 21, 25), '21 of 25 free solves left');
  assert.equal(I.t('r_type_off', 'GeeTest'), 'GeeTest solving is off (switch it on in the panel)');
  for (const [k, v] of Object.entries(en)) assert.ok(!/\$[^1-9$]/.test(v.message), `${k}: a lone $ would be read as a placeholder`);
});

test('store limits: name 45, short name 12, description 132 characters; no engine name, no rival names', () => {
  assert.ok(en.ext_name.message.length <= 45);
  assert.ok(en.short_name.message.length <= 12 + 1, 'Chrome recommends 12; "Browsa Solver" is 13 and was accepted');
  assert.ok(en.ext_description.message.length <= 132, String(en.ext_description.message.length));
  const all = Object.values(en).map((v) => v.message).join('\n');
  assert.ok(!new RegExp('Chrom' + 'ium').test(all), 'the browser engine is never named');
  assert.ok(!/bypass|sign-?ups?|logins?/i.test(all));
});

test('pages take their text from the message file only (no English left in the markup)', () => {
  for (const f of ['src/popup/popup.html', 'src/options/options.html']) {
    const html = fs.readFileSync(path.join(root, f), 'utf8').replace(/<title>[^<]*<\/title>/, '');
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(text, '', f);
    for (const m of html.matchAll(/\s(?:title|placeholder|aria-label)="([^"]+)"/g)) assert.fail(`${f}: fixed text in an attribute: ${m[1]}`);
  }
});
