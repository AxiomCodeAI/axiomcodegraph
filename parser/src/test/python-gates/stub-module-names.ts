/**
 * A stub tree must be named exactly as the source tree in the same position.
 *
 * Library linking is by qualified name on purpose: a hash minted by one parser
 * run cannot match another's, so a separately parsed library is reached by name
 * or not at all. That makes a module's name part of its contract, and the file
 * extension must decide nothing about it.
 *
 * The defect this pins had one cause and two faces. The package ascent tested
 * only for `__init__.py`, so under a stub package it broke immediately:
 *
 *   collections/abc.pyi       -> bare `abc`, packageQualifiedName empty, and
 *                                COLLIDING with the real top-level `abc`
 *   collections/__init__.pyi  -> `collections.__init__`, never collapsed
 *
 * The collision is the part that makes a stub tree unusable rather than merely
 * untidy, so it is asserted directly and not just implied by the name checks.
 *
 * No interpreter and no network: the tree is written to a temp directory and
 * parsed twice, once per extension, and the two runs are compared to each
 * other. There is no frozen expectation to drift, because the `.py` run IS the
 * expectation.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

/** Package layout, written once per extension. `abc` twice, to force a collision. */
const LAYOUT = [
  'abc',
  'collections/__init__',
  'collections/abc',
  'pkg/__init__',
  'pkg/sub',
  'pkg/nested/__init__',
  'pkg/nested/deep',
];

type ModuleRow = Record<string, string>;

function readModules(outputDir: string): ModuleRow[] {
  const file = path.join(outputDir, 'all-python-modules.csv');
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as ModuleRow;
  });
}

export async function stubModuleNames(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-stub-names-'));
  const byExtension = new Map<string, Map<string, ModuleRow>>();

  for (const extension of ['py', 'pyi']) {
    const tree = path.join(root, extension);
    for (const stem of LAYOUT) {
      const target = path.join(tree, `${stem}.${extension}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'value: int\n');
    }
    const outputDir = path.join(root, `out-${extension}`);
    await new PythonProjectAnalyzer().analyze({
      rootDir: tree,
      outputDir,
      baseMservPath: '/repo',
      serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
    });
    // Key by position in the tree, extension removed, so the two runs line up.
    const rows = new Map<string, ModuleRow>();
    for (const row of readModules(outputDir)) {
      rows.set(String(row.filePath).replace(/\.pyi?$/, ''), row);
    }
    byExtension.set(extension, rows);
  }

  const source = byExtension.get('py')!;
  const stub = byExtension.get('pyi')!;

  if (source.size !== LAYOUT.length) {
    problems.push(`.py run produced ${source.size} modules, expected ${LAYOUT.length}`);
  }
  if (stub.size !== LAYOUT.length) {
    problems.push(`.pyi run produced ${stub.size} modules, expected ${LAYOUT.length}`);
  }

  // The .py run is the expectation; the .pyi run must match it position for
  // position on every column that carries module identity.
  for (const [position, expected] of source) {
    const actual = stub.get(position);
    if (!actual) {
      problems.push(`${position}: present as .py, MISSING as .pyi`);
      continue;
    }
    for (const column of ['qualifiedName', 'packageQualifiedName', 'name', 'isPackage']) {
      if (expected[column] !== actual[column]) {
        problems.push(
          `${position}: ${column} is "${actual[column]}" as .pyi ` +
          `but "${expected[column]}" as .py`
        );
      }
    }
  }

  // The collision, asserted directly. `collections/abc` and top-level `abc`
  // must stay distinct, which is the property that makes the tree usable.
  for (const [extension, rows] of byExtension) {
    const names = [...rows.values()].map((r) => String(r.qualifiedName));
    const duplicated = [...new Set(names.filter((n) => names.filter((m) => m === n).length > 1))];
    if (duplicated.length > 0) {
      problems.push(`.${extension}: qualifiedName collision on ${duplicated.join(', ')}`);
    }
    for (const name of names) {
      if (name === '__init__' || name.endsWith('.__init__')) {
        problems.push(`.${extension}: module named "${name}"; __init__ is the package itself`);
      }
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${LAYOUT.length} positions compared across .py and .pyi`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
