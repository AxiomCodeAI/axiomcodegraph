/**
 * WHICH INTERNAL INDEX KEYS ARE NOT UNIQUE?
 *
 *     npx tsx src/test/javascript-key-collisions.ts <corpus-root>
 *
 * A MEASUREMENT, not a gate, because most of these collisions are LEGAL
 * JavaScript. Two functions of the same name in one module is a bundle, not a
 * defect, and a check that forbade it would be wrong rather than strict. What
 * the numbers give is the blast radius of each under-specified key, which is
 * what decides whether it is worth fixing.
 *
 * ## Why this exists: it is a CLASS, not three incidents
 *
 * Three under-specified keys turned up one at a time, each found by a different
 * route and each looking like a one-off:
 *
 * - `js_parse_gap`'s PRIMARY KEY was `(module, kind, line, column)`, so a
 *   compiler that repeats a diagnostic produced duplicate PKs — and a duplicate
 *   does not collide, it DOUBLES.
 * - `typeByName` was first-wins across a file, so a bundle holding
 *   `class Parser` and a later `function Parser` put the second's members on the
 *   first, outside its own line span.
 * - `js_import.boundVariableLinkHash` is keyed on `(module, localName)`, so a
 *   later binding of that name takes the link. js-corpus measured 92.
 *
 * The third is what turns it into a sweep: a key that is a TUPLE OF NAMES is
 * unique only as long as the names are, and JavaScript does not promise that
 * anywhere. So every name-keyed index in the front end is enumerated here and
 * measured, rather than argued about one at a time.
 *
 * ## What it finds, over 4,561 files
 *
 * Four indexes, all of them colliding:
 *
 * | index | colliding keys | shadowed rows |
 * |---|---|---|
 * | `declarationTargetByName` (free methods) | 570 | 3,999 |
 * | `typeByName` | 252 | 659 |
 * | `importByLocalName` | 57 | 92 |
 * | `accessorFieldByOwnerAndName` | 4 | 5 |
 *
 * The `importByLocalName` figure of 92 was derived here independently and
 * matches js-corpus's 92 of 16,812 exactly, which is the useful kind of
 * agreement: two different routes to the same number.
 *
 * `accessorFieldByOwnerAndName` is the one whose cause is not name reuse. Its
 * key is `ownerHash:name` with **no `isStatic`** — so a static and an instance
 * accessor of one name are two members under one key — and its measured
 * collisions are all COMPUTED-name accessors, which every one of them reports as
 * the empty string, so `get [a]()` and `get [b]()` on one class are
 * indistinguishable to it.
 *
 * ## Not fixed here
 *
 * Every one of these is filed and queued. A "shadowed row" is not automatically
 * a wrong row either — for `declarationTargetByName` it matters only when the
 * shadowed name is also exported, and the export gate already passes, so the
 * upper bound and the actual defect count are different numbers. Sizing them is
 * what this tool is for.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';
const stream = (f: string, cb: (l: string, i: number) => void): void => {
  const fd = fs.openSync(f, 'r');
  try { const C = 1 << 20; const b = Buffer.allocUnsafe(C); let c = ''; let i = 0; let p = 0;
    for (;;) { const n = fs.readSync(fd, b, 0, C, p); if (n <= 0) break; p += n;
      const parts = (c + b.toString('utf-8', 0, n)).split('\n'); c = parts.pop() ?? '';
      for (const l of parts) { if (l !== '') { cb(l, i); i += 1; } } }
  } finally { fs.closeSync(fd); }
};
(async () => {
  const root = process.argv[2]!;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'js-keys-'));
  await new JavaScriptProjectAnalyzer().analyze({ rootDir: root, outputDir: out,
    baseMservPath: root, serviceVersionLink: 'keys' });
  const each = (f: string, cb: (r: string[], h: string[]) => void): void => {
    let h: string[] = [];
    stream(path.join(out, f), (l, i) => { if (i === 0) { h = l.split('\t'); return; } cb(l.split('\t'), h); });
  };
  const collide = (
    label: string, file: string, keyOf: (r: string[], h: string[]) => string | undefined
  ): void => {
    const counts = new Map<string, number>();
    const examples = new Map<string, string[]>();
    each(file, (r, h) => {
      const k = keyOf(r, h);
      if (k === undefined) return;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      const e = examples.get(k) ?? [];
      if (e.length < 3) { e.push(`L${r[h.indexOf('startLine')]}`); examples.set(k, e); }
    });
    let keys = 0; let extra = 0;
    const shown: string[] = [];
    for (const [k, n] of counts) {
      if (n <= 1) continue;
      keys += 1; extra += n - 1;
      if (shown.length < 3) shown.push(`${k.split('|').slice(1).join('|')} x${n} @ ${(examples.get(k) ?? []).join(',')}`);
    }
    console.log(`  ${label.padEnd(46)} ${String(keys).padStart(5)} colliding keys, `
      + `${String(extra).padStart(6)} shadowed rows`);
    for (const s of shown) console.log(`       ${s}`);
  };

  console.log('\nNAME-KEYED INDEX COLLISIONS, per module');
  console.log('='.repeat(88));
  collide('typeByName / declarationTargetByName (js_type)', 'all-javascript-types.csv',
    (r, h) => `${r[h.indexOf('ownerModuleLinkHash')]}|${r[h.indexOf('name')]}`);
  collide('importByLocalName (js_import.localName)', 'all-javascript-imports.csv',
    (r, h) => {
      const n = r[h.indexOf('localName')] ?? '';
      return n === '' ? undefined : `${r[h.indexOf('ownerModuleLinkHash')]}|${n}`;
    });
  collide('declarationTargetByName, free methods', 'all-javascript-methods.csv',
    (r, h) => {
      const n = r[h.indexOf('name')] ?? '';
      if (n === '' || n.startsWith('<') || (r[h.indexOf('ownerTypeLinkHash')] ?? '') !== '') {
        return undefined;
      }
      return `${r[h.indexOf('ownerModuleLinkHash')]}|${n}`;
    });
  collide('accessorFieldByOwnerAndName (owner:name, no isStatic)',
    'all-javascript-methods.csv', (r, h) => {
      const kind = r[h.indexOf('methodKind')] ?? '';
      if (kind !== 'GETTER' && kind !== 'SETTER') return undefined;
      const owner = r[h.indexOf('ownerTypeLinkHash')] ?? '';
      if (owner === '') return undefined;
      // The key as the extractor builds it: owner + name, and NOT isStatic.
      // A collision here is only real when the two differ in staticness or are
      // the same accessor kind twice.
      return `${owner}|${r[h.indexOf('name')]}|${kind}`;
    });
  fs.rmSync(out, { recursive: true, force: true });
})();
