#!/usr/bin/env node
/**
 * RUNTIME ORACLE — instrument a JavaScript project so that executing it records every
 * (caller function -> callee function) pair that actually ran.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * The compiler oracle scores a call SITE against the declaration tsc selected. It has
 * no opinion about a callback handed to `forEach`, a handler fired by `emit`, a `.then`
 * continuation, a `.bind`-ed method or a `.call` through a prototype — the shapes this
 * engine links with `callback_registered` / `event_dispatch` edges. Execution does: if
 * `h` ran because `emit('x')` was called inside `start()`, then `start -> h` is an edge
 * of the real call graph, whatever any static tool says.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 * A syntax-only TypeScript transform (no checker) rewrites every function-like body to
 *
 *     { const __p = __axiom.enter("<file>:<line>:<col>"); try { ...body } finally { __axiom.exit(__p); } }
 *
 * where the id is the function's start position — the same token the parser's js_method
 * row starts at, so the two sides join on (file, line, col). The "current function" lives
 * in an AsyncLocalStorage: `enterWith` at entry, restored at exit, so a promise
 * continuation or a timer callback sees as its caller the function that REGISTERED it —
 * which is exactly what the engine's callback edge claims. Platform frames (`forEach`,
 * the event loop) are transparent: the recorded caller is the last PROJECT function.
 *
 * Each module's top level is entered as "<file>:0:0" (the parser's <module> initializer,
 * keyed apart from a function that starts at 1:1) and exited at the end of the file, so
 * `require` does not leak the child's context. ES modules (`.mjs`, or `.js` under a
 * `"type": "module"` package) get an `import` of the runtime and are entered after their
 * hoisted imports; CommonJS files `require()` it. The runtime is a `.cjs` both can load.
 *
 * Output: <out>/edges.json — [{ caller, callee, n }] plus the set of functions entered.
 *
 * Usage: node instrument.mjs <src-dir> <instrumented-dir> <edges.json>
 *        then: node <instrumented-dir>/<entry>.js
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const INCLUDE_NODE_MODULES = process.argv.includes('--node-modules');
const [srcDir, outDir, edgesPath] = args;
if (!srcDir || !outDir || !edgesPath) { console.error('usage: instrument.mjs <src> <out> <edges.json> [--node-modules]'); process.exit(2); }

const RUNTIME = `
const { AsyncLocalStorage } = require('node:async_hooks');
const __als = new AsyncLocalStorage();
const __regAls = new AsyncLocalStorage();
const __edges = new Map(); const __seen = new Set(); const __registrations = new Map();
const __record = (id) => { const prev = __als.getStore() || '<root>'; __seen.add(id);
  const k = prev + '\\t' + id; __edges.set(k, (__edges.get(k) || 0) + 1);
  // invoked through the wrapper of a function handed over as an argument: every function
  // that handed it over is a REGISTRAR of THIS invocation, recorded beside its natural
  // caller (so a direct call of the same function elsewhere is never excused by it)
  const regs = __regAls.getStore(); if (regs) for (const r of regs) { const rk = prev + '\\t' + r + '\\t' + id; __registrations.set(rk, (__registrations.get(rk) || 0) + 1); }
  return prev; };
// A function value passed as an ARGUMENT is wrapped so that, when it later runs, the
// functions that handed it over are recorded beside the natural caller. The natural caller
// is the async context at entry, which for a callback fired by platform I/O (a stream, a
// socket, a child process) is the function that CREATED the resource, not the one that
// registered the callback; the registration edge is what the engine claims and what the
// scorer accepts when the natural edge is not in the graph. A Proxy keeps length, name,
// prototype, properties and instanceof; one wrapper per function, so removeListener(fn)
// finds what on(fn) stored. Classes are not wrapped (their identity is compared).
const __wrapOf = new WeakMap(); const __regsOf = new WeakMap(); const __origOf = new WeakMap();
const __isClass = (v) => { try { return /^class[\\s{]/.test(Function.prototype.toString.call(v)); } catch { return false; } };
const __cb = (v0) => {
  if (typeof v0 !== 'function' || v0 === __cb) return v0;
  const v = __origOf.get(v0) || v0;
  if (__isClass(v)) return v0;
  const here = __als.getStore() || '<root>';
  let regs = __regsOf.get(v); if (!regs) { regs = new Set(); __regsOf.set(v, regs); }
  regs.add(here);
  let w = __wrapOf.get(v);
  if (!w) {
    w = new Proxy(v, {
      apply(t, thisArg, args) { return __regAls.run(regs, () => Reflect.apply(t, thisArg, args)); },
      construct(t, args, nt) { return __regAls.run(regs, () => Reflect.construct(t, args, nt === w ? t : nt)); },
    });
    __wrapOf.set(v, w); __origOf.set(w, v);
  }
  return w;
};
const __axiom = {
  // run: the body executes inside its own async context, so a promise continuation of the
  // CALLER (after awaiting f) sees the caller again, not f; enterWith would leak f into it.
  // The registrar set is consumed at entry and cleared for the body, so a call made INSIDE
  // the callback is not attributed to the callback's registrars.
  run(id, fn) { __record(id); return __als.run(id, () => __regAls.run(undefined, fn)); },
  // enter/exit: for generators (a yield cannot sit inside the arrow run needs) and module tops.
  enter(id) { const prev = __record(id); __als.enterWith(id); __regAls.enterWith(undefined); return prev; },
  exit(prev) { __als.enterWith(prev); },
  cb: __cb,
};
process.on('exit', () => {
  const out = { functions: [...__seen], edges: [...__edges].map(([k, n]) => { const [caller, callee] = k.split('\\t'); return { caller, callee, n }; }),
    registrations: [...__registrations].map(([k, n]) => { const [caller, registrar, callee] = k.split('\\t'); return { caller, registrar, callee, n }; }) };
  require('node:fs').writeFileSync(${JSON.stringify(path.resolve(edgesPath))}, JSON.stringify(out, null, 1));
});
module.exports = __axiom;
`;

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' && !INCLUDE_NODE_MODULES) continue;
    if (e.name === '.bin' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc); else if (/\.(js|cjs|mjs)$/.test(e.name)) acc.push(p);
    // everything else (package.json, .json, .d.ts) is copied verbatim so `require` resolves
    else acc.push({ copy: p });
  }
  return acc;
}

// The file's module format, decided the way the runtime decides it: the extension, then
// the nearest package.json's "type". An ES module cannot `require()` the runtime and a
// CommonJS one cannot `import` it, so the prelude differs per file; the runtime itself is
// written as `.cjs`, which both formats can load.
const packageTypeCache = new Map();
function packageType(dir) {
  if (packageTypeCache.has(dir)) return packageTypeCache.get(dir);
  let t = null;
  const pj = path.join(dir, 'package.json');
  if (fs.existsSync(pj)) {
    try { t = JSON.parse(fs.readFileSync(pj, 'utf8')).type ?? 'commonjs'; } catch { t = 'commonjs'; }
  } else {
    const parent = path.dirname(dir);
    t = parent === dir ? 'commonjs' : packageType(parent);
  }
  packageTypeCache.set(dir, t);
  return t;
}
function isEsm(file) {
  if (file.endsWith('.mjs')) return true;
  if (file.endsWith('.cjs')) return false;
  return packageType(path.dirname(file)) === 'module';
}
// The module top level is `<file>:0:0` — a position no function can have — so a file
// whose first token opens a function (`export function a()` at 1:1, or `function f()` on
// line 1 of a CommonJS file) does not share the module initializer's key.
const moduleId = (rel) => `${rel}:0:0`;

function instrument(file, rel) {
  const text = fs.readFileSync(file, 'utf8');
  const esm = isEsm(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const pos = (n) => { const lc = sf.getLineAndCharacterOfPosition(n.getStart(sf)); return `${rel}:${lc.line + 1}:${lc.character + 1}`; };
  const f = ts.factory;
  const enterStmt = (id) => f.createVariableStatement(undefined, f.createVariableDeclarationList(
    [f.createVariableDeclaration('__p', undefined, undefined,
      f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('__axiom'), 'enter'), undefined, [f.createStringLiteral(id)]))], ts.NodeFlags.Const));
  const exitStmt = () => f.createExpressionStatement(
    f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('__axiom'), 'exit'), undefined, [f.createIdentifier('__p')]));
  const wrapEnter = (id, stmts) => f.createBlock([enterStmt(id), f.createTryStatement(f.createBlock(stmts, true), undefined, f.createBlock([exitStmt()], true))], true);
  // `return __axiom.run(id, [async] () => { body })` — an arrow keeps this/arguments/super/
  // new.target of the enclosing function, so the body reads unchanged; `await` inside it
  // suspends the INNER context and the caller's continuation keeps its own.
  const wrapRun = (id, stmts, isAsync) => f.createBlock([f.createReturnStatement(
    f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('__axiom'), 'run'), undefined, [
      f.createStringLiteral(id),
      f.createArrowFunction(isAsync ? [f.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined, undefined, [], undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken), f.createBlock(stmts, true))]))], true);
  const isAsyncFn = (n) => !!(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Async);
  // A `var fn` in the body of `function use(fn)` re-declares the PARAMETER in the
  // original — the same binding — but inside the arrow it would be a fresh, undefined
  // binding shadowing the parameter (express's router.use has exactly this shape). Such
  // functions, and generators, use the enter/exit form, which keeps the body in place.
  const paramNames = (node) => { const out = new Set(); const walk = (n) => { if (ts.isIdentifier(n)) out.add(n.text); else ts.forEachChild(n, walk); };
    for (const p of node.parameters) walk(p.name); return out; };
  const redeclaresParam = (node) => {
    const names = paramNames(node); let hit = false;
    const walk = (n) => {
      if (hit) return;
      if (ts.isFunctionLike(n) && n !== node) return;               // a nested function has its own scope
      if (ts.isVariableDeclarationList(n) && !(n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
        for (const d of n.declarations) { const w = (x) => { if (ts.isIdentifier(x)) { if (names.has(x.text)) hit = true; } else ts.forEachChild(x, w); }; w(d.name); }
      }
      if (ts.isFunctionDeclaration(n) && n.name && names.has(n.name.text)) hit = true;
      ts.forEachChild(n, walk);
    };
    if (node.body) ts.forEachChild(node.body, walk);
    return hit;
  };
  const wrapBlock = (id, stmts, node) => (node.asteriskToken || redeclaresParam(node)) ? wrapEnter(id, stmts) : wrapRun(id, stmts, isAsyncFn(node));
  const isRequireLike = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'require' || n.expression.text === '__axiom');
  const mayBeFunction = (a) => !ts.isSpreadElement(a) && !ts.isStringLiteralLike(a) && !ts.isNumericLiteral(a)
    && !ts.isObjectLiteralExpression(a) && !ts.isArrayLiteralExpression(a) && !ts.isTemplateExpression(a)
    && a.kind !== ts.SyntaxKind.TrueKeyword && a.kind !== ts.SyntaxKind.FalseKeyword && a.kind !== ts.SyntaxKind.NullKeyword
    && !(ts.isIdentifier(a) && a.text === 'undefined') && !ts.isRegularExpressionLiteral(a) && !ts.isBinaryExpression(a);

  const transformer = (ctx) => {
    const visit = (node) => {
      node = ts.visitEachChild(node, visit, ctx);
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body) {
        const id = pos(node);
        const body = wrapBlock(id, node.body.statements, node);
        if (ts.isFunctionDeclaration(node)) return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
        if (ts.isFunctionExpression(node)) return f.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
        if (ts.isMethodDeclaration(node)) return f.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, body);
        if (ts.isConstructorDeclaration(node)) return f.updateConstructorDeclaration(node, node.modifiers, node.parameters, body);
        if (ts.isGetAccessorDeclaration(node)) return f.updateGetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, node.type, body);
        if (ts.isSetAccessorDeclaration(node)) return f.updateSetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, body);
      }
      if (ts.isArrowFunction(node)) {
        const id = pos(node);
        const stmts = ts.isBlock(node.body) ? node.body.statements : [f.createReturnStatement(node.body)];
        return f.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, wrapBlock(id, stmts, node));
      }
      // every argument that may be a function value goes through __axiom.cb(...): a literal,
      // a name, a member, a call result (`h.bind(this)`), not a spread and not `require(...)`
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments && node.arguments.length > 0 && !isRequireLike(node)) {
        const wrapped = node.arguments.map((a) => mayBeFunction(a)
          ? f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('__axiom'), 'cb'), undefined, [a]) : a);
        if (ts.isCallExpression(node)) return f.updateCallExpression(node, node.expression, node.typeArguments, wrapped);
        return f.updateNewExpression(node, node.expression, node.typeArguments, wrapped);
      }
      return node;
    };
    return (root) => ts.visitNode(root, visit);
  };
  const result = ts.transform(sf, [transformer]);
  const printer = ts.createPrinter({ removeComments: false });
  const runtimeRel0 = path.relative(path.dirname(path.join(outDir, rel)), path.join(outDir, '__axiom_runtime.cjs')).replace(/\\/g, '/');
  const runtimeRel = runtimeRel0.startsWith('.') ? runtimeRel0 : './' + runtimeRel0;
  const enterModule = `const __p = __axiom.enter(${JSON.stringify(moduleId(rel))});`;
  let out;
  if (esm) {
    // `import` declarations are hoisted and run before anything else in the file, so the
    // module is entered as the first statement AFTER them: the imports of an ES module are
    // its module edges, made while the importer's context is the one that loaded it.
    const stmts = [...result.transformed[0].statements];
    let lastImport = -1;
    stmts.forEach((st, k) => { if (ts.isImportDeclaration(st)) lastImport = k; });
    const printed = stmts.map((st) => printer.printNode(ts.EmitHint.Unspecified, st, result.transformed[0]));
    printed.splice(lastImport + 1, 0, enterModule);
    out = `import __axiom from ${JSON.stringify(runtimeRel)};\n` + printed.join('\n') + '\n';
  } else {
    out = printer.printFile(result.transformed[0]);
    // module top level: enter at the top, exit at the end (a `return` cannot occur at module level)
    const useStrict = /^\s*['"]use strict['"];?/.test(out);
    const prelude = `const __axiom = require(${JSON.stringify(runtimeRel)}); ${enterModule}\n`;
    out = useStrict ? out.replace(/^(\s*['"]use strict['"];?\s*\n?)/, (m) => m + prelude) : prelude + out;
  }
  result.dispose();
  out += `\n__axiom.exit(__p);\n`;
  return out;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '__axiom_runtime.cjs'), RUNTIME);
let n = 0;
let skipped = 0;
for (const entry of walk(srcDir)) {
  const file = typeof entry === 'string' ? entry : entry.copy;
  const rel = path.relative(srcDir, file).replace(/\\/g, '/');
  const dst = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (typeof entry !== 'string') { fs.copyFileSync(file, dst); continue; }
  try { fs.writeFileSync(dst, instrument(file, rel)); n++; }
  catch (e) { fs.copyFileSync(file, dst); skipped++; }
}
if (skipped) console.log(`copied ${skipped} file(s) uninstrumented (transform failed)`);
console.log(`instrumented ${n} file(s) into ${outDir}`);
