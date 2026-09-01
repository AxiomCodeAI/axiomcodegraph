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
 * Three things are checked, because naming parity alone was not enough. The
 * `isPackage` flag derived from the same test feeds RELATIVE IMPORT resolution
 * in the linker, so a stub package resolved `from . import x` against the wrong
 * base while its names looked plausible. Naming and resolution are therefore
 * both asserted, and so is the mixed-tree consequence of getting them right.
 *
 * No interpreter and no network: trees are written to a temp directory and
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

function readRelation(outputDir: string, file: string): Record<string, string>[] {
  const target = path.join(outputDir, file);
  if (!fs.existsSync(target)) {
    return [];
  }
  const lines = fs.readFileSync(target, 'utf-8').split('\n').filter(Boolean);
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Record<string, string>;
  });
}

async function analyse(rootDir: string, outputDir: string): Promise<void> {
  await new PythonProjectAnalyzer().analyze({
    rootDir,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });
}

/**
 * A relative import inside a stub package must resolve where the same import
 * inside a source package resolves.
 *
 * This is the half that naming parity does not cover. `importTargetModule`
 * decides whether to drop the importing module's last segment from
 * `isPackage`, so a stub package that was not recognised as a package resolved
 * `from . import helper` to a bare `helper` rather than `pkg.helper` -- it
 * linked, to the wrong module, which is worse than not linking. Levels 1, 2 and
 * 3 are all exercised because the level multiplies the error.
 */
const RELATIVE_IMPORT_TREE: Record<string, string> = {
  'pkg/__init__': 'from . import helper\nfrom .sub import deep\n',
  'pkg/helper': 'value: int\n',
  'pkg/sub/__init__': 'from . import deep\nfrom .. import helper\n',
  'pkg/sub/deep': 'from .. import helper\nfrom ...pkg import helper as h2\n',
  // A SECOND `helper`, and a second `deep`, on purpose. findModule matches by
  // SUFFIX, so in a tree with one of each it finds the right module even when
  // the computed base is wrong -- the suffix index silently repairs the
  // mistake and the test passes while the defect is live. With a namesake in
  // another package the suffix is ambiguous, the repair is unavailable, and a
  // wrong base shows up as an unresolved or wrongly resolved edge. Without
  // these two files this section does not cover the isPackage fix at all;
  // verified by reverting that fix and watching it still pass.
  'other/__init__': 'value: int\n',
  'other/helper': 'value: int\n',
  'other/deep': 'value: int\n',
};

