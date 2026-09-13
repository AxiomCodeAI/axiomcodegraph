/**
 * Out-of-process oracle: ts.Program (allowJs, checkJs) pinned to typescript@6.0.3,
 * the same compiler ../parser-oracle pins. Adjudicates the parser's call-site
 * relation on code no expectation was written for.
 *
 * Three questions, kept apart:
 *   RECALL  — every call-like node the compiler sees has a js_call_site row at its position
 *   KIND    — the parser's callKind matches what the syntax is
 *   DECIDE  — RESOLVED / SYNTHESIZED / ANY_SIGNATURE, and for declines, WHY
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const ts = require_('typescript');
const TS_PINNED = '6.0.3';
if (ts.version !== TS_PINNED) { console.error(`typescript ${ts.version} != pinned ${TS_PINNED}`); process.exit(1); }
import fs from 'fs'; import path from 'path';

const CORPUS = process.argv[2];        // package root
const OUTDIR = process.argv[3];        // parser output for that package
const LABEL  = process.argv[4];
const EXT = new Set(['.js','.mjs','.cjs','.jsx']);
const SKIP = new Set(['node_modules','.git','dist','build','out','coverage','.next','.nuxt','.turbo','.cache','.yarn']);
function walk(d, out=[]) { for (const e of fs.readdirSync(d,{withFileTypes:true})) { if (SKIP.has(e.name)) continue;
  const p = path.join(d,e.name); if (e.isDirectory()) walk(p,out); else if (EXT.has(path.extname(e.name))) out.push(p); } return out; }

const files = walk(CORPUS);
const program = ts.createProgram(files, {
  allowJs: true, checkJs: true, noEmit: true, allowNonTsExtensions: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve,
  skipLibCheck: true, resolveJsonModule: true,
});
const checker = program.getTypeChecker();

// ---- parser rows, keyed by file + line + column ----------------------------
function readCsv(f) { if (!fs.existsSync(f) || fs.statSync(f).size === 0) return null;
  const t = fs.readFileSync(f,'utf8'); const nl = t.indexOf('\n');
  const h = t.slice(0,nl).split('\t'); return { h, rows: t.slice(nl+1).split('\n').filter(Boolean).map(l=>l.split('\t')) }; }
const mods = readCsv(path.join(OUTDIR,'all-javascript-modules.csv'));
const hashToPath = new Map();
const provenance = new Map(); const moduleFacts = new Map();
if (mods) { const iH = mods.h.indexOf('jsModuleUniqueHash'), iP = mods.h.indexOf('filePath');
  for (const r of mods.rows) { hashToPath.set(r[iH], r[iP]); provenance.set(r[iP], r[mods.h.indexOf('sourceProvenance')]);
    moduleFacts.set(r[iP], { moduleSystem: r[mods.h.indexOf('moduleSystem')],
      contradiction: r[mods.h.indexOf('contradictionKind')], hasJsx: r[mods.h.indexOf('hasJsxContent')],
      hasFlow: r[mods.h.indexOf('hasFlowPragma')], scriptKind: r[mods.h.indexOf('scriptKind')] }); } }
const parserFiles = new Set(hashToPath.values());
const cs = readCsv(path.join(OUTDIR,'all-javascript-call-sites.csv'));
const parserCalls = new Map();      // "relpath:line:col" -> {kind, calleeText}
if (cs) { const iK=cs.h.indexOf('callKind'), iC=cs.h.indexOf('calleeText'), iM=cs.h.indexOf('ownerModuleLinkHash'),
    iL=cs.h.indexOf('startLine'), iCo=cs.h.indexOf('startColumn');
  // SEVERAL call sites share one start position: `f(x).m()` and `f(x)` both start
  // at the same line:column. Keying a Map by position kept only the last and read
  // as a KIND_MISMATCH on the smallest CommonJS package. The bucket is a LIST, disambiguated by callee text.
  for (const r of cs.rows) { const k = `${hashToPath.get(r[iM])}:${r[iL]}:${r[iCo]}`;
    (parserCalls.get(k) ?? parserCalls.set(k, []).get(k)).push({ kind:r[iK], callee:r[iC],
      optional: r[cs.h.indexOf('isOptionalCall')] }); } }
const imp = readCsv(path.join(OUTDIR,'all-javascript-imports.csv'));
const parserImports = new Set();
// A DESTRUCTURED require mints one row PER BINDING, positioned at the BINDING,
// not at the `require(...)` call. Keying by the call's own column read 2,226 of
// 2,229 perfectly good rows as missing — a harness artifact, not a parser defect,
// and exactly the "verify before you file" case. Key by file + line + specifier.
if (imp) { const iM=imp.h.indexOf('ownerModuleLinkHash'), iL=imp.h.indexOf('startLine'),
    iS=imp.h.indexOf('specifier'), iE=imp.h.indexOf('edgeBearer');
  for (const r of imp.rows) if (r[iE] !== 'DECLARATION')
    parserImports.add(`${hashToPath.get(r[iM])}:${r[iL]}:${r[iS]}`); }

// ---- classification --------------------------------------------------------
const t = {}; const bump=(k,n=1)=>t[k]=(t[k]||0)+n;
const missed = []; const kindMismatch = []; const extra = []; const reqMissed = [];

function isRequireCall(n) { return ts.isCallExpression(n) && ts.isIdentifier(n.expression)
  && n.expression.text === 'require' && n.arguments.length >= 1; }

/**
 * What callKind the syntax justifies — or `null` where syntax does not decide.
 *
 * ## Three corrections, all of them MY expectation being wrong, not the parser
 *
 * 1. OPTIONAL is a COLUMN, not a kind. `f?.()` is a FUNCTION_CALL with
 *    `isOptionalCall = true`; the parser models optionality on the boolean and
 *    leaves JsCallKind to say what is being invoked. My original expectation
 *    demanded the kind OPTIONAL_CALL and scored 6 correct rows as mismatches —
 *    the reachability column, which is what the finding was actually about, was
 *    right in every one. Optionality is asserted separately below.
 * 2. A PARENTHESISED CALLEE is not an IIFE. `(fs.readdir)(x)` and
 *    `(this.hashFactory)()` are method calls with redundant parentheses; the
 *    parser unwraps them and is right to. Only a parenthesised FUNCTION or ARROW
 *    is an IIFE.
 * 3. `(async () => {...})().catch(f)` is two calls sharing a start position, and
 *    the outer one is a METHOD_CALL. Handled by the per-position bucket, not here.
 */
