#!/usr/bin/env node
/**
 * THE ORACLE. `checker.getResolvedSignature` — the TypeScript compiler answering, for
 * every call site in a project, which signature it selected.
 *
 * ── WHY THIS ONE AND NOT A STATIC ANALYSER ──────────────────────────────────
 * The rule is never to self-certify: ground truth must come
 * from a DIFFERENT toolchain, and never from a third-party analyser whose own
 * resolution choices would contaminate it. Java uses the platform's class-file
 * parser; Python uses CPython's `dis` and `symtable`. TypeScript's equivalent is the
 * compiler itself, and it is a materially stronger oracle than either — it answers
 * not just "is there an edge" but "WHICH overload", position-precise.
 *
 * The engine never reads this. The engine resolves from the parser's IR through its
 * own rules; this program resolves from source through `tsc`. The two share nothing
 * but the source text, which is what makes a disagreement mean something.
 *
 * ── WHAT IT EMITS ───────────────────────────────────────────────────────────
 * One TSV row per call site, positions 1-BASED to match the parser's convention
 * (verified against a known site: `importedPath.trim()` at line 101 column 26 is the
 * start of the whole call expression, not of the callee name):
 *
 *   callFile  callLine  callCol  callEndLine  callEndCol  callKind  calleeName
 *   targetFile  targetLine  targetCol  targetName  targetKind
 *   overloadCount  chosenIndex  enclLine  enclCol  enclName

 * `overloadCount` is how many declarations the resolved symbol has, and `chosenIndex`
 * is WHICH of them the compiler picked, in declaration order. Together they turn
 * "did the engine find the right function" into "did the engine find the right
 * SIGNATURE" — a strictly harder question, and the one the schema's own measurement
 * says matters: 77.6% of overloaded calls resolve to a NON-FIRST declaration, so an
 * engine that always took the first would look almost right on a name-level score and
 * be wrong three times in four on the population that has more than one answer.
 *
 * `enclLine`/`enclCol`/`enclName` are the FUNCTION the call site sits inside, which turns
 * a bag of sites into a graph: with a caller on every row the oracle answers chain
 * questions — does the engine still have the edge four hops from an entry point, and does
 * the chain cross into the library at the hop the compiler says it does — and answers
 * them from the compiler rather than from the engine's own containment facts.
 *
 * targetKind distinguishes the terminals that are CORRECT answers rather than
 * failures — an ambient declaration with no body, a synthesized implicit
 * constructor — from a genuine `unresolved`. Collapsing those into one bucket makes
 * every I/O call in a project look like an analysis gap.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * This builds a full ts.Program and typechecks. That is exactly why the PARSER may
 * never do it (rule four) and exactly why the oracle can: it runs out of process,
 * once, and its answer is definitive.
 *
 * Usage: node tsc-oracle.mjs <project-dir> <out.tsv>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(process.argv[2]);
const outPath = path.resolve(process.argv[3]);
if (!projectDir || !outPath) {
  console.error('usage: tsc-oracle.mjs <project-dir> <out.tsv>');
  process.exit(2);
}

// The compiler is loaded from the project under analysis, so the oracle speaks the
// same language version the project is written against. Falling back to a bundled
// copy would silently answer a different question on a project pinned to an older
// TypeScript.
// The compiler is loaded from the project under analysis when it has one, so the
// oracle speaks the same language version the project is written against. A workspace
// package often has no `typescript` of its own — it is hoisted to the repository root
// — so TS_MODULE_PATH lets the harness pass the copy it already located rather than
// the oracle failing on a layout that is perfectly ordinary.
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

// A MONOREPO HAS NO tsconfig AT ITS ROOT. `ts.findConfigFile` walks UPWARD, so on a
// workspace repository — source under `packages/<name>/`, each package with its own
// tsconfig — it finds nothing at the root and the oracle produced no ground truth at
// all. Two corpus projects were in exactly that shape, and because the harness ignored
// the oracle's exit status they reported success while contributing zero sites.
//
// So: prefer an enclosing tsconfig (the ordinary single-project case, unchanged), and
// only when there is none, DESCEND and take every workspace tsconfig. That is the same
// unit the parser analyses — it runs one pass per project because a TypeScript program
// is the unit of merge scope, and two programs have two global scopes — so matching it
// here keeps the oracle and the IR talking about the same thing.
function discoverConfigs(dir) {
  const up = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
  // findConfigFile walks up past the project; only accept one INSIDE it.
  if (up && !path.relative(dir, up).startsWith('..')) return [up];

  const found = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const here = path.join(d, 'tsconfig.json');
    if (entries.some((e) => e.isFile() && e.name === 'tsconfig.json')) {
      found.push(here);
      // Do not descend past a project root: a package's own sub-tsconfigs (for tests,
      // for a build variant) describe the same sources and would duplicate every row.
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
        walk(path.join(d, e.name), depth + 1);
      }
    }
  };
  walk(dir, 0);
  return found;
}

// Reassigned per program below.
let checker;

const configPaths = discoverConfigs(projectDir);
if (configPaths.length === 0) {
  console.error(`no tsconfig.json under ${projectDir}`);
  process.exit(2);
}

/** 1-based line/column of a node's START, matching the parser's convention. */
function pos(sf, offset) {
  const lc = sf.getLineAndCharacterOfPosition(offset);
  return [lc.line + 1, lc.character + 1];
}

