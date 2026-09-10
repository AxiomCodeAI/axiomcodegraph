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
import { loadTypeScript } from './load-typescript.mjs';

const projectDir = path.resolve(process.argv[2]);
const outPath = path.resolve(process.argv[3]);
if (!projectDir || !outPath) {
  console.error('usage: tsc-oracle.mjs <project-dir> <out.tsv>');
  process.exit(2);
}

// Loaded from the project under analysis, so the oracle speaks the version the
// project is written against; see load-typescript.mjs for the preference order and
// for why an unsupported compiler is a refusal rather than a TypeError (#239).
const ts = loadTypeScript(projectDir, { toolName: 'tsc-oracle' });

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
// ── relPath(sourceFile) — the PARSER's path convention, not ours ─────────────
// The scorer joins the oracle and the IR on (file, line, col, endLine, endCol), and the
// file on the IR side is the parser's `filePath`, which is relative to the project the
// parser discovered — one per workspace package on a monorepo. Emitting paths relative
// to the analysis root instead produced `packages/pkg/src/X.ts` against the IR's
// `src/X.ts`, and the two never joined: 36,500 IR sites, 40,827 oracle sites, ZERO
// matched, which the conservation guard reported as 100% loss.
//
// So the roots the parser actually used are passed in, and each file is emitted relative
// to the LONGEST root that contains it. One normalisation applied to both sides, rather
// than a compensation applied to one.
const ROOTS = (() => {
  const f = process.env.PARSER_PROJECT_ROOTS;
  if (!f) return [];
  try {
    return fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
      .map((p) => fs.realpathSync(p))
      .sort((a, b) => b.length - a.length);
  } catch { return []; }
})();
const REAL_PROJECT_DIR = (() => { try { return fs.realpathSync(projectDir); } catch { return projectDir; } })();
function relPath(fileName) {
  let real = fileName;
  try { real = fs.realpathSync(fileName); } catch { /* keep */ }
  for (const r of ROOTS) {
    const rel = path.relative(r, real);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return path.relative(REAL_PROJECT_DIR, real);
}

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
let rootCount = 0;
let resolvedCount = 0;
let overloadedSites = 0;
let nonFirstOverload = 0;

let diagTotal = 0;
// Rows are keyed by POSITION and de-duplicated across programs: on a workspace repo one
// file can belong to two programs, and the scorer joins on position, so a duplicate row
// would count one call site twice.
const seenPos = new Set();

/**
 * A SOLUTION-STYLE CONFIG DELEGATES ITS FILES, and respecting `files: []` literally
 * yields a program with no roots.
 *
 * The documented layout for a `composite` build puts an empty solution file at the root
 * — `files: []`, `references: [{ path: "./tsconfig.build.json" }, …]` — so the config
 * deliberately contains no files. `parseJsonConfigFileContent` honours that and does not
 * follow the references, and everything downstream is then adjudicated against nothing:
 * 1,571 call sites found by the parser, 0 by the oracle, and three ratios of 0.000
 * printed in the same shape a real run uses. #337.
 *
 * So the references are followed, one level of recursion per reference, and their file
 * names unioned. A reference may itself be a solution file. Cycles are guarded by the
 * seen set, because `composite` projects legitimately reference each other.
 */
function rootsOf(configPath, seen = new Set()) {
  const real = path.resolve(configPath);
  if (seen.has(real)) return { fileNames: [], options: undefined };
  seen.add(real);
  const configFile = ts.readConfigFile(real, ts.sys.readFile);
  if (configFile.error || !configFile.config) return { fileNames: [], options: undefined };
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(real));
  if (parsed.fileNames.length > 0) return { fileNames: parsed.fileNames, options: parsed.options };
  // No files of its own. If it delegates, take what it delegates to.
  const refs = parsed.projectReferences ?? [];
  const names = [];
  let options = parsed.options;
  for (const r of refs) {
    // A reference path may name a directory (implying tsconfig.json) or a file.
    let rp = path.resolve(r.path);
    try { if (fs.statSync(rp).isDirectory()) rp = path.join(rp, 'tsconfig.json'); } catch { /* as given */ }
    const sub = rootsOf(rp, seen);
    if (sub.fileNames.length) {
      names.push(...sub.fileNames);
      // The referenced project's own options are the ones its files were written
      // against; the solution file carries none worth having.
      if (sub.options) options = sub.options;
    }
  }
  return { fileNames: names, options };
}

