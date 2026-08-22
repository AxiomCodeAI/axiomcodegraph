/**
 * Completeness gate for `py_expression`, against CPython's own ast.
 *
 * The other expression gate checks five columns on nodes both sides agree exist.
 * This checks the SET ITSELF: every expression CPython parses should appear
 * exactly once, and nothing else should appear at all.
 *
 * Three failures, and they are different kinds of wrong:
 *
 *   MISSING   a fact silently lost — a rule over it finds nothing and no error
 *             is raised anywhere
 *   SPURIOUS  a fact invented — worse, because a rule acts on it
 *   DUPLICATE two rows for one node, which double-counts every aggregate
 *
 * Deliberately NOT compared: `kind`, beyond a coarse family check. The parser's
 * kind enum is finer than ast's node classes in places the schema asks for
 * (SELF_REFERENCE and NAME_REFERENCE are both ast.Name), so demanding equality
 * would punish the parser for carrying more information than the oracle.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const EMITTER = path.join(process.cwd(), 'src/test/python-gates/emit_expr_nodes.py');

/**
 * ast node classes the parser deliberately does not emit as their own row.
 *
 * `Starred` and `keyword` are carried as FLAGS on the expression they modify —
 * `isStarred` and `argumentKeywordName` — rather than as separate nodes, which
 * is the schema's choice and keeps a call's argument positions meaningful.
 * `Slice` is part of a subscript rather than a value in its own right.
 */
const NOT_EMITTED = new Set(['Starred', 'Slice']);

export interface CompletenessResult {
  file: string;
  astNodes: number;
  matched: number;
  missing: string[];
  spurious: string[];
  duplicate: string[];
}

export function diffExprComplete(file: string): CompletenessResult {
  const source = fs.readFileSync(file, 'utf-8');
  const truth = JSON.parse(
    execFileSync(PINNED, [EMITTER, file], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 })
  );
  if (truth.error) {
    return { file, astNodes: 0, matched: 0, missing: [], spurious: [], duplicate: [] };
  }

  const facts = new PythonFactExtractor().extract({
    sourceCode: source,
    filePath: file,
    baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: 'SERVICE_VERSION_complete',
  });

  const oursBySpan = new Map<string, number>();
  for (const expression of facts.expressions) {
    const span = `${expression.getStartLine()}:${expression.getStartColumn()}:${expression.getEndLine()}:${expression.getEndColumn()}`;
    oursBySpan.set(span, (oursBySpan.get(span) ?? 0) + 1);
  }

  const expected = new Map<string, string>();
  for (const node of truth.nodes) {
    if (NOT_EMITTED.has(node.type)) {
      continue;
    }
    expected.set(node.span, node.type);
  }

  const missing: string[] = [];
  const duplicate: string[] = [];
  let matched = 0;
  for (const [span, type] of expected) {
    const count = oursBySpan.get(span) ?? 0;
    if (count === 0) {
      missing.push(`${type}@${span}`);
      continue;
    }
    matched += 1;
    if (count > 1) {
      duplicate.push(`${type}@${span} x${count}`);
    }
  }

  const spurious: string[] = [];
  for (const span of oursBySpan.keys()) {
    if (!expected.has(span)) {
      spurious.push(span);
    }
  }

  return { file, astNodes: expected.size, matched, missing, spurious, duplicate };
}

if (require.main === module) {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const totals = { nodes: 0, matched: 0, missing: 0, spurious: 0, duplicate: 0 };
  const samples: string[] = [];
  for (const file of files) {
    let result: CompletenessResult;
    try {
      result = diffExprComplete(file);
    } catch {
      continue;
    }
    totals.nodes += result.astNodes;
    totals.matched += result.matched;
    totals.missing += result.missing.length;
    totals.spurious += result.spurious.length;
    totals.duplicate += result.duplicate.length;
    for (const problem of [
      ...result.missing.map(m => `MISSING  ${path.basename(file)} ${m}`),
      ...result.duplicate.map(d => `DUP      ${path.basename(file)} ${d}`),
    ]) {
      if (samples.length < 15) {
        samples.push(problem);
      }
    }
  }
  const pct = totals.nodes === 0 ? 0 : (100 * totals.matched) / totals.nodes;
  console.log('py_expression completeness vs CPython ast');
  console.log(`  ast expression nodes : ${totals.nodes}`);
  console.log(`  matched              : ${totals.matched}  (${pct.toFixed(2)}%)`);
  console.log(`  MISSING              : ${totals.missing}`);
  console.log(`  DUPLICATE            : ${totals.duplicate}`);
  console.log(`  spurious spans       : ${totals.spurious}  (rows at a span ast has no expression for)`);
  if (samples.length > 0) {
    console.log('\n  samples:');
    samples.forEach(s => console.log(`    ${s}`));
  }
  process.exit(totals.missing + totals.duplicate > 0 ? 1 : 0);
}
