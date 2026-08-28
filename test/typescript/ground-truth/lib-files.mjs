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

const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) process.exit(0);
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config,
  ts.sys,
  path.dirname(configPath)
);
const program = ts.createProgram(parsed.fileNames, parsed.options);

for (const sf of program.getSourceFiles()) {
  const b = path.basename(sf.fileName);
  if (b.startsWith('lib.') && b.endsWith('.d.ts')) console.log(sf.fileName);
}
