/**
 * A PEP 604 union is decomposed whatever its operands look like.
 *
 * tree-sitter-python spells the same construct with TWO different node types, and which one
 * you get depends on the operands. All-bare-name (`Payload | None`) arrives through the
 * expression grammar as `binary_operator`; give any operand a subscript
 * (`Payload[str] | None`) and the typed-annotation grammar produces `union_type` instead.
 * Only `binary_operator` was handled, so every union with a subscripted operand fell past
 * every branch of the kind classifier to `UNKNOWN` — empty `typeName`, no child references,
 * `isOptional=false` — while the same union spelled `Optional[Payload[str]]` decomposed
 * correctly. 12.6% of the PEP 604 unions in a five-project census, up to 22.6% on one.
 *
 * So the defect is narrow and specific: not generics, and not `|`. A subscript AS A UNION
 * OPERAND. The fixture is built around that: each defective form sits beside the `Optional[…]`
 * spelling that means the same thing, and the assertions compare the two rather than
 * hand-copying an expected shape.
 *
 * The `isOptional` cases are here because the two node types NEST IN OPPOSITE DIRECTIONS.
 * `binary_operator` is left-associative, so `A | B | None` has `None` as its direct right
 * operand; `union_type` is right-nested, so the same annotation with a subscript anywhere
 * puts `None` one level down inside `B | None`. A fix that read only the direct operands
 * would answer `isOptional` differently for two annotations that mean the same thing, so the
 * three-operand rows below are what stop that.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class Payload(Generic[T]):
    ...


class Other(Generic[T]):
    ...


class Holder:
    def __init__(self) -> None:
        self.bare_union: Payload | None = None
        self.sub_union: Payload[str] | None = None
        self.optional_bare: Optional[Payload] = None
        self.optional_sub: Optional[Payload[str]] = None
        self.plain_sub: Payload[str] = Payload()
        self.two_subs: Payload[str] | Other[int] = None
        self.no_none: Payload[str] | Other[int] = None
        self.three_bare: Payload | Other | None = None
        self.three_sub_first: Payload[str] | Other | None = None
        self.three_sub_middle: Payload | Other[int] | None = None


def param_sub_union(x: Payload[str] | None) -> None: ...


def returns_sub_union() -> Payload[str] | None: ...
`;

/**
 * annotation text -> [kind, isOptional, child count, child kinds]
 *
 * Keyed on `completeTypeName`, which is the annotation as written — so an assertion cannot
 * quietly re-point at a different construct when the fixture is edited.
 */
const EXPECTED: ReadonlyArray<readonly [string, string, string, readonly string[], string]> = [
  // ── the defective form and the twin that always worked, side by side ──
  ['Payload[str] | None', 'UNION_PEP604', 'true', ['SUBSCRIPT', 'NONE_TYPE'],
    'a subscripted operand in a union'],
  ['Optional[Payload[str]]', 'OPTIONAL', 'true', ['SUBSCRIPT'],
    'control: the same meaning spelled Optional[...]'],
  ['Payload | None', 'UNION_PEP604', 'true', ['NAME', 'NONE_TYPE'],
    'control: an all-bare-name union, which came through binary_operator'],
  ['Optional[Payload]', 'OPTIONAL', 'true', ['NAME'], 'control: Optional of a bare name'],
  ['Payload[str]', 'SUBSCRIPT', 'false', ['NAME'],
    'control: a subscript that is not a union operand'],

  // Both operands subscripted, so neither is a bare name anywhere in the union.
  ['Payload[str] | Other[int]', 'UNION_PEP604', 'false', ['SUBSCRIPT', 'SUBSCRIPT'],
    'two subscripted operands and no None'],
];

/**
 * `isOptional` must not depend on which node type the grammar chose, nor on where the
 * subscript sits. All four of these mean "one of these, or None".
 */
const OPTIONAL_REGARDLESS_OF_NESTING: readonly string[] = [
  'Payload | Other | None',        // binary_operator, left-nested
  'Payload[str] | Other | None',   // union_type, subscript first
  'Payload | Other[int] | None',   // union_type, subscript in the middle
  'Payload[str] | None',           // union_type, two operands
];

