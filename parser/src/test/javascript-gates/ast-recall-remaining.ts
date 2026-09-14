/**
 * AST RECALL FOR THE NINE RELATIONS THE FIRST HARNESS DOES NOT WALK.
 *
 *     npx tsx src/test/javascript-gates/ast-recall-remaining.ts <corpus-root>
 *
 * `src/test/javascript-gates/ast-recall.ts` walks six of the fifteen non-module
 * relations: expressions, blocks, variables, methods, types and call sites. This
 * completes it across the other nine - imports, exports, fields, comments,
 * scopes, method parameters, type heritages, type references and parse gaps.
 *
 * Same method, deliberately: walk `ts.createSourceFile`'s AST, take each node's
 * position, ask whether the fact base has a row there. Positional because a
 * position join shares no code with the extractor and so cannot agree with it by
 * construction.
 *
 * ## WHY THIS MATTERS AND IS NOT A NEW FRONT
 *
 * A non-unique key has three symptoms: the row DOUBLES (a PK gate sees it), a
 * link goes NULL (the order-bias sweep sees it), or the ROW IS OVERWRITTEN -
 * fewer rows, no null to find. The third is visible only as a recall miss, and
 * it was covered for six relations and silent for nine.
 *
 * ## THE RULE THIS MEASURE IS BUILT UNDER
 *
 * I have encoded my model of the schema and reported the parser wrong three
 * times: OPTIONAL as a kind when it is a column, MEMBER_ACCESS against a schema
 * with PROPERTY_ACCESS, and a parenthesised callee called an IIFE. So every
 * expectation here is either UNAMBIGUOUS - a ParameterDeclaration must produce a
 * parameter row, a parse diagnostic must produce a gap row - or it is not
 * asserted at all. Anything softer is counted under MEASURE and printed
 * separately, because a measure's own assumption is not a defect.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const CORPUS: string = process.argv[2] ?? '';
if (CORPUS === '') {
  console.error('usage: ast-recall-remaining.ts <corpus-root>');
  process.exit(1);
}
const OUT: string = process.argv[3] ?? '';
if (OUT === '') {
  console.error('usage: ast-recall-remaining.ts <corpus-root> <sweep-out-dir-for-that-corpus>');
  process.exit(1);
}

const key = (line: number, col: number): string => `${line}:${col}`;

interface Bucket { expected: number; found: number; missing: Map<string, number>; excluded: Map<string, number>; ex: string[] }
const mk = (): Bucket => ({ expected: 0, found: 0, missing: new Map(), excluded: new Map(), ex: [] });

/** relation file -> file path -> set of "line:col", or "line:*" where the
 * relation carries no startColumn. */
const index = new Map<string, Map<string, Set<string>>>();
const lineOnlyRelations = new Set<string>();
const provByFile = new Map<string, string>();

function loadFactBase(outDir: string): void {
  const modText = fs.readFileSync(path.join(outDir, 'all-javascript-modules.csv'), 'utf8');
  const mnl = modText.indexOf(NL);
  const mh = modText.slice(0, mnl).split(TAB);
  const iPk = mh.indexOf('jsModuleUniqueHash');
  const iPath = mh.indexOf('filePath');
  const iProv = mh.indexOf('sourceProvenance');
  const fileByModule = new Map<string, string>();
  for (const l of modText.slice(mnl + 1).split(NL)) {
    if (l === '') { continue; }
    const c = l.split(TAB);
    fileByModule.set(c[iPk]!, c[iPath]!);
    provByFile.set(c[iPath]!, c[iProv]!);
  }
  for (const f of fs.readdirSync(outDir)) {
    if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) { continue; }
    const p = path.join(outDir, f);
    if (fs.statSync(p).size === 0) { index.set(f, new Map()); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const nl = t.indexOf(NL);
    const h = t.slice(0, nl).split(TAB);
    const iOwner = h.indexOf('ownerModuleLinkHash');
    const iLine = h.indexOf('startLine');
    const iCol = h.indexOf('startColumn');
    // `js_type_heritage` and `js_module` carry startLine and NO startColumn.
    // Requiring all three silently produced an EMPTY index for heritage, so every
    // lookup missed and the relation scored 0 of 1,122 — a broken measure reading
    // as a total defect. Line-only relations are matched on the line.
    const lineOnly = iCol < 0;
    if (lineOnly) { lineOnlyRelations.add(f); }
    const byFile = new Map<string, Set<string>>();
    if (iOwner >= 0 && iLine >= 0) {
      for (const l of t.slice(nl + 1).split(NL)) {
        if (l === '') { continue; }
        const c = l.split(TAB);
        const file = fileByModule.get(c[iOwner] ?? '');
        if (file === undefined) { continue; }
        let s = byFile.get(file);
        if (s === undefined) { s = new Set(); byFile.set(file, s); }
        s.add(lineOnly ? `${Number(c[iLine])}:*` : key(Number(c[iLine]), Number(c[iCol])));
      }
    }
    index.set(f, byFile);
  }
}

