/**
 * LOADING THE PROJECT'S OWN COMPILER, AND REFUSING WHEN IT CANNOT ANSWER.
 *
 * ── WHY THE PROJECT'S COMPILER AND NOT A BUNDLED ONE ────────────────────────
 * The oracle speaks the same language version the project is written against.
 * Falling back to a bundled copy would silently answer a different question on a
 * project pinned to an older TypeScript — a different overload resolution, a
 * different lib set, a different set of assignability answers. So the project's copy
 * wins, then its parents (a workspace package usually has no `typescript` of its own,
 * it is hoisted to the repository root), then TS_MODULE_PATH when the harness has
 * already located one, then ours as the last resort.
 *
 * ── WHY THAT PREFERENCE NEEDS A GUARD ───────────────────────────────────────
 * TypeScript 7 is the native port, and its npm package does not carry the JavaScript
 * compiler API at all. It exports exactly two things:
 *
 *     $ node -e "const ts=require('typescript'); console.log(ts.version,
 *                Object.keys(ts).join(','))"
 *     7.0.2  version,versionMajorMinor
 *
 * `sys`, `createProgram`, `findConfigFile` and `parseJsonConfigFileContent` are all
 * `undefined`. Preferring the project's compiler — which is right — therefore turns a
 * project pinned to the current major into a `TypeError: Cannot read properties of
 * undefined (reading 'fileExists')` on the first property access, after a solve that
 * can take a thousand seconds. See issue #239.
 *
 * A missing measurement must not read as a passing one, and it must not read as a
 * crash either: a reader who sees a stack trace goes looking for the bug in the
 * oracle. So the API surface is checked up front and the refusal names the version,
 * the path it came from, and what is actually missing.
 *
 * ── WHY THIS IS A MODULE AND NOT A FUNCTION IN EACH ENTRY POINT ─────────────
 * It was a function in each entry point — three byte-identical copies across
 * tsc-oracle, tsc-envelope and lib-files, with two more tools reaching the compiler
 * by a bare `import ts from 'typescript'`. A guard that lives in one of five places
 * is not a guard; the next crash just moves to whichever entry point nobody edited.
 * tools/api-surface-lint.mjs fails the suite if a new `.mjs` here loads the compiler
 * without coming through this.
 */
import * as path from 'node:path';
import { createRequire } from 'node:module';

/**
 * The API this stack actually uses. Checked by presence rather than by version number
 * so that a future major which restores these keeps working, and a backport which
 * removes one is caught rather than being assumed fine because its version looks old.
 */
const REQUIRED = [
  'sys',
  'createProgram',
  'findConfigFile',
  'readConfigFile',
  'parseJsonConfigFileContent',
  'SyntaxKind',
];

/** Exit code for "there is no ground truth to be had here", distinct from a crash. */
export const EXIT_UNSUPPORTED_COMPILER = 4;

/**
 * @param {string} projectDir the project being analysed; its compiler is preferred.
 * @param {{ toolName?: string }} [opts]
 * @returns the TypeScript module, guaranteed to carry the API above.
 */
export function loadTypeScript(projectDir, opts = {}) {
  const toolName = opts.toolName ?? path.basename(process.argv[1] ?? 'oracle');
  let from = '(bundled)';
  let ts;

  const envPath = process.env.TS_MODULE_PATH;
  if (envPath) {
    try {
      ts = createRequire(import.meta.url)(envPath);
      from = envPath;
    } catch { /* fall through */ }
  }
  if (!ts && projectDir) {
    for (const base of [projectDir, path.dirname(projectDir), path.dirname(path.dirname(projectDir))]) {
      try {
        const req = createRequire(path.join(base, 'package.json'));
        ts = req('typescript');
        from = req.resolve('typescript');
        break;
      } catch { /* next */ }
    }
  }
  if (!ts) {
    const req = createRequire(import.meta.url);
    ts = req('typescript');
    try { from = req.resolve('typescript'); } catch { /* keep the placeholder */ }
  }

  const missing = REQUIRED.filter((k) => ts[k] === undefined);
  if (missing.length) {
    const version = ts.version ?? '(no version field)';
    console.error(
      `${toolName}: this project's TypeScript is ${version}, whose API this oracle does not speak.\n` +
      `  loaded from   ${from}\n` +
      `  missing       ${missing.join(', ')}\n` +
      '  TypeScript 7 is the native port and its npm package does not ship the JavaScript\n' +
      '  compiler API, so there is no ground truth to be had from it. This is a REFUSAL,\n' +
      '  not a crash: the project is unmeasurable by this harness, which is a fact about\n' +
      '  the pinned compiler and not a score. Pin a 5.x/6.x TypeScript for the analysed\n' +
      '  copy, or record the project as blocked with this reason.'
    );
    process.exit(EXIT_UNSUPPORTED_COMPILER);
  }
  return ts;
}
