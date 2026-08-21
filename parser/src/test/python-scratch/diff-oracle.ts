/**
 * Differential check: my extractor vs the pinned CPython oracle.
 * Usage: npx tsx src/test/python-scratch/diff-oracle.ts <file.py> [--verbose]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonScopeExtractor } from '@/parsers/python/extractors/python-scope-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const ORACLE = path.join(process.cwd(), 'src/test/python-oracle/oracle/emit_oracle.py');
const PREDICATES = ['is_parameter','is_local','is_global','is_nonlocal','is_free','is_imported',
  'is_assigned','is_referenced','is_declared_global','is_annotated','is_namespace'];

export interface DiffResult {
  file: string;
  scopeExpected: number; scopeActual: number; scopeMatched: number;
  bindExpected: number; bindActual: number; bindMatched: number;
  problems: string[];
}

export function diffFile(file: string, verbose = false): DiffResult {
  const src = fs.readFileSync(file, 'utf8');
  const raw = execFileSync(PINNED, [ORACLE, "--file", file, "--module-qname", path.basename(file).replace(/\.pyi?$/, "")], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const oracle = JSON.parse(raw);

  const extraction = new PythonScopeExtractor().extract({
    sourceCode: src,
    filePath: file,
    baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });

  const problems: string[] = [];
  const sKey = (kind: string, q: string, l: number, c: number) => `${kind}|${q}|${l}:${c}`;

  const expScopes = new Map<string, any>();
  for (const s of oracle.scopes) expScopes.set(sKey(s.scopeKind, s.qualifiedName, s.startLine, s.startColumn), s);

  const actScopes = new Map<string, any>();
  const scopeHashToKey = new Map<string, string>();
  for (const s of extraction.scopes) {
    const row = s.toCsv().split('\t');
    const k = sKey(row[0]!, row[2]!, Number(row[18]), Number(row[19]));
    if (actScopes.has(k)) problems.push(`SCOPE_KEY_COLLISION ${k}`);
    actScopes.set(k, row);
    scopeHashToKey.set(s.getHash(), k);
  }

  let scopeMatched = 0;
  for (const [k, exp] of expScopes) {
    const act = actScopes.get(k);
    if (!act) { problems.push(`SCOPE_MISSING ${k}`); continue; }
    scopeMatched++;
    const checks: [string, any, any][] = [
      ['scopeKind', exp.scopeKind, act[0]], ['name', exp.name, act[1]],
      ['qualifiedName', exp.qualifiedName, act[2]], ['nestingDepth', exp.nestingDepth, act[3]],
      ['isNested', exp.isNested, act[8]], ['isOptimized', exp.isOptimized, act[9]],
      ['hasChildren', exp.hasChildren, act[10]], ['startLine', exp.startLine, act[18]],
      ['startColumn', exp.startColumn, act[19]], ['scopeOrdinal', exp.scopeOrdinal, act[22]],
    ];
    for (const [f, e, a] of checks) {
      if (String(e) !== String(a)) problems.push(`SCOPE_FIELD ${k} ${f}: oracle=${e} mine=${a}`);
    }
  }
  for (const k of actScopes.keys()) if (!expScopes.has(k)) problems.push(`SCOPE_SPURIOUS ${k}`);

  const oScopeIdToKey = new Map<string, string>();
  for (const s of oracle.scopes) oScopeIdToKey.set(s.scopeId, sKey(s.scopeKind, s.qualifiedName, s.startLine, s.startColumn));

  const expBinds = new Map<string, any>();
  for (const b of oracle.bindings) expBinds.set(`${oScopeIdToKey.get(b.scopeId)}::${b.name}`, b);

  const actBinds = new Map<string, string[]>();
  for (const b of extraction.bindings) {
    const row = b.toCsv().split('\t');
    const k = `${scopeHashToKey.get(row[1]!) ?? '<unresolved>'}::${row[0]}`;
    if (actBinds.has(k)) problems.push(`BIND_KEY_COLLISION ${k}`);
    actBinds.set(k, row);
  }

  let bindMatched = 0;
  for (const [k, exp] of expBinds) {
    const act = actBinds.get(k);
    if (!act) { problems.push(`BIND_MISSING ${k}`); continue; }
    bindMatched++;
    for (let i = 0; i < PREDICATES.length; i++) {
      const e = String(exp[PREDICATES[i]!]); const a = act[4 + i];
      if (e !== a) problems.push(`BIND_PRED ${k} ${PREDICATES[i]} (c${4+i}): oracle=${e} mine=${a}`);
    }
  }
  for (const k of actBinds.keys()) if (!expBinds.has(k)) problems.push(`BIND_SPURIOUS ${k}`);

  if (verbose) problems.forEach(p => console.log('   ' + p));

  return { file, scopeExpected: expScopes.size, scopeActual: actScopes.size, scopeMatched,
    bindExpected: expBinds.size, bindActual: actBinds.size, bindMatched, problems };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const files = args.filter(a => !a.startsWith('--'));
  let totalProblems = 0;
  for (const f of files) {
    const r = diffFile(f, verbose);
    totalProblems += r.problems.length;
    const status = r.problems.length === 0 ? 'CLEAN' : `${r.problems.length} PROBLEMS`;
    console.log(`${status.padEnd(14)} ${path.basename(f).padEnd(46)} scopes ${r.scopeMatched}/${r.scopeExpected} bindings ${r.bindMatched}/${r.bindExpected}`);
  }
  console.log(totalProblems === 0 ? '\nALL CLEAN' : `\n${totalProblems} total problems`);
  process.exit(totalProblems === 0 ? 0 : 1);
}