function expectedKind(n, sf) {
  if (ts.isNewExpression(n)) return ['CONSTRUCTOR_CALL'];
  if (ts.isTaggedTemplateExpression(n)) return ['TAGGED_TEMPLATE_CALL'];
  const e = n.expression;
  if (e.kind === ts.SyntaxKind.SuperKeyword) return ['SUPER_CALL'];
  if (e.kind === ts.SyntaxKind.ImportKeyword) return ['DYNAMIC_IMPORT_CALL'];
  // OPTIONAL CALLS: DO NOT JUDGE THE KIND. `JsCallKind.OPTIONAL_CALL` overlaps
  // METHOD_CALL and FUNCTION_CALL — `a.b?.()` is both a method call and an
  // optional one — and js-impl has raised that overlap as an open question rather
  // than improvising a rule. Scoring it either way would be my harness taking a
  // decision that is not mine and not yet made. Optionality IS asserted, on
  // `isOptionalCall`, which is the column that carries reachability.
  if (ts.isOptionalChain(n) || n.questionDotToken
      || ((ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) && ts.isOptionalChain(e))) {
    return null;
  }
  if (ts.isIdentifier(e) && (e.text === 'eval')) return ['DYNAMIC_CODE_CALL','FUNCTION_CALL'];
  if (ts.isPropertyAccessExpression(e)) {
    if (e.name.text === 'call')  return ['FUNCTION_CALL_CALL','METHOD_CALL'];
    if (e.name.text === 'apply') return ['FUNCTION_CALL_APPLY','METHOD_CALL'];
    if (e.name.text === 'bind')  return ['FUNCTION_CALL_BIND','METHOD_CALL'];
    return ['METHOD_CALL'];
  }
  if (ts.isElementAccessExpression(e)) return ['COMPUTED_CALL','METHOD_CALL'];
  if (ts.isFunctionExpression(e) || ts.isArrowFunction(e)) return ['IIFE_CALL','FUNCTION_CALL'];
  if (ts.isParenthesizedExpression(e)) {
    let inner = e.expression;
    while (ts.isParenthesizedExpression(inner)) { inner = inner.expression; }
    if (ts.isFunctionExpression(inner) || ts.isArrowFunction(inner)) return ['IIFE_CALL','FUNCTION_CALL'];
    return null;   // redundant parens around anything else: the parser unwraps, correctly
  }
  if (ts.isIdentifier(e)) return ['FUNCTION_CALL','DYNAMIC_CODE_CALL'];
  return null;  // callee is some other expression: no single right answer, don't judge
}

