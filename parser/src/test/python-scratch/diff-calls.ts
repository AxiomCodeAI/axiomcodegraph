/**
 * Gate 2: py_call_site + py_expression vs the oracle's ast cross-check.
 * Keys on (callee, line, col) — the oracle emits full spans for calls.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const ORACLE = path.join(process.cwd(), 'src/test/python-oracle/oracle/emit_oracle.py');

export interface CallDiff { file: string; problems: string[]; counts: Record<string, number>; }

export function diffCalls(file: string, verbose = false): CallDiff {
  const src = fs.readFileSync(file, 'utf8');
  const qname = path.basename(file).replace(/\.pyi?$/, '');
  const oracle = JSON.parse(execFileSync(PINNED,
    [ORACLE, '--file', file, '--module-qname', qname],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const facts = new PythonFactExtractor().extract({
    sourceCode: src, filePath: file, baseMservPath: '/repo',
    moduleQualifiedName: qname, serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });

  const problems: string[] = [];
  const expCalls = new Map<string, any>();
  for (const c of oracle.structure?.calls ?? []) expCalls.set(`${c.callee}|${c.line}|${c.col}`, c);

  const actCalls = new Map<string, string[]>();
  for (const c of facts.callSites) {
    const r = c.toCsv().split('\t');
    actCalls.set(`${r[1]}|${r[21]}|${r[22]}`, r);
  }

  let matched = 0;
  for (const [k, exp] of expCalls) {
    const act = actCalls.get(k);
    if (!act) { problems.push(`CALL_MISSING ${k}`); continue; }
    matched++;
    const checks: [string, unknown, unknown][] = [
      // receiverKind: the oracle collapses a literal receiver to UNKNOWN, but
      // LITERAL is an explicit schema value (§2.16 c4) and is strictly more
      // informative. receiverText: the oracle runs ast.unparse, which rewrites
      // every string literal to single quotes; we keep the source text. Both are
      // ADJUDICATED in the parser's favour — see requests-impl.jsonl — so
      // neither is compared here.
      // Two ADJUDICATED receiverKind differences, both in the parser's favour:
      //  - a literal receiver: oracle says UNKNOWN, LITERAL is an explicit
      //    schema value (§2.16 c4) and strictly more informative
      //  - a @classmethod's `cls`: the oracle tests "matches first param" BEFORE
      //    checking the decorator, so it reports SELF for a classmethod. The
      //    receiver of a classmethod IS the class, and conflating the two breaks
      //    the receiver-typing distinction the enum exists to draw.
      ...((exp.receiverKind === 'UNKNOWN' && act[4] === 'LITERAL') ||
      (exp.receiverKind === 'SELF' && act[4] === 'CLS')
        ? []
        : [['receiverKind', exp.receiverKind, act[4]] as [string, unknown, unknown]]),
      ['positionalArgs', exp.positionalArgs, act[11]],
      ['keywordArgs', exp.keywordArgs, act[12]],
      ['hasStarArgs', exp.hasStarArgs, act[13]],
      ['hasDoubleStarArgs', exp.hasDoubleStarArgs, act[14]],
      // Schema §2.16 c15 specifies keywordNames in SOURCE order; the oracle
      // emits it sorted. Compared as a set. ADJUDICATED — see requests-impl.
      ['keywordNames', [...(exp.keywordNames ?? [])].sort().join(','),
        (act[15] ?? '').split(',').filter(Boolean).sort().join(',')],
      ['endLine', exp.endLine, act[23]],
    ];
    for (const [f, e, a] of checks) {
      if (String(e) !== String(a)) problems.push(`CALL_FIELD ${k} ${f}: oracle=${JSON.stringify(e)} mine=${JSON.stringify(a)}`);
    }
  }
  for (const k of actCalls.keys()) if (!expCalls.has(k)) problems.push(`CALL_SPURIOUS ${k}`);

  // Structural invariants on expressions (Appendix B 7 and 8).
  const byHash = new Map(facts.expressions.map(e => [e.getHash(), e]));
  for (const e of facts.expressions) {
    const parent = e.getParentExpressionHash();
    if (parent && !byHash.has(parent)) problems.push(`EXPR_DANGLING_PARENT ${e.getEntryCombined()}`);
    if (parent) {
      const p = byHash.get(parent)!;
      if (e.getDepth() !== p.getDepth() + 1) problems.push(`EXPR_DEPTH ${e.getEntryCombined()} parentDepth=${p.getDepth()}`);
    } else if (e.getDepth() !== 0) problems.push(`EXPR_ROOT_DEPTH ${e.getEntryCombined()}`);
    if (!e.getPyScopeLinkHash()) problems.push(`EXPR_NO_SCOPE ${e.getEntryCombined()}`);
  }
  // PK uniqueness (Appendix B 2)
  const seen = new Set<string>();
  for (const e of facts.expressions) {
    if (seen.has(e.getHash())) problems.push(`EXPR_PK_COLLISION ${e.getEntryCombined()}`);
    seen.add(e.getHash());
  }
  // Ownership totality (Appendix B 7): every call site reaches a method
  for (const c of facts.callSites) {
    if (!c.getPyMethodLinkHash()) problems.push(`CALL_NO_METHOD ${c.getEntryCombined()}`);
  }

  if (verbose) problems.forEach(p => console.log('   ' + p));
  return { file, problems, counts: { calls: facts.callSites.length, matched,
    expected: expCalls.size, expressions: facts.expressions.length } };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  let total = 0;
  for (const f of args.filter(a => !a.startsWith('--'))) {
    const r = diffCalls(f, verbose);
    total += r.problems.length;
    console.log(`${(r.problems.length === 0 ? 'CLEAN' : r.problems.length + ' PROB').padEnd(10)} ${path.basename(f).padEnd(46)} calls ${r.counts.matched}/${r.counts.expected} exprs ${r.counts.expressions}`);
  }
  console.log(total === 0 ? '\nALL CLEAN' : `\n${total} total problems`);
  process.exit(total === 0 ? 0 : 1);
}
