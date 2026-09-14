#!/usr/bin/env node
/**
 * THE JAVASCRIPT ORACLE. `checker.getResolvedSignature` from a ts.Program built with
 * `allowJs` + `checkJs` over the project's own .js/.mjs/.cjs/.jsx files.
 *
 * ── WHY THE COMPILER, AND WHAT IT CAN AND CANNOT SAY ────────────────────────
 * Ground truth must come from a different toolchain than the engine: the engine
 * resolves from the parser's IR through Datalog rules, this program resolves from
 * SOURCE through the TypeScript checker, and the two share nothing but the text.
 *
 * JavaScript has no declared types, so the checker INFERS: `const x = require('./y')`
 * is an import, `module.exports = { f }` is an export surface, `new C()` types the
 * variable, `this.x = 1` in a constructor declares a member, `F.prototype.m = ...`
 * declares a method. Where inference reaches, the compiler names one declaration and
 * that is the truth. Where it does not — a callee of type `any` — the checker returns
 * a universal signature with NO declaration, and that site is emitted as `any` and is
 * NOT a truth: the parser's own schema measured that at roughly half of all sites, so
 * the score is computed over the decided half and the undecided half is REPORTED,
 * never folded into either "correct" or "wrong".
 *
 * ── WHAT IT EMITS ───────────────────────────────────────────────────────────
 * One TSV row per call-like node, positions 1-based to match the parser:
 *
 *   callFile callLine callCol callEndLine callEndCol callKind calleeName
 *   targetFile targetLine targetCol targetName targetKind
 *   overloadCount chosenIndex enclLine enclCol enclName
 *
 * targetKind: implementation | bodiless | synthesized | any | unresolved | oracle_error
 *   `bodiless` covers a `.d.ts` declaration (the standard library) — a correct END.
 *   `synthesized` is an implicit constructor: the compiler resolved and there is no
 *   declaration to point at.
 *
 * `require(...)` is NOT a site, by the parser's ruling (it is a module edge), so it is
 * skipped here too; the site universes must agree or nothing downstream joins.
 *
 * ── `.call` / `.apply` / `.bind` ────────────────────────────────────────────
 * The compiler answers `Function.prototype.call` (lib.es5.d.ts), which is true and
 * useless: the function that RUNS is the receiver of `.call`. The parser moves the
 * receiver into argument position (`receiverPosition = FIRST_ARGUMENT`) for exactly
 * this reason, so this oracle reports the call signature of the callee's OBJECT —
 * `f` in `f.call(...)` — as the target. `.bind` produces a function and does not run
 * one, but the declaration it binds is still the only meaningful target to compare.
 *
 * Usage: node tsc-oracle.mjs <project-dir> <out.tsv>
 * Env:   TS_MODULE_PATH — an explicit `typescript` package to load (else the
 *        one this repository depends on).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const projectDir = path.resolve(process.argv[2] ?? '');
const outPath = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  console.error('usage: tsc-oracle.mjs <project-dir> <out.tsv>');
  process.exit(2);
}
const req = createRequire(import.meta.url);
const ts = process.env.TS_MODULE_PATH ? req(process.env.TS_MODULE_PATH) : req('typescript');
if (typeof ts.createProgram !== 'function') {
  console.error(`tsc-oracle: the loaded typescript (${ts.version}) has no createProgram — refusing`);
  process.exit(4);
}

const EXT = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  '.nuxt', '.turbo', '.cache', '.yarn']);
function walk(d, acc) {
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (EXT.has(path.extname(e.name))) acc.push(p);
  }
  return acc;
}
const files = walk(projectDir, []);
if (files.length === 0) { console.error(`no JavaScript under ${projectDir}`); process.exit(2); }

const options = {
  allowJs: true, checkJs: true, noEmit: true, allowNonTsExtensions: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve,
  skipLibCheck: true, resolveJsonModule: true, noImplicitAny: false,
  // A project's own JS is the program; lib.d.ts still loads so builtins have a home.
  // NO @types are picked up implicitly: with `types` unset the compiler includes every
  // package under a node_modules/@types it finds walking UP from the current directory,
  // so the answer for `require('path').join` depended on where the oracle was launched
  // from. Pinned empty; a Node builtin is then `any`, reported as undecided.
  maxNodeModuleJsDepth: 0, types: [], typeRoots: [],
};
const program = ts.createProgram(files, options);
const checker = program.getTypeChecker();

const REAL_ROOT = (() => { try { return fs.realpathSync(projectDir); } catch { return projectDir; } })();
const toPosix = path.sep === '/' ? (p) => p : (p) => p.split(path.sep).join('/');
function relPath(fileName) {
  let real = fileName;
  try { real = fs.realpathSync(fileName); } catch { /* keep */ }
  return toPosix(path.relative(REAL_ROOT, real));
}
function pos(sf, offset) {
  const lc = sf.getLineAndCharacterOfPosition(offset);
  return [lc.line + 1, lc.character + 1];
}
function isRequireCall(n) {
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require'
    && n.arguments.length >= 1;
}
/** The parser's JsCallKind for this node. */
function callKindOf(node) {
  if (ts.isNewExpression(node)) return 'CONSTRUCTOR_CALL';
  if (ts.isTaggedTemplateExpression(node)) return 'TAGGED_TEMPLATE_CALL';
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return 'JSX_COMPONENT_CALL';
  const expr = node.expression;
  if (expr.kind === ts.SyntaxKind.SuperKeyword) return 'SUPER_CALL';
  if (expr.kind === ts.SyntaxKind.ImportKeyword) return 'DYNAMIC_IMPORT_CALL';
  if (ts.isIdentifier(expr) && (expr.text === 'eval')) return 'DYNAMIC_CODE_CALL';
  if (ts.isPropertyAccessExpression(expr)) {
    const m = expr.name.text;
    if (m === 'call') return 'FUNCTION_CALL_CALL';
    if (m === 'apply') return 'FUNCTION_CALL_APPLY';
    if (m === 'bind') return 'FUNCTION_CALL_BIND';
    if (node.questionDotToken || expr.questionDotToken) return 'OPTIONAL_CALL';
    return 'METHOD_CALL';
  }
  if (ts.isElementAccessExpression(expr)) return 'COMPUTED_CALL';
  let inner = expr;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  if (ts.isFunctionExpression(inner) || ts.isArrowFunction(inner)) return 'IIFE_CALL';
  return 'FUNCTION_CALL';
}
function calleeNameOf(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isTaggedTemplateExpression(node)) {
    const t = node.tag;
    return ts.isPropertyAccessExpression(t) ? t.name.text : ts.isIdentifier(t) ? t.text : '';
  }
  const expr = node.expression;
  if (!expr) return '';
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  if (expr.kind === ts.SyntaxKind.SuperKeyword) return 'super';
  return '';
}
function declName(decl) {
  if (!decl) return '';
  if (ts.isConstructorDeclaration(decl)) {
    const parent = decl.parent;
    return parent && parent.name ? `${parent.name.getText()}.constructor` : 'constructor';
  }
  const n = decl.name;
  if (n && ts.isIdentifier(n)) return n.text;
  if (n) return n.getText();
  if (decl.symbol) return decl.symbol.getName();
  return '';
}
function isFunctionLike(n) {
  return ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n)
    || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isFunctionExpression(n)
    || ts.isArrowFunction(n) || ts.isClassStaticBlockDeclaration(n);
}
function enclosingDeclOf(node, sf) {
  for (let n = node.parent; n; n = n.parent) {
    if (isFunctionLike(n)) {
      const [l, c] = pos(sf, n.getStart(sf));
      return [String(l), String(c), declName(n) || '<anonymous>'];
    }
  }
  return ['0', '0', '<module>'];
}
function isBodiless(decl) {
  if (!decl) return true;
  if (decl.getSourceFile().isDeclarationFile) return true;
  if ('body' in decl) return decl.body === undefined;
  return true;
}