/** The RECEIVER SHAPE of a call — the axis the report is asked to break resolution down by. */
function receiverShape(n) {
  if (ts.isNewExpression(n)) return 'NEW';
  if (ts.isTaggedTemplateExpression(n)) return 'TAGGED_TEMPLATE';
  const e = n.expression;
  if (e.kind === ts.SyntaxKind.SuperKeyword) return 'SUPER';
  if (e.kind === ts.SyntaxKind.ImportKeyword) return 'DYNAMIC_IMPORT';
  if (ts.isIdentifier(e)) return 'BARE_IDENTIFIER';
  if (ts.isPropertyAccessExpression(e)) {
    if (e.expression.kind === ts.SyntaxKind.ThisKeyword) return 'THIS_MEMBER';
    if (ts.isIdentifier(e.expression)) return 'IDENTIFIER_MEMBER';
    if (ts.isCallExpression(e.expression)) return 'CALL_RESULT_MEMBER';
    return 'CHAINED_MEMBER';
  }
  if (ts.isElementAccessExpression(e)) return 'COMPUTED_MEMBER';
  if (ts.isParenthesizedExpression(e) || ts.isFunctionExpression(e) || ts.isArrowFunction(e)) return 'IIFE';
  return 'OTHER';
}
function rootOf(e) { for(;;) {
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) { e = e.expression; continue; }
  if (ts.isCallExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) { e = e.expression; continue; }
  return e; } }

const NODE_BUILTINS = new Set(['fs','path','util','events','http','https','net','os','stream','url','crypto','zlib','child_process','buffer','assert','querystring','tty','dns','tls','vm','worker_threads','readline','timers','string_decoder','cluster','v8','perf_hooks','console','process','module','constants','punycode','domain','http2','inspector','repl','async_hooks','diagnostics_channel','trace_events','wasi']);

