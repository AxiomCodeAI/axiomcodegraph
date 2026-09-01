/**
 * A qualified name is stable across independent runs.
 *
 * The parser has no notion of a client or a library. It is run over a tree and
 * emits one IR; whether those CSVs are later staged under a `lib_` prefix is a
 * decision made downstream, and nothing here should encode it. What the parser
 * owes is narrower and purely its own: the name it mints for a module must not
 * depend on anything outside the module's own position in its package.
 *
 * That matters because hashes are content-addressed per run, so two runs cannot
 * share them. Anything joining one run's output to another's joins BY NAME. The
 * name is therefore a cross-run contract even though the parser never sees more
 * than one run at a time -- which is exactly why no existing gate could observe
 * it: every one of them analyses a single tree.
 *
 * Three properties, none of which mentions a role:
 *
 * 1. SELF-CONSISTENCY. What an import STATES and what a module row OFFERS are
 *    produced by different code, and must agree. `from mylib.core.engine import
 *    Engine` is only ever joinable if a module named `mylib.core.engine` is
 *    what the same tree emits.
 *
 * 2. ROOT INDEPENDENCE. Pointing the parser at a package or at its parent must
 *    give the same names. The run is invoked by whoever has the directory, and
 *    a name that moved with the root would produce an IR that joins to nothing
 *    for half of them.
 *
 * 3. VISIBLE ABSENCE. A tree that imports something it does not contain must
 *    not invent a module row for it, and must mark the import UNRESOLVED rather
 *    than guess. Absence is a fact: every row traces to bytes that were parsed,
 *    and what is missing has to be readable as missing.
 *
 * The `.pyi` spelling is exercised alongside `.py` for the same reason the
 * extension is not allowed to change a name anywhere else -- not because a stub
 * tree is a different KIND of input, but because it is the same input written
 * differently, and it is where this broke before: a stub package emitted
 * `collections.__init__` while every importer writes `collections`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

/** stem -> body. Written once per extension: the same tree, spelled two ways. */
const PACKAGE_TREE = {
  'mylib/__init__': 'from mylib.core.engine import Engine\n',
  'mylib/core/__init__': '',
  'mylib/core/engine': 'class Engine:\n    def run(self):\n        return 1\n',
  'mylib/helpers': 'def tidy(x):\n    return x\n',
};

const IMPORTER = `from mylib.core.engine import Engine
import mylib.helpers as helpers
from mylib import Engine as ReExported


def go():
    return Engine().run(), helpers.tidy(1), ReExported()
`;

/** A tree importing things it does not contain. */
const IMPORTS_WHAT_IT_LACKS = `import requests
from mylib.core import Engine


def go(url):
    return requests.get(url), Engine()
`;

type Row = Record<string, string>;

function read(outputDir: string, file: string): Row[] {
  const target = path.join(outputDir, file);
  if (!fs.existsSync(target)) {
    return [];
  }
  const lines = fs.readFileSync(target, 'utf-8').split('\n').filter(Boolean);
  const header = lines[0]!.split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as Row;
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

function writeTree(root: string, extension: string): string {
  const tree = path.join(root, `tree-${extension}`);
  for (const [stem, body] of Object.entries(PACKAGE_TREE)) {
    const target = path.join(tree, `${stem}.${extension}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return tree;
}

export async function nameStability(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-staging-'));

  // ---- the importing tree, parsed once and reused -------------------------
  const importerDir = path.join(root, 'importer');
  fs.mkdirSync(importerDir, { recursive: true });
  fs.writeFileSync(path.join(importerDir, 'app.py'), IMPORTER);
  const importerOut = path.join(root, 'importer-out');
  await analyse(importerDir, importerOut);
  const statedImports = read(importerOut, 'all-python-imports.csv');
  if (statedImports.length === 0) {
    problems.push('the importing tree produced no imports at all');
  }

  // ---- 1: what an import states and what a module row offers must agree ----
  for (const extension of ['py', 'pyi']) {
    const tree = writeTree(root, extension);
    const libOut = path.join(root, `out-${extension}`);
    await analyse(tree, libOut);
    const offered = new Set(read(libOut, 'all-python-modules.csv').map((m) => m.qualifiedName!));

    for (const record of statedImports) {
      const stated = record.packageOrTypeName || record.importedPath || '';
      if (stated === '') {
        continue;
      }
      // The stated path IS the module: py_import splits the member into
      // simpleName, so `from mylib.core.engine import Engine` arrives with
      // packageOrTypeName = mylib.core.engine. An earlier version of this
      // check also accepted the PARENT of the stated path, which made it
      // vacuous for the exact defect it guards: with .pyi package detection
      // broken the tree offers `mylib.core` but not `mylib.core.engine`, and
      // the fallback waved that through. Nothing needs the leniency, because
      // Python itself requires the stated path to be importable.
      if (!offered.has(stated)) {
        problems.push(
          `the .${extension} tree emits no module for its own import "${stated}"; ` +
          `it offers ${[...offered].sort().join(', ')}`
        );
      }
    }
    if (!offered.has('mylib')) {
      problems.push(`the .${extension} tree does not emit the package name "mylib"`);
    }
    for (const name of offered) {
      if (name.endsWith('.__init__')) {
        problems.push(`the .${extension} tree emits "${name}"; nothing ever imports that spelling`);
      }
    }
  }

  // ---- 2: the name must not move with the analysis root -------------------
  const insideOut = path.join(root, 'out-inside');
  await analyse(path.join(root, 'tree-py', 'mylib'), insideOut);
  const fromParent = read(path.join(root, 'out-py'), 'all-python-modules.csv')
    .map((m) => m.qualifiedName!).sort();
  const fromInside = read(insideOut, 'all-python-modules.csv')
    .map((m) => m.qualifiedName!).sort();
  if (fromParent.join(',') !== fromInside.join(',')) {
    problems.push(
      'names move with the analysis root: pointing at the parent gives ' +
      `[${fromParent.join(', ')}], pointing at the package gives [${fromInside.join(', ')}]`
    );
  }

  // ---- 3: a tree that imports what it does not contain ---------------------
  const aloneDir = path.join(root, 'alone');
  fs.mkdirSync(aloneDir, { recursive: true });
  fs.writeFileSync(path.join(aloneDir, 'app.py'), IMPORTS_WHAT_IT_LACKS);
  const aloneOut = path.join(root, 'alone-out');
  await analyse(aloneDir, aloneOut);

  const modules = read(aloneOut, 'all-python-modules.csv');
  // The provenance contract: a row exists only for bytes that were parsed.
  // Inventing `requests` here would be a fact about a file nobody read.
  if (modules.length !== 1 || modules[0]!.qualifiedName !== 'app') {
    problems.push(
      'a tree emitted module rows for packages it only imports: ' +
      modules.map((m) => m.qualifiedName).join(', ')
    );
  }
  for (const record of read(aloneOut, 'all-python-imports.csv')) {
    if (record.resolvedModuleLinkHash !== '') {
      problems.push(
        `import "${record.packageOrTypeName}" resolved although the target is not in the tree`
      );
    }
    // Absence must be VISIBLE, not merely empty: a consumer reads the kind.
    if (record.resolvedTargetKind !== 'UNRESOLVED') {
      problems.push(
        `import "${record.packageOrTypeName}" is ${record.resolvedTargetKind}, so a ` +
        'consumer cannot see that the target is absent'
      );
    }
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    `  ${statedImports.length} imports checked against both spellings of the same tree, ` +
    'root independence, and visible absence'
  );
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
