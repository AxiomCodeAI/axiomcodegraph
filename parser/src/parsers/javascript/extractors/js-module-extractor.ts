import * as path from 'path';

import * as ts from 'typescript';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JS_BUNDLED_LINE_LENGTH_THRESHOLD,
  JS_EMISSION_REGIME,
  JS_MINIFIED_NAME_PATTERN,
  JS_TARGET_VERSION,
} from '@/constants/javascript-constants';
import {
  JsContradictionKind,
  JsModuleKind,
  JsModuleSystem,
  JsModuleSystemSource,
  JsScriptKind,
  JsSourceProvenance,
} from '@/enums/javascript/modules';
import { JsModuleRegistry } from '@/analysis-types/javascript/JsModuleRegistry';
import { keyOf } from '@/analysis-types/javascript/js-row';
import { EntityUtils } from '@/utils/entity-utils';
import {
  isFlowDeclarationFileName, isRequireCall, jsExtensionOf, lastLineOf,
  opensFunctionBoundary, stripJsExtension,
} from '@/utils/javascript';

/**
 * `js_module` — one row per file, minted so that its hash is computable before
 * the file is parsed.
 *
 * ## The hash comes from paths alone, and that is a structural requirement
 *
 * §1 of `BUILDING-A-PARSER.md`: *mint every module hash up front from PATHS
 * ALONE, before parsing any file*, so a declaration in file B can key itself
 * under file A's scope without file A having been read. {@link moduleHashFor} is
 * that function, and it is deliberately separate from {@link extractModule} —
 * the analyzer calls the former for every file before the loop that calls the
 * latter.
 *
 * The one thing that makes this non-obvious for JavaScript is that
 * `moduleSystem` is **in the key**, and `moduleSystem` comes from a
 * `package.json`. That is still paths alone: `PackageJsonResolver` is a pure
 * function of the filesystem, reads no JavaScript, and creates no Program.
 */

/**
 * The `js_module` primary key, from a path and a governing module system.
 *
 * Kept as a free function because the analyzer needs every module's hash before
 * any row object exists.
 */
export function moduleHashFor(
  filePath: string,
  baseMservPath: string,
  moduleSystem: JsModuleSystem,
  serviceVersionLinkHash: string
): string {
  return EntityUtils.generateEntityHash(
    ENTITY_IDENTIFIERS.JS_MODULE,
    keyOf(filePath, baseMservPath, moduleSystem, JS_EMISSION_REGIME, serviceVersionLinkHash)
  );
}

/**
 * `ts.ScriptKind` for a JavaScript file.
 *
 * `.jsx` gets `JSX` because the extension states the intent, and everything
 * else gets `JS`. The schema's measurement is what makes this safe rather than
 * a guess: **0 of 2,942 `.js` files parse differently** between the two, because
 * `ScriptKind.JS` already carries `languageVariant = JSX` — JavaScript has no
 * type-assertion syntax for `<` to be ambiguous with, so the `.ts`/`.tsx`
 * problem does not exist here.
 *
 * `.mjs` and `.cjs` are `JS`: they differ in module system, not in grammar.
 */
export function scriptKindFor(filePath: string): ts.ScriptKind {
  return isJsxFile(filePath) ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}

/**
 * Is this file JSX by NAME?
 *
 * One spelling, because there were two. `scriptKindFor` above decides what the
 * compiler parses; the module row's `scriptKind` column decides what the fact
 * base records, and it re-implemented the same `endsWith('.jsx')` inline. They
 * agreed — checked, not assumed — and nothing would have said so if one had
 * gained a case and the other had not, which is exactly how the three spellings
 * of "is this a JavaScript file" drifted apart.
 *
 * Via `jsExtensionOf`, so `a.jsx.flow` answers the same as `a.jsx`.
 */
function isJsxFile(filePath: string): boolean {
  return jsExtensionOf(path.basename(filePath)) === '.jsx';
}

export interface ModuleExtractionOptions {
  readonly sourceFile: ts.SourceFile;
  readonly sourceText: string;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly moduleQualifiedName: string;
  readonly moduleSystem: JsModuleSystem;
  readonly moduleSystemSource: JsModuleSystemSource;
  readonly governingPackageJsonPath: string;
  readonly packageName: string;
  readonly serviceVersionLinkHash: string;
}

