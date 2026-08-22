/**
 * py_type / py_type_base differential against ast.
 *
 * Targets code A3 changed in 8b46a49 (typeCategory propagation through
 * same-module bases). ast cannot adjudicate typeCategory — it is a derived
 * classification — but it CAN adjudicate two things that carry the MRO:
 *   - which classes exist, keyed on (startLine, startColumn)
 *   - the ORDER and TEXT of each class's bases, including keywords
 *
 * Base ORDER is the load-bearing part: Python's MRO is order-sensitive, so a
 * transposed py_type_base pair is a silently wrong MRO, not a cosmetic diff.
 *
 * Usage: tsx a4tools/types.ts --files <list.txt> --out <out.jsonl>
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PY = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10';
const ORACLE = '/tmp/a4-wt3/a4tools/ast_types.py';

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
  let oracle: { classes?: Record<string, { name: string; bases: string[] }>; error?: string };
  try {
    oracle = JSON.parse(execFileSync(PY, [ORACLE, f], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  } catch { continue; }
  if (oracle.error || !oracle.classes) continue;

  let facts;
  try {
    facts = extractor.extract({ sourceCode: src, filePath: f, baseMservPath: '/', serviceVersionLinkHash: 'A4' } as never);
  } catch (e) {
    buf.push(JSON.stringify({ file: f, parserThrew: String((e as Error).message).slice(0, 150) }));
    continue;
  }
  if (facts.skippedReason) continue;

  const typePos = new Map<string, string>();
  const posName = new Map<string, string>();
  for (const t of facts.types) {
    const r = t as never as Record<string, unknown>;
    // py_type carries startLine but NO startColumn, so the key is the line:
    // two class statements cannot start on the same line (a compound statement
    // cannot follow a `;`), which makes the line unique for classes.
    const k = `${r.startLine}`;
    typePos.set(String(r.pyTypeUniqueHash), k);
    posName.set(k, String(r.name));
  }
  // bases in emitted order, per owning type
  const mine = new Map<string, Array<[number, string]>>();
  for (const b of facts.typeBases) {
    const r = b as never as Record<string, unknown>;
    const k = typePos.get(String(r.pyTypeLinkHash));
    if (!k) continue;
    if (String(r.baseKind) === 'IMPLICIT_OBJECT') continue; // parser-side modelling, no ast counterpart
    const label = String(r.keywordName) ? `${r.keywordName}=${r.baseText}` : String(r.baseText);
    // schema col 1: `position` is the 0-based MRO order among POSITIONAL bases
    // and is "" for keyword rows. Number("") is 0, so sorting the two together
    // interleaves the keyword row — split them instead, positional by position
    // and keyword in emission order, which is the order ast lists them.
    const pos = String(r.position);
    const list = mine.get(k) ?? [];
    list.push([pos === '' ? Number.MAX_SAFE_INTEGER : Number(pos), label]);
    mine.set(k, list);
  }

  const typeMissing: string[] = [];
  const nameDiff: Array<{ at: string; ours: string; cpython: string }> = [];
  const baseDiff: Array<{ at: string; ours: string[]; cpython: string[] }> = [];
  for (const [k, want] of Object.entries(oracle.classes)) {
    if (!posName.has(k)) { typeMissing.push(k); continue; }
    if (posName.get(k) !== want.name) nameDiff.push({ at: k, ours: posName.get(k)!, cpython: want.name });
    const got = (mine.get(k) ?? []).slice().sort((a, b2) => a[0] - b2[0]).map((x) => x[1]);  // stable: equal keys keep emission order
    if (got.join(' | ') !== want.bases.join(' | ')) baseDiff.push({ at: k, ours: got, cpython: want.bases });
  }
  const typeSpurious = [...posName.keys()].filter((k) => !(k in oracle.classes));
  if (typeMissing.length || nameDiff.length || baseDiff.length || typeSpurious.length) {
    buf.push(JSON.stringify({ file: f,
      counts: { typeMissing: typeMissing.length, typeSpurious: typeSpurious.length, nameDiff: nameDiff.length, baseDiff: baseDiff.length },
      typeMissing: typeMissing.slice(0, 4), typeSpurious: typeSpurious.slice(0, 4),
      nameDiff: nameDiff.slice(0, 3), baseDiff: baseDiff.slice(0, 4) }));
  }
  if (++n % 200 === 0) { fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : '')); buf = []; fs.writeSync(2, `${n}\n`); }
}
fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : ''));
fs.writeSync(2, `types: ${n} files\n`);
process.exit(0);
