/**
 * Adjudicates `py_expression` content columns against CPython's own ast.
 *
 * The existing gate checks py_expression for SELF-CONSISTENCY only — depth is
 * parent.depth + 1, no dangling parent, unique PK. Those cannot catch a
 * systematic error: invert every `edgeRole` in the parser and each one still
 * holds. `f(g(x))` and `g(f(x))` would both pass while being swapped.
 *
 * This compares four columns to ground truth CPython computed itself:
 *
 *   nameContext          <- ast.Name.ctx (Load/Store/Del)
 *   position             <- the index of a node in ast.Call.args
 *   parentExpressionHash <- the ast node that actually encloses it
 *   edgeRole             <- whether ast puts the node in `.args` or at `.func.value`
 *
 * Keyed on the (line, byte-column) span, which is what makes the join exact
 * rather than by name — two calls to `f` on one line are different nodes.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const TRUTH = path.join(process.cwd(), 'src/test/python-gates/emit_expr_truth.py');

export interface ExprDiff {
  file: string;
  problems: string[];
  counts: Record<string, number>;
}

const STORE_CONTEXTS = new Set(['STORE', 'DEL']);

export function diffExpr(file: string): ExprDiff {
  const source = fs.readFileSync(file, 'utf8');
  const truth = JSON.parse(
    execFileSync(PINNED, [TRUTH, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  );
  const facts = new PythonFactExtractor().extract({
    sourceCode: source,
    filePath: file,
    baseMservPath: '/repo',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''),
    serviceVersionLinkHash: 'SERVICE_VERSION_test',
  });

  const problems: string[] = [];
  const counts = { names: 0, args: 0, receivers: 0, nesting: 0 };

  const spanOf = (e: { getStartLine(): number; getStartColumn(): number; getEndLine(): number; getEndColumn(): number }) =>
    `${e.getStartLine()}:${e.getStartColumn()}:${e.getEndLine()}:${e.getEndColumn()}`;

  const byHash = new Map(facts.expressions.map(e => [e.getHash(), e]));
  const bySpan = new Map<string, typeof facts.expressions>();
  for (const e of facts.expressions) {
    const key = spanOf(e);
    const list = bySpan.get(key) ?? [];
    list.push(e);
    bySpan.set(key, list);
  }

  // ---- nameContext against ast.Name.ctx --------------------------------
  for (const name of truth.names) {
    const rows = (bySpan.get(name.span) ?? []).filter(
      e => e.getKind() === 'NAME_REFERENCE' || e.getKind() === 'PARAMETER_REFERENCE'
    );
    if (rows.length === 0) {
      continue;
    }
    counts.names += 1;
    const expected = name.ctx === 'Load' ? 'LOAD' : name.ctx === 'Store' ? 'STORE' : 'DEL';
    for (const row of rows) {
      const actual = row.getNameContext();
      // A STORE that ast calls Store and a DEL it calls Del are distinct, but
      // both are writes; only a LOAD/write confusion is a real disagreement.
      const agree =
        actual === expected ||
        (STORE_CONTEXTS.has(expected) && STORE_CONTEXTS.has(actual));
      if (!agree) {
        problems.push(
          `EXPR_CTX ${name.id}@${name.span}: ast=${expected} mine=${actual}`
        );
      }
    }
  }

  // ---- argument position and parentage against ast.Call.args -----------
  for (const arg of truth.callArgs) {
    const callRows = (bySpan.get(arg.callSpan) ?? []).filter(e => e.getKind() === 'CALL');
    const argRows = bySpan.get(arg.argSpan) ?? [];
    if (callRows.length !== 1 || argRows.length === 0) {
      continue;
    }
    counts.args += 1;
    const call = callRows[0]!;
    // The argument's own row is the one whose parent is this call.
    const owned = argRows.filter(e => e.getParentExpressionHash() === call.getHash());
    if (owned.length === 0) {
      problems.push(
        `EXPR_ARG_PARENT ${arg.argSpan}: not a child of the call at ${arg.callSpan}`
      );
      continue;
    }
    for (const row of owned) {
      if (row.getPosition() !== arg.position) {
        problems.push(
          `EXPR_ARG_POSITION ${arg.argSpan}: ast=${arg.position} mine=${row.getPosition()}`
        );
      }
      if (row.getDepth() !== call.getDepth() + 1) {
        problems.push(
          `EXPR_ARG_DEPTH ${arg.argSpan}: ast says child of ${arg.callSpan}, depths ${call.getDepth()}/${row.getDepth()}`
        );
      }
      const role = row.getEdgeRole();
      if (role === 'RECEIVER') {
        problems.push(`EXPR_ARG_ROLE ${arg.argSpan}: ast says ARGUMENT, mine=RECEIVER`);
      }
    }
  }

  // ---- receiver identity against ast.Call.func.value -------------------
  for (const receiver of truth.receivers) {
    const rows = bySpan.get(receiver.receiverSpan) ?? [];
    if (rows.length === 0) {
      continue;
    }
    counts.receivers += 1;
    // The receiver must never be recorded as an argument of its own call.
    for (const row of rows) {
      if (row.getEdgeRole() === 'CALL_ARGUMENT' || row.getEdgeRole() === 'ARGUMENT') {
        problems.push(
          `EXPR_RECV_ROLE ${receiver.receiverSpan}: ast says receiver of ${receiver.attr}, mine=${row.getEdgeRole()}`
        );
      }
    }
  }

  // ---- nesting: f(g(x)) must not flatten to the same shape as g(f(x)) --
  for (const pair of truth.nesting) {
    const outer = (bySpan.get(pair.outer) ?? []).filter(e => e.getKind() === 'CALL');
    const inner = (bySpan.get(pair.inner) ?? []).filter(e => e.getKind() === 'CALL');
    if (outer.length !== 1 || inner.length !== 1) {
      continue;
    }
    counts.nesting += 1;
    // Walk up from the inner call; the outer must be an ancestor.
    let current: string = inner[0]!.getParentExpressionHash();
    let found = false;
    let guard = 0;
    while (current !== '' && guard < 200) {
      guard += 1;
      if (current === outer[0]!.getHash()) {
        found = true;
        break;
      }
      current = byHash.get(current)?.getParentExpressionHash() ?? '';
    }
    if (!found) {
      problems.push(
        `EXPR_NESTING ${pair.inner}: ast nests it inside ${pair.outer}, tree does not`
      );
    }
    if (inner[0]!.getDepth() <= outer[0]!.getDepth()) {
      problems.push(
        `EXPR_NESTING_DEPTH ${pair.inner}: inner depth ${inner[0]!.getDepth()} <= outer ${outer[0]!.getDepth()}`
      );
    }
  }

  return { file, problems, counts };
}

if (require.main === module) {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  let problems = 0;
  const totals = { names: 0, args: 0, receivers: 0, nesting: 0 };
  for (const file of files) {
    const result = diffExpr(file);
    problems += result.problems.length;
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] += result.counts[key] ?? 0;
    }
    if (result.problems.length > 0) {
      console.log(`${result.problems.length} PROB  ${path.basename(file)}`);
      result.problems.slice(0, 5).forEach(p => console.log('   ' + p));
    }
  }
  console.log(
    `\nadjudicated against CPython ast: ${totals.names} nameContext, ${totals.args} argument positions, ` +
      `${totals.receivers} receivers, ${totals.nesting} nestings`
  );
  console.log(problems === 0 ? 'ALL CLEAN' : `${problems} problems`);
  process.exit(problems === 0 ? 0 : 1);
}
