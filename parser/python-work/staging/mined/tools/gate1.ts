/**
 * A4 Gate-1 differential: A3's py_scope / py_binding against CPython symtable,
 * over a mined corpus, with an INDEPENDENT mapping (not A0's harness) so a
 * shared blind spot between parser and harness cannot hide.
 *
 * Run against the last PUSHED commit, in a detached worktree, never A3's
 * working tree.
 *
 * Usage: tsx a4tools/gate1.ts --files <list.txt> --out <out.jsonl> [--limit N]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PY = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10';
const ORACLE = '/tmp/a4-wt/a4tools/symtable_dump.py';

function arg(n: string): string | undefined {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface OracleScope { kind: string; name: string; line: number; qual: string }
interface OracleBinding { scope: string; name: string; p: boolean[] }
interface Oracle { scopes: OracleScope[]; bindings: OracleBinding[]; error?: string }

const files = fs.readFileSync(arg('files')!, 'utf8').split('\n').filter(Boolean);
const limit = Number(arg('limit') ?? files.length);
const out = arg('out')!;
const extractor = new PythonFactExtractor();
fs.writeFileSync(out, '');
let buf: string[] = [];
let n = 0;

// scopeKind names differ between the two vocabularies; normalise both.
const KIND = (k: string): string => {
  const s = k.toUpperCase();
  if (s.startsWith('MODULE')) return 'MODULE';
  if (s.startsWith('CLASS')) return 'CLASS';
  if (s.startsWith('LAMBDA')) return 'LAMBDA';
  if (s.includes('COMPREHENSION') || s.includes('GENERATOR')) return 'COMPREHENSION';
  return 'FUNCTION';
};

for (const f of files.slice(0, limit)) {
  let src: string;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!src.trim()) continue;

  let oracle: Oracle;
  try {
    oracle = JSON.parse(execFileSync(PY, [ORACLE, f], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  } catch (e) {
    buf.push(JSON.stringify({ file: f, oracleFailed: String((e as Error).message).slice(0, 120) }));
    continue;
  }
  if (oracle.error) { buf.push(JSON.stringify({ file: f, oracleError: oracle.error })); continue; }

  let facts;
  try {
    facts = extractor.extract({
      sourceCode: src, filePath: f, baseMservPath: '/', serviceVersionLinkHash: 'A4',
    } as never);
  } catch (e) {
    buf.push(JSON.stringify({ file: f, parserThrew: String((e as Error).message).slice(0, 200) }));
    continue;
  }
  if (facts.skippedReason) {
    buf.push(JSON.stringify({ file: f, rejected: facts.skippedReason, oracleScopes: oracle.scopes.length }));
    continue;
  }

  // ---- scopes: multiset on (kind, name, startLine) -----------------------
  const oScope = new Map<string, number>();
  for (const s of oracle.scopes) {
    const k = `${KIND(s.kind)}|${s.name}|${s.line}`;
    oScope.set(k, (oScope.get(k) ?? 0) + 1);
  }
  const pScope = new Map<string, number>();
  const scopeHashToKey = new Map<string, string>();
  for (const s of facts.scopes) {
    const k = `${KIND(String(s.scopeKind))}|${s.name}|${s.startLine}`;
    pScope.set(k, (pScope.get(k) ?? 0) + 1);
    scopeHashToKey.set((s as never as { pyScopeUniqueHash: string }).pyScopeUniqueHash, k);
  }
  const scopeMissing: string[] = [];
  const scopeSpurious: string[] = [];
  for (const [k, c] of oScope) { const d = c - (pScope.get(k) ?? 0); for (let i = 0; i < d; i++) scopeMissing.push(k); }
  for (const [k, c] of pScope) { const d = c - (oScope.get(k) ?? 0); for (let i = 0; i < d; i++) scopeSpurious.push(k); }

  // ---- bindings: key on (scopeKey, name), compare 11 predicates ----------
  const oBind = new Map<string, boolean[]>();
  for (const b of oracle.bindings) oBind.set(`${b.scope}|${b.name}`, b.p);
  const pBind = new Map<string, boolean[]>();
  const dotZero: string[] = [];
  for (const b of facts.bindings) {
    const sk = scopeHashToKey.get(b.pyScopeLinkHash) ?? '?';
    if (b.name === '.0') dotZero.push(sk);
    pBind.set(`${sk}|${b.name}`, [b.isParameter, b.isLocal, b.isGlobal, b.isNonlocal, b.isFree,
      b.isImported, b.isAssigned, b.isReferenced, b.isDeclaredGlobal, b.isAnnotated, b.isNamespace]);
  }
  const bindMissing: string[] = [];
  const bindSpurious: string[] = [];
  const predMismatch: Array<{ key: string; ours: string; cpython: string }> = [];
  for (const [k, p] of oBind) {
    const mine = pBind.get(k);
    if (!mine) { bindMissing.push(k); continue; }
    if (mine.some((v, i) => v !== p[i])) {
      predMismatch.push({ key: k, ours: mine.map((v) => (v ? 1 : 0)).join(''), cpython: p.map((v) => (v ? 1 : 0)).join('') });
    }
  }
  for (const k of pBind.keys()) if (!oBind.has(k)) bindSpurious.push(k);

  const clean = scopeMissing.length === 0 && scopeSpurious.length === 0 &&
    bindMissing.length === 0 && bindSpurious.length === 0 && predMismatch.length === 0 && dotZero.length === 0;
  buf.push(JSON.stringify({
    file: f, clean,
    nScopes: oracle.scopes.length, nBindings: oracle.bindings.length,
    scopeMissing: scopeMissing.slice(0, 6), scopeSpurious: scopeSpurious.slice(0, 6),
    bindMissing: bindMissing.slice(0, 6), bindSpurious: bindSpurious.slice(0, 6),
    predMismatch: predMismatch.slice(0, 6), dotZero: dotZero.slice(0, 3),
    counts: { scopeMissing: scopeMissing.length, scopeSpurious: scopeSpurious.length,
      bindMissing: bindMissing.length, bindSpurious: bindSpurious.length,
      predMismatch: predMismatch.length, dotZero: dotZero.length },
  }));
  if (++n % 25 === 0) { fs.appendFileSync(out, buf.join('\n') + '\n'); buf = []; fs.writeSync(2, `${n}\n`); }
}
fs.appendFileSync(out, buf.join('\n') + (buf.length ? '\n' : ''));
fs.writeSync(2, `gate1: ${n} files\n`);
process.exit(0);
