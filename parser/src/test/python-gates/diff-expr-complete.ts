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
  /** Content columns compared where both sides describe the same node. */
  checked: number;
  fieldProblems: string[];
  /** String/bytes constants whose literalValue is source text, not a value. */
  excludedTextConstants: number;
}

/**
 * ast class -> the `kind` values our schema may legitimately use for it.
 *
 * A SET rather than one value, because the schema is deliberately FINER than ast
 * in places: `self` and an ordinary variable are both `ast.Name`, and the schema
 * splits them because a receiver is the single most important thing to identify
 * at a call site. Demanding equality would punish the parser for carrying more
 * information than the oracle, so this asserts only that the kind is one ast
 * could support.
 */
const KIND_FOR_AST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['Name', new Set(['NAME_REFERENCE', 'SELF_REFERENCE', 'CLS_REFERENCE', 'PARAMETER_REFERENCE', 'TYPE_REFERENCE', 'BUILTIN_REFERENCE'])],
  ['Attribute', new Set(['ATTRIBUTE_ACCESS'])],
  ['Call', new Set(['CALL'])],
  ['Subscript', new Set(['SUBSCRIPT'])],
  ['List', new Set(['LIST'])],
  ['Tuple', new Set(['TUPLE'])],
  ['Set', new Set(['SET'])],
  ['Dict', new Set(['DICT'])],
  ['Lambda', new Set(['LAMBDA'])],
  ['ListComp', new Set(['LIST_COMPREHENSION', 'COMPREHENSION'])],
  ['SetComp', new Set(['SET_COMPREHENSION', 'COMPREHENSION'])],
  ['DictComp', new Set(['DICT_COMPREHENSION', 'DICTIONARY_COMPREHENSION', 'COMPREHENSION'])],
  ['GeneratorExp', new Set(['GENERATOR_EXPRESSION', 'COMPREHENSION'])],
  ['Await', new Set(['AWAIT'])],
  ['Yield', new Set(['YIELD'])],
  ['YieldFrom', new Set(['YIELD_FROM', 'YIELD'])],
  ['Compare', new Set(['COMPARISON', 'BINARY_OPERATION'])],
  ['BoolOp', new Set(['BOOLEAN_OPERATION', 'BINARY_OPERATION'])],
  ['UnaryOp', new Set(['UNARY_OPERATION'])],
  ['IfExp', new Set(['CONDITIONAL_EXPRESSION', 'TERNARY'])],
  ['NamedExpr', new Set(['WALRUS', 'ASSIGNMENT_EXPRESSION'])],
]);

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

  const expected = new Map<string, (typeof truth.nodes)[number]>();
  for (const node of truth.nodes) {
    if (NOT_EMITTED.has(node.type)) {
      continue;
    }
    expected.set(node.span, node);
  }

  const rowBySpan = new Map<string, (typeof facts.expressions)[number]>();
  for (const expression of facts.expressions) {
    const span = `${expression.getStartLine()}:${expression.getStartColumn()}:${expression.getEndLine()}:${expression.getEndColumn()}`;
    if (!rowBySpan.has(span)) {
      rowBySpan.set(span, expression);
    }
  }

  const missing: string[] = [];
  const duplicate: string[] = [];
  const fieldProblems: string[] = [];
  let matched = 0;
  let checked = 0;
  let excludedTextConstants = 0;
  for (const [span, node] of expected) {
    const count = oursBySpan.get(span) ?? 0;
    if (count === 0) {
      missing.push(`${node.type}@${span}`);
      continue;
    }
    matched += 1;
    if (count > 1) {
      duplicate.push(`${node.type}@${span} x${count}`);
    }
    const row = rowBySpan.get(span);
    if (!row) {
      continue;
    }
    const where = `${path.basename(file)} ${node.type}@${span}`;

    const allowed = KIND_FOR_AST.get(node.type);
    if (allowed) {
      checked += 1;
      if (!allowed.has(row.getKind())) {
        fieldProblems.push(`KIND ${where}: ours=${row.getKind()}`);
      }
    }
    // literalValue is the shared NAME SLOT — a callee name, an attribute name,
    // an identifier. Only checked where ast states one.
    //
    // A STRING or BYTES Constant is deliberately NOT compared, and the exclusion
    // is declared rather than quietly dropped so it cannot be counted as
    // adjudicated. The two sides mean different things there: ast reports the
    // INTERPRETED value, with escapes resolved and bytes repr'd, while we keep
    // the SOURCE TEXT. Source text is the better fact — `0x0010` is recoverable
    // to 16 and 16 is not recoverable to `0x0010`, and a rule about permission
    // masks wants the spelling — so an exact comparison would blame the parser
    // for a deliberate choice. Numbers are still compared, by value.
    const isTextConstant =
      node.type === 'Constant' && !Number.isFinite(Number(node.name));
    if (isTextConstant) {
      excludedTextConstants += 1;
    }
    if (node.name !== '' && !isTextConstant) {
      checked += 1;
      // Both sides normalised: see the emitter — a TSV cell cannot carry a raw
      // newline, so the parser collapses whitespace and the oracle must too.
      const oursName = row.getLiteralValue().replace(/\s+/g, ' ').trim();
      // A NUMERIC literal is compared BY VALUE. ast reports the evaluated number
      // (`16`) while we keep the source text (`0x0010`), and the source text is
      // the better fact for a fact table — `0x0010` is recoverable to 16, but 16
      // is not recoverable to `0x0010`, and a rule about permission bit-masks
      // wants the spelling. So this is a representation difference, not a
      // disagreement, and treating it as one blamed the parser 325 times on 40
      // stdlib files for a deliberate choice.
      const sameNumber =
        oursName !== '' &&
        node.name !== '' &&
        Number.isFinite(Number(oursName)) &&
        Number.isFinite(Number(node.name)) &&
        Number(oursName) === Number(node.name);
      if (oursName !== node.name && !sameNumber) {
        fieldProblems.push(
          `NAME ${where}: ast=${JSON.stringify(node.name)} ours=${JSON.stringify(oursName)}`
        );
      }
    }
    checked += 1;
    if (row.getIsWrite() !== node.isWrite) {
      fieldProblems.push(`IS_WRITE ${where}: ast=${node.isWrite} ours=${row.getIsWrite()}`);
    }
    checked += 1;
    if (row.getIsAwaited() !== node.isAwaited) {
      fieldProblems.push(`IS_AWAITED ${where}: ast=${node.isAwaited} ours=${row.getIsAwaited()}`);
    }
    checked += 1;
    if (row.getIsStarred() !== node.isStarred) {
      fieldProblems.push(`IS_STARRED ${where}: ast=${node.isStarred} ours=${row.getIsStarred()}`);
    }
  }

  const spurious: string[] = [];
  for (const span of oursBySpan.keys()) {
    if (!expected.has(span)) {
      spurious.push(span);
    }
  }

  return {
    file,
    astNodes: expected.size,
    matched,
    missing,
    spurious,
    duplicate,
    checked,
    fieldProblems,
    excludedTextConstants,
  };
}

