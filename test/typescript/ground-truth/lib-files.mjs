#!/usr/bin/env node
/**
 * Which `lib.*.d.ts` files are ACTUALLY in this project's program.
 *
 * ── WHY NOT JUST STAGE ALL OF THEM ──────────────────────────────────────────
 * `typescript/lib` ships ~110 declaration files and a program loads a handful of
 * them. Which handful is decided by `target` and `lib` in the tsconfig, and the
 * difference is not cosmetic: `lib.dom.d.ts` declares `Console`, `Array`, `Event` and
 * several thousand more names that a Node project does not have. Staging all of them
 * puts DOM declarations into a Node program's global scope, and then `console.log`
 * resolves to the DOM's `Console.log` instead of `@types/node`'s — measured on the
 * Parser repository, 384 wrong targets, of which the `console` family was the largest
 * single group.
 *
 * The compiler already computed the answer when it built the program. This just reads
 * it back, so the staged global scope is the one the project actually compiles
 * against rather than a superset chosen by the harness.
 *
 * Prints one absolute path per line.
 *
 * Usage: node lib-files.mjs <project-dir>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(process.argv[2]);

function loadTypeScript() {
  const envPath = process.env.TS_MODULE_PATH;
  if (envPath) {
    try { return createRequire(import.meta.url)(envPath); } catch { /* fall through */ }
  }
  for (const base of [projectDir, path.dirname(projectDir), path.dirname(path.dirname(projectDir))]) {
    try { return createRequire(path.join(base, 'package.json'))('typescript'); } catch { /* next */ }
  }
  return createRequire(import.meta.url)('typescript');
}
const ts = loadTypeScript();

// The third script to carry this bug: `ts.findConfigFile` walks UPWARD, so on a
// workspace repository whose tsconfig lives under each package there is nothing at the
// root, this exited 0 with no output, and the harness fell back to staging EVERY
// lib.*.d.ts -- putting the DOM global scope into a Node project, where `console.log`
// then resolves to DOM's Console instead of @types/node's. The fallback even says so
// out loud; nothing acted on it.
//
// Discovery mirrors the oracle's. The lib sets are UNIONED across the discovered
// programs: strictly each program has its own global scope, but staging is a single
// shared scope, and a union of the libs the packages actually ask for is far closer to
// the truth than every lib TypeScript ships.
function discoverConfigs(dir) {
  const up = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
  if (up && !path.relative(dir, up).startsWith('..')) return [up];
  const found = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === 'tsconfig.json')) {
      found.push(path.join(d, 'tsconfig.json'));
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), depth + 1);
    }
  };
  walk(dir, 0);
  return found;
}

const configPaths = discoverConfigs(projectDir);
if (configPaths.length === 0) process.exit(0);

const libs = new Set();
for (const configPath of configPaths) {
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    path.dirname(configPath)
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  for (const sf of program.getSourceFiles()) {
    const b = path.basename(sf.fileName);
    if (b.startsWith('lib.') && b.endsWith('.d.ts')) libs.add(sf.fileName);
  }
}
for (const f of libs) console.log(f);