export interface ModuleExtractionResult {
  readonly module: JsModuleRegistry;
  /** The scan's findings, reused downstream rather than recomputed. */
  readonly shape: ModuleShape;
}

/**
 * What one pass over the file establishes about the module as a whole.
 *
 * Collected in a single traversal rather than four, and handed to the callers
 * that need it — the binder needs `hasEsmSyntax` to decide strict mode, and the
 * module row needs all of it.
 */
export interface ModuleShape {
  /** A top-level `import` or `export` declaration: the file IS an ES module. */
  readonly hasEsmSyntax: boolean;
  /** A `require(...)` call ANYWHERE, including inside a function body. */
  readonly hasRequireCall: boolean;
  readonly hasTopLevelAwait: boolean;
  readonly hasJsxContent: boolean;
  readonly hasFlowPragma: boolean;
}

export function extractModule(options: ModuleExtractionOptions): ModuleExtractionResult {
  const shape = scanModuleShape(options.sourceFile, options.sourceText);
  const contradiction = contradictionOf(options.moduleSystem, shape);
  const sourceProvenance = isFlowFile(options.filePath, shape.hasFlowPragma)
    ? JsSourceProvenance.FLOW_REJECTED
    : provenanceOf(options.filePath, options.sourceText);

  const module = new JsModuleRegistry({
    name: stemOf(options.filePath),
    qualifiedName: options.moduleQualifiedName,
    fileName: path.basename(options.filePath),
    filePath: options.filePath,
    baseMservPath: options.baseMservPath,
    // A JavaScript file's kind turns on the same question TypeScript's does —
    // top-level import/export — and for the same consequence: module scope and
    // implicit strict mode versus the global object and sloppy mode.
    moduleKind: shape.hasEsmSyntax ? JsModuleKind.SOURCE_MODULE : JsModuleKind.SCRIPT_GLOBAL,
    scriptKind: isJsxFile(options.filePath) ? JsScriptKind.JSX : JsScriptKind.JS,
    moduleSystem: options.moduleSystem,
    moduleSystemSource: options.moduleSystemSource,
    governingPackageJsonPath: options.governingPackageJsonPath,
    contradictsGoverningConfig: contradiction !== JsContradictionKind.NONE,
    contradictionKind: contradiction,
    packageName: options.packageName,
    isExternalModule: shape.hasEsmSyntax,
    hasTopLevelAwait: shape.hasTopLevelAwait,
    // Recorded AFTER parsing, not guessed from the extension before it. The
    // schema is explicit that this is an observation and the script kind is not
    // a decision (§0.0).
    hasJsxContent: shape.hasJsxContent,
    hasFlowPragma: shape.hasFlowPragma,
    emissionRegime: JS_EMISSION_REGIME,
    targetTsVersion: JS_TARGET_VERSION,
    startLine: 1,
    endLine: lastLineOf(options.sourceFile),
    sourceProvenance,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });

  return { module, shape };
}

/**
 * Whether the file's own syntax contradicts what its config says it is.
 *
 * The Q3 ruling is *emit normally, flag it*, so this returns a value and never
 * a skip. All 170 measured contradictions are `ESM_SYNTAX_UNDER_COMMONJS` and
 * all of them are bundler input, where `package.json` governs nothing because
 * the bundler reads the file before Node ever would.
 *
 * `REQUIRE_UNDER_ESM` measured **0**, and it is the direction that genuinely
 * throws — `require` is not defined in an ES module. Its absence is a fact
 * worth being able to see, which is why it is a separate value rather than
 * folded into one boolean.
 */
