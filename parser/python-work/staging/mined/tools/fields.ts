/**
 * py_field differential against ast — the relation A3 un-deferred in 795b7a3.
 *
 * Compares the SET of field names per class. `fieldOrigin` and `fieldModifier`
 * are derived classifications with no ast counterpart, so they are reported
 * separately as consistency checks rather than adjudicated.
 *
 * Usage: tsx a4tools/fields.ts --files <list.txt> --out <out.jsonl>
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PY = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10';
const ORACLE = '/tmp/a4-wt6/a4tools/ast_fields.py';

function arg(n: string): string | undefined {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const files = fs.readFileSync(arg('files')!, 'utf8').split('\n').filter(Boolean);
const out = arg('out')!;
const extractor = new PythonFactExtractor();
fs.writeFileSync(out, '');
let buf: string[] = [];
let n = 0;

for (const f of files) {
  let src: string;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!src.trim()) continue;
  let oracle: { classes?: Record<string, { name: string; fields: string[] }>; error?: string };
  try { oracle = JSON.parse(execFileSync(PY, [ORACLE, f], { encoding: 'utf8', maxBuffer: 1 << 28 })); }
  catch { continue; }
  if (oracle.error || !oracle.classes) continue;

  let facts;
  try { facts = extractor.extract({ sourceCode: src, filePath: f, baseMservPath: '/', serviceVersionLinkHash: 'A4' } as never); }
  catch (e) { buf.push(JSON.stringify({ file: f, parserThrew: String((e as Error).message).slice(0, 150) })); continue; }
  if (facts.skippedReason) continue;

  const typeKey = new Map<string, string>();
  for (const t of facts.types) {
    const r = t as never as Record<string, unknown>;
    typeKey.set(String(r.pyTypeUniqueHash), `${r.startLine}`);
  }
  const mine = new Map<string, Set<string>>();
  const dupModifier: string[] = [];
  const perOrigin = new Map<string, string[]>();
  for (const fld of (facts as never as { fields?: unknown[] }).fields ?? []) {
    const r = fld as Record<string, unknown>;
    const k = typeKey.get(String(r.pyTypeLinkHash));
    if (!k) continue;
    (mine.get(k) ?? mine.set(k, new Set()).get(k)!).add(String(r.name));
    const mods = String(r.fieldModifier).split(',').filter(Boolean);
    if (new Set(mods).size !== mods.length) dupModifier.push(`${r.name}:${r.fieldModifier}`);
    const ok = `${k}|${r.name}`;
    (perOrigin.get(ok) ?? perOrigin.set(ok, []).get(ok)!).push(
      `${r.fieldOrigin}/writeCount=${r.writeCount}/readOnly=${String(r.fieldModifier).includes('READ_ONLY')}`);
  }
  const missing: Array<{ cls: string; names: string[] }> = [];
  const spurious: Array<{ cls: string; names: string[] }> = [];
  for (const [k, want] of Object.entries(oracle.classes)) {
    const got = mine.get(k.split(':')[0]!) ?? new Set<string>();
    const miss = want.fields.filter((x) => !got.has(x));
    const spur = [...got].filter((x) => !want.fields.includes(x));
    if (miss.length) missing.push({ cls: want.name, names: miss.slice(0, 8) });
    if (spur.length) spurious.push({ cls: want.name, names: spur.slice(0, 8) });
  }
  const contradictory = [...perOrigin.entries()]
    .filter(([, v]) => v.length > 1 && new Set(v.map((x) => x.split('/')[2])).size > 1)
    .map(([k, v]) => `${k} :: ${v.join(' | ')}`);
  if (missing.length || spurious.length || dupModifier.length || contradictory.length) {
    buf.push(JSON.stringify({ file: f,
      counts: { missing: missing.length, spurious: spurious.length, dupModifier: dupModifier.length, contradictory: contradictory.length },
      missing: missing.slice(0, 4), spurious: spurious.slice(0, 4),
      dupModifier: dupModifier.slice(0, 3), contradictory: contradictory.slice(0, 3) }));
  }
  if (++n % 200 === 0) { fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : '')); buf = []; fs.writeSync(2, `${n}\n`); }
}
fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : ''));
fs.writeSync(2, `fields: ${n} files\n`);
process.exit(0);
