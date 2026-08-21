/**
 * Sweeps all three gates plus the Appendix B invariants over a directory tree.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';
import { diffCalls } from './diff-calls';
import { diffDecl } from './diff-decl';
import { diffFile } from './diff-oracle';

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['__pycache__','.git','node_modules','lib2to3'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.py')) out.push(p);
  }
  return out;
}

const SPINE_ARITY: Record<string, number> = {
  py_module: 24, py_scope: 25, py_binding: 29, py_type: 25, py_type_base: 16,
  py_method: 36, py_method_parameter: 22, py_import: 24, py_expression: 39, py_call_site: 26,
};

/** Appendix B invariants 1-8, checked structurally on one file's output. */
function checkInvariants(file: string, sv: string): string[] {
  const problems: string[] = [];
  const emit = () => new PythonFactExtractor().extract({
    sourceCode: fs.readFileSync(file, 'utf8'), filePath: file, baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''), serviceVersionLinkHash: sv });
  const f = emit();
  if (!f.module) return problems;

  const rel: [string, { toCsv(): string; getHash(): string }[]][] = [
    ['py_module', [f.module]], ['py_scope', f.scopes], ['py_binding', f.bindings],
    ['py_type', f.types], ['py_type_base', f.typeBases], ['py_method', f.methods],
    ['py_method_parameter', f.methodParameters], ['py_import', f.imports],
    ['py_expression', f.expressions], ['py_call_site', f.callSites],
  ];

  const allPks = new Set<string>();
  for (const [name, rows] of rel) {
    const seen = new Set<string>();
    for (const r of rows) {
      const cols = r.toCsv().split('\t');
      // #6 column-count invariance
      if (cols.length !== SPINE_ARITY[name]) problems.push(`ARITY ${name}: ${cols.length} != ${SPINE_ARITY[name]}`);
      const pk = cols[cols.length - 1]!;
      // #3 prefix discipline
      if (!/^PY_[A-Z_]+_[0-9a-f]{32}$/.test(pk)) problems.push(`PK_SHAPE ${name}: ${pk}`);
      // #2 no PK collisions
      if (seen.has(pk)) problems.push(`PK_COLLISION ${name}: ${pk}`);
      seen.add(pk); allPks.add(pk);
      // #4 serviceVersionLinkHash present, immediately before the PK
      if (cols[cols.length - 2] !== sv) problems.push(`SVC ${name}: ${cols[cols.length - 2]}`);
    }
  }

  // #1 referential integrity for the FKs that must always resolve
  for (const s of f.scopes) {
    const parent = s.toCsv().split('\t')[4]!;
    if (parent && !allPks.has(parent)) problems.push(`FK py_scope.parentScopeLinkHash -> ${parent}`);
  }
  for (const b of f.bindings) {
    const scope = b.toCsv().split('\t')[1]!;
    if (!allPks.has(scope)) problems.push(`FK py_binding.pyScopeLinkHash -> ${scope}`);
  }
  for (const c of f.callSites) {
    const cols = c.toCsv().split('\t');
    if (!allPks.has(cols[5]!)) problems.push(`FK py_call_site.pyExpressionLinkHash -> ${cols[5]}`);
    // #7 ownership totality
    if (!allPks.has(cols[8]!)) problems.push(`FK py_call_site.pyMethodLinkHash -> ${cols[8]}`);
  }
  // #8 scope forest: exactly one root
  const roots = f.scopes.filter(s => s.toCsv().split('\t')[4] === '');
  if (roots.length !== 1) problems.push(`SCOPE_ROOTS ${roots.length}`);

  // #5 byte-identical across runs
  const a = rel.flatMap(([, rows]) => rows.map(r => r.toCsv())).join('\n');
  const f2 = emit();
  const rel2: { toCsv(): string }[][] = [[f2.module!], f2.scopes, f2.bindings, f2.types,
    f2.typeBases, f2.methods, f2.methodParameters, f2.imports, f2.expressions, f2.callSites];
  const b2 = rel2.flatMap(rows => rows.map(r => r.toCsv())).join('\n');
  if (crypto.createHash('md5').update(a).digest('hex') !== crypto.createHash('md5').update(b2).digest('hex')) {
    problems.push('NOT_DETERMINISTIC');
  }
  return problems;
}

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
const skip = new Set<string>(); if (li >= 0) skip.add(args[li + 1]!);
const dirs = args.filter(a => !a.startsWith('--') && !skip.has(a));

let files: string[] = [];
for (const d of dirs) files = files.concat(walk(d, []));
files.sort(); files = files.slice(0, limit);

const kinds = new Map<string, number>();
const samples: string[] = [];
let clean = 0, errored = 0;
const totals = { scopes: 0, bindings: 0, calls: 0, exprs: 0 };

for (const f of files) {
  const problems: string[] = [];
  try {
    const g1 = diffFile(f); problems.push(...g1.problems.map(p => 'G1 ' + p));
    totals.scopes += g1.scopeExpected; totals.bindings += g1.bindExpected;
    const g2 = diffDecl(f); problems.push(...g2.problems.map(p => 'G2 ' + p));
    const g3 = diffCalls(f); problems.push(...g3.problems.map(p => 'G3 ' + p));
    totals.calls += g3.counts.expected ?? 0; totals.exprs += g3.counts.expressions ?? 0;
    problems.push(...checkInvariants(f, 'SERVICE_VERSION_test').map(p => 'INV ' + p));
  } catch (e: any) {
    errored++;
    problems.push('THREW ' + String(e.message).split('\n')[0].slice(0, 70));
  }
  if (problems.length === 0) { clean++; continue; }
  for (const p of problems) {
    const k = p.split(' ').slice(0, 2).join(' ');
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
    if (samples.length < 20) samples.push(`${path.basename(f)}: ${p}`);
  }
}
console.log(`\nfiles: ${files.length}  fully clean: ${clean}  errored: ${errored}`);
console.log(`checked: ${totals.scopes} scopes, ${totals.bindings} bindings, ${totals.calls} calls, ${totals.exprs} expressions`);
if (kinds.size) {
  console.log('\nproblem kinds:');
  [...kinds.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${String(v).padStart(6)}  ${k}`));
  console.log('\nsamples:'); samples.forEach(s => console.log('  ' + s));
}