const has = (relFile: string, file: string, k: string): boolean =>
  index.get(relFile)?.get(file)?.has(k) === true;

const buckets: Record<string, Bucket> = {
  'parameters      -> js_method_parameter': mk(),
  'comments        -> js_comment': mk(),
  'parse gaps      -> js_parse_gap': mk(),
  'class fields    -> js_field': mk(),
  'heritage        -> js_type_heritage': mk(),
  'import decls    -> js_import': mk(),
  'export decls    -> js_export': mk(),
  'jsdoc types     -> js_type_reference': mk(),
  'jsdoc imports   -> js_import': mk(),
  'scopes          -> js_scope': mk(),
};
const REL: Record<string, string> = {
  'parameters      -> js_method_parameter': 'all-javascript-method-parameters.csv',
  'comments        -> js_comment': 'all-javascript-comments.csv',
  'parse gaps      -> js_parse_gap': 'all-javascript-parse-gaps.csv',
  'class fields    -> js_field': 'all-javascript-fields.csv',
  'heritage        -> js_type_heritage': 'all-javascript-type-heritages.csv',
  'import decls    -> js_import': 'all-javascript-imports.csv',
  'export decls    -> js_export': 'all-javascript-exports.csv',
  'jsdoc types     -> js_type_reference': 'all-javascript-type-references.csv',
  'jsdoc imports   -> js_import': 'all-javascript-imports.csv',
  'scopes          -> js_scope': 'all-javascript-scopes.csv',
};

/** The callable a JSDoc block on `host` documents, by the host walk the parser uses. */
function callableDocumentedBy(host: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isFunctionLike(host)) { return host; }
  if (ts.isVariableStatement(host)) {
    const d = host.declarationList.declarations[0];
    if (d?.initializer !== undefined && ts.isFunctionLike(d.initializer)) { return d.initializer; }
  }
  if (ts.isExpressionStatement(host) && ts.isBinaryExpression(host.expression)
    && ts.isFunctionLike(host.expression.right)) { return host.expression.right; }
  if (ts.isPropertyAssignment(host) && ts.isFunctionLike(host.initializer)) { return host.initializer; }
  if (ts.isPropertyDeclaration(host) && host.initializer !== undefined && ts.isFunctionLike(host.initializer)) {
    return host.initializer;
  }
  if (ts.isParenthesizedExpression(host) && ts.isFunctionLike(host.expression)) { return host.expression; }
  return undefined;
}

/**
 * Tags the fact base does not turn into a type reference, BY RULING (#170):
 * the reason is the label, and a new absence needs a reason here.
 */
