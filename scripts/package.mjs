// Store packages that come out the same on any machine: a fresh build, then a zip with the files in byte order,
// one fixed file time (SOURCE_DATE_EPOCH, default 2026-01-01 00:00 UTC), mode 644, no directory entries and no
// extra fields.
//
//   node scripts/package.mjs                     dist/browsa-captcha-solver-<version>.zip          (Chrome)
//   node scripts/package.mjs --target=firefox    dist/browsa-captcha-solver-firefox-<version>.zip  (Firefox)
//
// Prints the zip's sha256 and the build's file hashes (scripts/hashes.mjs). Needs Info-ZIP's zip (macOS and
// Linux have it).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const firefox = process.argv.includes('--target=firefox');
const target = firefox ? 'firefox' : 'chrome';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const epoch = Number(process.env.SOURCE_DATE_EPOCH || 1767225600);

execFileSync('node', ['scripts/build.mjs', ...(firefox ? ['--target=firefox'] : [])], { cwd: root, stdio: 'inherit' });
const dir = path.join(root, 'dist', target);

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(dir, p).split(path.sep).join('/'));
  }
};
walk(dir);
files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
for (const f of files) {
  fs.chmodSync(path.join(dir, f), 0o644);
  fs.utimesSync(path.join(dir, f), epoch, epoch);
}

const zip = path.join(root, 'dist', `browsa-captcha-solver${firefox ? '-firefox' : ''}-${version}.zip`);
fs.rmSync(zip, { force: true });
// TZ=UTC: a zip stores local time, so the same epoch gives the same bytes in every time zone
execFileSync('zip', ['-q', '-X', '-D', zip, '-@'], { cwd: dir, input: files.join('\n') + '\n', env: { ...process.env, TZ: 'UTC' } });

const sum = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
console.log(`${sum}  ${path.relative(root, zip)}`);
execFileSync('node', ['scripts/hashes.mjs', dir], { cwd: root, stdio: 'inherit' });
