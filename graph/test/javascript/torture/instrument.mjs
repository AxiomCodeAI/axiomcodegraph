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
 * Each module's top level is entered as "<file>:1:1" (the parser's <module> initializer)
 * and exited at the end of the file, so `require` does not leak the child's context.
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

const [,, srcDir, outDir, edgesPath] = process.argv;
if (!srcDir || !outDir || !edgesPath) { console.error('usage: instrument.mjs <src> <out> <edges.json>'); process.exit(2); }

const RUNTIME = `
const { AsyncLocalStorage } = require('node:async_hooks');
const __als = new AsyncLocalStorage();
const __edges = new Map(); const __seen = new Set();
const __record = (id) => { const prev = __als.getStore() || '<root>'; __seen.add(id);
  const k = prev + '\\t' + id; __edges.set(k, (__edges.get(k) || 0) + 1); return prev; };
const __axiom = {
  // run: the body executes inside its own async context, so a promise continuation of the
  // CALLER (after awaiting f) sees the caller again, not f; enterWith would leak f into it.
  run(id, fn) { __record(id); return __als.run(id, fn); },
  // enter/exit: for generators (a yield cannot sit inside the arrow run needs) and module tops.
  enter(id) { const prev = __record(id); __als.enterWith(id); return prev; },
  exit(prev) { __als.enterWith(prev); },
};
process.on('exit', () => {
  const out = { functions: [...__seen], edges: [...__edges].map(([k, n]) => { const [caller, callee] = k.split('\\t'); return { caller, callee, n }; }) };
  require('node:fs').writeFileSync(${JSON.stringify(path.resolve(edgesPath))}, JSON.stringify(out, null, 1));
});
module.exports = __axiom;
`;

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc); else if (/\.(js|cjs|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function instrument(file, rel) {
  const text = fs.readFileSync(file, 'utf8');
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
  const wrapBlock = (id, stmts, node) => node.asteriskToken ? wrapEnter(id, stmts) : wrapRun(id, stmts, isAsyncFn(node));

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
      return node;
    };
    return (root) => ts.visitNode(root, visit);
  };
  const result = ts.transform(sf, [transformer]);
  const printer = ts.createPrinter({ removeComments: false });
  let out = printer.printFile(result.transformed[0]);
  result.dispose();
  // module top level: enter at the top, exit at the end (a `return` cannot occur at module level)
  const useStrict = /^\s*['"]use strict['"];?/.test(out);
  const runtimeRel = path.relative(path.dirname(path.join(outDir, rel)), path.join(outDir, '__axiom_runtime.js')).replace(/\\/g, '/');
  const prelude = `const __axiom = require(${JSON.stringify(runtimeRel.startsWith('.') ? runtimeRel : './' + runtimeRel)}); const __p = __axiom.enter(${JSON.stringify(rel + ':1:1')});\n`;
  out = useStrict ? out.replace(/^(\s*['"]use strict['"];?\s*\n?)/, (m) => m + prelude) : prelude + out;
  out += `\n__axiom.exit(__p);\n`;
  return out;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '__axiom_runtime.js'), RUNTIME);
let n = 0;
for (const file of walk(srcDir)) {
  const rel = path.relative(srcDir, file).replace(/\\/g, '/');
  const dst = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, instrument(file, rel));
  n++;
}
for (const extra of ['package.json']) {
  const p = path.join(srcDir, extra);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(outDir, extra));
}
console.log(`instrumented ${n} file(s) into ${outDir}`);