function contradictionOf(
  moduleSystem: JsModuleSystem,
  shape: ModuleShape
): JsContradictionKind {
  // MIXED is a file that uses BOTH module systems, whichever one governs it.
  //
  // It was UNREACHABLE BY CONSTRUCTION before: the two one-directional tests
  // below check opposite values of `moduleSystem`, so they could never both be
  // true, and a value the schema declares could never be emitted. js-fixtures
  // found it with a file named `mixed-both-systems.js` that emits an
  // IMPORT_DECLARATION and two REQUIRE_CALLs and came out
  // ESM_SYNTAX_UNDER_COMMONJS.
  //
  // Reading it as "both systems present" is the only reading under which the
  // value exists, and it is the stronger statement: whichever config governs,
  // part of the file cannot run under it. The one-directional values keep their
  // meaning for the far more common case of a file using one system wrongly.
  if (shape.hasEsmSyntax && shape.hasRequireCall) {
    return JsContradictionKind.MIXED;
  }
  const esmUnderCommonJs = moduleSystem === JsModuleSystem.COMMONJS && shape.hasEsmSyntax;
  const requireUnderEsm = moduleSystem === JsModuleSystem.ESM && shape.hasRequireCall;
  if (esmUnderCommonJs) {
    return JsContradictionKind.ESM_SYNTAX_UNDER_COMMONJS;
  }
  if (requireUnderEsm) {
    return JsContradictionKind.REQUIRE_UNDER_ESM;
  }
  return JsContradictionKind.NONE;
}

/**
 * Bundled, generated, or hand-written.
 *
 * - **The name.** `foo.min.js` is minified whatever its line lengths are, and a
 *   minifier configured to wrap lines would otherwise slip through. Build
 *   products only; module-format markers were removed (see the pattern).
 * - **A line no human writes, AND a content signal.** Length alone labelled a
 *   399-line hand-written file for one 7,286-character regex literal — the
 *   shape this comment once said could not happen. A single long LITERAL is
 *   excused; a long line beside a `sourceMappingURL` footer or a bundler
 *   preamble is a minified bundle. Ruled 2026-09-13; the measured worth of the
 *   length signal is recorded on the constant.
 * - **A preamble with ordinary lines** is a readable concatenated build:
 *   not minified, not source, its own value.
 */
function provenanceOf(filePath: string, sourceText: string): JsSourceProvenance {
  if (JS_MINIFIED_NAME_PATTERN.test(path.basename(filePath))) {
    return JsSourceProvenance.BUNDLED;
  }
  const preamble = hasBundlerPreamble(sourceText);
  if (longestLineOf(sourceText) > JS_BUNDLED_LINE_LENGTH_THRESHOLD
    && (preamble || hasSourceMapFooter(sourceText))) {
    return JsSourceProvenance.BUNDLED;
  }
  if (preamble) {
    return JsSourceProvenance.GENERATED_MONOLITH;
  }
  return JsSourceProvenance.PROJECT;
}

/**
 * `//# sourceMappingURL=` in the FOOTER — the last line by convention, so the
 * search is bounded to the tail, the mirror of the preamble's head bound. It
 * is not a provenance on its own (a 45-line hand-written fixture carried one,
 * see below); it is the content signal that lets a long line count.
 */
