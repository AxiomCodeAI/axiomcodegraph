/**
 * py_method_parameter differential against CPython ast.
 *
 * Targets code A3 changed in bdcfa3c ("Skip grammar extras in parameter lists
 * too"): a comment or line continuation inside a parameter list is a NAMED
 * node, so a walker that counts named children mis-classifies it.  This lens
 * is one of the eight spine relations Gate 1 cannot see.
 *
 * For every function/lambda the ast reports, emit the parameter NAMES in order
 * plus each one's kind, and compare with the parser's rows keyed on
 * (line, column) of the owning method.
 *
 * Usage: tsx a4tools/params.ts --files <list.txt> --out <out.jsonl>
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PY = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10';
const ORACLE = '/tmp/a4-wt2/a4tools/ast_params.py';

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
  let oracle: { funcs?: Record<string, string[]>; error?: string };
  try {
    oracle = JSON.parse(execFileSync(PY, [ORACLE, f], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  } catch { continue; }
  if (oracle.error || !oracle.funcs) continue;

  let facts;
  try {
    facts = extractor.extract({ sourceCode: src, filePath: f, baseMservPath: '/', serviceVersionLinkHash: 'A4' } as never);
  } catch (e) {
    buf.push(JSON.stringify({ file: f, parserThrew: String((e as Error).message).slice(0, 150) }));
    continue;
  }
  if (facts.skippedReason) continue;

  // method PK -> "line:col"
  const methodPos = new Map<string, string>();
  const methodPosSet = new Set<string>();
  const synthetic = new Set<string>();
  for (const m of facts.methods) {
    const r = m as never as { pyMethodUniqueHash: string; startLine: number; startColumn: number; methodKind: string };
    const k = `${r.startLine}:${r.startColumn}`;
    methodPos.set(r.pyMethodUniqueHash, k);
    methodPosSet.add(k);
    // <module> and <classbody> are parser synthetics with no ast counterpart
    if (r.methodKind === 'MODULE_INITIALIZER' || r.methodKind === 'CLASS_INITIALIZER') synthetic.add(k);
  }
  const mine = new Map<string, string[]>();
  for (const p of facts.methodParameters) {
    const r = p as never as { pyMethodLinkHash: string; paramName: string; paramKind: string; position: number };
    const k = methodPos.get(r.pyMethodLinkHash);
    if (!k) continue;
    // marker rows (`/` and `*`) are a parser modelling choice with no ast
    // counterpart, so they are excluded rather than counted as divergences
    if (r.paramKind.endsWith('_MARKER')) continue;
    const list = mine.get(k) ?? [];
    list.push(`${r.paramName}:${r.paramKind}`);
    mine.set(k, list);
  }

  const diffs: Array<{ at: string; ours: string[]; cpython: string[] }> = [];
  const methodMissing: string[] = [];
  for (const [k, expected] of Object.entries(oracle.funcs)) {
    if (!methodPosSet.has(k)) { methodMissing.push(k); continue; }
    const got = (mine.get(k) ?? []).slice().sort();
    const want = expected.slice().sort();
    if (got.join(',') !== want.join(',')) diffs.push({ at: k, ours: got, cpython: want });
  }
  const methodSpurious: string[] = [];
  for (const k of methodPosSet) if (!(k in oracle.funcs) && !synthetic.has(k)) methodSpurious.push(k);
  if (diffs.length || methodMissing.length || methodSpurious.length) {
    buf.push(JSON.stringify({ file: f, counts: { paramDiff: diffs.length, methodMissing: methodMissing.length, methodSpurious: methodSpurious.length },
      diffs: diffs.slice(0, 4), methodMissing: methodMissing.slice(0, 4), methodSpurious: methodSpurious.slice(0, 4) }));
  }
  if (++n % 200 === 0) { fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : '')); buf = []; fs.writeSync(2, `${n}\n`); }
}
fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : ''));
fs.writeSync(2, `params: ${n} files\n`);
process.exit(0);
