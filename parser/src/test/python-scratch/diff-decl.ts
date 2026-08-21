/**
 * Gate 2: declarations vs the oracle's ast cross-check.
 * Usage: npx tsx src/test/python-scratch/diff-decl.ts <file.py> [--verbose]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const ORACLE = path.join(process.cwd(), 'src/test/python-oracle/oracle/emit_oracle.py');

export interface DeclDiff { file: string; problems: string[]; counts: Record<string, number>; }

export function diffDecl(file: string, verbose = false): DeclDiff {
  const src = fs.readFileSync(file, 'utf8');
  const qname = path.basename(file).replace(/\.pyi?$/, '');
  const raw = execFileSync(PINNED, [ORACLE, '--file', file, '--module-qname', qname],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const oracle = JSON.parse(raw);
  const st = oracle.structure ?? {};

  const facts = new PythonFactExtractor().extract({
    sourceCode: src, filePath: file, baseMservPath: '/repo',
    moduleQualifiedName: qname, serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });

  const problems: string[] = [];

  // ---- classes: keyed on (name, line)
  const expClasses = new Map<string, any>();
  for (const c of st.classes ?? []) expClasses.set(`${c.name}|${c.line}`, c);
  const actClasses = new Map<string, string[]>();
  for (const t of facts.types) {
    const r = t.toCsv().split('\t');
    actClasses.set(`${r[0]}|${r[9]}`, r);
  }
  for (const [k, exp] of expClasses) {
    const act = actClasses.get(k);
    if (!act) { problems.push(`CLASS_MISSING ${k}`); continue; }
    if (String(exp.endLine) !== act[10]) problems.push(`CLASS_FIELD ${k} endLine: oracle=${exp.endLine} mine=${act[10]}`);
    const expPositional = (exp.bases ?? []).filter((b: any) => b.position !== null).length;
    if (String(expPositional) !== act[19]) problems.push(`CLASS_FIELD ${k} baseCount: oracle=${expPositional} mine=${act[19]}`);
  }
  for (const k of actClasses.keys()) if (!expClasses.has(k)) problems.push(`CLASS_SPURIOUS ${k}`);

  // ---- functions: keyed on (name, line). Lambdas/synthetics are not in the ast dump.
  const expFns = new Map<string, any>();
  for (const f of st.functions ?? []) expFns.set(`${f.name}|${f.line}`, f);
  const actFns = new Map<string, string[]>();
  for (const m of facts.methods) {
    const r = m.toCsv().split('\t');
    if (r[11]?.includes('SYNTHETIC')) continue;
    actFns.set(`${r[0]}|${r[5]}`, r);
  }
  const namesWithNestedDefs = new Set<string>(
    (st.functions ?? []).map((f: any) => f.enclosingFunction).filter((n: string) => n)
  );
  for (const [k, exp] of expFns) {
    const act = actFns.get(k);
    if (!act) { problems.push(`FN_MISSING ${k}`); continue; }
    const hasNestedDef = namesWithNestedDefs.has(exp.name);
    const checks: [string, unknown, unknown][] = [
      ['endLine', exp.endLine, act[6]],
      ['isAsync', exp.isAsync, act[28]],
      // isGenerator is compared only when this function has NO nested def.
      // The oracle's _has_yield walks the whole subtree including nested
      // functions, so it reports true for a function that merely RETURNS a
      // generator. CPython's own inspect.isgeneratorfunction agrees with us,
      // not with it. See the ADJUDICATED note in requests-impl.jsonl.
      ...(hasNestedDef ? [] : [['isGenerator', exp.isGenerator, act[29]] as [string, unknown, unknown]]),
      ['posOnlyCount', exp.posOnlyCount, act[24]],
      ['kwOnlyCount', exp.kwOnlyCount, act[25]],
      ['hasKwArgs', exp.hasKwArgs, act[26]],
      ['isVarArgs', exp.hasVarArgs, act[13]],
      ['returnAnnotation', exp.returnAnnotation, act[12]],
      ['ownerClass', exp.ownerClass, act[8]],
      ['decoratorCount', (exp.decorators ?? []).length, act[30]],
    ];
    for (const [f, e, a] of checks) {
      if (String(e) !== String(a)) problems.push(`FN_FIELD ${k} ${f}: oracle=${JSON.stringify(e)} mine=${JSON.stringify(a)}`);
    }
    // Parameters are compared as a SET of name:kind pairs, not as a sequence.
    // The oracle's ast dump groups them (posonly, args, kwonly, vararg, kwarg)
    // while we emit canonical signature order, which is what inspect.signature
    // itself reports and what positional argument flow requires. See the
    // ADJUDICATED note in requests-impl.jsonl.
    const expNames = [...(exp.params ?? []).map((p: any) => p.name)].sort().join(',');
    const actParams = facts.methodParameters
      .filter(p => p.getPyMethodLinkHash() === act[35] && p.getParamName() !== '')
      .sort((x, y) => x.getPosition() - y.getPosition())
      .map(p => p.getParamName()).sort();
    if (expNames !== actParams.join(',')) problems.push(`FN_PARAMS ${k}: oracle=[${expNames}] mine=[${actParams.join(',')}]`);
    // parameter kinds
    const expKinds = [...(exp.params ?? []).map((p: any) => `${p.name}:${p.paramKind}`)].sort().join(',');
    const actKinds = facts.methodParameters
      .filter(p => p.getPyMethodLinkHash() === act[35] && p.getParamName() !== '')
      .sort((x, y) => x.getPosition() - y.getPosition())
      .map(p => `${p.getParamName()}:${p.getParamKind()}`).sort().join(',');
    if (expKinds !== actKinds) problems.push(`FN_PARAM_KINDS ${k}: oracle=[${expKinds}] mine=[${actKinds}]`);
  }
  for (const k of actFns.keys()) {
    if (expFns.has(k)) {
      continue;
    }
    // The oracle's ast dump enumerates `def`s only — it reports ZERO lambdas,
    // verified directly (`ast.py` has 19 by `ast.walk`, the dump lists none). So
    // every lambda `py_method` row looked spurious here, which was a defect in
    // THIS comparison rather than in the parser: schema §2.7 lists `lambda`
    // alongside `def`, and CPython agrees the lambdas exist.
    //
    // Lambda coverage is not lost by skipping them, because Gate 1 already
    // checks it EXACTLY: symtable emits a block per lambda, and those blocks are
    // compared name-for-name. This check is about `def` shape.
    if (k.startsWith('<lambda>|')) {
      continue;
    }
    problems.push(`FN_SPURIOUS ${k}`);
  }

  // ---- imports: keyed on (bound name, line)
  const expImports = new Map<string, any>();
  for (const im of st.imports ?? []) expImports.set(`${im.bound}|${im.line}`, im);
  const actImports = new Map<string, string[]>();
  for (const im of facts.imports) {
    const r = im.toCsv().split('\t');
    actImports.set(`${r[3]}|${r[5]}`, r);
  }
  for (const [k, exp] of expImports) {
    const act = actImports.get(k);
    if (!act) { problems.push(`IMPORT_MISSING ${k}`); continue; }
    if (String(exp.relativeLevel) !== act[9]) problems.push(`IMPORT_FIELD ${k} relativeLevel: oracle=${exp.relativeLevel} mine=${act[9]}`);
  }
  for (const k of actImports.keys()) if (!expImports.has(k)) problems.push(`IMPORT_SPURIOUS ${k}`);

  if (verbose) problems.forEach(p => console.log('   ' + p));
  return { file, problems, counts: {
    classes: facts.types.length, methods: facts.methods.length,
    params: facts.methodParameters.length, imports: facts.imports.length,
    bases: facts.typeBases.length } };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  let total = 0;
  for (const f of args.filter(a => !a.startsWith('--'))) {
    const r = diffDecl(f, verbose);
    total += r.problems.length;
    console.log(`${(r.problems.length === 0 ? 'CLEAN' : r.problems.length + ' PROB').padEnd(10)} ${path.basename(f).padEnd(46)} types ${r.counts.classes} methods ${r.counts.methods} params ${r.counts.params} imports ${r.counts.imports}`);
  }
  console.log(total === 0 ? '\nALL CLEAN' : `\n${total} total problems`);
  process.exit(total === 0 ? 0 : 1);
}