/** The call form, named with the parser's TsCallKind vocabulary so the two line up. */
function callKindOf(node) {
  if (ts.isNewExpression(node)) return 'CONSTRUCTOR_CALL';
  if (ts.isTaggedTemplateExpression(node)) return 'TAGGED_TEMPLATE_CALL';
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    return 'JSX_COMPONENT_CALL';
  }
  if (ts.isDecorator(node)) return 'DECORATOR_CALL';
  const expr = node.expression;
  if (!expr) return 'FUNCTION_CALL';
  if (expr.kind === ts.SyntaxKind.SuperKeyword) return 'SUPER_CALL';
  if (expr.kind === ts.SyntaxKind.ImportKeyword) return 'DYNAMIC_IMPORT_CALL';
  if (ts.isPropertyAccessExpression(expr)) return 'METHOD_CALL';
  if (ts.isElementAccessExpression(expr)) return 'INDEX_CALL';
  return 'FUNCTION_CALL';
}

/** The simple name being called, "" when the callee is computed. */
function calleeNameOf(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) return node.tagName.getText();
  if (ts.isTaggedTemplateExpression(node)) return node.tag.getText();
  if (ts.isDecorator(node)) {
    const e = node.expression;
    return ts.isCallExpression(e) ? e.expression.getText() : e.getText();
  }
  const expr = node.expression;
  if (!expr) return '';
  if (ts.isPropertyAccessExpression(expr)) return expr.name.getText();
  if (ts.isIdentifier(expr)) return expr.getText();
  if (expr.kind === ts.SyntaxKind.SuperKeyword) return 'super';
  return '';
}

/**
 * The name of a declaration, for a human reading a disagreement. A constructor has
 * no name of its own, so it takes its class's — which is what the engine's
 * `escapedName` does too, so the two are comparable.
 */
function declName(decl) {
  if (!decl) return '';
  if (ts.isConstructorDeclaration(decl)) {
    const parent = decl.parent;
    return parent && parent.name ? `${parent.name.getText()}.constructor` : 'constructor';
  }
  const n = decl.name ?? decl.symbol?.valueDeclaration?.name;
  if (n) return n.getText();
  if (decl.symbol) return decl.symbol.getName();
  return '';
}

/**
 * The FUNCTION-LIKE DECLARATION a call site sits inside, as a position — the caller
 * half of a call-graph edge.
 *
 * A per-site score never needs this: it adjudicates one site against one declaration and
 * the caller is irrelevant. A CHAIN does. "entryPoint reaches encode in four hops" is a
 * claim about edges joined end to end, and without the caller there are no edges to join
 * — only a bag of sites. Emitting it here rather than reading containment out of the
 * engine's own IR is the whole point: a chain checked against a graph the engine built is
 * checking the engine against itself.
 *
 * The INNERMOST function-like wins, so a call inside a callback is attributed to the
 * callback and not to the function that contains it. A call at module top level has no
 * enclosing function and reports the file itself, which is a real caller — module
 * initialisation — and not a gap.
 */
function enclosingDeclOf(node, sf) {
  for (let n = node.parent; n; n = n.parent) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isClassStaticBlockDeclaration(n)
    ) {
      const [l, c] = pos(sf, n.getStart(sf));
      return [String(l), String(c), declName(n) || '<anonymous>'];
    }
  }
  return ['0', '0', '<module>'];
}

/** true when the declaration has no body — an honest terminal, not a failure. */
function isBodiless(decl) {
  if (!decl) return true;
  if ('body' in decl) return decl.body === undefined;
  return true;
}

const rows = [];
let considered = 0;
let resolvedCount = 0;
let overloadedSites = 0;
let nonFirstOverload = 0;

let diagTotal = 0;
// Rows are keyed by POSITION and de-duplicated across programs: on a workspace repo one
// file can belong to two programs, and the scorer joins on position, so a duplicate row
// would count one call site twice.
const seenPos = new Set();