function namedAbsence(host: ts.Node, tag: ts.JSDocTag): string | undefined {
  if (ts.isJSDocParameterTag(tag)) {
    // The compiler types from the LAST block on a host; a @param in an older
    // block above it is documentation the compiler does not read.
    const blocks = (host as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [];
    if (blocks.length > 1 && !((blocks[blocks.length - 1]!.tags ?? []) as readonly ts.JSDocTag[]).includes(tag)) {
      return "a @param in an older block: the compiler reads a host's last block";
    }
    const fn = callableDocumentedBy(host);
    if (fn === undefined) {
      if (ts.isClassLike(host)) {
        return '@param on a class, documenting its constructor: a JSDoc convention the compiler does not honour';
      }
      return '@param on a host with no parameters: nothing in the program is the parameter';
    }
    if (!ts.isIdentifier(tag.name)) {
      // DOTTED — `ctx.model`. The compiler nests it under its parent tag ONLY
      // when the parent's type is a plain `Object`/`object`; then it is a child
      // row of the parent's tree and is owed. Otherwise (`?Object`, `Foo`, or no
      // parent tag, or a parent that names no parameter) it is a member's type
      // with no path column to say which member: a named absence.
      let root: ts.Node = tag.name;
      while (ts.isQualifiedName(root)) { root = root.left; }
      const rootName = ts.isIdentifier(root) ? root.text : '';
      if (!fn.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === rootName)) {
        return 'dotted @param whose root names no parameter of the callable';
      }
      const parentTag = (tag.parent as ts.Node | undefined);
      if (parentTag !== undefined && ts.isJSDocTypeLiteral(parentTag)) { return undefined; }
      return 'dotted @param whose parent type is not a plain Object: a member\'s type with no path column';
    }
    const name = tag.name.text;
    if (fn.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === name)) { return undefined; }
    if (fn.parameters.some((q) => !ts.isIdentifier(q.name))) {
      return '@param naming a KEY of a destructured parameter: a pattern member\'s type, which the reference row cannot say which member it is (needs a path column)';
    }
    return '@param naming a parameter the callable does not have: the comment contradicts the code';
  }
  if (ts.isJSDocReturnTag(tag)) {
    if (callableDocumentedBy(host) === undefined && !ts.isClassLike(host)) {
      return '@returns on a host with no callable: nothing in the program returns';
    }
    // Several @returns on one callable — a second tag, or an older block left
    // above a newer one: the compiler's getJSDocReturnTag picks ONE, and the
    // parser emits that one. The others are contradictory documentation.
    const fn = callableDocumentedBy(host);
    if (fn !== undefined && ts.getJSDocReturnTag(fn) !== tag) {
      return 'a @returns the compiler does not pick (another block or tag on the same callable wins)';
    }
  }
  if (ts.isJSDocTypeTag(tag)) {
    if (ts.isFunctionDeclaration(host) || ts.isMethodDeclaration(host) || ts.isClassLike(host)) {
      return '@type on a function, method or class declaration: the callable\'s whole type, for which no owner/context pair exists (ruled a named absence, revisitable)';
    }
    if (ts.isExpressionStatement(host) && ts.isCallExpression(host.expression)) {
      return '@type on a call statement: attaches to nothing the parser can type (§3.14.1 control 5d)';
    }
    if ((ts.isFunctionExpression(host) || ts.isArrowFunction(host)) && host.parent !== undefined
      && !ts.isParenthesizedExpression(host.parent)) {
      return '@type before an unparenthesised function expression: asserts nothing to the compiler (§3.14.1)';
    }
  }
  if (ts.isJSDocThisTag(tag) && callableDocumentedBy(host) === undefined) {
    return '@this on a host with no callable: nothing in the program binds this';
  }
  if (ts.isJSDocTypedefTag(tag) && tag.name === undefined) {
    return 'a nameless @typedef: malformed, declares no type';
  }
  if ((ts.isJSDocTypedefTag(tag) || ts.isJSDocCallbackTag(tag)) && tag.name !== undefined) {
    // One type row per name: a @typedef naming a class or constructor function
    // that exists in syntax yields to the syntax row, and a second @typedef of
    // the same name (the same block pasted above two functions) is a
    // re-declaration. Neither mints a second type or its tree.
    const sf = tag.getSourceFile();
    const name = tag.name.getText(sf);
    let syntaxDeclared = false; let earlierTypedef = false;
    const scan = (m: ts.Node): void => {
      if ((ts.isClassLike(m) || ts.isFunctionDeclaration(m)) && m.name !== undefined
        && m.name.getText(sf) === name) { syntaxDeclared = true; }
      for (const d of (m as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []) {
        for (const t of d.tags ?? []) {
          if (t !== tag && t.pos < tag.pos && (ts.isJSDocTypedefTag(t) || ts.isJSDocCallbackTag(t))
            && t.name !== undefined && t.name.getText(sf) === name) { earlierTypedef = true; }
        }
      }
      ts.forEachChild(m, scan);
    };
    scan(sf);
    if (syntaxDeclared) { return 'a @typedef naming a type that also exists in syntax: the syntax row wins'; }
    if (earlierTypedef) { return 'a @typedef re-declaring an earlier @typedef of the same name: one type row'; }
  }
  if (ts.isJSDocTypeTag(tag) && (ts.isForOfStatement(host) || ts.isForInStatement(host) || ts.isForStatement(host))) {
    return '@type on a for statement: the compiler ignores it (getJSDocType is undefined for the loop variable)';
  }
  if (ts.isJSDocEnumTag(tag)) {
    return '@enum: a JSDoc type declaration with no owner/context pair (revisitable)';
  }
  return undefined;
}