function hasSourceMapFooter(sourceText: string): boolean {
  return /\/[/*][#@]\s*sourceMappingURL=/.test(sourceText.slice(-1_024));
}

/** Scans without allocating one string per line — bundles are one huge line. */
function longestLineOf(sourceText: string): number {
  let longest = 0;
  let lineStart = 0;
  for (let i = 0; i < sourceText.length; i += 1) {
    if (sourceText.charCodeAt(i) === 10) {
      const length = i - lineStart;
      if (length > longest) {
        longest = length;
      }
      lineStart = i + 1;
    }
  }
  const tail = sourceText.length - lineStart;
  return tail > longest ? tail : longest;
}

/**
 * The runtime preambles bundlers emit, matched only near the top of the file.
 *
 * Bounded to the first 4 KB on purpose: `webpackBootstrap` appearing in a
 * comment halfway down a hand-written file is not evidence the file is
 * generated, and an unbounded search would make it so.
 *
 * ## `sourceMappingURL` was here and is not a preamble
 *
 * It is a **footer** by convention — the last line of a generated file — and the
 * positional bound that makes the other four safe does nothing for it: for any
 * file under 4 KB the head window IS the whole file, so a trailing
 * `//# sourceMappingURL=` read as a preamble and a 45-line hand-written fixture
 * was classified `GENERATED_MONOLITH`.
 *
 * That is worse than a wrong column. Gate 7.3.5 says a non-`PROJECT` file
 * contributes zero rows to any coverage denominator, so the file was **silently
 * removed from coverage while every count read green** — found by `js-fixtures`,
 * on a fixture written to test something else entirely.
 *
 * The other four really are headers: a bundler's runtime preamble is the first
 * thing in the file, which is what makes bounding the search meaningful.
 */
const BUNDLER_PREAMBLES: readonly RegExp[] = [
  /webpackBootstrap/,
  /__webpack_require__/,
  /\bdefine\.amd\b[\s\S]{0,200}\bmodule\.exports\b/,
  /\(function\s*\(\s*global\s*,\s*factory\s*\)/,
];

function hasBundlerPreamble(sourceText: string): boolean {
  const head = sourceText.slice(0, 4_096);
  return BUNDLER_PREAMBLES.some((pattern) => pattern.test(head));
}

/**
 * One traversal, four findings.
 *
 * ## `hasRequireCall` must see a nested `require`, and that is the whole reason
 * this is a recursive walk rather than a statement-list scan
 *
 * 13.6% of measured `require()` calls are **not top-level** — 1,048 inside a
 * function body and 179 inside a block. A scan of `sourceFile.statements`, which
 * is what every TypeScript module-edge extractor does because every TypeScript
 * module edge is a top-level declaration, misses one require in seven. The
 * module row needs the answer for `REQUIRE_UNDER_ESM`, and the import extractor
 * needs it for the edges themselves.
 *
 * ## `hasTopLevelAwait` must NOT descend into functions
 *
 * `await` inside an `async function` is ordinary. Top-level `await` forces module
 * semantics on the file, which is a different claim, so the walk stops at every
 * function boundary for that flag specifically — while continuing for the other
 * three.
 */
function scanModuleShape(sourceFile: ts.SourceFile, sourceText: string): ModuleShape {
  let hasEsmSyntax = false;
  let hasRequireCall = false;
  // Names bound by `createRequire(import.meta.url)`. A call through one of these
  // is the SANCTIONED ESM->CommonJS bridge, not the unqualified global
  // `require` — the file runs, and `js_import` already classifies the edge as
  // CREATE_REQUIRE rather than REQUIRE_CALL. Counting it here made the MODULE
  // row say REQUIRE_UNDER_ESM while the IMPORT rows said CREATE_REQUIRE: two
  // relations contradicting each other inside one fact base, losing no rows and
  // therefore invisible to every count. Found by js-fixtures.
  const createdRequireNames = collectCreatedRequireNames(sourceFile);
  let hasTopLevelAwait = false;
  let hasJsxContent = false;

  for (const statement of sourceFile.statements) {
    if (isEsmModuleStatement(statement)) {
      hasEsmSyntax = true;
      break;
    }
  }

  const visit = (node: ts.Node, insideFunction: boolean): void => {
    if (!hasRequireCall && isRequireCall(node)
      && !isCreatedRequireBinding(node, createdRequireNames)) {
      hasRequireCall = true;
    }
    if (!hasJsxContent && isJsxNode(node)) {
      hasJsxContent = true;
    }
    if (!insideFunction && !hasTopLevelAwait && ts.isAwaitExpression(node)) {
      hasTopLevelAwait = true;
    }
    // Brace every branch, and make the boundary explicit: a function's body is
    // still walked (the other three findings live in there), but everything
    // inside it is no longer "top level" for the await question.
    // opensFunctionBoundary, NOT opensThisScope: an arrow does not rebind `this`
    // and does end the top level, so `async () => { await x; }` has no
    // top-level await. Using the `this` predicate here reported 33 of 816 real
    // files as having one.
    const entersFunction = insideFunction || opensFunctionBoundary(node);
    ts.forEachChild(node, (child) => {
      visit(child, entersFunction);
    });
  };
  ts.forEachChild(sourceFile, (child) => {
    visit(child, false);
  });

  return {
    hasEsmSyntax,
    hasRequireCall,
    hasTopLevelAwait,
    hasJsxContent,
    hasFlowPragma: hasFlowPragma(sourceText),
  };
}

/**
 * A top-level statement that makes the file an ES module.
 *
 * `import ... from` and every `export` form, including `export {}` — which
 * declares nothing and is the canonical way to force module semantics on a file
 * that would otherwise be a script. An `import(...)` expression does NOT count:
 * dynamic import is legal in a CommonJS file and is how CommonJS reaches ESM.
 */
function isEsmModuleStatement(statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
    return true;
  }
  if (ts.isExportAssignment(statement)) {
    return true;
  }
  return ts.canHaveModifiers(statement)
    && (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
}

/**
 * Local names bound to a `createRequire(...)` result.
 *
 * Collected in their own pass, because a call through the name may precede the
 * binding in source order and the binding still governs it.
 */
function collectCreatedRequireNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.initializer !== undefined && ts.isCallExpression(node.initializer)) {
      const callee = node.initializer.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (calleeName === 'createRequire') {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

function isCreatedRequireBinding(
  node: ts.Node,
  createdRequireNames: ReadonlySet<string>
): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    && createdRequireNames.has(node.expression.text);
}

function isJsxNode(node: ts.Node): boolean {
  return ts.isJsxElement(node)
    || ts.isJsxSelfClosingElement(node)
    || ts.isJsxFragment(node);
}

/**
 * `@flow` in a leading comment.
 *
 * The reason this column exists is now a RETRACTED measurement, and the column
 * outlives it deliberately. 64 syntactic type annotations were reported, all
 * Flow; the replication corpus measures 0, because all 64 were in one package it
 * does not contain. `js-oracle` kept `SYNTACTIC_FLOW` because the held-back
 * corpus is Flow throughout and was chosen to test exactly this — so the pragma
 * is the evidence that will let that test be read. `ts.createSourceFile` parses Flow
 * into real `.type` nodes where the two grammars overlap and mis-parses silently
 * where they do not, so recording the pragma is what keeps a Flow annotation
 * from being read later as a TypeScript one.
 */
/**
 * Is this file Flow, and therefore out of scope?
 *
 * Two signals, both cheap and both decided before any walking happens:
 * the `@flow` pragma, and the `.js.flow` extension that Flow uses for its
 * declaration files.
 *
 * The extension is checked as well as the pragma because a `.js.flow` file is
 * ENTIRELY type declarations and frequently carries no pragma at all — it does
 * not need one, its name is the declaration.
 *
 * ## `.flowconfig` was considered and REJECTED, with the ratio
 *
 * Recorded because a signal rejected in silence gets proposed again, and this
 * one is the obvious third candidate: Flow's real rule is that an ancestor
 * `.flowconfig` governs, which is how the 12 remaining detection misses — all
 * in one UI library, all carrying NO pragma anywhere in the file — are Flow at all.
 *
 * Measured on a 4,561-file corpus before deciding: it contains exactly **one**
 * `.flowconfig`, under one scaffolding tool's fixture template, and
 * honouring it would decline **85 files to catch 12** — most of the 85 are not
 * Flow. Worse, that library's own subtree carries no `.flowconfig` at all, so it would
 * not catch even those 12.
 *
 * So the detector stays as ruled, and the residue is REPORTED by name instead:
 * `SYNTACTIC_FLOW` is now a detection-miss measure, never a zero-row assertion,
 * because what it counts is a property of the corpus rather than of the parser.
 */
export function isFlowFile(filePath: string, pragmaPresent: boolean): boolean {
  return pragmaPresent || isFlowDeclarationFileName(path.basename(filePath));
}

function hasFlowPragma(sourceText: string): boolean {
  // Bounded to the head: the pragma is a file-level directive by convention and
  // an unbounded search would match the word in any prose comment.
  return /@flow\b/.test(sourceText.slice(0, 2_048));
}

/**
 * A module's `name`: the basename with its JavaScript extension removed.
 *
 * Cutting at the LAST dot gave `a.js` for `a.js.flow` — a name column carrying
 * an extension, and one that would join against nothing.
 */
function stemOf(filePath: string): string {
  return stripJsExtension(path.basename(filePath));
}
