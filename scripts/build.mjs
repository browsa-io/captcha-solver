// Build the extension into dist/<target>/ with esbuild. No remote code: every script is bundled here.
//
//   node scripts/build.mjs                              dist/chrome      store build (popup settings)
//   node scripts/build.mjs --target=firefox             dist/firefox     same code, Firefox manifest (event page)
//   node scripts/build.mjs --automation=automation.json dist/automation  unpacked build for Puppeteer / Playwright /
//                                                                        Selenium: settings from that JSON file
//   node scripts/build.mjs --automation=automation.json --target=firefox   dist/automation-firefox
//   --api=https://...   the API address compiled in as the default (else https://captcha.browsa.io)
//
// Automation builds take the API key from the environment variable BROWSA_API_KEY when it is set (it wins over
// the file), so no key has to be written into a file that could be committed. dist/ is git-ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const automation = typeof args.automation === 'string' ? path.resolve(args.automation) : '';
const browser = args.target === 'firefox' ? 'firefox' : 'chrome';
const target = automation ? (browser === 'firefox' ? 'automation-firefox' : 'automation') : browser;
const out = path.join(root, 'dist', typeof args.out === 'string' ? args.out : target);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const apiBase = typeof args.api === 'string' ? args.api : 'https://captcha.browsa.io';

if (automation && !fs.existsSync(automation)) {
  console.error(`automation config not found: ${automation} (see automation.example.json)`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: {
    background: path.join(root, 'src/background.ts'),
    content: path.join(root, 'src/content/main.ts'),
    popup: path.join(root, 'src/popup/popup.ts'),
  },
  outdir: out,
  absWorkingDir: root,        // module comments in the bundle name paths from here, whatever the shell's folder
  bundle: true,
  format: 'iife',
  target: browser === 'firefox' ? ['firefox121'] : ['chrome116'],
  minify: false,              // readable code helps store review; nothing secret is in it
  sourcemap: false,
  legalComments: 'none',
  define: { __API_BASE__: JSON.stringify(apiBase), __AUTOMATION__: String(!!automation), __TARGET__: JSON.stringify(browser) },
  logLevel: 'warning',
});

const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy('src/popup/popup.html', 'popup.html');
copy('src/popup/popup.css', 'popup.css');
copy('static/icons', 'icons');
copy('static/fonts', 'fonts');
copy('static/privacy.html', 'privacy.html');
if (automation) {
  const conf = JSON.parse(fs.readFileSync(automation, 'utf8'));
  if (process.env.BROWSA_API_KEY) conf.apiKey = process.env.BROWSA_API_KEY.trim();
  fs.writeFileSync(path.join(out, 'automation.json'), JSON.stringify(conf, null, 2) + '\n', { mode: 0o600 });
}

const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const manifest = {
  manifest_version: 3,
  name: 'Browsa Captcha Solver',
  short_name: 'Browsa Solver',
  version: pkg.version,
  // the store's short description (132 characters at most): store/listing.md
  description: 'Solves image captchas with human-like input, rates measured on each site\'s own server. Use it only where you are authorized.',
  icons,
  action: { default_popup: 'popup.html', default_icon: icons, default_title: 'Browsa Solver' },
  background: browser === 'firefox' ? { scripts: ['background.js'] } : { service_worker: 'background.js' },
  content_scripts: [{
    matches: ['http://*/*', 'https://*/*'],
    js: ['content.js'],
    all_frames: true,
    run_at: 'document_idle',
  }],
  permissions: ['storage'],
  host_permissions: ['<all_urls>'],
  commands: { solve: { suggested_key: { default: 'Alt+Shift+S' }, description: 'Solve the captcha on this page' } },
};
if (browser === 'firefox') {
  // No chrome.debugger in Firefox: Trusted input and Press & hold are not available there (the popup says so).
  // 121: the oldest Firefox with everything used here (MV3 event page, storage.session, OffscreenCanvas in the
  // background, element.openOrClosedShadowRoot, CSS :has() in the panel).
  manifest.browser_specific_settings = { gecko: {
    id: 'captcha-solver@browsa.io', strict_min_version: '121.0',
    // what is sent off the device, declared for Firefox's install prompt and the add-ons site
    data_collection_permissions: { required: ['authenticationInfo', 'websiteContent'] },
  } };
  if (automation) manifest.name += ' (automation)';
} else if (automation) {
  // unpacked automation build: trusted input available without a prompt (set trustedInput in the JSON)
  manifest.permissions.push('debugger', 'webNavigation');
  manifest.name += ' (automation)';
  manifest.minimum_chrome_version = '116';
} else {
  manifest.optional_permissions = ['debugger', 'webNavigation'];
  manifest.minimum_chrome_version = '116';
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`built ${path.relative(root, out)} (${target}${automation ? ', settings from ' + path.basename(automation) + (process.env.BROWSA_API_KEY ? ' + BROWSA_API_KEY' : '') : ''})`);