for (const configPath of configPaths) {
  const resolved = rootsOf(configPath);
  const parsed = resolved.options
    ? resolved
    : ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  rootCount += parsed.fileNames.length;
  checker = program.getTypeChecker();

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  const rel = relPath(sf.fileName);
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
      // A DECORATOR IS POSITIONED AT ITS EXPRESSION, NOT AT THE `@`. The parser emits
      // its DECORATOR_CALL at the callee identifier and this side reported the decorator
      // NODE, which starts one character earlier — so every decorator application in a
      // project disagreed by exactly one column, the scorer's position join missed, and
      // the site was counted as CONSERVATION LOSS: an oracle row with no IR site.
      //
      // That reads as "the parser emits no call site for a decorator", which is true of
      // the BARE form (parser#82) and NOT of the factory form. Measured on a
      // decorator-driven package: 8 of 8 absent oracle sites were DECORATOR_CALL, and
      // every one had an IR DECORATOR_CALL on the same line at column+1 with the same
      // callee name. At that repository's root the same mismatch accounted for 1,143.
      //
      // So the loss was a convention disagreement, not a missing site, and it is fixed
      // on this side because the parser's choice is the more useful one: the identifier
      // is what a reader looks for, and `@` is not part of the callee.
      const posNode = ts.isDecorator(node) ? node.expression : node;
      const [line, col] = pos(sf, posNode.getStart(sf));
      // The END position is part of the key, not decoration. A chained call
      // `a.b().c()` and its inner `a.b()` START at the same character, so
      // (file, line, column) is NOT unique — measured, 14,076 sites collapse to
      // 13,271 distinct start positions. The span is unique; the start is not.
      const [endLine, endCol] = pos(sf, posNode.getEnd());
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

// AFTER the walk, never before. `getSemanticDiagnostics()` forces the checker to
// resolve the whole program, and doing that FIRST changes what
// `getResolvedSignature` returns for some ambiguous sites — measured: on one project
// a `toString()` moved from lib.es5.d.ts:128 to :412 with the engine's answer set
// byte-identical, so the GROUND TRUTH moved and every verdict at that site moved with
// it. Row counts and exit codes were unchanged, which is why an earlier check for
// "unchanged" missed it. Order is load-bearing here.
diagTotal += program.getSemanticDiagnostics().length;

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
// AN ORACLE THAT ADJUDICATED NOTHING MUST REFUSE, NOT REPORT ZERO. The guard below
// fires when the compiler resolved too little; it cannot fire when the compiler was
// asked nothing at all, because `considered` is 0 and the threshold is a floor. So a
// program with no roots — a solution-style config whose references are unresolvable, an
// `include` that matches nothing — exited 0 having judged no site, and the run printed
// `EXACT target 0 0.000`, `coverage 0.000` and `precision 0.000` in the same shape a real
// measurement uses.
//
// Worse than the ratios was the line above them: "0 semantic diagnostics in the program"
// reads as "this project typechecks cleanly" when it means "there is nothing in the
// program to diagnose" — and that line is the harness's own evidence that the oracle may
// be trusted. #337.
//
// The standard is already written in the failure path this misses: "There is no ground
// truth for this project, so no number printed below would be a measurement of anything."
if (considered === 0) {
  console.error(
    `oracle REFUSED: the compiler adjudicated NO call site. Its program has ` +
      `${rootCount} root file(s), so there was nothing to resolve — this is not a weak ` +
      `result, it is no result, and the ratios below it would be shaped like a ` +
      `measurement while measuring nothing. A solution-style root config (files: [], ` +
      `references: [...]) is the usual cause; its references are followed now, so if this ` +
      `still fires the reference targets do not resolve from here. Point the harness at ` +
      `the referenced project directly.`
  );
  process.exit(4);
}

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
