/**
 * Assembles a SELF-CONTAINED corpus: a package plus everything it imports.
 *
 * The problem this solves is a measurement one. On a real package most call
 * targets live outside the analysis root — in the stdlib or a dependency — so no
 * `py_method` row can exist for them and they are unreachable BY CONSTRUCTION.
 * That makes the denominator argue about scope rather than about the parser: on
 * sqlalchemy/engine, 1,275 of 1,952 call sites were unreachable for that reason
 * alone.
 *
 * Copying the imported modules in beside the package removes the excuse. Every
 * callee is then declared inside the root, the ceiling becomes ~100%, and an
 * unresolved call is the parser's fault rather than the corpus's — the property
 * that makes A0's closed-world corpus useful, at a scale hand-writing cannot
 * reach.
 *
 * It also stresses the thing most likely to be wrong at scale: cross-package
 * resolution through real re-export chains, deep inheritance and dotted imports,
 * rather than the tidy two-package shapes a fixture contains.
 *
 * The corpus is GENERATED, not committed — the script is what is reproducible,
 * which is the standard A0 asked for. Vendored copies are read-only inputs and
 * are never edited.
 *
 *   npx tsx src/test/python-gates/vendor-corpus.ts <package-dir> <out-dir> [--depth N]
 */
import * as fs from 'fs';
import * as path from 'path';

/** Where the pinned interpreter keeps its standard library. */
const STDLIB = '/Library/Frameworks/Python.framework/Versions/3.10/lib/python3.10';

/** Modules that are C extensions or would drag in most of the stdlib. */
const SKIP = new Set([
  'sys', 'builtins', '_thread', 'gc', 'time', 'errno', 'math', 'cmath',
  'select', 'fcntl', 'termios', 'signal', 'marshal', 'array', 'binascii',
  'zlib', 'unicodedata', 'msvcrt', 'nt', 'posix', 'pwd', 'grp', '_socket',
  '_ssl', '_ctypes', 'itertools', 'atexit', 'faulthandler',
]);

/** Every module name imported anywhere under `dir`, top-level segment only. */
function importedNames(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__') {
        importedNames(full, found);
      }
      continue;
    }
    if (!entry.name.endsWith('.py')) {
      continue;
    }
    const source = fs.readFileSync(full, 'utf-8');
    for (const line of source.split('\n')) {
      // Absolute imports only. A relative import is already inside the package,
      // and a dotted path contributes its ROOT, since that is what has to be
      // present on disk for the rest to be findable.
      const fromImport = /^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import/.exec(line);
      const plainImport = /^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)/.exec(line);
      const named = fromImport?.[1] ?? plainImport?.[1];
      if (named) {
        found.add(named.split('.')[0]!);
      }
    }
  }
  return found;
}

function copyModule(name: string, outDir: string): 'package' | 'module' | 'missing' {
  const asPackage = path.join(STDLIB, name);
  const asModule = path.join(STDLIB, `${name}.py`);
  if (fs.existsSync(asPackage) && fs.statSync(asPackage).isDirectory()) {
    fs.cpSync(asPackage, path.join(outDir, name), {
      recursive: true,
      filter: source => !source.includes('__pycache__') && !source.includes('/test'),
    });
    return 'package';
  }
  if (fs.existsSync(asModule)) {
    fs.copyFileSync(asModule, path.join(outDir, `${name}.py`));
    return 'module';
  }
  return 'missing';
}

function main(): void {
  const [source, outDir] = process.argv.slice(2);
  if (!source || !outDir) {
    console.error('usage: vendor-corpus.ts <package-dir> <out-dir> [--depth N]');
    process.exit(2);
  }
  const depthFlag = process.argv.indexOf('--depth');
  const maxDepth = depthFlag >= 0 ? Number(process.argv[depthFlag + 1]) : 1;

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const name = path.basename(source);
  fs.cpSync(source, path.join(outDir, name), {
    recursive: true,
    filter: entry => !entry.includes('__pycache__'),
  });

  const vendored = new Set<string>([name]);
  let frontier = [path.join(outDir, name)];
  const counts = { package: 0, module: 0, missing: 0, skipped: 0 };

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: string[] = [];
    for (const dir of frontier) {
      for (const imported of importedNames(dir)) {
        if (vendored.has(imported)) {
          continue;
        }
        if (SKIP.has(imported)) {
          counts.skipped += 1;
          vendored.add(imported);
          continue;
        }
        const result = copyModule(imported, outDir);
        counts[result] += 1;
        vendored.add(imported);
        if (result === 'package') {
          next.push(path.join(outDir, imported));
        }
      }
    }
    frontier = next;
  }

  const files = (function count(dir: string): number {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      total += entry.isDirectory() ? count(full) : entry.name.endsWith('.py') ? 1 : 0;
    }
    return total;
  })(outDir);

  console.log(`vendored corpus at ${outDir}`);
  console.log(`  root package     : ${name}`);
  console.log(`  pulled in        : ${counts.package} packages, ${counts.module} modules`);
  console.log(`  skipped (C ext)  : ${counts.skipped}   not found: ${counts.missing}`);
  console.log(`  total .py files  : ${files}`);
}

main();
