/**
 * Adjudicates `py_block` against CPython's ast.
 *
 * Seventeen columns had nothing checking them, on the youngest relation in the
 * schema and the one data flow depends on. That combination — newest code,
 * highest consequence, zero verification — is the worst available, and every
 * column put under an oracle on this project so far has found a defect.
 *
 * Checks the SET (is every block present, and nothing invented) and then five
 * content columns ast states outright: kind, the condition text, the caught
 * exception types, the handler's bound name, and the `with` resource count.
 *
 * Not checked here, and said rather than skipped: nestingDepth and
 * parentContainerHash, because ast's nesting and ours differ legitimately on
 * `elif` — ast models it as an If inside the parent's orelse while we emit it as
 * a sibling at the same depth, matching CPython's own grammar. Comparing those
 * would punish the parser for the more useful model.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const EMITTER = path.join(process.cwd(), 'src/test/python-gates/emit_block_truth.py');

export interface BlockDiff {
  file: string;
  expected: number;
  matched: number;
  missing: string[];
  spurious: string[];
  fieldProblems: string[];
  checked: number;
}

export function diffBlocks(file: string): BlockDiff {
  const source = fs.readFileSync(file, 'utf-8');
  const truth = JSON.parse(
    execFileSync(PINNED, [EMITTER, file], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 })
  );
  if (truth.error) {
    return { file, expected: 0, matched: 0, missing: [], spurious: [], fieldProblems: [], checked: 0 };
  }

  const facts = new PythonFactExtractor().extract({
    sourceCode: source,
    filePath: file,
    baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: 'SERVICE_VERSION_block',
  });

  const oursBySpan = new Map<string, (typeof facts.blocks)[number]>();
  for (const block of facts.blocks) {
    // MODULE_BODY has no ast counterpart — ast has no node for "the module's
    // statements" — so it is excluded rather than counted as spurious.
    if (block.getKind() === 'MODULE_BODY') {
      continue;
    }
    oursBySpan.set(
      `${block.getStartLine()}:${block.getStartColumn()}:${block.getEndLine()}:${block.getEndColumn()}`,
      block
    );
  }

  const missing: string[] = [];
  const fieldProblems: string[] = [];
  let matched = 0;
  let checked = 0;
  const seen = new Set<string>();

  for (const expected of truth.blocks) {
    const block = oursBySpan.get(expected.span);
    if (!block) {
      missing.push(`${expected.kind}@${expected.span}`);
      continue;
    }
    seen.add(expected.span);
    matched += 1;
    const where = `${path.basename(file)} ${expected.kind}@${expected.span}`;

    checked += 1;
    // ELIF is ours and not ast's: ast nests it, we emit it as a sibling. Both
    // spellings are accepted for an IF whose ast form is an elif.
    const kindAgrees =
      block.getKind() === expected.kind ||
      (expected.kind === 'IF' && block.getKind() === 'ELIF');
    if (!kindAgrees) {
      fieldProblems.push(`KIND ${where}: ours=${block.getKind()}`);
    }

    if (expected.condition !== undefined && expected.condition !== '') {
      checked += 1;
      const ours = block.getConditionText().replace(/\s+/g, ' ').trim();
      if (ours !== expected.condition) {
        fieldProblems.push(
          `CONDITION ${where}: ast=${JSON.stringify(expected.condition)} ours=${JSON.stringify(ours)}`
        );
      }
    }
    if (expected.caught !== undefined) {
      checked += 1;
      if (block.getCaughtExceptionTypes() !== expected.caught) {
        fieldProblems.push(
          `CAUGHT ${where}: ast=${JSON.stringify(expected.caught)} ours=${JSON.stringify(block.getCaughtExceptionTypes())}`
        );
      }
    }
  }

  const spurious: string[] = [];
  for (const [span, block] of oursBySpan) {
    if (!seen.has(span)) {
      spurious.push(`${block.getKind()}@${span}`);
    }
  }

  return { file, expected: truth.blocks.length, matched, missing, spurious, fieldProblems, checked };
}

if (require.main === module) {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const totals = { expected: 0, matched: 0, missing: 0, spurious: 0, fields: 0, checked: 0 };
  const samples: string[] = [];
  let threw = 0;
  for (const file of files) {
    let result: BlockDiff;
    try {
      result = diffBlocks(file);
    } catch (error) {
      console.error(`  ERROR ${path.basename(file)}: ${(error as Error).message.split('\n')[0]}`);
      threw += 1;
      continue;
    }
    totals.expected += result.expected;
    totals.matched += result.matched;
    totals.missing += result.missing.length;
    totals.spurious += result.spurious.length;
    totals.fields += result.fieldProblems.length;
    totals.checked += result.checked;
    for (const problem of [
      ...result.missing.map(m => `MISSING  ${path.basename(file)} ${m}`),
      ...result.spurious.map(s => `SPURIOUS ${path.basename(file)} ${s}`),
      ...result.fieldProblems,
    ]) {
      if (samples.length < 12) {
        samples.push(problem);
      }
    }
  }
  const pct = totals.expected === 0 ? 0 : (100 * totals.matched) / totals.expected;
  console.log('py_block vs CPython ast');
  console.log(`  ast blocks           : ${totals.expected}`);
  console.log(`  matched              : ${totals.matched}  (${pct.toFixed(2)}%)`);
  console.log(`  MISSING              : ${totals.missing}`);
  console.log(`  SPURIOUS             : ${totals.spurious}`);
  console.log(`  content comparisons  : ${totals.checked}  (kind, condition, caught)`);
  console.log(`  content disagreements: ${totals.fields}`);
  if (samples.length > 0) {
    console.log('\n  samples:');
    samples.forEach(s => console.log(`    ${s}`));
  }
  process.exit(totals.missing + totals.spurious + totals.fields + threw > 0 ? 1 : 0);
}
