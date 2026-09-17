/**
 * GROUND TRUTH for FIELD ACCESS and TYPE USE in one case, from the TypeScript compiler.
 *
 * The compiler answers exactly the question the engine is asked. For `obj.prop`,
 * `checker.getSymbolAtLocation(node.name)` names the declaration the access binds to;
 * for `T` in a type position, the symbol at the entity name names the declaration.
 * Neither is inferred here, and no third-party analyser is involved: the authority is
 * the same one that would reject the program.
 *
 * Labels come from ground-truth/tsc-program.mjs, so a caller and a declaration are named
 * exactly as tools/tsc_oracle_case.mjs names them and the two oracles describe one graph.
 *
 * ── FIELDS ──────────────────────────────────────────────────────────────────
 *     Caller#name(params) READ|WRITE Owner#prop
 *
 * A PROPERTY only. An ACCESSOR is excluded because it is a CALL, which
 * tools/tsc_oracle_case.mjs already scores as a PROPERTY_READ / PROPERTY_WRITE edge; the
 * engine makes the same cut, so each construct is scored once by the side that owns it.
 * A METHOD referenced as a value (`const f = obj.run`) is excluded for the same reason:
 * it is not a data edge.
 *
 * `readwrite` is not a compiler concept. `a.x += 1` reads and then writes, so the oracle
 * emits both rows and the scorer expands the engine's single `readwrite` row into the
 * two. `a.x = v` emits only WRITE, and `a.x++` emits both.
 *
 * ── TYPES ───────────────────────────────────────────────────────────────────
 *     Caller-or-owner-label USES Owner
 *
 * WITHOUT THE CONTEXT, deliberately. `type_use.context` is the parser's own vocabulary
 * (33 values, several of which are type-level constructs with no runtime meaning), and
 * the compiler has no corresponding notion to corroborate it with. What the compiler CAN
 * settle is the claim that matters: does this name, written here, denote that
 * declaration. Scoring the context as well would be scoring the engine against a mapping
 * invented in this file. Java's copy scores the context because a class file records it;
 * TypeScript's cannot, and says so rather than inventing one.
 *
 * usage: node tsc_member_oracle.mjs --fields|--types <src-dir> [lib-dir]
 */
import path from 'node:path';
import { loadProgram } from '../ground-truth/tsc-program.mjs';

const mode = process.argv[2];
if (mode !== '--fields' && mode !== '--types') {
  console.error('usage: tsc_member_oracle.mjs --fields|--types <src-dir> [lib-dir]');
  process.exit(2);
}
const { ts, program, checker, own, labelOf, callerOf, diagnostics } =
  loadProgram(process.argv[3], process.argv[4], 'tsc_member_oracle');

/** The declaration a symbol names, following an import alias to its target. */
function declOf(sym) {
  let s = sym;
  if (s && (s.flags & ts.SymbolFlags.Alias)) {
    try { s = checker.getAliasedSymbol(s); } catch { /* an unresolved import */ }
  }
  return s?.declarations ?? [];
}

const IS_PROPERTY = (d) =>
  ts.isPropertyDeclaration(d) || ts.isPropertySignature(d)
  || (ts.isParameter(d) && ts.canHaveModifiers(d)
      && (ts.getModifiers(d) ?? []).some((m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
        || m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.ReadonlyKeyword))
  || ts.isPropertyAssignment(d) || ts.isShorthandPropertyAssignment(d)
  || ts.isEnumMember(d);

const IS_TYPE_DECL = (d) =>
  ts.isClassDeclaration(d) || ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)
  || ts.isEnumDeclaration(d) || ts.isClassExpression(d);

/** The label of a type declaration: its own name, as `types.qualified_name` prints it. */
function typeLabel(decl) {
  if (decl.name === undefined) return undefined;
  return ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(decl.getSourceFile());
}

/** The declaration whose source contains this node, labelled the way the engine owns it. */
function ownerLabel(node) {
  let p = node.parent;
  while (p && !ts.isSourceFile(p)) {
    if (IS_TYPE_DECL(p)) {
      const n = typeLabel(p);
      if (n !== undefined) return n;
    }
    p = p.parent;
  }
  return callerOf(node).split('#')[0];
}

const rows = new Set();
for (const sf of program.getSourceFiles()) {
  if (!own.has(path.resolve(sf.fileName))) continue;
  const visit = (node) => {
    if (mode === '--fields' && ts.isPropertyAccessExpression(node)) {
      let sym;
      try { sym = checker.getSymbolAtLocation(node.name); } catch { sym = undefined; }
      const decls = declOf(sym);
      // an accessor is a call, and a method read as a value is not a data edge
      const accessor = decls.some((d) => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d));
      const property = decls.filter(IS_PROPERTY);
      if (!accessor && property.length > 0) {
        const parent = node.parent;
        const isLeft = ts.isBinaryExpression(parent) && parent.left === node
          && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
        const plain = isLeft && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        const update = (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
          && (parent.operator === ts.SyntaxKind.PlusPlusToken
              || parent.operator === ts.SyntaxKind.MinusMinusToken);
        const caller = callerOf(node);
        for (const d of property) {
          const target = labelOf(d);
          if (target === undefined) continue;
          // labelOf prints a declaration's parameter list; a property has none, and the
          // engine names it `Owner#prop`, so the empty parens come off.
          const t = target.replace(/\(\)$/, '');
          if (!plain) rows.add(`${caller} READ ${t}`);
          if (isLeft || update) rows.add(`${caller} WRITE ${t}`);
        }
      }
    }
    // A `new C()` NAMES C, and the engine records it as an OBJECT_CREATION_TYPE row. There
    // is no TypeReferenceNode there -- the class is written in an expression position -- so
    // without this branch every construction reads as the engine inventing a use.
    if (mode === '--types' && (ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)
        || ts.isExpressionWithTypeArguments(node) || ts.isNewExpression(node))) {
      const name = ts.isTypeReferenceNode(node) ? node.typeName
        : ts.isImportTypeNode(node) ? node.qualifier
        : node.expression;
      if (name !== undefined) {
        const leaf = ts.isQualifiedName(name) ? name.right : name;
        let sym;
        try { sym = checker.getSymbolAtLocation(leaf); } catch { sym = undefined; }
        for (const d of declOf(sym)) {
          if (!IS_TYPE_DECL(d)) continue;
          const t = typeLabel(d);
          if (t === undefined) continue;
          if (!own.has(path.resolve(d.getSourceFile().fileName))) continue;
          rows.add(`${ownerLabel(node)} USES ${t}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

const diags = diagnostics();
if (diags.length > 0) {
  for (const d of diags.slice(0, 8)) {
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    process.stderr.write(`  tsc: ${d.file.fileName}:${line + 1} `
      + `${ts.flattenDiagnosticMessageText(d.messageText, ' ')}\n`);
  }
  process.stderr.write(`  ${diags.length} diagnostic(s) — the case does not typecheck\n`);
  process.exit(2);
}
for (const r of [...rows].sort()) console.log(r);