// AMBIENT GLOBALS — names a browser, Node, or test runner defines with no
// declaration in the project. A platform vocabulary, not a corpus reference.
const GLOBALS = new Set(['window','document','global','globalThis','self','$','jQuery','describe','it','before','after','beforeEach','afterEach','expect','jest','test','navigator','location','fetch','console','process','Buffer','setTimeout','setInterval','clearTimeout','clearInterval','require','module','exports','__dirname','__filename','define','WebAssembly','__DEV__','__EXPERIMENTAL__','__PROFILE__','__VARIANT__']);  // scrub-allow: browser global name, not the corpus
/** The module specifier that binds `name` in this file, or null. */
const specCache = new Map();
function bindingSpecifier(sf, name) {
  let m = specCache.get(sf);
  if (!m) { m = new Map(); specCache.set(sf, m);
    const add = (n2, spec) => { if (ts.isIdentifier(n2)) m.set(n2.text, spec); };
    const visit = (x) => {
      if (ts.isImportDeclaration(x) && x.importClause && ts.isStringLiteralLike(x.moduleSpecifier)) {
        const spec = x.moduleSpecifier.text;
        if (x.importClause.name) add(x.importClause.name, spec);
        const b = x.importClause.namedBindings;
        if (b && ts.isNamespaceImport(b)) add(b.name, spec);
        if (b && ts.isNamedImports(b)) for (const e of b.elements) add(e.name, spec);
      }
      if (ts.isVariableDeclaration(x) && x.initializer) {
        let init = x.initializer;
        while (ts.isPropertyAccessExpression(init)) init = init.expression;
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require'
            && init.arguments.length && ts.isStringLiteralLike(init.arguments[0])) {
          const spec = init.arguments[0].text;
          if (ts.isIdentifier(x.name)) add(x.name, spec);
          else if (ts.isObjectBindingPattern(x.name)) for (const e of x.name.elements) add(e.name, spec);
        }
      }
      ts.forEachChild(x, visit);
    };
    visit(sf);
  }
  return m.has(name) ? m.get(name) : null;
}
function declineCause(n, sf) {
  const root = rootOf(ts.isTaggedTemplateExpression(n) ? n.tag : n.expression);
  if (!ts.isIdentifier(root)) {
    if (root.kind === ts.SyntaxKind.ThisKeyword) return 'THIS_ANY';
    return 'ROOT_NOT_IDENTIFIER';
  }
  const sym = checker.getSymbolAtLocation(root);
  if (!sym) {
    // NO_SYMBOL is not one thing. A name bound by an import/require in this very
    // file whose specifier did NOT resolve is ENVIRONMENTAL — and on a SPARSE
    // checkout (mine restricts subtrees on purpose) that is an artefact of the
    // corpus, not of the language. Separating them is the difference between
    // "33.6% of declines" and a number that means something.
    const name = root.text;
    const spec = bindingSpecifier(sf, name);
    if (spec !== null) {
      const r = ts.resolveModuleName(spec, sf.fileName, program.getCompilerOptions(), ts.sys);
      if (!r.resolvedModule) return spec.startsWith('.')
        ? 'ENV__LOCAL_IMPORT_OUTSIDE_CHECKOUT' : 'ENV__PACKAGE_NOT_INSTALLED';
      return 'IMPORTED_BINDING_NO_SYMBOL';
    }
    return GLOBALS.has(name) ? 'AMBIENT_GLOBAL_UNDECLARED' : 'NO_SYMBOL';
  }
  const decls = sym.declarations ?? [];
  if (decls.length === 0) return 'ROOT_SYMBOL_UNDECLARED';
  let d = decls[0];
  // §7.3a of the decision memo nests the Node-builtin bucket INSIDE the
  // required-binding family. A destructured binding off `require('fs')` is a
  // BindingElement, so testing the declaration directly labels it
  // DESTRUCTURED_ANY and the builtin bucket collapses — 2.0% on the platform runtime's library against
  // the memo's 24.4%. Walk a BindingElement up to its VariableDeclaration first;
  // the ordering, not the facts, was the whole disagreement.
  let viaPattern = false;
  if (ts.isBindingElement(d)) {
    let a = d.parent; while (a && !ts.isVariableDeclaration(a)) a = a.parent;
    if (a && a.initializer) { d = a; viaPattern = true; }
  }
  // a binding whose initializer is require(...)
  if (ts.isVariableDeclaration(d) && d.initializer) {
    let init = d.initializer;
    if (ts.isPropertyAccessExpression(init) || ts.isCallExpression(init)) {
      let probe = init; while (ts.isPropertyAccessExpression(probe)) probe = probe.expression;
      if (isRequireCall(probe)) init = probe;
    }
    if (isRequireCall(init) && ts.isStringLiteralLike(init.arguments[0])) {
      const spec = init.arguments[0].text.replace(/^node:/, '');
      if (NODE_BUILTINS.has(spec)) return 'REQUIRED_BINDING__NODE_BUILTIN_NO_TYPES';
      // `require('internal/errors')` is Node's OWN internal namespace. It is not an
      // npm package and `npm install` cannot supply it — calling it
      // "package not installed" put 29.6% of the platform runtime library's declines in a bucket
      // labelled fixable when nothing installable fixes them.
      if (spec.startsWith('internal/')) return 'REQUIRED_BINDING__NODE_INTERNAL_NAMESPACE';
      const resolved = ts.resolveModuleName(init.arguments[0].text, sf.fileName,
        program.getCompilerOptions(), ts.sys);
      if (!resolved.resolvedModule) return spec.startsWith('.')
        ? 'REQUIRED_BINDING__RELATIVE_UNRESOLVED' : 'REQUIRED_BINDING__PACKAGE_NOT_INSTALLED';
      return 'REQUIRED_BINDING__RESOLVED_BUT_UNTYPED';
    }
  }
  if (ts.isVariableDeclaration(d)) {
    if (viaPattern || ts.isObjectBindingPattern(d.name) || ts.isArrayBindingPattern(d.name)) return 'DESTRUCTURED_ANY';
    return 'LOCAL_UNTYPED_VAR';
  }
  if (ts.isBindingElement(d)) return 'DESTRUCTURED_ANY';
  if (ts.isParameter(d)) return d.type ? 'TYPED_PARAM_STILL_ANY' : 'IMPLICIT_ANY_PARAM';
  if (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)) return 'IMPORTED_BINDING_UNTYPED';
  return 'OTHER__' + ts.SyntaxKind[d.kind];
}