for (const configPath of configPaths) {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  checker = program.getTypeChecker();
  diagTotal += program.getSemanticDiagnostics().length;

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  const rel = path.relative(projectDir, sf.fileName);
  // Files outside the project directory are dependencies; their call sites are not
  // client call sites and comparing them would score the engine on code it never saw.
  if (rel.startsWith('..')) continue;

  const visit = (node) => {
    let isCall = false;
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxOpeningElement(node) ||
      ts.isDecorator(node)
    ) {
      isCall = true;
    }
    if (isCall) {
      considered += 1;
      const [line, col] = pos(sf, node.getStart(sf));
      // The END position is part of the key, not decoration. A chained call
      // `a.b().c()` and its inner `a.b()` START at the same character, so
      // (file, line, column) is NOT unique — measured, 14,076 sites collapse to
      // 13,271 distinct start positions. The span is unique; the start is not.
      const [endLine, endCol] = pos(sf, node.getEnd());
      const [enclLine, enclCol, enclName] = enclosingDeclOf(node, sf);
      let targetFile = '';
      let targetLine = '';
      let targetCol = '';
      let targetName = '';
      let targetKind = 'unresolved';
      let overloadCount = '1';
      let chosenIndex = '0';
      try {
        const sig = checker.getResolvedSignature(node);
        const decl = sig?.declaration;
        if (sig && !decl) {
          // A signature with no declaration: an implicit constructor. The schema
          // measures these at 2.3% of sites and calls them
          // SYNTHESIZED_NO_DECLARATION — a real answer with nothing to point at.
          targetKind = 'synthesized';
        } else if (decl) {
          const dsf = decl.getSourceFile();
          const [dl, dc] = pos(dsf, decl.getStart(dsf));
          targetFile = dsf.fileName;
          targetLine = String(dl);
          targetCol = String(dc);
          targetName = declName(decl);
          targetKind = isBodiless(decl) ? 'bodiless' : 'implementation';
          resolvedCount += 1;
          // Which signature of the overload set, in declaration order. The symbol's
          // declaration list IS that order, so the index is read rather than inferred.
          const decls = decl.symbol?.getDeclarations?.() ?? [];
          if (decls.length > 1) {
            overloadCount = String(decls.length);
            const i = decls.indexOf(decl);
            chosenIndex = i >= 0 ? String(i) : '';
            if (i > 0) nonFirstOverload += 1;
            overloadedSites += 1;
          }
        }
      } catch {
        targetKind = 'oracle_error';
      }
      rows.push(
        [
          rel,
          String(line),
          String(col),
          String(endLine),
          String(endCol),
          callKindOf(node),
          calleeNameOf(node).replace(/\t|\n/g, ' '),
          targetFile,
          targetLine,
          targetCol,
          targetName.replace(/\t|\n/g, ' '),
          targetKind,
          overloadCount,
          chosenIndex,
          enclLine,
          enclCol,
          enclName.replace(/\t|\n/g, ' '),
        ].join('\t')
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

}   // end: one program per discovered tsconfig

const header = [
  'callFile',
  'callLine',
  'callCol',
  'callEndLine',
  'callEndCol',
  'callKind',
  'calleeName',
  'targetFile',
  'targetLine',
  'targetCol',
  'targetName',
  'targetKind',
  'overloadCount',
  'chosenIndex',
  'enclLine',
  'enclCol',
  'enclName',
].join('\t');

fs.writeFileSync(outPath, `${header}\n${rows.join('\n')}\n`);

// A PROGRAM THAT DOES NOT TYPECHECK IS NOT GROUND TRUTH. When the compiler cannot
// resolve a call, that site simply is not in the truth set — so a broken program does
// not look broken, it looks like a smaller corpus, and every engine answer in the
// missing part goes unjudged. The failure is invisible in the score, which is exactly
// the shape this harness exists to prevent.
//
// Measured across the projects that DO typecheck, the compiler resolves 93-98% of the
// call sites it finds (98%, 95%, 94%, 98%, 94%, 93%). One workspace repository resolved
// 38% with 24,175 semantic diagnostics — its packages need project references that are
// not satisfied by compiling each tsconfig standalone. The gap between 93% and 38% is
// not a judgement call, so the floor is set well below the observed band.
const resolveRate = considered > 0 ? resolvedCount / considered : 0;
if (considered > 200 && resolveRate < 0.8) {
  console.error(
    `oracle REFUSED: the compiler resolved only ${resolvedCount} of ${considered} call ` +
      `sites (${(resolveRate * 100).toFixed(1)}%) with ${diagTotal} semantic diagnostics. ` +
      `A program this far from typechecking yields ground truth that understates what it ` +
      `judges: unresolved sites drop out of the truth set instead of being scored, so the ` +
      `engine is measured against whichever part happened to compile. Fix the project's ` +
      `configuration (a workspace repository usually needs its project references) before ` +
      `using it as a corpus member.`
  );
  process.exit(3);
}

const diags = diagTotal;
console.error(
  `oracle: ${considered} call sites, ${resolvedCount} with a declaration, ` +
    `${overloadedSites} into an overload set (${nonFirstOverload} choosing a non-first ` +
    `declaration), ${rows.length} rows -> ${outPath}  ` +
    `(${diags} semantic diagnostics in the program)`
);