async function relativeImportParity(root: string, problems: string[]): Promise<number> {
  const resolved = new Map<string, Map<string, string>>();
  for (const extension of ['py', 'pyi']) {
    const tree = path.join(root, `rel-${extension}`);
    for (const [stem, body] of Object.entries(RELATIVE_IMPORT_TREE)) {
      const target = path.join(tree, `${stem}.${extension}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    const outputDir = path.join(root, `rel-out-${extension}`);
    await analyse(tree, outputDir);
    const moduleName = new Map(
      readRelation(outputDir, 'all-python-modules.csv')
        .map((m) => [String(m.pyModuleUniqueHash), String(m.qualifiedName)])
    );
    const edges = new Map<string, string>();
    for (const row of readRelation(outputDir, 'all-python-imports.csv')) {
      // Key by position and by what was written, never by the resolved value.
      const where = String(row.filePath).replace(/\.pyi?$/, '');
      const key = `${where}|${row.relativeLevel}|${row.packageOrTypeName}|${row.simpleName}`;
      edges.set(key, moduleName.get(String(row.resolvedModuleLinkHash)) ?? '');
    }
    resolved.set(extension, edges);
  }

  const source = resolved.get('py')!;
  const stub = resolved.get('pyi')!;
  for (const [key, expected] of source) {
    const actual = stub.get(key);
    if (actual === undefined) {
      problems.push(`relative import ${key}: present as .py, MISSING as .pyi`);
      continue;
    }
    if (actual !== expected) {
      problems.push(
        `relative import ${key}: resolves to "${actual}" as .pyi but "${expected}" as .py`
      );
    }
  }
  // Guard against both runs being equally broken: the edges must actually
  // resolve, and to a package-qualified name rather than a bare one.
  for (const [key, target] of source) {
    if (target === '') {
      problems.push(`relative import ${key}: UNRESOLVED even as .py`);
      continue;
    }
    if (!target.includes('.')) {
      problems.push(`relative import ${key}: resolved to bare "${target}", expected a qualified name`);
    }
  }
  return source.size;
}

/**
 * A stub and its source sibling are ONE module described twice.
 *
 * Naming them alike is the point of the fix, so they no longer differ by name
 * and anything selecting on name alone sees two rows. That is correct, and the
 * rows must stay separable: distinct primary keys, and `isStub` / `moduleKind`
 * carrying the difference. Which one wins is a resolution policy and is
 * deliberately not decided here.
 */
async function mixedTreePairing(root: string, problems: string[]): Promise<number> {
  const tree = path.join(root, 'mixed');
  fs.mkdirSync(path.join(tree, 'pkg'), { recursive: true });
  for (const extension of ['py', 'pyi']) {
    fs.writeFileSync(path.join(tree, 'pkg', `__init__.${extension}`), 'value: int\n');
    fs.writeFileSync(path.join(tree, 'pkg', `mod.${extension}`), 'other: int\n');
  }
  const outputDir = path.join(root, 'mixed-out');
  await analyse(tree, outputDir);
  const rows = readRelation(outputDir, 'all-python-modules.csv');

  const keys = new Set(rows.map((r) => String(r.pyModuleUniqueHash)));
  if (keys.size !== rows.length) {
    problems.push(`mixed tree: ${rows.length} modules but only ${keys.size} distinct primary keys`);
  }
  for (const wanted of ['pkg', 'pkg.mod']) {
    const pair = rows.filter((r) => String(r.qualifiedName) === wanted);
    if (pair.length !== 2) {
      problems.push(`mixed tree: expected a source and a stub named "${wanted}", found ${pair.length}`);
      continue;
    }
    const stubFlags = pair.map((r) => String(r.isStub)).sort();
    if (stubFlags.join(',') !== 'false,true') {
      problems.push(`mixed tree: "${wanted}" isStub is ${stubFlags.join(',')}, expected one of each`);
    }
    // `isStub` wins in moduleKindFor, so a stub package's kind is STUB and its
    // packageness lives ONLY in isPackage. That makes isPackage the column to
    // assert: a stub `__init__.pyi` must still be marked a package even though
    // its kind cannot say so.
    const stubRow = pair.find((r) => String(r.isStub) === 'true')!;
    const sourceRow = pair.find((r) => String(r.isStub) === 'false')!;
    if (String(stubRow.moduleKind) !== 'STUB') {
      problems.push(`mixed tree: "${wanted}" stub moduleKind is ${stubRow.moduleKind}, expected STUB`);
    }
    const expectedSourceKind = wanted === 'pkg' ? 'PACKAGE_INIT' : 'MODULE';
    if (String(sourceRow.moduleKind) !== expectedSourceKind) {
      problems.push(
        `mixed tree: "${wanted}" source moduleKind is ${sourceRow.moduleKind}, ` +
        `expected ${expectedSourceKind}`
      );
    }
    if (String(stubRow.isPackage) !== String(sourceRow.isPackage)) {
      problems.push(
        `mixed tree: "${wanted}" isPackage is ${stubRow.isPackage} as a stub but ` +
        `${sourceRow.isPackage} as source; the extension must not change packageness`
      );
    }
  }
  return rows.length;
}

/**
 * KNOWN GAP, pinned rather than asserted correct.
 *
 * A directory with no `__init__` at all contributes no segment, so
 * `src/main.py`, `tests/main.py` and `scripts/main.py` are all named `main` and
 * collide. This is the same failure mode as the stub defect but it is NOT the
 * same bug: it predates it and affects `.py` and `.pyi` identically, so it is
 * not something the extension causes.
 *
 * It is left alone on purpose. Whether `src/main.py` is `main` or `src.main`
 * depends on what is on `sys.path`, which the parser cannot know, and inventing
 * a segment per directory would rename modules across every project analysed
 * from a root that holds non-package folders. Recording it here keeps it
 * visible and stops it changing silently.
 */
async function namespaceDirectoriesPinned(root: string, problems: string[]): Promise<string> {
  const tree = path.join(root, 'ns');
  for (const dir of ['src', 'tests']) {
    fs.mkdirSync(path.join(tree, dir), { recursive: true });
    fs.writeFileSync(path.join(tree, dir, 'main.py'), 'value: int\n');
  }
  const outputDir = path.join(root, 'ns-out');
  await analyse(tree, outputDir);
  const rows = readRelation(outputDir, 'all-python-modules.csv');
  const names = rows.map((r) => String(r.qualifiedName)).sort();
  // Distinct primary keys are the property that must hold regardless.
  if (new Set(rows.map((r) => String(r.pyModuleUniqueHash))).size !== rows.length) {
    problems.push('namespace directories: primary keys collided, which is never acceptable');
  }
  return names.join(',');
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

  const importEdges = await relativeImportParity(root, problems);
  const mixedRows = await mixedTreePairing(root, problems);
  const namespaceNames = await namespaceDirectoriesPinned(root, problems);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    `  ${LAYOUT.length} positions, ${importEdges} relative imports, ` +
    `${mixedRows} mixed-tree modules compared across .py and .pyi`
  );
  console.log(
    `  KNOWN GAP  directories without __init__ contribute no segment: [${namespaceNames}]`
  );
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
