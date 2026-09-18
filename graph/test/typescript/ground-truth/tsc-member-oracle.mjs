/**
 * GROUND TRUTH at PROJECT SCALE for field access and type use, from the compiler.
 *
 * The member counterpart of ground-truth/tsc-oracle.mjs, and it discovers and builds its
 * programs exactly as that file does — a real project's answers depend on its tsconfig
 * chain, its path mappings and its @types, and a directory walk with default options is a
 * different program that does not typecheck. The config discovery and the solution-file
 * delegation are lifted into ground-truth/tsc-projects.mjs so the two oracles cannot come
 * to describe different programs.
 *
 * POSITIONAL, not labelled, for the same reason tsc-oracle.mjs is: at corpus scale a
 * naming convention is a second thing that can disagree, and `file:line:col` cannot.
 *
 *   --fields   accessFile accessLine accessCol direction targetFile targetLine targetName
 *   --types    refFile    refLine    refCol    targetFile targetLine targetName
 *
 * A PROPERTY only on the field side: an accessor is a CALL and tsc-oracle.mjs scores it,
 * and a method read as a value is not a data edge. Both sides emit only targets declared
 * INSIDE the project, because a target in node_modules is one the engine was never given.
 *
 * usage: node tsc-member-oracle.mjs --fields|--types <project-dir> <out.tsv>
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadTypeScript } from './load-typescript.mjs';
import { makeProjects } from './tsc-projects.mjs';

const mode = process.argv[2];
const projectDir = path.resolve(process.argv[3] ?? '.');
const outPath = process.argv[4];
if ((mode !== '--fields' && mode !== '--types') || !outPath) {
  console.error('usage: tsc-member-oracle.mjs --fields|--types <project-dir> <out.tsv>');
  process.exit(2);
}
const ts = loadTypeScript(projectDir, { toolName: 'tsc-member-oracle' });
const { configPaths, programsOf, relPath } = makeProjects(ts, projectDir);
if (configPaths.length === 0) {
  console.error(`no tsconfig.json under ${projectDir}`);
  process.exit(2);
}

const rows = new Set();
let diagTotal = 0;
let siteCount = 0;

const IS_PROPERTY = (d) =>
  ts.isPropertyDeclaration(d) || ts.isPropertySignature(d)
  || (ts.isParameter(d) && ts.canHaveModifiers(d)
      && (ts.getModifiers(d) ?? []).some((m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
        || m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.ReadonlyKeyword))
  || ts.isPropertyAssignment(d) || ts.isShorthandPropertyAssignment(d) || ts.isEnumMember(d);

const IS_TYPE_DECL = (d) =>
  ts.isClassDeclaration(d) || ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)
  || ts.isEnumDeclaration(d) || ts.isClassExpression(d);

for (const program of programsOf()) {
  const checker = program.getTypeChecker();
  const pos = (sf, offset) => {
    const lc = sf.getLineAndCharacterOfPosition(offset);
    return [lc.line + 1, lc.character + 1];
  };
  const declOf = (sym) => {
    let s = sym;
    if (s && (s.flags & ts.SymbolFlags.Alias)) {
      try { s = checker.getAliasedSymbol(s); } catch { /* unresolved import */ }
    }
    return s?.declarations ?? [];
  };
  /** The target's identity, or undefined when it is outside the project. */
  const targetOf = (decl) => {
    const rel = relPath(decl.getSourceFile().fileName);
    if (rel.startsWith('..')) return undefined;
    const [line] = pos(decl.getSourceFile(), decl.getStart(decl.getSourceFile()));
    const name = decl.name === undefined ? '<anon>'
      : ts.isIdentifier(decl.name) ? decl.name.text
      : decl.name.getText(decl.getSourceFile());
    return [rel, line, name];
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = relPath(sf.fileName);
    if (rel.startsWith('..')) continue;
    const visit = (node) => {
      if (mode === '--fields' && ts.isPropertyAccessExpression(node)) {
        siteCount += 1;
        let sym;
        try { sym = checker.getSymbolAtLocation(node.name); } catch { sym = undefined; }
        const decls = declOf(sym);
        const accessor = decls.some((d) => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d));
        const props = decls.filter(IS_PROPERTY);
        if (!accessor && props.length > 0) {
          const parent = node.parent;
          const isLeft = ts.isBinaryExpression(parent) && parent.left === node
            && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
          const plain = isLeft && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
          const update = (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
            && (parent.operator === ts.SyntaxKind.PlusPlusToken
                || parent.operator === ts.SyntaxKind.MinusMinusToken);
          const [l, c] = pos(sf, node.getStart(sf));
          for (const d of props) {
            const t = targetOf(d);
            if (t === undefined) continue;
            if (!plain) rows.add([rel, l, c, 'READ', ...t].join('\t'));
            if (isLeft || update) rows.add([rel, l, c, 'WRITE', ...t].join('\t'));
          }
        }
      }
      if (mode === '--types' && (ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)
          || ts.isExpressionWithTypeArguments(node) || ts.isNewExpression(node))) {
        const nm = ts.isTypeReferenceNode(node) ? node.typeName
          : ts.isImportTypeNode(node) ? node.qualifier
          : node.expression;
        if (nm !== undefined) {
          siteCount += 1;
          const leaf = ts.isQualifiedName(nm) ? nm.right : nm;
          let sym;
          try { sym = checker.getSymbolAtLocation(leaf); } catch { sym = undefined; }
          for (const d of declOf(sym)) {
            if (!IS_TYPE_DECL(d)) continue;
            const t = targetOf(d);
            if (t === undefined) continue;
            const [l, c] = pos(sf, leaf.getStart(sf));
            rows.add([rel, l, c, ...t].join('\t'));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
  // AFTER the walk, never before — see the note in tsc-oracle.mjs: forcing the checker
  // first changes what it answers at some ambiguous sites.
  diagTotal += program.getSemanticDiagnostics().length;
}

const header = mode === '--fields'
  ? ['accessFile', 'accessLine', 'accessCol', 'direction', 'targetFile', 'targetLine', 'targetName'].join('\t')
  : ['refFile', 'refLine', 'refCol', 'targetFile', 'targetLine', 'targetName'].join('\t');
fs.writeFileSync(outPath, `${header}\n${[...rows].sort().join('\n')}\n`);
process.stderr.write(`${mode.slice(2)}: ${rows.size} rows from ${siteCount} sites, `
  + `${configPaths.length} program(s), ${diagTotal} diagnostic(s)\n`);
