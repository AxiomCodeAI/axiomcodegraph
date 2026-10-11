import * as fs from 'fs';
import * as path from 'path';
import { Case, Jsonl, arg, fileCases, walkFiles } from './common';
import { axiomStylesheet, compareCss, postcssThrows, refStylesheet } from './css-ref';

const corpus = arg('corpus')!;
const root = arg('root')!;
const mode = arg('mode', 'files');
const out = new Jsonl(arg('out', path.resolve(__dirname, `results/css-${corpus}.jsonl`))!);

/** csstree ast fixtures: every `source` wrapped into a stylesheet by its context directory. */
function* csstreeFixtures(): Generator<Case> {
  const WRAP: Record<string, (s: string) => string | null> = {
    stylesheet: (s) => s, rule: (s) => s, atrule: (s) => s, block: (s) => `*${s}`,
    declaration: (s) => `*{${s}}`, declarationList: (s) => `*{${s}}`, selector: (s) => `${s}{}`, selectorList: (s) => `${s}{}`,
    atrulePrelude: () => null, mediaQuery: () => null, mediaQueryList: () => null, value: () => null,
  };
  for (const file of walkFiles(path.join(root, 'fixtures/ast'), ['.json']).sort()) {
    const ctx = path.basename(path.dirname(file));
    const wrap = WRAP[ctx];
    if (wrap === undefined) continue;
    const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, any>;
    for (const [name, fixture] of Object.entries(json)) {
      if (typeof fixture !== 'object' || fixture === null || typeof fixture.source !== 'string' || fixture.error !== undefined) continue;
      if (fixture.options?.property !== undefined) continue;
      const content = wrap(fixture.source);
      if (content === null) continue;
      yield { id: `${path.relative(root, file)}#${name}`, file: `${file}.css`, root, content, corpus };
    }
  }
}

const cases = mode === 'csstree' ? csstreeFixtures() : fileCases(corpus, root, ['.css']);
let n = 0;
for (const c of cases) {
  n += 1;
  if (n % 200 === 0) process.stderr.write(`${corpus}: ${n}\n`);
  const rec: Record<string, unknown> = { corpus, id: c.id };
  const ref = refStylesheet(c.content);
  rec.postcssError = postcssThrows(c.content);
  try {
    const ax = axiomStylesheet(c.content, c.file, c.root);
    Object.assign(rec, compareCss(ref, ax, c.content));
  } catch (e: any) {
    rec.crash = String(e?.stack ?? e).slice(0, 400);
    rec.bytes = c.content.length;
  }
  if (c.content.length < 400) rec.source = c.content;
  out.write(rec);
}
out.close();
process.stderr.write(`${corpus}: done ${n}\n`);
