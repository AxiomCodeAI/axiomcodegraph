/**
 * A type variable is distinguishable from a class of the same name.
 *
 * `T = TypeVar("T")` used in `List[T]` emitted `kind=NAME`, exactly as
 * `List[Options]` does, and `typeVariableName` was never populated. A consumer
 * resolving the element type therefore looked for a class called `T`, found
 * nothing, and recorded an unresolved reference -- or, worse, found an
 * unrelated class that happened to share the name.
 *
 * What is asserted, and why each case is here:
 *
 *   - only a BARE name is reclassified. In `List[T]` the head is `List` and the
 *     variable is the argument, each with its own row, so a change that
 *     reclassified the head would be caught;
 *   - variance comes from the declaration, not the use, so all three readings
 *     are exercised from one file;
 *   - a class named like a type variable is NOT reclassified, which is the
 *     failure that would make this worse than doing nothing;
 *   - a TypeVar declared inside a function still counts, because nothing
 *     requires the conventional module-level declaration.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `from typing import TypeVar, Generic, List, Optional

T = TypeVar("T")
B = TypeVar("B", bound=Options)
S = TypeVar("S", bound="Options")
C = TypeVar("C", int, str)
CO = TypeVar("CO", covariant=True)
CONTRA = TypeVar("CONTRA", contravariant=True)


class Options:
    pass


def scoped():
    Inner = TypeVar("Inner", bound=Options)

    def use(value: Inner) -> Inner:
        return value

    return use


class Holder(Generic[T, CO, CONTRA]):
    items: List[T]
    plain: Options
    nested: Optional[List[T]]
    out: CO
    inp: CONTRA

    def get(self, index: int) -> T:
        return self.items[index]
`;

/** name -> [kind, typeVariableName, wildcardVariance] */
const EXPECTED: Record<string, [string, string, string]> = {
  T: ['TYPE_VAR', 'T', 'INVARIANT'],
  CO: ['TYPE_VAR', 'CO', 'COVARIANT'],
  CONTRA: ['TYPE_VAR', 'CONTRA', 'CONTRAVARIANT'],
  Inner: ['TYPE_VAR', 'Inner', 'INVARIANT'],
  // Not type variables. `List` and `Optional` are heads of a subscript, and
  // Options is an ordinary class; reclassifying any of them would be worse
  // than the original defect, since it would be confidently wrong.
  Options: ['NAME', '', ''],
  int: ['NAME', '', ''],
  List: ['SUBSCRIPT', '', ''],
  Optional: ['OPTIONAL', '', ''],
};

/**
 * A bound is a constraint the IR has to carry, and it is not reachable from the
 * declaration walk: it sits inside a CALL on the right of an assignment rather
 * than in an annotation. `bound=` and `bound="..."` must both arrive, owned by
 * the variable's own BINDING; a CONSTRAINT list is a different thing with no
 * context in the schema, and reporting it as a bound would be a wrong answer
 * rather than a missing one.
 */
const EXPECTED_BOUNDS: Array<[string, string, string]> = [
  ['B', 'Options', 'NAME'],
  ['S', 'Options', 'STRING_FORWARD_REF'],
  // Declared inside a function: the binding is not in the module scope, so a
  // module-only lookup dropped this bound silently.
  ['Inner', 'Options', 'NAME'],
];

export async function typeVariables(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-typevar-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'tv.py'), SOURCE);

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
  const at = (name: string): number => header.indexOf(name);
  const bindHeader = fs.readFileSync(path.join(outputDir, 'all-python-bindings.csv'), 'utf-8')
    .split('\n')[0]!.split('\t');
  const bindHashAt = bindHeader.indexOf('pyBindingUniqueHash');
  const bindNameAt = bindHeader.indexOf('name');

  const seen = new Map<string, Set<string>>();
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const name = cells[at('typeName')] ?? '';
    const shape = [
      cells[at('kind')] ?? '',
      cells[at('typeVariableName')] ?? '',
      cells[at('wildcardVariance')] ?? '',
    ].join('|');
    if (!seen.has(name)) {
      seen.set(name, new Set());
    }
    seen.get(name)!.add(shape);
  }

  for (const [name, expected] of Object.entries(EXPECTED)) {
    const shapes = seen.get(name);
    if (!shapes) {
      problems.push(`${name}: no type reference emitted`);
      continue;
    }
    const want = expected.join('|');
    if (!shapes.has(want)) {
      problems.push(`${name}: expected ${want}, got ${[...shapes].sort().join(' and ')}`);
    }
    // A type variable must be classified CONSISTENTLY. One row saying TYPE_VAR
    // and another saying NAME for the same name is worse than either alone,
    // because a consumer joining on the name sees both.
    if (expected[0] === 'TYPE_VAR' && shapes.size > 1) {
      problems.push(`${name}: classified inconsistently as ${[...shapes].sort().join(' and ')}`);
    }
  }

  // ---- bounds, owned by the type variable's binding -----------------------
  const bindingName = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(outputDir, 'all-python-bindings.csv'), 'utf-8')
    .split('\n').filter(Boolean).slice(1)) {
    const cells = line.split('\t');
    bindingName.set(cells[bindHashAt]!, cells[bindNameAt]!);
  }
  const bounds = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (cells[at('context')] !== 'TYPEVAR_BOUND') {
      continue;
    }
    if (cells[at('referenceOwnerKind')] !== 'BINDING') {
      problems.push(
        `a TYPEVAR_BOUND reference is owned by ${cells[at('referenceOwnerKind')]}; ` +
        'the bound belongs to the variable, so the owner must be its BINDING'
      );
    }
    const owner = bindingName.get(cells[at('typeReferenceOwnerHash')]!) ?? '?';
    bounds.set(owner, `${cells[at('typeName')]}|${cells[at('kind')]}`);
  }
  for (const [variable, boundName, boundKind] of EXPECTED_BOUNDS) {
    const got = bounds.get(variable);
    if (got !== `${boundName}|${boundKind}`) {
      problems.push(`bound of ${variable}: expected ${boundName}|${boundKind}, got ${got ?? 'nothing'}`);
    }
  }
  if (bounds.has('C')) {
    problems.push('C has constraints, not a bound; reporting them as a bound is a wrong answer');
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    `  ${seen.size} distinct type names checked across ${lines.length - 1} references, ` +
    `${bounds.size} bound(s)`
  );
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
