// The sha256 of every file in a build, and one hash over that list, so a build can be compared with a published
// package file by file (a zip's own bytes also hold file times and order, which differ from machine to machine).
//
//   node scripts/hashes.mjs [dist/chrome]                         "<sha256>  ./<path>" per file, then the tree hash
//   node scripts/hashes.mjs dist/chrome --against=<.zip|.crx|.xpi> compares the two; exit 1 on any difference
//
// The tree hash is the sha256 of the per-file lines, the same as this shell line run in the build folder:
//   find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum          (macOS: shasum -a 256)
// The stores add their own files to what they serve: _metadata/ in a Chrome Web Store .crx, META-INF/ in a signed
// Firefox .xpi. Those are left out of the comparison. The Chrome Web Store also puts one line at the top of
// manifest.json ("update_url": "https://clients2.google.com/service/update2/crx", and an empty line); that line is
// taken out of the package's manifest before it is hashed, and the output says so.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const against = (argv.find((a) => a.startsWith('--against=')) || '').slice('--against='.length);
const dir = path.resolve(argv.find((a) => !a.startsWith('--')) || 'dist/chrome');
const STORE_ADDED = /^\.\/(_metadata|META-INF)\//;
const STORE_UPDATE_URL = /^\{\n"update_url": "https:\/\/clients2\.google\.com\/service\/update2\/crx",\n\n/;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function list(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push('./' + path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
}

function hashes(root, fromStore = false) {
  const files = list(root).filter((f) => !STORE_ADDED.test(f));
  let note = '';
  const lines = files.map((f) => {
    let buf = fs.readFileSync(path.join(root, f));
    if (fromStore && f === './manifest.json' && STORE_UPDATE_URL.test(buf.toString('utf8'))) {
      buf = Buffer.from(buf.toString('utf8').replace(STORE_UPDATE_URL, '{\n'), 'utf8');
      note = 'the package\'s manifest.json had the Chrome Web Store\'s update_url line; it was taken out before hashing';
    }
    return `${sha(buf)}  ${f}\n`;
  });
  return { files, lines, tree: sha(lines.join('')), note };
}

if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
  console.error(`no build in ${dir}: run npm run build (or build:firefox) first`);
  process.exit(2);
}
const mine = hashes(dir);

if (!against) {
  process.stdout.write(mine.lines.join(''));
  console.log(`tree ${mine.tree}  ${path.relative(process.cwd(), dir) || '.'} (${mine.files.length} files)`);
  process.exit(0);
}

// A .crx is a zip with a signed header in front; unzip reads past it and exits 1 with a warning.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-pkg-'));
try {
  const r = spawnSync('unzip', ['-qq', '-o', path.resolve(against), '-d', tmp], { encoding: 'utf8' });
  if (r.error || (r.status !== 0 && r.status !== 1)) {
    console.error(`could not unpack ${against}: ${r.error ? r.error.message : r.stderr}`);
    process.exit(2);
  }
  const theirs = hashes(tmp, true);
  if (theirs.note) console.log(`note: ${theirs.note}`);
  const a = new Map(mine.lines.map((l, i) => [mine.files[i], l.slice(0, 64)]));
  const b = new Map(theirs.lines.map((l, i) => [theirs.files[i], l.slice(0, 64)]));
  let diff = 0;
  for (const f of new Set([...a.keys(), ...b.keys()])) {
    const state = !a.has(f) ? 'only in the package' : !b.has(f) ? 'only in the build' : a.get(f) === b.get(f) ? 'same' : 'DIFFERENT';
    if (state !== 'same') diff++;
    console.log(`${state.padEnd(20)} ${f}`);
  }
  console.log(`build   tree ${mine.tree}\npackage tree ${theirs.tree}`);
  console.log(diff ? `${diff} file(s) differ` : `identical: ${mine.files.length} files`);
  process.exit(diff ? 1 : 0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
