/**
 * JAVASCRIPT TESTS — one file, mirroring `typescript-tests.ts` and
 * `python-tests.ts`.
 *
 *     npx tsx src/test/javascript-tests.ts            # everything
 *     npx tsx src/test/javascript-tests.ts --list     # what runs, and what it proves
 *
 * NO `ts.Program`, NO `TypeChecker`, NO NETWORK. Deciding what an expectation
 * SHOULD be needs a Program, a checker and the pinned `typescript@6.0.3`; that
 * lives in `../parser-oracle/javascript`. This file can DETECT drift and cannot
 * AUTHORISE it — a suite that can rewrite its own expectations has a failure
 * mode indistinguishable from success: red, re-bless, green, with the defect now
 * recorded as intended and every later fix reading as a regression.
 *
 * ## Why the corpus is written into a temp directory by the suite itself
 *
 * `src/test-data/javascript/` belongs to `js-fixtures`, and a durable regression
 * corpus is that agent's deliverable. What the gates below need is different and
 * smaller: inputs whose *shape* the check is about, so the check can be made to
 * fail on purpose. Those are written here, next to the assertion they serve, and
 * they are scaffolding rather than fixtures. When `src/test-data/javascript/`
 * exists the suite extracts it too and runs every structural gate over it.
 *
 * ## The meta-rule, applied
 *
 * §11 of `BUILDING-A-PARSER.md`: *before trusting a null result, make the check
 * produce a non-null one on purpose.* Three of the most expensive errors in this
 * repository were checks incapable of returning anything but "clean". So the
 * integrity gate has a paired negative case that corrupts a copy of the output
 * and asserts the gate rejects it, and every per-file assertion is paired with a
 * non-vacuity assertion that the corpus actually exercises it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as ts from 'typescript';

import {
  JAVASCRIPT_CSV_FILES, JS_SKIP_DIRECTORIES, JS_SOURCE_EXTENSIONS,
} from '@/constants/javascript-constants';
import {
  isFlowDeclarationFileName, isJavaScriptSourceFile, jsExtensionOf, stripJsExtension,
} from '@/utils/javascript';
import { formatCompleteness } from '@/parsers/javascript/extractors/js-ir-completeness';
import * as JsEnums from '@/enums/javascript';
import { RESERVED_CALL_KINDS } from '@/enums/javascript/call-sites';
import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';

/** The regime token the parser must stamp. Coarse on purpose (schema §3.1 c17). */
const EMISSION_REGIME = 'js-ts6-inproc';
const COMPILER_VERSION = '6.0.3';

/** `js-fixtures`' corpus, extracted too when it exists. */
const FIXTURES = 'src/test-data/javascript';

/**
 * An extra corpus to run every structural gate over.
 *
 *     npx tsx src/test/javascript-tests.ts --corpus ../some-repo
 *
 * The scaffold is chosen for SHAPE and is deliberately tiny, so it cannot say
 * whether an invariant survives scale. Pointing this at real code is how
 * `js-corpus` runs the same assertions over a sweep, and how a defect found on a
 * corpus becomes reproducible here rather than described in prose.
 *
 * `node_modules` is NOT skipped for this corpus, because a caller pointing at it
 * deliberately means it. The project walk still excludes it everywhere else, for
 * the provenance reason that has nothing to do with scale.
 */
/**
 * Every scratch directory this run created, so the run can delete them.
 *
 * ## Nine `mkdtempSync` calls and no cleanup, which cost 72 GiB
 *
 * A corpus run writes a full fact base — over a gigabyte for `js_expression`
 * alone — and does it FOUR times: the scaffold twice for determinism, the
 * fixtures once, the corpus twice. None of it was ever removed, so every
 * invocation left several gigabytes in the system temp directory, and after
 * enough runs the machine ran out of disk mid-compile with
 * `ENOSPC: no space left on device` — a failure that names the compiler and not
 * the cause.
 *
 * The irony is exact: this suite exists to catch a parser that leaks rows, and
 * it was leaking gigabytes. Registered centrally and removed in a `finally`, so
 * a check that throws cannot skip the cleanup.
 */
const scratchDirectories: string[] = [];


/**
 * Every scratch prefix carries THIS PROCESS'S PID, so a concurrent run's scratch
 * is distinguishable by name rather than by guessing from timestamps.
 *
 * The ownership check first used birthtime — "created after I started" — and a
 * corpus sweep running in parallel created directories continuously, every one
 * of them newer than this process and registered in the OTHER process. 32/33,
 * transiently, on a machine doing two things at once — which is exactly the
 * "fails on a colleague's machine for reasons unrelated to the parser" a shipped
 * gate must not do.
 */
const SCRATCH_TAG = `js-gate-${process.pid}-`;

function scratchDir(prefix: string): string {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), prefix.replace(/^js-gate-/, SCRATCH_TAG)));
  scratchDirectories.push(created);
  return created;
}

/** Removes every scratch directory, reporting how much was reclaimed. */
function cleanScratch(): void {
  let removed = 0;
  for (const directory of scratchDirectories) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A directory that cannot be removed is worth neither failing nor
      // hiding — the run's verdict is about the parser, not about the disk.
      console.log(`  could not remove scratch directory ${directory}`);
    }
  }
  if (removed > 0) {
    console.log(`\ncleaned ${removed} scratch directory(ies)`);
  }
}

/**
 * Sweeps scratch directories left by runs that did not get to their `finally`.
 *
 * Cleanup is in-process, so a run the OS kills — twice now, for memory, mid
 * corpus — leaks its whole set: 27 directories and ~5 GiB the second time. The
 * registry cannot close that, because the process that owned the entries is
 * gone. What can is the PID in every prefix: a directory tagged with a PID that
 * is no longer running belongs to nobody. Untagged directories from before the
 * tag existed are removed on age alone, at a bound no run approaches. A live
 * concurrent run's scratch is never touched — its PID answers.
 */
const LEGACY_SCRATCH_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function sweepOrphanedScratch(): void {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the process exists and is not ours; only ESRCH means gone.
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  let removed = 0;
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith('js-gate-')) {
      continue;
    }
    const tagged = /^js-gate-(\d+)-/.exec(entry);
    const full = path.join(os.tmpdir(), entry);
    let orphaned: boolean;
    if (tagged !== null) {
      orphaned = Number(tagged[1]) !== process.pid && !alive(Number(tagged[1]));
    } else {
      let age = 0;
      try {
        age = Date.now() - fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      orphaned = age > LEGACY_SCRATCH_MAX_AGE_MS;
    }
    if (!orphaned) {
      continue;
    }
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Not this run's verdict.
    }
  }
  if (removed > 0) {
    console.log(`swept ${removed} orphaned scratch directory(ies) left by runs that did not finish`);
  }
}

function extraCorpusArgument(): string | undefined {
  const index = process.argv.indexOf('--corpus');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * `devOnly`: a SWEEP over a corpus, not a gate. Absent from the no-argument run
 * entirely — not listed, not counted — and run only when `--corpus` names a
 * directory, where a missing directory FAILS. A check that printed NOT
 * REQUESTED and passed when its input was absent was a gate that loses its
 * input and keeps passing, sitting in the default path.
 *
 * THE RULE THIS GENERALISES TO, because it outlives these two checks:
 *
 *   NO CHECK MAY REPORT PASS WITHOUT HAVING EVALUATED ITS ASSERTION.
 *
 * A check whose input is absent is NOT-RUN, and not-run is reported separately
 * from passed and never summed with it. The two are indistinguishable to a
 * reader of a total, which is the whole problem: "34/34 passed" and "32/32
 * passed, 2 not run" are different claims, and the first one is false when two
 * checks never looked at anything.
 *
 * This is the same failure as a residual bucket nobody interrogates and a null
 * result nobody baits — a number that is large, stable, and produced by
 * machinery that did not do the work. It has now been caught six times in this
 * project, in six different disguises.
 */
interface Check {
  name: string; proves: string; run: () => number | Promise<number>; devOnly?: true;
}
const fail = (m: string): number => { console.log('  ' + m); return 1; };

/**
 * Checks that cannot run until something they depend on exists.
 *
 * A skipped check that prints nothing is indistinguishable from a passing one,
 * so the count is ratcheted: it may FALL and never RISE, and the commit that
 * lowers it is the commit that earns it.
 *
 * **At its floor.** It was 1 while `js-fixtures` had not landed a corpus; that
 * corpus now exists and the check runs, so the bar is 0 and every check in this
 * file is live. The rule from §11 is that a bar at its floor gets deleted and
 * the invariant asserted directly — this one stays, because the invariant IS
 * that nothing is pending, and a bar of 0 states it more loudly than its absence
 * would.
 */
const PENDING_BAR = 0;
let pending = 0;
const pendingNames: string[] = [];
function pendingCheck(name: string, why: string): number {
  pending += 1;
  pendingNames.push(name);
  console.log(`  PENDING — ${why}`);
  return 0;
}

// ---------------------------------------------------------------------------
// the corpus the gates run over
// ---------------------------------------------------------------------------

/**
 * Inputs chosen for the SHAPE each gate is about, not for coverage.
 *
 * Every entry is here because some gate below would be vacuous without it.
 * `esm-in-cjs/app.js` exists so the module-system coherence gate has a
 * contradicting file to find; `esm/legacy.cjs` and `cjs/modern.mjs` exist so the
 * extension-override assertion is exercised in BOTH directions; `deep/a/b/c/`
 * exists so the nearest-ancestor walk has more than one level to get wrong.
 */
const SCAFFOLD: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{"name":"scaffold-root"}\n'],

  // CommonJS, prototype-era: the model TypeScript's schema has no spelling for.
  ['cjs/router.js', [
    "'use strict';",
    "const framework = require('some-framework');",
    "const { Router, json } = require('some-framework');",
    'function Foo(name) { this.name = name; }',
    'Foo.prototype.greet = function () { return this.name; };',
    'Foo.staticHelper = function () { return 1; };',
    'module.exports = Foo;',
    '',
  ].join('\n')],

  // A require that is NOT at the top of the file. 13.6% of real ones.
  ['cjs/lazy.js', [
    'function load(flag) {',
    '  if (flag) {',
    "    const heavy = require('./heavy');",
    '    return heavy.run();',
    '  }',
    '  return null;',
    '}',
    'module.exports = { load };',
    '',
  ].join('\n')],
  ['cjs/heavy.js', 'exports.run = function () { return 42; };\n'],

  // Re-export through a require: an import and an export at once.
  ['cjs/reexport.js', "module.exports = require('./heavy');\n"],

  // Pure ESM, declared.
  ['esm/package.json', '{"name":"scaffold-esm","type":"module"}\n'],
  ['esm/client.js', [
    "import { run } from './service.js';",
    'export async function main() { return run(); }',
    '',
  ].join('\n')],
  ['esm/service.js', 'export function run() { return 1; }\n'],

  // The extension overrides the governing package.json outright, in BOTH
  // directions: the .cjs sits under "type":"module" and the .mjs does not.
  ['esm/legacy.cjs', "const x = require('./service.js');\nmodule.exports = x;\n"],
  ['cjs/modern.mjs', 'export const value = 1;\n'],

  // ESM syntax under a CommonJS config: 6.2% of real files, all bundler input.
  // Also the JSX-in-.js case, which ScriptKind.JS parses.
  ['esm-in-cjs/app.js', [
    "import Lib from 'some-ui-lib';",
    'export default function App() { return <div>{Lib.version}</div>; }',
    '',
  ].join('\n')],

  // A nearest-ancestor walk with depth to get wrong, under a package.json that
  // DECLARES CommonJS. A declared CommonJS and a defaulted one are different
  // claims — 91.4% of real files are defaulted — and a corpus with only the
  // defaulted form leaves one route through the lookup untested.
  ['deep/package.json', '{"name":"scaffold-deep","type":"commonjs"}\n'],
  ['deep/a/b/c/leaf.js', 'module.exports = 1;\n'],

  // Hoisting, in the one shape where the two scope columns DIFFER. Without a
  // `var` written inside a block, a parser emitting one scope column passes the
  // hoisting gate — which is why the gate asserts this file's existence.
  ['cjs/hoisting.js', [
    'function outer(flag) {',
    '  if (flag) {',
    '    var hoisted = 1;',
    '    let blockOnly = 2;',
    '    return blockOnly;',
    '  }',
    '  return hoisted;',
    '}',
    'module.exports = outer;',
    '',
  ].join('\n')],

  // One file per IR-completeness bucket. The buckets are not interchangeable —
  // an ambient target is a statement about the platform and an untyped receiver
  // is a statement about the code — so a corpus exercising one shape makes the
  // per-bucket report a single number wearing six labels.
  ['cjs/calls.js', [
    "const path = require('path');",      // ambient/builtin target
    "const heavy = require('./heavy');",  // import hop available
    'class Local { run() { return 1; } }',
    'function go(ops, name) {',
    '  const local = new Local();',       // same file
    '  local.run();',
    '  path.join(1, 2);',
    '  heavy.run();',
    '  ops[name](1);',                    // honestly unresolvable: computed
    "  eval('1');",                       // honestly unresolvable: dynamic code
    '  return bare();',                   // receiver untyped
    '}',
    'module.exports = go;',
    '',
  ].join('\n')],

  // A callable in ARGUMENT position — the orphan case c32 exists for. Both the
  // event-listener shape and the higher-order-function shape, because argument
  // index 1 is the most common position measured and index 0 is the other one.
  // A class field holding an arrow: ONE member described by two relations, and
  // an arrow nested in a method body, which is a member of nothing.
  // Flow, which is OUT OF SCOPE and is declined by a recorded rejection. The
  // file must produce exactly one js_module row with sourceProvenance =
  // FLOW_REJECTED and nothing else — including none of the SYNTACTIC_FLOW
  // parameter types it used to produce, which is the point of the ruling.
  //
  // A `.js.flow` sibling is present too, because that extension is Flow's
  // declaration form and frequently carries no pragma at all.
  ['cjs/flow-inline.js', [
    '// @flow',
    'function connect(host: string, port: number): boolean { return true; }',
    'class Boxed { value: string; }',
    'module.exports = { connect, Boxed };',
    '',
  ].join('\n')],

  // `.cjs.flow`, not just `.js.flow`. Adding the literal string `.js.flow` to
  // the extension list fixed ONE spelling and left the class — Flow's
  // convention is `<name>.<ext>.flow`, so this file was still undiscovered
  // after the first fix. It is here so the rule is tested as a rule.
  ['cjs/override.cjs.flow', [
    'declare export function g(): void;',
    '',
  ].join('\n')],


  // NAME REUSE, deliberately, in every index that was keyed on a name. Every
  // construct here is legal JavaScript — a bundle is exactly a module that
  // declares `Parser` twice — so the gate cannot forbid the reuse. What it
  // asserts is that each reference resolves to the declaration a reader would
  // see, which is the property six name-keyed indexes did not have.
  ['cjs/name-reuse.js', [
    "const paint = require('paint-one');",
    'function author() { return 1; }',
    'exports.author = author;',
    '',
    'function Parser() { this.a = 1; }',
    'Parser.prototype.first = function () { return 1; };',
    '',
    "const paint2 = require('paint-two');",
    // A LOCAL that shadows the import's name. It is not bound by the import,
    // and the import is not bound to it — in either direction. Resolving the
    // reverse link by name let this row claim the import: 72 wrong targets,
    // then 152 once the lookup was position-aware, because more shadows found
    // it. The join is by binding-node identity now.
    "function shadow() { const paint = { local: true }; return paint; }",
    'function Parser() { this.b = 2; }',
    'Parser.prototype.second = function () { return 2; };',
    '',
    'function author() { return 2; }',
    'exports.authorLate = author;',
    '',
    'class Pair {',
    '  static get x() { return 1; }',
    '  static set x(v) {}',
    '  get x() { return 2; }',
    '  set x(v) {}',
    '  get [paint]() { return 3; }',
    '  get [paint2]() { return 4; }',
    '}',
    'exports.Pair = Pair;',
    '',
  ].join('\n')],


  // A trailing comment after a SEPARATOR — after `,` in an array, an object
  // literal and a parameter list — with the same comment after a statement as
  // the control. The comma belongs to no node, so a walk over nodes reached
  // none of these: 2,211 of 64,157 comments over the corpus.
  ['esm/separator-comments.js', [
    'const a = 1; // after a statement',
    'const arr = [',
    '  1, // after an array element',
    '  2,',
    '];',
    'const obj = {',
    '  x: 1, // after an object property',
    '  y: 2,',
    '};',
    'function f(',
    '  p, // after a parameter',
    '  q,',
    ') { return p + q; }',
    // Directive detection is ANCHORED: the real directive beside a prose line
    // that merely contains the word followed by a space (js-fixtures' find).
    '/* eslint-disable no-console */',
    '// every eslint config resolver reads this, and it is prose',
    // After a token that is not a comma: the opening parenthesis of a call and
    // the colon of a case label. The comma was one instance of the class.
    'const g = f(/* after a parenthesis */ 1, 2);',
    'switch (a) { case 1: // after a case label',
    '  break; }',
    'export { a, arr, obj, f, g };',
    '',
  ].join('\n')],

  // All three re-export spellings side by side. `export * as ns` has a
  // NamespaceExport clause, which is neither undefined nor NamedExports, and
  // fell between the two branches: one framework's namespace re-export module
  // recorded zero exports.
  ['esm/reexport-forms.js', [
    "export * from './service.js';",
    "export { helper as renamed } from './service.js';",
    "export * as ns from './service.js';",
    // #483: the named forms are an import and an export in one statement too,
    // and each carries its import row and link, as `export *` always did.
    "export { default } from './service.js';",
    "export { default as serviceDefault } from './service.js';",
    '',
  ].join('\n')],


  // `@type` over an ASSIGNMENT to a bare identifier, at module level and in a
  // body — js-fixtures' 5h and 5k. The identifier resolves to a variable, which
  // is what the annotation is ABOUT, exactly as `this.x = …` is about the field.
  // The call statement under an @type is the control: it attaches to nothing
  // the parser can type and must stay nothing.
  ['cjs/type-over-assignment.js', [
    'const raw = {};',
    '/** @type {Banner} */',
    'let ret = raw;',
    '/** @type {Banner} */',
    "ret = JSON.parse('{}');",
    '/** @type {Banner} */',
    'raw.push(4);',
    'function insideBody() {',
    '  /** @type {Banner} */',
    '  let local = raw;',
    '  /** @type {Banner} */',
    "  local = JSON.parse('{}');",
    '  return local;',
    '}',
    // EXPRESSION owners — the owner of last resort, ruled after 396 @type
    // positions had nowhere to go. An object-literal property (no js_field:
    // an object literal is a value) and an exports-member assignment (a module
    // edge, not a declaration). Both are expression rows.
    'const lit = {',
    '  /** @type {string[]} */',
    '  items: [],',
    '};',
    '/** @type {Set<string>} */',
    'exports.ONE = new Set();',
    // The multi-declarator rule, decided by tsc: the type belongs to the FIRST
    // declarator, the second carries NONE, one row owned by the first.
    '/** @type {number} */',
    'let firstOfTwo = 1, secondOfTwo = 2;',
    // CAST — the parenthesised form only — owned by the expression the
    // parentheses wrap; and its two controls: a parenthesised INITIALISER under
    // a declaration's @type is the declaration's (VARIABLE, never CAST), and an
    // unparenthesised @type before an arrow asserts nothing to the compiler.
    'const cast = /** @type {Widget} */ (raw);',
    '/** @type {Widget} */',
    'const parenInit = (raw);',
    'const bare = [1].map(/** @type {Fn} */ (n) => n);',
    // THROWS, twice on one function, plus a control without one.
    '/**',
    ' * @param {string} s',
    ' * @throws {TypeError} when s is not a string',
    ' * @throws {RangeError} when s is empty',
    ' */',
    'function strict(s) { return s; }',
    // A cast in a PARAMETER DEFAULT. The default is visited on one path; it
    // was two (a forEachChild walk and a leftover loop after the body), and the
    // cast was the first construct in a default that nothing else deduplicated.
    'function withDefault(options = /** @type {Widget} */ ({})) { return options; }',
    'module.exports = { ret, insideBody, lit, firstOfTwo, secondOfTwo, cast, parenInit, bare, strict, withDefault };',
    '',
  ].join('\n')],


  // `@param` on a callable that is the VALUE of something else — the RHS of an
  // assignment, a variable initialiser, an object-literal property. The JSDoc
  // block is attached to the STATEMENT, not the function, and reading only the
  // function's own blocks lost every one of these while `@returns` beside them
  // kept working: 894 references in one package, found by AST recall's second
  // run. Each form here, with @returns as the control on the first.
  ['cjs/param-on-assigned-callable.js', [
    'const app = {};',
    '/**',
    ' * @param {string} ext',
    ' * @param {Function} fn',
    ' * @returns {object}',
    ' */',
    'app.engine = function engine(ext, fn) { return this; };',
    '/** @param {object} deps */',
    'const f = (deps) => {};',
    'const o = {',
    '  /** @param {number} n */',
    '  m: function (n) {},',
    '};',
    'module.exports = { app, f, o };',
    '',
  ].join('\n')],

  // The binding-path column carries the KEY route, not the local name: `wire`
  // for `{ wire: local }`. A gate that asserted "the path ends in the
  // referenced name" failed every renamed binding in the corpus and would have
  // passed a column that recorded the identifier — the exact opposite of what
  // c34 is for. Each shape, every bound name read in the body, from
  // js-fixtures' discriminators.
  ['cjs/binding-paths.js', [
    'function flat({ alpha, beta }) { return alpha + beta; }',
    "function renamed({ wire: local, 'kebab-key': kebab, 0: numeric }) { return local + kebab + numeric; }",
    'function nested({ outer: { inner } }) { return inner; }',
    'function nestedAndRenamed({ req: { body: { userId: id } } }) { return id; }',
    'function positional([first, , third]) { return first + third; }',
    'function mixed([{ name }]) { return name; }',
    'function simple(plain, withDefault = 1) { return plain + withDefault; }',
    // REST in either pattern kind (#487): the path says where the rest starts.
    'function rests({ keep, ...others }, [head, ...tail]) { return [keep, others, head, tail]; }',
    // And the same routes on VARIABLE rows, where the engine had only the local name.
    'const o = { inner: { deep: 1 }, cb: 2 };',
    'const { inner: { deep } } = o;',
    'const { cb: alias } = o;',
    'const { ...objRest } = o;',
    'const [first, ...arrRest] = [1, 2, 3];',
    'module.exports = { flat, renamed, nested, nestedAndRenamed, positional, mixed, simple, rests, deep, alias, objRest, first, arrRest };',
    '',
  ].join('\n')],

  // JSDoc type SHAPES whose kind was UNKNOWN_SYNTAX with a plausible name — the
  // classification bug no count sees, because a wrong kind is still one row.
  // A `@callback` is a signature (its `@returns` tag was the root, so the row
  // was named `@returns {number}`); `@extends {Base<T>}` is a heritage
  // expression, not a type reference node; `(A|null)` is parentheses around a
  // union (constraint 6: unwrap, or the union is never enqueued); `this` and
  // `unknown` are keywords the primitive list did not know.
  ['cjs/jsdoc-type-shapes.js', [
    '/**',
    ' * @callback Reducer',
    ' * @param {number} acc',
    ' * @param {string} item',
    ' * @returns {number}',
    ' */',
    '/**',
    ' * @typedef {Object} Shape',
    ' * @property {string} name',
    ' * @property {number} [size]',
    ' */',
    'class Base {}',
    '/** @extends {Base} */',
    'class Child extends Base {}',
    '/** @extends {Base<string>} */',
    'class Generic extends Base {}',
    '/**',
    ' * @param {(string|null)} maybe',
    ' * @param {this} self',
    ' * @param {unknown} anything',
    ' * @returns {Shape}',
    ' */',
    'function shapes(maybe, self, anything) { return { name: String(maybe) }; }',
    // The five kinds ruled in §3.14.4, one each, plus @type on a parameter
    // node (§3.14.3, PARAM — keyed on the host node, since the compiler's
    // getJSDocParameterTags returns nothing for it) and a `#x in o` brand
    // check (§3.10.1, CLASS_PRIVATE).
    "/** @typedef {import('./base.js').Base} ImportedBase */",
    "/** @type {import('./base.js')} */",
    'const wholeModule = null;',
    '/** @type {[number, string]} */',
    "const pair = [1, 'a'];",
    "/** @type {Shape['name']} */",
    "const shapeName = 'n';",
    '/** @type {typeof pair} */',
    'const again = pair;',
    '/**',
    ' * @param {*} value',
    ' * @returns {value is string}',
    ' */',
    "function isString(value) { return typeof value === 'string'; }",
    'function typedParam(/** @type {Shape} */ item) { return item; }',
    'class Sealed {',
    '  #brand = true;',
    '  static is(o) { return #brand in o; }',
    '}',
    'module.exports = { Base, Child, Generic, shapes, wholeModule, pair, shapeName, again, isString, typedParam, Sealed };',
    '',
  ].join('\n')],

  // §2.5a: every ruled tag form, plus js-fixtures' boundary case `<Foo-Bar/>`
  // (parses as an Identifier, is not a valid one, binds nothing). One element
  // per line so the assertion can key on the line.
  ['esm/tag-forms.jsx', [
    "import Foo from './foo.js';",
    'const widgets = { panel: Foo };',
    'const _Private = Foo;',
    'const $Money = Foo;',
    'const X = { y: { z: Foo } };',
    'export const forms = [',
    '  <div />,',
    '  <foo-bar />,',
    '  <Foo />,',
    '  <_Private />,',
    '  <$Money />,',
    '  <widgets.panel />,',
    '  <X.y.z />,',
    '  <svg:circle />,',
    '  <Foo-Bar />,',
    '  <>text</>,',
    '  <Foo><div /></Foo>,',
    '  <Foo {...widgets} key={X.y} />,',
    '];',
    '',
  ].join('\n')],

  // Dotted and bracketed @param forms, from js-fixtures' nested-params
  // discriminators. The parent of a dotted tag had its `{object}` REPLACED by
  // the compiler with a type literal whose text is the child tags, so its
  // declaredTypeName was the raw remaining comment; and a bracket's
  // optionality was discarded because both columns came from the code alone.
  ['cjs/jsdoc-param-forms.js', [
    '/**',
    ' * @param {object} ctx',
    ' * @param {string} ctx.model',
    ' * @param {number} ctx.version',
    ' * @param {string} [maybe]',
    ' * @param {string} [withDefault=fallback]',
    ' * @param {number} plain',
    ' */',
    'function forms(ctx, maybe, withDefault, plain) { return ctx.model + maybe + withDefault + plain; }',
    // The positional fallback must not hand `b` the tag written for `c`: a tag
    // claimed by name belongs to the parameter it names, whatever its index.
    // Two parameters typed from one tag collided the first time the tag's
    // type minted a row keyed on its position.
    '/**',
    ' * @param {string} a',
    ' * @param {number} c',
    ' */',
    'function positional(a, b, c) { return a + b + c; }',
    // THE SECOND OPTIONAL MARKER. `{T=}` is not a dialect of `[x]`; the compiler
    // parses it to a JSDocOptionalType and `isOptionalDeclaration` answers true
    // for both, as does `getTypeAtLocation` with `T | undefined`. 263 parameters
    // carry it against 647 bracketed on the development tree, and until this
    // scaffold line existed NO fixture anywhere carried one — so the branch had
    // never been exercised in either direction. `required` is the control.
    '/**',
    ' * @param {string=} postfix',
    ' * @param {string} required',
    ' */',
    'function postfixOptional(postfix, required) { return postfix + required; }',
    // And the control for the check itself: a `=` INSIDE a function type is
    // the callback's parameter's optionality, not the callback's.
    '/** @param {function(Error=, string=): void} callback */',
    'function takesCallback(callback) { return callback(null, ""); }',
    // The same parameter documented twice, prose first and typed second: the
    // compiler takes the first tag WITH a type, and so does the selection.
    '/**',
    ' * @param twice identifies the thing',
    ' * @param {number} twice',
    ' */',
    'function documentedTwice(twice) { return twice; }',
    // Two blocks above one function: the compiler types from the LAST block.
    '/**',
    ' * @param {Object} stale',
    ' */',
    '/**',
    ' * @param {Array} stale',
    ' */',
    'function twoBlocks(stale) { return stale; }',
    // An import type on a PARAMETER node of a nested method: its js_import
    // row's owner scope is the scope `enter` opens, the same scope its owner
    // method names — the parameter node itself sits in the function's scope.
    "const walker = { enter(/** @type {import('./base.js').Base} */ node) { return node; } };",
    // A destructuring declaration's @type is the PATTERN's: one tree, owned by
    // the root binding; the second name reads NONE rather than the pair's type.
    '/** @type {[string, number]} */',
    "const [first, second] = ['a', 1];",
    // An import type INSIDE a body: its js_import row is owned by the method
    // that contains the comment, not by a method the comment documents.
    'function inBody() {',
    "  /** @type {import('./base.js').Base} */",
    '  const local = null;',
    '  return local;',
    '}',
    'module.exports = { forms, positional, postfixOptional, takesCallback, documentedTwice, twoBlocks, walker, inBody, first, second };',
    '',
  ].join('\n')],

  // ONE COMMENT, ONE TREE. js-corpus' holdout found a `@type {import('x').T}`
  // on a variable whose initializer contains nested function DECLARATIONS minted
  // once PER DECLARATION — 4 duplicate js_import keys, the first PK collision any
  // tree has produced. js_import's key carries no host, so it collided and was
  // seen. js_type_reference's key carries `ownerLinkHash`, so the same
  // re-hosting produces DISTINCT keys and the PK gate stays silent while the
  // fact base double-counts. This file is the shape; the check below is the one
  // that can see it there.
  ['cjs/jsdoc-import-type-rehosted.js', [
    "/** @type {import('./base.js').Base} */",
    'const controller = {',
    '  handle() {',
    '    function nested() { return 1; }',
    '    return nested();',
    '  },',
    '  other() {',
    '    function alsoNested() { return 2; }',
    '    return alsoNested();',
    '  },',
    '};',
    // The control: an initializer with a function EXPRESSION and no declaration,
    // which js-corpus measured at exactly one row. Without it a passing check
    // cannot distinguish "not re-hosted" from "nothing here to re-host".
    "/** @type {import('./base.js').Base} */",
    'const expressionOnly = { handle: function () { return 3; } };',
    'module.exports = { controller, expressionOnly };',
    '',
  ].join('\n')],

  // A comment re-hosted DOWNWARD: one @type over an initializer that nests a
  // function declaration, a class declaration, a named function expression
  // and a catch clause. Each nested name is a binding, and the walk to its
  // owning declaration climbed past its own declarator to `controller`'s —
  // taking the @type (one js_type_reference per nested declaration, the
  // held-back corpus's first duplicate js_import key), the initialiser and
  // the binding form. The function-expression control shows where to stop.
  ['cjs/rehosted-comment.js', [
    "/** @type {import('./x.js').Controller} */",
    'const controller = {',
    '  query(frame) {',
    '    function inner(prop) { return prop; }',
    '    class Local {}',
    '    const named = function g() { return g; };',
    '    try { return inner(frame); } catch (err) { return [Local, named, err]; }',
    '  },',
    '};',
    'module.exports = { controller };',
    '',
  ].join('\n')],

  // TORTURE SCRIPTS — the JavaScript counterpart of Python's
  // scoping_edge_cases.py and name_mangling_edge_cases.py: dense files where
  // every line is a known trap for a hand-rolled resolver, each with the
  // outcome the language (not house style) dictates, asserted by name in
  // tortureScriptsHold. One construct per line so the assertion keys on the
  // line. No case here is decided by the checker; every one is syntax plus
  // the binder.
  ['torture/scoping.js', [
    "const outer = 'module';",                                              // 1
    'function shadow(outer = outer) {',                                    // 2  default reads the PARAMETER (TDZ at runtime), not the module
    "  const inner = 'fn';",                                               // 3
    '  if (inner) { var hoisted = 1; let blocked = 2; }',                   // 4  var hoists to the function; let stays in the block
    '  return [hoisted, outer, inner];',                                   // 5  hoisted resolves LOCAL; blocked would not
    '}',                                                                   // 6
    'const named = function self() { return self; };',                     // 7  self is bound INSIDE the expression only
    'const cbs = [];',                                                     // 8
    'for (let i = 0; i < 2; i++) { cbs.push(() => i); }',                  // 9  i captured per iteration: CLOSURE from the arrow
    'for (var j = 0; j < 2; j++) { cbs.push(function () { return j; }); }', // 10 j is module-level var; CLOSURE from the function
    'try { throw 1; } catch (caught) { cbs.push(caught); }',               // 11 caught is a CATCH-scoped binding
    'class Late { static make() { return new Late(); } }',                 // 12 the class name resolves from inside its own body
    'function useBefore() { return declaredAfter; }',                      // 13 hoisted function reference resolves to line 14
    'function declaredAfter() { return 1; }',                              // 14
    'const paint = { paint: 1 };',                                         // 15 a property key is not a reference
    'const alsoOuter = outer;',                                            // 16 MODULE, links line 1
    'module.exports = { shadow, named, cbs, Late, useBefore, paint, alsoOuter, self: typeof self };', // 17 self is UNRESOLVED_FREE out here
    'const rebound = function rebound() {',                                 // 18 the expression's own name ...
    '  const rebound = 1; return rebound; };',                              // 19 ... is shadowed by a const in the body (#682)
    'const shadowed = function shadowed(shadowed) { return shadowed; };',  // 20 ... and by a parameter of the same name
    '',
  ].join('\n')],

  ['torture/module-edges.cjs', [
    "const fs = require('fs');",                                           // 1  builtin, top level
    "const { readFile: read, join } = require('path');",                   // 2  destructured with a rename: importedName readFile, localName read
    'function lazy(flag) {',                                               // 3
    "  if (flag) { return require('./late.js'); }",                        // 4  NOT top level, conditional
    "  return require(flag ? './a.js' : './b.js');",                       // 5  NON_LITERAL specifier
    '}',                                                                   // 6
    'exports.first = 1;',                                                  // 7  overwritten by line 9
    "exports.second = require('./second.js');",                            // 8  an import that is also an export member
    "module.exports = require('./whole.js');",                             // 9  re-export; overwrites 7 and 8
    "const dyn = import('./dyn.mjs');",                                    // 10 dynamic import in expression position
    'module.exports.extra = lazy;',                                        // 11 a member after the overwrite
    '',
  ].join('\n')],

  ['torture/prototypes.js', [
    "const util = require('util');",                                       // 1
    'function Legacy(name) { this.name = name; }',                         // 2  a constructor function: a js_type by assignment-declared members
    'Legacy.prototype.greet = function () { return this.name; };',         // 3  PROTOTYPE_ASSIGNMENT method, owner Legacy
    'Legacy.create = function () { return new Legacy(); };',               // 4  STATIC_ASSIGNMENT
    'Object.assign(Legacy.prototype, { wave() { return 1; } });',          // 5  OBJECT_ASSIGN_PROTOTYPE
    "Object.defineProperty(Legacy.prototype, 'label', { get() { return 'L'; } });", // 6 OBJECT_DEFINE_PROPERTY getter
    'function Child() { Legacy.call(this, "child"); }',                    // 7  the receiver moved into an argument: FUNCTION_CALL_CALL
    'util.inherits(Child, Legacy);',                                       // 8  UTIL_INHERITS heritage edge
    'function Other() {}',                                                 // 9
    'Other.prototype = Object.create(Legacy.prototype);',                  // 10 OBJECT_CREATE_PROTOTYPE heritage edge
    'class Modern extends Legacy {',                                       // 11 EXTENDS_CLAUSE
    '  #secret = 1;',                                                      // 12
    '  static { Modern.ready = true; }',                                   // 13 a static block: its own scope and block kind
    '  get secret() { return this.#secret; }',                             // 14 GETTER
    '  static is(o) { return #secret in o; }',                             // 15 CLASS_PRIVATE brand check
    '}',                                                                   // 16
    'function Guarded() { if (!new.target) { throw new Error("call with new"); } }', // 17 META_PROPERTY
    'module.exports = { Legacy, Child, Other, Modern, Guarded };',         // 18
    // #479: a dotted superclass is bound through its ROOT, not its last
    // segment — `{ Base }` from one module and `ns` from another share a
    // last segment and must not be confused; a mixin call and a parenthesised
    // name each keep their expression link; parentheses are not computation.
    "const { Base } = require('./base2');",                                 // 19
    "const ns = require('./lib/base');",                                    // 20
    'class Dotted extends ns.Base {}',                                      // 21 import link -> ns, superTypeName Base
    'const Mixin = (Sup) => class extends Sup {};',                         // 22 Sup is a parameter: no import, expression linked
    'class Mixed extends Mixin(Base) {}',                                   // 23 computed, expression linked
    'class Wrapped extends (Base) {}',                                      // 24 parentheses: NOT computed, name Base
    // #706: a member declared by one LINK of a chained assignment. The value is
    // the innermost right-hand side, declared under every member-form target;
    // a callable has one method row (the first member link) and a field row
    // under every further member name.
    'const Chained = function () {};',                                      // 25 a constructor function
    'Chained.api = Chained.prototype = { each() { return 1; } };',          // 26 static field api, prototype literal method each
    'Chained.mixin = Chained.api.mixin = function () { return 2; };',       // 27 static method mixin
    'Chained.both = Chained.prototype.both = function () { return 3; };',   // 28 static method both, prototype field both
    'Chained.prototype.run = Chained.prototype.alias = function () {};',    // 29 prototype method run, prototype field alias
    '',
  ].join('\n')],

  ['torture/call-forms.js', [
    'const obj = { m() { return 1; }, k: "m" };',                          // 1
    'const maybe = null;',                                                 // 2
    'function plain() { return 1; }',                                      // 3
    'plain();',                                                            // 4  FUNCTION_CALL, SAME_FILE_RESOLVED
    'obj.m();',                                                            // 5  METHOD_CALL
    'obj[obj.k]();',                                                       // 6  COMPUTED_CALL: the name is not fixed by syntax
    'maybe?.();',                                                          // 7  OPTIONAL_CALL on a bare optional call
    'obj?.m?.();',                                                         // 8  OPTIONAL_CALL through a member
    'obj?.[obj.k]?.();',                                                   // 9  COMPUTED shape wins over optional (ruled)
    'new plain();',                                                        // 10 CONSTRUCTOR_CALL
    '(function () { return 2; })();',                                      // 11 IIFE_CALL, parenthesised
    '(() => 3)();',                                                        // 12 IIFE_CALL, arrow
    '!function () { return 4; }();',                                       // 13 IIFE_CALL under a unary operator
    'plain.call(obj);',                                                    // 14 FUNCTION_CALL_CALL: receiver in argument position
    'plain.apply(obj, []);',                                               // 15 FUNCTION_CALL_APPLY
    'const bound = plain.bind(obj);',                                      // 16 FUNCTION_CALL_BIND: produces, does not invoke
    'String.raw`x${plain()}`;',                                            // 17 TAGGED_TEMPLATE_CALL, with a call in the substitution
    "eval('1');",                                                          // 18 DYNAMIC_CODE_CALL
    "const later = import('./x.js');",                                     // 19 DYNAMIC_IMPORT_CALL
    'class Base { constructor() { this.x = 1; } m() { return 0; } }',      // 20
    'class Sub extends Base { constructor() { super(); super.m(); } }',    // 21 SUPER_CALL and a super member call
    'module.exports = { obj, bound, later, Sub };',                        // 22
    '',
  ].join('\n')],

  // #176: a NAMED declaration exported as the default is exported under
  // `default`, with its local name beside it — the default modifier decides,
  // not whether the declaration has a name. The named export is the control.
  ['esm/default-named.js', [
    'export default function named() { return 1; }',
    'export function plain() { return 2; }',
    '',
  ].join('\n')],
  ['esm/default-class.js', [
    'export default class Klass { run() { return 1; } }',
    '',
  ].join('\n')],
  // The ANONYMOUS default class (engine #484): no name to look a target up
  // by, so the target is the declaration itself, by node identity.
  ['esm/default-anon.js', [
    'export default class { run() { return 1; } }',
    '',
  ].join('\n')],

  ['cjs/typed-module.js.flow', [
    'declare export function connect(host: string, port: number): boolean;',
    '',
  ].join('\n')],

  ['cjs/class-fields.js', [
    'class Widget {',
    "  /** @type {string} */",
    "  label = 'hi';",
    '  handleClick = () => { return this.label; };',
    '  render() { return [1].map((n) => n + 1); }',
    // An accessor pair whose @type sits on the SECOND accessor: one field row,
    // minted at the getter, typed by the setter's tag.
    '  get size() { return this._size; }',
    '  /** @type {number} */',
    '  set size(v) { this._size = v; }',
    '}',
    'module.exports = Widget;',
    '',
  ].join('\n')],

  ['cjs/callbacks.js', [
    "const EventEmitter = require('events');",
    'const emitter = new EventEmitter();',
    "emitter.on('data', (chunk) => handle(chunk));",
    "emitter.once('end', function onEnd() { finish(); });",
    'const doubled = items.map(function (x) { return x * 2; });',
    'setTimeout(() => tick(), 100);',
    'module.exports = { emitter, doubled };',
    '',
  ].join('\n')],

  // `await` inside an async ARROW is not top-level. The arrow is the case a
  // `this`-scope predicate gets wrong, because an arrow does not rebind `this`
  // and does end the top level — 33 of 816 real files reported a top-level
  // await they do not have when the two questions were answered by one
  // function.
  ['cjs/await-shapes.js', [
    'const later = async () => {',
    '  await Promise.resolve(1);',
    '};',
    'async function named() {',
    '  await Promise.resolve(2);',
    '}',
    'module.exports = { later, named };',
    '',
  ].join('\n')],
  ['esm/top-await.mjs', [
    "import { run } from './service.js';",
    'const value = await run();',
    'export default value;',
    '',
  ].join('\n')],

  // Three shapes the empty-column gate asked for by name, each the only way a
  // column gets populated at all: a `with` body (no name in it is statically
  // resolvable), a `writable: false` descriptor (the only readonly a JavaScript
  // member can have).
  //
  // NO `@flow` PRAGMA HERE, and that is a lesson rather than an omission. It
  // carried one, and when Flow was ruled out of scope this whole file was
  // declined — taking `with`, `Object.defineProperty` and the constructor
  // function with it, because one of the four constructs in it was the pragma.
  // `js_scope.hasWithStatement` went to zero across the entire corpus and the
  // empty-column gate failed by name. A fixture that bundles unrelated shapes
  // loses all of them the day any one becomes excluded; the pragma has its own
  // file.
  ['cjs/edge-shapes.js', [
    'function Legacy() { this.value = 1; }',
    "Object.defineProperty(Legacy.prototype, 'frozen', {",
    '  get: function () { return this.value; },',
    '  writable: false',
    '});',
    'function lookup(obj) {',
    '  with (obj) {',
    '    return name;',
    '  }',
    '}',
    'module.exports = { Legacy, lookup };',
    '',
  ].join('\n')],

  // Bundled output: LABELLED and emitted in full (§3.1.1) — the column is the
  // filter, and denominators exclude by it.
  ['vendor/thing.min.js', `var a=1;${'var b=2;'.repeat(900)}\n`],
  // `esm` and `umd` name a module format, not a build product: hand-written,
  // PROJECT. `min` and `bundle` name what a tool wrote.
  ['esm/index.esm.js', 'export const format = "esm";\n'],
  ['esm/Widget.umd.js', "import { a } from './index.esm.js';\nexport default a;\n"],
  // Length is never the only signal. One 6,000-character regex LITERAL in a
  // hand-written file is excused; the same long line beside a sourceMappingURL
  // footer is a minified bundle.
  ['cjs/long-literal.js', `const WHITELIST = /^(${'[a-z]'.repeat(1_500)})$/;\nmodule.exports = { WHITELIST };\n`],
  ['cjs/compiled.js', `var a=1;${'var b=2;'.repeat(900)}\n//# sourceMappingURL=compiled.js.map\n`],
  // The `@import` JSDoc tag (#621): the three binding shapes, the older
  // `@typedef {import(...)}` spelling beside them as the control, and a
  // `@param` through each name. Every row is comment-borne and type-only.
  ['cjs/jsdoc-import-tag.js', [
    '/** @import Template from "./router" */',
    '/** @import { Router, Route as Alias } from "./router" */',
    '/** @import * as NS from "./router" */',
    '/** @typedef {import("./router").Router} RouterAlias */',
    '/** @param {Template} t */',
    'function viaDefault(t) { return t.render(); }',
    '/** @param {Router} r */',
    'function viaNamed(r) { return r.handle(); }',
    '/** @param {Alias} a */',
    'function viaRenamed(a) { return a.run(); }',
    '/** @param {RouterAlias} r */',
    'function viaTypedef(r) { return r.handle(); }',
    'module.exports = { viaDefault, viaNamed, viaRenamed, viaTypedef };',
    '',
  ].join('\n')],
  // An object typedef with @property members and an inline object type (#651):
  // the child rows carry the member NAME, a nested `a.b` name as written, and
  // every non-member node carries none.
  ['cjs/object-typedef.js', [
    '/**',
    ' * @typedef {Object} State',
    ' * @property {Router} module',
    ' * @property {string} source',
    ' * @property {number} opts.depth',
    ' */',
    '/** @param {{ router: Router, tags: string[] }} opts */',
    'function inline(opts) { return opts.router; }',
    '/** @param {State} s */',
    'function typed(s) { return s.module; }',
    '/** @param {function(Router, string=): boolean} keep */',           // #691: param:0, param:1, return
    'function closure(keep) { return keep; }',
    '/** @param {(a, r: Router) => void} visit */',                     // an untyped first parameter has no row; r is still param:1
    'function arrow(visit) { return visit; }',
    '/** @param {function(Router)} onlyParam */',                        // one parameter, no return
    'function bare(onlyParam) { return onlyParam; }',
    "const Router = require('./router');",
    'module.exports = { inline, typed, closure, arrow, bare };',
    '',
  ].join('\n')],
  // A package declaring every entry shape (#616): `exports` as a subpath map with
  // a plain target, a pattern, a null block, a non-JavaScript target, a missing
  // target and a fallback list; `main` beside it; a scoped sibling with nested
  // conditions, `module`, and a `main` that names a directory; and a nested
  // package shipping from `dist/`, which the walk skips because this root is not
  // that package (#620), so its entry is on disk and NOT_STAGED.
  ['packages/pub/package.json', JSON.stringify({
    name: 'pub', main: 'lib/index.js',
    exports: {
      '.': './lib/index.js', './sub': './lib/sub.js', './features/*': './lib/features/*.js',
      './internal/*': null, './data': './data.json', './ghost': './lib/ghost.js',
      './either': ['./lib/missing.js', './lib/sub.js'],
    },
  }) + '\n'],
  ['packages/pub/lib/index.js', 'module.exports = { Base: class Base {}, createClient() {} };\n'],
  ['packages/pub/lib/sub.js', 'exports.subHelper = function subHelper() { return 1; };\n'],
  ['packages/pub/lib/features/a.js', 'exports.f = 1;\n'],
  ['packages/pub/data.json', '{}\n'],
  ['packages/scoped/package.json', JSON.stringify({
    name: '@scope/pkg', main: 'cjs', module: 'cjs/index.mjs',
    exports: { node: { import: './cjs/index.mjs', require: './cjs/index.js' }, default: './cjs/index.js' },
  }) + '\n'],
  ['packages/scoped/cjs/index.js', 'module.exports = {};\n'],
  ['packages/scoped/cjs/index.mjs', 'export const x = 1;\n'],
  ['packages/built/package.json', '{"name":"built","main":"dist/main.js"}\n'],
  ['packages/built/dist/main.js', 'module.exports = function built() {};\n'],
];

/**
 * Every file the analyzer is expected to treat as source: the scaffold's, plus
 * the one in the unpackaged root that exists to reach
 * `NO_PACKAGE_JSON_DEFAULT`.
 */
// THE SAME PREDICATE THE WALKER USES, not a regex that agrees with it.
//
// It was `/\.[cm]?jsx?$/`, a third spelling of "is this JavaScript" alongside
// the walker's and the detector's. Adding `.js.flow` — so a Flow declaration
// file is declined rather than silently absent — left this one behind, and the
// gate reported "21 rows for 20 JavaScript files", which reads like a
// duplicated row and was a miscounted denominator. A check that hard-codes the
// thing it is checking cannot catch the day it changes.
// The one file under a nested package's `dist/` is walked past on purpose (#620:
// only a walk ROOT's own build directory is walked), so it is not a source file
// of this scaffold and the count says so through the same list the walker uses.
const SCAFFOLD_SOURCE_COUNT =
  SCAFFOLD.filter(([p]) => isJavaScriptSourceFile(p)
    && !p.split('/').some((segment) => (JS_SKIP_DIRECTORIES as readonly string[]).includes(segment))).length + 1;

let scaffoldSummary: Awaited<ReturnType<JavaScriptProjectAnalyzer['analyze']>> | undefined;
let corpusDir = '';
let unpackagedDir = '';
let outputDir = '';
let secondOutputDir = '';
let fixtureOutputDir = '';

function writeScaffold(): string {
  const root = scratchDir('js-gate-corpus-');
  for (const [relative, contents] of SCAFFOLD) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/**
 * Extracts the scaffold twice, into two directories.
 *
 * Twice rather than once because determinism is a gate and the only honest way
 * to check it is to do the work again. The second output is used for nothing
 * else.
 */
/**
 * A second scaffold with NO `package.json` anywhere above it.
 *
 * `NO_PACKAGE_JSON_DEFAULT` is 15.4% of the schema's measured corpus and is
 * **structurally unreachable from inside this repository**: the repo root has a
 * `package.json`, so every fixture under `src/test-data/` resolves to it and the
 * value can never be exercised by a checked-in file. The only way to reach it is
 * a directory outside any package, which is what this writes.
 *
 * That is worth stating rather than shrugging at: a value no fixture can produce
 * is a value no gate can assert, and a gate that cannot assert it will report
 * the parser as correct whether or not it handles the 15.4% case.
 */
function writeUnpackagedScaffold(): string {
  const root = scratchDir('js-gate-nopkg-');
  fs.writeFileSync(path.join(root, 'loose-script.js'),
    'var globalish = 1;\nfunction helper() { return globalish; }\n');
  return root;
}

async function extractCorpus(): Promise<void> {
  corpusDir = writeScaffold();
  unpackagedDir = writeUnpackagedScaffold();
  outputDir = scratchDir('js-gate-out-');
  secondOutputDir = scratchDir('js-gate-out2-');
  for (const target of [outputDir, secondOutputDir]) {
    scaffoldSummary = await new JavaScriptProjectAnalyzer().analyze({
      rootDir: corpusDir,
      // The unpackaged directory joins the same fact set, which is also what
      // exercises the multi-root union on every run rather than only in the
      // check written for it.
      additionalRoots: [unpackagedDir],
      outputDir: target,
      baseMservPath: 'scaffold',
      serviceVersionLink: 'gate-v1',
    });
  }
  if (fs.existsSync(FIXTURES)) {
    fixtureOutputDir = scratchDir('js-gate-fixtures-');
    await new JavaScriptProjectAnalyzer().analyze({
      rootDir: FIXTURES,
      outputDir: fixtureOutputDir,
      baseMservPath: FIXTURES,
      serviceVersionLink: 'gate-v1',
    });
  }
  const extra = extraCorpusArgument();
  if (extra !== undefined && fs.existsSync(extra)) {
    extraCorpusDir = extra;
    extraOutputDir = scratchDir('js-gate-extra-');
    extraSecondOutputDir = scratchDir('js-gate-extra2-');
    for (const target of [extraOutputDir, extraSecondOutputDir]) {
      const summary = await new JavaScriptProjectAnalyzer().analyze({
        rootDir: extra,
        outputDir: target,
        baseMservPath: extra,
        serviceVersionLink: 'gate-v1',
        excludeDirs: ['.git', '.bin'],
      });
      extraSummary = summary;
    }
  }
}

let extraCorpusDir = '';
let extraOutputDir = '';
let extraSecondOutputDir = '';
let extraSummary: { filesAnalysed: number; extractionErrors: number;
  counts: Record<string, number> } | undefined;

/** Byte comparison in chunks: a relation can be larger than a comfortable buffer. */
function filesAreIdentical(left: string, right: string): boolean {
  if (fs.statSync(left).size !== fs.statSync(right).size) {
    return false;
  }
  const a = fs.openSync(left, 'r');
  const b = fs.openSync(right, 'r');
  try {
    const CHUNK = 1 << 20;
    const bufferA = Buffer.allocUnsafe(CHUNK);
    const bufferB = Buffer.allocUnsafe(CHUNK);
    let position = 0;
    for (;;) {
      const readA = fs.readSync(a, bufferA, 0, CHUNK, position);
      const readB = fs.readSync(b, bufferB, 0, CHUNK, position);
      if (readA !== readB) {
        return false;
      }
      if (readA <= 0) {
        return true;
      }
      if (bufferA.compare(bufferB, 0, readB, 0, readA) !== 0) {
        return false;
      }
      position += readA;
    }
  } finally {
    fs.closeSync(a);
    fs.closeSync(b);
  }
}

/**
 * Every structural invariant, over a caller-supplied corpus.
 *
 * The scaffold cannot answer whether an invariant survives scale: a duplicate
 * primary key needs two constructs that collide, and a cross-module link needs
 * two modules that reference each other. Run over `node_modules` — 816 real
 * files, 2.85M rows — this reported 0 duplicate keys, 0 dangling FKs, 0
 * cross-module links, 0 populated tier-3 columns and byte-identical output
 * across two runs.
 *
 * An **extraction error is a failure here**, not a skip. A parser that throws on
 * a file and continues must not read as a clean run, and at scale that is the
 * difference between "816 files analysed" and "816 files seen".
 */
function extraCorpusIsSound(): number {
  if (extraOutputDir === '') {
    // NOT pending. Pending means "cannot run yet" and is ratcheted because a
    // silently skipped check is indistinguishable from a passing one. This check
    // is OPTIONAL — it runs over whatever corpus a caller names — so its absence
    // is reported loudly and counted as neither. Conflating the two would make
    // the ratchet rise and fall with an invocation flag, which is exactly the
    // thing a ratchet must not do.
    return fail('DEV-ONLY check ran with no corpus. `--corpus <dir>` was given and the '
      + 'directory was not extracted — a sweep with no input is a failure, never a pass');
  }
  let failures = checkPkAndFk(extraOutputDir, 'corpus');
  if ((extraSummary?.extractionErrors ?? 0) > 0) {
    failures += fail(`${extraSummary?.extractionErrors} file(s) threw during extraction. An `
      + 'extraction error is a DEFECT, never a decision — a parser that throws must not read '
      + 'as a clean run with fewer rows');
  }
  for (const filename of Object.values(JAVASCRIPT_CSV_FILES)) {
    const a = path.join(extraOutputDir, filename);
    const b = path.join(extraSecondOutputDir, filename);
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      continue;
    }
    if (!filesAreIdentical(a, b)) {
      failures += fail(`${filename}: two runs over the corpus differ`);
    }
  }
  const rows = Object.values(extraSummary?.counts ?? {}).reduce((a, b) => a + b, 0);
  console.log(`  corpus: ${extraSummary?.filesAnalysed ?? 0} files, ${rows} rows, `
    + `root ${extraCorpusDir}`);
  return failures;
}

// ---------------------------------------------------------------------------
// reading relations back, with the relation list DERIVED from the directory
// ---------------------------------------------------------------------------

interface Relation {
  /** `js_module`, derived from the filename — never from a hand-maintained list. */
  readonly name: string;
  readonly file: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Every relation in an output directory, discovered by reading the directory.
 *
 * §8 of `BUILDING-A-PARSER.md`: *derive the relation list from the output
 * directory, never a hand-maintained array* — adding a relation once made every
 * FK pointing at it read as dangling, because the array had not been updated and
 * the target relation therefore "did not exist".
 *
 * The relation NAME is derived from the filename, so a new relation is picked up
 * with no edit here.
 */
function readRelations(directory: string): Relation[] {
  const out: Relation[] = [];
  for (const { name, file } of relationFilesIn(directory)) {
    const rows: string[][] = [];
    let header: string[] = [];
    const fullPath = path.join(directory, file);
    if (fs.statSync(fullPath).size > MATERIALISE_LIMIT_BYTES) {
      throw new Error(`${name} is ${(fs.statSync(fullPath).size / 1e6).toFixed(0)} MB and `
        + 'readRelations holds every row as an array of strings. Use forEachRow, which '
        + 'streams. This threw rather than running because the alternative is an OOM crash '
        + 'with no indication of which check caused it');
    }
    streamRows(fullPath, (line, index) => {
      if (index === 0) {
        header = splitRow(line);
        return;
      }
      rows.push(splitRow(line));
    });
    out.push({ name, file, header, rows });
  }
  return out;
}

/**
 * The threshold past which a relation may not be materialised.
 *
 * ## Streaming the READ was not enough, and this is the second half of that fix
 *
 * `streamRows` was written because `fs.readFileSync` throws on a 500 MB
 * `js_expression` — past V8's maximum string length. `readRelations` uses it and
 * then pushes every split row into an array, which is a far larger allocation
 * than the string was: 2.85 M rows × 33 fields is tens of millions of live
 * JavaScript strings.
 *
 * Two corpus-wide checks could afford that. Adding a third and a fourth took the
 * suite from passing to **`FATAL ERROR: Ineffective mark-compacts near heap
 * limit`** — a crash naming no check, in a run that had been green, from an
 * addition that looked local. So the limit is enforced at the primitive rather
 * than remembered at each call site, and it throws with the name of the relation
 * and the name of the function to use instead.
 */
const MATERIALISE_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * One relation, streamed: the header once, then every row, holding neither.
 *
 * What every corpus-scoped check must use. A check that needs an INDEX builds it
 * here from the few columns it actually reads, which is the difference between
 * keeping 61 K method spans and keeping 2.85 M whole rows.
 */
function forEachRow(
  directory: string,
  relationName: string,
  onRow: (row: string[], header: string[]) => void
): number {
  const entry = relationFilesIn(directory).find((r) => r.name === relationName);
  if (entry === undefined) {
    return 0;
  }
  let header: string[] = [];
  let seen = 0;
  streamRows(path.join(directory, entry.file), (line, index) => {
    if (index === 0) {
      header = splitRow(line);
      return;
    }
    seen += 1;
    onRow(splitRow(line), header);
  });
  return seen;
}

/** A relation's header without reading its rows. */
function headerOf(directory: string, relationName: string): string[] {
  const entry = relationFilesIn(directory).find((r) => r.name === relationName);
  if (entry === undefined) {
    return [];
  }
  let header: string[] = [];
  const descriptor = fs.openSync(path.join(directory, entry.file), 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 16);
    const read = fs.readSync(descriptor, buffer, 0, 1 << 16, 0);
    header = buffer.toString('utf-8', 0, read).split('\n')[0]?.split('\t') ?? [];
  } finally {
    fs.closeSync(descriptor);
  }
  return header;
}

/** The relation files in a directory, discovered by reading it. */
function relationFilesIn(directory: string): { name: string; file: string }[] {
  return fs.readdirSync(directory).sort()
    .filter((file) => file.startsWith('all-javascript-') && file.endsWith('.csv'))
    .map((file) => ({ name: relationNameOf(file), file }));
}

/**
 * Streams a relation's lines, without holding the file in one string.
 *
 * `fs.readFileSync` on a finished relation throws
 * `Cannot create a string longer than 0x1fffffe8 characters` — a 500 MB
 * `js_expression` over 816 real files is past V8's maximum string length. The
 * writer already learned this and streams its read-back for the same reason;
 * the GATE had the same bug, which meant every check here was **structurally
 * incapable of running on real input** while passing cleanly on a 14-file
 * scaffold. That is §11's most expensive error shape, and it took a real corpus
 * to surface it.
 *
 * The undecoded tail is carried across chunk boundaries: a multi-byte character
 * straddling one would be corrupted by decoding each chunk alone, and would then
 * be reported as a malformed row in a file that is intact.
 */
function streamRows(filePath: string, onLine: (line: string, index: number) => void): void {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const CHUNK = 1 << 20;
    const buffer = Buffer.allocUnsafe(CHUNK);
    let carry = '';
    let index = 0;
    let position = 0;
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, CHUNK, position);
      if (read <= 0) {
        break;
      }
      position += read;
      const text = carry + buffer.toString('utf-8', 0, read);
      const lines = text.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line !== '') {
          onLine(line, index);
          index += 1;
        }
      }
    }
    if (carry !== '') {
      onLine(carry, index);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * `all-javascript-call-sites.csv` -> `js_call_site`.
 *
 * Depluralising the last segment rather than looking the name up in a table, so
 * the mapping cannot drift from the files on disk.
 */
function relationNameOf(file: string): string {
  const stem = file.replace(/^all-javascript-/, '').replace(/\.csv$/, '');
  const parts = stem.split('-');
  const last = parts[parts.length - 1]!;
  parts[parts.length - 1] = last.endsWith('ies')
    ? `${last.slice(0, -3)}y`
    : last.endsWith('s') ? last.slice(0, -1) : last;
  return `js_${parts.join('_')}`;
}

/**
 * Undoes `EntityUtils.escapeTsv` for a cell this harness wants to READ.
 *
 * A cell containing a `"` is wrapped in quotes with the inner ones doubled, so
 * the raw field for a class expression whose body contains a string literal
 * begins `"class …` — and a check asking `startsWith('class')` says no. That
 * happened: two correctly-linked class expressions were reported as unlinked
 * callables of an unknown kind, on a corpus where every other one passed.
 *
 * Only for checks that inspect TEXT. `noValueCanSplitARow` deliberately reads
 * the RAW field, because what it asserts is a property of the bytes on disk.
 */
/**
 * A row, split into TEXT fields.
 *
 * ## Why unescaping belongs here and not at the call site
 *
 * `unescapeTsv` was applied by hand at the one site known to need it. An audit
 * of every check against the 35 columns that pass through `escapeTsv` found two
 * more that did not, and both were passing:
 *
 * - **`call-site 1:1`** asked `row[text].startsWith('require(')`. `text` is
 *   escaped whenever it contains a double quote, so `require("./x")` — the
 *   ordinary spelling — has a raw field beginning with a quote and the test said
 *   no. The check was blind to the majority of the edges it exists to assert
 *   about, on every corpus, silently.
 * - **`row paths are self-consistent`** compares `fileName` against a real
 *   `path.basename`. Latent rather than firing, but the same shape: a raw field
 *   against an unescaped literal.
 *
 * Auditing 26 checks finds today's instances. Unescaping in the primitive means
 * a check CANNOT have the bug, which is the difference §3 draws between fixing
 * an instance and fixing a cause.
 *
 * ## And it must happen exactly once, because the operation is not idempotent
 *
 * A cell holding the literal text `"hello"` is written with the quotes doubled
 * and the whole wrapped again. Unescaping once yields `"hello"`; unescaping
 * twice yields `hello` — a different value, silently. That is why the explicit
 * call at the one site was REMOVED rather than left in place as harmless.
 *
 * The byte-level checks deliberately do not come through here: `determinism`,
 * `no emitted value can split a row` and `column order matches the frozen
 * schema` assert properties of the bytes on disk, and unescaping would destroy
 * the very thing they test.
 */
function splitRow(line: string): string[] {
  return line.split('\t').map(unescapeTsv);
}

function unescapeTsv(cell: string): string {
  if (!cell.startsWith('"') || !cell.endsWith('"') || cell.length < 2) {
    return cell;
  }
  return cell.slice(1, -1).replace(/""/g, '"');
}

/**
 * The primary key's column index, located BY NAME.
 *
 * ## `js_expression`'s PK is no longer its last column
 *
 * `introducesDeclarationLinkHash` was appended at c32, **after**
 * `jsExpressionUniqueHash` at c31, deliberately: inserting it at c14 would have
 * shifted the hash from c31 to c32 and every consumer reading c31 as the
 * expression hash would silently have read something else. `ts_module` has the
 * same shape.
 *
 * So "the PK is the last column" is now false for one relation in sixteen, and a
 * positional lookup **passes while pointing at the wrong column** — it would
 * have checked uniqueness of a foreign key and declared the fact base sound.
 * That is the failure this repository keeps paying for: a check that returns a
 * confident answer to a question it is not asking.
 *
 * Seven call sites located it positionally before this existed. Throwing on a
 * relation with no `…UniqueHash` column is deliberate: a silent `-1` would index
 * `undefined` and compare equal to itself.
 */
function pkIndexOf(header: readonly string[], relation: string): number {
  const index = header.findIndex((name) => name.endsWith('UniqueHash'));
  if (index < 0) {
    throw new Error(`${relation}: no column ending in UniqueHash — the primary key cannot be `
      + 'located by name, and locating it by position is what this function exists to prevent');
  }
  return index;
}

/**
 * Which relation a `*LinkHash` column points at, from its NAME.
 *
 * A `*LinkHash` column this cannot map is a FAILURE and not a skip — that is
 * what makes a newly added FK column arrive as a loud gate failure rather than
 * as an unchecked column nobody notices.
 *
 * `""` marks a column that is genuinely polymorphic — the relation it points at
 * is named by a sibling column (`targetKind`, `ownerKind`, `relatedRelation`) —
 * or, for `serviceVersionLinkHash`, one that is not an FK into this fact base at
 * all. Those are resolved against the union of every PK, which still catches a
 * hash resolving to nothing anywhere.
 */
const FK_TARGET_BY_COLUMN: Readonly<Record<string, string>> = {
  ownerModuleLinkHash: 'js_module',
  ownerScopeLinkHash: 'js_scope',
  ownerTypeLinkHash: 'js_type',
  ownerMethodLinkHash: 'js_method',
  bodyScopeLinkHash: 'js_scope',
  declarationScopeLinkHash: 'js_scope',
  syntacticScopeLinkHash: 'js_scope',
  scopeLinkHash: 'js_scope',
  parentScopeLinkHash: 'js_scope',
  parentBlockLinkHash: 'js_block',
  parentExpressionLinkHash: 'js_expression',
  parentReferenceLinkHash: 'js_type_reference',
  enclosingMethodLinkHash: 'js_method',
  constructorMethodLinkHash: 'js_method',
  getterMethodLinkHash: 'js_method',
  setterMethodLinkHash: 'js_method',
  moduleInitMethodLinkHash: 'js_method',
  moduleScopeLinkHash: 'js_scope',
  defaultExportLinkHash: 'js_export',
  sourceExpressionLinkHash: 'js_expression',
  initializerExpressionLinkHash: 'js_expression',
  conditionExpressionLinkHash: 'js_expression',
  receiverExpressionLinkHash: 'js_expression',
  expressionLinkHash: 'js_expression',
  typeReferenceLinkHash: 'js_type_reference',
  returnTypeReferenceLinkHash: 'js_type_reference',
  jsdocCommentLinkHash: 'js_comment',
  commentLinkHash: 'js_comment',
  importLinkHash: 'js_import',
  reExportImportLinkHash: 'js_import',
  boundVariableLinkHash: 'js_variable',
  patternRootVariableLinkHash: 'js_variable',
  resolvedBindingLinkHash: 'js_variable',
  computedNameExpressionLinkHash: 'js_expression',
  bindingDefaultLinkHash: 'js_expression',
  resolvedMethodLinkHash: 'js_method',
  resolvedTypeLinkHash: 'js_type',
  resolvedModuleLinkHash: 'js_module',
  targetModuleLinkHash: 'js_module',
  callSiteLinkHash: 'js_call_site',
  // c32, appended after the primary key. It arrived as a LOUD failure from this
  // very map — "an FK column this gate cannot map" — which is the behaviour the
  // unmapped-is-a-failure rule exists for: an unchecked FK is how adding a
  // relation once made every reference to it read as dangling.
  introducesDeclarationLinkHash: 'js_method',
  // c33: the sibling of resolvedBindingLinkHash for a reference that resolves to
  // a PARAMETER. A separate column rather than a widened c17, because a FK that
  // can point into either of two relations is one this gate cannot check.
  resolvedParameterLinkHash: 'js_method_parameter',
  attachedToLinkHash: '',
  declarationLinkHash: '',
  moduleEdgeLinkHash: '',
  targetLinkHash: '',
  ownerLinkHash: '',
  relatedLinkHash: '',
  serviceVersionLinkHash: '',
};

/**
 * Tier-3 columns: DECLARED and never staged by the parser.
 *
 * These are asserted EMPTY, not merely unchecked. Java is the precedent —
 * `referencedTypeRegistryLinkHash` is populated 0 times in 67,938 rows and that
 * is the design — and this is the check that stops the schema drifting into a
 * resolver one column at a time. `js_import.resolverAgreement` was deleted for
 * exactly that at the schema stage; this catches the same thing at emit.
 */
const TIER_3_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['js_call_site', 'resolvedMethodLinkHash'],
  ['js_type_heritage', 'resolvedTypeLinkHash'],
  ['js_type_reference', 'resolvedTypeLinkHash'],
  ['js_import', 'resolvedModuleLinkHash'],
];

// ---------------------------------------------------------------------------
// 1. compiles
// ---------------------------------------------------------------------------

/**
 * `tsc --noEmit` is clean.
 *
 * `--pretty false` is not cosmetic. With pretty output tsc wraps `error TS####`
 * in ANSI colour codes, so the literal string `error TS` **never appears in the
 * output** — and a shell pipeline grepping for it reports a clean build on a
 * broken one. That happened here while extracting these utils: seven compile
 * errors sat unreported behind a filter that could not match them, and the
 * suite's own check was the thing that caught it.
 *
 * This function was always right, because it uses the EXIT CODE. The lesson is
 * for whoever greps tsc output by hand.
 */
function compiles(): number {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
      { stdio: 'pipe' });
    return 0;
  } catch (error) {
    const out = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
    return fail(`tsc --noEmit is not clean:\n${out.split('\n').slice(0, 20).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// 2. every relation has a file, and the extraction was not vacuous
// ---------------------------------------------------------------------------

/**
 * A file exists for every declared relation, and rows were actually produced.
 *
 * The second half is what makes the rest of the suite mean anything. A parser
 * that emits nothing passes every uniqueness and integrity check trivially, so
 * "0 rows everywhere" must be a failure and not a clean run.
 */
function everyRelationHasAFile(): number {
  let failures = 0;
  for (const filename of Object.values(JAVASCRIPT_CSV_FILES)) {
    const full = path.join(outputDir, filename);
    if (!fs.existsSync(full)) {
      failures += fail(`${filename}: no file — a missing relation reads to every FK gate as `
        + 'every reference to it dangling');
      continue;
    }
    // A file is not enough: it must carry its HEADER. An empty relation used
    // to be written as 0 bytes, which told a consumer neither what the columns
    // were nor whether the parser had run — and made the relation vanish from
    // any check that derives its column list from headers, which is how the
    // FK partition briefly summed to 80 instead of 84.
    if (filename !== JAVASCRIPT_CSV_FILES.SKIPPED_FILES && fs.statSync(full).size === 0) {
      failures += fail(`${filename}: 0 bytes — a relation with no rows must still write its `
        + 'header, so "no rows" and "never ran" stay distinguishable and its columns are known');
    }
  }
  const relations = readRelations(outputDir);
  if (relations.reduce((sum, r) => sum + r.rows.length, 0) === 0) {
    failures += fail('the whole extraction produced 0 rows — every check below would pass '
      + 'vacuously');
  }
  const modules = relations.find((r) => r.name === 'js_module');
  if ((modules?.rows.length ?? 0) !== SCAFFOLD_SOURCE_COUNT) {
    failures += fail(`js_module: ${modules?.rows.length ?? 0} rows for `
      + `${SCAFFOLD_SOURCE_COUNT} JavaScript files — the relation is one row per file, always`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 3. PK uniqueness and FK integrity
// ---------------------------------------------------------------------------

/**
 * Every primary key is unique, and every populated FK resolves.
 *
 * **Duplicates DOUBLE, they do not collide.** A construct reached by two visit
 * paths mints an identical PK and the row count quietly doubles with nothing
 * looking wrong — no error, no warning, and every count still plausible. This is
 * the check that says so.
 *
 * The PK is the LAST column of every relation by schema convention, and the
 * relation list comes from the directory, so neither is written down here.
 */
function pkUniquenessAndFkIntegrity(): number {
  return checkPkAndFk(outputDir, 'scaffold');
}

/**
 * Two STREAMING passes: primary keys, then foreign keys.
 *
 * Two passes rather than one because an FK may point at a relation written
 * later, and streaming rather than loading because 2.85M rows held as arrays is
 * gigabytes — and because a single relation can exceed V8's maximum string
 * length, which is what made this check unable to run on real input at all.
 *
 * Errors are capped per column. A single systematic defect produces one message
 * per row otherwise, and a million identical lines is not a more useful report
 * than ten plus a count.
 */
function checkPkAndFk(directory: string, label: string): number {
  let failures = 0;
  const files = relationFilesIn(directory);
  const headers = new Map<string, string[]>();
  const keysByRelation = new Map<string, Set<string>>();

  // Pass 1: every primary key, and the duplicates that would DOUBLE a count.
  for (const { name, file } of files) {
    const keys = new Set<string>();
    let pkIndex = -1;
    let duplicates = 0;
    streamRows(path.join(directory, file), (line, index) => {
      const cells = line.split('\t');
      if (index === 0) {
        headers.set(name, cells);
        pkIndex = pkIndexOf(cells, name);
        return;
      }
      const key = cells[pkIndex] ?? '';
      if (key === '') {
        failures += fail(`${label}/${name}: a row has an empty primary key`);
        return;
      }
      if (keys.has(key)) {
        duplicates += 1;
        if (duplicates <= 3) {
          failures += fail(`${label}/${name}: duplicate primary key ${key} — a duplicate `
            + 'DOUBLES the row count rather than colliding, so nothing else would report it');
        }
      }
      keys.add(key);
    });
    if (duplicates > 3) {
      failures += fail(`${label}/${name}: ${duplicates} duplicate primary keys in total`);
    }
    keysByRelation.set(name, keys);
  }

  const everyKey = new Set<string>();
  for (const keys of keysByRelation.values()) {
    for (const key of keys) {
      everyKey.add(key);
    }
  }

  // Pass 2: every populated foreign key resolves.
  for (const { name, file } of files) {
    const header = headers.get(name);
    if (header === undefined) {
      continue;
    }
    const columns: { index: number; name: string; keys: Set<string> }[] = [];
    for (let column = 0; column < header.length; column += 1) {
      const columnName = header[column]!;
      if (!columnName.endsWith('LinkHash') || columnName === 'serviceVersionLinkHash') {
        continue;
      }
      if (!(columnName in FK_TARGET_BY_COLUMN)) {
        failures += fail(`${label}/${name}.${columnName}: an FK column this gate cannot map `
          + 'to a target relation. Add it to FK_TARGET_BY_COLUMN — an unmapped FK is an '
          + 'unchecked FK, which is how adding a relation once made every reference to it read '
          + 'as dangling');
        continue;
      }
      const target = FK_TARGET_BY_COLUMN[columnName]!;
      const targetKeys = target === '' ? everyKey : keysByRelation.get(target);
      if (targetKeys === undefined) {
        failures += fail(`${label}/${name}.${columnName}: target relation ${target} has no `
          + 'file in the output directory');
        continue;
      }
      columns.push({ index: column, name: columnName, keys: targetKeys });
    }
    if (columns.length === 0) {
      continue;
    }
    const dangling = new Map<string, number>();
    streamRows(path.join(directory, file), (line, index) => {
      if (index === 0) {
        return;
      }
      const cells = line.split('\t');
      for (const column of columns) {
        const value = cells[column.index] ?? '';
        if (value === '' || column.keys.has(value)) {
          continue;
        }
        const seen = (dangling.get(column.name) ?? 0) + 1;
        dangling.set(column.name, seen);
        if (seen <= 3) {
          failures += fail(`${label}/${name}.${column.name}: ${value} does not resolve`);
        }
      }
    });
    for (const [columnName, count] of dangling) {
      if (count > 3) {
        failures += fail(`${label}/${name}.${columnName}: ${count} dangling references total`);
      }
    }
  }
  return failures;
}

/**
 * The integrity gate rejects a corrupted fact base.
 *
 * Three corruptions, each the shape of a real defect: a duplicated row (the
 * doubling failure), a dangling FK (the added-relation failure), and an emptied
 * PK. A gate that cannot produce a non-null result on these is not measuring
 * anything, and this repository has shipped three such gates.
 */
function integrityGateCanFail(): number {
  let failures = 0;
  const cases: ReadonlyArray<readonly [string, (relations: Relation[]) => boolean]> = [
    ['a duplicated row', (relations) => {
      const target = relations.find((r) => r.rows.length > 0);
      if (target === undefined) {
        return false;
      }
      (target.rows as string[][]).push([...(target.rows[0] as string[])]);
      return true;
    }],
    ['a dangling FK', (relations) => {
      const target = relations.find((r) => r.rows.length > 0
        && r.header.some((h) => h.endsWith('LinkHash') && h !== 'serviceVersionLinkHash'
          && (FK_TARGET_BY_COLUMN[h] ?? '') !== ''));
      if (target === undefined) {
        return false;
      }
      const column = target.header.findIndex((h) => h.endsWith('LinkHash')
        && h !== 'serviceVersionLinkHash' && (FK_TARGET_BY_COLUMN[h] ?? '') !== '');
      (target.rows[0] as string[])[column] = 'deadbeefdeadbeefdeadbeefdeadbeef';
      return true;
    }],
    ['an empty PK', (relations) => {
      const target = relations.find((r) => r.rows.length > 0);
      if (target === undefined) {
        return false;
      }
      (target.rows[0] as string[])[pkIndexOf(target.header, target.name)] = '';
      return true;
    }],
  ];
  for (const [description, corrupt] of cases) {
    const scratch = scratchDir('js-gate-neg-');
    const relations: Relation[] = readRelations(outputDir).map((r) => ({
      ...r,
      rows: r.rows.map((row) => [...row]),
    }));
    if (!corrupt(relations)) {
      failures += fail(`the corpus has no row to corrupt with ${description} — the negative `
        + 'case is vacuous, so the gate is unverified');
      fs.rmSync(scratch, { recursive: true, force: true });
      continue;
    }
    for (const relation of relations) {
      const body = relation.header.length === 0
        ? ''
        : [relation.header.join('\t'), ...relation.rows.map((r) => r.join('\t'))].join('\n')
          + '\n';
      fs.writeFileSync(path.join(scratch, relation.file), body);
    }
    if (checkPkAndFkQuietly(scratch) === 0) {
      failures += fail(`the integrity gate accepted ${description} — it is incapable of `
        + 'returning a non-null result, so every passing run of it means nothing');
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return failures;
}

/** Runs the integrity check without printing, for the negative cases. */
function checkPkAndFkQuietly(directory: string): number {
  const log = console.log;
  console.log = (): void => {};
  try {
    return checkPkAndFk(directory, 'negative');
  } finally {
    console.log = log;
  }
}

// ---------------------------------------------------------------------------
// 4. determinism
// ---------------------------------------------------------------------------

/**
 * Two runs, byte-identical.
 *
 * Not a nicety: filesystem enumeration order is not stable across machines, so
 * output that is not deterministic cannot be diffed, cached, or compared against
 * a golden file — which makes every other gate here unrunnable in CI.
 */
function determinism(): number {
  let failures = 0;
  let compared = 0;
  for (const filename of Object.values(JAVASCRIPT_CSV_FILES)) {
    const a = path.join(outputDir, filename);
    const b = path.join(secondOutputDir, filename);
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      continue;
    }
    compared += 1;
    const left = fs.readFileSync(a, 'utf-8');
    const right = fs.readFileSync(b, 'utf-8');
    if (left !== right) {
      const leftLines = left.split('\n');
      const rightLines = right.split('\n');
      const at = leftLines.findIndex((line, i) => line !== rightLines[i]);
      failures += fail(`${filename}: two runs differ, first at line ${at + 1}`);
    }
  }
  if (compared === 0) {
    failures += fail('no relation file was compared — the determinism check is vacuous');
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 5. same-module links only, and tier 3 stays empty
// ---------------------------------------------------------------------------

/**
 * Every populated link points inside its own module, and every tier-3 column is
 * empty.
 *
 * **The rule the parser is judged against.** The parser emits IR; the engine
 * resolves. Only 52.6% of call sites are decidable even WITH the checker, and
 * that number sizes the oracle's gates — it is not a licence to emit links.
 *
 * Two halves, both load-bearing. The tier-3 half asserts the columns the schema
 * declares and never stages really are empty. The same-module half asserts that
 * every link that IS populated — the binder's own output — resolves to a row in
 * the same module, because a link crossing a module boundary is cross-file
 * following, which was written once in TypeScript and then deleted.
 */
function sameModuleLinksOnly(): number {
  let failures = 0;
  const relations = readRelations(outputDir);

  for (const [relationName, columnName] of TIER_3_COLUMNS) {
    const relation = relations.find((r) => r.name === relationName);
    if (relation === undefined || relation.header.length === 0) {
      continue;
    }
    const column = relation.header.indexOf(columnName);
    if (column < 0) {
      failures += fail(`${relationName}: no column ${columnName} — the schema declares it as `
        + 'tier 3, so its absence means the emitted row shape does not match the contract');
      continue;
    }
    const populated = relation.rows.filter((row) => (row[column] ?? '') !== '').length;
    if (populated > 0) {
      failures += fail(`${relationName}.${columnName}: ${populated} populated rows. This column `
        + "is TIER 3 — declared and never staged. The parser resolving it is the engine's work "
        + 'done in the wrong place, which is what js_import.resolverAgreement was deleted for');
    }
  }

  // The owning module of every row, by PK, so a link can be checked against it.
  const moduleOfRow = new Map<string, string>();
  for (const relation of relations) {
    if (relation.header.length === 0) {
      continue;
    }
    const pk = pkIndexOf(relation.header, relation.name);
    const owner = relation.header.indexOf('ownerModuleLinkHash');
    if (owner < 0) {
      continue;
    }
    for (const row of relation.rows) {
      moduleOfRow.set(row[pk] ?? '', row[owner] ?? '');
    }
  }
  for (const relation of relations) {
    if (relation.header.length === 0) {
      continue;
    }
    const owner = relation.header.indexOf('ownerModuleLinkHash');
    if (owner < 0) {
      continue;
    }
    for (let column = 0; column < relation.header.length; column += 1) {
      const name = relation.header[column]!;
      if (!name.endsWith('LinkHash') || name === 'serviceVersionLinkHash'
        || name === 'ownerModuleLinkHash' || FK_TARGET_BY_COLUMN[name] === 'js_module') {
        continue;
      }
      for (const row of relation.rows) {
        const value = row[column] ?? '';
        if (value === '') {
          continue;
        }
        const targetModule = moduleOfRow.get(value);
        if (targetModule === undefined) {
          continue;
        }
        if (targetModule !== (row[owner] ?? '')) {
          failures += fail(`${relation.name}.${name}: ${value} lives in another module. Every `
            + "populated link is same-file one-hop; a cross-module link is the engine's work "
            + 'done in the parser');
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 6. module-system coherence
// ---------------------------------------------------------------------------

/**
 * A file's module-system columns agree with each other and with its extension.
 *
 * Gate 7.3.4 in the schema. The half that matters most is the extension
 * override: a `.cjs` under `"type": "module"` and a `.mjs` under a CommonJS root
 * must come out CommonJS and ESM respectively, because the extension overrides
 * the config outright. Both directions are in the scaffold precisely so this
 * cannot pass by never being exercised.
 */
function moduleSystemCoherence(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const relation = relations.find((r) => r.name === 'js_module');
  if (relation === undefined || relation.header.length === 0) {
    return fail('js_module: no rows');
  }
  const at = (name: string): number => relation.header.indexOf(name);
  const columns = {
    filePath: at('filePath'), system: at('moduleSystem'), source: at('moduleSystemSource'),
    governing: at('governingPackageJsonPath'), contradicts: at('contradictsGoverningConfig'),
    kind: at('contradictionKind'), regime: at('emissionRegime'), version: at('targetTsVersion'),
    provenance: at('sourceProvenance'), moduleKind: at('moduleKind'),
    isExternalModule: at('isExternalModule'), hasJsxContent: at('hasJsxContent'),
  };
  for (const [name, index] of Object.entries(columns)) {
    if (index < 0) {
      failures += fail(`js_module: no column ${name}`);
    }
  }
  if (failures > 0) {
    return failures;
  }

  const impliedBySource: Readonly<Record<string, string>> = {
    EXT_MJS: 'ESM', EXT_CJS: 'COMMONJS', PKG_TYPE_MODULE: 'ESM',
    PKG_TYPE_COMMONJS: 'COMMONJS', PKG_TYPE_ABSENT_DEFAULT: 'COMMONJS',
    NO_PACKAGE_JSON_DEFAULT: 'COMMONJS',
  };
  let sawMjsOverride = 0;
  let sawCjsOverride = 0;
  let sawContradiction = 0;
  let sawBundled = 0;
  let sawJsxInPlainJs = 0;
  for (const row of relation.rows) {
    const filePath = row[columns.filePath]!;
    const system = row[columns.system]!;
    const source = row[columns.source]!;

    if (row[columns.regime] !== EMISSION_REGIME) {
      failures += fail(`${filePath}: emissionRegime is ${row[columns.regime]}, expected `
        + EMISSION_REGIME);
    }
    if (row[columns.version] !== COMPILER_VERSION) {
      failures += fail(`${filePath}: targetTsVersion is ${row[columns.version]}, expected `
        + COMPILER_VERSION);
    }
    // `jsExtensionOf`, not `endsWith`. This gate exists to assert that the
    // `.mjs`/`.cjs` override is TOTAL, and on `a.cjs.flow` the raw suffix test
    // is false — so the check quietly skipped the one file most able to break
    // the rule it guards.
    if (jsExtensionOf(filePath) === '.mjs') {
      sawMjsOverride += 1;
      if (system !== 'ESM' || source !== 'EXT_MJS') {
        failures += fail(`${filePath}: .mjs must be ESM by EXT_MJS, got ${system}/${source}`);
      }
    }
    if (jsExtensionOf(filePath) === '.cjs') {
      sawCjsOverride += 1;
      if (system !== 'COMMONJS' || source !== 'EXT_CJS') {
        failures += fail(`${filePath}: .cjs must be CommonJS by EXT_CJS, got `
          + `${system}/${source}`);
      }
    }
    if (impliedBySource[source] !== system) {
      failures += fail(`${filePath}: moduleSystemSource ${source} implies `
        + `${impliedBySource[source]}, but moduleSystem is ${system}`);
    }
    // Evidence and conclusion. NO_PACKAGE_JSON_DEFAULT is the one value that
    // requires the evidence column to be EMPTY; every PKG_TYPE_* value requires
    // it to be populated, because it names the file that decided.
    const governing = row[columns.governing]!;
    if (source === 'NO_PACKAGE_JSON_DEFAULT' && governing !== '') {
      failures += fail(`${filePath}: NO_PACKAGE_JSON_DEFAULT with a governing path ${governing}`);
    }
    if (source.startsWith('PKG_TYPE') && governing === '') {
      failures += fail(`${filePath}: ${source} with no governing package.json recorded`);
    }
    // contradictsGoverningConfig and contradictionKind are one fact in two
    // columns and must never disagree.
    const contradicts = row[columns.contradicts] === 'true';
    const kind = row[columns.kind]!;
    if (contradicts !== (kind !== 'NONE')) {
      failures += fail(`${filePath}: contradictsGoverningConfig=${contradicts} with `
        + `contradictionKind=${kind}`);
    }
    if (contradicts) {
      sawContradiction += 1;
    }
    if (row[columns.provenance] !== 'PROJECT') {
      sawBundled += 1;
    }
    // BUNDLED labels; it does not withhold. thing.min.js initialises `b` 900
    // times — ONE var binding, since `var` redeclares nothing, but 900
    // initialiser expressions — and must emit them, or the parser is deciding
    // what a consumer wants.
    if (row[columns.provenance] === 'BUNDLED') {
      const modulePk = row[pkIndexOf(relation.header, 'js_module')] ?? '';
      const expressions = relations.find((r) => r.name === 'js_expression')!;
      const xOwner = expressions.header.indexOf('ownerModuleLinkHash');
      const emitted = expressions.rows.filter((r) => r[xOwner] === modulePk).length;
      if (emitted < 900) {
        failures += fail(`${filePath}: BUNDLED and ${emitted} expression rows (expected at least 900). `
          + 'BUNDLED is a label and the file emits in full (§3.1.1); only FLOW_REJECTED withholds rows');
      }
    }
    if ((filePath.endsWith('index.esm.js') || filePath.endsWith('Widget.umd.js'))
      && row[columns.provenance] !== 'PROJECT') {
      failures += fail(`${filePath}: sourceProvenance is ${row[columns.provenance]}. \`esm\` and \`umd\` `
        + 'name a module format, not a build product — a hand-written file is PROJECT, and where a '
        + 'name signal and a content signal disagree the content wins');
    }
    if (filePath.endsWith('long-literal.js') && row[columns.provenance] !== 'PROJECT') {
      failures += fail(`${filePath}: sourceProvenance is ${row[columns.provenance]}. One long LITERAL `
        + 'in a hand-written file is excused; length is never the only signal');
    }
    if (filePath.endsWith('compiled.js') && row[columns.provenance] !== 'BUNDLED') {
      failures += fail(`${filePath}: sourceProvenance is ${row[columns.provenance]}. A line no human `
        + 'writes beside a sourceMappingURL footer is a minified bundle — the two signals together');
    }
    // moduleKind and isExternalModule answer the same question and must agree.
    const isExternal = row[columns.isExternalModule] === 'true';
    if (isExternal !== (row[columns.moduleKind] === 'SOURCE_MODULE')) {
      failures += fail(`${filePath}: isExternalModule=${isExternal} with moduleKind=`
        + `${row[columns.moduleKind]}`);
    }
    // JSX in a plain `.js` file parses, which is the measurement that makes
    // `scriptKind` provenance rather than a decision.
    if (row[columns.hasJsxContent] === 'true' && jsExtensionOf(filePath) === '.js') {
      sawJsxInPlainJs += 1;
    }
  }

  // Non-vacuity. Each is a case the gate exists for, and a scaffold that
  // stopped exercising one would make the assertion above silently untested.
  if (sawMjsOverride === 0) {
    failures += fail('no .mjs file in the corpus — the extension-override assertion is vacuous');
  }
  if (sawCjsOverride === 0) {
    failures += fail('no .cjs file in the corpus — the extension-override assertion is vacuous');
  }
  if (sawContradiction === 0) {
    failures += fail('no contradicting file in the corpus — the Q3 ruling is untested');
  }
  if (sawBundled === 0) {
    failures += fail('no bundled file in the corpus — the provenance assertion is vacuous');
  }
  // ALL SIX ways a module system can be decided. Each is a different claim —
  // a declared CommonJS and a defaulted one are not the same fact, and 91.4% of
  // real files are defaulted — so a corpus exercising five of six leaves one
  // route through this code untested.
  const sources = new Set(relation.rows.map((row) => row[columns.source]));
  for (const expected of Object.keys(impliedBySource)) {
    if (!sources.has(expected)) {
      failures += fail(`no file in the corpus is decided by ${expected}, so that route `
        + 'through the governing-config lookup is untested');
    }
  }
  // `hasTopLevelAwait` must distinguish an await inside an async ARROW from one
  // at the top level. Both shapes are in the corpus so the assertion is real.
  const topLevelAwait = relation.header.indexOf('hasTopLevelAwait');
  const withAwait = relation.rows.filter((row) => row[topLevelAwait] === 'true')
    .map((row) => row[columns.filePath] ?? '');
  const arrowOnly = relation.rows.find(
    (row) => (row[columns.filePath] ?? '').endsWith('await-shapes.js')
  );
  if (arrowOnly !== undefined && arrowOnly[topLevelAwait] === 'true') {
    failures += fail('await-shapes.js has `await` only inside async functions and an async '
      + 'arrow, and hasTopLevelAwait is true. An arrow does not rebind `this` and DOES end '
      + 'the top level — answering both questions with one predicate got 33 of 816 real files '
      + 'wrong');
  }
  if (withAwait.length === 0) {
    failures += fail('no file in the corpus has a genuine top-level await, so the negative '
      + 'case above proves nothing');
  }
  if (sawJsxInPlainJs === 0) {
    failures += fail('no JSX in a plain .js file — the claim that ScriptKind.JS parses JSX, '
      + 'which is why scriptKind is provenance and not a decision, is untested');
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 7. no emitted value can split a row
// ---------------------------------------------------------------------------

/**
 * No cell contains a character a CONSUMER treats as a line break.
 *
 * `escapeTsv` handles `\r`, `\n` and tabs. It does not handle U+2028, U+2029,
 * U+0085 or the C0 separators, and Python's `str.splitlines()` breaks on all of
 * them. A value carrying one produces a file this parser calls well formed and
 * the reader calls torn — the worst available disagreement, because the parser
 * certified an artefact it cannot read the same way as its consumer.
 */
const CONSUMER_LINE_BREAKS =
  /[\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029]/;

function noValueCanSplitARow(): number {
  let failures = 0;
  for (const relation of readRelations(outputDir)) {
    for (const row of relation.rows) {
      for (let i = 0; i < row.length; i += 1) {
        if (CONSUMER_LINE_BREAKS.test(row[i] ?? '')) {
          failures += fail(`${relation.name}.${relation.header[i]}: a value contains a character `
            + 'a consumer treats as a line break');
        }
      }
      if (row.length !== relation.header.length) {
        failures += fail(`${relation.name}: a row has ${row.length} fields where the header has `
          + `${relation.header.length}`);
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 8. row paths are self-consistent
// ---------------------------------------------------------------------------

/**
 * `filePath` names a file that exists, and the derived name columns agree.
 *
 * A position join is only sound if the path columns identify the file the
 * positions are in. The stem assertion is here because a compound extension is
 * where this goes wrong: `thing.min.js` has stem `thing.min`, and getting it
 * wrong is what made TypeScript's `.d.cts` stems keep a stray `.d`.
 */
function rowPathsAreSelfConsistent(): number {
  let failures = 0;
  const relation = readRelations(outputDir).find((r) => r.name === 'js_module');
  if (relation === undefined || relation.header.length === 0) {
    return fail('js_module: no rows');
  }
  const filePath = relation.header.indexOf('filePath');
  const fileName = relation.header.indexOf('fileName');
  const name = relation.header.indexOf('name');
  const qualifiedName = relation.header.indexOf('qualifiedName');
  for (const row of relation.rows) {
    const relative = row[filePath]!;
    // Either root: the fact set is the union of two, and a path is relative to
    // whichever one claimed the file.
    if (!fs.existsSync(path.join(corpusDir, relative))
      && !fs.existsSync(path.join(unpackagedDir, relative))
      && !fs.existsSync(path.join(path.dirname(unpackagedDir), relative))) {
      failures += fail(`js_module.filePath ${relative} does not name a file under either `
        + 'corpus root');
    }
    if (path.basename(relative) !== row[fileName]) {
      failures += fail(`js_module: fileName ${row[fileName]} is not the basename of ${relative}`);
    }
    // The SHARED predicate, not a regex of this check's own. `/\.[^.]+$/` strips
    // only the last part, so it expected `typed-module.js` for
    // `typed-module.js.flow` and failed a parser that was right. That made this
    // the fifth site to assume a single-part extension — and the one that would
    // have argued the other four were wrong.
    const expectedStem = stripJsExtension(path.basename(relative));
    if (row[name] !== expectedStem) {
      failures += fail(`js_module.name ${row[name]} is not the stem of ${relative} `
        + `(expected ${expectedStem})`);
    }
    const slash = relative.lastIndexOf('/');
    const expectedQualified = (slash < 0 ? '' : relative.slice(0, slash + 1))
      + stripJsExtension(relative.slice(slash + 1));
    if (row[qualifiedName] !== expectedQualified) {
      failures += fail(`js_module.qualifiedName ${row[qualifiedName]} is not the `
        + `extension-stripped ${relative}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 9. the fixture corpus, when it exists
// ---------------------------------------------------------------------------

/**
 * Every structural gate, over `js-fixtures`' corpus.
 *
 * PENDING until that corpus exists, and reported as pending rather than as a
 * pass — a skipped check that prints nothing is indistinguishable from a passing
 * one.
 */
function fixtureCorpusIsSound(): number {
  if (fixtureOutputDir === '') {
    return pendingCheck('fixture corpus', `${FIXTURES} does not exist yet — js-fixtures owns it`);
  }
  return checkPkAndFk(fixtureOutputDir, 'fixtures');
}


// ---------------------------------------------------------------------------
// 10. the enum-emission audit
// ---------------------------------------------------------------------------

/**
 * Reserved values, split by WHY they are reserved.
 *
 * ## The rule that changed, and the failure that forced it
 *
 * One allowlist with one meaning is what made this gate incapable of failing.
 * `REQUIRE_UNDER_ESM` sat on it, asserted to carry zero rows on the strength of
 * the schema's "measured 0" — and 4 of 816 real files emit it. A value that is
 * merely *unobserved* is not a value that *cannot occur*, and asserting the
 * second when you mean the first produces a gate that passes because the corpus
 * is small rather than because the claim is true.
 *
 * So a reserved value must now declare which it is, and only one kind is
 * asserted:
 *
 * - **{@link UNREACHABLE_BY_CONSTRUCTION}** — no legal input can produce it,
 *   for a stated structural reason. Asserted at **zero rows**. Emitting one is
 *   a named failure.
 * - **{@link MERELY_UNOBSERVED}** — perfectly reachable; this corpus does not
 *   contain it. **No assertion.** Reported, so the absence is visible, and a
 *   row appearing is news rather than an error.
 */
const UNREACHABLE_BY_CONSTRUCTION: Readonly<Record<string, string>> = {
  // Facts about a value's RUNTIME IDENTITY. No syntax can decide them, so no
  // legal input reaches them through a parser that refuses to guess.
  ...Object.fromEntries(RESERVED_CALL_KINDS.map((value) => [
    `JsCallKind.${value}`,
    'a fact about a value at runtime, not about the expression in front of you',
  ])),
  // A `.json` file is not JavaScript source. It appears in this vocabulary only
  // as an import TARGET, and the parser emits no row for a target it does not
  // walk — so no walk of `.js`/`.mjs`/`.cjs`/`.jsx` can produce it.
  'JsModuleKind.JSON_MODULE': 'a .json file is an import target, never a walked source file',
  // RULED by the human, and the reasoning is the schema's rather than this
  // parser's: `thisBinding` describes a DECLARATION, and `.bind()` does not
  // declare anything. It takes a function declared elsewhere and produces a
  // VALUE whose receiver is fixed. `js_method` rows describe declarations, so
  // no legal input puts BOUND on one.
  //
  // It was moved OFF this list once, on the reasoning that "no js_method row
  // exists to carry it" is a statement about this parser rather than about
  // legal inputs — which was the right test applied to the wrong value. The
  // right reason is structural and it belongs here.
  //
  // If the fact is wanted it belongs on the `.bind()` CALL SITE, which is where
  // the binding happens. That is a schema question and is logged with the
  // measured population: 541 `.call`, 318 `.apply`, 189 `.bind` sites.
  'JsThisBinding.BOUND': 'thisBinding describes a declaration; .bind() produces a value from '
    + 'one made elsewhere',

  // `'use strict'` IS NOT A COMMENT, and JsDirectiveKind is
  // `js_comment.directiveKind`. A directive prologue is a string-literal
  // EXPRESSION STATEMENT, so it produces no js_comment row and this value can
  // never appear in the only column that carries it. Structural, and about the
  // grammar rather than about any corpus.
  //
  // The fact itself is not lost — it is carried correctly, one relation over, as
  // `js_scope.strictModeSource = USE_STRICT_DIRECTIVE`. So this is a declared
  // value in the WRONG VOCABULARY, which is a schema tidy-up rather than a gap,
  // and the reservation is what makes that statement checkable.
  //
  // It also nearly escaped notice in the other direction: js-corpus's audit
  // matched USE_STRICT as a SUBSTRING of USE_STRICT_DIRECTIVE — a value of a
  // different enum — and reported it emitted. A substring hit in a free-text
  // column is a diagnostic, never an emission.
  'JsDirectiveKind.USE_STRICT': 'a directive prologue is an expression statement, not a '
    + 'comment; the fact lives in js_scope.strictModeSource',

  // RULED RESERVE, and landing them is what found the defect in this list.
  //
  // Both were on neither list because their bare names could not be added:
  // FIELD belongs to FOUR enums and JSDOC to four, so `FIELD:` here would have
  // asserted zero rows on JsCommentAttachmentKind.FIELD,
  // JsTypeReferenceContextKind.FIELD and JsTypeReferenceOwnerKind.FIELD — three
  // pairs that emit thousands of rows. A list keyed on a string that is not
  // unique, for the seventh time in this repository. Every key is scoped now.
  //
  // JsExportTargetKind.FIELD: an exported name that is a declared member
  // resolves to METHOD or TYPE. A js_field is a member OF a type, reachable only
  // through it; `exports.x = Foo.prototype.bar` exports a value, not the
  // member, and the target of a module-level name is never a field row.
  'JsExportTargetKind.FIELD': 'an exported name resolves to a method, type or variable; '
    + 'a field is reachable only through its owner and is never a module-level binding',
  // JsRootContext.JSDOC: a `@param {number} [n=1]` default is a JSDoc VALUE
  // position. Gate 4 — type-only constructs never reach the call graph — means
  // JSDoc value positions are not walked as expressions, so no expression row
  // can carry this root context.
  'JsRootContext.JSDOC': 'JSDoc value positions are type-only and are not walked as '
    + 'expressions, per gate 4',
};

/**
 * Reachable, and not seen in the corpora this run extracted.
 *
 * **Deliberately not asserted.** Each of these can occur in legal JavaScript;
 * their absence is a property of the population, and a zero-row assertion on one
 * would fail the day a corpus contains it — correctly emitted, reported as a
 * defect. `REQUIRE_UNDER_ESM` is here as a memorial: it was on the other list
 * until real code produced four of them.
 */
const MERELY_UNOBSERVED: Readonly<Record<string, string>> = {
  // ## THE RULE ON THE RETURN TRIP, which is what these four are here to obey
  //
  // Every entry below was OBSERVED at scale and then went back to zero when
  // Flow was ruled out of scope. A value that stops being emitted because the
  // population changed does **not** earn `UNREACHABLE_BY_CONSTRUCTION` — that
  // list means *no legal input can produce this*, and a corpus is not a
  // grammar. It stays here, with the measurement that put it here.
  //
  // The ruling exists because the opposite move is exactly how REQUIRE_UNDER_ESM
  // got a zero-row assertion it could not honour: a reservation made against a
  // corpus that could not contain the construct.

  // `declare function flushSync<R>(fn: () => R): R;` — Flow's ambient overload.
  // Six rows across three files of one UI library before the exclusion, zero after. It was
  // never a JavaScript construct; it was a type-only declaration that
  // ScriptKind.JS accepted with no diagnostic and minted a method row for.
  'JsBodyPresence.NO_BODY': 'Flow `declare function`; 6 rows before Flow was excluded, '
    + '0 after',

  // `import x = require('y')` is TypeScript syntax. It is not writable in
  // JavaScript at all, so the honest reason is about the grammar — but the
  // grammar in question is the GRAMMAR OF ANOTHER LANGUAGE that this parser's
  // compiler happens to accept, which is not the same as unreachable by
  // construction. Reachable if the front end ever widened; absent today.
  'JsImportForm.IMPORT_EQUALS': 'TypeScript syntax the JS grammar has no spelling for; 0 rows',

  // Both of these measured what Flow files produced, and Flow files now produce
  // one module row each. They did not become impossible; their entire
  // population moved behind the exclusion.
  'JsDirectiveKind.FLOW_PRAGMA': 'a directive in a file that is now declined before its '
    + 'comments are read',
  'JsParseGapKind.FLOW_SYNTAX': 'a parse gap in a file that is now declined before it is walked',
};

/**
 * Every declared enum value is either emitted or on the reserved allowlist.
 *
 * ## Why this catches what nothing else does
 *
 * On TypeScript this found **four real defects no other check caught**, because
 * every one was a *classification* error that lost no rows: `@Get("/x")` emitted
 * as `FUNCTION_CALL`, `outer: for (…)` dropping its label, and two block kinds
 * producing no row at all. Recall, completeness and oracle adjudication were all
 * green for three of them.
 *
 * **A correctly-positioned row with the wrong kind is invisible to every
 * count-based check you have.**
 *
 * ## The audit's own false-positive mode is guarded
 *
 * `MODULE_EXPORTS` looked unemitted in TypeScript because it is a PREFIX
 * (`MODULE_EXPORTS:<hash>`) and exact-cell matching cannot see it; `N.M.K` looked
 * dropped until the column turned out to be `completeTypeName`. So the scan
 * compares against every cell of every relation rather than against a column
 * list, and reports the relation a value was found in.
 */
function enumEmissionAudit(): number {
  let failures = 0;
  // The UNION of every corpus extracted this run. Running it over the scaffold
  // alone was a real gap: a reserved value that only REAL code produces is
  // invisible to a fifteen-file scaffold, and that is exactly what happened —
  // REQUIRE_UNDER_ESM sat on the reserved allowlist while 4 of 816 real files
  // emitted it. An audit that cannot see the population it is auditing reports
  // a clean result it has no basis for.
  // PER (relation, column), not per cell.
  //
  // ## The third false-positive mode, and the one that hid the most
  //
  // The audit compared each declared value against every cell of every
  // relation. 35 of 264 distinct strings are declared in more than one enum:
  // `NONE` belongs to TEN of them, `FIELD` to four, `JSDOC` to four, `MODULE` to
  // three. One emitter anywhere marked all of them covered — so an enum could be
  // scored complete entirely on another enum's evidence.
  //
  // Whole-cell over the same corpora found 2 gaps. Column-scoped found 7. Five
  // were invisible, and two of those five are zero-row columns with a working
  // control in the same relation. This is §4 one level up: a correctly-emitted
  // value in the WRONG ENUM'S COLUMN passes the audit.
  //
  // ## The binding is DERIVED, so there is no map to maintain
  //
  // A column binds to enum E when every distinct non-empty value in it is a
  // member of E. That needs no hand-written table and cannot drift from the
  // data. Where a column fits two enums it is REPORTED rather than guessed —
  // `bindingForm` on method-parameters and on variables genuinely fits both
  // JsParameterBindingForm and JsVariableBindingForm, and choosing one silently
  // would be inventing a fact.
  const valuesByColumn = new Map<string, Set<string>>();
  // A free-text column has unbounded distinct values and can never be an enum
  // column. Capping keeps this streaming pass flat in memory over 4 M rows, and
  // a column past the cap is excluded from binding rather than truncated —
  // which would be worse than not looking, because a truncated set can still be
  // a subset by accident.
  const DISTINCT_CAP = 256;
  const overCap = new Set<string>();
  for (const source of [outputDir, fixtureOutputDir, extraOutputDir]) {
    if (source === '') {
      continue;
    }
    for (const { name, file } of relationFilesIn(source)) {
      let header: string[] = [];
      streamRows(path.join(source, file), (line, index) => {
        const cells = line.split('\t');
        if (index === 0) {
          header = cells;
          return;
        }
        for (let i = 0; i < header.length; i += 1) {
          const cell = cells[i] ?? '';
          if (cell === '') {
            continue;
          }
          const key = `${name}.${header[i]}`;
          if (overCap.has(key)) {
            continue;
          }
          let set = valuesByColumn.get(key);
          if (set === undefined) {
            set = new Set<string>();
            valuesByColumn.set(key, set);
          }
          set.add(cell);
          if (set.size > DISTINCT_CAP) {
            overCap.add(key);
            valuesByColumn.delete(key);
          }
        }
      });
    }
  }

  const declared = new Map<string, string[]>();
  for (const [enumName, enumObject] of Object.entries(
    JsEnums as unknown as Record<string, unknown>
  )) {
    if (typeof enumObject !== 'object' || enumObject === null) {
      continue;
    }
    // An exported ARRAY is not an enum. `RESERVED_CALL_KINDS` is a list of
    // values that already appear in `JsCallKind`, and enumerating it reported
    // every one of them twice — the audit's own false-positive mode, which §4
    // names as one of three outcomes that cannot be told apart without looking.
    if (Array.isArray(enumObject)) {
      continue;
    }
    const values = Object.values(enumObject as Record<string, unknown>)
      .filter((value): value is string => typeof value === 'string');
    if (values.length > 0) {
      declared.set(enumName, values);
    }
  }
  if (declared.size === 0) {
    return fail('no enums were discovered — the audit is structurally incapable of '
      + 'failing, which is the most expensive kind of error in this repository');
  }

  // Bind each column to the enums it fits, then score per (enum, column).
  const columnsByEnum = new Map<string, string[]>();
  const enumsByColumn = new Map<string, string[]>();
  for (const [column, values] of valuesByColumn) {
    for (const [enumName, declaredValues] of declared) {
      const members = new Set(declaredValues);
      let fits = true;
      for (const value of values) {
        if (!members.has(value)) {
          fits = false;
          break;
        }
      }
      if (!fits) {
        continue;
      }
      columnsByEnum.set(enumName, [...(columnsByEnum.get(enumName) ?? []), column]);
      enumsByColumn.set(column, [...(enumsByColumn.get(column) ?? []), enumName]);
    }
  }

  // EVERY ALLOWLIST KEY IS SCOPED AND NAMES A DECLARED PAIR.
  //
  // The lists were keyed by bare value. Twelve keys, all unique by luck — and
  // the day FIELD or JSDOC had to be added, a bare key would have asserted zero
  // rows on three other enums' FIELD and three other enums' JSDOC, every one of
  // which emits. A key that is not `Enum.VALUE`, or that names a pair no enum
  // declares, is a typo that would silently reserve nothing.
  for (const key of [...Object.keys(UNREACHABLE_BY_CONSTRUCTION),
    ...Object.keys(MERELY_UNOBSERVED)]) {
    const dot = key.indexOf('.');
    const enumName = dot < 0 ? '' : key.slice(0, dot);
    const value = dot < 0 ? key : key.slice(dot + 1);
    if (dot < 0 || !(declared.get(enumName) ?? []).includes(value)) {
      failures += fail(`allowlist key ${key} is not a scoped \`Enum.VALUE\` naming a declared `
        + 'pair. A bare value is unique only by luck — FIELD belongs to four enums — and an '
        + 'unmatched key reserves nothing while looking like it does');
    }
  }

  const unemitted: string[] = [];
  for (const [enumName, values] of declared) {
    const columns = columnsByEnum.get(enumName) ?? [];
    // Every value seen in a column bound to THIS enum, and no other.
    const emittedHere = new Set<string>();
    for (const column of columns) {
      for (const value of valuesByColumn.get(column) ?? []) {
        emittedHere.add(value);
      }
    }
    for (const value of values) {
      if (emittedHere.has(value)) {
        const scoped = `${enumName}.${value}`;
        if (scoped in UNREACHABLE_BY_CONSTRUCTION) {
          failures += fail(`${enumName}.${value} is reserved as UNREACHABLE BY CONSTRUCTION `
            + `and was emitted in ${columns.filter((c) => (valuesByColumn.get(c) ?? new Set())
              .has(value)).join(', ')}. Either the structural reason is wrong or the `
            + 'extractor is — both are decisions, and this gate exists so the day it changes '
            + 'is a named failure rather than new rows nobody noticed');
        }
        continue;
      }
      if (`${enumName}.${value}` in UNREACHABLE_BY_CONSTRUCTION
        || `${enumName}.${value}` in MERELY_UNOBSERVED) {
        continue;
      }
      unemitted.push(`${enumName}.${value}`);
    }
  }

  // An enum nothing binds to is a stronger statement than an unemitted value:
  // no column in the fact base carries this vocabulary AT ALL, so the audit has
  // no evidence about it either way and must say so rather than scoring it.
  const unbound = [...declared.keys()].filter((e) => (columnsByEnum.get(e) ?? []).length === 0);
  if (unbound.length > 0) {
    console.log(`  ${unbound.length} enum(s) bind to no column: ${unbound.join(', ')}`);
  }
  const ambiguous = [...enumsByColumn.entries()].filter(([, e]) => e.length > 1);
  if (ambiguous.length > 0) {
    console.log(`  ${ambiguous.length} column(s) fit more than one enum, reported not guessed:`);
    for (const [column, enums] of ambiguous.slice(0, 6)) {
      console.log(`    ${column} fits ${enums.join(' and ')}`);
    }
  }
  console.log(`  ${valuesByColumn.size} enum-shaped columns, `
    + `${[...columnsByEnum.values()].reduce((n, c) => n + c.length, 0)} (enum, column) bindings`);

  // An unemitted value is a coverage statement about the corpora actually
  // extracted, not necessarily a defect — so it is REPORTED, and the reserved
  // half above is what is ASSERTED. Pass `--corpus` to make the report mean
  // something: on the scaffold alone almost everything is unexercised.
  if (unemitted.length > 0) {
    console.log(`  ${unemitted.length} declared value(s) not exercised:`);
    console.log(`    ${unemitted.slice(0, 12).join(', ')}`
      + (unemitted.length > 12 ? `, +${unemitted.length - 12} more` : ''));
  }
  return failures;
}

/**
 * The three columns the schema asserts are constant in every row.
 *
 * `js_type_reference.isTypeOnly` is `true` everywhere; `js_call_site.isTypeOnlyTarget`
 * and `js_expression.isTypeOnlyReachable` are `false` everywhere. Together they
 * are the statement that **no type-only construct reaches the call graph** —
 * which in JavaScript means a JSDoc `@typedef` or `@callback`, and `@callback`
 * names a callable shape and is exactly the row most likely to be mistaken for a
 * call target.
 */
function typeOnlyIsolation(): number {
  let failures = 0;
  const expectations: ReadonlyArray<readonly [string, string, string]> = [
    ['js_type_reference', 'isTypeOnly', 'true'],
    ['js_call_site', 'isTypeOnlyTarget', 'false'],
    ['js_expression', 'isTypeOnlyReachable', 'false'],
  ];
  let checked = 0;
  for (const [relationName, columnName, expected] of expectations) {
    const relation = readRelations(outputDir).find((r) => r.name === relationName);
    if (relation === undefined || relation.header.length === 0) {
      continue;
    }
    const column = relation.header.indexOf(columnName);
    if (column < 0) {
      failures += fail(`${relationName}: no column ${columnName}`);
      continue;
    }
    for (const row of relation.rows) {
      checked += 1;
      if (row[column] !== expected) {
        failures += fail(`${relationName}.${columnName} is ${row[column]} where the schema `
          + `asserts ${expected} in every row`);
      }
    }
  }
  if (checked === 0) {
    failures += fail('no row was checked — the type-only isolation assertion is vacuous');
  }
  return failures;
}

/**
 * The hoisting model, asserted rather than assumed.
 *
 * Gate 7.3.3: every `VAR_*` binding's declaration scope has
 * `isFunctionScope = true`. That is what `var` hoisting MEANS, and it fails
 * loudly if the binder ever regresses to a single scope column — which is the
 * §3 defect class this relation exists to avoid.
 *
 * The non-vacuity half matters as much: a corpus with no `var` in a block makes
 * the assertion untestable, and the scaffold has one for exactly that reason.
 */
function hoistingModelHolds(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const scopes = relations.find((r) => r.name === 'js_scope');
  const variables = relations.find((r) => r.name === 'js_variable');
  if (scopes === undefined || variables === undefined
    || scopes.header.length === 0 || variables.header.length === 0) {
    return fail('js_scope or js_variable has no rows');
  }
  const scopePk = pkIndexOf(scopes.header, 'js_scope');
  const isFunctionScope = scopes.header.indexOf('isFunctionScope');
  const functionScopes = new Set(
    scopes.rows.filter((row) => row[isFunctionScope] === 'true').map((row) => row[scopePk])
  );
  const regime = variables.header.indexOf('bindingRegime');
  const declarationScope = variables.header.indexOf('declarationScopeLinkHash');
  const syntacticScope = variables.header.indexOf('syntacticScopeLinkHash');
  const name = variables.header.indexOf('name');

  let vars = 0;
  let hoistedOutOfABlock = 0;
  for (const row of variables.rows) {
    if (!(row[regime] ?? '').startsWith('VAR_')) {
      continue;
    }
    vars += 1;
    if (!functionScopes.has(row[declarationScope] ?? '')) {
      failures += fail(`js_variable ${row[name]}: a VAR_* binding whose declaration scope is `
        + 'not a function scope. That is the hoisting model broken, and it is unrecoverable '
        + 'from anything else in the fact base');
    }
    if (row[declarationScope] !== row[syntacticScope]) {
      hoistedOutOfABlock += 1;
    }
  }
  if (vars === 0) {
    failures += fail('no VAR_* binding in the corpus — the hoisting assertion is vacuous');
  }
  if (hoistedOutOfABlock === 0) {
    failures += fail('no `var` in the corpus differs between its declaration and syntactic '
      + 'scope, so the TWO-COLUMN hoisting model is untested — one column would pass this');
  }
  return failures;
}

/**
 * Every module-edge expression is pointed at by an edge row, and no binding is
 * minted twice.
 *
 * Gate 7.3.1, and the check that stops the §2.1 second pass double-minting. 83.6%
 * of module edges are minted from expressions, and a pass that mints twice
 * **doubles** the module-edge count rather than colliding — the row counts stay
 * plausible and nothing else reports it.
 *
 * ## Not literally "exactly one" — §7.3.1 moved, and this is the ruled form
 *
 * The schema said *exactly one*, and its own §3.8 said `startColumn` is in
 * `js_import`'s key because `const { a, b } = require('x')` **produces two rows
 * on one line with one specifier**. Both could not be true. Raised rather than
 * resolved here, and `js-oracle` measured it: **1,249 of 9,055 require
 * expressions — 13.8% — bind more than one name, and the widest binds 107.**
 * "Exactly one" would have failed on every one of them.
 *
 * The three clauses below were adopted verbatim, and Appendix B invariant 6
 * corrected to match:
 *
 * 1. at least one edge row per flagged expression;
 * 2. every edge row's source expression is flagged;
 * 3. **no `(source expression, bound name)` pair twice.**
 *
 * Clause 3 carries the original intent. The failure the gate exists for is the
 * second pass minting one edge twice, and duplicates **double** rather than
 * collide. It has no false positives, because a repeated binding is impossible
 * in legal source — `const { a: x, b: x }` is a redeclaration error.
 *
 * Verified on the widest measured shape: one `require` binding 107 names emits
 * 107 rows with 107 distinct `startColumn`s, 107 distinct primary keys and one
 * shared `sourceExpressionLinkHash`.
 */
function moduleEdgeOneToOne(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const expressions = relations.find((r) => r.name === 'js_expression');
  if (expressions === undefined || expressions.header.length === 0) {
    return fail('js_expression has no rows');
  }
  const isModuleEdge = expressions.header.indexOf('isModuleEdge');
  const pk = pkIndexOf(expressions.header, 'js_expression');
  const flagged = new Set(
    expressions.rows.filter((row) => row[isModuleEdge] === 'true').map((row) => row[pk])
  );

  const counts = new Map<string, number>();
  for (const relationName of ['js_import', 'js_export']) {
    const relation = relations.find((r) => r.name === relationName);
    if (relation === undefined || relation.header.length === 0) {
      continue;
    }
    const source = relation.header.indexOf('sourceExpressionLinkHash');
    for (const row of relation.rows) {
      const value = row[source] ?? '';
      if (value === '') {
        continue;
      }
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  // §3.8.1: a COMMENT-borne import has no expression and pairs the OTHER way —
  // at least one js_type_reference.importLinkHash must point at it. A row
  // nothing points at was minted for no reference, which is the double-mint
  // this gate exists for, through the other end.
  // That holds for an import TYPE row, minted per occurrence and binding
  // nothing. An `@import` TAG row (#621) binds a name and is a declaration: it
  // may go unused exactly as a runtime `import` may, so only the pairing with
  // the expression side is asserted on it.
  const importsRelation = relations.find((r) => r.name === 'js_import');
  const references = relations.find((r) => r.name === 'js_type_reference');
  if (importsRelation !== undefined && references !== undefined) {
    const iPk = pkIndexOf(importsRelation.header, 'js_import');
    const iBearer = importsRelation.header.indexOf('edgeBearer');
    const iBinding = importsRelation.header.indexOf('bindingForm');
    const iSource = importsRelation.header.indexOf('sourceExpressionLinkHash');
    const rImport = references.header.indexOf('importLinkHash');
    const pointedAt = new Set(references.rows.map((r) => r[rImport] ?? '').filter((v) => v !== ''));
    let commentRows = 0;
    for (const row of importsRelation.rows) {
      if (row[iBearer] !== 'COMMENT') {
        continue;
      }
      commentRows += 1;
      if ((row[iSource] ?? '') !== '') {
        failures += fail(`js_import ${row[iPk]}: COMMENT-borne with a sourceExpressionLinkHash — `
          + 'a comment has no expression');
      }
      if (row[iBinding] === 'NO_LOCAL_BINDING' && !pointedAt.has(row[iPk] ?? '')) {
        failures += fail(`js_import ${row[iPk]}: COMMENT-borne and no js_type_reference.importLinkHash `
          + 'points at it — minted for no reference');
      }
    }
    if (commentRows === 0) {
      failures += fail('no COMMENT-borne import in the scaffold — the reverse pairing is untested');
    }
  }
  for (const hash of flagged) {
    const count = counts.get(hash ?? '') ?? 0;
    if (count < 1) {
      failures += fail(`js_expression ${hash}: isModuleEdge with no edge row pointing at it — `
        + 'the flag and the link are set in one place, so one without the other is a defect');
    }
  }
  for (const [hash] of counts) {
    if (!flagged.has(hash)) {
      failures += fail(`an edge row cites expression ${hash}, which is not flagged `
        + 'isModuleEdge — the flag and the link are set in one place so they cannot diverge');
    }
  }

  // The check that actually stops double-minting, stated per BINDING rather than
  // per expression. `const { a, b } = require('x')` is ONE require expression and
  // TWO import rows, which the schema requires — `startColumn` is in
  // `js_import`'s primary key precisely so those two do not collide. So "exactly
  // one edge row per flagged expression" contradicts the schema's own key
  // design, and the invariant that catches the failure it was written for is
  // that no (source expression, bound name) pair appears twice.
  const seenBindings = new Set<string>();
  for (const relationName of ['js_import', 'js_export']) {
    const relation = relations.find((r) => r.name === relationName);
    if (relation === undefined || relation.header.length === 0) {
      continue;
    }
    const source = relation.header.indexOf('sourceExpressionLinkHash');
    const nameColumn = relation.header.indexOf(
      relationName === 'js_import' ? 'localName' : 'exportedName'
    );
    for (const row of relation.rows) {
      const value = row[source] ?? '';
      if (value === '') {
        continue;
      }
      const key = `${relationName}:${value}:${row[nameColumn] ?? ''}`;
      if (seenBindings.has(key)) {
        failures += fail(`${relationName}: two rows mint the same binding from one `
          + 'expression. A second pass that double-mints DOUBLES the edge count rather than '
          + 'colliding, and every row count stays plausible');
      }
      seenBindings.add(key);
    }
  }

  if (flagged.size === 0) {
    failures += fail('no module-edge expression in the corpus — the 1:1 assertion is vacuous');
  }
  // Non-vacuity for the destructured case specifically, which is the shape that
  // makes the per-expression count greater than one.
  const destructured = relations.find((r) => r.name === 'js_import');
  if (destructured !== undefined && destructured.header.length > 0) {
    const form = destructured.header.indexOf('bindingForm');
    if (!destructured.rows.some((row) => row[form] === 'DESTRUCTURED')) {
      failures += fail('no destructured require in the corpus, so the one-expression / '
        + 'many-bindings case is untested');
    }
  }
  return failures;
}

/**
 * One `js_call_site` per call-like `js_expression`, **excluding `require()`**.
 *
 * `require` is a module edge by ruling: counting its 9,055 measured sites as
 * unresolved calls is what made the raw resolution figure look worse than it is.
 * `import()` is BOTH, because unlike `require` its result flows somewhere.
 */
function callSiteOneToOne(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const expressions = relations.find((r) => r.name === 'js_expression');
  const callSites = relations.find((r) => r.name === 'js_call_site');
  if (expressions === undefined || callSites === undefined
    || expressions.header.length === 0) {
    return fail('js_expression or js_call_site has no rows');
  }
  const kind = expressions.header.indexOf('expressionKind');
  const link = expressions.header.indexOf('callSiteLinkHash');
  const text = expressions.header.indexOf('text');
  const callLike = new Set(['CALL', 'NEW', 'TAGGED_TEMPLATE']);

  let expected = 0;
  for (const row of expressions.rows) {
    const isDynamicImport = (row[text] ?? '').startsWith('import(');
    if (!callLike.has(row[kind] ?? '') && !isDynamicImport) {
      continue;
    }
    if ((row[kind] ?? '') === 'MODULE_EDGE_CALL' && !isDynamicImport) {
      continue;
    }
    expected += 1;
    if ((row[link] ?? '') === '') {
      failures += fail(`js_expression L${row[expressions.header.indexOf('startLine')]}: a `
        + 'call-like expression with no call-site row');
    }
  }
  if (callSites.rows.length !== expected) {
    failures += fail(`js_call_site has ${callSites.rows.length} rows for ${expected} `
      + 'call-like expressions — the 1:1 is broken');
  }
  if (expected === 0) {
    failures += fail('no call-like expression in the corpus — the 1:1 assertion is vacuous');
  }
  // A require() must NOT have one.
  for (const row of expressions.rows) {
    if ((row[kind] ?? '') !== 'MODULE_EDGE_CALL') {
      continue;
    }
    if ((row[text] ?? '').startsWith('require(') && (row[link] ?? '') !== '') {
      failures += fail('a require() call has a js_call_site row. It is a module edge by '
        + 'ruling, and counting its sites as unresolved calls is what made the raw '
        + 'resolution figure look worse than it is');
    }
  }
  return failures;
}

/**
 * Several discovered roots produce ONE flat set, with no file extracted twice.
 *
 * ## The defect this exists for was invisible to every other check here
 *
 * `analyze` publishes a complete relation set to its output directory. Calling
 * it once per discovered project against one directory does not merge those sets
 * — it **overwrites** them, so every project but the last vanishes — and
 * concurrently it also races on the temporary files. Both happened on the first
 * run through the real entry point, and neither could happen in a harness that
 * calls the analyzer once.
 *
 * The second half matters as much: a monorepo root and its `packages/*` are all
 * discovered as projects, and every file under a package is reachable from both.
 * Extracting one twice mints identical primary keys and **doubles** the row
 * count rather than colliding.
 */
async function severalRootsProduceOneSet(): Promise<number> {
  let failures = 0;
  const outputForRoots = scratchDir('js-gate-roots-');
  // Deliberately OVERLAPPING: the corpus root claims every file, and `cjs`
  // claims a subset of them again.
  await new JavaScriptProjectAnalyzer().analyzeAll(
    // The same two roots the baseline run used, plus two that OVERLAP the first
    // entirely. The extra roots must add nothing: every file under them is
    // already claimed, and extracting one twice mints an identical primary key.
    [corpusDir, unpackagedDir, path.join(corpusDir, 'cjs'), path.join(corpusDir, 'esm')],
    {
      outputDir: outputForRoots,
      baseMservPath: 'scaffold',
      serviceVersionLink: 'gate-v1',
    }
  );

  const single = readRelations(outputDir).find((r) => r.name === 'js_module');
  const multi = readRelations(outputForRoots).find((r) => r.name === 'js_module');
  if (single === undefined || multi === undefined) {
    fs.rmSync(outputForRoots, { recursive: true, force: true });
    return fail('js_module missing from one of the two runs');
  }
  if (multi.rows.length !== single.rows.length) {
    failures += fail(`four overlapping roots produced ${multi.rows.length} js_module rows `
      + `where one root produced ${single.rows.length}. A file claimed by two roots must be `
      + 'extracted once — extracting it twice DOUBLES the row count rather than colliding');
  }
  failures += checkPkAndFk(outputForRoots, 'multi-root');
  // And the sets must be identical, not merely the same size: an overwrite that
  // happened to drop and re-add the same number of rows would pass a count.
  const pk = pkIndexOf(single.header, 'js_module');
  const singleKeys = new Set(single.rows.map((row) => row[pk]));
  for (const row of multi.rows) {
    if (!singleKeys.has(row[pk])) {
      failures += fail(`multi-root run emitted a js_module row the single-root run did not: `
        + `${row[single.header.indexOf('filePath')]}`);
    }
  }
  fs.rmSync(outputForRoots, { recursive: true, force: true });
  return failures;
}

/**
 * Package specifiers resolve under the importing SITE's `exports` conditions.
 *
 * A package that publishes only an `exports` map, with `require` and `import`
 * conditions, is loaded by the runtime as `dist/main.cjs` from `require()` and as
 * `dist/main.mjs` from `import`; a subpath export and a `main`-only package
 * resolve either way. Resolved under `Node10` a `require()` of such a package was
 * UNRESOLVED_MISSING, and resolved without the mode an ES `import` was linked to
 * the CommonJS build the runtime never loads (#601). The fixture is written here
 * with its own `node_modules`, which the analyzer does not walk but the resolver
 * reads, and each row is checked against what `node` loads for the same file.
 */
async function packageSpecifiersResolveUnderTheSiteConditions(): Promise<number> {
  let failures = 0;
  const root = scratchDir('js-gate-exports-');
  const out = scratchDir('js-gate-exports-out-');
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('package.json', '{ "name": "exports-fixture" }');
  write('node_modules/pkg/package.json', JSON.stringify({ name: 'pkg', exports: { '.': { require: './dist/main.cjs', import: './dist/main.mjs' }, './sub': './lib/sub.js' } }));
  write('node_modules/pkg/dist/main.cjs', 'exports.hello = function hello() { return 1; };\n');
  write('node_modules/pkg/dist/main.mjs', 'export function hello() { return 2; }\n');
  write('node_modules/pkg/lib/sub.js', 'exports.sub = function sub() { return 3; };\n');
  write('node_modules/legacy/package.json', '{ "name": "legacy", "main": "./entry.js" }');
  write('node_modules/legacy/entry.js', 'exports.old = 1;\n');
  write('node_modules/bare/package.json', '{ "name": "bare" }');
  write('node_modules/bare/index.js', 'exports.idx = 1;\n');
  write('lib/index.js', 'exports.dir = 1;\n');
  write('app.cjs', "const a = require('pkg'); const b = require('pkg/sub'); const c = require('legacy'); const d = require('bare'); const e = require('./lib');\n");
  write('app.mjs', "import a from 'pkg'; import b from 'pkg/sub'; import c from 'legacy'; import d from 'bare'; const e = await import('pkg');\n");
  write('esm/package.json', '{ "type": "module" }');
  write('esm/app.js', "import a from 'pkg'; import b from './helper.js'; const c = await import('./helper.js');\n");
  write('esm/helper.js', 'export const h = 1;\n');
  await new JavaScriptProjectAnalyzer().analyzeAll([root], { outputDir: out, baseMservPath: root, serviceVersionLink: 'gate-v1' });
  const relations = readRelations(out);
  const imports = relations.find((r) => r.name === 'js_import');
  const modules = relations.find((r) => r.name === 'js_module');
  if (imports === undefined || modules === undefined || imports.header.length === 0) {
    return fail('the exports fixture produced no js_import rows');
  }
  const fileOf = new Map(modules.rows.map((row) => [row[pkIndexOf(modules.header, 'js_module')] ?? '', row[modules.header.indexOf('filePath')] ?? '']));
  const spec = imports.header.indexOf('specifier'), owner = imports.header.indexOf('ownerModuleLinkHash');
  const resolved = imports.header.indexOf('resolvedFilePath'), outcome = imports.header.indexOf('resolutionOutcome');
  // what `node` loads for each (file, specifier), as the resolver must answer it
  const want: Array<[string, string, string]> = [
    ['app.cjs', 'pkg', 'node_modules/pkg/dist/main.cjs'],
    ['app.cjs', 'pkg/sub', 'node_modules/pkg/lib/sub.js'],
    ['app.cjs', 'legacy', 'node_modules/legacy/entry.js'],
    ['app.cjs', 'bare', 'node_modules/bare/index.js'],
    ['app.cjs', './lib', 'lib/index.js'],
    ['app.mjs', 'pkg', 'node_modules/pkg/dist/main.mjs'],
    ['app.mjs', 'pkg/sub', 'node_modules/pkg/lib/sub.js'],
    ['app.mjs', 'legacy', 'node_modules/legacy/entry.js'],
    ['app.mjs', 'bare', 'node_modules/bare/index.js'],
    ['esm/app.js', 'pkg', 'node_modules/pkg/dist/main.mjs'],
    ['esm/app.js', './helper.js', 'esm/helper.js'],
  ];
  for (const [file, specifier, target] of want) {
    const rows = imports.rows.filter((row) => fileOf.get(row[owner] ?? '') === file && row[spec] === specifier);
    if (rows.length === 0) { failures += fail(`${file}: no js_import row for '${specifier}'`); continue; }
    for (const row of rows) {
      const got = (row[resolved] ?? '').replace(/\\/g, '/');
      // a project file is recorded extension-less (it joins js_module.qualifiedName)
      const stripped = target.replace(/\.(js|mjs|cjs)$/, '');
      const ok = got === target || got.endsWith('/' + target) || (row[outcome] === 'RESOLVED_PROJECT' && got === stripped);
      if (!ok) {
        failures += fail(`${file} '${specifier}': resolvedFilePath is '${got || '(empty)'}' `
          + `(${row[outcome]}); node loads ${target}`);
      }
    }
  }
  return failures;
}

/**
 * A member declared under a computed name links its KEY, and a literal key names it.
 *
 * `[kRun]() {}` had an empty `name` and no link to `kRun`, so a symbol-keyed member
 * could not be joined to its key at all; and `['lit']() {}` was equally nameless
 * although the syntax fixes the name (#598). Asserted here on a class method, a
 * getter, a class field, an object-literal method, a prototype-literal method and
 * a prototype-literal function property: the literal keys fill `name`, the dynamic
 * ones link an expression rooted COMPUTED_NAME whose binding is the key's `const`,
 * and every link points at an expression inside the member's own span.
 */
async function computedMemberNamesLinkTheirKey(): Promise<number> {
  let failures = 0;
  const root = scratchDir('js-gate-computed-');
  const out = scratchDir('js-gate-computed-out-');
  fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "computed" }');
  fs.writeFileSync(path.join(root, 'queue.js'), [
    "const kRun = Symbol('run');",
    "const kField = Symbol('field');",
    'class Queue {',
    '  [kRun]() { return 1; }',
    '  [`tpl`]() { return 2; }',
    "  ['lit']() { return 3; }",
    '  [42]() { return 4; }',
    "  get ['acc']() { return 5; }",
    '  [kField] = 6;',
    "  ['named'] = 7;",
    '}',
    'const o = { [kRun]() { return 8; }, [`olit`]() { return 9; } };',
    'function P() {}',
    "P.prototype = { [kRun]: function () { return 10; }, ['plit']() { return 11; } };",
    'module.exports = { Queue, o, P };',
    '',
  ].join('\n'));
  await new JavaScriptProjectAnalyzer().analyzeAll([root], { outputDir: out, baseMservPath: root, serviceVersionLink: 'gate-v1' });
  const relations = readRelations(out);
  const methods = relations.find((r) => r.name === 'js_method');
  const fields = relations.find((r) => r.name === 'js_field');
  const expressions = relations.find((r) => r.name === 'js_expression');
  const variables = relations.find((r) => r.name === 'js_variable');
  if (!methods || !fields || !expressions || !variables) return fail('computed fixture: a relation is missing');
  const col = (rel: Relation, c: string): number => rel.header.indexOf(c);
  const exprByHash = new Map(expressions.rows.map((r) => [r[pkIndexOf(expressions.header, 'js_expression')] ?? '', r]));
  const varNameByHash = new Map(variables.rows.map((r) => [r[pkIndexOf(variables.header, 'js_variable')] ?? '', r[col(variables, 'name')] ?? '']));
  const methodAt = (line: number) => methods.rows.find((r) => Number(r[col(methods, 'startLine')]) === line && r[col(methods, 'methodKind')] !== 'MODULE_INITIALIZER');
  const fieldAt = (line: number) => fields.rows.find((r) => Number(r[col(fields, 'startLine')]) === line);
  // line, relation, expected name, expected key binding ('' for a literal key)
  const want: Array<[number, 'method' | 'field', string, string]> = [
    [4, 'method', '', 'kRun'], [5, 'method', 'tpl', ''], [6, 'method', 'lit', ''], [7, 'method', '42', ''],
    [8, 'method', 'acc', ''], [9, 'field', '', 'kField'], [10, 'field', 'named', ''],
    [12, 'method', '', 'kRun'], [14, 'method', '', 'kRun'],
  ];
  for (const [line, kind, name, key] of want) {
    const rel = kind === 'method' ? methods : fields;
    const row = kind === 'method' ? methodAt(line) : fieldAt(line);
    if (!row) { failures += fail(`line ${line}: no ${kind} row`); continue; }
    const got = row[col(rel, 'name')] ?? '';
    if (got !== name) failures += fail(`line ${line}: name is '${got}', want '${name}'`);
    const link = row[col(rel, 'computedNameExpressionLinkHash')] ?? '';
    if (link === '') { failures += fail(`line ${line}: no computedNameExpressionLinkHash`); continue; }
    const e = exprByHash.get(link);
    if (!e) { failures += fail(`line ${line}: the key link names no js_expression row`); continue; }
    // a declaration-form member roots its key under COMPUTED_NAME; a property of a
    // prototype literal (`P.prototype = { [k]: f }`) carries the key as the literal's
    // COMPUTED_KEY child, inside the assignment's own tree
    const rooted = e[col(expressions, 'rootContext')] === 'COMPUTED_NAME' || e[col(expressions, 'edgeRole')] === 'COMPUTED_KEY';
    if (!rooted) failures += fail(`line ${line}: the key expression is rooted ${e[col(expressions, 'rootContext')]} with edge role ${e[col(expressions, 'edgeRole')]}, want COMPUTED_NAME or COMPUTED_KEY`);
    if (Number(e[col(expressions, 'startLine')]) !== line) failures += fail(`line ${line}: the key expression sits on line ${e[col(expressions, 'startLine')]}`);
    if (key !== '') {
      const bound = varNameByHash.get(e[col(expressions, 'resolvedBindingLinkHash')] ?? '') ?? '';
      if (bound !== key) failures += fail(`line ${line}: the key resolves to '${bound}', want the const ${key}`);
    }
  }
  // literal-key members on a line that also has a written-name sibling must not gain a link
  const plain = methods.rows.filter((r) => (r[col(methods, 'computedNameExpressionLinkHash')] ?? '') !== '' && ![4, 5, 6, 7, 8, 12, 14].includes(Number(r[col(methods, 'startLine')])));
  if (plain.length > 0) failures += fail(`${plain.length} method row(s) carry a key link without a computed name: lines ${plain.map((r) => r[col(methods, 'startLine')]).join(', ')}`);
  return failures;
}

/**
 * A reference to a binding declared inside a destructuring pattern WITH a default
 * links the default's root expression (c35, #673).
 *
 * `({ mapper = twice } = {})` rooted `twice` as a free PARAMETER_DEFAULT and the
 * reference `mapper` carried only its parameter and path, so the engine saw what a
 * caller passed and nothing of the default. Asserted on an object pattern parameter,
 * a nested one, an array pattern parameter, a variable pattern, and a top-level
 * parameter default and a plain binding as controls (no c35).
 */
async function patternBindingDefaultsAreLinked(): Promise<number> {
  let failures = 0;
  const root = scratchDir('js-gate-defaults-');
  const out = scratchDir('js-gate-defaults-out-');
  fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "defaults" }');
  fs.writeFileSync(path.join(root, 'main.js'), [
    'function inc(x) { return x + 1; }',
    'function twice(x) { return x * 2; }',
    'function withDefault(cb = () => 0, { mapper = twice } = {}) { return mapper(cb()); }',           // 3
    'function nested({ opts: { run = inc } = {} } = {}) { return run(1); }',                            // 4
    'function fromArray([first = twice, second] = []) { return first(second); }',                       // 5
    'function fromVariable(o) { const { handler = inc, plain } = o; return handler(plain); }',          // 6
    'withDefault(); nested(); fromArray(); fromVariable({});',
    '',
  ].join('\n'));
  await new JavaScriptProjectAnalyzer().analyzeAll([root], { outputDir: out, baseMservPath: root, serviceVersionLink: 'gate-v1' });
  const relations = readRelations(out);
  const expressions = relations.find((r) => r.name === 'js_expression');
  if (!expressions) return fail('defaults fixture: js_expression missing');
  const col = (c: string): number => expressions.header.indexOf(c);
  const byHash = new Map(expressions.rows.map((r) => [r[pkIndexOf(expressions.header, 'js_expression')] ?? '', r]));
  const refs = (name: string, line: number) => expressions.rows.filter((r) => r[col('expressionKind')] === 'IDENTIFIER' && r[col('text')] === name
    && Number(r[col('startLine')]) === line && r[col('rootContext')] !== 'PARAMETER_DEFAULT' && r[col('rootContext')] !== 'VARIABLE_INITIALIZER');
  // name, line of the reference, text of the default it must link
  const want: Array<[string, number, string]> = [['mapper', 3, 'twice'], ['run', 4, 'inc'], ['first', 5, 'twice'], ['handler', 6, 'inc']];
  for (const [name, line, def] of want) {
    const rows = refs(name, line).filter((r) => (r[col('referenceKind')] ?? '') !== '' || (r[col('resolvedParameterLinkHash')] ?? '') !== '' || (r[col('resolvedBindingLinkHash')] ?? '') !== '');
    const ref = rows.find((r) => (r[col('bindingDefaultLinkHash')] ?? '') !== '') ?? rows[0];
    if (!ref) { failures += fail(`${name} on line ${line}: no reference row`); continue; }
    const link = ref[col('bindingDefaultLinkHash')] ?? '';
    if (link === '') { failures += fail(`${name} on line ${line}: no bindingDefaultLinkHash`); continue; }
    const d = byHash.get(link);
    if (!d) { failures += fail(`${name}: the default link names no js_expression row`); continue; }
    if ((d[col('text')] ?? '') !== def) failures += fail(`${name}: the default links '${d[col('text')]}', want '${def}'`);
    if ((d[col('parentExpressionLinkHash')] ?? '') !== '') failures += fail(`${name}: the linked default is not a root expression`);
  }
  // controls: a top-level parameter default and a binding with no default link nothing
  for (const [name, line] of [['cb', 3], ['second', 5], ['plain', 6]] as Array<[string, number]>) {
    const bad = refs(name, line).filter((r) => (r[col('bindingDefaultLinkHash')] ?? '') !== '');
    if (bad.length > 0) failures += fail(`${name} on line ${line}: carries a default link it should not`);
  }
  return failures;
}

/**
 * IR completeness — the measure that replaces "resolution rate".
 *
 * ## What is asserted, and what is only reported
 *
 * Exactly one bucket is a **defect**: a call site whose receiver came through an
 * import and which carries no `importLinkHash`. That row is unreconstructable by
 * any engine, and it is invisible to every count-based check because the row
 * exists and is correctly positioned. It is asserted at zero.
 *
 * Every other bucket is **reported per bucket and never asserted**, because the
 * numbers measure the code rather than the parser. `receiver untyped` at 43% on
 * a real corpus is what JavaScript is — the oracle itself decides only 52.6% of
 * call sites — and a gate with a bar on it would fail on a corpus that happens
 * to contain more `obj.method()` and pass on one that contains less.
 *
 * `ambient/builtin target` is the one most likely to be misread as a gap. It is
 * 15.3-24.4% of the oracle's own declines, the target lives in the `lib_*` population
 * rather than anywhere in the repository, and no amount of installing
 * dependencies changes it. Counting it as incomplete reports a defect population
 * that does not exist, which §7 is entirely about.
 */
function irCompleteness(): number {
  let failures = 0;
  if (scaffoldSummary === undefined) {
    return fail('the scaffold was not extracted');
  }
  for (const line of formatCompleteness(scaffoldSummary.irCompleteness)) {
    console.log(line);
  }
  if (scaffoldSummary.irCompleteness.importHopMissing > 0) {
    failures += fail(`${scaffoldSummary.irCompleteness.importHopMissing} call site(s) reach `
      + 'their receiver through an import and carry no importLinkHash. The row is correctly '
      + 'positioned and unreconstructable by any engine — the one incompleteness that is a '
      + 'parser defect rather than a property of the code');
  }
  if (scaffoldSummary.irCompleteness.callSites === 0) {
    failures += fail('no call sites — the completeness measure is vacuous');
  }
  // Non-vacuity per bucket: a corpus exercising only one shape would make the
  // rest silently untested, and the buckets are not interchangeable.
  const exercised = [
    scaffoldSummary.irCompleteness.importHop.total,
    scaffoldSummary.irCompleteness.ambientTarget.total,
    scaffoldSummary.irCompleteness.honestlyUnresolvable.total,
  ].filter((total) => total > 0).length;
  if (exercised < 3) {
    failures += fail('the scaffold exercises fewer than three completeness buckets, so the '
      + 'per-bucket report is not actually per bucket');
  }
  return failures;
}

/**
 * Every always-empty column is one someone decided should be empty.
 *
 * ## The column-level counterpart of the enum audit, and it found ten gaps
 *
 * §4's argument for the enum audit applies unchanged one level down: a column
 * that is never populated has three possible explanations and you cannot tell
 * them apart without looking — a real gap, a deliberate reservation, or a
 * property of the corpus. Run over 816 real files, this found **ten** columns
 * that were simply never filled, including `js_type_heritage.importLinkHash` and
 * `resolvedFilePath` — two of the three hops §0 says make a row complete, on the
 * relation that records inheritance.
 *
 * So the allowlist below is the claim, and anything outside it fails. A column
 * that stops being populated shows up as a named failure rather than as rows
 * nobody looked at.
 *
 * The check runs over the **corpus** when one is given, because the scaffold is
 * too small to populate a column like `isReadonly` and would therefore report
 * half the schema as unfilled.
 */
const EXPECTED_EMPTY_COLUMNS: Readonly<Record<string, string>> = {
  // Parity slots: held at TypeScript's or Java's position so the engine's
  // projection ports as a rename, and permanently empty because the construct
  // does not exist in this language.
  'isExternal': 'parity slot — always false on parser output',
  'js_method_parameter.isParameterProperty': 'JavaScript has no parameter properties',
  'js_method.methodReferenceKind': 'JavaScript has no `::`',
  'js_method.isEntryPoint': 'no syntax marks an entry point; naming one would be guessing',
  'js_type.isAbstract': 'JavaScript has no `abstract`',
  'js_type.modifiers': 'a class declaration carries none; `static` is on its members',
  // TIER 3: declared and never staged. Cross-file resolution is the engine's.
  'js_call_site.resolvedMethodLinkHash': 'tier 3 — the engine resolves',
  'js_import.resolvedModuleLinkHash': 'tier 3 — the engine resolves',
  'js_type_heritage.resolvedTypeLinkHash': 'tier 3 — the engine resolves',
  'js_type_reference.resolvedTypeLinkHash': 'tier 3 — the engine resolves',
  // Asserted constant by the type-only isolation gate.
  'js_call_site.isTypeOnlyTarget': 'asserted false in every row',
  'js_expression.isTypeOnlyReachable': 'asserted false in every row',
  // Emitted, but only by constructs a given corpus may not contain. The check
  // unions the scaffold with the corpus, so anything the scaffold exercises is
  // covered and does not belong here — these two are exercised by neither.
  'js_type_reference.isTruncated': 'a JSDoc type nested past depth 32',
  'js_type.sourceExpressionLinkHash': 'a type declared BY an assignment, such as '
    + '`Foo.prototype = class {}`; rare enough that no corpus here has one',
};

function everyEmptyColumnIsIntended(): number {
  if (extraOutputDir === '') {
    // Needs SCALE to mean anything. On a fifteen-file scaffold almost every
    // column is empty for want of a construct, so the check would report the
    // schema as unfilled and teach nothing. Reported, never silently skipped.
    return fail('DEV-ONLY check ran with no corpus: on the scaffold alone almost every column '
      + 'is empty for want of a construct. A sweep with no input is a failure, never a pass');
  }
  let failures = 0;
  const unexplained: string[] = [];
  // The UNION of both corpora: a column the scaffold exercises — JSX, `with`,
  // a defineProperty `writable: false` — is populated, and requiring the large
  // corpus to contain every construct would put corpus properties on an
  // allowlist that is supposed to hold decisions.
  const populatedAnywhere = new Set<string>();
  for (const source of [outputDir, extraOutputDir]) {
    for (const { name, file } of relationFilesIn(source)) {
      let header: string[] = [];
      streamRows(path.join(source, file), (line, index) => {
        const cells = line.split('\t');
        if (index === 0) {
          header = cells;
          return;
        }
        for (let i = 0; i < cells.length && i < header.length; i += 1) {
          if (cells[i] !== '' && cells[i] !== 'false') {
            populatedAnywhere.add(`${name}.${header[i]}`);
          }
        }
      });
    }
  }
  for (const { name, file } of relationFilesIn(extraOutputDir)) {
    let header: string[] = [];
    let rows = 0;
    streamRows(path.join(extraOutputDir, file), (line, index) => {
      if (index === 0) {
        header = line.split('\t');
        return;
      }
      rows += 1;
    });
    if (rows === 0) {
      continue;
    }
    for (const columnName of header) {
      const qualified = `${name}.${columnName}`;
      // `false` counts as unpopulated: a boolean column that is false in every
      // row carries no more information than an empty one, and the gaps this
      // check exists to find were mostly booleans nobody set.
      if (populatedAnywhere.has(qualified)) {
        continue;
      }
      if (qualified in EXPECTED_EMPTY_COLUMNS || columnName in EXPECTED_EMPTY_COLUMNS) {
        continue;
      }
      unexplained.push(qualified);
    }
  }
  if (unexplained.length > 0) {
    failures += fail(`${unexplained.length} column(s) are never populated and are not on the `
      + 'allowlist. Each is a real gap, a reservation nobody wrote down, or a corpus property '
      + 'nobody named — and you cannot tell which without looking:');
    for (const column of unexplained) {
      failures += fail(`    ${column}`);
    }
  }
  // The allowlist must not outlive its reasons: an entry for a column that is
  // now populated is a stale claim, and a stale allowlist is how a gate stops
  // checking something without anyone deciding that it should.
  console.log(`  ${Object.keys(EXPECTED_EMPTY_COLUMNS).length} allowlisted, `
    + `${unexplained.length} unexplained, over the union of the scaffold and the corpus`);
  return failures;
}

/**
 * Every fixture's `nature:` header is true of its contents.
 *
 * ## Asked for by name, by the agent that owns the fixtures
 *
 * `MANIFEST.md`, finding 5: *the nature label should be a gate, not a
 * convention* — and the reason given is that the TypeScript manifest records
 * **five files that were mislabelled** until `ts-impl` caught one by hand. A
 * label nobody checks is a label that drifts, and the fixture that drifts is the
 * one an expectation was written against.
 *
 * In JavaScript the predicate is exact, which is why the rule can be a gate at
 * all:
 *
 * > A file may declare `nature: type-only` only if
 * > `ts.createSourceFile(...).statements.length === 0`. A file declaring
 * > `runtime-bearing` must have at least one statement. Both header lines must
 * > be present.
 *
 * It is enforced HERE rather than in the fixture tree because a check living
 * beside the thing it checks is one the author can satisfy by editing either
 * side. This file cannot edit fixtures.
 *
 * And it is worth the trouble beyond label hygiene: a `type-only` file must
 * emit **no `js_expression` and no `js_call_site` row at all**, which is §2.3's
 * rule that a `@typedef` never reaches the call graph — asserted here against
 * the parser's own output rather than assumed from the label.
 */
function fixtureNatureLabelsAreTrue(): number {
  if (!fs.existsSync(FIXTURES)) {
    return fail(`${FIXTURES} is not present. The fixture tree is TRACKED — its absence is an `
      + 'incomplete checkout, and a check that passes on an incomplete checkout is the '
      + 'gate-loses-its-input failure');
  }
  let failures = 0;
  let typeOnly = 0;
  let runtimeBearing = 0;
  const typeOnlyPaths = new Set<string>();

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.[cm]?jsx?$/.test(entry.name)) {
        continue;
      }
      const text = fs.readFileSync(full, 'utf-8');
      // CASE-INSENSITIVE. The label is written `nature: TYPE-ONLY.` in the two
      // files that carry it, with emphasis and a trailing sentence — and a
      // case-sensitive pattern accused both of having no header at all. A
      // harness that reports a correct fixture as broken is the failure mode §7
      // warns about, and it cost more to believe than to check.
      const declared = /nature:\s*(type-only|runtime-bearing)/i.exec(text);
      if (declared === null) {
        failures += fail(`${full}: no \`nature:\` header. Both header lines are required, `
          + 'so a file that declares neither cannot be adjudicated either way');
        continue;
      }
      const parsed = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, false,
        /\.jsx$/.test(entry.name) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
      const statements = parsed.statements.length;
      if (declared[1]!.toLowerCase() === 'type-only') {
        typeOnly += 1;
        typeOnlyPaths.add(path.relative(FIXTURES, full).split(path.sep).join('/'));
        if (statements !== 0) {
          failures += fail(`${full}: declares type-only and has ${statements} statement(s)`);
        }
        continue;
      }
      runtimeBearing += 1;
      if (statements === 0) {
        failures += fail(`${full}: declares runtime-bearing and has no statement`);
      }
    }
  };
  walk(FIXTURES);

  if (typeOnly === 0) {
    failures += fail('no type-only fixture — the assertion that a type-only file emits no '
      + 'expression or call-site row is vacuous');
  }
  if (runtimeBearing === 0) {
    failures += fail('no runtime-bearing fixture');
  }

  // And the half that is about the PARSER rather than the labels.
  if (fixtureOutputDir !== '') {
    const relations = readRelations(fixtureOutputDir);
    const modules = relations.find((r) => r.name === 'js_module');
    if (modules !== undefined && modules.header.length > 0) {
      const filePath = modules.header.indexOf('filePath');
      const pk = pkIndexOf(modules.header, 'js_module');
      const typeOnlyModules = new Set(
        modules.rows.filter((row) => typeOnlyPaths.has(row[filePath] ?? ''))
          .map((row) => row[pk])
      );
      if (typeOnlyModules.size !== typeOnly) {
        failures += fail(`${typeOnly} type-only fixtures but ${typeOnlyModules.size} matched `
          + 'in js_module — the path join is wrong, so the assertion below is vacuous');
      }
      for (const relationName of ['js_expression', 'js_call_site']) {
        const relation = relations.find((r) => r.name === relationName);
        if (relation === undefined || relation.header.length === 0) {
          continue;
        }
        const owner = relation.header.indexOf('ownerModuleLinkHash');
        const leaked = relation.rows.filter(
          (row) => typeOnlyModules.has(row[owner] ?? '')
        ).length;
        if (leaked > 0) {
          failures += fail(`${leaked} ${relationName} row(s) originate in a type-only file. `
            + 'Every declaration in one is a JSDoc comment, and a comment-borne type is not a '
            + 'call target');
        }
      }
    }
  }
  console.log(`  ${typeOnly} type-only, ${runtimeBearing} runtime-bearing, all labels true`);
  return failures;
}

/** Where the schema lives once `js-oracle` merges it onto the integration branch. */
const SCHEMA_DIR = 'src/schema/javascript';

/**
 * Every emitted column is at the position the FROZEN schema puts it.
 *
 * ## The contract, checked on the side that can break it silently
 *
 * `decls_base_js.dl` carries positional `c0..cN` and nothing else. A column
 * dropped or transposed in a `toCsv()` produces a file that loads into Souffle
 * cleanly and means something different — no type error, no parse error, no
 * failing join, every later column shifted by one and the relation still full of
 * rows. `gen_decls.py --check` guards the schema side of that; this is the emit
 * side, and without it the two can drift apart without either noticing.
 *
 * Three sources must agree: the column lists in `schema.json`,
 * the arities in the generated `.dl`, and what `getCsvHeader()` actually emits.
 * Run by hand it reported 16 relations, 362 columns, 0 mismatches.
 *
 * ## Parsing the doc is the part that gets this wrong
 *
 * Run by hand a second time, after `js-oracle` added vocabulary tables to each
 * section, a looser pattern matched **enum values as if they were column names**
 * and reported all 16 relations as broken — `c3: frozen=Router`,
 * `c5: frozen=eval`. The parser was right and the checker was wrong, and the
 * `.dl` arities are what settled it. So this reads only the table whose header is
 * `| # | Column | T | Meaning |`, and the `.dl` cross-check stays as the
 * independent third opinion rather than being dropped as redundant.
 */
function columnOrderMatchesTheFrozenSchema(): number {
  const doc = path.join(SCHEMA_DIR, 'schema.json');
  const dl = path.join(SCHEMA_DIR, 'decls_base_js.dl');
  if (!fs.existsSync(doc) || !fs.existsSync(dl)) {
    return fail(`${SCHEMA_DIR} is missing schema.json or the .dl. The schema is TRACKED, and a column-`
      + 'order check that passes without a schema to compare against is vacuous');
  }
  let failures = 0;
  const declared = columnsFromSchemaJson(fs.readFileSync(doc, 'utf-8'));
  const arities = aritiesFromDl(fs.readFileSync(dl, 'utf-8'));
  const emitted = emittedHeaders();
  if (declared.size === 0) {
    return fail('no relation was read out of schema.json — the check cannot fail, '
      + 'which is worse than it failing');
  }
  let columns = 0;
  for (const [relation, want] of declared) {
    columns += want.length;
    const got = emitted.get(relation);
    if (got === undefined) {
      failures += fail(`${relation}: the schema declares it and no registry emits it`);
      continue;
    }
    if (arities.get(relation) !== want.length) {
      failures += fail(`${relation}: the .dl declares ${arities.get(relation)} columns and the `
        + `schema.json declares ${want.length} — the schema disagrees with its own generated output`);
    }
    for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
      if (want[i] !== got[i]) {
        failures += fail(`${relation} c${i}: schema says ${want[i]}, parser emits ${got[i]}. `
          + 'Column ORDER is the contract and a shifted column loads without error');
      }
    }
  }
  console.log(`  ${declared.size} relations, ${columns} columns, schema.json and .dl and emitter agree`);
  return failures;
}

/** The frozen column list per relation: `relations.<name>.columns`, in order. */
function columnsFromSchemaJson(text: string): Map<string, string[]> {
  const parsed = JSON.parse(text) as { relations?: Record<string, { columns?: string[] }> };
  const out = new Map<string, string[]>();
  for (const [relation, spec] of Object.entries(parsed.relations ?? {})) {
    if (Array.isArray(spec.columns) && spec.columns.length > 0) {
      out.set(relation, spec.columns);
    }
  }
  return out;
}

function aritiesFromDl(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const match of text.matchAll(/\.decl (js_[a-z_]+)\(([^)]*)\)/g)) {
    out.set(match[1]!, (match[2]!.match(/c\d+:symbol/g) ?? []).length);
  }
  return out;
}

/** What `getCsvHeader()` actually emits, read from the registry sources. */
function emittedHeaders(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const directory = 'src/analysis-types/javascript';
  for (const file of fs.readdirSync(directory)) {
    if (!/^Js.*Registry\.ts$/.test(file)) {
      continue;
    }
    const text = fs.readFileSync(path.join(directory, file), 'utf-8');
    const block = /joinHeader\(\s*\[([\s\S]*?)\],\s*\w+Registry\.ARITY,\s*'(\w+)'/
      .exec(text);
    if (block === null) {
      continue;
    }
    out.set(block[2]!, [...block[1]!.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]!));
  }
  return out;
}

/**
 * Every JSDoc tag the compiler parsed reaches a row, and none reaches two.
 *
 * ## The API is wrong in both directions, and the oracle shipped both errors
 *
 * `ts.getJSDocTags(node)` is not a reliable way to count anything:
 *
 * - it returns **only the last attached block's** tags, so a file that opens
 *   with two `@typedef` comments above its first statement loses both — three
 *   blocks in, one block's tags out;
 * - and its results **inherit to child nodes**, so walking every node counts a
 *   function's `@param` again on the parameter.
 *
 * Both are reproduced in this check's own ground truth, which reads
 * `node.jsDoc[].tags` and dedupes by block — the form `js-oracle` adopted after
 * the first half of this was reported, and which moved its own published counts
 * (`@typedef` 677 -> 1,825, `@type` 18,674 -> 8,869).
 *
 * ## What it caught here
 *
 * `@template` at 14 rows against 20 parameters — class-level and typedef-level
 * tags falling on the floor. Fixing that produced **26**, because one comment
 * block declaring two `@typedef`s was reached once per typedef and emitted its
 * `@template` twice, **with different owners, so no primary key collided and
 * the PK gate stayed green.** The count was the only thing that could see it,
 * which is the whole argument for measuring against ground truth rather than
 * against yesterday's output.
 */
function jsdocTagsReachExactlyOneRow(): number {
  if (!fs.existsSync(FIXTURES)) {
    console.log('  NOT REQUESTED — the fixture corpus is not present');
    return 0;
  }
  let failures = 0;
  let templateParameters = 0;
  let typedefs = 0;

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.[cm]?jsx?$/.test(entry.name)) {
        continue;
      }
      const parsed = ts.createSourceFile(full, fs.readFileSync(full, 'utf-8'),
        ts.ScriptTarget.Latest, true,
        /\.jsx$/.test(entry.name) ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
      // Dedupe BY BLOCK: the same block is attached to one node, but a walk
      // that reads `node.jsDoc` on every node still meets it once per node the
      // compiler attached it to.
      const seen = new Set<ts.JSDoc>();
      const visit = (node: ts.Node): void => {
        for (const block of (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []) {
          if (seen.has(block)) {
            continue;
          }
          seen.add(block);
          for (const tag of block.tags ?? []) {
            if (ts.isJSDocTemplateTag(tag)) {
              templateParameters += tag.typeParameters.length;
            }
            if (ts.isJSDocTypedefTag(tag) || ts.isJSDocCallbackTag(tag)) {
              typedefs += 1;
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
  };
  walk(FIXTURES);

  if (templateParameters === 0 || typedefs === 0) {
    return fail('the corpus has no @template or no @typedef — the count check is vacuous');
  }
  if (fixtureOutputDir === '') {
    return fail('the fixture corpus was not extracted');
  }
  const relations = readRelations(fixtureOutputDir);
  const references = relations.find((r) => r.name === 'js_type_reference');
  if (references === undefined || references.header.length === 0) {
    return fail('js_type_reference has no rows');
  }
  const context = references.header.indexOf('contextKind');
  const emittedTemplates = references.rows.filter(
    (row) => row[context] === 'TEMPLATE'
  ).length;
  if (emittedTemplates !== templateParameters) {
    failures += fail(`@template: ${templateParameters} parameters in the source and `
      + `${emittedTemplates} rows emitted. Over-counting means one block was reached twice; `
      + 'under-counting means an owner kind is not visited');
  }

  // A `@typedef` whose name is ALSO a syntactic declaration is deliberately not
  // minted twice — the syntax row wins and carries evidenceKind = SYNTAX — so
  // the comment-only count is a floor rather than an equality.
  const types = relations.find((r) => r.name === 'js_type');
  if (types !== undefined && types.header.length > 0) {
    const evidence = types.header.indexOf('evidenceKind');
    const commentOnly = types.rows.filter((row) => row[evidence] === 'COMMENT_ONLY').length;
    if (commentOnly > typedefs) {
      failures += fail(`js_type: ${commentOnly} COMMENT_ONLY rows from ${typedefs} `
        + '@typedef/@callback tags — a type has been minted twice');
    }
    if (commentOnly === 0) {
      failures += fail('no COMMENT_ONLY type row — a type whose only evidence is a comment is '
        + 'the construct §2.3 exists for, and it is untested');
    }
    console.log(`  @template ${emittedTemplates}/${templateParameters} parameters, `
      + `${commentOnly} COMMENT_ONLY types from ${typedefs} tags`);
  }
  return failures;
}

/**
 * Every callable expression names the callable it introduces — and the PK is
 * still at c31.
 *
 * ## The hop
 *
 * `emitter.on('x', () => { … })` produced a call site, an argument expression
 * and a `js_method` row for the arrow, and **nothing joined the third to the
 * second**. Measured here at 10,169 callbacks in argument position with no link,
 * and by `js-oracle` at 7,923 of 25,573 callables (31.0%), 98.2% of them
 * anonymous, argument index 1 the most common — the `on(event, fn)` shape.
 *
 * ## And the position, which is the part that can break silently
 *
 * `introducesDeclarationLinkHash` is **c32, after the primary key**. Inserting
 * it at c14 would have shifted `jsExpressionUniqueHash` from c31 to c32 and
 * every consumer reading c31 as the expression hash would have read a foreign
 * key instead — misbinding the fact base while every count stayed plausible.
 *
 * So `js_expression` is the one relation whose PK is not its last column, and
 * this asserts both facts: the hop is populated, and c31 is still the hash. A
 * positional PK lookup passes while pointing at the wrong column, which is why
 * every gate in this file now uses {@link pkIndexOf}.
 */
function callablesNameWhatTheyIntroduce(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const expressionHeader = headerOf(directory, 'js_expression');
  const methodHeader = headerOf(directory, 'js_method');
  if (expressionHeader.length === 0 || methodHeader.length === 0) {
    return fail('js_expression or js_method has no rows');
  }

  // The position, asserted by NAME and by INDEX, because the whole point is
  // that the two no longer agree the way they do elsewhere.
  if (expressionHeader[31] !== 'jsExpressionUniqueHash') {
    failures += fail(`js_expression c31 is ${expressionHeader[31]}, not the expression `
      + 'hash. Every consumer reading c31 as the primary key now reads something else');
  }
  if (expressionHeader[32] !== 'introducesDeclarationLinkHash') {
    failures += fail(`js_expression c32 is ${expressionHeader[32]}, not `
      + 'introducesDeclarationLinkHash');
  }
  if (pkIndexOf(expressionHeader, 'js_expression') !== 31) {
    failures += fail('pkIndexOf does not locate js_expression\'s key at c31');
  }

  const kind = expressionHeader.indexOf('expressionKind');
  const link = expressionHeader.indexOf('introducesDeclarationLinkHash');
  const text = expressionHeader.indexOf('text');
  const role = expressionHeader.indexOf('edgeRole');
  const methodPk = pkIndexOf(methodHeader, 'js_method');
  const methodKeys = new Set<string>();
  forEachRow(directory, 'js_method', (row) => {
    methodKeys.add(row[methodPk] ?? '');
  });

  let callables = 0;
  let linked = 0;
  let callbacks = 0;
  let linkedCallbacks = 0;
  let onNonCallable = 0;
  let dangling = 0;
  let unlinkedNonClass = 0;
  let firstUnlinked = '';
  forEachRow(directory, 'js_expression', (row) => {
    const value = row[link] ?? '';
    const isCallable = row[kind] === 'FUNCTION_EXPRESSION';
    if (value !== '' && !isCallable) {
      onNonCallable += 1;
    }
    if (value !== '' && !methodKeys.has(value)) {
      dangling += 1;
    }
    if (!isCallable) {
      return;
    }
    callables += 1;
    if (value !== '') {
      linked += 1;
    } else if (!(row[text] ?? '').trimStart().startsWith('class')) {
      // A class expression with NO constructor links nothing: the column is
      // declared FK→js_method, and pointing it at a js_type would be an FK into
      // the wrong relation. Those are the only legitimate unlinked callables.
      unlinkedNonClass += 1;
      if (firstUnlinked === '') {
        firstUnlinked = (row[text] ?? '').slice(0, 48);
      }
    }
    if (row[role] === 'ARGUMENT') {
      callbacks += 1;
      if (value !== '') {
        linkedCallbacks += 1;
      }
    }
  });
  if (dangling > 0) {
    failures += fail(`${dangling} js_expression c32 value(s) do not resolve in js_method`);
  }
  if (onNonCallable > 0) {
    failures += fail(`${onNonCallable} non-callable row(s) carry c32. The column is "the `
      + 'callable this expression IS", so a literal or an identifier carrying one is a '
      + 'wrong answer rather than an extra one');
  }
  if (unlinkedNonClass > 0) {
    failures += fail(`${unlinkedNonClass} callable expression(s) are neither linked `
      + `nor class expressions, e.g. ${JSON.stringify(firstUnlinked)}`);
  }
  if (callbacks === 0) {
    failures += fail('no callable in argument position — the orphan case the column exists '
      + 'for is untested');
  }
  console.log(`  ${linked}/${callables} callables linked, `
    + `${linkedCallbacks}/${callbacks} of them in argument position`);
  return failures;
}

/**
 * A type's members are counted once, and only members are owned by it.
 *
 * ## Two defects, one of which was found by the other
 *
 * `js-oracle` asked, after ruling that a class field holding an arrow emits
 * BOTH a `js_field` and a `js_method`: confirm `declaredMemberCount` counts it
 * once. It did not — a five-member class reported **seven**, because the field
 * was counted in `node.members.length` and again when the method row was
 * minted. `countMember` exists for members discovered by assignment OUTSIDE the
 * class body, which are genuinely not in `node.members`.
 *
 * Checking that turned up the larger one. `ownerTypeLinkHash` was inherited into
 * method BODIES, so every anonymous callable nested in a method read as a member
 * of the enclosing class — **2,422 phantom members over 816 real files.** An
 * engine listing a type's methods got a list of `<arrow>` entries that are not
 * members of anything; `enclosingMethodLinkHash` is the link that says where
 * they actually live.
 *
 * Both are invisible to a row count: no row was missing and none was
 * duplicated, only attributed.
 */
function memberAccountingIsHonest(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const typeHeader = headerOf(directory, 'js_type');
  const fieldHeader = headerOf(directory, 'js_field');
  const methodHeader = headerOf(directory, 'js_method');
  if (typeHeader.length === 0 || methodHeader.length === 0 || fieldHeader.length === 0) {
    return fail('js_type, js_field or js_method has no rows');
  }
  const typePk = pkIndexOf(typeHeader, 'js_type');
  const count = typeHeader.indexOf('declaredMemberCount');
  const typeName = typeHeader.indexOf('name');
  const mOwner = methodHeader.indexOf('ownerTypeLinkHash');
  const mName = methodHeader.indexOf('name');
  const mEnclosing = methodHeader.indexOf('enclosingMethodLinkHash');
  const fOwner = fieldHeader.indexOf('ownerTypeLinkHash');
  const fName = fieldHeader.indexOf('name');

  // Members GROUPED BY OWNER in one pass, rather than rescanning every member
  // for every type. The scan was quadratic — 1,181 types × 30 K fields — which
  // is survivable at corpus scale and would not be at repository scale, and the
  // grouped form is what the check actually means anyway.
  const membersByOwner = new Map<string, Set<string>>();
  const add = (owner: string, prefixed: string): void => {
    const existing = membersByOwner.get(owner);
    if (existing === undefined) {
      membersByOwner.set(owner, new Set([prefixed]));
      return;
    }
    existing.add(prefixed);
  };
  let phantom = 0;
  forEachRow(directory, 'js_method', (row) => {
    const owner = row[mOwner] ?? '';
    // An anonymous callable nested inside a method is NOT a member of the type.
    if (owner !== '' && (row[mEnclosing] ?? '') !== ''
      && (row[mName] === '<arrow>' || row[mName] === '<function-expression>')) {
      phantom += 1;
    }
    if (owner !== '' && row[mName] !== '<constructor>') {
      add(owner, `m:${row[mName]}`);
    }
  });
  forEachRow(directory, 'js_field', (row) => {
    const owner = row[fOwner] ?? '';
    if (owner !== '') {
      add(owner, `f:${row[fName]}`);
    }
  });
  if (phantom > 0) {
    failures += fail(`${phantom} anonymous callable(s) nested in a method body carry `
      + 'ownerTypeLinkHash. An arrow inside a method is a local callable, not a member — '
      + 'enclosingMethodLinkHash is the link that says where it lives');
  }

  // declaredMemberCount must be at least the distinct member names, and the
  // field/method pair for one class-field arrow must not double it.
  let checked = 0;
  let withBothRows = 0;
  forEachRow(directory, 'js_type', (type) => {
    const hash = type[typePk] ?? '';
    const names = membersByOwner.get(hash) ?? new Set<string>();
    if (names.size === 0) {
      return;
    }
    checked += 1;
    // One member described by BOTH relations — the class-field arrow — counts
    // once, so the distinct MEMBER names are fewer than the row pairs.
    const memberNames = new Set(
      [...names].map((n) => n.slice(2))
    );
    if (memberNames.size < names.size) {
      withBothRows += 1;
    }
    if (Number(type[count]) < memberNames.size) {
      failures += fail(`js_type ${type[typeName]}: declaredMemberCount=${type[count]} is below `
        + `its ${memberNames.size} distinct member names`);
    }
  });
  if (checked === 0) {
    failures += fail('no type with members — the accounting check is vacuous');
  }
  if (withBothRows === 0) {
    failures += fail('no member described by both a js_field and a js_method row, so the '
      + 'double-count the check exists for is untested — a class field holding an arrow is '
      + 'the shape');
  }
  console.log(`  ${checked} types checked, ${withBothRows} with a member in both relations, `
    + `${phantom} phantom members`);
  return failures;
}

/**
 * Declaration forms whose member is NESTED INSIDE its owner's span.
 *
 * ## Split by enum value, and asserted TOTAL, because a string test was wrong
 *
 * The check first asked whether the form `endsWith('ASSIGNMENT')` plus two named
 * exceptions. That is a guess about spelling, and on a 4,561-file corpus it
 * reported **15 false positives**: one UI library writes
 * `Object.assign(SyntheticBaseEvent.prototype, { preventDefault() {…} })`, which
 * the parser correctly calls `OBJECT_ASSIGN_PROTOTYPE` — detached by
 * construction, and matching neither the suffix nor either exception.
 *
 * So both sets are enumerated from the enums, and a value in NEITHER is a named
 * failure rather than a silent exemption. Adding a declaration form now forces
 * the question "is this one nested?" to be answered, which is the only version
 * of this check that stays correct as the vocabulary grows.
 */
const NESTED_DECLARATION_FORMS: ReadonlySet<string> = new Set([
  // A method written in a class body or as a function declaration.
  'SYNTACTIC',
  // `class Foo { bar = 1 }` — inside the braces.
  'CLASS_FIELD',
  // `this.x = 1` in a constructor, which is inside the constructor, which is
  // inside the type — whether the type is a class or a constructor function.
  'CONSTRUCTOR_THIS_ASSIGNMENT',
]);

/**
 * Declaration forms whose member is DETACHED from its owner's span.
 *
 * Every one of these is §2.2's defect class: a declaration expressed as an
 * assignment, which sits after the constructor function it belongs to and
 * therefore cannot be contained by it. An extractor that emitted these as
 * ordinary assignments would show no inheritance at all in any pre-ES6 codebase.
 */
const DETACHED_DECLARATION_FORMS: ReadonlySet<string> = new Set([
  'PROTOTYPE_ASSIGNMENT',
  'STATIC_ASSIGNMENT',
  'PROTOTYPE_OBJECT_LITERAL',
  'OBJECT_DEFINE_PROPERTY',
  'OBJECT_ASSIGN_PROTOTYPE',
]);

/**
 * Every owned row sits inside its owner, unless it was declared by assignment.
 *
 * ## The sweep that answers "is it the ONLY one that leaks"
 *
 * `ownerTypeLinkHash` leaked down the traversal into method bodies, so 2,422
 * anonymous callables read as members of classes they were merely nested inside.
 * The question that mattered was not how to fix it but whether any OTHER carried
 * value had the same shape — so all eleven owner and enclosing columns are
 * tested structurally here: a row's start line must fall inside its owner's
 * span.
 *
 * Answer, over 816 real files: **`ownerTypeLinkHash` was the only one.** Zero
 * out-of-span rows for `enclosingMethodLinkHash` on three relations,
 * `ownerMethodLinkHash` on seven, once assignment-declared members are excluded.
 *
 * ## Assignment-declared members are SUPPOSED to be outside
 *
 * `Foo.prototype.bar = function () {}` sits after the constructor function ends
 * — that is the whole of §2.2. So containment is asserted only for members the
 * syntax nests, and the split is by `declarationForm`, which makes the check
 * sharper rather than weaker: 153 methods and 317 fields legitimately outside,
 * every one of them assignment-declared.
 *
 * ## And it found a second defect with a different cause
 *
 * Nine `CONSTRUCTOR_THIS_ASSIGNMENT` fields sat outside their owner. Not a leak
 * — a name-keyed index. `typeByName` is first-wins across a whole file, and a
 * bundle containing both `class Parser` and a later `function Parser` put the
 * second's `this.x =` members on the first. Constructor-function types are now
 * indexed by their declaring NODE.
 */
function ownedRowsSitInsideTheirOwner(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;

  const spanIndex = (name: string): Map<string, { module: string; from: number; to: number }> => {
    const out = new Map<string, { module: string; from: number; to: number }>();
    const header = headerOf(directory, name);
    if (header.length === 0) {
      return out;
    }
    const pk = pkIndexOf(header, name);
    const owner = header.indexOf('ownerModuleLinkHash');
    const from = header.indexOf('startLine');
    const to = header.indexOf('endLine');
    forEachRow(directory, name, (row) => {
      out.set(row[pk] ?? '', {
        module: row[owner] ?? '',
        from: Number(row[from] ?? 0),
        to: Number(to >= 0 ? row[to] ?? row[from] : row[from] ?? 0),
      });
    });
    return out;
  };
  const types = spanIndex('js_type');
  const methods = spanIndex('js_method');

  const CASES: ReadonlyArray<readonly [string, string, Map<string, {
    module: string; from: number; to: number }>]> = [
    ['js_method', 'ownerTypeLinkHash', types],
    ['js_method', 'enclosingMethodLinkHash', methods],
    ['js_field', 'ownerTypeLinkHash', types],
    ['js_type', 'enclosingMethodLinkHash', methods],
    ['js_block', 'ownerMethodLinkHash', methods],
    ['js_variable', 'ownerMethodLinkHash', methods],
    ['js_call_site', 'enclosingMethodLinkHash', methods],
    ['js_scope', 'ownerMethodLinkHash', methods],
    ['js_import', 'ownerMethodLinkHash', methods],
    ['js_export', 'ownerMethodLinkHash', methods],
    ['js_expression', 'ownerMethodLinkHash', methods],
  ];

  // The two sets must COVER the vocabulary, not merely partition what this
  // corpus happened to emit. Checked statically so a declaration form added and
  // not yet produced by any file still fails here, rather than the day some
  // repository first writes one.
  const declaredForms = [
    ...Object.values(JsEnums.JsMethodDeclarationForm),
    ...Object.values(JsEnums.JsFieldDeclarationForm),
  ].map(String);
  for (const form of declaredForms) {
    if (!NESTED_DECLARATION_FORMS.has(form) && !DETACHED_DECLARATION_FORMS.has(form)) {
      failures += fail(`declarationForm ${form} is declared and this check classifies it as `
        + 'neither nested nor detached. Containment cannot be asserted for a form nobody has '
        + 'said where it lives');
    }
  }

  let checkedColumns = 0;
  const unclassified = new Set<string>();
  for (const [relationName, column, index] of CASES) {
    const header = headerOf(directory, relationName);
    if (header.length === 0) {
      continue;
    }
    const at = header.indexOf(column);
    const module = header.indexOf('ownerModuleLinkHash');
    const line = header.indexOf('startLine');
    const form = header.indexOf('declarationForm');
    if (at < 0 || line < 0) {
      continue;
    }
    checkedColumns += 1;
    let outside = 0;
    forEachRow(directory, relationName, (row) => {
      const owner = index.get(row[at] ?? '');
      if ((row[at] ?? '') === '' || owner === undefined) {
        return;
      }
      const nested = owner.module === (row[module] ?? '')
        && owner.from <= Number(row[line]) && Number(row[line]) <= owner.to;
      if (nested) {
        return;
      }
      const declarationForm = form >= 0 ? row[form] ?? '' : '';
      if (declarationForm !== '' && !NESTED_DECLARATION_FORMS.has(declarationForm)) {
        if (DETACHED_DECLARATION_FORMS.has(declarationForm)) {
          // Declared by an assignment OUTSIDE its owner — expected, and the
          // whole of §2.2.
          return;
        }
        unclassified.add(declarationForm);
        return;
      }
      outside += 1;
      if (outside <= 2) {
        failures += fail(`${relationName}.${column}: a row at line ${row[line]} is outside its `
          + 'owner\'s span and was not declared by an assignment. The context leaked down the '
          + 'traversal — which is how 2,422 arrows read as members of classes they were only '
          + 'nested inside');
      }
    });
    if (outside > 2) {
      failures += fail(`${relationName}.${column}: ${outside} out-of-span rows in total`);
    }
  }
  if (checkedColumns < 8) {
    failures += fail(`only ${checkedColumns} owner columns were checked — the sweep is `
      + 'supposed to cover every one, and a relation missing from the output makes it vacuous');
  }
  for (const form of unclassified) {
    failures += fail(`declarationForm ${form} is neither nested nor detached. A form the `
      + 'gate has never been told about is exempted from containment by accident — which is '
      + 'exactly how OBJECT_ASSIGN_PROTOTYPE reported 15 false positives');
  }
  console.log(`  ${checkedColumns} owner/enclosing columns swept for containment`);
  return failures;
}

/**
 * A declared type is named wherever it is linked, and vice versa.
 *
 * Four positions carry a declared type — parameters, fields, variables, method
 * returns — and each carries it TWICE: as `declaredTypeName` plus
 * `declaredTypeSource`, and as a `js_type_reference` tree. The two must agree,
 * because they are two encodings of one fact.
 *
 * They did not. `emitClassField` computed the type and then wrote `''` and
 * `NONE` into the row while still linking the tree, so **every `@type` on a
 * class field and every Flow-annotated class field lost its name** while keeping
 * its reference — a row that says "no declared type" and points at one. Found
 * by writing the two Flow dialects by hand to answer whether `SYNTACTIC_FLOW`
 * was reachable at all.
 */
/**
 * `isOptional` must agree with the JSDoc optional modifier already in the fact base.
 *
 * JSDoc marks an optional parameter two ways and the compiler models them as
 * different nodes: `@param {T} [x]` sets `JSDocParameterTag.isBracketed`, and
 * `@param {T=} x` produces a `JSDocOptionalType` — which this fact base already
 * emits, as a `js_type_reference` row with `referenceKind = OPTIONAL`, because
 * `typeNameAsWritten` strips the modifier off the name precisely so it can land
 * in the tree. 263 parameters against 647 on the development tree: an
 * `isBracketed`-only rule reports 71% of JSDoc-declared optionality.
 *
 * So this is not a gap. It is §7.2.1's populated-and-wrong shape *between two
 * relations*: one row says the parameter is not optional and a row linked to it
 * says its type is `JSDocOptionalType`. No count notices, because nothing is
 * missing. The FK gate passes — the link resolves. Only an agreement check sees it.
 *
 * The join is direct: `ownerKind = METHOD_PARAMETER` names the owning relation and
 * `ownerLinkHash` names the row, so no subtree walk is needed.
 */
function optionalModifiersReachTheParameterRow(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const parameterHeader = headerOf(directory, 'js_method_parameter');
  const referenceHeader = headerOf(directory, 'js_type_reference');
  if (parameterHeader.length === 0 || referenceHeader.length === 0) {
    return fail('js_method_parameter or js_type_reference is absent — nothing to agree');
  }
  const pPk = pkIndexOf(parameterHeader, 'js_method_parameter');
  const pOptional = parameterHeader.indexOf('isOptional');
  const pName = parameterHeader.indexOf('name');
  const pLine = parameterHeader.indexOf('startLine');
  const optionalByPk = new Map<string, readonly string[]>();
  forEachRow(directory, 'js_method_parameter', (row) => {
    optionalByPk.set(row[pPk] ?? '', row);
  });

  const rKind = referenceHeader.indexOf('referenceKind');
  const rOwnerKind = referenceHeader.indexOf('ownerKind');
  const rOwner = referenceHeader.indexOf('ownerLinkHash');
  let marked = 0;
  let disagreed = 0;
  let reported = 0;
  const rDepth = referenceHeader.indexOf('depth');
  forEachRow(directory, 'js_type_reference', (row) => {
    // The ROOT only. `@param {function(Error=, Assets=): void} callback` carries
    // two OPTIONAL rows at depth 1 that say the callback's own parameters are
    // optional, not that `callback` is — 191 of 484 marked rows on the
    // development corpus, every one at depth >= 1, all inside a function type.
    if (row[rKind] !== 'OPTIONAL' || row[rOwnerKind] !== 'METHOD_PARAMETER' || row[rDepth] !== '0') {
      return;
    }
    marked += 1;
    const owner = optionalByPk.get(row[rOwner] ?? '');
    if (owner === undefined) {
      return; // the FK gate owns dangling links; this check owns meaning
    }
    if (owner[pOptional] !== 'true') {
      disagreed += 1;
      if (reported < 3) {
        reported += 1;
        failures += fail(`js_method_parameter: \`${owner[pName]}\` at line ${owner[pLine]} reads `
          + 'isOptional=false while its own type reference reads OPTIONAL. `@param {T=} x` is the '
          + 'second JSDoc optional marker and the checker treats it exactly as `[x]` — '
          + 'isOptionalDeclaration answers true for both. Schema §3.5a');
      }
    }
  });

  // A check that never found an `@param {T=}` has not tested anything, and would
  // report PASS for the rest of this file's life.
  if (marked === 0) {
    failures += fail('no parameter anywhere carries an OPTIONAL type reference, so this check '
      + 'evaluated nothing — the corpus needs one `@param {T=} x` before it means anything');
  } else if (disagreed > 0) {
    failures += fail(`${disagreed} of ${marked} OPTIONAL-typed parameters disagree with their own `
      + 'isOptional column');
  }
  return failures;
}

/**
 * One comment mints one tree at one position.
 *
 * From js-corpus' holdout: a `/** @type {import('x').T} *\/` on a variable whose
 * initializer contains nested function DECLARATIONS was minted once per
 * declaration. `js_import`'s key is
 * (ownerModule ‖ specifier ‖ localName ‖ line ‖ column) — no host — so the copies
 * collided and the PK gate caught them.
 *
 * `js_type_reference`'s key is (ownerLinkHash ‖ contextKind ‖ depth ‖ childIndex ‖
 * line ‖ column). **It carries the host.** The same re-hosting therefore produces
 * DISTINCT keys, every one of them resolvable, and the PK gate and the FK gate
 * both pass while the fact base counts one comment two or three times. That is
 * the shape a key can hide, and the only check that sees it is one keyed on the
 * comment and the position INSIDE it rather than on the host.
 *
 * `js_comment` is safe by the same reasoning read the other way: its key is
 * (ownerModule ‖ line ‖ column ‖ endLine), with no host, so a doubly-minted
 * comment collides and is already caught.
 */
function oneCommentMintsOneTree(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const header = headerOf(directory, 'js_type_reference');
  if (header.length === 0) {
    return fail('js_type_reference is absent');
  }
  const cComment = header.indexOf('commentLinkHash');
  const cLine = header.indexOf('startLine');
  const cColumn = header.indexOf('startColumn');
  const cDepth = header.indexOf('depth');
  const cChild = header.indexOf('childIndex');
  const cOwnerKind = header.indexOf('ownerKind');
  const counts = new Map<string, number>();
  const owners = new Map<string, Set<string>>();
  let considered = 0;
  forEachRow(directory, 'js_type_reference', (row) => {
    const comment = row[cComment] ?? '';
    if (comment === '') {
      return;
    }
    considered += 1;
    const key = [comment, row[cLine], row[cColumn], row[cDepth], row[cChild]].join('\u0000');
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!owners.has(key)) {
      owners.set(key, new Set());
    }
    owners.get(key)!.add(row[cOwnerKind] ?? '');
  });
  let reported = 0;
  let duplicated = 0;
  for (const [key, n] of counts) {
    if (n <= 1) {
      continue;
    }
    duplicated += 1;
    if (reported < 3) {
      reported += 1;
      const [, line, column, depth, child] = key.split('\u0000');
      failures += fail(`js_type_reference: one comment mints ${n} rows at line ${line} column `
        + `${column} (depth ${depth}, child ${child}), owner kinds `
        + `${[...owners.get(key)!].join('/')}. A comment documents one thing; this one was `
        + 're-hosted. The PK carries ownerLinkHash so every copy has a distinct key and both '
        + 'the PK and FK gates pass');
    }
  }
  if (considered === 0) {
    failures += fail('no type reference names a comment, so this check evaluated nothing');
  } else if (duplicated > 0) {
    failures += fail(`${duplicated} comment positions mint more than one type-reference row`);
  }
  return failures;
}

function declaredTypesAgreeWithTheirReferences(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['js_method_parameter', 'declaredTypeName', 'typeReferenceLinkHash'],
    ['js_field', 'declaredTypeName', 'typeReferenceLinkHash'],
    ['js_variable', 'declaredTypeName', 'typeReferenceLinkHash'],
    ['js_method', 'returnTypeName', 'returnTypeReferenceLinkHash'],
  ];
  let linked = 0;
  for (const [name, nameColumn, linkColumn] of CASES) {
    const header = headerOf(directory, name);
    if (header.length === 0) {
      continue;
    }
    const nameAt = header.indexOf(nameColumn);
    const linkAt = header.indexOf(linkColumn);
    const sourceAt = header.indexOf('declaredTypeSource');
    let reported = 0;
    forEachRow(directory, name, (row) => {
      const hasLink = (row[linkAt] ?? '') !== '';
      const hasName = (row[nameAt] ?? '') !== '';
      if (hasLink) {
        linked += 1;
      }
      if (hasLink && !hasName && reported < 3) {
        reported += 1;
        failures += fail(`${name}: a row at line ${row[header.indexOf('startLine')]} links a `
          + 'type reference and names no declared type. The two are encodings of one fact and '
          + 'cannot disagree');
      }
      if (sourceAt >= 0 && hasName && row[sourceAt] === 'NONE' && reported < 3) {
        reported += 1;
        failures += fail(`${name}: declaredTypeName is set and declaredTypeSource is NONE`);
      }
    });
  }
  if (linked === 0) {
    failures += fail('no typed position links a reference — the agreement check is vacuous');
  }
  // The assigned-callable forms: every parameter in that scaffold file must be
  // typed. `@returns` on the same statement is the control — it reads through
  // the compiler API, which walks to the host, and never regressed.
  const scaffold = readRelations(outputDir);
  const modules = scaffold.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const assigned = modules.rows.find((r) => (r[mPath] ?? '').endsWith('param-on-assigned-callable.js'))?.[mPk];
  const parameters = scaffold.find((r) => r.name === 'js_method_parameter')!;
  const pOwner = parameters.header.indexOf('ownerModuleLinkHash');
  const pName = parameters.header.indexOf('name');
  const pType = parameters.header.indexOf('declaredTypeName');
  const pLink = parameters.header.indexOf('typeReferenceLinkHash');
  for (const [name, type, form] of [
    ['ext', 'string', 'the RHS of a property assignment'],
    ['fn', 'Function', 'the RHS of a property assignment'],
    ['deps', 'object', 'a variable initialiser'],
    ['n', 'number', 'an object-literal property value'],
  ] as const) {
    const row = parameters.rows.find((r) => r[pOwner] === assigned && r[pName] === name);
    if (row?.[pType] !== type || (row?.[pLink] ?? '') === '') {
      failures += fail(`@param on a callable that is ${form}: parameter ${name} has type `
        + `${row?.[pType] || '(none)'}, expected ${type} with a tree. The JSDoc block is on `
        + 'the STATEMENT, not the function, and only a walk to the host reaches it');
    }
  }
  // Dotted and bracketed forms: the parent of a dotted tag is named as
  // WRITTEN, and a bracket is optionality — without touching hasDefault, which
  // stays the code's until the comment-default question is ruled.
  const forms = modules.rows.find((r) => (r[mPath] ?? '').endsWith('jsdoc-param-forms.js'))?.[mPk];
  const pOptional = parameters.header.indexOf('isOptional');
  const pDefault = parameters.header.indexOf('hasDefault');
  for (const [name, type, optional, hasDefault, why] of [
    ['ctx', 'object', false, false, 'the parent of two dotted tags — the compiler replaces its {object} with a type literal'],
    ['maybe', 'string', true, false, '`[maybe]` is optional by the bracket alone'],
    ['withDefault', 'string', true, false, '`[withDefault=fallback]` is optional; the comment default does not set hasDefault'],
    ['plain', 'number', false, false, 'the control'],
    ['postfix', 'string', true, false, '`{string=}` is the second JSDoc optional marker (§3.5a)'],
    ['callback', 'function(Error=, string=): void', false, false,
      'the `=` inside `function(Error=, string=)` is the callback\'s parameter\'s, not its own'],
    ['twice', 'number', false, false, 'documented twice, prose first: the first tag WITH a type wins, as in the compiler'],
    ['stale', 'Array', false, false, 'two blocks above one function: the compiler reads the LAST block'],
    ['a', 'string', false, false, 'named tag, first'],
    ['b', '', false, false, 'UNDOCUMENTED — the tag at its index names `c` and is not its to take'],
    ['c', 'number', false, false, 'named tag, third parameter, second tag'],
  ] as const) {
    const row = parameters.rows.find((r) => r[pOwner] === forms && r[pName] === name);
    const got = row === undefined ? 'no row'
      : `${JSON.stringify(row[pType])} optional=${row[pOptional]} default=${row[pDefault]}`;
    if (row?.[pType] !== type || row[pOptional] !== String(optional) || row[pDefault] !== String(hasDefault)
      || ((row[pLink] ?? '') !== '') !== (type !== '')) {
      failures += fail(`@param form ${name}: ${got}, expected ${JSON.stringify(type)} `
        + `optional=${optional} default=${hasDefault}${type === '' ? ' and no tree' : ''} — ${why}`);
    }
  }
  // An accessor pair typed on its second accessor.
  const fieldsRel = scaffold.find((r) => r.name === 'js_field')!;
  const fOwner = fieldsRel.header.indexOf('ownerModuleLinkHash');
  const fName = fieldsRel.header.indexOf('name');
  const fType = fieldsRel.header.indexOf('declaredTypeName');
  const fLink = fieldsRel.header.indexOf('typeReferenceLinkHash');
  const fPair = fieldsRel.header.indexOf('accessorPairKind');
  const classFields = modules.rows.find((r) => (r[mPath] ?? '').endsWith('class-fields.js'))?.[mPk];
  const size = fieldsRel.rows.find((r) => r[fOwner] === classFields && r[fName] === 'size');
  if (size?.[fType] !== 'number' || (size[fLink] ?? '') === '' || size[fPair] !== 'GETTER_SETTER') {
    failures += fail(`the accessor pair \`size\`: declaredTypeName ${JSON.stringify(size?.[fType])}, `
      + `${(size?.[fLink] ?? '') === '' ? 'no tree' : 'a tree'}, ${size?.[fPair]}; expected number with a tree on `
      + 'a GETTER_SETTER row — the @type sits on the setter, the row was minted at the getter');
  }
  // The destructuring declaration's @type: one tree, on the root binding.
  const variables = scaffold.find((r) => r.name === 'js_variable')!;
  const vOwner = variables.header.indexOf('ownerModuleLinkHash');
  const vName = variables.header.indexOf('name');
  const vType = variables.header.indexOf('declaredTypeName');
  const vRoot = variables.header.indexOf('patternRootVariableLinkHash');
  const vLink = variables.header.indexOf('typeReferenceLinkHash');
  const vSource = variables.header.indexOf('declaredTypeSource');
  const firstRow = variables.rows.find((r) => r[vOwner] === forms && r[vName] === 'first');
  const secondRow = variables.rows.find((r) => r[vOwner] === forms && r[vName] === 'second');
  if (firstRow?.[vType] !== '[string, number]' || (firstRow[vLink] ?? '') === ''
    || (secondRow?.[vType] ?? '?') !== '' || secondRow?.[vSource] !== 'NONE' || (secondRow[vLink] ?? '') !== ''
    || (secondRow[vRoot] ?? '') !== firstRow[pkIndexOf(variables.header, 'js_variable')]) {
    failures += fail(`destructured @type: first=${JSON.stringify(firstRow?.[vType])}${(firstRow?.[vLink] ?? '') === '' ? ' no tree' : ''}, `
      + `second=${JSON.stringify(secondRow?.[vType])}/${secondRow?.[vSource]}${(secondRow?.[vLink] ?? '') !== '' ? ' WITH a tree' : ''}; `
      + 'expected the pattern\'s type on the root binding only — one comment, one tree, and the pair\'s '
      + 'type on `second` would be a wrong type, not a conservative one');
  }
  // The in-body import type's js_import row is owned by inBody, not by a
  // documented method outside the comment.
  const methodsRel = scaffold.find((r) => r.name === 'js_method')!;
  const mOwner = methodsRel.header.indexOf('ownerModuleLinkHash');
  const mName = methodsRel.header.indexOf('name');
  const inBody = methodsRel.rows.find((r) => r[mOwner] === forms && r[mName] === 'inBody')
    ?.[pkIndexOf(methodsRel.header, 'js_method')];
  const importsRel = scaffold.find((r) => r.name === 'js_import')!;
  const iOwner = importsRel.header.indexOf('ownerModuleLinkHash');
  const iBearer = importsRel.header.indexOf('edgeBearer');
  const iMethod = importsRel.header.indexOf('ownerMethodLinkHash');
  const iScope = importsRel.header.indexOf('ownerScopeLinkHash');
  const iLine = importsRel.header.indexOf('startLine');
  const mBody = methodsRel.header.indexOf('bodyScopeLinkHash');
  const enter = methodsRel.rows.find((r) => r[mOwner] === forms && r[mName] === 'enter');
  const onParameter = importsRel.rows.find((r) => r[iOwner] === forms && r[iBearer] === 'COMMENT'
    && Number(r[iLine]) === 34);
  if (enter === undefined || onParameter === undefined
    || onParameter[iMethod] !== enter[pkIndexOf(methodsRel.header, 'js_method')]
    || onParameter[iScope] !== enter[mBody]) {
    failures += fail(`the import type on enter's parameter (line 34): owner method `
      + `${onParameter === undefined ? '(no row)' : onParameter[iMethod] === enter?.[pkIndexOf(methodsRel.header, 'js_method')] ? 'enter' : 'ANOTHER method'}, `
      + `owner scope ${onParameter?.[iScope] === enter?.[mBody] ? "enter's own" : 'NOT the scope enter opens'} — `
      + 'a parameter node sits in its function\'s scope; the walk fell through to the function node and took the outer one');
  }
  const commentImport = importsRel.rows.find((r) => r[iOwner] === forms && r[iBearer] === 'COMMENT'
    && Number(r[iLine]) !== 34);
  if (commentImport === undefined || commentImport[iMethod] !== inBody) {
    failures += fail(`the import type inside inBody() has ownerMethodLinkHash `
      + `${commentImport === undefined ? '(no row)' : commentImport[iMethod] === inBody ? 'inBody' : 'another method'}; `
      + 'expected inBody — a comment is owned by the method that CONTAINS it, and the walk from a '
      + 'JSDoc node reaches the node it documents first');
  }
  console.log(`  ${linked} typed positions link a reference, all naming their type`);
  return failures;
}

/**
 * A Flow file is DECLINED, and the decline is a row.
 *
 * ## Ruled out of scope, and the rejection has to be visible
 *
 * `ts.createSourceFile` under `ScriptKind.JS` accepts Flow where it overlaps
 * TypeScript and mis-parses it where it diverges — silently. One cause, three
 * faces: 3,793 parameters carrying `SYNTACTIC_FLOW` indistinguishable from
 * TypeScript annotations, `declare function` minting type-only `NO_BODY` method
 * rows into the call graph, and a recovery cascade duplicating diagnostics. And
 * of 248 `@flow` files, **zero** parsed cleanly.
 *
 * So Flow is declined. What this asserts is that declining is not the same as
 * skipping: the module row EXISTS and says `FLOW_REJECTED`, so a consumer can
 * count what was refused. §9's nested-config failure was a silent structural exclusion
 * of 1,270 of 1,821 files, and a run that reported success.
 *
 * The zero-rows half matters as much. The module row alone means nothing
 * downstream can read a Flow annotation as a TypeScript one by forgetting to
 * check a column, because there is no row to read.
 */
function flowFilesAreDeclinedAndSaySo(): number {
  let failures = 0;
  // The SCAFFOLD, deliberately: it is the only tree guaranteed to contain both
  // a pragma file and a `.js.flow` file, so the decline half of this check
  // cannot go vacuous. The detection-miss half looks at the corpus as well,
  // because a miss by definition does not appear in a file anyone wrote to be
  // Flow.
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module');
  if (modules === undefined || modules.header.length === 0) {
    return fail('js_module has no rows');
  }
  const pk = pkIndexOf(modules.header, 'js_module');
  const provenance = modules.header.indexOf('sourceProvenance');
  const pragma = modules.header.indexOf('hasFlowPragma');
  const filePath = modules.header.indexOf('filePath');

  const declined = new Map<string, string>();
  for (const row of modules.rows) {
    if (row[provenance] === 'FLOW_REJECTED') {
      declined.set(row[pk] ?? '', row[filePath] ?? '');
    }
  }
  if (declined.size === 0) {
    return fail('no file was declined as Flow — the scaffold carries both a @flow '
      + 'pragma file and a .js.flow file, so this check is not exercising the ruling');
  }
  // The pragma column must agree with the provenance for the pragma-detected
  // case. A `.js.flow` file legitimately has no pragma — its NAME is the
  // declaration — so the agreement is asserted one way only.
  for (const row of modules.rows) {
    if (row[pragma] === 'true' && row[provenance] !== 'FLOW_REJECTED') {
      failures += fail(`js_module ${row[filePath]}: hasFlowPragma is true and `
        + `sourceProvenance is ${row[provenance]}. A file carrying the pragma is out of `
        + 'scope by the ruling, and a row that says both is two answers to one question');
    }
  }

  // NOTHING ELSE, in any relation, for any declined module.
  let strayRows = 0;
  let strayRelations = new Set<string>();
  for (const relation of relations) {
    if (relation.name === 'js_module' || relation.header.length === 0) {
      continue;
    }
    const owner = relation.header.indexOf('ownerModuleLinkHash');
    if (owner < 0) {
      continue;
    }
    for (const row of relation.rows) {
      if (declined.has(row[owner] ?? '')) {
        strayRows += 1;
        strayRelations.add(relation.name);
      }
    }
  }
  if (strayRows > 0) {
    failures += fail(`${strayRows} row(s) in ${[...strayRelations].join(', ')} belong to a `
      + 'file declined as Flow. Exactly one js_module row is owed and nothing else — a '
      + 'declined file that still emits is the silent half-extraction the ruling exists to '
      + 'prevent');
  }
  // SYNTACTIC_FLOW, whose MEANING changed with the ruling.
  //
  // It used to mean "this parameter carries a Flow annotation". Now that Flow
  // files emit nothing, a SYNTACTIC_FLOW row can only come from a file the
  // DETECTOR MISSED — Flow syntax with no `@flow` pragma and no `.js.flow`
  // name. So the value now measures the detector, not the language.
  //
  // Deliberately REPORTED and not asserted. What it counts is a property of the
  // corpus: a population that writes Flow without the pragma will produce these
  // however good the detector is, and a zero-row assertion would fail on a
  // correct parser meeting one. Each occurrence NAMES ITS FILE, because the
  // only useful response to a detection miss is to look at the file.
  const missed = new Map<string, number>();
  // STREAMED, over whichever trees this run extracted. The first version called
  // `readRelations` on the corpus and the materialisation guard stopped it by
  // name — which is the guard doing exactly its job, on the person who wrote it.
  for (const directory of [outputDir, extraOutputDir]) {
    if (directory === '') {
      continue;
    }
    const fileByModule = new Map<string, string>();
    const moduleHeader = headerOf(directory, 'js_module');
    if (moduleHeader.length === 0) {
      continue;
    }
    const modulePk = pkIndexOf(moduleHeader, 'js_module');
    const modulePath = moduleHeader.indexOf('filePath');
    forEachRow(directory, 'js_module', (row) => {
      fileByModule.set(row[modulePk] ?? '', row[modulePath] ?? '');
    });
    for (const { name } of relationFilesIn(directory)) {
      const header = headerOf(directory, name);
      const at = header.indexOf('declaredTypeSource');
      const owner = header.indexOf('ownerModuleLinkHash');
      if (at < 0 || owner < 0) {
        continue;
      }
      forEachRow(directory, name, (row) => {
        if (row[at] !== 'SYNTACTIC_FLOW') {
          return;
        }
        const file = fileByModule.get(row[owner] ?? '') ?? '?';
        missed.set(file, (missed.get(file) ?? 0) + 1);
      });
    }
  }
  if (missed.size > 0) {
    console.log(`  SYNTACTIC_FLOW in ${missed.size} file(s) the detector did not catch:`);
    for (const [file, n] of [...missed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`    ${n} row(s)  ${file}`);
    }
  }
  console.log(`  ${declined.size} file(s) declined as Flow, ${strayRows} stray rows, `
    + `${missed.size} detection miss(es)`);
  return failures;
}

/**
 * The suite owns every scratch directory it made, and leaves none behind.
 *
 * ## Nine `mkdtempSync` calls with no cleanup, in a suite built to catch leaks
 *
 * A corpus run writes four full fact bases — over a gigabyte each — and kept
 * every one. A compile eventually died with `ENOSPC: no space left on device`,
 * naming the compiler and not the cause, and one `rm` returned **72 GiB**.
 *
 * Fixing nine call sites is not a fix. The next scratch directory will be added
 * by someone who has not read this, and a suite that leaks temp directories
 * fails on a colleague's machine for reasons that have nothing to do with the
 * parser. So this ASSERTS the invariant instead:
 *
 * - every `js-gate-*` directory that exists right now is one this run
 *   registered, which fails the moment a call site bypasses `scratchDir`;
 * - and the registered ones actually disappear when removed, which fails if
 *   cleanup silently no-ops.
 *
 * It deliberately does not assert the temp directory is EMPTY of other
 * processes' scratch: two runs in parallel are legitimate, and a check that
 * forbids them would be wrong rather than strict.
 */
function scratchDirectoriesAreOwnedAndRemovable(): number {
  let failures = 0;
  const registered = new Set(scratchDirectories);
  // Only directories carrying THIS process's tag. A concurrent run's scratch is
  // not this run's business and is not consulted at all — by name, not by
  // guessing from a timestamp.
  const onDisk = fs.readdirSync(os.tmpdir())
    .filter((entry) => entry.startsWith(SCRATCH_TAG))
    .map((entry) => path.join(os.tmpdir(), entry));
  const leaked = onDisk.filter((directory) => !registered.has(directory));
  if (leaked.length > 0) {
    failures += fail(`${leaked.length} scratch directory(ies) were created by this run and `
      + `not registered, e.g. ${leaked[0]}. Every one must go through scratchDir() or it `
      + 'will not be removed — which is how this suite came to leave 72 GiB behind');
  }
  if (registered.size === 0) {
    failures += fail('no scratch directory was registered, so this check is vacuous — the '
      + 'suite cannot have run');
  }

  // And removal actually removes. A no-op cleanup would pass everything above.
  const probe = scratchDir('js-gate-probe-');
  fs.writeFileSync(path.join(probe, 'f.txt'), 'x');
  fs.rmSync(probe, { recursive: true, force: true });
  if (fs.existsSync(probe)) {
    failures += fail('a scratch directory survived its own removal — cleanup cannot be '
      + 'trusted, and the leak would be silent');
  }
  console.log(`  ${registered.size} scratch directories registered, ${leaked.length} leaked`);
  return failures;
}

/**
 * Extensions are decided in ONE place, and a new multi-part one reaches
 * every consumer.
 *
 * ## The question this answers, asked three times before it was true
 *
 * `path.extname` returns only the last part. A sweep found six sites comparing
 * extensions and FIVE assumed one part — including this suite's own name check,
 * which then failed a parser that had become right. Collapsing them to
 * `jsExtensionOf` fixed those six.
 *
 * It was still not "they all call it now". Four more turned up on the next
 * audit: the `.mjs`/`.cjs` override check in this file — which therefore skipped
 * `a.cjs.flow`, the one file most able to break the rule it guards — the
 * JSX-in-plain-`.js` counter beside it, and an EIGHTH spelling written into the
 * AST-recall harness during the very session that collapsed the other seven.
 *
 * So the invariant is asserted rather than remembered, in two halves, because
 * either alone is escapable:
 *
 * 1. **BEHAVIOURAL.** Every predicate agrees on a table that includes every
 *    multi-part form. Adding `.js.flow` to the list must make all four answer
 *    together — that is the "picked up by all consumers" property, and it is
 *    checked against the real functions rather than a restatement of them.
 * 2. **SOURCE-LEVEL.** No file under the JavaScript paths may compare a file
 *    name against a known JavaScript extension except through the util. This is
 *    the half that catches a NINTH spelling, which the behavioural half cannot:
 *    a new hand-rolled comparison agrees with everything until the day it does
 *    not.
 */
function extensionsAreDecidedInOnePlace(): number {
  let failures = 0;

  // ---- 1. behavioural: the table every predicate must agree on.
  const CASES: ReadonlyArray<readonly [string, string, boolean, boolean, string]> = [
    // name              jsExtensionOf  isSource  isFlowDecl  stem
    ['a.js', '.js', true, false, 'a'],
    ['a.jsx', '.jsx', true, false, 'a'],
    ['a.mjs', '.mjs', true, false, 'a'],
    ['a.cjs', '.cjs', true, false, 'a'],
    // The multi-part forms. Flow's convention is `<name>.<ext>.flow`, so all
    // four JavaScript extensions have a declaration spelling and every one of
    // them must be discovered — `.cjs.flow` was invisible after the first fix,
    // because that fix added a literal string instead of describing the shape.
    ['a.js.flow', '.js', true, true, 'a'],
    ['a.jsx.flow', '.jsx', true, true, 'a'],
    ['a.mjs.flow', '.mjs', true, true, 'a'],
    ['a.cjs.flow', '.cjs', true, true, 'a'],
    // Multi-part names that are NOT a second extension: the JavaScript one is
    // still the last, and the middle part is just a name.
    ['a.min.js', '.js', true, false, 'a.min'],
    ['a.test.js', '.js', true, false, 'a.test'],
    ['a.config.mjs', '.mjs', true, false, 'a.config'],
    // Case, which is a real spelling on a case-insensitive filesystem.
    ['A.JS', '.js', true, false, 'A'],
    // Not JavaScript at all.
    // `jsExtensionOf` answers with a JAVASCRIPT extension or nothing. Returning
    // `.ts` here would make `stripJsExtension` cut an extension off a file that
    // has no JavaScript one — which it did, until this table said so.
    ['a.ts', '', false, false, 'a.ts'],
    ['a.json', '', false, false, 'a.json'],
    ['a.flow', '', false, false, 'a.flow'],
    ['README', '', false, false, 'README'],
  ];
  for (const [name, extension, isSource, isFlowDeclaration, stem] of CASES) {
    if (jsExtensionOf(name) !== extension) {
      failures += fail(`jsExtensionOf(${name}) is ${jsExtensionOf(name)}, expected ${extension}`);
    }
    if (isJavaScriptSourceFile(name) !== isSource) {
      failures += fail(`isJavaScriptSourceFile(${name}) is ${!isSource}, expected ${isSource}`);
    }
    if (isFlowDeclarationFileName(name) !== isFlowDeclaration) {
      failures += fail(`isFlowDeclarationFileName(${name}) is ${!isFlowDeclaration}, `
        + `expected ${isFlowDeclaration}`);
    }
    if (stripJsExtension(name) !== stem) {
      failures += fail(`stripJsExtension(${name}) is ${stripJsExtension(name)}, `
        + `expected ${stem}`);
    }
  }

  // Every declared extension has a Flow declaration spelling that is
  // discovered. Derived from the constant, so ADDING an extension is covered
  // without editing this check — which is the property the table above cannot
  // have on its own.
  for (const extension of JS_SOURCE_EXTENSIONS) {
    const declaration = `x${extension}.flow`;
    if (!isJavaScriptSourceFile(declaration)) {
      failures += fail(`${declaration} is not recognised as a source file. Every JavaScript `
        + 'extension has a `<name>.<ext>.flow` declaration spelling, and one that is not '
        + 'discovered is a silent absence rather than a recorded rejection');
    }
    if (!isFlowDeclarationFileName(declaration)) {
      failures += fail(`${declaration} is not recognised as a Flow declaration file`);
    }
  }

  // ---- 2. source-level: nobody rolls their own.
  const KNOWN = ['.js', '.jsx', '.mjs', '.cjs', '.flow'];
  const files: string[] = [];
  const collect = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (entry.name.endsWith('.ts')) {
        files.push(full);
      }
    }
  };
  for (const directory of ['src/parsers/javascript', 'src/utils/javascript',
    'src/workflows/javascript', 'src/enums/javascript', 'src/analysis-types/javascript']) {
    if (fs.existsSync(directory)) {
      collect(directory);
    }
  }
  files.push('src/language-detectors/javascript-detector.ts');
  files.push('src/test/javascript-tests.ts');
  files.push('src/test/javascript-gates/ast-recall.ts');
  files.push('src/constants/javascript-constants.ts');

  let offenders = 0;
  for (const file of files) {
    if (file.endsWith('javascript-module-utils.ts')) {
      // The one place allowed to know. Everything here is the definition.
      continue;
    }
    const source = fs.readFileSync(file, 'utf-8');
    source.split('\n').forEach((line, index) => {
      // Comments explain the rule constantly; only CODE is checked.
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      // The three forms that ACTUALLY failed, and not the one that is correct.
      //
      // Comparing the OUTPUT of `jsExtensionOf` to a literal — `extension ===
      // '.mjs'` — is the intended use and must not be flagged; the first draft
      // of this check flagged all eight call sites including the four it had
      // just fixed. What is forbidden is deriving the extension yourself:
      // `extname`, a raw `endsWith` on a file name, or cutting at the last dot.
      const compares = /\bextname\s*\(/.test(code)
        || /\blastIndexOf\s*\(\s*'\.'\s*\)/.test(code)
        || KNOWN.some((extension) => new RegExp(
          `endsWith\\s*\\(\\s*['"]\\${extension}['"]`
        ).test(code));
      if (!compares) {
        return;
      }
      offenders += 1;
      failures += fail(`${file}:${index + 1} compares a file extension directly: `
        + `${line.trim().slice(0, 72)}. Use jsExtensionOf — path.extname returns only the `
        + 'LAST part, and five of six sites got that wrong before this check existed');
    });
  }
  console.log(`  ${CASES.length} name cases x 4 predicates, `
    + `${JS_SOURCE_EXTENSIONS.length} flow spellings, ${files.length} files scanned, `
    + `${offenders} hand-rolled comparison(s)`);
  return failures;
}

/**
 * A reused name resolves to the declaration a reader would see.
 *
 * ## The gate belongs on the INDEX's uniqueness, not the source's
 *
 * Six internal keys were tuples of names: `js_parse_gap`'s primary key,
 * `boundVariableLinkHash`, `typeByName`, `importByLocalName`,
 * `declarationTargetByName` and `accessorFieldByOwnerAndName`. A name is not an
 * identity — §2 says node identity is the BYTE RANGE — and JavaScript promises
 * unique names nowhere. Over 4,561 files: 570 + 252 + 57 + 4 colliding keys,
 * 4,755 shadowed rows, every one of them resolved to the wrong declaration or
 * merged with a different one.
 *
 * Reusing a name is LEGAL, so a check forbidding it would be wrong rather than
 * strict. What can be asserted is what each index now does with the reuse: a
 * reference resolves to the nearest preceding declaration of that name, a
 * static and an instance accessor are two members, and a computed accessor
 * pairs with nothing because whether `[a]` and `[a]` are one property is a
 * runtime fact.
 */
function reusedNamesResolveByPosition(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const byName = new Map(relations.map((r) => [r.name, r]));
  const modules = byName.get('js_module');
  const types = byName.get('js_type');
  const methods = byName.get('js_method');
  const exports_ = byName.get('js_export');
  const fields = byName.get('js_field');
  if (modules === undefined || types === undefined || methods === undefined
    || exports_ === undefined || fields === undefined) {
    return fail('a relation is missing');
  }
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const moduleHash = modules.rows.find((r) => (r[mPath] ?? '').endsWith('name-reuse.js'))?.[mPk];
  if (moduleHash === undefined) {
    return fail('the name-reuse scaffold file was not extracted');
  }
  const inFile = (relation: Relation): ReadonlyArray<readonly string[]> => relation.rows.filter(
    (r) => r[relation.header.indexOf('ownerModuleLinkHash')] === moduleHash
  );

  // typeByName: each Parser.prototype member belongs to the Parser above it.
  const typeLine = new Map(inFile(types).map((r) => [
    r[pkIndexOf(types.header, 'js_type')] ?? '', Number(r[types.header.indexOf('startLine')]),
  ]));
  const owner = methods.header.indexOf('ownerTypeLinkHash');
  const mName = methods.header.indexOf('name');
  const mLine = methods.header.indexOf('startLine');
  for (const [member, expectedTypeLine] of [['first', 5], ['second', 10]] as const) {
    const row = inFile(methods).find((r) => r[mName] === member);
    const got = row === undefined ? undefined : typeLine.get(row[owner] ?? '');
    if (got !== expectedTypeLine) {
      failures += fail(`Parser.prototype.${member} is owned by the Parser at line ${got}, `
        + `expected the one at line ${expectedTypeLine} — the nearest preceding declaration, `
        + 'not the first one in the file');
    }
  }

  // declarationTargetByName: each export reaches the author above it, AS A
  // METHOD — position disambiguates within a kind and the kind priority holds.
  const methodLine = new Map(inFile(methods).map((r) => [
    r[pkIndexOf(methods.header, 'js_method')] ?? '', Number(r[mLine]),
  ]));
  const eName = exports_.header.indexOf('exportedName');
  const eTarget = exports_.header.indexOf('targetLinkHash');
  const eKind = exports_.header.indexOf('targetKind');
  for (const [exported, expectedLine] of [['author', 2], ['authorLate', 13]] as const) {
    const row = inFile(exports_).find((r) => r[eName] === exported);
    const got = row === undefined ? undefined : methodLine.get(row[eTarget] ?? '');
    if (got !== expectedLine || row?.[eKind] !== 'METHOD') {
      failures += fail(`exports.${exported} targets ${row?.[eKind]} at line ${got}, expected `
        + `METHOD at line ${expectedLine}`);
    }
  }

  // accessorFieldByOwnerAndName: static x and instance x are two pairs; the two
  // computed getters are two fields and neither is a pair.
  const fName = fields.header.indexOf('name');
  const fStatic = fields.header.indexOf('isStatic');
  const fPair = fields.header.indexOf('accessorPairKind');
  const xs = inFile(fields).filter((r) => r[fName] === 'x');
  if (xs.length !== 2 || !xs.every((r) => r[fPair] === 'GETTER_SETTER')
    || new Set(xs.map((r) => r[fStatic])).size !== 2) {
    failures += fail(`accessor x: ${xs.length} field row(s) `
      + `[${xs.map((r) => `${r[fStatic]}:${r[fPair]}`).join(', ')}], expected one static and `
      + 'one instance GETTER_SETTER pair — staticness is part of the member\'s identity');
  }
  const computed = inFile(fields).filter((r) => r[fName] === '' && r[fPair] !== '');
  if (computed.length !== 2 || !computed.every((r) => r[fPair] === 'GETTER_ONLY')) {
    failures += fail(`computed accessors: ${computed.length} row(s) `
      + `[${computed.map((r) => r[fPair]).join(', ')}], expected two GETTER_ONLY — a computed `
      + 'key cannot be known to be the same property, so they must not merge');
  }
  // importByBindingNode: the import row's reverse link is the variable that IS
  // its binding, never a same-named local; and the local carries no import.
  const imports = byName.get('js_import')!;
  const variables = byName.get('js_variable')!;
  const iOwner = imports.header.indexOf('ownerModuleLinkHash');
  const iLocal = imports.header.indexOf('localName');
  const iBound = imports.header.indexOf('boundVariableLinkHash');
  const vPk2 = pkIndexOf(variables.header, 'js_variable');
  const vName2 = variables.header.indexOf('name');
  const vLine2 = variables.header.indexOf('startLine');
  const vImport = variables.header.indexOf('importLinkHash');
  const vOwner = variables.header.indexOf('ownerModuleLinkHash');
  const paintImport = imports.rows.find((r) => r[iOwner] === moduleHash && r[iLocal] === 'paint');
  const boundLine = variables.rows.find((r) => r[vPk2] === paintImport?.[iBound])?.[vLine2];
  if (boundLine !== '1') {
    failures += fail(`the paint import's boundVariableLinkHash points at the variable on line `
      + `${boundLine}, expected line 1 — the shadowing local claimed the reverse link`);
  }
  const shadow = variables.rows.find((r) => r[vOwner] === moduleHash && r[vName2] === 'paint'
    && r[vLine2] !== '1');
  if (shadow === undefined || (shadow[vImport] ?? '') !== '') {
    failures += fail('the local `const paint` inside shadow() carries an importLinkHash. It is '
      + 'not bound by the import; only the declaration that IS the import\'s binding is');
  }
  console.log('  Parser x2, author x2, static/instance x, two computed getters, one shadowed '
    + 'import — all resolved');
  return failures;
}

/**
 * Two constructs that emitted nothing, each with a working control beside it.
 *
 * Both were found by js-corpus's AST recall and both are the same shape: the
 * construct is reached, the row is absent, and nothing counts it because the
 * control right next to it works.
 *
 * - A trailing comment after a SEPARATOR. `1, // note` — the comma belongs to
 *   no node, so it is neither the element's trailing trivia nor the next
 *   element's leading trivia (the compiler does not collect a same-line comment
 *   as leading). It is the trailing trivia of a token, and a node walk never
 *   visits a token. 2,211 of 64,157.
 * - `export * as ns from 'm'`. Its clause is a NamespaceExport, which is neither
 *   `undefined` (bare `export *`) nor NamedExports (`export { a as b }`), and it
 *   fell between the two branches.
 */
function separatorCommentsAndNamespaceReexportsEmit(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const moduleOf = (suffix: string): string | undefined =>
    modules.rows.find((r) => (r[mPath] ?? '').endsWith(suffix))?.[mPk];

  const comments = relations.find((r) => r.name === 'js_comment')!;
  const cOwner = comments.header.indexOf('ownerModuleLinkHash');
  const cLine = comments.header.indexOf('startLine');
  const cText = comments.header.indexOf('text');
  const commentModule = moduleOf('separator-comments.js');
  const mine = comments.rows.filter((r) => r[cOwner] === commentModule);
  for (const [line, construct] of [
    [1, 'a statement'], [3, 'an array element'], [7, 'an object property'],
    [11, 'a parameter'], [16, 'a parenthesis'], [17, 'a case label'],
  ] as const) {
    if (!mine.some((r) => Number(r[cLine]) === line && (r[cText] ?? '').includes(construct))) {
      failures += fail(`the trailing comment after ${construct} (line ${line}) emitted no `
        + 'js_comment row. The comma belongs to no node, so a node walk never reaches the '
        + 'trivia after it');
    }
  }

  const cDirective = comments.header.indexOf('directiveKind');
  const directiveAt = (line: number): string | undefined =>
    mine.find((r) => Number(r[cLine]) === line)?.[cDirective];
  if (directiveAt(14) !== 'ESLINT' || directiveAt(15) !== 'NONE') {
    failures += fail(`eslint directive detection: line 14 is ${directiveAt(14) ?? 'no row'}, line 15 is `
      + `${directiveAt(15) ?? 'no row'}; expected ESLINT then NONE. A directive sits at the comment's `
      + 'START, as ESLint requires; matching the word followed by a space anywhere made prose a directive');
  }

  const exports_ = relations.find((r) => r.name === 'js_export')!;
  const eOwner = exports_.header.indexOf('ownerModuleLinkHash');
  const eName = exports_.header.indexOf('exportedName');
  const eForm = exports_.header.indexOf('exportForm');
  const eImport = exports_.header.indexOf('reExportImportLinkHash');
  const exportModule = moduleOf('reexport-forms.js');
  const rows = exports_.rows.filter((r) => r[eOwner] === exportModule);
  for (const [name, form, wantsImport, construct] of [
    ['*', 'EXPORT_ALL', true, "bare `export * from`"],
    ['renamed', 'EXPORT_DECLARATION', true, "`export { a as b } from` (#483: an import in one statement too)"],
    ['ns', 'EXPORT_ALL', true, "`export * as ns from`"],
    ['default', 'EXPORT_DECLARATION', true, "`export { default } from`"],
    ['serviceDefault', 'EXPORT_DECLARATION', true, "`export { default as x } from`"],
  ] as const) {
    const row = rows.find((r) => r[eName] === name);
    if (row === undefined) {
      failures += fail(`${construct} emitted no js_export row`);
      continue;
    }
    if (row[eForm] !== form) {
      failures += fail(`${construct} has exportForm ${row[eForm]}, expected ${form}`);
    }
    if (((row[eImport] ?? '') !== '') !== wantsImport) {
      failures += fail(`${construct} ${wantsImport ? 'lacks' : 'has'} a reExportImportLinkHash`);
    }
  }
  // #176: `export default function named()` / `export default class Klass`.
  const eLocal = exports_.header.indexOf('localName');
  const eTarget = exports_.header.indexOf('targetKind');
  const mDefault = modules.header.indexOf('defaultExportLinkHash');
  const ePk = pkIndexOf(exports_.header, 'js_export');
  for (const [file, local, target] of [
    ['default-named.js', 'named', 'METHOD'], ['default-class.js', 'Klass', 'TYPE'],
    ['default-anon.js', 'default', 'TYPE'],
  ] as const) {
    const moduleRow = modules.rows.find((r) => (r[mPath] ?? '').endsWith(file));
    const moduleHash = moduleRow?.[mPk] ?? '';
    const row = exports_.rows.find((r) => r[eOwner] === moduleHash && r[eLocal] === local);
    const eTargetLink = exports_.header.indexOf('targetLinkHash');
    if (row?.[eName] !== 'default' || row[eForm] !== 'EXPORT_DECLARATION' || row[eTarget] !== target
      || (row[eTargetLink] ?? '') === '' || moduleRow?.[mDefault] !== row[ePk]) {
      failures += fail(`${file}: \`export default ${target === 'TYPE' ? 'class' : 'function'} ${local}\` is exported as `
        + `${JSON.stringify(row?.[eName])} (${row?.[eForm]}/${row?.[eTarget]}), module default link `
        + `${moduleRow?.[mDefault] === row?.[ePk] ? 'set' : 'NOT this row'}; expected default/${local} with the `
        + `module naming it${(row?.[eTargetLink] ?? '') === '' ? ' — and the target link is EMPTY' : ''} — the default modifier `
        + 'decides, not whether the declaration has a name (#176); an anonymous declaration is its own target (#484)');
    }
    const control = exports_.rows.find((r) => r[eOwner] === moduleHash && r[eLocal] === 'plain');
    if (file === 'default-named.js' && control?.[eName] !== 'plain') {
      failures += fail(`default-named.js: the control \`export function plain\` is exported as ${JSON.stringify(control?.[eName])}`);
    }
  }
  // `@type` over an assignment to a bare identifier resolves to the VARIABLE.
  const refs = relations.find((r) => r.name === 'js_type_reference')!;
  const variables = relations.find((r) => r.name === 'js_variable')!;
  const rOwner = refs.header.indexOf('ownerModuleLinkHash');
  const rLine = refs.header.indexOf('startLine');
  const rContext = refs.header.indexOf('contextKind');
  const rOwnerKind = refs.header.indexOf('ownerKind');
  const rOwnerLink = refs.header.indexOf('ownerLinkHash');
  const vPk = pkIndexOf(variables.header, 'js_variable');
  const vName = variables.header.indexOf('name');
  const variableName = new Map(variables.rows.map((r) => [r[vPk] ?? '', r[vName] ?? '']));
  const typeModule = moduleOf('type-over-assignment.js');
  const typed = refs.rows.filter((r) => r[rOwner] === typeModule);
  // Positioned at the TYPE EXPRESSION, which sits in the comment on the line
  // above the statement — a reference row's position is the type's, not the
  // annotated construct's.
  for (const [line, variable, where] of [
    [4, 'ret', 'at module level'], [11, 'local', 'inside a body'],
  ] as const) {
    const row = typed.find((r) => Number(r[rLine]) === line);
    if (row === undefined || row[rContext] !== 'VARIABLE' || row[rOwnerKind] !== 'VARIABLE'
      || variableName.get(row[rOwnerLink] ?? '') !== variable) {
      failures += fail(`@type over \`${variable} = …\` ${where} (line ${line}) did not produce a `
        + `VARIABLE reference owned by ${variable}: got ${row?.[rContext] ?? 'nothing'}. This is `
        + 'the shape a route-everything-to-CAST fix grabs first, because it was the one silent');
    }
  }
  if (typed.some((r) => Number(r[rLine]) === 6)) {
    failures += fail('@type over `raw.push(4)` (line 6) produced a reference. A call statement '
      + 'attaches to nothing the parser can type and must stay nothing');
  }
  // EXPRESSION owners: the object-literal property's value, and the exports
  // assignment. Each must be owned by a js_expression row of the right kind.
  const expressions = relations.find((r) => r.name === 'js_expression')!;
  const xPk = pkIndexOf(expressions.header, 'js_expression');
  const xKind = expressions.header.indexOf('expressionKind');
  const expressionKind = new Map(expressions.rows.map((r) => [r[xPk] ?? '', r[xKind] ?? '']));
  for (const [line, construct, kind] of [
    [16, 'an object-literal property', 'ARRAY_LITERAL'],
    [19, 'an exports-member assignment', 'ASSIGNMENT'],
  ] as const) {
    const row = typed.find((r) => Number(r[rLine]) === line);
    const got = row === undefined ? 'nothing' : `${row[rOwnerKind]} over `
      + `${expressionKind.get(row[rOwnerLink] ?? '') ?? 'an unknown row'}`;
    if (row?.[rOwnerKind] !== 'EXPRESSION'
      || expressionKind.get(row[rOwnerLink] ?? '') !== kind) {
      failures += fail(`@type over ${construct} (line ${line}) should be owned by the `
        + `${kind} expression row and is ${got}. EXPRESSION is the owner of last resort — `
        + 'one value, because ownerKind names the relation and expressionKind carries the rest');
    }
  }
  // The multi-declarator rule: first declarator typed, second NONE, one row.
  const vType = variables.header.indexOf('declaredTypeName');
  const vSource = variables.header.indexOf('declaredTypeSource');
  const vOwner = variables.header.indexOf('ownerModuleLinkHash');
  const first = variables.rows.find((r) => r[vOwner] === typeModule && r[vName] === 'firstOfTwo');
  const second = variables.rows.find((r) => r[vOwner] === typeModule && r[vName] === 'secondOfTwo');
  if (first?.[vType] !== 'number' || second?.[vType] !== '' || second?.[vSource] !== 'NONE') {
    failures += fail(`multi-declarator: firstOfTwo=${first?.[vType]}, secondOfTwo=`
      + `${second?.[vType]}/${second?.[vSource]}. tsc gives the @type to the FIRST declarator `
      + 'and undefined to the second, and the rule follows tsc rather than taste');
  }
  // CAST: owned by the wrapped expression, and the two controls stay silent.
  const contextsAt = (line: number): string[] =>
    typed.filter((r) => Number(r[rLine]) === line).map((r) => `${r[rContext]}/${r[rOwnerKind]}`);
  if (contextsAt(23).join() !== 'CAST/EXPRESSION') {
    failures += fail(`the parenthesised cast (line 23) produced ${JSON.stringify(contextsAt(23))}, `
      + 'expected exactly CAST owned by the expression the parentheses wrap');
  }
  if (contextsAt(24).join() !== 'VARIABLE/VARIABLE') {
    failures += fail(`@type over \`const parenInit = (raw)\` (line 24) produced `
      + `${JSON.stringify(contextsAt(24))}, expected VARIABLE only. The parentheses are just `
      + 'parentheses; reading the declaration\'s tag off them makes a cast out of an initialiser');
  }
  if (contextsAt(26).length !== 0) {
    failures += fail(`the unparenthesised @type before an arrow (line 26) produced `
      + `${JSON.stringify(contextsAt(26))}. Without parentheses the comment asserts nothing to `
      + 'the compiler, and the ruling counts only the parenthesised form as CAST');
  }
  if (contextsAt(33).join() !== 'CAST/EXPRESSION') {
    failures += fail(`the cast in a parameter default (line 33) produced `
      + `${JSON.stringify(contextsAt(33))}, expected exactly one CAST. Two rows means the `
      + 'default was visited on two paths — constraint 4, a duplicate key doubles');
  }
  // THROWS: one row per tag, owned by the method.
  const throwsRows = typed.filter((r) => r[rContext] === 'THROWS');
  const throwsNames = throwsRows.map((r) => r[refs.header.indexOf('typeName')]).sort();
  if (throwsNames.join() !== 'RangeError,TypeError'
    || !throwsRows.every((r) => r[rOwnerKind] === 'METHOD')) {
    failures += fail(`@throws produced ${JSON.stringify(throwsNames)} owned by `
      + `${JSON.stringify([...new Set(throwsRows.map((r) => r[rOwnerKind]))])}, expected `
      + 'RangeError and TypeError each as a THROWS row owned by the method');
  }
  const multiRows = typed.filter((r) => Number(r[rLine]) === 21);
  if (multiRows.length !== 1 || variableName.get(multiRows[0]?.[rOwnerLink] ?? '') !== 'firstOfTwo') {
    failures += fail(`multi-declarator: ${multiRows.length} reference row(s) at line 21, `
      + 'expected exactly one, owned by firstOfTwo');
  }
  console.log(`  ${mine.length} separator comments, ${rows.length} re-export forms, `
    + `${typed.length} @type references over assignments`);
  return failures;
}

/**
 * A scope link points at a scope of the KIND the column claims.
 *
 * ## Every method's body scope was its enclosing scope, and nothing said so
 *
 * The binder exposes two maps: `enclosingScopeOf`, the scope a node is IN, and
 * `scopeByNode`, the scope a node OPENS. The walk read the first where it meant
 * the second, so `js_method.bodyScopeLinkHash` pointed at the enclosing scope on
 * every row, every FUNCTION_BODY block linked the wrong scope, and constructor
 * functions — whose code took `.parent` to compensate — had
 * `ownerScopeLinkHash = GLOBAL`.
 *
 * Every one of those values was a valid scope hash. The FK gate passed. The
 * sufficiency measure counted them as carried because it asked only whether
 * the column was non-empty. This is the gap those checks have in common: a link
 * that is populated, resolvable and WRONG is invisible to both.
 *
 * So this asserts what the column MEANS, by kind: a callable's body scope is a
 * callable scope and is not the scope the callable sits in; a class's scope is
 * a class scope; a FUNCTION_BODY block opens a callable scope; no type declared
 * in a file lives in GLOBAL.
 */
function scopeLinksPointWhereTheyClaim(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const kindOf = new Map<string, string>();
  const scopeHeader = headerOf(directory, 'js_scope');
  const scopePk = pkIndexOf(scopeHeader, 'js_scope');
  const scopeKind = scopeHeader.indexOf('scopeKind');
  forEachRow(directory, 'js_scope', (r) => { kindOf.set(r[scopePk] ?? '', r[scopeKind] ?? ''); });

  const CALLABLE = new Set(['FUNCTION', 'ARROW', 'CLASS_STATIC_BLOCK']);
  let methods = 0; let bad = 0; let sameAsOwner = 0;
  const mh = headerOf(directory, 'js_method');
  const mKind = mh.indexOf('methodKind'); const mBody = mh.indexOf('bodyScopeLinkHash');
  const mOwner = mh.indexOf('ownerScopeLinkHash'); const mName = mh.indexOf('name');
  const mLine = mh.indexOf('startLine');
  forEachRow(directory, 'js_method', (r) => {
    if (r[mKind] === 'MODULE_INITIALIZER') { return; }
    methods += 1;
    const kind = kindOf.get(r[mBody] ?? '') ?? '';
    if (!CALLABLE.has(kind)) {
      bad += 1;
      if (bad <= 2) {
        failures += fail(`js_method ${r[mName]} (line ${r[mLine]}): bodyScopeLinkHash points at `
          + `a ${kind || 'missing'} scope. A callable's body scope is the scope it OPENS, `
          + 'which is a FUNCTION, ARROW or CLASS_STATIC_BLOCK scope — not the one it sits in');
      }
    }
    if ((r[mBody] ?? '') === (r[mOwner] ?? '')) { sameAsOwner += 1; }
  });
  if (bad > 2) { failures += fail(`${bad} method(s) with a non-callable body scope in total`); }
  if (sameAsOwner > 0) {
    failures += fail(`${sameAsOwner} method(s) whose bodyScopeLinkHash equals ownerScopeLinkHash `
      + '— the walk read "the scope this node is in" as "the scope this node opens"');
  }

  let globalTypes = 0;
  const th = headerOf(directory, 'js_type');
  const tScope = th.indexOf('ownerScopeLinkHash'); const tName = th.indexOf('name');
  forEachRow(directory, 'js_type', (r) => {
    if (kindOf.get(r[tScope] ?? '') === 'GLOBAL') {
      globalTypes += 1;
      if (globalTypes <= 2) {
        failures += fail(`js_type ${r[tName]} has ownerScopeLinkHash = GLOBAL. A type declared `
          + 'in a file sits in its module scope or deeper; GLOBAL is the `.parent` overshoot');
      }
    }
  });

  let bodyBlocks = 0; let badBlocks = 0;
  const bh = headerOf(directory, 'js_block');
  const bKind = bh.indexOf('blockKind'); const bScope = bh.indexOf('scopeLinkHash');
  forEachRow(directory, 'js_block', (r) => {
    if (r[bKind] !== 'FUNCTION_BODY') { return; }
    bodyBlocks += 1;
    if (!CALLABLE.has(kindOf.get(r[bScope] ?? '') ?? '')) { badBlocks += 1; }
  });
  if (badBlocks > 0) {
    failures += fail(`${badBlocks} of ${bodyBlocks} FUNCTION_BODY blocks link a non-callable scope`);
  }
  if (methods === 0 || bodyBlocks === 0) {
    failures += fail('no methods or no body blocks — the check is vacuous');
  }
  console.log(`  ${methods} callables, ${bodyBlocks} body blocks, ${globalTypes} types in GLOBAL`);
  return failures;
}

/**
 * Every FK column has a MEANING assertion, or is named as having only integrity.
 *
 * ## The blind spot, and its size
 *
 * `js_method.bodyScopeLinkHash` was the enclosing scope on every row since the
 * first commit. Every value was a valid scope hash, so the FK gate passed; the
 * sufficiency report counted it as carried because it asked only non-empty. A
 * link that is populated, resolvable and WRONG is the one shape both have a
 * blind spot for — and every other link column checked only for those two
 * properties was sitting in the same spot for the whole project.
 *
 * So this enumerates all 84 populated FK columns and asserts, for each one it
 * can, what the link MEANS, in four families:
 *
 * - NAME: the linked row's name equals a column on the source row
 *   (`resolvedBindingLinkHash` → a variable named `referencedName`).
 * - KIND: the linked row is of the kind the column claims
 *   (`moduleInitMethodLinkHash` → a MODULE_INITIALIZER).
 * - STRUCTURE: parent/child depth agree; a parameter's scope is its method's
 *   body scope; a root has no parent and a non-root has one.
 * - POSITION: a comment attached to a row ends before the row starts.
 *
 * The rest are printed BY NAME as integrity-only, with the reason, so the
 * residue is enumerable on demand rather than a percentage. A column that
 * gains a meaning check moves off that list; one that stops being checked
 * appears on it.
 */
function linkColumnsMeanWhatTheyClaim(): number {
  let failures = 0;
  const directory = extraOutputDir !== '' ? extraOutputDir : outputDir;
  const index = <T>(relation: string, pick: (r: string[], h: string[]) => T): Map<string, T> => {
    const out = new Map<string, T>();
    const h = headerOf(directory, relation);
    if (h.length === 0) { return out; }
    const pk = pkIndexOf(h, relation);
    forEachRow(directory, relation, (r, hh) => { out.set(r[pk] ?? '', pick(r, hh)); });
    return out;
  };
  const col = (h: string[], name: string): number => h.indexOf(name);

  // ---- small relations, indexed
  const scopes = index('js_scope', (r, h) => ({
    kind: r[col(h, 'scopeKind')] ?? '', depth: Number(r[col(h, 'depth')] ?? -1),
    start: [Number(r[col(h, 'startLine')]), Number(r[col(h, 'startColumn')])] as [number, number],
  }));
  const methods = index('js_method', (r, h) => ({
    kind: r[col(h, 'methodKind')] ?? '', name: r[col(h, 'name')] ?? '',
    bodyScope: r[col(h, 'bodyScopeLinkHash')] ?? '', line: Number(r[col(h, 'startLine')]),
  }));
  const parameters = index('js_method_parameter', (r, h) => ({
    name: r[col(h, 'name')] ?? '', form: r[col(h, 'bindingForm')] ?? '',
  }));
  const variables = index('js_variable', (r, h) => ({
    name: r[col(h, 'name')] ?? '', line: Number(r[col(h, 'startLine')]),
    root: r[col(h, 'patternRootVariableLinkHash')] ?? '',
  }));
  const imports = index('js_import', (r, h) => ({
    local: r[col(h, 'localName')] ?? '', bearer: r[col(h, 'edgeBearer')] ?? '',
    imported: r[col(h, 'importedName')] ?? '', form: r[col(h, 'importForm')] ?? '',
  }));
  const exports_ = index('js_export', (r, h) => ({
    form: r[col(h, 'exportForm')] ?? '', name: r[col(h, 'exportedName')] ?? '',
  }));
  const types = index('js_type', (r, h) => ({
    name: r[col(h, 'name')] ?? '', line: Number(r[col(h, 'startLine')]),
    commentOnly: r[col(h, 'evidenceKind')] === 'COMMENT_ONLY',
  }));
  const fields = index('js_field', (r, h) => ({
    name: r[col(h, 'name')] ?? '', line: Number(r[col(h, 'startLine')]),
  }));
  const blocks = index('js_block', (r, h) => ({
    depth: Number(r[col(h, 'depth')] ?? -1),
    span: [Number(r[col(h, 'startLine')]), Number(r[col(h, 'startColumn')]),
      Number(r[col(h, 'endLine')]), Number(r[col(h, 'endColumn')])] as [number, number, number, number],
  }));
  const refs = index('js_type_reference', (r, h) => ({
    depth: Number(r[col(h, 'depth')] ?? -1),
    start: [Number(r[col(h, 'startLine')]), Number(r[col(h, 'startColumn')])] as [number, number],
  }));
  const comments = index('js_comment', (r, h) => ({ end: Number(r[col(h, 'endLine')] ?? 0) }));
  const callSites = index('js_call_site', (r, h) => ({
    expression: r[col(h, 'expressionLinkHash')] ?? '',
  }));
  // Expressions are too large to index whole; two narrow structures are built
  // instead. The second is the parent index, and it is the important one.
  const receiverRows = new Set<string>();
  // THE FOUR SELF-REFERENTIAL PARENT LINKS ARE THE HIGHEST-RISK CATEGORY.
  // parentExpressionLinkHash, parentBlockLinkHash, parentScopeLinkHash,
  // parentReferenceLinkHash: source and target are the SAME relation, so every
  // hash resolves and the wrong-target failure mode cannot occur. A mis-parented
  // node yields a tree that is valid, traversable and wrong — the scope defect's
  // shape with no possible integrity signal at all. So each is asserted for
  // CONTAINMENT where the rows carry an end position (blocks, expressions) and
  // for depth-plus-ordering where they carry only a start (scopes, references).
  // Depth alone is not enough: a node re-parented to the wrong node at the same
  // depth passes a depth check.
  {
    const h = headerOf(directory, 'js_expression');
    const pk = pkIndexOf(h, 'js_expression'); const role = col(h, 'edgeRole');
    forEachRow(directory, 'js_expression', (r) => {
      if (r[role] === 'RECEIVER') { receiverRows.add(r[pk] ?? ''); }
    });
  }
  const contains = (
    outer: readonly [number, number, number, number], inner: readonly [number, number, number, number]
  ): boolean => {
    const [osl, osc, oel, oec] = outer; const [isl, isc, iel, iec] = inner;
    const startsBefore = osl < isl || (osl === isl && osc <= isc);
    const endsAfter = oel > iel || (oel === iel && oec >= iec);
    return startsBefore && endsAfter;
  };

  type Verdict = { checked: number; wrong: number; example: string };
  const verdicts = new Map<string, Verdict>();
  const assert_ = (column: string, ok: boolean, example: () => string): void => {
    const v = verdicts.get(column) ?? { checked: 0, wrong: 0, example: '' };
    v.checked += 1;
    if (!ok) { v.wrong += 1; if (v.example === '') { v.example = example(); } }
    verdicts.set(column, v);
  };
  const lineOf = (r: string[], h: string[]): string => `line ${r[col(h, 'startLine')]}`;

  // ---- NAME agreement, and the expression PARENT link, per MODULE
  //
  // The parent index cannot be global: 2.2 M parents over a 4,561-file corpus
  // is the materialisation that killed a run once already. But rows are written
  // contiguously per module and a parent link never crosses one — the
  // same-module gate asserts that — so the index only ever needs to hold the
  // module being read. One window, flushed on every module change.
  type ExpressionRow = {
    pk: string; parent: string; depth: number;
    span: [number, number, number, number]; line: string;
  };
  let window: ExpressionRow[] = [];
  let windowModule = '';
  const flushWindow = (): void => {
    const byPk = new Map(window.map((x) => [x.pk, x]));
    for (const x of window) {
      if (x.parent === '') {
        assert_('js_expression.parentExpressionLinkHash', x.depth === 0,
          () => `line ${x.line}: depth ${x.depth} with no parent`);
        continue;
      }
      const p = byPk.get(x.parent);
      assert_('js_expression.parentExpressionLinkHash',
        p !== undefined && p.depth === x.depth - 1 && contains(p.span, x.span),
        () => `line ${x.line}: depth ${x.depth}, parent depth ${p?.depth}, parent span `
          + `${p?.span.join(':')} does not contain ${x.span.join(':')}`);
    }
    window = [];
  };
  forEachRow(directory, 'js_expression', (r, h) => {
    const module = r[col(h, 'ownerModuleLinkHash')] ?? '';
    if (module !== windowModule) { flushWindow(); windowModule = module; }
    window.push({
      pk: r[pkIndexOf(h, 'js_expression')] ?? '',
      parent: r[col(h, 'parentExpressionLinkHash')] ?? '',
      depth: Number(r[col(h, 'depth')]),
      span: [Number(r[col(h, 'startLine')]), Number(r[col(h, 'startColumn')]),
        Number(r[col(h, 'endLine')]), Number(r[col(h, 'endColumn')])],
      line: r[col(h, 'startLine')] ?? '',
    });
    const link = r[col(h, 'resolvedBindingLinkHash')] ?? '';
    if (link !== '') {
      const want = r[col(h, 'referencedName')] ?? '';
      const got = variables.get(link)?.name;
      assert_('js_expression.resolvedBindingLinkHash', got === want,
        () => `${lineOf(r, h)}: references ${want}, links a variable named ${got}`);
    }
    // c33/c34. Exactly one of c17/c33 is set on a resolved row — which relation
    // the target is in is said by which column is non-empty, per the ruling.
    // A simple parameter is named what the reference names and carries no
    // path. A destructured one has no name of its own, is not IDENTIFIER-form,
    // and carries a path of non-empty segments — the path is the KEY route
    // (`wire` for `{ wire: local }`), so it need NOT end in the referenced
    // name, and a check that said it must failed 165 renamed bindings that
    // were right. The exact key-vs-name values are asserted on the scaffold in
    // bindingPathsAreKeysNotNames; this is the structural half.
    const parameterLink = r[col(h, 'resolvedParameterLinkHash')] ?? '';
    const bindingPath = r[col(h, 'bindingPath')] ?? '';
    if (parameterLink !== '' || bindingPath !== '') {
      const want = r[col(h, 'referencedName')] ?? '';
      const parameter = parameters.get(parameterLink);
      // Segments are keys, indexes, or rest markers (`...`, `1...`); a naive
      // split on `.` would tear the marker into empty pieces.
      const segments = bindingPath === '' ? [] : (bindingPath.match(/\.\.\.|[^.]+(?:\.\.\.)?/g) ?? []);
      const ok = parameterLink !== '' && link === '' && parameter !== undefined
        && (bindingPath === ''
          ? (parameter.name === want
            && (parameter.form === 'IDENTIFIER' || parameter.form === 'ASSIGNMENT_PATTERN'))
          : (parameter.name === ''
            && (parameter.form === 'OBJECT_PATTERN' || parameter.form === 'ARRAY_PATTERN')
            // A segment is a key, an index, or a rest marker: `...` at the
            // root of an object pattern, `1...` for an array rest (#487).
            && segments.every((segment) => segment !== '' && /^(\.\.\.|[^.]+(\.\.\.)?)$/.test(segment))));
      assert_('js_expression.resolvedParameterLinkHash', ok,
        () => `${lineOf(r, h)}: references ${want}, c17 ${link === '' ? 'empty' : 'SET'}, `
          + `parameter named ${JSON.stringify(parameter?.name)} of form ${parameter?.form}, `
          + `bindingPath ${JSON.stringify(bindingPath)}`);
    }
    const site = r[col(h, 'callSiteLinkHash')] ?? '';
    if (site !== '') {
      assert_('js_expression.callSiteLinkHash',
        callSites.get(site)?.expression === (r[pkIndexOf(h, 'js_expression')] ?? ''),
        () => `${lineOf(r, h)}: the call site does not point back at this expression`);
    }
  });
  flushWindow();
  forEachRow(directory, 'js_import', (r, h) => {
    const link = r[col(h, 'boundVariableLinkHash')] ?? '';
    if (link === '') { return; }
    const want = r[col(h, 'localName')] ?? '';
    assert_('js_import.boundVariableLinkHash', variables.get(link)?.name === want,
      () => `${lineOf(r, h)}: binds ${want}, links a variable named ${variables.get(link)?.name}`);
  });
  forEachRow(directory, 'js_variable', (r, h) => {
    const link = r[col(h, 'importLinkHash')] ?? '';
    if (link !== '') {
      assert_('js_variable.importLinkHash', imports.get(link)?.local === (r[col(h, 'name')] ?? ''),
        () => `${lineOf(r, h)}: ${r[col(h, 'name')]} links an import binding ${imports.get(link)?.local}`);
    }
    const root = r[col(h, 'patternRootVariableLinkHash')] ?? '';
    if (root !== '') {
      // A root is a root: it has no pattern root of its own. Structural, where
      // the first draft used a 30-line proximity heuristic that a large
      // destructuring pattern legitimately exceeds.
      assert_('js_variable.patternRootVariableLinkHash',
        variables.has(root) && variables.get(root)?.root === '',
        () => `${lineOf(r, h)}: pattern root ${variables.has(root) ? 'has a root of its own' : 'is missing'}`);
    }
  });
  forEachRow(directory, 'js_call_site', (r, h) => {
    const link = r[col(h, 'importLinkHash')] ?? '';
    if (link !== '') {
      const receiver = r[col(h, 'receiverText')] ?? '';
      const want = receiver !== '' ? receiver.split('.')[0]! : (r[col(h, 'calleeName')] ?? '');
      assert_('js_call_site.importLinkHash', imports.get(link)?.local === want,
        () => `${lineOf(r, h)}: ${want} links an import binding ${imports.get(link)?.local}`);
    }
    const recv = r[col(h, 'receiverExpressionLinkHash')] ?? '';
    if (recv !== '') {
      assert_('js_call_site.receiverExpressionLinkHash', receiverRows.has(recv),
        () => `${lineOf(r, h)}: the linked expression is not a RECEIVER child`);
    }
    const scope = r[col(h, 'ownerScopeLinkHash')] ?? '';
    assert_('js_call_site.ownerScopeLinkHash', scopes.get(scope)?.kind !== 'GLOBAL',
      () => `${lineOf(r, h)}: a call in the GLOBAL scope`);
  });
  forEachRow(directory, 'js_type_heritage', (r, h) => {
    const link = r[col(h, 'importLinkHash')] ?? '';
    if (link === '') { return; }
    // The import binds the ROOT of the superclass expression: `Base` for
    // `extends Base`, `ns` for `extends ns.Base` (#479) — the root is the
    // first segment of the expression text, parentheses stripped.
    // Leading parentheses and whitespace — including the writer's escaped
    // `\n`/`\t` for a clause broken over lines — are not part of the root.
    const want = (r[col(h, 'superTypeExpressionText')] ?? '')
      .replace(/^(\\[nt]|[\s(])+/, '').split(/\\[nt]|[.[(\s)]/)[0]!;
    assert_('js_type_heritage.importLinkHash', imports.get(link)?.local === want,
      () => `${lineOf(r, h)}: extends ${want}, links an import binding ${imports.get(link)?.local}`);
  });
  forEachRow(directory, 'js_type_reference', (r, h) => {
    const link = r[col(h, 'importLinkHash')] ?? '';
    if (link !== '') {
      const target = imports.get(link);
      if (r[col(h, 'referenceKind')] === 'IMPORT_TYPE') {
        // §3.8.1: an import type links its OWN comment-borne row, whose
        // importedName is the qualifier and which binds nothing locally.
        assert_('js_type_reference.importLinkHash',
          target?.bearer === 'COMMENT' && target.form === 'JSDOC_IMPORT_TYPE'
            && target.local === '' && target.imported === (r[col(h, 'typeName')] ?? ''),
          () => `${lineOf(r, h)}: IMPORT_TYPE ${r[col(h, 'typeName')]} links a ${target?.bearer} `
            + `${target?.form} row importing ${JSON.stringify(target?.imported)}`);
      } else {
        const want = (r[col(h, 'typeName')] ?? '').split('.')[0]!;
        assert_('js_type_reference.importLinkHash', target?.local === want,
          () => `${lineOf(r, h)}: ${want} links an import binding ${target?.local}`);
      }
    }
    const parent = r[col(h, 'parentReferenceLinkHash')] ?? '';
    const depth = Number(r[col(h, 'depth')]);
    const pr = refs.get(parent);
    const rs: [number, number] = [Number(r[col(h, 'startLine')]), Number(r[col(h, 'startColumn')])];
    const parentFirst = pr !== undefined
      && (pr.start[0] < rs[0] || (pr.start[0] === rs[0] && pr.start[1] <= rs[1]));
    assert_('js_type_reference.parentReferenceLinkHash',
      parent === '' ? depth === 0 : (pr?.depth === depth - 1 && parentFirst),
      () => `${lineOf(r, h)}: depth ${depth}, parent depth ${pr?.depth}, parent starts `
        + `${pr?.start.join(':')}`);
    const comment = r[col(h, 'commentLinkHash')] ?? '';
    if (comment !== '') {
      assert_('js_type_reference.commentLinkHash',
        (comments.get(comment)?.end ?? 0) >= Number(r[col(h, 'startLine')]),
        () => `${lineOf(r, h)}: its comment ends at line ${comments.get(comment)?.end}`);
    }
  });
  forEachRow(directory, 'js_export', (r, h) => {
    const link = r[col(h, 'targetLinkHash')] ?? '';
    if (link === '') { return; }
    const kind = r[col(h, 'targetKind')] ?? '';
    const local = r[col(h, 'localName')] ?? '';
    const got = kind === 'TYPE' ? types.get(link)?.name
      : kind === 'METHOD' ? methods.get(link)?.name
        : kind === 'VARIABLE' ? variables.get(link)?.name : undefined;
    // An ANONYMOUS default declaration has no local name to agree with: its
    // target is the anonymous row itself (engine #484), whose name is the
    // placeholder for its kind.
    const anonymousDefault = local === 'default'
      && (got === 'default' || (got?.startsWith('<') ?? false));
    assert_('js_export.targetLinkHash', got === local || anonymousDefault,
      () => `${lineOf(r, h)}: exports local ${local} as ${kind}, target is named ${got}`);
  });

  // ---- KIND agreement
  forEachRow(directory, 'js_module', (r, h) => {
    // A DECLINED module emitted its one row and nothing else, so it has no
    // init method and no scope to link — an empty link is the correct value
    // there and a populated one would be the defect. Everywhere else both are
    // mandatory, which is why the assertion is not simply "skip if empty".
    const declined = r[col(h, 'sourceProvenance')] === 'FLOW_REJECTED';
    const init = r[col(h, 'moduleInitMethodLinkHash')] ?? '';
    assert_('js_module.moduleInitMethodLinkHash',
      declined ? init === '' : methods.get(init)?.kind === 'MODULE_INITIALIZER',
      () => `module ${r[col(h, 'filePath')]}: init method is ${methods.get(init)?.kind}`);
    const scope = r[col(h, 'moduleScopeLinkHash')] ?? '';
    assert_('js_module.moduleScopeLinkHash',
      declined ? scope === '' : scopes.get(scope)?.kind === 'MODULE',
      () => `module ${r[col(h, 'filePath')]}: module scope is ${scopes.get(scope)?.kind}`);
    const dflt = r[col(h, 'defaultExportLinkHash')] ?? '';
    if (dflt !== '') {
      const e = exports_.get(dflt);
      assert_('js_module.defaultExportLinkHash',
        e?.form === 'EXPORT_DEFAULT' || e?.form === 'MODULE_EXPORTS_ASSIGNMENT' || e?.name === 'default',
        () => `module ${r[col(h, 'filePath')]}: default export is ${e?.form} ${e?.name}`);
    }
  });
  forEachRow(directory, 'js_type', (r, h) => {
    const ctor = r[col(h, 'constructorMethodLinkHash')] ?? '';
    if (ctor !== '') {
      const k = methods.get(ctor)?.kind ?? '';
      assert_('js_type.constructorMethodLinkHash',
        ['CONSTRUCTOR', 'FUNCTION_DECLARATION', 'FUNCTION_EXPRESSION'].includes(k),
        () => `${lineOf(r, h)}: ${r[col(h, 'name')]}'s constructor is a ${k}`);
    }
    const comment = r[col(h, 'jsdocCommentLinkHash')] ?? '';
    if (comment !== '') {
      // A `@typedef` type IS its comment: the row is positioned at the tag,
      // inside the block, so the block ends after the type starts. The position
      // rule holds for a type the comment DOCUMENTS, not one it declares.
      const declaredInComment = types.get(r[pkIndexOf(h, 'js_type')] ?? '')?.commentOnly === true;
      assert_('js_type.jsdocCommentLinkHash',
        declaredInComment || (comments.get(comment)?.end ?? 99e9) <= Number(r[col(h, 'startLine')]),
        () => `${lineOf(r, h)}: its JSDoc ends at line ${comments.get(comment)?.end}`);
    }
  });
  forEachRow(directory, 'js_field', (r, h) => {
    const g = r[col(h, 'getterMethodLinkHash')] ?? '';
    if (g !== '') {
      assert_('js_field.getterMethodLinkHash', methods.get(g)?.kind === 'GETTER',
        () => `${lineOf(r, h)}: getter link is a ${methods.get(g)?.kind}`);
    }
    const st = r[col(h, 'setterMethodLinkHash')] ?? '';
    if (st !== '') {
      assert_('js_field.setterMethodLinkHash', methods.get(st)?.kind === 'SETTER',
        () => `${lineOf(r, h)}: setter link is a ${methods.get(st)?.kind}`);
    }
  });
  forEachRow(directory, 'js_method', (r, h) => {
    const comment = r[col(h, 'jsdocCommentLinkHash')] ?? '';
    if (comment !== '') {
      assert_('js_method.jsdocCommentLinkHash',
        (comments.get(comment)?.end ?? 99e9) <= Number(r[col(h, 'startLine')]),
        () => `${lineOf(r, h)}: its JSDoc ends at line ${comments.get(comment)?.end}`);
    }
  });
  forEachRow(directory, 'js_method_parameter', (r, h) => {
    const owner = r[col(h, 'ownerMethodLinkHash')] ?? '';
    const scope = r[col(h, 'scopeLinkHash')] ?? '';
    assert_('js_method_parameter.scopeLinkHash', methods.get(owner)?.bodyScope === scope,
      () => `${lineOf(r, h)}: ${r[col(h, 'name')]}'s scope is not its method's body scope`);
    const comment = r[col(h, 'jsdocCommentLinkHash')] ?? '';
    if (comment !== '') {
      assert_('js_method_parameter.jsdocCommentLinkHash',
        (comments.get(comment)?.end ?? 99e9) <= Number(r[col(h, 'startLine')]),
        () => `${lineOf(r, h)}: its JSDoc ends at line ${comments.get(comment)?.end}`);
    }
  });
  forEachRow(directory, 'js_parse_gap', (r, h) => {
    const rel = r[col(h, 'relatedRelation')] ?? '';
    const link = r[col(h, 'relatedLinkHash')] ?? '';
    const prefix = link.replace(/_[0-9a-f]{32}$/, '').toLowerCase();
    assert_('js_parse_gap.relatedLinkHash', prefix === rel,
      () => `${lineOf(r, h)}: relatedRelation ${rel}, link prefix ${prefix}`);
  });
  forEachRow(directory, 'js_comment', (r, h) => {
    const link = r[col(h, 'attachedToLinkHash')] ?? '';
    if (link === '') { return; }
    const kind = r[col(h, 'attachedToKind')] ?? '';
    const ownerLine = kind === 'METHOD' ? methods.get(link)?.line
      : kind === 'TYPE' ? types.get(link)?.line
        : kind === 'FIELD' ? fields.get(link)?.line
          : kind === 'VARIABLE' ? variables.get(link)?.line : undefined;
    assert_('js_comment.attachedToLinkHash',
      ownerLine !== undefined && ownerLine >= Number(r[col(h, 'endLine')]),
      () => `${lineOf(r, h)}: attached ${kind} starts at line ${ownerLine}, comment ends `
        + `at ${r[col(h, 'endLine')]}`);
  });

  // ---- STRUCTURE
  forEachRow(directory, 'js_scope', (r, h) => {
    const parent = r[col(h, 'parentScopeLinkHash')] ?? '';
    const depth = Number(r[col(h, 'depth')]);
    const p = scopes.get(parent);
    const mine: [number, number] = [Number(r[col(h, 'startLine')]), Number(r[col(h, 'startColumn')])];
    // A scope row carries a start only, so containment is one-sided: the
    // parent begins at or before the child. GLOBAL and MODULE both start at
    // 1:1, which is why `<=` and not `<`.
    const startsFirst = p !== undefined
      && (p.start[0] < mine[0] || (p.start[0] === mine[0] && p.start[1] <= mine[1]));
    assert_('js_scope.parentScopeLinkHash',
      parent === '' ? depth === 0 : (p?.depth === depth - 1 && startsFirst),
      () => `${lineOf(r, h)}: depth ${depth}, parent depth ${p?.depth}, parent starts `
        + `${p?.start.join(':')}`);
  });
  forEachRow(directory, 'js_block', (r, h) => {
    const parent = r[col(h, 'parentBlockLinkHash')] ?? '';
    const depth = Number(r[col(h, 'depth')]);
    const mine: [number, number, number, number] = [Number(r[col(h, 'startLine')]),
      Number(r[col(h, 'startColumn')]), Number(r[col(h, 'endLine')]), Number(r[col(h, 'endColumn')])];
    const p = blocks.get(parent);
    assert_('js_block.parentBlockLinkHash',
      parent === '' ? depth === 0 : (p !== undefined && p.depth === depth - 1 && contains(p.span, mine)),
      () => `${lineOf(r, h)}: depth ${depth}, parent depth ${p?.depth}, parent span `
        + `${p?.span.join(':')} does not contain ${mine.join(':')}`);
  });

  // ---- report, and fail on any violation
  const MEANING_ELSEWHERE: Record<string, string> = {
    'js_method.bodyScopeLinkHash': 'scope links point where they claim',
    'js_type.ownerScopeLinkHash': 'scope links point where they claim',
    'js_block.scopeLinkHash': 'scope links point where they claim',
    'js_method.ownerTypeLinkHash': 'owned rows sit inside their owner',
    'js_field.ownerTypeLinkHash': 'owned rows sit inside their owner + member accounting',
    'js_type_heritage.ownerTypeLinkHash': 'reused names resolve by position',
    'js_method.enclosingMethodLinkHash': 'owned rows sit inside their owner',
    'js_type.enclosingMethodLinkHash': 'owned rows sit inside their owner',
    'js_call_site.enclosingMethodLinkHash': 'owned rows sit inside their owner',
    'js_block.ownerMethodLinkHash': 'owned rows sit inside their owner',
    'js_variable.ownerMethodLinkHash': 'owned rows sit inside their owner',
    'js_scope.ownerMethodLinkHash': 'owned rows sit inside their owner',
    'js_import.ownerMethodLinkHash': 'owned rows sit inside their owner',
    'js_export.ownerMethodLinkHash': 'owned rows sit inside their owner',
    'js_expression.ownerMethodLinkHash': 'owned rows sit inside their owner',
    'js_method_parameter.ownerMethodLinkHash': 'declared types agree (scopeLinkHash here)',
    'js_expression.introducesDeclarationLinkHash': 'callables name what they introduce',
    'js_expression.moduleEdgeLinkHash': 'module-edge 1:1',
    'js_call_site.expressionLinkHash': 'call-site 1:1',
    'js_export.reExportImportLinkHash': 'separator comments and namespace re-exports',
    'js_field.typeReferenceLinkHash': 'declared types agree with their references',
    'js_variable.typeReferenceLinkHash': 'declared types agree with their references',
    'js_method_parameter.typeReferenceLinkHash': 'declared types agree with their references',
    'js_method.returnTypeReferenceLinkHash': 'declared types agree with their references',
    'js_type_reference.ownerLinkHash': 'declared types agree + separator/EXPRESSION check',
    'js_variable.declarationScopeLinkHash': 'the hoisting model holds',
    'js_variable.syntacticScopeLinkHash': 'the hoisting model holds',
    'js_package_entry.targetModuleLinkHash': 'package entries name what a package exposes',
    'js_method.computedNameExpressionLinkHash': 'computed member names link their key',
    'js_field.computedNameExpressionLinkHash': 'computed member names link their key',
    'js_expression.bindingDefaultLinkHash': 'a pattern binding with a default links it from every reference',
  };
  const INTEGRITY_ONLY: Record<string, string> = {
    'js_*.ownerModuleLinkHash': 'same-module links only asserts membership; no finer meaning exists',
    'js_export.ownerScopeLinkHash': 'the scope an export sits in — no cheap kind or position test',
    'js_import.ownerScopeLinkHash': 'as above',
    'js_expression.ownerScopeLinkHash': 'as above',
    'js_method.ownerScopeLinkHash': 'as above; distinctness from bodyScope is asserted elsewhere',
    'js_expression.declarationLinkHash': 'declarationForm round-trip lives in the fixture suite (7.3.7)',
    'js_export.sourceExpressionLinkHash': 'an assignment/call expression at the row — no position rule fits all forms',
    'js_field.sourceExpressionLinkHash': 'as above',
    'js_method.sourceExpressionLinkHash': 'as above',
    'js_import.sourceExpressionLinkHash': 'as above',
    'js_type.sourceExpressionLinkHash': 'as above',
    'js_type_heritage.sourceExpressionLinkHash': 'as above',
    'js_field.initializerExpressionLinkHash': 'no position rule: the initializer may precede a hoisted name',
    'js_variable.initializerExpressionLinkHash': 'as above',
    'js_block.conditionExpressionLinkHash': 'the condition sits inside the block header — not asserted',
    'js_call_site.resolvedMethodLinkHash': 'tier 3, empty by rule',
    'js_import.resolvedModuleLinkHash': 'tier 3, empty by rule',
    'js_type_heritage.resolvedTypeLinkHash': 'tier 3, empty by rule',
    'js_type_reference.resolvedTypeLinkHash': 'tier 3, empty by rule',
  };
  // THE PARTITION MUST SUM, over COLUMNS and not over entries. The first
  // version reported 27 + 27 + 19 = 73 against 84 populated columns, because
  // `js_*.ownerModuleLinkHash` was ONE entry standing for sixteen columns. A
  // partition that does not sum is the residual-bucket error — a claim about
  // coverage with eleven columns in no category — and it is asserted here so
  // that a column added to a registry without a meaning check fails by name.
  const TIER3 = new Set(['js_call_site.resolvedMethodLinkHash', 'js_import.resolvedModuleLinkHash',
    'js_type_heritage.resolvedTypeLinkHash', 'js_type_reference.resolvedTypeLinkHash']);
  const everyColumn: string[] = [];
  for (const { name } of relationFilesIn(directory)) {
    for (const column of headerOf(directory, name)) {
      if (column.endsWith('LinkHash') && column !== 'serviceVersionLinkHash') {
        everyColumn.push(`${name}.${column}`);
      }
    }
  }
  const integrityOnly = new Set<string>();
  for (const key of Object.keys(INTEGRITY_ONLY)) {
    if (key.startsWith('js_*.')) {
      const column = key.slice('js_*.'.length);
      for (const full of everyColumn) { if (full.endsWith(`.${column}`)) { integrityOnly.add(full); } }
    } else {
      integrityOnly.add(key);
    }
  }
  // The columns THIS function asserts, stated rather than derived from which
  // rows happened to exist: a column whose assertion no scaffold row reached
  // is still asserted, and is reported below as vacuous on this input so the
  // corpus run is where it has to be seen to fire.
  const ASSERTED_HERE: readonly string[] = [
    'js_expression.resolvedBindingLinkHash', 'js_expression.resolvedParameterLinkHash',
    'js_expression.parentExpressionLinkHash',
    'js_expression.callSiteLinkHash', 'js_import.boundVariableLinkHash',
    'js_variable.importLinkHash', 'js_variable.patternRootVariableLinkHash',
    'js_call_site.importLinkHash', 'js_call_site.receiverExpressionLinkHash',
    'js_call_site.ownerScopeLinkHash', 'js_type_heritage.importLinkHash',
    'js_type_reference.importLinkHash', 'js_type_reference.parentReferenceLinkHash',
    'js_type_reference.commentLinkHash', 'js_export.targetLinkHash',
    'js_module.moduleInitMethodLinkHash', 'js_module.moduleScopeLinkHash',
    'js_module.defaultExportLinkHash', 'js_type.constructorMethodLinkHash',
    'js_type.jsdocCommentLinkHash', 'js_field.getterMethodLinkHash',
    'js_field.setterMethodLinkHash', 'js_method.jsdocCommentLinkHash',
    'js_method_parameter.scopeLinkHash', 'js_method_parameter.jsdocCommentLinkHash',
    'js_parse_gap.relatedLinkHash', 'js_comment.attachedToLinkHash',
    'js_scope.parentScopeLinkHash', 'js_block.parentBlockLinkHash',
  ];
  const assertedHere = new Set(ASSERTED_HERE);
  for (const claimed of ASSERTED_HERE) {
    if (!everyColumn.includes(claimed)) {
      failures += fail(`${claimed} is claimed as asserted here but no relation carries it`);
    }
  }
  const vacuous = ASSERTED_HERE.filter((c) => !verdicts.has(c));
  const uncategorised = everyColumn.filter((c) => !TIER3.has(c) && !assertedHere.has(c)
    && !(c in MEANING_ELSEWHERE) && !integrityOnly.has(c));
  const populated = everyColumn.filter((c) => !TIER3.has(c));
  if (uncategorised.length > 0) {
    failures += fail(`${uncategorised.length} populated FK column(s) have no meaning assertion `
      + `and are not named as integrity-only: ${uncategorised.join(', ')}. The partition must `
      + `sum to ${populated.length}`);
  }

  for (const [column, v] of [...verdicts.entries()].sort()) {
    if (v.wrong > 0) {
      failures += fail(`${column}: ${v.wrong} of ${v.checked} link(s) do not mean what the `
        + `column claims — e.g. ${v.example}`);
    }
  }
  const here = populated.filter((c) => assertedHere.has(c)).length;
  const elsewhere = populated.filter((c) => !assertedHere.has(c) && c in MEANING_ELSEWHERE).length;
  const integrity = populated.filter((c) => !assertedHere.has(c) && !(c in MEANING_ELSEWHERE)
    && integrityOnly.has(c)).length;
  console.log(`  ${populated.length} populated FK columns = ${here} asserted here `
    + `+ ${elsewhere} asserted by another check + ${integrity} integrity-only `
    + `+ ${uncategorised.length} uncategorised (${everyColumn.length - populated.length} tier-3 excluded)`);
  if (vacuous.length > 0) {
    console.log(`  ${vacuous.length} assertion(s) reached no row on this input — vacuous here, `
      + `real on the corpus: ${vacuous.join(', ')}`);
  }
  for (const [column, why] of Object.entries(INTEGRITY_ONLY)) {
    console.log(`      ${column.padEnd(44)} ${why}`);
  }
  return failures;
}

/**
 * `js_variable.endLine` is the declarator's extent, and varies.
 *
 * It equalled `startLine` on all 140,302 corpus rows, by construction: the
 * binder keys a binding on its name Identifier, which is one line. A column
 * that never varies is one no check can be depending on and one no check was
 * watching. Redefined as the declarator's end — `const x = {` … `}` ends where
 * the literal does — because column order is frozen and removal would shift
 * four columns and the PK. This asserts the two things the redefinition means:
 * the column varies on a scaffold that has a spanning declarator, and no row
 * ends before it starts.
 */
function variableEndLineSpansTheDeclarator(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const variables = relations.find((r) => r.name === 'js_variable')!;
  const start = variables.header.indexOf('startLine');
  const end = variables.header.indexOf('endLine');
  const name = variables.header.indexOf('name');
  let spanning = 0;
  for (const row of variables.rows) {
    const s = Number(row[start]); const e = Number(row[end]);
    if (e < s) {
      failures += fail(`js_variable ${row[name]}: endLine ${e} precedes startLine ${s}`);
    }
    if (e > s) { spanning += 1; }
  }
  if (spanning === 0) {
    failures += fail('no js_variable spans more than one line. The scaffold declares multi-line '
      + 'object literals; endLine equal to startLine on every row is the constant-by-'
      + 'construction defect the redefinition exists to end');
  }
  console.log(`  ${spanning} of ${variables.rows.length} variables span more than one line`);
  return failures;
}

// ---------------------------------------------------------------------------

/**
 * A binding path is the KEY route to a bound name, never the local name.
 *
 * `{ wire: local }` reads `local` and the path says `wire`, because renaming is
 * how a wire format is adapted to a codebase's naming and a path that recorded
 * the identifier would say nothing the reference row does not already say. The
 * structural half — c17 xor c33, a pattern-form parameter, non-empty segments —
 * is in the FK meaning gate; this is the exact-value half, on every shape.
 */
function bindingPathsAreKeysNotNames(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const module = modules.rows.find((r) => (r[mPath] ?? '').endsWith('binding-paths.js'))?.[mPk];
  const expressions = relations.find((r) => r.name === 'js_expression')!;
  const xOwner = expressions.header.indexOf('ownerModuleLinkHash');
  const xName = expressions.header.indexOf('referencedName');
  const xLine = expressions.header.indexOf('startLine');
  const xPath = expressions.header.indexOf('bindingPath');
  const xParameter = expressions.header.indexOf('resolvedParameterLinkHash');
  const xBinding = expressions.header.indexOf('resolvedBindingLinkHash');
  const parameters = relations.find((r) => r.name === 'js_method_parameter')!;
  const pPk = pkIndexOf(parameters.header, 'js_method_parameter');
  const pPosition = parameters.header.indexOf('position');
  const positionOf = new Map(parameters.rows.map((r) => [r[pPk] ?? '', Number(r[pPosition])]));
  const mine = expressions.rows.filter((r) => r[xOwner] === module && (r[xName] ?? '') !== '');
  const expected: ReadonlyArray<readonly [number, string, string, number]> = [
    // line, referenced name, path, parameter position
    [1, 'alpha', 'alpha', 0], [1, 'beta', 'beta', 0],
    [2, 'local', 'wire', 0], [2, 'kebab', 'kebab-key', 0], [2, 'numeric', '0', 0],
    [3, 'inner', 'outer.inner', 0],
    [4, 'id', 'req.body.userId', 0],
    [5, 'first', '0', 0], [5, 'third', '2', 0],
    [6, 'name', '0.name', 0],
    [7, 'plain', '', 0], [7, 'withDefault', '', 1],
    [8, 'keep', 'keep', 0], [8, 'others', '...', 0], [8, 'head', '0', 1], [8, 'tail', '1...', 1],
  ];
  for (const [line, name, wantPath, position] of expected) {
    const row = mine.find((r) => Number(r[xLine]) === line && r[xName] === name
      && (r[xParameter] ?? '') !== '');
    if (row === undefined) {
      failures += fail(`\`${name}\` (line ${line}) has no reference row resolving to a parameter`);
      continue;
    }
    const gotPath = row[xPath] ?? '';
    const gotPosition = positionOf.get(row[xParameter] ?? '');
    if (gotPath !== wantPath || gotPosition !== position || (row[xBinding] ?? '') !== '') {
      failures += fail(`\`${name}\` (line ${line}): bindingPath ${JSON.stringify(gotPath)} on `
        + `parameter ${gotPosition}, c17 ${row[xBinding] === '' ? 'empty' : 'SET'} — expected `
        + `${JSON.stringify(wantPath)} on parameter ${position}. The path is the KEY route, `
        + 'not the local name, and rides on c33 alone');
    }
  }
  if (mine.filter((r) => (r[xParameter] ?? '') !== '').length !== expected.length) {
    failures += fail(`${mine.filter((r) => (r[xParameter] ?? '') !== '').length} references resolve `
      + `to a parameter in the file, expected ${expected.length} — one per bound name read`);
  }
  // js_variable.bindingPath / isRestBinding (#487), by value.
  const vars = relations.find((r) => r.name === 'js_variable')!;
  const vOwner = vars.header.indexOf('ownerModuleLinkHash');
  const vName = vars.header.indexOf('name');
  const vPath = vars.header.indexOf('bindingPath');
  const vRest = vars.header.indexOf('isRestBinding');
  for (const [name, path, rest] of [
    ['deep', 'inner.deep', 'false'], ['alias', 'cb', 'false'], ['objRest', '...', 'true'],
    ['first', '0', 'false'], ['arrRest', '1...', 'true'], ['o', '', 'false'],
  ] as const) {
    const row = vars.rows.find((r) => r[vOwner] === module && r[vName] === name);
    if (row?.[vPath] !== path || row[vRest] !== rest) {
      failures += fail(`js_variable \`${name}\`: bindingPath ${JSON.stringify(row?.[vPath])} isRestBinding ${row?.[vRest]}; `
        + `expected ${JSON.stringify(path)} / ${rest} — the key route from the pattern root, with \`...\` where the rest starts (#487)`);
    }
  }
  console.log(`  ${expected.length} bound names, each read once, paths asserted by value; variable paths asserted`);
  return failures;
}

/**
 * The `@import` JSDoc tag mints one js_import row per bound name (#621).
 *
 * `emitJsDocImportType` accepts an `ImportTypeNode`, the `import("./x").Y` TYPE
 * node; the `@import` tag is a `JSDocImportTag` with an import clause, and no
 * walk reached it. A file on the new spelling minted no row, every `@param`
 * through it resolved to nothing, and the engine declared the call unknown at a
 * site where the type was written down. On the densest JSDoc project measured
 * the tag outnumbers the typedef form 7:1.
 *
 * Asserted by value: the four rows (default, named, renamed, namespace) with the
 * real binding form, `COMMENT` bearer, `JSDOC_IMPORT_TYPE`, `isTypeOnly`, a
 * resolved specifier; the `@param` references linking each row by local name;
 * the typedef control still on its own `NO_LOCAL_BINDING` row; and no binder
 * declaration for a name that exists only in a comment.
 */
function jsdocImportTagsMintBindings(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const module = modules.rows.find((r) => (r[mPath] ?? '').endsWith('jsdoc-import-tag.js'))?.[mPk];
  const imports = relations.find((r) => r.name === 'js_import')!;
  const col = (r: { header: readonly string[] }, c: string): number => r.header.indexOf(c);
  const iPk = pkIndexOf(imports.header, 'js_import');
  const mine = imports.rows.filter((r) => r[col(imports, 'ownerModuleLinkHash')] === module);
  const expected: ReadonlyArray<readonly [string, string, string, number]> = [
    // bindingForm, importedName, localName, line
    ['DEFAULT', 'default', 'Template', 1],
    ['NAMED', 'Router', 'Router', 2],
    ['NAMED', 'Route', 'Alias', 2],
    ['NAMESPACE', '', 'NS', 3],
    ['NO_LOCAL_BINDING', 'Router', '', 4],
  ];
  const rowByLocal = new Map<string, readonly string[]>();
  for (const [form, imported, local, line] of expected) {
    const row = mine.find((r) => r[col(imports, 'bindingForm')] === form
      && r[col(imports, 'importedName')] === imported && r[col(imports, 'localName')] === local);
    if (row === undefined) {
      failures += fail(`no js_import row ${form} ${JSON.stringify(imported)} as ${JSON.stringify(local)} `
        + `(line ${line}): the @import tag on that line minted nothing (#621)`);
      continue;
    }
    rowByLocal.set(local, row);
    const got = {
      bearer: row[col(imports, 'edgeBearer')], form: row[col(imports, 'importForm')],
      typeOnly: row[col(imports, 'isTypeOnly')], outcome: row[col(imports, 'resolutionOutcome')],
      specifier: row[col(imports, 'specifier')], line: Number(row[col(imports, 'startLine')]),
    };
    if (got.bearer !== 'COMMENT' || got.form !== 'JSDOC_IMPORT_TYPE' || got.typeOnly !== 'true'
      || got.outcome !== 'RESOLVED_PROJECT' || got.specifier !== './router' || got.line !== line) {
      failures += fail(`js_import ${form} ${local || imported}: ${JSON.stringify(got)}; expected a COMMENT-borne `
        + `JSDOC_IMPORT_TYPE row, type-only, resolving ./router in the project, on line ${line}`);
    }
  }
  if (mine.length !== expected.length) {
    failures += fail(`${mine.length} js_import rows in the file, expected ${expected.length}: `
      + 'one per bound name of each @import tag plus the typedef control');
  }
  // The `@param` references link the tag's rows by local name; the typedef
  // control links nothing (its alias resolves through the typedef, not an import).
  const refs = relations.find((r) => r.name === 'js_type_reference')!;
  const paramRefs = refs.rows.filter((r) => r[col(refs, 'ownerModuleLinkHash')] === module
    && r[col(refs, 'contextKind')] === 'PARAM' && r[col(refs, 'referenceKind')] === 'NAMED');
  for (const [name, wantLocal] of [
    ['Template', 'Template'], ['Router', 'Router'], ['Alias', 'Alias'], ['RouterAlias', ''],
  ] as const) {
    const ref = paramRefs.find((r) => r[col(refs, 'typeName')] === name);
    const link = ref?.[col(refs, 'importLinkHash')] ?? '';
    const want = wantLocal === '' ? '' : (rowByLocal.get(wantLocal)?.[iPk] ?? '?');
    if (ref === undefined || link !== want) {
      failures += fail(`@param {${name}}: importLinkHash ${JSON.stringify(link)}, expected `
        + (want === '' ? 'no link (a typedef alias)' : `the @import row binding ${wantLocal}`));
    }
  }
  // A comment-only name is not a runtime binding: nothing in js_variable
  // carries it, so a runtime reference to `Router` could never resolve to it.
  const vars = relations.find((r) => r.name === 'js_variable')!;
  const leaked = vars.rows.filter((r) => r[col(vars, 'ownerModuleLinkHash')] === module
    && ['Template', 'Router', 'Alias', 'NS'].includes(r[col(vars, 'name')] ?? ''));
  if (leaked.length > 0) {
    failures += fail(`${leaked.length} js_variable row(s) for @import names: a type-only binding leaked into the runtime scope`);
  }
  console.log(`  ${expected.length} import rows asserted by value, 4 @param links, no runtime binding`);
  return failures;
}

/**
 * A package's IR says which module its `main` / `exports` entry is (#616).
 *
 * `js_module.packageName` says which package a module belongs to; nothing said
 * which module the package HANDS OUT for `require('pkg')`, so library IR staged
 * on its own could not answer what a specifier loads. Asserted by value over
 * three scaffold packages: every `exports` shape, `main` with Node's directory
 * fallback, `module`, nested conditions, the `index.js` default, and each
 * outcome as a NAMED absence rather than a guess: a pattern, a `null` block, a
 * `.json` target, a missing file, and a file on disk the walk did not stage.
 */
function packageEntriesNameWhatAPackageExposes(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const entries = relations.find((r) => r.name === 'js_package_entry');
  if (entries === undefined) {
    return fail('js_package_entry is not in the output');
  }
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const pathOfModule = new Map(modules.rows.map((r) => [r[mPk] ?? '', r[mPath] ?? '']));
  const col = (c: string): number => entries.header.indexOf(c);
  const expected: ReadonlyArray<readonly [string, string, string, string, string, string, string]> = [
    // packageName, subpath, condition, entrySource, targetPath, outcome, resolved module file
    ['pub', '.', '', 'EXPORTS', 'lib/index.js', 'RESOLVED', 'packages/pub/lib/index.js'],
    ['pub', '.', '', 'MAIN', 'lib/index.js', 'RESOLVED', 'packages/pub/lib/index.js'],
    ['pub', './sub', '', 'EXPORTS', 'lib/sub.js', 'RESOLVED', 'packages/pub/lib/sub.js'],
    ['pub', './features/*', '', 'EXPORTS', 'lib/features/*.js', 'PATTERN', ''],
    ['pub', './internal/*', '', 'EXPORTS', '', 'BLOCKED', ''],
    ['pub', './data', '', 'EXPORTS', 'data.json', 'NOT_JAVASCRIPT', ''],
    ['pub', './ghost', '', 'EXPORTS', 'lib/ghost.js', 'MISSING_FILE', ''],
    ['pub', './either', '', 'EXPORTS', 'lib/missing.js', 'MISSING_FILE', ''],
    ['pub', './either', '', 'EXPORTS', 'lib/sub.js', 'RESOLVED', 'packages/pub/lib/sub.js'],
    ['@scope/pkg', '.', 'node.import', 'EXPORTS', 'cjs/index.mjs', 'RESOLVED', 'packages/scoped/cjs/index.mjs'],
    ['@scope/pkg', '.', 'node.require', 'EXPORTS', 'cjs/index.js', 'RESOLVED', 'packages/scoped/cjs/index.js'],
    ['@scope/pkg', '.', 'default', 'EXPORTS', 'cjs/index.js', 'RESOLVED', 'packages/scoped/cjs/index.js'],
    ['@scope/pkg', '.', '', 'MAIN', 'cjs', 'RESOLVED', 'packages/scoped/cjs/index.js'],
    ['@scope/pkg', '.', '', 'MODULE', 'cjs/index.mjs', 'RESOLVED', 'packages/scoped/cjs/index.mjs'],
    ['built', '.', '', 'MAIN', 'dist/main.js', 'NOT_STAGED', ''],
    ['scaffold-root', '.', '', 'DEFAULT_INDEX', 'index.js', 'MISSING_FILE', ''],
  ];
  for (const [pkg, subpath, condition, source, target, outcome, file] of expected) {
    const row = entries.rows.find((r) => r[col('packageName')] === pkg && r[col('subpath')] === subpath
      && r[col('condition')] === condition && r[col('entrySource')] === source && r[col('targetPath')] === target);
    if (row === undefined) {
      failures += fail(`no js_package_entry row ${pkg} ${subpath} [${condition}] ${source} -> ${JSON.stringify(target)}`);
      continue;
    }
    const gotOutcome = row[col('targetOutcome')];
    const gotFile = pathOfModule.get(row[col('targetModuleLinkHash')] ?? '') ?? '';
    if (gotOutcome !== outcome || gotFile !== file) {
      failures += fail(`js_package_entry ${pkg} ${subpath} [${condition}] ${source}: ${gotOutcome} -> ${JSON.stringify(gotFile)}; `
        + `expected ${outcome} -> ${JSON.stringify(file)}`);
    }
    if ((row[col('targetModuleLinkHash')] ?? '') !== '' && gotOutcome !== 'RESOLVED') {
      failures += fail(`js_package_entry ${pkg} ${subpath}: a module hash on a ${gotOutcome} row; only RESOLVED carries one`);
    }
  }
  const named = entries.rows.filter((r) => ['pub', '@scope/pkg', 'built', 'scaffold-root'].includes(r[col('packageName')] ?? ''));
  if (named.length !== expected.length) {
    failures += fail(`${named.length} entry rows for the four packages, expected ${expected.length}: `
      + 'one per (subpath, condition, source, target), no more');
  }
  console.log(`  ${expected.length} entries asserted by value across four packages, six outcomes`);
  return failures;
}

/**
 * A ROOT SPELLED THROUGH A SYMLINK IS THE SAME TREE (#795).
 *
 * Every npm, yarn and pnpm workspace links its packages into `node_modules`
 * (`node_modules/@ws/util -> ../../packages/util`), and TypeScript's resolver answers
 * with the package's REAL path. `projectModuleHashes` was keyed by the files walked from
 * the root AS GIVEN, so with a root reached through a symlink — macOS `/tmp` and `/var`,
 * a symlinked checkout, a container bind mount — one side of the comparison was canonical
 * and the other was not: every cross-package import came out RESOLVED_EXTERNAL and the
 * engine then declared the calls unknown ("dependency not staged", for code in the tree).
 * On one workspace monorepo that was 720 MISSED of 5,219 decided sites against 1.
 *
 * Asserted on both spellings of ONE directory: the outcomes are RESOLVED_PROJECT either
 * way, and the whole relation set is byte-identical, which is the property that the
 * spelling of the root cannot change the IR. The relative import is the control that was
 * never broken, and the check refuses to pass if the fixture's link is missing.
 */
async function aSymlinkedRootIsTheSameTree(): Promise<number> {
  let failures = 0;
  const outer = scratchDir('js-gate-symlink-root-');
  const real = path.join(outer, 'real');
  const write = (relative: string, contents: string): void => {
    const full = path.join(real, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('ws/package.json', JSON.stringify({ name: 'ws', private: true, workspaces: ['packages/*'] }) + '\n');
  write('ws/packages/util/package.json', JSON.stringify({ name: '@ws/util', type: 'module', main: 'index.js' }) + '\n');
  write('ws/packages/util/index.js', 'export function helper(x) { return x + 1; }\n');
  write('ws/packages/util/lib/deep.js', 'export function deepFn(x) { return x * 2; }\n');
  write('ws/packages/app/package.json', JSON.stringify({ name: '@ws/app', type: 'module', main: 'src/main.js' }) + '\n');
  write('ws/packages/app/src/local.js', 'export function local(x) { return x - 1; }\n');
  write('ws/packages/app/src/main.js',
    "import { helper } from '@ws/util';\n"
    + "import { deepFn } from '@ws/util/lib/deep.js';\n"
    + "import { local } from './local.js';\n"
    + 'export function run(x) { return helper(x) + deepFn(x) + local(x); }\n');
  // What npm, yarn and pnpm create for a workspace package.
  const linkDir = path.join(real, 'ws', 'node_modules', '@ws');
  fs.mkdirSync(linkDir, { recursive: true });
  fs.symlinkSync(path.join('..', '..', 'packages', 'util'), path.join(linkDir, 'util'));
  // A second spelling of one directory. `real/` is reached directly; `link/` goes through
  // a symlink, which is what /tmp -> /private/tmp does to every path under it on macOS.
  fs.symlinkSync(real, path.join(outer, 'link'));

  if (!fs.existsSync(path.join(linkDir, 'util', 'index.js'))) {
    return fail('the fixture\'s workspace link does not resolve, so the check would pass on any implementation');
  }

  const parseFrom = async (root: string): Promise<Relation[]> => {
    const output = scratchDir('js-gate-symlink-root-out-');
    await new JavaScriptProjectAnalyzer().analyze({
      rootDir: root, outputDir: output, baseMservPath: root, serviceVersionLink: 'gate-v1',
    });
    return readRelations(output);
  };
  const canonical = await parseFrom(fs.realpathSync(path.join(real, 'ws')));
  const symlinked = await parseFrom(path.join(outer, 'link', 'ws'));

  const outcomesOf = (relations: Relation[]): string[] => {
    const imports = relations.find((r) => r.name === 'js_import')!;
    const specifier = imports.header.indexOf('specifier');
    const outcome = imports.header.indexOf('resolutionOutcome');
    const resolvedFile = imports.header.indexOf('resolvedFilePath');
    return imports.rows
      .map((r) => `${r[specifier]} ${r[outcome]} ${r[resolvedFile]}`)
      .sort();
  };
  // The file each one names is asserted too: RESOLVED_PROJECT with a path outside the
  // tree, or pointing through `node_modules/`, would be a different defect wearing the
  // right outcome.
  const want = [
    './local.js RESOLVED_PROJECT packages/app/src/local',
    '@ws/util RESOLVED_PROJECT packages/util/index',
    '@ws/util/lib/deep.js RESOLVED_PROJECT packages/util/lib/deep',
  ];
  for (const [label, relations] of [['canonical', canonical], ['symlinked', symlinked]] as const) {
    const got = outcomesOf(relations);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures += fail(`${label} root: imports ${JSON.stringify(got)}, expected ${JSON.stringify(want)} — `
        + 'a workspace package linked into node_modules is the project, not an external dependency');
    }
  }

  // The whole IR, not only the column the defect was read from: the two spellings must
  // produce one fact base. Before the fix these differed in every relation, because
  // baseMservPath feeds the module hash.
  const asText = (relations: Relation[]): string => relations
    .map((r) => `${r.name}\n${r.header.join('\t')}\n${r.rows.map((row) => row.join('\t')).sort().join('\n')}`)
    .sort()
    .join('\n');
  if (asText(canonical) !== asText(symlinked)) {
    const a = canonical.map((r) => `${r.name}:${r.rows.length}`).sort().join(' ');
    const b = symlinked.map((r) => `${r.name}:${r.rows.length}`).sort().join(' ');
    failures += fail(`the two spellings of one root produced different IR\n    canonical  ${a}\n    symlinked  ${b}`);
  }
  console.log('  3 imports asserted under both spellings of one root; the full relation set is identical');
  return failures;
}

/**
 * A walk root that is a package shipping from a build directory walks it (#620).
 *
 * `dist/` is skipped for a project because it is the artefact beside the
 * source. For a PUBLISHED package handed to the parser on its own, it is the
 * only code the package ships, and skipping it staged nothing: zero `js_module`
 * rows, every call into the package unknown, nothing saying why. Asserted on a
 * root whose `exports` name `dist/`: its files are modules, its entries resolve,
 * the summary names the directory walked, and the skip still holds for a
 * nested `dist/` and for `node_modules` under the same root.
 */
async function publishedPackageWalksItsBuildOutput(): Promise<number> {
  let failures = 0;
  const root = scratchDir('js-gate-published-');
  const write = (relative: string, contents: string): void => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('package.json', JSON.stringify({
    name: 'shipped', exports: { '.': { require: './dist/main.cjs', import: './dist/main.mjs' } },
  }) + '\n');
  write('dist/main.cjs', 'module.exports = { hello() { return 1; } };\n');
  write('dist/main.mjs', 'export function hello() { return 1; }\n');
  write('src/main.js', 'export function hello() { return 1; }\n');
  // Not the root's own build directory: stays skipped.
  write('src/other/dist/bundle.js', 'var a = 1;\n');
  write('node_modules/dep/index.js', 'module.exports = 1;\n');
  const output = scratchDir('js-gate-published-out-');
  const summary = await new JavaScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir: output, baseMservPath: 'shipped', serviceVersionLink: 'gate-v1',
  });
  const relations = readRelations(output);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const files = modules.rows.map((r) => r[modules.header.indexOf('filePath')] ?? '').sort();
  const want = ['dist/main.cjs', 'dist/main.mjs', 'src/main.js'];
  if (JSON.stringify(files) !== JSON.stringify(want)) {
    failures += fail(`modules ${JSON.stringify(files)}, expected ${JSON.stringify(want)}: the root's own dist/ is walked, `
      + 'a nested dist/ and node_modules are not');
  }
  const entries = relations.find((r) => r.name === 'js_package_entry')!;
  const outcomes = entries.rows.map((r) => r[entries.header.indexOf('targetOutcome')]);
  if (entries.rows.length !== 2 || outcomes.some((o) => o !== 'RESOLVED')) {
    failures += fail(`entries ${JSON.stringify(outcomes)}: both exports conditions must RESOLVE to a staged module`);
  }
  // The analyzer resolves its root through symlinks before walking (#795), and the
  // summary names the path it actually walked, so the expectation is canonical too —
  // on macOS the scratch root is under /var, which is a symlink to /private/var.
  if (summary.buildOutputWalked.length !== 1
      || summary.buildOutputWalked[0] !== path.join(fs.realpathSync(root), 'dist')) {
    failures += fail(`buildOutputWalked ${JSON.stringify(summary.buildOutputWalked)}: the exception is visible in the summary`);
  }
  if ((summary.skippedByDirectory['dist'] ?? 0) !== 1 || (summary.skippedByDirectory['node_modules'] ?? 0) !== 1) {
    failures += fail(`skippedByDirectory ${JSON.stringify(summary.skippedByDirectory)}: the nested dist/ file and `
      + 'the node_modules file are still counted as skipped');
  }
  // #790: the count is not enough. A pruned directory must leave a ROW in the skip
  // table, because that table is what every reader downstream consults, and without
  // one a repository whose first-party packages sit under an excluded name analyses
  // as a handful of files with nothing to say the rest was dropped.
  {
    const skippedCsv = path.join(output, JAVASCRIPT_CSV_FILES.SKIPPED_FILES);
    const lines = fs.readFileSync(skippedCsv, 'utf8').trim().split('\n').slice(1)
      .filter((l) => l.length > 0);
    const excluded = lines.map((l) => l.split('\t'))
      .filter((f) => f[3] === 'DIRECTORY_EXCLUDED');
    const named = excluded.map((f) => f[0]).sort();
    if (excluded.length !== 2) {
      failures += fail(`DIRECTORY_EXCLUDED rows ${JSON.stringify(named)}: one per pruned directory, `
        + 'so the loss is visible where readers look');
    }
    if (!excluded.every((f) => /\d+ JavaScript file\(s\) under an excluded directory named/.test(f[4] ?? ''))) {
      failures += fail(`DIRECTORY_EXCLUDED detail ${JSON.stringify(excluded.map((f) => f[4]))}: `
        + 'the detail carries the count and the directory name');
    }
  }
  // The control: the same tree with no entry into dist/ stages nothing from it.
  write('package.json', '{"name":"shipped","main":"src/main.js"}\n');
  const control = scratchDir('js-gate-published-control-');
  const controlSummary = await new JavaScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir: control, baseMservPath: 'shipped', serviceVersionLink: 'gate-v1',
  });
  if (controlSummary.counts['js_module'] !== 1 || controlSummary.buildOutputWalked.length !== 0) {
    failures += fail(`control: ${controlSummary.counts['js_module']} modules, walked ${JSON.stringify(controlSummary.buildOutputWalked)}; `
      + 'a package whose entry is not under dist/ keeps the skip');
  }
  console.log('  3 modules from a dist-shipping root, 2 resolved entries, nested dist/ and node_modules still skipped, control holds');
  return failures;
}

/**
 * An object type's children carry their member names (#651).
 *
 * `@typedef {Object} State` + `@property {Router} module` and an inline
 * `{ router: Router }` both emit the member's type as a child of the OBJECT_TYPE
 * row; without the name nothing downstream can say which member is a Router.
 * Asserted by value: each member child's `memberName`, a nested `opts.depth` kept
 * as written, and `""` on every node that is not an object member.
 */
function objectTypeMembersCarryTheirNames(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const module = modules.rows.find((r) => (r[mPath] ?? '').endsWith('object-typedef.js'))?.[mPk];
  const refs = relations.find((r) => r.name === 'js_type_reference')!;
  const col = (c: string): number => refs.header.indexOf(c);
  if (col('memberName') < 0) {
    return fail('js_type_reference has no memberName column');
  }
  const mine = refs.rows.filter((r) => r[col('ownerModuleLinkHash')] === module);
  const byKey = new Map(mine.map((r) => [r[pkIndexOf(refs.header, 'js_type_reference')] ?? '', r]));
  const expected: ReadonlyArray<readonly [string, string, string]> = [
    // typeName, memberName, parent kind
    ['Router', 'module', 'OBJECT_TYPE'], ['string', 'source', 'OBJECT_TYPE'], ['number', 'opts.depth', 'OBJECT_TYPE'],
    ['Router', 'router', 'OBJECT_TYPE'], ['Array', 'tags', 'OBJECT_TYPE'],
    // A function type's children say which parameter, and which is the return (#691).
    ['Router', 'param:0', 'FUNCTION_TYPE'], ['', 'param:1', 'FUNCTION_TYPE'], ['boolean', 'return', 'FUNCTION_TYPE'],
    ['Router', 'param:1', 'FUNCTION_TYPE'], ['void', 'return', 'FUNCTION_TYPE'],
  ];
  for (const [typeName, memberName, parentKind] of expected) {
    const row = mine.find((r) => r[col('typeName')] === typeName && r[col('memberName')] === memberName);
    const parent = row === undefined ? undefined : byKey.get(row[col('parentReferenceLinkHash')] ?? '');
    if (row === undefined || parent?.[col('referenceKind')] !== parentKind) {
      failures += fail(`no ${typeName} child named ${JSON.stringify(memberName)} under an ${parentKind} node`);
    }
  }
  // `function(Router)` has one child, and it is param:0, not the return.
  const bare = mine.filter((r) => r[col('memberName')] === 'param:0' && r[col('typeName')] === 'Router');
  if (bare.length !== 2) {
    failures += fail(`${bare.length} Router children labelled param:0, expected 2 (the closure's and the bare function type's)`);
  }
  const named = mine.filter((r) => (r[col('memberName')] ?? '') !== '');
  if (named.length !== expected.length + 1) {
    failures += fail(`${named.length} rows carry a memberName, expected ${expected.length + 1}: only an object type's members and a function type's parameters and return do`);
  }
  for (const r of named) {
    const parent = byKey.get(r[col('parentReferenceLinkHash')] ?? '');
    const kind = parent?.[col('referenceKind')];
    const label = r[col('memberName')] ?? '';
    const isFunctionLabel = label === 'return' || label.startsWith('param:');
    if (kind !== (isFunctionLabel ? 'FUNCTION_TYPE' : 'OBJECT_TYPE')) {
      failures += fail(`${r[col('typeName')]} carries memberName ${label} under a ${kind} parent`);
    }
  }
  // The frozen order holds: the key is still c22 and the new column sits after it.
  if (refs.header[22] !== 'jsTypeReferenceUniqueHash' || refs.header[23] !== 'memberName') {
    failures += fail(`columns 22 and 23 are ${refs.header[22]}, ${refs.header[23]}: memberName must be appended after the key`);
  }
  console.log(`  ${expected.length} member names asserted by value, none elsewhere, column appended after the key`);
  return failures;
}

/**
 * `UNKNOWN_SYNTAX` names only what the vocabulary cannot.
 *
 * The value is deliberate and expected to be non-empty — JSDoc type syntax is
 * not standardised — which is exactly what let it hide misclassifications: 59
 * of 59 `@callback`s named by their `@returns` tag's raw text, 173 `@extends`
 * operands that were plain names, 27 parenthesised unions with the union never
 * enqueued, `this` and `unknown` as raw text. A wrong kind is still one row and
 * passes every count.
 *
 * Two halves. On the scaffold, the exact tree each shape must produce. On every
 * output directory, a text rule that cannot be argued with: an UNKNOWN_SYNTAX row
 * whose name is a bare identifier had NAMED available, one whose text starts
 * with `(` was parentheses, and one starting with `@` is a tag, not a type.
 */
function unknownSyntaxNamesOnlyWhatTheVocabularyCannot(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const module = modules.rows.find((r) => (r[mPath] ?? '').endsWith('jsdoc-type-shapes.js'))?.[mPk];
  const refs = relations.find((r) => r.name === 'js_type_reference')!;
  const h = refs.header;
  const rOwner = h.indexOf('ownerModuleLinkHash');
  const rLine = h.indexOf('startLine');
  const rKind = h.indexOf('referenceKind');
  const rName = h.indexOf('typeName');
  const rDepth = h.indexOf('depth');
  const rChild = h.indexOf('childIndex');
  const rTag = h.indexOf('tagName');
  const rContext = h.indexOf('contextKind');
  const rPk = pkIndexOf(h, 'js_type_reference');
  const rParent = h.indexOf('parentReferenceLinkHash');
  const mine = refs.rows.filter((r) => r[rOwner] === module);
  // Each tree as `depth:childIndex:KIND:name`, in tree order: the predicate
  // selects ROOTS, and descendants follow the parent link — a `@property`
  // child sits on a different line from its `@typedef` root.
  const treeOf = (predicate: (r: readonly string[]) => boolean): string => {
    const roots = mine.filter((r) => (r[rParent] ?? '') === '' && predicate(r));
    const collected: (readonly string[])[] = [];
    const descend = (parent: readonly string[]): void => {
      collected.push(parent);
      mine.filter((r) => r[rParent] === parent[rPk])
        .sort((a, b) => Number(a[rChild]) - Number(b[rChild]))
        .forEach(descend);
    };
    roots.forEach(descend);
    return collected
      .sort((a, b) => Number(a[rDepth]) - Number(b[rDepth]) || Number(a[rChild]) - Number(b[rChild]))
      .map((r) => `${r[rDepth]}:${r[rChild]}:${r[rKind]}:${r[rName]}`).join(' ');
  };
  for (const [label, predicate, want] of [
    ['@callback Reducer', (r: readonly string[]) => r[rTag] === 'callback',
      '0:0:FUNCTION_TYPE: 1:0:NAMED:number 1:1:NAMED:string 1:2:NAMED:number'],
    ['@typedef {Object} Shape with two @property lines',
      (r: readonly string[]) => r[rTag] === 'typedef' && Number(r[rLine]) === 8,
      '0:0:OBJECT_TYPE: 1:0:NAMED:string 1:1:NAMED:number'],
    ['@extends {Base}', (r: readonly string[]) => r[rContext] === 'EXTENDS' && Number(r[rLine]) === 13,
      '0:0:NAMED:Base'],
    ['@extends {Base<string>}', (r: readonly string[]) => r[rContext] === 'EXTENDS' && Number(r[rLine]) === 15,
      '0:0:GENERIC_APPLICATION:Base 1:0:NAMED:string'],
    // `null` is a LiteralTypeNode in the compiler's tree (unlike `undefined`,
    // a keyword), so it is TYPE_LITERAL — the classification follows the AST.
    ['@param {(string|null)}', (r: readonly string[]) => Number(r[rLine]) === 18,
      '0:0:UNION: 1:0:NAMED:string 1:1:TYPE_LITERAL:null'],
    ['@param {this}', (r: readonly string[]) => Number(r[rLine]) === 19, '0:0:NAMED:this'],
    ['@param {unknown}', (r: readonly string[]) => Number(r[rLine]) === 20, '0:0:NAMED:unknown'],
    // §3.14.4: the qualifier is the name, the specifier is the import row's.
    ["@typedef {import('./base.js').Base}", (r: readonly string[]) => Number(r[rLine]) === 24,
      '0:0:IMPORT_TYPE:Base'],
    ["@type {import('./base.js')} — bare, names the module", (r: readonly string[]) => Number(r[rLine]) === 25,
      '0:0:IMPORT_TYPE:'],
    ['@type {[number, string]}', (r: readonly string[]) => Number(r[rLine]) === 27,
      '0:0:TUPLE: 1:0:NAMED:number 1:1:NAMED:string'],
    ["@type {Shape['name']}", (r: readonly string[]) => Number(r[rLine]) === 29,
      "0:0:INDEXED_ACCESS: 1:0:NAMED:Shape 1:1:TYPE_LITERAL:'name'"],
    ['@type {typeof pair}', (r: readonly string[]) => Number(r[rLine]) === 31,
      '0:0:TYPE_QUERY:pair'],
    ['@returns {value is string}', (r: readonly string[]) => Number(r[rLine]) === 35,
      '0:0:TYPE_PREDICATE:value 1:0:NAMED:string'],
    // §3.14.3: PARAM by position, `type` by tag.
    ['@type on a parameter node', (r: readonly string[]) => Number(r[rLine]) === 38,
      '0:0:NAMED:Shape'],
  ] as const) {
    const got = treeOf(predicate);
    if (got !== want) {
      failures += fail(`${label} produced [${got}], expected [${want}]`);
    }
  }
  const parameterTyped = mine.find((r) => Number(r[rLine]) === 38);
  if (parameterTyped !== undefined
    && (parameterTyped[rContext] !== 'PARAM' || parameterTyped[rTag] !== 'type')) {
    failures += fail(`@type on a parameter node is ${parameterTyped[rContext]}/${parameterTyped[rTag]}, `
      + 'expected PARAM/type — the position decides the context, the tag only the tagName');
  }
  const parameters = relations.find((r) => r.name === 'js_method_parameter')!;
  const pOwner = parameters.header.indexOf('ownerModuleLinkHash');
  const pName = parameters.header.indexOf('name');
  const pType = parameters.header.indexOf('declaredTypeName');
  const pLink = parameters.header.indexOf('typeReferenceLinkHash');
  const item = parameters.rows.find((r) => r[pOwner] === module && r[pName] === 'item');
  if (item?.[pType] !== 'Shape' || (item?.[pLink] ?? '') === '') {
    failures += fail(`the parameter carrying its own @type has declaredTypeName `
      + `${JSON.stringify(item?.[pType])} and ${(item?.[pLink] ?? '') === '' ? 'no' : 'a'} tree link; `
      + 'expected Shape with a tree — one selection feeds both columns');
  }
  // §3.10.1: the brand check resolves to CLASS_PRIVATE, and nothing else does.
  const expressions = relations.find((r) => r.name === 'js_expression')!;
  const xOwner = expressions.header.indexOf('ownerModuleLinkHash');
  const xName = expressions.header.indexOf('referencedName');
  const xResolution = expressions.header.indexOf('bindingResolution');
  const brand = expressions.rows.filter((r) => r[xOwner] === module && r[xName] === '#brand');
  const privateRows = expressions.rows.filter((r) => r[xOwner] === module && r[xResolution] === 'CLASS_PRIVATE');
  if (brand.length !== 1 || brand[0]?.[xResolution] !== 'CLASS_PRIVATE' || privateRows.length !== 1) {
    failures += fail(`\`#brand in o\`: ${brand.length} reference row(s) with resolution `
      + `${JSON.stringify(brand.map((r) => r[xResolution]))}, ${privateRows.length} CLASS_PRIVATE row(s) `
      + 'in the file; expected exactly one, and it CLASS_PRIVATE — a private name is a slot on the '
      + 'class, not a scope binding, and `this.#brand` must not be one');
  }
  // The text rule, over every directory this run produced.
  const directories = [outputDir, fixtureOutputDir, extraOutputDir].filter((d) => d !== '');
  let unknown = 0;
  let misclassified = 0;
  const col = (header: string[], name: string): number => header.indexOf(name);
  for (const directory of directories) {
    const examples: string[] = [];
    const fileOfModule = new Map<string, string>();
    forEachRow(directory, 'js_module', (r, header) => {
      fileOfModule.set(r[pkIndexOf(header, 'js_module')] ?? '', r[col(header, 'filePath')] ?? '');
    });
    forEachRow(directory, 'js_type_reference', (r, header) => {
      if (r[col(header, 'referenceKind')] !== 'UNKNOWN_SYNTAX') {
        return;
      }
      unknown += 1;
      const text = r[col(header, 'typeName')] ?? '';
      const reason = /^[A-Za-z_$][\w$]*$/.test(text) ? 'a bare identifier, which NAMED covers'
        : text.startsWith('(') ? 'parenthesised — the parentheses were not unwrapped'
          : text.startsWith('@') ? 'a tag, not a type'
            : undefined;
      if (reason !== undefined) {
        misclassified += 1;
        if (examples.length < 3) {
          examples.push(`${fileOfModule.get(r[col(header, 'ownerModuleLinkHash')] ?? '') ?? '?'} line `
            + `${r[col(header, 'startLine')]}: ${JSON.stringify(text)} is ${reason}`);
        }
      }
    });
    for (const example of examples) {
      failures += fail(`UNKNOWN_SYNTAX in ${path.basename(directory)} — ${example}`);
    }
  }
  console.log(`  ${unknown} UNKNOWN_SYNTAX rows over ${directories.length} output set(s), `
    + `${misclassified} with text the vocabulary names`);
  return failures;
}

/**
 * JSX tag names are references — and the rule is the language's, not a style.
 *
 * Schema §2.5a. A component element carries its tag as a `JSX_TAG_NAME` child
 * that reads a binding; an intrinsic one carries none. Each ruled form is one
 * line of the scaffold, and the two that the folk rule gets wrong are asserted
 * by name: `<_Private/>` is a reference (`_` is not a lowercase letter) and
 * `<widgets.panel/>` is a reference (a member expression, whatever its case).
 * js-fixtures' boundary case `<Foo-Bar/>` is intrinsic: it parses as an
 * Identifier and no `const` can bind it.
 */
function jsxTagNamesAreReferences(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const module = modules.rows.find((r) => (r[mPath] ?? '').endsWith('tag-forms.jsx'))?.[mPk];
  const expressions = relations.find((r) => r.name === 'js_expression')!;
  const h = expressions.header;
  const xPk = pkIndexOf(h, 'js_expression');
  const xOwner = h.indexOf('ownerModuleLinkHash');
  const xKind = h.indexOf('expressionKind');
  const xRole = h.indexOf('edgeRole');
  const xParent = h.indexOf('parentExpressionLinkHash');
  const xLine = h.indexOf('startLine');
  const xName = h.indexOf('referencedName');
  const xResolution = h.indexOf('bindingResolution');
  const xBinding = h.indexOf('resolvedBindingLinkHash');
  const mine = expressions.rows.filter((r) => r[xOwner] === module);
  const elementsAt = (line: number): (readonly string[])[] =>
    mine.filter((r) => Number(r[xLine]) === line
      && (r[xKind] === 'JSX_ELEMENT' || r[xKind] === 'JSX_INTRINSIC_ELEMENT'));
  const tagOf = (element: readonly string[]): readonly string[] | undefined =>
    mine.find((r) => r[xParent] === element[xPk] && r[xRole] === 'JSX_TAG_NAME');
  // line, tag, kind, referencedName of the tag child ('' = no child), resolution
  for (const [line, tag, kind, name, resolution] of [
    [7, '<div/>', 'JSX_INTRINSIC_ELEMENT', '', ''],
    [8, '<foo-bar/>', 'JSX_INTRINSIC_ELEMENT', '', ''],
    [9, '<Foo/>', 'JSX_ELEMENT', 'Foo', 'IMPORTED'],
    [10, '<_Private/>', 'JSX_ELEMENT', '_Private', 'MODULE'],
    [11, '<$Money/>', 'JSX_ELEMENT', '$Money', 'MODULE'],
    [12, '<widgets.panel/>', 'JSX_ELEMENT', 'widgets', 'MODULE'],
    [13, '<X.y.z/>', 'JSX_ELEMENT', 'X', 'MODULE'],
    [14, '<svg:circle/>', 'JSX_INTRINSIC_ELEMENT', '', ''],
    [15, '<Foo-Bar/>', 'JSX_INTRINSIC_ELEMENT', '', ''],
    [16, '<>text</>', 'JSX_INTRINSIC_ELEMENT', '', ''],
    [17, '<Foo><div/></Foo>', 'JSX_ELEMENT', 'Foo', 'IMPORTED'],
  ] as const) {
    const elements = elementsAt(line);
    const outer = elements.find((r) => (r[xRole] ?? '') !== 'JSX_TAG_NAME' && r[xKind] === kind)
      ?? elements[0];
    if (outer === undefined || outer[xKind] !== kind) {
      failures += fail(`${tag} (line ${line}) is ${outer?.[xKind] ?? 'no JSX row'}, expected ${kind}`);
      continue;
    }
    const tagChild = tagOf(outer);
    // A dotted tag's reference is the ROOT identifier of the property-access
    // subtree, so follow ACCESS_TARGET edges down to the leftmost leaf.
    let leaf = tagChild;
    while (leaf !== undefined && (leaf[xName] ?? '') === '') {
      const next: readonly string[] | undefined = mine.find((r) => r[xParent] === leaf![xPk]
        && r[xRole] === 'ACCESS_TARGET');
      if (next === undefined) {
        break;
      }
      leaf = next;
    }
    const gotName = leaf?.[xName] ?? '';
    const gotResolution = leaf?.[xResolution] ?? '';
    if (name === '') {
      if (tagChild !== undefined) {
        failures += fail(`${tag} (line ${line}) is intrinsic and carries a JSX_TAG_NAME child `
          + `naming ${JSON.stringify(tagChild[xName])} — a reference row for a name no binding can satisfy`);
      }
      continue;
    }
    if (tagChild === undefined || gotName !== name || gotResolution !== resolution
      || (leaf?.[xBinding] ?? '') === '') {
      failures += fail(`${tag} (line ${line}): tag child ${tagChild === undefined ? 'MISSING' : 'present'}, `
        + `root name ${JSON.stringify(gotName)} resolved ${gotResolution || '(none)'}`
        + `${(leaf?.[xBinding] ?? '') === '' ? ', no binding link' : ''}; expected ${name} ${resolution} `
        + 'with a binding link — the reference is IR, the language decides it, and it was 833 rows of nothing');
    }
  }
  // A spread attribute's expression is a child of the element, with the spread role.
  const spreadElement = elementsAt(18).find((r) => r[xKind] === 'JSX_ELEMENT');
  const spread = spreadElement === undefined ? undefined
    : mine.find((r) => r[xParent] === spreadElement[xPk] && r[xRole] === 'SPREAD_OPERAND');
  if (spread === undefined || spread[xName] !== 'widgets' || spread[xResolution] !== 'MODULE') {
    failures += fail(`<Foo {...widgets} /> (line 18): the spread's expression is `
      + `${spread === undefined ? 'MISSING' : `${spread[xName]} ${spread[xResolution]}`}; expected the `
      + 'binding `widgets` read as a SPREAD_OPERAND child — the generic descent reached it as a bare node no branch claimed');
  }
  // The closing tag is not a second reference: exactly one JSX_TAG_NAME per component element.
  const tagRows = mine.filter((r) => r[xRole] === 'JSX_TAG_NAME');
  const componentRows = mine.filter((r) => r[xKind] === 'JSX_ELEMENT');
  if (tagRows.length !== componentRows.length) {
    failures += fail(`${tagRows.length} JSX_TAG_NAME edges for ${componentRows.length} component elements — `
      + 'a closing tag counted as a second reference, or an element lost its tag');
  }
  console.log(`  ${componentRows.length} component elements each with one tag reference, `
    + `${mine.filter((r) => r[xKind] === 'JSX_INTRINSIC_ELEMENT').length} intrinsic with none`);
  return failures;
}

/**
 * A comment has ONE host, and nothing declared beneath it inherits it.
 *
 * `/** @type {import('./x.js').T} *\/ const c = { … function inner() {} … }`:
 * the comment documents `c`. The walk from a bound name to its owning
 * declaration climbed to the nearest VariableDeclaration with no stop, so
 * `inner`, a class, a named function expression's name and a catch parameter
 * each took `c`'s @type, initialiser and binding form. js_import collided
 * (no owner in its key); js_type_reference did NOT — each copy had a distinct
 * owner, so PK and FK were green while one comment was counted four times.
 * Found by the held-back corpus: 4 duplicates at three sites, zero in 3.59M
 * development rows.
 */
function commentsHaveOneHost(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const module = modules.rows.find((r) => (r[mPath] ?? '').endsWith('rehosted-comment.js'))?.[mPk];
  const refs = relations.find((r) => r.name === 'js_type_reference')!;
  const rOwner = refs.header.indexOf('ownerModuleLinkHash');
  const rKind = refs.header.indexOf('referenceKind');
  const rOwnerKind = refs.header.indexOf('ownerKind');
  const rOwnerLink = refs.header.indexOf('ownerLinkHash');
  const variables = relations.find((r) => r.name === 'js_variable')!;
  const vPk = pkIndexOf(variables.header, 'js_variable');
  const vOwner = variables.header.indexOf('ownerModuleLinkHash');
  const vName = variables.header.indexOf('name');
  const vInit = variables.header.indexOf('hasInitializer');
  const vType = variables.header.indexOf('declaredTypeName');
  const vForm = variables.header.indexOf('bindingForm');
  const vInitLink = variables.header.indexOf('initializerExpressionLinkHash');
  const nameOf = new Map(variables.rows.map((r) => [r[vPk] ?? '', r[vName] ?? '']));
  const importRows = refs.rows.filter((r) => r[rOwner] === module && r[rKind] === 'IMPORT_TYPE');
  const owners = importRows.map((r) => `${r[rOwnerKind]}:${nameOf.get(r[rOwnerLink] ?? '') ?? '?'}`);
  if (importRows.length !== 1 || owners[0] !== 'VARIABLE:controller') {
    failures += fail(`the one @type comment produced ${importRows.length} IMPORT_TYPE row(s) owned by `
      + `${JSON.stringify(owners)}; expected exactly one, owned by controller. A comment re-hosted `
      + 'downward passes the PK gate because each copy has its own owner');
  }
  const imports = relations.find((r) => r.name === 'js_import')!;
  const iOwner = imports.header.indexOf('ownerModuleLinkHash');
  const iBearer = imports.header.indexOf('edgeBearer');
  const commentImports = imports.rows.filter((r) => r[iOwner] === module && r[iBearer] === 'COMMENT');
  if (commentImports.length !== 1) {
    failures += fail(`${commentImports.length} COMMENT-borne js_import row(s) for one import type; expected one`);
  }
  for (const name of ['inner', 'Local', 'g', 'err'] as const) {
    const row = variables.rows.find((r) => r[vOwner] === module && r[vName] === name);
    if (row === undefined) {
      failures += fail(`no js_variable row for ${name}`);
      continue;
    }
    if (row[vInit] !== 'false' || (row[vType] ?? '') !== '' || row[vForm] !== 'IDENTIFIER'
      || (row[vInitLink] ?? '') !== '') {
      failures += fail(`${name}, declared INSIDE controller's initialiser, reads hasInitializer=${row[vInit]} `
        + `declaredTypeName=${JSON.stringify(row[vType])} bindingForm=${row[vForm]}`
        + `${(row[vInitLink] ?? '') !== '' ? ' with an initializer link' : ''} — the enclosing `
        + "declarator's facts, inherited by climbing past its own");
  }
  }
  const controller = variables.rows.find((r) => r[vOwner] === module && r[vName] === 'controller');
  if (controller?.[vInit] !== 'true' || controller[vType] !== "import('./x.js').Controller") {
    failures += fail(`controller itself reads hasInitializer=${controller?.[vInit]} declaredTypeName=`
      + `${JSON.stringify(controller?.[vType])} — the control`);
  }
  console.log(`  1 comment, ${importRows.length} reference, ${commentImports.length} import row, 4 nested names clean`);
  return failures;
}

/**
 * The torture scripts hold — every trap in the four files, by line.
 *
 * Python has scoping_edge_cases.py and name_mangling_edge_cases.py: dense
 * files where a hand-rolled resolver can get every line wrong while the
 * language's own rule is simple. These are JavaScript's. Each assertion is
 * the language's answer, keyed on the line that asks it, so a wrong row
 * fails by construct and not by count.
 */
function tortureScriptsHold(): number {
  let failures = 0;
  const relations = readRelations(outputDir);
  const modules = relations.find((r) => r.name === 'js_module')!;
  const mPk = pkIndexOf(modules.header, 'js_module');
  const mPath = modules.header.indexOf('filePath');
  const moduleOf = (suffix: string): string =>
    modules.rows.find((r) => (r[mPath] ?? '').endsWith(suffix))?.[mPk] ?? '?';
  const rel = (name: string) => relations.find((r) => r.name === name)!;
  const col = (r: { header: readonly string[] }, c: string): number => r.header.indexOf(c);
  const rowsOf = (name: string, module: string) => {
    const r = rel(name);
    const owner = col(r, 'ownerModuleLinkHash');
    return { r, rows: r.rows.filter((row) => row[owner] === module) };
  };
  const expect = (file: string, line: number, what: string, got: string, want: string): void => {
    if (got !== want) {
      failures += fail(`${file}:${line} ${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  };

  // ---- scoping ------------------------------------------------------------
  {
    const file = 'torture/scoping.js';
    const module = moduleOf(file);
    const { r: x, rows: expressions } = rowsOf('js_expression', module);
    const { r: v, rows: variables } = rowsOf('js_variable', module);
    const { r: sc, rows: scopes } = rowsOf('js_scope', module);
    const vPk = pkIndexOf(v.header, 'js_variable');
    const lineOfVariable = new Map(variables.map((row) => [row[vPk] ?? '', row[col(v, 'startLine')] ?? '']));
    const kindOfScope = new Map(scopes.map((row) => [row[pkIndexOf(sc.header, 'js_scope')] ?? '', row[col(sc, 'scopeKind')] ?? '']));
    // The LAST reference on the line: `for (let i …) { push(() => i) }` reads
    // `i` three times and the one under test is inside the callback.
    const reference = (line: number, name: string) => expressions.filter((row) =>
      Number(row[col(x, 'startLine')]) === line && row[col(x, 'expressionKind')] === 'IDENTIFIER'
      && row[col(x, 'referencedName')] === name)
      .sort((a, b) => Number(a[col(x, 'startColumn')]) - Number(b[col(x, 'startColumn')])).pop();
    // resolution@declaration-line for a variable; resolution@param for a
    // parameter, whose row is js_method_parameter (c33), not js_variable.
    const resolution = (line: number, name: string): string => {
      const row = reference(line, name);
      if (row === undefined) { return 'NO ROW'; }
      const target = lineOfVariable.get(row[col(x, 'resolvedBindingLinkHash')] ?? '');
      const parameter = (row[col(x, 'resolvedParameterLinkHash')] ?? '') !== '' ? '@param' : '';
      return `${row[col(x, 'bindingResolution')]}${target === undefined ? parameter : `@${target}`}`;
    };
    // MODULE beats CLOSURE by the model: bindingResolution says WHERE the name
    // was found, and a module-level binding read from inside a function is
    // MODULE — the closure fact is the scope's, not the value's.
    for (const [line, name, want] of [
      [5, 'hoisted', 'LOCAL@4'],       // var hoisted out of its block, same function
      [5, 'outer', 'LOCAL@param'],     // the parameter shadows the module const
      [5, 'inner', 'LOCAL@3'],
      [7, 'self', 'LOCAL@7'],          // a named function expression's name, inside it
      [9, 'i', 'CLOSURE@9'],           // per-iteration let, captured by the arrow
      [10, 'j', 'MODULE@10'],          // a module-level var read from inside a function
      [11, 'caught', 'LOCAL@11'],      // the catch binding, read inside the catch block
      [12, 'Late', 'CLOSURE@12'],      // the class's inner name binding, from its static method
      [13, 'declaredAfter', 'MODULE@14'], // a hoisted function, referenced before its line
      [16, 'outer', 'MODULE@1'],
      [17, 'self', 'UNRESOLVED_FREE'], // the expression's name is not visible outside it
      [19, 'rebound', 'LOCAL@19'],     // the const in the body shadows the expression's own name (#682)
      [20, 'shadowed', 'LOCAL@param'], // so does a parameter of the same name
    ] as const) {
      expect(file, line, `\`${name}\``, resolution(line, name), want);
    }
    // The default `outer = outer` reads the PARAMETER (a TDZ error at runtime),
    // not the module binding — the compiler's rule, and the trap.
    expect(file, 2, '`outer` in its own default', resolution(2, 'outer'), 'LOCAL@param');
    // A property key is not a reference: line 15 has no IDENTIFIER row named paint.
    expect(file, 15, 'property key `paint` as a reference',
      reference(15, 'paint') === undefined ? 'none' : 'a reference row', 'none');
    // var vs let: declaration scope kinds.
    const variable = (name: string) => variables.find((row) => row[col(v, 'name')] === name);
    const scopeKinds = (name: string): string => {
      const row = variable(name);
      return row === undefined ? 'NO ROW'
        : `${kindOfScope.get(row[col(v, 'declarationScopeLinkHash')] ?? '')}/${kindOfScope.get(row[col(v, 'syntacticScopeLinkHash')] ?? '')}`;
    };
    expect(file, 4, '`hoisted` declaration/syntactic scope kinds', scopeKinds('hoisted'), 'FUNCTION/BLOCK');
    expect(file, 4, '`blocked` declaration/syntactic scope kinds', scopeKinds('blocked'), 'BLOCK/BLOCK');
    expect(file, 11, '`caught` declaration scope kind', scopeKinds('caught').split('/')[0] ?? '', 'CATCH');
    expect(file, 10, '`j` hoists to the module from the for-scope it is written in', scopeKinds('j'), 'MODULE/BLOCK');
  }

  // ---- module edges ---------------------------------------------------------
  {
    const file = 'torture/module-edges.cjs';
    const module = moduleOf(file);
    const { r: i, rows: imports } = rowsOf('js_import', module);
    const { r: e, rows: exports_ } = rowsOf('js_export', module);
    const importAt = (line: number, local?: string) => imports.find((row) =>
      Number(row[col(i, 'startLine')]) === line && (local === undefined || row[col(i, 'localName')] === local));
    const describe = (row: readonly string[] | undefined): string => row === undefined ? 'NO ROW'
      : `${row[col(i, 'importForm')]}/${row[col(i, 'specifierKind')]}/top=${row[col(i, 'isTopLevel')]}/cond=${row[col(i, 'isConditional')]}/${row[col(i, 'bindingForm')]}:${row[col(i, 'importedName')]}>${row[col(i, 'localName')]}`;
    expect(file, 1, 'builtin require', describe(importAt(1)),
      'REQUIRE_CALL/STRING_LITERAL/top=true/cond=false/NAMESPACE:>fs');
    expect(file, 2, 'destructured require with a rename', describe(importAt(2, 'read')),
      'REQUIRE_CALL/STRING_LITERAL/top=true/cond=false/DESTRUCTURED:readFile>read');
    expect(file, 4, 'require inside a function under an if, bound to nothing', describe(importAt(4)),
      'REQUIRE_CALL/STRING_LITERAL/top=false/cond=true/SIDE_EFFECT_ONLY:>');
    expect(file, 5, 'require of a conditional expression', (importAt(5)?.[col(i, 'specifierKind')]) ?? 'NO ROW',
      'NON_LITERAL');
    expect(file, 5, 'non-literal resolution outcome', (importAt(5)?.[col(i, 'resolutionOutcome')]) ?? 'NO ROW',
      'UNRESOLVED_NON_LITERAL');
    expect(file, 10, 'dynamic import in expression position (binds a promise, not the module)', describe(importAt(10)),
      'DYNAMIC_IMPORT/STRING_LITERAL/top=true/cond=false/NAMESPACE:>');
    const exportAt = (line: number) => exports_.find((row) => Number(row[col(e, 'startLine')]) === line);
    const describeExport = (row: readonly string[] | undefined): string => row === undefined ? 'NO ROW'
      : `${row[col(e, 'exportForm')]}:${row[col(e, 'exportedName')]}/reexport=${row[col(e, 'isReExport')]}/overwritten=${row[col(e, 'overwritesPreviousExport')]}`;
    expect(file, 7, 'exports.first', describeExport(exportAt(7)), 'EXPORTS_MEMBER:first/reexport=false/overwritten=false');
    expect(file, 9, 'module.exports = require(...)', describeExport(exportAt(9)),
      'MODULE_EXPORTS_ASSIGNMENT:default/reexport=true/overwritten=true');
    expect(file, 9, 're-export links its import', (exportAt(9)?.[col(e, 'reExportImportLinkHash')] ?? '') === '' ? 'no link' : 'linked', 'linked');
    expect(file, 11, 'a member after the overwrite', describeExport(exportAt(11)),
      'MODULE_EXPORTS_MEMBER:extra/reexport=false/overwritten=false');
  }

  // ---- prototypes -------------------------------------------------------------
  {
    const file = 'torture/prototypes.js';
    const module = moduleOf(file);
    const { r: t, rows: types } = rowsOf('js_type', module);
    const { r: m, rows: methods } = rowsOf('js_method', module);
    const { r: h, rows: heritage } = rowsOf('js_type_heritage', module);
    const { r: b, rows: blocks } = rowsOf('js_block', module);
    const tPk = pkIndexOf(t.header, 'js_type');
    const typeNamed = (name: string) => types.find((row) => row[col(t, 'name')] === name);
    const typeNameOf = new Map(types.map((row) => [row[tPk] ?? '', row[col(t, 'name')] ?? '']));
    expect(file, 2, 'Legacy is a type', typeNamed('Legacy')?.[col(t, 'declarationForm')] ?? 'NO ROW', 'PROTOTYPE_CONSTRUCTOR');
    const methodAt = (line: number) => methods.find((row) => Number(row[col(m, 'startLine')]) === line);
    const describeMethod = (row: readonly string[] | undefined): string => row === undefined ? 'NO ROW'
      : `${row[col(m, 'methodKind')]}/${row[col(m, 'declarationForm')]}/owner=${typeNameOf.get(row[col(m, 'ownerTypeLinkHash')] ?? '') ?? '-'}/static=${row[col(m, 'isStatic')]}`;
    expect(file, 3, 'prototype method', describeMethod(methodAt(3)), 'CLASS_METHOD/PROTOTYPE_ASSIGNMENT/owner=Legacy/static=false');
    expect(file, 4, 'static assignment', describeMethod(methodAt(4)), 'CLASS_METHOD/STATIC_ASSIGNMENT/owner=Legacy/static=true');
    expect(file, 5, 'Object.assign onto the prototype', describeMethod(methodAt(5)), 'CLASS_METHOD/OBJECT_ASSIGN_PROTOTYPE/owner=Legacy/static=false');
    expect(file, 6, 'Object.defineProperty getter', describeMethod(methodAt(6)), 'GETTER/OBJECT_DEFINE_PROPERTY/owner=Legacy/static=false');
    expect(file, 14, 'class getter', describeMethod(methodAt(14)), 'GETTER/SYNTACTIC/owner=Modern/static=false');
    const heritageOf = (owner: string): string => heritage.filter((row) => typeNameOf.get(row[col(h, 'ownerTypeLinkHash')] ?? '') === owner)
      .map((row) => `${row[col(h, 'heritageForm')]}:${row[col(h, 'superTypeName')]}`).sort().join(',');
    expect(file, 8, 'util.inherits', heritageOf('Child'), 'UTIL_INHERITS:Legacy');
    expect(file, 10, 'Object.create(Legacy.prototype)', heritageOf('Other'), 'OBJECT_CREATE_PROTOTYPE:Legacy');
    expect(file, 11, 'extends clause', heritageOf('Modern'), 'EXTENDS_CLAUSE:Legacy');
    // #479. The import each heritage links, by the local name the import binds.
    const { r: imp, rows: importRows } = rowsOf('js_import', module);
    const importLocal = new Map(importRows.map((row) => [row[pkIndexOf(imp.header, 'js_import')] ?? '', row[col(imp, 'localName')] ?? '']));
    const heritageDescribe = (owner: string): string => {
      const row = heritage.find((r) => typeNameOf.get(r[col(h, 'ownerTypeLinkHash')] ?? '') === owner);
      if (row === undefined) { return 'NO ROW'; }
      const link = row[col(h, 'importLinkHash')] ?? '';
      return `${row[col(h, 'superTypeName')]}/computed=${row[col(h, 'isComputedSuperclass')]}`
        + `/import=${link === '' ? '-' : importLocal.get(link) ?? '?'}`
        + `/expr=${(row[col(h, 'sourceExpressionLinkHash')] ?? '') === '' ? 'NONE' : 'linked'}`;
    };
    expect(file, 21, 'class Dotted extends ns.Base', heritageDescribe('Dotted'), 'Base/computed=false/import=ns/expr=linked');
    expect(file, 23, 'class Mixed extends Mixin(Base)', heritageDescribe('Mixed'), 'Mixin(Base)/computed=true/import=-/expr=linked');
    expect(file, 24, 'class Wrapped extends (Base)', heritageDescribe('Wrapped'), 'Base/computed=false/import=Base/expr=linked');
    expect(file, 13, 'static block kind', blocks.find((row) => Number(row[col(b, 'startLine')]) === 13)?.[col(b, 'blockKind')] ?? 'NO ROW', 'CLASS_STATIC_BLOCK');
    // #706: chained assignments. One method row per callable, under the first
    // member link; a field row under every further member name; the prototype
    // literal's methods owned by the type.
    const { r: fld, rows: fieldRows } = rowsOf('js_field', module);
    const fieldsAt = (line: number): string => fieldRows.filter((row) => Number(row[col(fld, 'startLine')]) === line)
      .map((row) => `${row[col(fld, 'name')]}:${row[col(fld, 'declarationForm')]}/owner=${typeNameOf.get(row[col(fld, 'ownerTypeLinkHash')] ?? '') ?? '-'}/static=${row[col(fld, 'isStatic')]}`)
      .sort().join(',');
    const methodsAt = (line: number): string => methods.filter((row) => Number(row[col(m, 'startLine')]) === line)
      .map((row) => `${row[col(m, 'name')]}=${describeMethod(row)}`).sort().join(',');
    expect(file, 26, 'chained prototype literal: the static field', fieldsAt(26), 'api:STATIC_ASSIGNMENT/owner=Chained/static=true');
    expect(file, 26, 'chained prototype literal: the method', methodsAt(26), 'each=CLASS_METHOD/PROTOTYPE_OBJECT_LITERAL/owner=Chained/static=false');
    expect(file, 27, 'chained static through the alias', methodsAt(27), 'mixin=CLASS_METHOD/STATIC_ASSIGNMENT/owner=Chained/static=true');
    expect(file, 27, 'no field for the static method', fieldsAt(27), '');
    expect(file, 28, 'static and prototype member: the method', methodsAt(28), 'both=CLASS_METHOD/STATIC_ASSIGNMENT/owner=Chained/static=true');
    expect(file, 28, 'static and prototype member: the field', fieldsAt(28), 'both:PROTOTYPE_ASSIGNMENT/owner=Chained/static=false');
    expect(file, 29, 'two prototype names: the method', methodsAt(29), 'run=CLASS_METHOD/PROTOTYPE_ASSIGNMENT/owner=Chained/static=false');
    expect(file, 29, 'two prototype names: the field', fieldsAt(29), 'alias:PROTOTYPE_ASSIGNMENT/owner=Chained/static=false');
    const { r: x, rows: expressions } = rowsOf('js_expression', module);
    expect(file, 15, '`#secret in o`', expressions.find((row) => Number(row[col(x, 'startLine')]) === 15
      && row[col(x, 'referencedName')] === '#secret')?.[col(x, 'bindingResolution')] ?? 'NO ROW', 'CLASS_PRIVATE');
    const { r: c, rows: calls } = rowsOf('js_call_site', module);
    expect(file, 7, 'Legacy.call(this, …)', calls.find((row) => Number(row[col(c, 'startLine')]) === 7)?.[col(c, 'callKind')] ?? 'NO ROW', 'FUNCTION_CALL_CALL');
    const meta = expressions.find((row) => Number(row[col(x, 'startLine')]) === 17 && row[col(x, 'expressionKind')] === 'META_PROPERTY');
    expect(file, 17, '`new.target`', meta === undefined ? 'NO ROW' : `${meta[col(x, 'referencedName')]}/${meta[col(x, 'bindingResolution')] || 'unbound'}`, 'new.target/unbound');
  }

  // ---- call forms ---------------------------------------------------------------
  {
    const file = 'torture/call-forms.js';
    const module = moduleOf(file);
    const { r: c, rows: calls } = rowsOf('js_call_site', module);
    const callsAt = (line: number) => calls.filter((row) => Number(row[col(c, 'startLine')]) === line)
      .map((row) => `${row[col(c, 'callKind')]}${row[col(c, 'isOptionalCall')] === 'true' ? '?' : ''}:${row[col(c, 'calleeName')]}`)
      .sort().join(' ');
    for (const [line, want] of [
      [4, 'FUNCTION_CALL:plain'],
      [5, 'METHOD_CALL:m'],
      [6, 'COMPUTED_CALL:'],
      [7, 'FUNCTION_CALL?:maybe'],     // a bare optional call: the flag, not the member kind
      [8, 'OPTIONAL_CALL?:m'],
      [9, 'COMPUTED_CALL?:'],
      [10, 'CONSTRUCTOR_CALL:plain'],
      [11, 'IIFE_CALL:'],
      [12, 'IIFE_CALL:'],
      [13, 'IIFE_CALL:'],
      [14, 'FUNCTION_CALL_CALL:plain'],
      [15, 'FUNCTION_CALL_APPLY:plain'],
      [16, 'FUNCTION_CALL_BIND:plain'],
      [17, 'FUNCTION_CALL:plain TAGGED_TEMPLATE_CALL:raw'],
      [18, 'DYNAMIC_CODE_CALL:eval'],
      [21, 'METHOD_CALL:m SUPER_CALL:'],
    ] as const) {
      expect(file, line, 'call site(s)', callsAt(line), want);
    }
    // import() is BOTH a module edge and a call site, unlike require(): the
    // call kind is in the vocabulary because the call happens at runtime.
    expect(file, 19, 'import() as a call site', callsAt(19), 'DYNAMIC_IMPORT_CALL:');
    const outcome = (line: number): string => calls.find((row) => Number(row[col(c, 'startLine')]) === line)?.[col(c, 'resolutionOutcome')] ?? 'NO ROW';
    expect(file, 4, 'same-file resolution', outcome(4), 'SAME_FILE_RESOLVED');
    expect(file, 6, 'computed name is complete because it says so', outcome(6), 'COMPUTED_NAME');
    expect(file, 18, 'eval', outcome(18), 'DYNAMIC_CODE');
    expect(file, 14, 'receiver position of .call', calls.find((row) => Number(row[col(c, 'startLine')]) === 14)?.[col(c, 'receiverPosition')] ?? 'NO ROW', 'FIRST_ARGUMENT');
  }
  console.log('  four torture scripts, every trap asserted by line');
  return failures;
}

const CHECKS: Check[] = [
  { name: 'compiles', proves: 'tsc --noEmit is clean — the suite reports on code that actually builds', run: compiles },
  { name: 'column order matches the frozen schema', proves: 'the doc, the generated .dl and the emitted headers agree position for position — the emit-side counterpart of gen_decls.py --check, because a shifted column loads without error', run: columnOrderMatchesTheFrozenSchema },
  { name: 'every relation has a file', proves: 'a consumer can tell "no rows" from "the parser never ran", and the extraction is not vacuous', run: everyRelationHasAFile },
  { name: 'PK uniqueness and FK integrity', proves: 'no construct is visited twice, and every populated link resolves — relation list derived from the output directory', run: pkUniquenessAndFkIntegrity },
  { name: 'the integrity gate can fail', proves: 'the gate rejects a duplicated row, a dangling FK and an empty PK, so a passing run of it means something', run: integrityGateCanFail },
  { name: 'determinism', proves: 'two runs are byte-identical, so the output can be diffed, cached and compared against a golden file', run: determinism },
  { name: 'same-module links only', proves: 'tier-3 columns are empty and every populated link stays inside its own module — the parser emits IR and the engine resolves', run: sameModuleLinksOnly },
  { name: 'module-system coherence', proves: "a file's module system, its evidence and its contradiction flag agree, and .mjs/.cjs override the governing config outright", run: moduleSystemCoherence },
  { name: 'no emitted value can split a row', proves: 'no value contains a character a consumer treats as a line break, so a row cannot tear', run: noValueCanSplitARow },
  { name: 'row paths are self-consistent', proves: 'filePath names the file and every derived name column agrees, so a position join is sound', run: rowPathsAreSelfConsistent },
  { name: 'enum-emission audit', proves: 'every reserved value carries zero rows, and every declared value is emitted or allowlisted with a reason — the check that finds classification errors no count can see', run: enumEmissionAudit },
  { name: 'type-only isolation', proves: 'no JSDoc typedef or callback reaches the call graph; three columns are constant in every row', run: typeOnlyIsolation },
  { name: 'variable endLine spans the declarator', proves: 'js_variable.endLine is the declarator\'s last line and varies, rather than the name\'s line and therefore constant on every row', run: variableEndLineSpansTheDeclarator },
  { name: 'the hoisting model holds', proves: 'every VAR_* binding declares into a function scope, and at least one `var` differs between its two scope columns — one column would pass this', run: hoistingModelHolds },
  { name: 'module-edge 1:1', proves: 'every module-edge expression is pointed at by exactly one import or export, so the second pass cannot double-mint', run: moduleEdgeOneToOne },
  { name: 'call-site 1:1', proves: 'one call site per call-like expression, and require() has none because it is a module edge', run: callSiteOneToOne },
  { name: 'package specifiers resolve under the site conditions', proves: "a require() of an exports-only package resolves to its `require` build and an ES import to its `import` build, a subpath export and a main-only package either way, so a dual package links to the build the runtime loads (#601)", run: packageSpecifiersResolveUnderTheSiteConditions },
  { name: 'computed member names link their key', proves: "a member declared under a computed name links its key expression (rooted COMPUTED_NAME, bound to the key's const) and a literal key fills name, on class methods, a getter, class fields, object-literal and prototype-literal members (#598)", run: computedMemberNamesLinkTheirKey },
  { name: 'pattern binding defaults are linked', proves: "a reference to a binding declared inside a destructuring pattern with a default links the default's root expression (c35), for object, nested and array parameter patterns and a variable pattern; a top-level parameter default and a binding without one link nothing (#673)", run: patternBindingDefaultsAreLinked },
  { name: 'several roots produce one set', proves: 'overlapping discovered roots merge into one flat fact base with no file extracted twice — the failure the real entry point found and a single-root harness cannot', run: severalRootsProduceOneSet },
  { name: 'every empty column is intended', devOnly: true, proves: 'a column that is never populated is a gap, a reservation or a corpus property — and the allowlist says which, so one that stops being filled fails by name', run: everyEmptyColumnIsIntended },
  { name: 'link columns mean what they claim', proves: 'every populated FK is asserted for meaning — name, kind, structure or position — or is named as integrity-only with the reason, so no link can be populated, resolvable and wrong without a check that would have said so', run: linkColumnsMeanWhatTheyClaim },
  { name: 'scope links point where they claim', proves: 'a body scope is a callable scope distinct from the owner scope, a type never lives in GLOBAL, and a body block opens a callable scope — the correctness the FK gate cannot see on a link that is populated, resolvable and wrong', run: scopeLinksPointWhereTheyClaim },
  { name: 'separator comments and namespace re-exports emit', proves: 'a comment after a comma and an `export * as ns` each produce their row, with the working control beside each — two constructs that were reached and emitted nothing', run: separatorCommentsAndNamespaceReexportsEmit },
  { name: 'reused names resolve by position', proves: 'a name reused in one module resolves each reference to the nearest preceding declaration and never merges distinct members, so an index keyed on a name cannot silently shadow a row', run: reusedNamesResolveByPosition },
  { name: 'extensions are decided in one place', proves: 'every predicate agrees on multi-part names and no JavaScript path rolls its own comparison, so a new two-part extension reaches all consumers and a ninth spelling fails here', run: extensionsAreDecidedInOnePlace },
  { name: 'scratch directories are owned and removable', proves: 'every temp directory this run created went through the registry that deletes it, so a new call site that bypasses cleanup fails here rather than filling a colleague\'s disk', run: scratchDirectoriesAreOwnedAndRemovable },
  { name: 'Flow files are declined and say so', proves: 'a file carrying Flow emits exactly one js_module row saying FLOW_REJECTED and nothing else, so the rejection is countable rather than a silent skip', run: flowFilesAreDeclinedAndSaySo },
  { name: 'owned rows sit inside their owner', proves: 'every owner and enclosing column is swept for containment, so context leaking down the traversal fails by name — assignment-declared members excluded, because those are supposed to be outside', run: ownedRowsSitInsideTheirOwner },
  { name: 'one comment mints one tree', proves: 'no comment produces two type-reference rows at one position inside it, so a JSDoc block re-hosted onto a nested declaration fails here — the PK carries the host and therefore cannot see it', run: oneCommentMintsOneTree },
  { name: 'optional modifiers reach the parameter row', proves: 'a parameter whose JSDoc type is `{T=}` reads isOptional=true, so the second of the two JSDoc optional markers cannot be silently dropped while the modifier sits in the type tree beside it', run: optionalModifiersReachTheParameterRow },
  { name: 'declared types agree with their references', proves: 'a position that links a type-reference tree also names the type, because the two are encodings of one fact', run: declaredTypesAgreeWithTheirReferences },
  { name: 'member accounting is honest', proves: 'a class-field arrow counts once though two relations describe it, and no anonymous callable nested in a method body reads as a member of the class', run: memberAccountingIsHonest },
  { name: 'callables name what they introduce', proves: 'every arrow and function expression links the js_method it is, closing the callback hop — and js_expression\'s PK is still c31 with the new column appended at c32', run: callablesNameWhatTheyIntroduce },
  { name: 'IR completeness', proves: 'every hop an engine needs is present, reported per bucket — and the one bucket that is a parser defect is empty', run: irCompleteness },
  { name: 'extra corpus is sound', devOnly: true, proves: 'every structural invariant survives real code at scale, and two runs over it are byte-identical', run: extraCorpusIsSound },
  { name: 'the torture scripts hold', proves: 'scoping (hoisting, TDZ, closures, named expressions, catch), CommonJS edges (conditional, non-literal, re-export overwrite), prototype declarations expressed as assignments and calls, and every call form — each trap asserted by line with the language\'s answer', run: tortureScriptsHold },
  { name: 'comments have one host', proves: 'a @type over an initialiser is owned once, and no function, class, named-expression or catch binding declared inside that initialiser inherits its type, initialiser or binding form — the double-mint the PK gate cannot see because each copy has its own owner', run: commentsHaveOneHost },
  { name: 'JSX tag names are references', proves: 'a component tag is a JSX_TAG_NAME child reading its binding and an intrinsic tag is none — by the language\'s rule, with `_Private`, `widgets.panel` and `Foo-Bar` each asserted where the folk rule fails', run: jsxTagNamesAreReferences },
  { name: '@import tags mint bindings', proves: 'a JSDoc @import tag mints one type-only js_import row per bound name with its real binding form, and a @param through the name links it, so the new spelling of a typedef import is not a silent nothing (#621)', run: jsdocImportTagsMintBindings },
  { name: 'package entries name what a package exposes', proves: 'js_package_entry carries every main/module/exports entry of every package in the parse, resolved to a module hash only when the target is a staged JavaScript file and a named absence otherwise (#616)', run: packageEntriesNameWhatAPackageExposes },
  { name: 'a symlinked root is the same tree', proves: 'a workspace package linked into node_modules resolves as RESOLVED_PROJECT whether the analysis root is spelled through a symlink or not, and both spellings produce one identical fact base (#795)', run: aSymlinkedRootIsTheSameTree },
  { name: 'a published package walks its build output', proves: 'a walk root whose own package.json ships from dist/ stages the modules under it, while a nested dist/ and node_modules stay skipped and the exception is listed in the summary (#620)', run: publishedPackageWalksItsBuildOutput },
  { name: 'object type members carry their names', proves: 'an OBJECT_TYPE child row names the member it types, nested names as written, nothing else does, and the column is appended after the frozen key (#651)', run: objectTypeMembersCarryTheirNames },
  { name: 'binding paths are keys, not names', proves: 'a destructured parameter\'s path is the key route (`wire` for `{ wire: local }`) on c33 alone, asserted by value on every pattern shape', run: bindingPathsAreKeysNotNames },
  { name: 'UNKNOWN_SYNTAX names only what the vocabulary cannot', proves: 'a callback is a FUNCTION_TYPE tree, a heritage operand is NAMED, parentheses are unwrapped and keywords are named — and no UNKNOWN_SYNTAX row anywhere carries text the vocabulary already covers', run: unknownSyntaxNamesOnlyWhatTheVocabularyCannot },
  { name: 'JSDoc tags reach exactly one row', proves: 'every @template parameter the compiler parsed becomes one row and no block is read twice — counted from node.jsDoc[].tags, because ts.getJSDocTags both loses blocks and inherits to children', run: jsdocTagsReachExactlyOneRow },
  { name: 'fixture nature labels are true', proves: 'a file declaring type-only has no statement and emits no expression or call-site row — asked for by js-fixtures, because five TypeScript fixtures were mislabelled before anyone checked', run: fixtureNatureLabelsAreTrue },
  { name: 'fixture corpus is sound', proves: "every structural invariant holds over js-fixtures' corpus too", run: fixtureCorpusIsSound },
];

async function main(): Promise<number> {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) {
      console.log(`${c.name}\n  ${c.proves}`);
    }
    return 0;
  }
  console.log('='.repeat(78));
  console.log('JavaScript suite — no ts.Program, no TypeChecker, no network');
  console.log('='.repeat(78));

  sweepOrphanedScratch();
  const t0 = Date.now();
  try {
    await extractCorpus();
    console.log('\nextraction: corpus extracted twice in '
      + `${((Date.now() - t0) / 1000).toFixed(1)}s, no ts.Program created`);
  } catch (error) {
    console.log(`\nextraction THREW: ${(error as Error).message}`);
    console.log('  Every check below will fail, which is the correct report: an extractor that '
      + 'throws must not read as a clean run.');
  }

  // THE SPLIT. Without `--corpus`, dev-only sweeps are not run, not listed in
  // the tally, and named once so their absence is visible. With it, they run
  // and a missing input fails.
  const corpusRequested = extraCorpusArgument() !== undefined;
  const active = CHECKS.filter((c) => c.devOnly !== true || corpusRequested);
  const skipped = CHECKS.filter((c) => c.devOnly === true && !corpusRequested);
  if (skipped.length > 0) {
    console.log(`\nDEV-ONLY, not run (pass --corpus <dir>): ${skipped.map((c) => c.name).join(', ')}`);
  }

  let failed = 0;
  for (const c of active) {
    console.log(`\n${c.name}`);
    const start = Date.now();
    let rc: number;
    try {
      rc = await c.run();
    } catch (error) {
      rc = fail(`threw: ${(error as Error).message}`);
    }
    console.log(`  ${rc ? 'FAIL' : 'PASS'}  (${((Date.now() - start) / 1000).toFixed(1)}s)  `
      + c.proves);
    failed += rc ? 1 : 0;
  }

  console.log('\n' + '='.repeat(78));
  if (pending > PENDING_BAR) {
    console.log(`PENDING RATCHET BROKEN: ${pending} pending, bar is ${PENDING_BAR}`);
    console.log(`  ${pendingNames.join(', ')}`);
    failed += 1;
  } else if (pending < PENDING_BAR) {
    console.log(`${pending} pending, bar is ${PENDING_BAR} — lower PENDING_BAR to lock this in`);
  } else if (pending > 0) {
    console.log(`${pending} check(s) PENDING: ${pendingNames.join(', ')}`);
    console.log('  Pending is not passing. The count may fall, never rise.');
  }
  console.log(`${active.length - failed}/${active.length} checks passed`
    + (skipped.length > 0 ? ` (${skipped.length} dev-only not run)` : ''));
  console.log('='.repeat(78));
  return failed ? 1 : 0;
}

void main()
  .then((code) => {
    cleanScratch();
    process.exit(code);
  })
  .catch((error: unknown) => {
    cleanScratch();
    console.log(String(error));
    process.exit(1);
  });
