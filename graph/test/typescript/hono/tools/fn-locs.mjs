#!/usr/bin/env node
// List every function in a fixture with the location key the suite uses (`<file>:<line>:<col>`),
// for writing `absent` rows of a negative control by hand.   usage: fn-locs.mjs <src-dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { loadTypeScript } = await import(new URL('../../ground-truth/load-typescript.mjs', import.meta.url).href);
const ts = loadTypeScript(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'truth'), { toolName: 'fn-locs' });
const src = path.resolve(process.argv[2]);
for (const f of fs.readdirSync(src, { recursive: true }).filter(f => /\.(m?[jt]sx?|cjs)$/.test(f)).sort()) {
  const sf = ts.createSourceFile(f, fs.readFileSync(path.join(src, f), 'utf8'), ts.ScriptTarget.Latest, true);
  (function v(n) {
    if (ts.isFunctionLike(n) && n.body) {
      const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      console.log(`${f.split(path.sep).join('/')}:${p.line + 1}:${p.character + 1}\t${n.getText(sf).split('\n')[0].slice(0, 60)}`);
    }
    ts.forEachChild(n, v);
  })(sf);
}
