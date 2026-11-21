// Loads a TypeScript module of the extension for a test: esbuild bundles it (with its imports, and the build's
// compile-time constants) into one ES module in memory, which is imported from a data: URL.
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function load(rel, { automation = false, target = 'chrome' } = {}) {
  const r = await esbuild.build({
    entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'neutral', write: false,
    define: { __API_BASE__: '"https://captcha.browsa.io"', __AUTOMATION__: String(automation), __TARGET__: JSON.stringify(target) },
    logLevel: 'silent',
  });
  const code = r.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