const notClaimed = []; const perFile = {};
/**
 * The nearest ancestor that could explain a dropped subtree.
 *
 * A recall miss is only useful if it names a CONSTRUCT. Walking to the closest
 * function-like or otherwise-suspicious ancestor turns 132 anonymous misses on
 * a charting library into one named class ("object-literal shorthand method").
 */
function enclosingShape(n) {
  for (let a = n.parent; a; a = a.parent) {
    if (ts.isMethodDeclaration(a) && a.parent && ts.isObjectLiteralExpression(a.parent)) return 'OBJECT_LITERAL_METHOD';
    if ((ts.isGetAccessor(a) || ts.isSetAccessor(a)) && a.parent && ts.isObjectLiteralExpression(a.parent)) return 'OBJECT_LITERAL_ACCESSOR';
    if (ts.isMethodDeclaration(a)) return 'CLASS_METHOD';
    if (ts.isGetAccessor(a) || ts.isSetAccessor(a)) return 'CLASS_ACCESSOR';
    if (ts.isConstructorDeclaration(a)) return 'CONSTRUCTOR';
    if (ts.isFunctionDeclaration(a)) return 'FUNCTION_DECLARATION';
    if (ts.isFunctionExpression(a)) return 'FUNCTION_EXPRESSION';
    if (ts.isArrowFunction(a)) return 'ARROW';
    if (ts.isClassStaticBlockDeclaration(a)) return 'CLASS_STATIC_BLOCK';
    if (ts.isPropertyDeclaration(a)) return 'CLASS_PROPERTY_INITIALIZER';
    if (ts.isDecorator(a)) return 'DECORATOR';
    if (ts.isJsxExpression(a)) return 'JSX_EXPRESSION';
    if (ts.isSourceFile(a)) return 'TOP_LEVEL';
  }
  return 'UNKNOWN';
}
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!sf.fileName.startsWith(path.resolve(CORPUS))) continue;
  if (!EXT.has(path.extname(sf.fileName))) { bump('ORACLE_SKIPPED_NON_JS_EXT'); continue; }
  const rel = path.relative(path.resolve(CORPUS), sf.fileName);
  // RECONCILE THE FILE SETS FIRST. The Program pulls in whatever an import
  // reaches — a monorepo's 439 `.ts` files, a `.ts` reached from a `.js`. Counting
  // their calls as parser recall misses manufactures a defect population that
  // does not exist, which is §7's most expensive error. A file the parser never
  // claimed is bucketed, never scored.
  if (!parserFiles.has(rel)) {
    bump('FILE_NOT_IN_PARSER_OUTPUT');
    bump('FILE_NOT_IN_PARSER_OUTPUT__' + (path.extname(rel) || 'none'));
    if (notClaimed.length < 20) notClaimed.push(rel);
    continue;
  }
  // BUNDLED IS CLASSIFIED, NEVER COUNTED. Use the parser's OWN sourceProvenance
  // rather than a second heuristic, so the two cannot disagree: 61 bundled files
  // carried 73% of call sites last time, and one date library's bundle alone is 105,152 here.
  const prov = provenance.get(rel) ?? 'UNKNOWN';
  if (prov !== 'PROJECT') { bump('FILE_SKIPPED_' + prov); continue; }
  bump('files');
  const fileTally = {}; perFile[rel] = fileTally;
  const fbump = (k, n = 1) => fileTally[k] = (fileTally[k] || 0) + n;
  const visit = (n) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n)) {
      const lc = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      const key = `${rel}:${lc.line + 1}:${lc.character + 1}`;
      if (isRequireCall(n)) {
        bump('require_module_edge'); fbump('require_module_edge');
        const spec = ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : null;
        // The binding may sit on an EARLIER line than the require (a multi-line
        // destructuring pattern), so accept the specifier anywhere within the
        // statement's line span.
        const stmtStart = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        let found = spec === null;
        if (!found) { let a = n.parent; while (a && !ts.isStatement(a)) a = a.parent;
          const lo = a ? sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1 : stmtStart;
          const hi = a ? sf.getLineAndCharacterOfPosition(a.getEnd()).line + 1 : stmtStart;
          for (let L = lo; L <= hi && !found; L++) found = parserImports.has(`${rel}:${L}:${spec}`); }
        if (!found) { bump('require_MISSING_IMPORT_ROW');
          bump('REQ_MISS_UNDER__' + enclosingShape(n));
          bump('REQ_MISS_ARG__' + (n.arguments.length && ts.isStringLiteralLike(n.arguments[0]) ? 'LITERAL' : 'NON_LITERAL'));
          if (reqMissed.length < 30) reqMissed.push({ key, under: enclosingShape(n), text: n.getText(sf).slice(0,60).replace(/\n/g,' ') }); }
      } else {
        bump('call_sites_oracle'); fbump('call_sites_oracle');
        const bucket = parserCalls.get(key);
        if (!bucket) { bump('RECALL_MISS'); fbump('RECALL_MISS'); bump('MISS_UNDER__' + enclosingShape(n)); fbump('MISS_UNDER__' + enclosingShape(n));
          if (missed.length < 40) missed.push({ what:'call', key, under: enclosingShape(n), text: n.getText(sf).slice(0,70).replace(/\n/g,' ') }); }
        else {
          const calleeNode = ts.isTaggedTemplateExpression(n) ? n.tag : n.expression;
          const calleeText = calleeNode.getText(sf).replace(/\s+/g, '');
          // the fact base escapes newlines and tabs inside a cell; unescape before
          // comparing or every multi-line callee reads as unmatched (6 on the smallest package).
          const norm = (x) => x.replace(/^"|"$/g,'').replace(/""/g,'"')
            .replace(/\\n/g,'\n').replace(/\\t/g,'\t').replace(/\s+/g,'');
          let row = bucket.find(b => norm(b.callee) === calleeText)
            // a long callee text is TRUNCATED in the fact base (js_expression.isTruncated),
            // so an exact compare reads as unmatched. Accept a prefix.
            // LONGEST prefix, not the first. `(async () => {...})()` and its
            // `.then(...)` share a start position, and the inner row's callee is a
            // PREFIX of the outer node's, so first-match handed the outer node the
            // inner row and reported an IIFE_CALL/METHOD_CALL mismatch that was not
            // there. 5 of the 20 remaining mismatches were this.
            ?? bucket.filter(b => norm(b.callee).length > 20 && calleeText.startsWith(norm(b.callee)))
                     .sort((x, y) => norm(y.callee).length - norm(x.callee).length)[0];
          if (!row && bucket.length === 1) row = bucket[0];
          if (!row) { bump('CALLEE_TEXT_UNMATCHED');
            if (missed.length < 40) missed.push({ what:'callee-text', key, wanted: calleeText.slice(0,60), had: bucket.map(b=>b.callee.slice(0,40)) }); }
          else {
            // OPTIONALITY, asserted on the column the parser actually models it on.
            // A TaggedTemplateExpression has `.tag`, not `.expression`; reading
            // `.expression` on one threw and killed the largest CommonJS run.
            const callee = ts.isTaggedTemplateExpression(n) ? n.tag : n.expression;
            const optional = ts.isOptionalChain(n)
              || !!n.questionDotToken
              || (callee !== undefined
                  && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
                  && ts.isOptionalChain(callee));
            if (optional !== (row.optional === 'true')) { bump('OPTIONALITY_MISMATCH');
              if (kindMismatch.length < 40) kindMismatch.push({ key, got: `isOptionalCall=${row.optional}`,
                want: [`isOptionalCall=${optional}`], text: n.getText(sf).slice(0,70).replace(/\n/g,' ') }); }
            const want = expectedKind(n, sf);
            // WHERE MY MATCHER CANNOT DECIDE, IT DECLINES. `(async () => {...})()`
            // and the `.then(...)` around it share a start position AND truncate to
            // the same callee text, so no text rule can separate them. Both rows
            // exist and both are correct; picking one by kind and then checking the
            // kind would be circular. So: if ANY row in an ambiguous bucket carries
            // an acceptable kind, accept, and count the bucket as undecided. This
            // can still FAIL — it fails when no row in the bucket has the right kind.
            const ambiguous = bucket.length > 1
              && bucket.filter(b => norm(b.callee) === norm(row.callee)).length > 1;
            if (ambiguous) {
              bump('KIND_UNDECIDABLE_AMBIGUOUS_BUCKET');
              if (want && !bucket.some(b => want.includes(b.kind))) { bump('KIND_MISMATCH');
                if (kindMismatch.length < 40) kindMismatch.push({ key, got: bucket.map(b => b.kind).join('|'),
                  want, text: n.getText(sf).slice(0,70).replace(/\n/g,' ') }); }
            } else if (want && !want.includes(row.kind)) { bump('KIND_MISMATCH');
              if (kindMismatch.length < 40) kindMismatch.push({ key, got: row.kind, want, text: n.getText(sf).slice(0,70).replace(/\n/g,' ') }); }
          }
        }
        // decidability
        const sig = checker.getResolvedSignature(n);
        if (!sig) { bump('NO_SIGNATURE'); fbump('NO_SIGNATURE'); }
        else if (sig.declaration) { bump('RESOLVED'); fbump('RESOLVED');
          bump('SHAPE_RESOLVED__' + receiverShape(n)); fbump('SHAPE_RESOLVED__' + receiverShape(n)); }
        else {
          const calleeType = checker.getTypeAtLocation(ts.isTaggedTemplateExpression(n) ? n.tag : n.expression);
          if (calleeType.flags & ts.TypeFlags.Any) { const c = declineCause(n, sf); bump('ANY_SIGNATURE'); fbump('ANY_SIGNATURE'); bump('DECLINE__' + c); fbump('DECLINE__' + c); fbump('SHAPE_ANY__' + receiverShape(n)); bump('SHAPE_ANY__' + receiverShape(n)); }
          else { bump('SYNTHESIZED'); fbump('SYNTHESIZED');
            bump('SHAPE_SYNTH__' + receiverShape(n)); fbump('SHAPE_SYNTH__' + receiverShape(n)); }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// parser rows the oracle never saw
for (const k of parserCalls.keys()) {
  // only meaningful if the file was in the program
}
// files the PARSER claimed but the Program never loaded — the other direction
const oracleFiles = new Set(program.getSourceFiles().filter(s2 => s2.fileName.startsWith(path.resolve(CORPUS)))
  .map(s2 => path.relative(path.resolve(CORPUS), s2.fileName)));
const parserOnly = [...parserFiles].filter(f => !oracleFiles.has(f));
bump('FILE_PARSER_ONLY', parserOnly.length);
console.log(JSON.stringify({ label: LABEL, tally: t, missed, kindMismatch, notClaimed, reqMissed, parserOnly: parserOnly.slice(0,20), perFile, moduleFacts: Object.fromEntries(moduleFacts) }, null, 1));
