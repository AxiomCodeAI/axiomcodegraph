/**
 * Mapping proof: print every fact row A4 compares, beside the exact CPython
 * value it is compared to, for one file. The point is that the mapping is
 * AUDITABLE rather than asserted — a differential is only as good as its
 * mapping, and three of A4's early "findings" turned out to be mapping bugs.
 *
 * Usage: tsx a4tools/mapproof.ts <file.py>
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PY = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10';
const f = process.argv[2];
const src = fs.readFileSync(f, 'utf8');

const sym = JSON.parse(execFileSync(PY, ['/tmp/a4-wt3/a4tools/symtable_dump.py', f], { encoding: 'utf8' }));
const astp = JSON.parse(execFileSync(PY, ['/tmp/a4-wt3/a4tools/ast_params.py', f], { encoding: 'utf8' }));
const astt = JSON.parse(execFileSync(PY, ['/tmp/a4-wt3/a4tools/ast_types.py', f], { encoding: 'utf8' }));
const facts = new PythonFactExtractor().extract({
  sourceCode: src, filePath: f, baseMservPath: '/', serviceVersionLinkHash: 'A4',
} as never);

const KIND = (k: string): string => {
  const s = k.toUpperCase();
  if (s.startsWith('MODULE')) return 'MODULE';
  if (s.startsWith('CLASS')) return 'CLASS';
  if (s.startsWith('LAMBDA')) return 'LAMBDA';
  if (s.includes('COMPREHENSION') || s.includes('GENERATOR')) return 'COMPREHENSION';
  return 'FUNCTION';
};
const P = ['param', 'local', 'global', 'nonlocal', 'free', 'imported', 'assigned', 'referenced', 'declGlobal', 'annotated', 'namespace'];

console.log('='.repeat(100));
console.log('py_scope  ->  symtable block          key = (kind, name, startLine)');
console.log('='.repeat(100));
console.log(`${'OURS: kind|name|line'.padEnd(46)} | ${'CPYTHON: kind|name|line'.padEnd(40)} | match`);
const oScopes = new Map<string, number>();
for (const s of sym.scopes) oScopes.set(`${KIND(s.kind)}|${s.name}|${s.line}`, 1);
const scopeKeyByHash = new Map<string, string>();
for (const s of facts.scopes) {
  const r = s as never as { scopeKind: string; name: string; startLine: number; pyScopeUniqueHash: string };
  const k = `${KIND(r.scopeKind)}|${r.name}|${r.startLine}`;
  scopeKeyByHash.set(r.pyScopeUniqueHash, k);
  const raw = `${r.scopeKind}|${r.name}|${r.startLine}`;
  console.log(`${raw.padEnd(46)} | ${(oScopes.has(k) ? k : '(none)').padEnd(40)} | ${oScopes.has(k) ? 'yes' : 'NO'}`);
}
for (const k of oScopes.keys()) if (![...scopeKeyByHash.values()].includes(k)) console.log(`${'(none)'.padEnd(46)} | ${k.padEnd(40)} | MISSING`);

console.log('');
console.log('='.repeat(100));
console.log('py_binding -> symtable Symbol          key = (scopeKey, name);  11 predicate bits, in order:');
console.log('   ' + P.join(' '));
console.log('='.repeat(100));
const oBind = new Map<string, boolean[]>();
for (const b of sym.bindings) oBind.set(`${b.scope}|${b.name}`, b.p);
const seen = new Set<string>();
for (const b of facts.bindings) {
  const r = b as never as Record<string, unknown>;
  const sk = scopeKeyByHash.get(String(r.pyScopeLinkHash)) ?? '?';
  const key = `${sk}|${String(r.name)}`;
  seen.add(key);
  const mine = [r.isParameter, r.isLocal, r.isGlobal, r.isNonlocal, r.isFree, r.isImported,
    r.isAssigned, r.isReferenced, r.isDeclaredGlobal, r.isAnnotated, r.isNamespace].map((v) => (v ? 1 : 0)).join('');
  const theirs = oBind.get(key);
  const t = theirs ? theirs.map((v) => (v ? 1 : 0)).join('') : '(absent)';
  const verdict = !theirs ? 'SPURIOUS' : mine === t ? 'yes' : 'PREDICATE DIFF';
  console.log(`${key.padEnd(52)} ours=${mine}  cpython=${t}  ${verdict}`);
}
for (const [k, p] of oBind) {
  if (!seen.has(k)) console.log(`${k.padEnd(52)} ours=(absent)     cpython=${p.map((v) => (v ? 1 : 0)).join('')}  MISSING`);
}

console.log('');
console.log('='.repeat(100));
console.log('py_method / py_method_parameter -> ast   key = (startLine, startColumn) of the def/lambda');
console.log('='.repeat(100));
const mpos = new Map<string, string>();
for (const m of facts.methods) {
  const r = m as never as Record<string, unknown>;
  mpos.set(String(r.pyMethodUniqueHash), `${r.startLine}:${r.startColumn}`);
}
const mine = new Map<string, string[]>();
for (const p of facts.methodParameters) {
  const r = p as never as Record<string, unknown>;
  const k = mpos.get(String(r.pyMethodLinkHash));
  if (!k) continue;
  if (String(r.paramKind).endsWith('_MARKER')) continue;
  (mine.get(k) ?? mine.set(k, []).get(k)!).push(`${r.paramName}:${r.paramKind}`);
}
for (const [k, want] of Object.entries(astp.funcs as Record<string, string[]>)) {
  const got = mine.get(k);
  const present = [...mpos.values()].includes(k);
  const v = !present ? 'METHOD MISSING' : (got ?? []).slice().sort().join(',') === want.slice().sort().join(',') ? 'yes' : 'PARAM DIFF';
  console.log(`at ${k.padEnd(10)} ours=${JSON.stringify(got ?? null).padEnd(46)} cpython=${JSON.stringify(want).padEnd(46)} ${v}`);
}

console.log('');
console.log('='.repeat(100));
console.log('py_type / py_type_base -> ast   key = startLine of the class (py_type has no startColumn)');
console.log('   base order = `position` for positional rows, then keyword rows; IMPLICIT_OBJECT excluded');
console.log('='.repeat(100));
const tpos = new Map<string, string>();
const tname = new Map<string, string>();
for (const t of facts.types) {
  const r = t as never as Record<string, unknown>;
  tpos.set(String(r.pyTypeUniqueHash), String(r.startLine));
  tname.set(String(r.startLine), `${r.name} [${r.typeCategory}]`);
}
const tbases = new Map<string, Array<[number, string]>>();
for (const b of facts.typeBases) {
  const r = b as never as Record<string, unknown>;
  const k = tpos.get(String(r.pyTypeLinkHash));
  if (!k) continue;
  const label = String(r.baseKind) === 'IMPLICIT_OBJECT' ? `(implicit ${r.baseText})`
    : String(r.keywordName) ? `${r.keywordName}=${r.baseText}` : String(r.baseText);
  const pos = String(r.position) === '' ? Number.MAX_SAFE_INTEGER : Number(r.position);
  const list = tbases.get(k) ?? [];
  list.push([String(r.baseKind) === 'IMPLICIT_OBJECT' ? -1 : pos, label]);
  tbases.set(k, list);
}
for (const [k, want] of Object.entries(astt.classes as Record<string, { name: string; bases: string[] }>)) {
  const got = (tbases.get(k) ?? []).slice().sort((a, b2) => a[0] - b2[0])
    .filter((x) => x[0] >= 0).map((x) => x[1]);
  const all = (tbases.get(k) ?? []).slice().sort((a, b2) => a[0] - b2[0]).map((x) => x[1]);
  const ok = got.join(' | ') === want.bases.join(' | ') && tname.has(k);
  console.log(`line ${k.padEnd(4)} ours=${(tname.get(k) ?? '(TYPE MISSING)').padEnd(34)} bases=${JSON.stringify(all).padEnd(52)}`);
  console.log(`         cpython=${want.name.padEnd(34)} bases=${JSON.stringify(want.bases).padEnd(52)} ${ok ? 'yes' : 'DIFF'}`);
}
