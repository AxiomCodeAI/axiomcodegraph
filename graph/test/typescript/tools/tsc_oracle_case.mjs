/**
 * GROUND TRUTH for one case, from the TypeScript compiler itself.
 *
 * `checker.getResolvedSignature(node)` is the compiler answering the exact question
 * the engine is asked: for THIS call, which declaration did I select. It is the same
 * role javac + javap play for the Java suite — an independent authority, never the
 * thing under test restating itself.
 *
 * Emits client->client pairs only, in the label form normalize_edges.py produces, so
 * the two are directly comparable:
 *     <owner>#<name>(<paramTypes>) -> <owner>#<name>(<paramTypes>)
 * The erasure rules are mirrored deliberately: type parameters to `T`, generic
 * arguments dropped, qualified names reduced to their last segment.
 *
 * With a LIBRARY directory, the program spans both trees and the callers are still
 * only the client's. That makes the client->lib edges ground truth too, which is the
 * half of the graph a client-only suite can never check.
 *
 * usage: node tsc_oracle_case.mjs <src-dir> [lib-dir]
 */
import path from 'node:path';
import { loadProgram } from '../ground-truth/tsc-program.mjs';

const {
  ts, program, checker, own, reachable, labelOf, callerOf, diagnostics,
  implicitCtorOwner, labelOfImplicitCtor,
} = loadProgram(process.argv[2], process.argv[3], 'tsc_oracle_case');

const pairs = new Set();
for (const sf of program.getSourceFiles()) {
  if (!own.has(path.resolve(sf.fileName))) continue;
  const visit = (node) => {
    // A DECORATOR APPLICATION IS A CALL, and this side did not think so. The project
    // oracle enumerates `ts.isDecorator` and calls it DECORATOR_CALL; this list omitted
    // it, so the per-case suite was blind to decorators entirely — green on them whatever
    // the engine did, while a project run counted 191 absences on a decorator-driven
    // codebase. No case had ever used a decorator, so nothing caught the disagreement.
    // Whichever side is right, both must say it, and the compiler settles it: it resolves
    // the application, because a decorator is a function invoked with (target, key,
    // descriptor). #233.
    if (ts.isCallExpression(node) || ts.isNewExpression(node)
      || ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)
      || ts.isTaggedTemplateExpression(node) || ts.isDecorator(node)) {
      let sig;
      try { sig = checker.getResolvedSignature(node); } catch { sig = undefined; }
      let decl = sig?.declaration;
      // AN IMPLICIT CONSTRUCTOR HAS NO DECLARATION. `new Bag()` on a class that
      // declares no constructor anywhere in its chain resolves to a signature whose
      // `declaration` is undefined, so the site was silently unscored — and the
      // engine's answer for it, whatever it was, went unchecked. The parser now
      // synthesises that constructor on the ROOT class of the `extends` chain (the
      // one that extends nothing; a subclass runs its base's), so the compiler side
      // names the same declaration: the root class, labelled as its `<new>`. #583.
      let target;
      if (decl === undefined && ts.isNewExpression(node)) {
        const cls = implicitCtorOwner(node);
        target = cls === undefined ? undefined : labelOfImplicitCtor(cls);
      } else {
        target = labelOf(decl);
      }
      if (target !== undefined) pairs.add(`${callerOf(node)} -> ${target}`);
    }
    // AN ACCESSOR IS INVOKED BY THE ACCESS. `c.req.url` runs `get url()` and `c.res = r`
    // runs `set res(v)`, and the compiler knows which declaration each is: the symbol at
    // the property name carries the get and set declarations. A read names the getter; an
    // assignment target names the setter; a compound assignment or an update (`x.n += 1`,
    // `x.n++`) reads then writes and names both. The engine emits these as PROPERTY_READ /
    // PROPERTY_WRITE edges (#703), and without this they would be unscored extras: the
    // one shape whose ground truth is the compiler's and was never asked of it.
    if (ts.isPropertyAccessExpression(node)) {
      let sym;
      try { sym = checker.getSymbolAtLocation(node.name); } catch { sym = undefined; }
      if (sym && (sym.flags & ts.SymbolFlags.Alias)) sym = checker.getAliasedSymbol(sym);
      if (sym && (sym.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor))) {
        const parent = node.parent;
        const isLeft = ts.isBinaryExpression(parent) && parent.left === node
          && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
        const plain = isLeft && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        const update = (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
          && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken);
        const reads = !plain;
        const writes = isLeft || update;
        for (const d of sym.declarations ?? []) {
          if ((reads && ts.isGetAccessorDeclaration(d)) || (writes && ts.isSetAccessorDeclaration(d))) {
            const target = labelOf(d);
            if (target !== undefined) pairs.add(`${callerOf(node)} -> ${target}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

const diags = diagnostics();
if (diags.length > 0) {
  // A case that does not typecheck has an unreliable oracle: the checker still
  // answers, but it answers about a program the author did not mean to write.
  for (const d of diags.slice(0, 8)) {
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    process.stderr.write(`  tsc: ${path.relative(root, d.file.fileName)}:${line + 1} `
      + `${ts.flattenDiagnosticMessageText(d.messageText, ' ')}\n`);
  }
  process.stderr.write(`  ${diags.length} diagnostic(s) — the case does not typecheck\n`);
  process.exit(2);
}
for (const p of [...pairs].sort()) console.log(p);