export async function pep604Union(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-union-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'unions.py'), SOURCE);

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const lines = fs
    .readFileSync(path.join(outputDir, 'all-python-type-references.csv'), 'utf-8')
    .split('\n')
    .filter(Boolean);
  const header = lines[0]!.split('\t');
  const rows = lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as Record<string, string>;
  });

  const childrenOf = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const parent = r.parentReferenceHash ?? '';
    if (!childrenOf.has(parent)) {
      childrenOf.set(parent, []);
    }
    childrenOf.get(parent)!.push(r);
  }
  const depth0 = rows.filter((r) => r.depth === '0');
  const byAnnotation = new Map<string, Record<string, string>[]>();
  for (const r of depth0) {
    const key = r.completeTypeName ?? '';
    if (!byAnnotation.has(key)) {
      byAnnotation.set(key, []);
    }
    byAnnotation.get(key)!.push(r);
  }

  for (const [annotation, kind, optional, childKinds, why] of EXPECTED) {
    const found = byAnnotation.get(annotation) ?? [];
    if (found.length === 0) {
      problems.push(`${annotation} (${why}): no depth-0 reference emitted`);
      continue;
    }
    // Every occurrence of the annotation must agree — the fixture writes the union form as a
    // field, a parameter and a return type, and a union is a union in all three positions.
    for (const r of found) {
      const kids = (childrenOf.get(r.pyTypeReferenceUniqueHash ?? '') ?? [])
        .map((c) => c.kind ?? '')
        .sort();
      const want = childKinds.slice().sort();
      const faults: string[] = [];
      if (r.kind !== kind) {
        faults.push(`kind=${r.kind} (want ${kind})`);
      }
      if (r.isOptional !== optional) {
        faults.push(`isOptional=${r.isOptional} (want ${optional})`);
      }
      if (JSON.stringify(kids) !== JSON.stringify(want)) {
        faults.push(`children=[${kids.join(',')}] (want [${want.join(',')}])`);
      }
      if (faults.length > 0) {
        problems.push(`${annotation} (${why}) at L${r.startLine}: ${faults.join('; ')}`);
      }
    }
  }

  for (const annotation of OPTIONAL_REGARDLESS_OF_NESTING) {
    const found = byAnnotation.get(annotation) ?? [];
    if (found.length === 0) {
      problems.push(`${annotation}: no depth-0 reference emitted`);
      continue;
    }
    for (const r of found) {
      if (r.isOptional !== 'true') {
        problems.push(
          `${annotation} at L${r.startLine}: isOptional=${r.isOptional}, but the annotation ` +
          'admits None — isOptional must not depend on which node type the grammar chose ' +
          'or on where the subscript sits'
        );
      }
    }
  }

  // The general property. A union is never UNKNOWN: `|` is written down, so the operands are
  // always recoverable. Stated separately so a NEW operand shape that collapses fails here
  // even if it is not one of the annotations enumerated above.
  const unknownUnions = depth0
    .filter((r) => r.kind === 'UNKNOWN' && (r.completeTypeName ?? '').includes('|'))
    .map((r) => `L${r.startLine} ${r.completeTypeName}`);
  if (unknownUnions.length > 0) {
    problems.push(`union(s) collapsed to UNKNOWN: ${unknownUnions.join(', ')}`);
  }

  // A subscripted operand must keep its OWN resolved link, or the head type is still lost.
  const subUnion = (byAnnotation.get('Payload[str] | None') ?? [])[0];
  if (subUnion) {
    const sub = (childrenOf.get(subUnion.pyTypeReferenceUniqueHash ?? '') ?? [])
      .find((c) => c.kind === 'SUBSCRIPT');
    if (!sub) {
      problems.push('Payload[str] | None: no SUBSCRIPT child to carry the head type');
    } else if ((sub.referencedTypeLinkHash ?? '') === '') {
      problems.push(
        'Payload[str] | None: the SUBSCRIPT operand carries no referencedTypeLinkHash, so ' +
        'the head type is still unresolvable'
      );
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${depth0.length} depth-0 reference(s); ${EXPECTED.length} annotation shapes ` +
    `compared against their Optional[...] twins, ${OPTIONAL_REGARDLESS_OF_NESTING.length} ` +
    'isOptional cases across both nesting directions');
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
