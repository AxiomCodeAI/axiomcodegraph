/**
 * `type(obj).attr = value` is an assignment through a CALL, and the IR says so.
 *
 * tree-sitter reads the leading `type` as PEP 695's soft keyword and accepts `(obj).attr` as
 * an alias name, so the statement parses cleanly as a `type_alias_statement` and THE CALL
 * NODE NEVER EXISTS — `(obj)` survives as a `parenthesized_expression` hanging off an
 * `attribute`. The tree therefore said `obj.attr = value`: a write to an INSTANCE attribute
 * where the source writes a CLASS attribute, with `obj` standing where the call's argument
 * belongs. `unittest.mock`'s documented way to attach a `PropertyMock` is exactly this
 * spelling, so it is idiomatic in test code rather than exotic.
 *
 * The recovery rebuilds the call from the keyword token, since there is no identifier node
 * for `type` anywhere in the tree. Three things are pinned here, and the second and third
 * are the ones that make it safe rather than merely present:
 *
 *   - the CALL exists, is named, and carries the parenthesised operand as its ARGUMENT;
 *   - `type[o].x = 1` reaches the same misparse branch and is a SUBSCRIPT, not a call.
 *     Synthesising one there would invent a call site that no source text supports;
 *   - the spans cover `type(obj).attr`, not the `(obj).attr` the grammar left. Anything
 *     joining the IR to source by position — the tier-1 conservation comparison among them —
 *     misses by four characters otherwise, which is how a recovered site would still read as
 *     a gap.
 *
 * The `py_parse_gap` row stays. The grammar still misparses the statement, so the row is the
 * provenance of the compensation rather than a claim that data was lost.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `def helper(b):
    return b


def compute(v):
    return v


def probe(b, o, v):
    type(b).plain = 1
    type(b).annotated: int = 2
    type[o].subscripted = 3
    type(b).nested = compute(v)
    type (b).spaced = 4
    vars(b)['k'] = 5
    helper(b).ordinary = 6
    b.type(b).method = 7
    type(b).augmented += 8
    del type(b).deleted
    plain_value = type(b)
    return plain_value
`;

/** line -> the callee names that line must produce, sorted. */
const EXPECTED_CALLS: ReadonlyArray<readonly [number, readonly string[], string]> = [
  [10, ['type'], 'the reported shape: a call the grammar swallowed'],
  [11, ['type'], 'the annotated form, which adds a constrained_type in the middle'],
  [12, [], 'a SUBSCRIPT, not a call — nothing may be synthesised here'],
  [13, ['compute', 'type'], 'a real call in the value, beside the recovered one'],
  [14, ['type'], 'a space between the keyword and the parenthesis'],
  // ── controls: these always parsed correctly and must be untouched ──
  [15, ['vars'], 'control: a different builtin, never the soft keyword'],
  [16, ['helper'], 'control: the identical shape with a user function'],
  [17, ['type'], 'control: `b.type(...)` is a method call, not the keyword'],
  [18, ['type'], 'control: augmented assignment does not match `type NAME = value`'],
  [19, ['type'], 'control: `del`'],
  [20, ['type'], 'control: the same call as a value'],
];

export async function softKeywordTypeCall(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-typecall-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'typecall.py'), SOURCE);

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const tsv = (file: string): Record<string, string>[] => {
    const lines = fs.readFileSync(path.join(outputDir, file), 'utf-8').split('\n').filter(Boolean);
    const header = lines[0]!.split('\t');
    return lines.slice(1).map((l) => {
      const cells = l.split('\t');
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
  };

  const sites = tsv('all-python-call-sites.csv');
  for (const [line, want, why] of EXPECTED_CALLS) {
    const got = sites
      .filter((c) => Number(c.startLine) === line)
      .map((c) => c.calleeName ?? '')
      .sort();
    if (JSON.stringify(got) !== JSON.stringify(want.slice().sort())) {
      problems.push(`L${line} (${why}): expected [${want.join(', ')}], got [${got.join(', ')}]`);
    }
  }

  // A recovered call is an ordinary named call. DYNAMIC_CALL would say the opposite, and an
  // empty name would leave the site unresolvable at exactly the place the work was done.
  const recovered = sites.filter((c) => Number(c.startLine) === 10);
  for (const c of recovered) {
    if (c.callKind !== 'SIMPLE_CALL') {
      problems.push(`L10 callKind is ${c.callKind}, expected SIMPLE_CALL`);
    }
  }

  const expressions = tsv('all-python-expressions.csv');
  const at = (line: number) => expressions.filter((e) => Number(e.startLine) === line);

  // The tree: the attribute's object must be the CALL, with the operand below it as an
  // ARGUMENT. Before the recovery the object was the argument itself, so the tree read
  // `b.plain = 1` — an instance write where the source writes a class attribute.
  const callRow = at(10).find((e) => e.kind === 'CALL');
  if (!callRow) {
    problems.push('L10: no CALL row — the swallowed call was not rebuilt');
  } else {
    if ((callRow.literalValue ?? '') !== 'type') {
      problems.push(`L10 CALL is named "${callRow.literalValue ?? ''}", expected "type"`);
    }
    if (callRow.edgeRole !== 'ATTRIBUTE_OBJECT') {
      problems.push(`L10 CALL has edgeRole ${callRow.edgeRole}, expected ATTRIBUTE_OBJECT`);
    }
    const argument = at(10).find((e) => e.edgeRole === 'ARGUMENT' && e.literalValue === 'b');
    if (!argument) {
      problems.push('L10: `b` is not an ARGUMENT of the recovered call');
    }
  }

  // Spans, which is what a position join sees. `    type(b).plain = 1` puts the keyword at
  // column 4; the grammar's own nodes start at the `(` on column 8.
  const attribute = at(10).find((e) => e.kind === 'ATTRIBUTE_ACCESS');
  if (attribute && Number(attribute.startColumn) !== 4) {
    problems.push(
      `L10 ATTRIBUTE_ACCESS starts at column ${attribute.startColumn}, expected 4 — the span ` +
      'must cover `type(b).plain`, not the `(b).plain` the grammar left behind'
    );
  }
  if (callRow && Number(callRow.startColumn) !== 4) {
    problems.push(`L10 CALL starts at column ${callRow.startColumn}, expected 4`);
  }

  // The subscript form must keep the object it has. This is the guard that stops the
  // recovery from inventing a call out of `type[o].x`.
  const subscriptObject = at(12).find((e) => e.edgeRole === 'ATTRIBUTE_OBJECT');
  if (!subscriptObject || subscriptObject.kind === 'CALL') {
    problems.push(
      `L12 type[o].x: the attribute object is ${subscriptObject?.kind ?? '(missing)'}; a ` +
      'subscript must not be rebuilt as a call'
    );
  }

  // The gap row is provenance, not a claim of loss — the grammar still misparsed. Asserted
  // so that removing it becomes a deliberate act rather than a side effect.
  const gaps = tsv('all-python-parse-gaps.csv').filter((g) => g.constructKind === 'SOFT_KEYWORD_MISPARSE');
  if (gaps.length === 0) {
    problems.push('no SOFT_KEYWORD_MISPARSE parse gap: the misparse is no longer recorded');
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${EXPECTED_CALLS.length} statement shapes; ${gaps.length} misparse(s) still ` +
    'recorded as parse gaps, the subscript form left alone, spans covering the keyword');
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
