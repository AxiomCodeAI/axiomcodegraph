import { JS_SOURCE_EXTENSIONS } from '@/constants/javascript-constants';

/**
 * What counts as a platform module, in one place.
 *
 * ## Three copies of this list was the real risk
 *
 * `js-module-edge-extractor` used it to decide
 * `resolutionOutcome = RESOLVED_BUILTIN`, `js-expression-extractor` to decide
 * `receiverTypeSource = NODE_BUILTIN`, and `js-ir-completeness` reads the
 * results of both. They were byte-identical when this was extracted — checked,
 * not assumed — and nothing would have reported it if one had gained an entry
 * and the others had not.
 *
 * The failure that drift produces is not a missing row. It is a call site
 * saying `AMBIENT_BUILTIN_TARGET` while its own import row says
 * `RESOLVED_EXTERNAL`: two relations disagreeing about the same edge, both
 * populated, both plausible.
 *
 * ## Why the list decides something that matters
 *
 * **24.4% of the oracle's own declines** are calls whose receiver came from a
 * Node builtin with no ambient declarations. That is the single largest
 * environmental class in JavaScript — larger than missing `node_modules`, which
 * is 1.5% — and `js-oracle` classifies it as *environmental but unfixable*:
 * nothing installable in the repository under analysis supplies those
 * declarations.
 *
 * So the list is not a convenience. It is what separates "the engine should look
 * in `lib_*`" from "this package was not installed", and those are different
 * instructions to a consumer.
 *
 * ## Recognised by NAME, never resolved
 *
 * Resolving `path` needs `@types/node` present, and its **absence is the
 * measured condition** — `js-oracle` moved one web framework from 12.9% to 21.9% resolved
 * by forcing `types: ["node"]`. A parser whose classification depends on whether
 * someone installed a types package reports a property of the machine.
 */

/**
 * Node's own modules, as of Node 22.
 *
 * Deliberately a closed list rather than a pattern. A new builtin is a Node
 * release, which is a decision someone should make explicitly — and a pattern
 * loose enough to catch future builtins is loose enough to catch an npm package
 * named `fsx`.
 */
const NODE_BUILTIN_MODULES: ReadonlySet<string> = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os',
  'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url',
  'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * Is this specifier a Node builtin?
 *
 * Handles both spellings and the subpath form: `node:fs`, `fs`, and
 * `fs/promises` are all the same module for this purpose, because the
 * declarations that are missing are missing for all three.
 */
export function isNodeBuiltinSpecifier(specifier: string): boolean {
  if (specifier.startsWith('node:')) {
    return true;
  }
  return NODE_BUILTIN_MODULES.has(specifier.split('/')[0] ?? specifier);
}

/** The set itself, for a caller that needs to enumerate rather than test. */
export function nodeBuiltinModules(): ReadonlySet<string> {
  return NODE_BUILTIN_MODULES;
}

/**
 * A relative specifier: `./x`, `../x`.
 *
 * Worth its own predicate because its failure mode is the opposite of every
 * other specifier's. A bare package specifier that does not resolve is environmental —
 * the package is not installed. **A relative path that does not resolve is a
 * real broken edge**, and `js-oracle` measured three of them where it had first
 * reported zero. A consumer that cannot tell the two apart classifies a genuine
 * defect as a checkout property.
 */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The JavaScript extension a file name carries, ignoring a `.flow` suffix.
 *
 * ## `path.extname` returns the LAST part, and JavaScript is full of names with more
 *
 * This is the general form of a trap that has now bitten four different call
 * sites. `path.extname('a.js.flow')` is `.flow` — not `.js` — so:
 *
 * - the project walker tested `JS_SOURCE_EXTENSIONS.includes(extname(name))` and
 *   **never discovered a single Flow declaration file**, which made the
 *   extension half of the Flow detector unreachable code that read as supported;
 * - `package-json-resolver` tests `extname === '.mjs' || '.cjs'`, so
 *   `a.cjs.flow` misses the module-system override that `.cjs` is supposed to
 *   make TOTAL;
 * - `stemOf` and `stripExtension` both cut at the last dot, so `a.js.flow`
 *   produced `name = "a.js"` and `qualifiedName = "a.js"` — a name column
 *   carrying an extension.
 *
 * And fixing `.js.flow` by NAME rather than by class left the same hole one
 * layer out: `b.cjs.flow` was still never discovered, because the list held the
 * literal string `.js.flow` and nothing else. Flow's convention is
 * `<name>.<ext>.flow` shadowing `<name>.<ext>`, so `.cjs.flow`, `.mjs.flow` and
 * `.jsx.flow` are all legal and all were invisible.
 *
 * So the question every site actually wants to ask is this one: **what is this
 * file's JavaScript extension**, with a `.flow` suffix stripped first. One
 * function, and the multi-part handling happens once.
 */
export function jsExtensionOf(fileName: string): string {
  const name = fileName.toLowerCase();
  const base = name.endsWith('.flow') ? name.slice(0, -'.flow'.length) : name;
  const dot = base.lastIndexOf('.');
  const extension = dot < 0 ? '' : base.slice(dot);
  // A JAVASCRIPT extension or nothing, because that is what the name promises.
  //
  // It first returned whatever the last part was, which made
  // `stripJsExtension('a.ts')` return `a` — cutting an extension off a file that
  // has no JavaScript extension to cut. Caught by this util's own behaviour
  // table, which is the argument for having written one: the function was in use
  // at eight call sites and every one of them happened to pass a `.js` family
  // name, so nothing else would ever have shown it.
  return (JS_SOURCE_EXTENSIONS as readonly string[]).includes(extension) ? extension : '';
}

/**
 * Is this file name JavaScript source the analyzer walks?
 *
 * Includes Flow declaration files, which are walked in order to be DECLINED —
 * a recorded rejection rather than a silent absence. See {@link jsExtensionOf}
 * for why this cannot be `path.extname`.
 */
export function isJavaScriptSourceFile(fileName: string): boolean {
  return jsExtensionOf(fileName) !== '';
}

/**
 * Is this a Flow DECLARATION file, by name alone?
 *
 * `<name>.<ext>.flow` — Flow's convention for a file that declares the types of
 * the sibling it shadows. The name is the declaration, so these commonly carry
 * no `@flow` pragma at all and the extension is the only signal.
 */
export function isFlowDeclarationFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.flow')
    && isJavaScriptSourceFile(fileName);
}

/**
 * The file name with its JavaScript extension removed, `.flow` included.
 *
 * `a.js` and `a.js.flow` both stem to `a`. Cutting at the last dot gave `a.js`
 * for the second, putting an extension inside a `name` column.
 */
export function stripJsExtension(fileName: string): string {
  const extension = jsExtensionOf(fileName);
  if (extension === '') {
    return fileName;
  }
  const lower = fileName.toLowerCase();
  const cut = lower.endsWith('.flow')
    ? lower.length - '.flow'.length - extension.length
    : lower.length - extension.length;
  return fileName.slice(0, cut);
}