const rows = [];
const tally = {};
const bump = (k) => { tally[k] = (tally[k] ?? 0) + 1; };
let jsxSites = 0;

// ONLY THE ROOT FILES ARE THE UNIVERSE. The program also loads whatever the roots
// import — a `.ts` sibling in a mixed repository, a `.d.ts` — and the parser's IR
// holds none of those, so a site in them is not a conservation loss, it is a file
// the JavaScript front end was never asked about.
const ROOT_SET = new Set(files.map((f) => { try { return fs.realpathSync(f); } catch { return f; } }));
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  let realName = sf.fileName;
  try { realName = fs.realpathSync(sf.fileName); } catch { /* keep */ }
  if (!ROOT_SET.has(realName)) continue;
  const rel = relPath(sf.fileName);
  if (rel.startsWith('..')) continue;
  const visit = (node) => {
    // A JSX element is a call to the compiler and NOT a site to the parser: the
    // JavaScript schema has no JSX call kind (JSX_ELEMENT is an expression kind
    // only), so these are counted and left out of the universe rather than scored
    // as conservation loss. The count is printed so the omission is visible.
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      jsxSites += 1;
      ts.forEachChild(node, visit);
      return;
    }
    const isCall = ts.isCallExpression(node) || ts.isNewExpression(node)
      || ts.isTaggedTemplateExpression(node);
    if (isCall && !isRequireCall(node)) {
      const kind = callKindOf(node);
      const [line, col] = pos(sf, node.getStart(sf));
      const [endLine, endCol] = pos(sf, node.getEnd());
      const [enclLine, enclCol, enclName] = enclosingDeclOf(node, sf);
      let targetFile = '', targetLine = '', targetCol = '', targetName = '';
      let targetKind = 'unresolved', overloadCount = '1', chosenIndex = '0';
      try {
        let sig = checker.getResolvedSignature(node);
        let decl = sig?.declaration;
        // `.call`/`.apply`/`.bind`: the function that runs is the RECEIVER of the
        // member call, so answer with its call signature rather than Function's.
        if (kind === 'FUNCTION_CALL_CALL' || kind === 'FUNCTION_CALL_APPLY' || kind === 'FUNCTION_CALL_BIND') {
          const fnType = checker.getTypeAtLocation(node.expression.expression);
          const sigs = fnType.getCallSignatures();
          if (fnType.flags & ts.TypeFlags.Any) { sig = undefined; decl = undefined; targetKind = 'any'; }
          else if (sigs.length >= 1) { sig = sigs[0]; decl = sig.declaration; }
        }
        if (targetKind === 'any') {
          // decided above
        } else if (sig && !decl) {
          const calleeNode = ts.isTaggedTemplateExpression(node) ? node.tag
            : (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) ? node.tagName
            : node.expression;
          const calleeType = checker.getTypeAtLocation(calleeNode);
          if (calleeType.flags & ts.TypeFlags.Any) targetKind = 'any';
          else targetKind = 'synthesized';
        } else if (decl) {
          const dsf = decl.getSourceFile();
          const [dl, dc] = pos(dsf, decl.getStart(dsf));
          // Relative when inside the project (a `.d.ts` beside its `.js` included),
          // absolute for the platform's own declarations.
          const relTarget = relPath(dsf.fileName);
          targetFile = relTarget.startsWith('..') ? dsf.fileName : relTarget;
          targetLine = String(dl);
          targetCol = String(dc);
          targetName = declName(decl);
          targetKind = isBodiless(decl) ? 'bodiless' : 'implementation';
          const decls = decl.symbol?.getDeclarations?.() ?? [];
          if (decls.length > 1) {
            overloadCount = String(decls.length);
            const i = decls.indexOf(decl);
            chosenIndex = i >= 0 ? String(i) : '';
          }
        }
      } catch (e) {
        targetKind = 'oracle_error';
      }
      bump(targetKind);
      rows.push([rel, String(line), String(col), String(endLine), String(endCol), kind,
        calleeNameOf(node).replace(/\t|\n/g, ' '), targetFile, targetLine, targetCol,
        targetName.replace(/\t|\n/g, ' '), targetKind, overloadCount, chosenIndex,
        enclLine, enclCol, enclName.replace(/\t|\n/g, ' ')].join('\t'));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const header = ['callFile', 'callLine', 'callCol', 'callEndLine', 'callEndCol', 'callKind', 'calleeName',
  'targetFile', 'targetLine', 'targetCol', 'targetName', 'targetKind', 'overloadCount', 'chosenIndex',
  'enclLine', 'enclCol', 'enclName'].join('\t');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + '\n' + rows.join('\n') + (rows.length ? '\n' : ''));
const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && !d.file.isDeclarationFile);
console.log(`tsc-oracle: ${files.length} files, ${rows.length} sites, typescript ${ts.version}`);
console.log(`tsc-oracle: ${JSON.stringify(tally)}`);
console.log(`tsc-oracle: ${diags.length} diagnostics in project files; ${jsxSites} JSX element(s) outside the site universe`);
