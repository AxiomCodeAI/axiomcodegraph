/**
 * A name reference carries what the name IS, not `UNKNOWN`.
 *
 * py_binding mirrors CPython's symtable, so the referencing scope holds an
 * entry for every name used in it: a global read from inside a function has a
 * row in the FUNCTION's scope with is_global set. The classification was
 * therefore already computed, at full CPython parity, and then dropped on the
 * way to py_expression -- 86% of expression references came out UNKNOWN.
 *
 * Every consumer had to rebuild it by joining expression to scope to binding,
 * which is not free and is not always unambiguous: the same name can be bound
 * differently in nested scopes, which is exactly where the answer matters.
 *
 * The cases below pin the distinctions that are easy to collapse:
 *
 *   - global before local, because at MODULE scope symtable reports BOTH and a
 *     module-level name is a global; inside a function they are exclusive;
 *   - nonlocal before free, because a declared `nonlocal` is also free and the
 *     declaration is the stronger statement;
 *   - a walrus target only at the STORE, since a later read of the same name is
 *     an ordinary local read;
 *   - a parameter is a parameter, not a local, though symtable says both.
 *
 * A frozen-golden diff would also catch a regression here, but it would report
 * it as 599 moved rows. These cases name the distinction that broke.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `import json


COUNTER = 0
registry = {}
SERIALIZER = json.dumps


class Private:
    __hidden = 1

    def read(self):
        # Written raw, BOUND mangled as _Private__hidden. A lookup by the
        # written spelling missed, and the reference stayed UNKNOWN.
        return __hidden


def outer(param, flag=1):
    local_name = param + 1

    def inner():
        nonlocal local_name
        local_name += 1
        return local_name

    def reader():
        return local_name

    global COUNTER
    COUNTER = local_name
    squares = [item * 2 for item in range(3)]
    try:
        json.dumps(registry)
    except ValueError as caught:
        return caught
    if (walrus := len(squares)) > 0:
        return walrus
    return inner, reader, flag
`;

/** name -> the kind its NAME_REFERENCE rows must carry, at least once. */
const EXPECTED: Array<[string, string, string]> = [
  ['param', 'PARAMETER', 'a parameter is a parameter, though symtable calls it local too'],
  ['flag', 'PARAMETER', 'a defaulted parameter is still a parameter'],
  ['local_name', 'LOCAL_VARIABLE', 'a function-scope binding is local'],
  ['COUNTER', 'GLOBAL_VARIABLE', 'declared global inside the function'],
  ['registry', 'GLOBAL_VARIABLE', 'read from module scope, never bound locally'],
  // At MODULE scope the binding is the import itself, so the reference is an
  // IMPORT. Inside `outer` the same name is a plain global read: symtable gives
  // the function's scope a `json` entry with is_global set and is_imported
  // clear, because importedness belongs to the binding in the module, not to
  // the reference in the function. Reporting IMPORT there would be a guess
  // rather than a lookup, and both spellings are asserted so neither drifts
  // into the other.
  ['json', 'IMPORT', 'at module scope the binding IS the import'],
  ['len', 'BUILTIN', 'a builtin is a builtin, not an unresolved global'],
  ['item', 'COMPREHENSION_VARIABLE', 'bound by the comprehension that uses it'],
  ['caught', 'EXCEPT_VARIABLE', 'bound by the except clause'],
  ['walrus', 'WALRUS_TARGET', 'at the STORE; a later read is an ordinary local'],
  ['__hidden', 'LOCAL_VARIABLE', 'class-private: bound mangled, written raw'],
];

/**
 * The same name, classified differently by scope. `json` is the import at
 * module scope and a global read inside the function, which is what symtable
 * says and what makes the column a lookup rather than an inference.
 */
const BOTH_READINGS: Array<[string, string[]]> = [['json', ['IMPORT', 'GLOBAL_VARIABLE']]];

/** Kinds that must appear somewhere, proving the scope analysis reaches them. */
const MUST_APPEAR = ['NONLOCAL_VARIABLE', 'FREE_VARIABLE'];

export async function referenceClassification(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-refkind-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'refs.py'), SOURCE);

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const lines = fs
    .readFileSync(path.join(outputDir, 'all-python-expressions.csv'), 'utf-8')
    .split('\n')
    .filter(Boolean);
  const header = lines[0]!.split('\t');
  const kindAt = header.indexOf('kind');
  const nameAt = header.indexOf('literalValue');
  const refAt = header.indexOf('referencedEntityKind');

  const kindsByName = new Map<string, Set<string>>();
  const allKinds = new Set<string>();
  let nameRefs = 0;
  let unknownNameRefs = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (cells[kindAt] !== 'NAME_REFERENCE') {
      continue;
    }
    nameRefs += 1;
    const name = cells[nameAt] ?? '';
    const referenced = cells[refAt] ?? '';
    allKinds.add(referenced);
    if (referenced === 'UNKNOWN') {
      unknownNameRefs += 1;
    }
    if (!kindsByName.has(name)) {
      kindsByName.set(name, new Set());
    }
    kindsByName.get(name)!.add(referenced);
  }

  for (const [name, expected, why] of EXPECTED) {
    const seen = kindsByName.get(name);
    if (!seen) {
      problems.push(`${name}: no NAME_REFERENCE row emitted at all`);
      continue;
    }
    if (!seen.has(expected)) {
      problems.push(`${name}: expected ${expected} (${why}), got ${[...seen].sort().join('/')}`);
    }
  }
  for (const [name, readings] of BOTH_READINGS) {
    const seen = kindsByName.get(name) ?? new Set<string>();
    for (const reading of readings) {
      if (!seen.has(reading)) {
        problems.push(
          `${name}: expected ${reading} in one scope, saw only ${[...seen].sort().join('/')}`
        );
      }
    }
  }
  for (const kind of MUST_APPEAR) {
    if (!allKinds.has(kind)) {
      problems.push(`${kind} never appears; the scope analysis is not reaching it`);
    }
  }
  // The point of the change: a name reference should not be UNKNOWN unless the
  // parser genuinely cannot say. On this source it always can.
  if (unknownNameRefs > 0) {
    const stillUnknown = [...kindsByName.entries()]
      .filter(([, kinds]) => kinds.has('UNKNOWN'))
      .map(([name]) => name);
    problems.push(
      `${unknownNameRefs} NAME_REFERENCE row(s) still UNKNOWN: ${stillUnknown.join(', ')}`
    );
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${nameRefs} name references, ${allKinds.size} distinct kinds, ${unknownNameRefs} unknown`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
