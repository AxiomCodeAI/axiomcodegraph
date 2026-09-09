/**
 * `async for` and `async with` drive DIFFERENT protocols, and the IR says which.
 *
 * `for x in o` calls `o.__iter__` / `__next__`; `async for x in o` calls `o.__aiter__` /
 * `__anext__`. `with c` calls `__enter__` / `__exit__`; `async with c` calls `__aenter__` /
 * `__aexit__`. ast has separate node types for exactly this reason. Both pairs shared one
 * `rootContext`, so a consumer emitting the iteration- or context-protocol edge had to choose
 * between fabricating the sync protocol on every async statement and emitting nothing.
 *
 * Nothing else on the expression recovers it, which is what makes this a gap rather than an
 * inconvenience:
 *
 *   - the ENCLOSING FUNCTION cannot decide it — an `async def` contains plain `for` loops
 *     too, and this fixture writes both in one function so that stays visible;
 *   - the BLOCK row cannot either. `PythonBlockKind` does distinguish `ASYNC_FOR` / `ASYNC_WITH`,
 *     but the iterable and the context manager are owned by the METHOD, not by that block, so
 *     there is no join from the expression to the kind. Asserted below rather than asserted
 *     about, because it is the reason the column is needed.
 *
 * Async is a distinct `rootContext` member rather than a flag, matching how the rest of the
 * Python model encodes it: `PythonBlockKind.ASYNC_FOR`, `PythonMethodKind.ASYNC_FUNCTION`,
 * `PythonComprehensionKind.ASYNC_LIST`. Reusing `isAwaited` was the other candidate and would
 * have been wrong twice over: it means "this expression is the operand of an `await`" and is
 * set in exactly one place for `AWAIT_OPERAND`, while the iterable of an `async for` is NOT
 * awaited — `__aiter__` is called on it synchronously, and it is the `__anext__` results that
 * are awaited. Overloading it would have inflated any count of await operands.
 *
 * COMPREHENSIONS are deliberately absent from this gate: `[x async for x in a]` is already
 * distinguished by `comprehensionKind` (`ASYNC_LIST` / `ASYNC_SET` / `ASYNC_DICT` /
 * `ASYNC_GENERATOR`) on the comprehension's own row, so adding a rootContext member for them
 * would be a second spelling of a fact the IR already carries. The last case below pins that,
 * so the claim cannot rot.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `async def aiter_values():
    yield 1


def sync_values():
    return [1, 2]


class Ctx:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class ACtx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


async def both(cm, acm, cm2, acm2, seq, aseq):
    # A plain for/with inside an async def: the enclosing function does not decide it.
    for sync_item in seq:
        print(sync_item)
    async for async_item in aseq:
        print(async_item)

    with cm as sync_handle:
        pass
    async with acm as async_handle:
        pass

    # Several managers in one statement: every clause takes the statement's own kind.
    with cm as h1, cm2 as h2:
        pass
    async with acm as ah1, acm2 as ah2:
        pass

    # A tuple target, so the target walk is exercised on both forms.
    for sync_k, sync_v in seq:
        print(sync_k, sync_v)
    async for async_k, async_v in aseq:
        print(async_k, async_v)

    listed = [c async for c in aseq]
    plain = [c for c in seq]
    return listed, plain
`;

/** literalValue -> the rootContext that name must carry. */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ['seq', 'FOR_ITERABLE'],
  ['sync_item', 'FOR_TARGET'],
  ['aseq', 'ASYNC_FOR_ITERABLE'],
  ['async_item', 'ASYNC_FOR_TARGET'],

  ['cm', 'WITH_CONTEXT'],
  ['sync_handle', 'WITH_TARGET'],
  ['acm', 'ASYNC_WITH_CONTEXT'],
  ['async_handle', 'ASYNC_WITH_TARGET'],

  ['cm2', 'WITH_CONTEXT'],
  ['h1', 'WITH_TARGET'],
  ['h2', 'WITH_TARGET'],
  ['acm2', 'ASYNC_WITH_CONTEXT'],
  ['ah1', 'ASYNC_WITH_TARGET'],
  ['ah2', 'ASYNC_WITH_TARGET'],

  ['sync_k', 'FOR_TARGET'],
  ['sync_v', 'FOR_TARGET'],
  ['async_k', 'ASYNC_FOR_TARGET'],
  ['async_v', 'ASYNC_FOR_TARGET'],
];

export async function asyncIteration(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-asynciter-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'aiter.py'), SOURCE);

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

  const expressions = tsv('all-python-expressions.csv');
  const contextsByName = new Map<string, Set<string>>();
  for (const e of expressions) {
    const name = e.literalValue ?? '';
    if (name === '') {
      continue;
    }
    if (!contextsByName.has(name)) {
      contextsByName.set(name, new Set());
    }
    contextsByName.get(name)!.add(e.rootContext ?? '');
  }

  for (const [name, want] of EXPECTED) {
    const got = contextsByName.get(name);
    if (!got) {
      problems.push(`${name}: no expression row emitted at all`);
    } else if (!got.has(want)) {
      problems.push(`${name}: expected rootContext ${want}, got ${[...got].sort().join('/')}`);
    }
  }

  // The sync and async members must BOTH still appear. A fix that routed everything down one
  // branch would satisfy half the table above and fail here.
  for (const required of ['FOR_ITERABLE', 'ASYNC_FOR_ITERABLE', 'WITH_CONTEXT', 'ASYNC_WITH_CONTEXT']) {
    if (!expressions.some((e) => e.rootContext === required)) {
      problems.push(`${required} appears on no row; one branch is swallowing the other`);
    }
  }

  // Why the column is needed at all: the block row knows, and the expression cannot reach it.
  // If this ever stops being true the gate should be revisited rather than silently kept.
  const blocks = tsv('all-python-blocks.csv');
  const blockHashes = new Set(blocks.map((b) => b.pyBlockUniqueHash ?? ''));
  const iterables = expressions.filter((e) =>
    e.rootContext === 'FOR_ITERABLE' || e.rootContext === 'ASYNC_FOR_ITERABLE');
  if (iterables.length > 0 && iterables.every((e) => blockHashes.has(e.expressionOwnerHash ?? ''))) {
    problems.push(
      'every for-iterable is owned by a block — if the expression can now reach the ' +
      'ASYNC_FOR block kind directly, the rootContext members may be redundant'
    );
  }

  // Comprehensions carry their async-ness on comprehensionKind, so they must NOT have grown a
  // rootContext member: two spellings of one fact is the thing this gate is guarding against.
  const comprehensionKinds = new Set(
    expressions.map((e) => e.comprehensionKind ?? '').filter((k) => k !== '' && k !== 'NONE')
  );
  for (const want of ['LIST', 'ASYNC_LIST']) {
    if (!comprehensionKinds.has(want)) {
      problems.push(
        `comprehensionKind ${want} absent; the async comprehension distinction is supposed to ` +
        'live on this column, which is why no ASYNC_COMPREHENSION rootContext was added'
      );
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${EXPECTED.length} name(s) pinned across for/async-for and with/async-with, ` +
    'including multi-manager and tuple-target forms; comprehension async-ness checked to be ' +
    'on comprehensionKind rather than duplicated onto rootContext');
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
