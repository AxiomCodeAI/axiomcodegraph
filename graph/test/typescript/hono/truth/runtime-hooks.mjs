// Module resolution hooks for the runtime cross-check: a fixture written for a bundler imports
// `./users` (no extension) or `./users.js` meaning `./users.ts`. Node's own resolver refuses both;
// this tries the candidates a bundler would, in its order, and nothing else.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATES = ['', '.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.js'];
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    const p = fileURLToPath(base);
    const stems = [p];
    if (/\.js$/.test(p)) stems.push(p.replace(/\.js$/, '.ts'));
    for (const s of stems) for (const c of CANDIDATES) {
      const f = s + c;
      try { if (fs.statSync(f).isFile()) return next(pathToFileURL(f).href, context); } catch { }
    }
  }
  return next(specifier, context);
}