function expect(b: string, file: string, sf: ts.SourceFile, pos: number, kind: string, text: string): void {
  const bk = buckets[b]!;
  const lc = sf.getLineAndCharacterOfPosition(pos);
  const relFile = REL[b]!;
  const k = lineOnlyRelations.has(relFile) ? `${lc.line + 1}:*` : key(lc.line + 1, lc.character + 1);
  bk.expected += 1;
  if (has(relFile, file, k)) { bk.found += 1; return; }
  bk.missing.set(kind, (bk.missing.get(kind) ?? 0) + 1);
  if (bk.ex.length < 4) {
    bk.ex.push(`${file}:${lc.line + 1}:${lc.character + 1}  ${kind}  ${text.slice(0, 58).replace(/\s+/g, ' ')}`);
  }
}

function walkFile(abs: string, rel: string): void {
  const src = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true,
    path.extname(abs) === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS);

  // --- parse gaps: every parse diagnostic MUST have a gap row at its position.
  // Internal property, read through a cast — the same way the parser's own
  // parseDiagnosticsOf reads it; there is no Program to ask.
  for (const d of (sf as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics) {
    if (d.start === undefined) { continue; }
    expect('parse gaps      -> js_parse_gap', rel, sf, d.start, 'ParseDiagnostic',
      String(ts.flattenDiagnosticMessageText(d.messageText, ' ')));
  }

  // --- comments: every comment range, leading and trailing, at every token.
  const seen = new Set<number>();
  const noteComments = (atPos: number): void => {
    for (const r of [...(ts.getLeadingCommentRanges(src, atPos) ?? []),
                     ...(ts.getTrailingCommentRanges(src, atPos) ?? [])]) {
      if (seen.has(r.pos)) { continue; }
      seen.add(r.pos);
      expect('comments        -> js_comment', rel, sf, r.pos, 'CommentRange', src.slice(r.pos, r.end));
    }
  };

  const visit = (n: ts.Node): void => {
    noteComments(n.getFullStart());

    // --- parameters: unambiguous. Every ParameterDeclaration is a parameter row.
    if (ts.isParameter(n)) {
      // A PARAMETER INSIDE A TYPE IS NOT A PARAMETER. `ts.isParameter` matches
      // the `props` in a Flow function TYPE `(props: Props) => Node`, which
      // declares nothing and binds nothing. Asking for those scored 11 phantom
      // misses in the Flow files that leaked the detector.
      let inType = false;
      for (let a: ts.Node | undefined = n.parent; a !== undefined; a = a.parent) {
        if (ts.isTypeNode(a)) { inType = true; break; }
        if (ts.isSourceFile(a) || ts.isBlock(a)) { break; }
      }
      if (!inType) {
        expect('parameters      -> js_method_parameter', rel, sf, n.getStart(sf), 'Parameter', n.getText(sf));
      }
    }
    // --- class fields: a PropertyDeclaration in a class body is a field.
    if (ts.isPropertyDeclaration(n)) {
      expect('class fields    -> js_field', rel, sf, n.getStart(sf), 'PropertyDeclaration', n.getText(sf));
    }
    // --- heritage: an ExtendsKeyword heritage clause is an inheritance edge.
    if (ts.isHeritageClause(n) && n.token === ts.SyntaxKind.ExtendsKeyword) {
      for (const e of n.types) {
        expect('heritage        -> js_type_heritage', rel, sf, e.getStart(sf), 'HeritageClause', e.getText(sf));
      }
    }
    // --- import/export DECLARATIONS only. The expression-borne forms
    //     (`require`, `module.exports =`) are positioned at the BINDING, which
    //     this measure would have to model - so they are excluded rather than
    //     guessed at. Declaration forms are unambiguous.
    // ONE ROW PER BINDING, and the position differs by binding form - read off
    // the fact base rather than assumed, after asking for the declaration start
    // scored 53 of 95. A DEFAULT or NAMESPACE binding is positioned at the
    // DECLARATION; a NAMED specifier is positioned at the SPECIFIER.
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      if (c === undefined) {
        expect('import decls    -> js_import', rel, sf, n.getStart(sf), 'SideEffectImport', n.getText(sf));
      } else {
        if (c.name !== undefined) {
          expect('import decls    -> js_import', rel, sf, n.getStart(sf), 'DefaultImport', n.getText(sf));
        }
        const b = c.namedBindings;
        if (b !== undefined && ts.isNamespaceImport(b)) {
          expect('import decls    -> js_import', rel, sf, n.getStart(sf), 'NamespaceImport', n.getText(sf));
        }
        if (b !== undefined && ts.isNamedImports(b)) {
          for (const el of b.elements) {
            expect('import decls    -> js_import', rel, sf, el.getStart(sf), 'NamedImport', el.getText(sf));
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(n)) {
      expect('import decls    -> js_import', rel, sf, n.getStart(sf), 'ImportEquals', n.getText(sf));
    }
    if (ts.isExportDeclaration(n)) {
      const c = n.exportClause;
      if (c !== undefined && ts.isNamedExports(c)) {
        for (const el of c.elements) {
          expect('export decls    -> js_export', rel, sf, el.getStart(sf), 'NamedExport', el.getText(sf));
        }
      } else {
        expect('export decls    -> js_export', rel, sf, n.getStart(sf), 'ExportStar', n.getText(sf));
      }
    }
    if (ts.isExportAssignment(n)) {
      expect('export decls    -> js_export', rel, sf, n.getStart(sf), 'ExportAssignment', n.getText(sf));
    }
    // --- scopes: constructs that certainly open one.
    if (ts.isSourceFile(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
        || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n)
        || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isCatchClause(n)
        || ts.isClassStaticBlockDeclaration(n)) {
      expect('scopes          -> js_scope', rel, sf, n.getStart(sf), ts.SyntaxKind[n.kind],
        n.getText(sf).slice(0, 40));
    }
    // --- jsdoc types: a tag carrying a TYPE EXPRESSION should reach a reference.
    const jsDoc = (n as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
    if (jsDoc !== undefined) {
      for (const doc of jsDoc) {
        for (const tag of doc.tags ?? []) {
          // --- the `@import` tag (#621): one js_import row per bound name, at the name.
          if (ts.isJSDocImportTag(tag)) {
            const clause = tag.importClause;
            if (clause?.name !== undefined) {
              expect('jsdoc imports   -> js_import', rel, sf, clause.name.getStart(sf), 'ImportTag@import', tag.getText(sf));
            }
            const b = clause?.namedBindings;
            if (b !== undefined && ts.isNamespaceImport(b)) {
              expect('jsdoc imports   -> js_import', rel, sf, b.name.getStart(sf), 'ImportTag@import', tag.getText(sf));
            }
            if (b !== undefined && ts.isNamedImports(b)) {
              for (const el of b.elements) {
                expect('jsdoc imports   -> js_import', rel, sf, el.getStart(sf), 'ImportTag@import', el.getText(sf));
              }
            }
            continue;
          }
          const te = (tag as unknown as { typeExpression?: ts.Node }).typeExpression;
          if (te === undefined) { continue; }
          // POSITION IS THE TYPE EXPRESSION, NOT THE TAG. Asking for the tag's
          // position scored 0.0% of 165 on a 12-file CommonJS package while all 165 rows existed at
          // `{String}` rather than at `@param`. That is the fourth time in this
          // workstream a measure encoded my model of the schema instead of the
          // schema; the guard below is the one that would have caught it.
          // The row sits on the TYPE NAME inside the braces. `{String}` at
          // column 11 produces a row at column 12. Asking for the tag scored
          // 0/165 and asking for the brace scored 1/165; both were my measure.
          // A @callback's type expression is a JSDocSignature, whose `.type`
          // is the @returns TAG, not a type node; the row sits at the signature.
          const inner = ts.isJSDocSignature(te) ? undefined : (te as unknown as { type?: ts.Node }).type;
          // NAMED ABSENCES (#170, ruled 2026-09-13): tags whose type the fact
          // base deliberately does not carry, because nothing in the program
          // is what the tag says it is about. Counted under their reason so
          // the number above is over what is owed, and the reasons are listed.
          const absence = namedAbsence(n, tag);
          if (absence !== undefined) {
            const bk = buckets['jsdoc types     -> js_type_reference']!;
            bk.excluded.set(absence, (bk.excluded.get(absence) ?? 0) + 1);
          } else {
            expect('jsdoc types     -> js_type_reference', rel, sf, (inner ?? te).getStart(sf),
              'JSDoc@' + tag.tagName.text, tag.getText(sf));
          }
          // --- jsdoc import types (§3.8.1, 2026-09-13): every `import('x').T` inside a
          // JSDoc type expression is an edge, and the schema gives it a js_import row
          // (importForm JSDOC_IMPORT_TYPE, edgeBearer COMMENT) positioned at the
          // ImportTypeNode. Nested ones — `Array<import('x').T>` — are each a row.
          const importTypes = (node: ts.Node): void => {
            if (ts.isImportTypeNode(node)) {
              expect('jsdoc imports   -> js_import', rel, sf, node.getStart(sf), 'ImportType@' + tag.tagName.text, node.getText(sf));
            }
            ts.forEachChild(node, importTypes);
          };
          importTypes(te);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------
function main(): void {
  loadFactBase(OUT);
  const EXT = new Set(['.js', '.mjs', '.cjs', '.jsx']);
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage',
    '.next', '.nuxt', '.turbo', '.cache', '.yarn']);
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) { continue; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); } else if (EXT.has(path.extname(e.name))) { files.push(p); }
    }
  };
  walk(CORPUS);

  let analysed = 0; let skipped = 0;
  for (const abs of files) {
    const rel = path.relative(path.resolve(CORPUS), abs);
    // Bundled, Flow-excluded and generated files contribute to no denominator by
    // rule; counting them would measure the exclusion.
    const prov = provByFile.get(rel);
    if (prov !== 'PROJECT') { skipped += 1; continue; }
    analysed += 1;
    walkFile(abs, rel);
  }

  console.log(`AST RECALL, REMAINING RELATIONS - ${analysed} PROJECT files of ${files.length}`
    + ` (${skipped} non-PROJECT, excluded by rule)`);
  console.log('='.repeat(78));
  for (const [name, b] of Object.entries(buckets)) {
    const rate = b.expected === 0 ? 'n/a' : (100 * b.found / b.expected).toFixed(1) + '%';
    console.log(`  ${name.padEnd(40)} ${String(b.found).padStart(8)} / ${String(b.expected).padStart(8)}  ${rate.padStart(7)}`);
    const miss = [...b.missing].sort((a, c) => c[1] - a[1]);
    if (miss.length > 0) {
      console.log(`      missing: ${miss.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    for (const [reason, count] of [...b.excluded.entries()].sort((x, y) => y[1] - x[1])) {
      console.log(`      named absence (${count}): ${reason}`);
    }
  }
  const empty = Object.entries(buckets).filter((e) => e[1].expected === 0).map((e) => e[0]);
  if (empty.length > 0) {
    console.log(`\nZERO DENOMINATOR - not measured, not clean: ${empty.join(', ')}`);
  }
  // ZERO NUMERATOR OVER A REAL DENOMINATOR is not a 100% miss rate, it is a
  // measure asking the wrong POSITION. A parser that emitted none of a relation
  // would fail twenty other checks first. Treated as a broken measure, loudly.
  const zero = Object.entries(buckets).filter((e) => e[1].expected > 0 && e[1].found === 0);
  if (zero.length > 0) {
    console.log('');
    for (const [name, b] of zero) {
      console.log(`BROKEN MEASURE - ${name} found 0 of ${b.expected}. A rate of exactly 0% over a real`);
      console.log('  denominator means the position convention is wrong, not that every row is absent.');
    }
    process.exit(1);
  }
  console.log('\nEXAMPLES');
  for (const [name, b] of Object.entries(buckets)) {
    if (b.ex.length === 0) { continue; }
    console.log(`  ${name}`);
    for (const e of b.ex) { console.log(`      ${e}`); }
  }
}
main();