if (require.main === module) {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const totals = { nodes: 0, matched: 0, missing: 0, spurious: 0, duplicate: 0, checked: 0, fields: 0, excluded: 0 };
  const samples: string[] = [];
  let threw = 0;
  for (const file of files) {
    let result: CompletenessResult;
    try {
      result = diffExprComplete(file);
    } catch (error) {
      // Never swallow: a throw here is a gate defect, and skipping quietly made
      // the whole run report zero nodes as though it had passed.
      console.error(`  ERROR ${path.basename(file)}: ${(error as Error).message.split('\n')[0]}`);
      threw += 1;
      continue;
    }
    totals.nodes += result.astNodes;
    totals.matched += result.matched;
    totals.missing += result.missing.length;
    totals.spurious += result.spurious.length;
    totals.duplicate += result.duplicate.length;
    totals.checked += result.checked;
    totals.fields += result.fieldProblems.length;
    totals.excluded += result.excludedTextConstants;
    for (const problem of [
      ...result.missing.map(m => `MISSING  ${path.basename(file)} ${m}`),
      ...result.duplicate.map(d => `DUP      ${path.basename(file)} ${d}`),
      ...result.fieldProblems,
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
  const fieldPct = totals.checked === 0 ? 0 : (100 * (totals.checked - totals.fields)) / totals.checked;
  console.log(`  content comparisons  : ${totals.checked}  (kind, literalValue, isWrite, isAwaited, isStarred)`);
  console.log(`  content disagreements: ${totals.fields}  (${fieldPct.toFixed(2)}% agree)`);
  console.log(`  NOT compared         : ${totals.excluded} string/bytes literalValue (source text vs interpreted value)`);
  if (samples.length > 0) {
    console.log('\n  samples:');
    samples.forEach(s => console.log(`    ${s}`));
  }
  if (threw > 0) {
    console.log(`  gate errors          : ${threw}`);
  }
  process.exit(totals.missing + totals.duplicate + totals.fields + threw > 0 ? 1 : 0);
}
