/**
 * A module-level `async def`, generator or async generator is a module export (#1525).
 *
 * `from jobs import sync_orders` is resolved against a per-module export index. That
 * index admitted a module-level function only when its method kind was FUNCTION, and
 * the kind of a `def` names what a call RETURNS: `async def` is ASYNC_FUNCTION, one
 * with `yield` is GENERATOR or ASYNC_GENERATOR. So the import of any of those got no
 * entity, and a value use of the name in the importing module (a callback, a job list)
 * was an IMPORT reference that impact never counted, while the same use of a plain
 * `def` was a METHOD reference.
 *
 * Controls: a plain `def` resolves as before, and a nested `async def` is still not an
 * export (it has an enclosing member, so importing it resolves to no function).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const JOBS = [
  'async def sync_orders(): return 1',
  'def stream_orders(): yield 1',
  'async def stream_users(): yield 1',
  'def count_orders(): return 1',
  'def outer():',
  '    async def inner(): return 1',
  '    return inner',
  '',
].join('\n');

const REGISTRY = [
  'from jobs import count_orders, inner, stream_orders, stream_users, sync_orders',
  '',
  'JOBS = [sync_orders, stream_orders, stream_users, count_orders, inner]',
  '',
].join('\n');

/** imported name -> [resolves to the module function of that name, what it proves] */
const EXPECTED: ReadonlyArray<readonly [string, boolean, string]> = [
  ['sync_orders', true, 'an async def'],
  ['stream_orders', true, 'a generator'],
  ['stream_users', true, 'an async generator'],
  ['count_orders', true, 'control: a plain def'],
  ['inner', false, 'control: a nested async def is not a module export'],
];

export async function functionExports(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-fnexports-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'jobs.py'), JOBS);
  fs.writeFileSync(path.join(source, 'registry.py'), REGISTRY);

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
  const methods = new Map(tsv('all-python-methods.csv').map((m) => [m.pyMethodUniqueHash, m.name]));
  const imports = tsv('all-python-imports.csv');
  let checked = 0;
  for (const [name, exported, what] of EXPECTED) {
    const row = imports.find((i) => i.originalName === name || i.simpleName === name);
    if (!row) {
      problems.push(`${name}: no import row`);
      continue;
    }
    checked++;
    const isFunction = row.resolvedTargetKind === 'FUNCTION' && methods.get(row.resolvedTargetHash) === name;
    if (isFunction !== exported) {
      problems.push(
        `${name} (${what}): resolved to ${row.resolvedTargetKind} ${row.resolvedTargetHash}, ` +
          `expected ${exported ? 'the FUNCTION of that name' : 'no module function'}`
      );
    }
  }
  if (checked < EXPECTED.length) problems.push(`only ${checked} of ${EXPECTED.length} imports checked`);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${checked} imported names checked`);
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  return problems.length === 0 ? 0 : 1;
}
