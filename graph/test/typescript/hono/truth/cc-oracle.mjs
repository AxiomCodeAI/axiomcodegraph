#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Hono torture oracle: the STATIC half of the ground truth.
//
// Independent of the engine by construction: it uses the TypeScript compiler API and the
// real `hono` package pinned in ./package.json (never the axiom parser, never the IR). It
// walks every registration in PROGRAM ORDER and replays Hono's own semantics, as read from
// hono-base.js of the pinned version:
//
//   - `new Hono()` / `new OpenAPIHono()` (the class must be DECLARED in the pinned package;
//     a local class that happens to be called Hono is not an app);
//   - `basePath(p)` returns a clone that SHARES the route list, with base = mergePath(base, p);
//   - a verb / `all` / `on` / `use` registers one entry per handler, `use` with method ALL and
//     default path `*`, a path-less verb continues the instance's last path;
//   - `route(p, sub)` COPIES sub's entries present AT THAT MOMENT under mergePath(base, p);
//   - `mount(p, fetch)` registers ALL mergePath(base, p, '*') to a foreign handler.
//
// Which middleware applies to which handler is decided by Hono's OWN router (SmartRouter of
// the pinned package) matched against a concrete sample of the handler's path, in
// registration order: never by a re-implementation of the pattern language.
//
// cc-oracle: program setup copied from hono-oracle.mjs (lines 1-219); call edges below.
// Output (TSV on stdout, one relation per first column; locations are
// `<path relative to src-dir>:<line>:<col>` of the function node, 1-based):
//   route   VERB  FULLPATH  HANDLER  APP  ORDER
//   mw      MW    HANDLER   ORDER    (ORDER = position in the handler's middleware chain)
//   entry   FN    http
//   ctx     SETTER_FN  READER_FN  KEY
//   rpc     FROM_FN  VERB  PATH  HANDLER
//   request FROM_FN  VERB  PATH  HANDLER
//   mount   PATH  TARGET
//   unknown SITE  REASON
// Exit 2 (refusal) when the program does not typecheck: an unscored case is not a pass.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the compiler is the oracle's OWN pinned one, reached through the suite's shared loader (version-guarded)
const { loadTypeScript } = await import(new URL('../../ground-truth/load-typescript.mjs', import.meta.url).href);
const ts = loadTypeScript(HERE, { toolName: 'hono-oracle' });
const NM = path.join(HERE, 'node_modules');
const { SmartRouter } = await import(path.join(NM, 'hono/dist/router/smart-router/index.js'));
const { RegExpRouter } = await import(path.join(NM, 'hono/dist/router/reg-exp-router/index.js'));
const { TrieRouter } = await import(path.join(NM, 'hono/dist/router/trie-router/index.js'));

const SRC = path.resolve(process.argv[2] || '.');
const NO_TYPECHECK = process.argv.includes('--no-typecheck');
const STORES = process.argv.includes('--stores');
const DEBUG = !!process.env.HONO_ORACLE_DEBUG;
const T0 = Date.now();
const phase = name => { if (DEBUG) process.stderr.write(`phase ${name} at ${((Date.now() - T0) / 1000).toFixed(1)}s\n`); };

// ── program ─────────────────────────────────────────────────────────────────
const EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
function walkDir(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const files = walkDir(SRC).sort();
const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, allowJs: true, checkJs: false,
  noEmit: true, skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true,
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'hono/jsx', types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  allowImportingTsExtensions: true,
};
const host = ts.createCompilerHost(options, true);
const ANCHOR = path.join(HERE, 'anchor.ts'); // resolve bare packages from the oracle's own node_modules
// ── Deno: an import map (deno.json / deno.jsonc / import_map.json `imports`, exact and prefix keys) and
// jsr: / npm: / deno.land URL specifiers, each mapped to the PINNED package of the same name. This is a
// module-resolution host for the oracle only; it says nothing about how the engine should resolve them.
// every deno.json / deno.jsonc / import_map.json in the fixture (a Deno project need not sit at the root)
const denoCfgs = [];
(function scanDeno(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) scanDeno(p); else if (['deno.json', 'deno.jsonc', 'import_map.json'].includes(e.name)) denoCfgs.push(p);
  }
})(SRC);
const DENO_CFG = denoCfgs.length > 0;
let importMap = {};
for (const f of denoCfgs) {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
    importMap = { ...importMap, ...(j.imports || {}) };
    const im = j.importMap && path.join(path.dirname(f), j.importMap);
    if (im && fs.existsSync(im)) importMap = { ...importMap, ...JSON.parse(fs.readFileSync(im, 'utf8')).imports };
  } catch { }
}
function canonicalSpec(spec) {
  if (importMap[spec]) spec = importMap[spec];
  else {
    const k = Object.keys(importMap).filter(k => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (k) spec = importMap[k] + spec.slice(k.length);
  }
  let m;
  if ((m = spec.match(/^jsr:\/?@hono\/hono(?:@[^/]*)?(\/.*)?$/)) || (m = spec.match(/^@hono\/hono(\/.*)?$/))) return 'hono' + (m[1] || '');
  if ((m = spec.match(/^npm:\/?((?:@[^/@]+\/)?[^/@]+)(?:@[^/]*)?(\/.*)?$/))) return m[1] + (m[2] || '');
  if ((m = spec.match(/^jsr:\/?(@hono\/[^/@]+)(?:@[^/]*)?(\/.*)?$/))) return m[1] + (m[2] || '');
  if ((m = spec.match(/^https:\/\/deno\.land\/x\/hono(?:@[^/]*)?\/(.*)$/))) {
    if (m[1] === 'mod.ts') return 'hono';
    if (m[1] === 'middleware.ts') return path.join(HERE, 'deno-shims', 'middleware.d.ts');
    return 'hono/' + m[1].replace(/^middleware\//, '').replace(/\/index\.ts$|\.ts$/, '');
  }
  return spec;
}
const libLabel = ms => { const c = canonicalSpec(ms); return c.startsWith('/') ? 'hono/middleware' : c; };
// tsconfig `paths` / `baseUrl` of the nearest tsconfig.json above the importing file (inside the fixture):
// an aliased project import (`@/lib/app`) resolves to the project file, as the project's compiler would
const _pathsCache = new Map();
function pathsOpts(containing) {
  let d = path.dirname(path.resolve(containing));
  const seen = [];
  while (d.startsWith(SRC)) {
    if (_pathsCache.has(d)) { const v = _pathsCache.get(d); seen.forEach(x => _pathsCache.set(x, v)); return v; }
    seen.push(d);
    const f = path.join(d, 'tsconfig.json');
    if (fs.existsSync(f)) {
      let v = null;
      try {
        const cf = ts.readConfigFile(f, ts.sys.readFile);
        const pc = ts.parseJsonConfigFileContent(cf.config || {}, ts.sys, d);
        if (pc.options.paths || pc.options.baseUrl) v = { paths: pc.options.paths, baseUrl: pc.options.baseUrl, pathsBasePath: pc.options.pathsBasePath || d };
      } catch { v = null; }
      seen.forEach(x => _pathsCache.set(x, v)); return v;
    }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  seen.forEach(x => _pathsCache.set(x, null)); return null;
}
// workspace packages: a package.json with a name anywhere in the fixture (not under node_modules) makes
// `<name>` and `<name>/<sub>` resolve to that package's files, as a workspace install links them
const workspace = new Map();
(function scanWs(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) scanWs(p);
    else if (e.name === 'package.json') { try { const n = JSON.parse(fs.readFileSync(p, 'utf8')).name; if (n) workspace.set(n, d); } catch { } }
  }
})(SRC);
function exportsTarget(d, sub) {
  // package.json `exports`: "./sub" -> a string, or a conditions object (types / import / default)
  try {
    const ex = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).exports;
    if (!ex) return null;
    const key = sub ? './' + sub : '.';
    let t = typeof ex === 'string' && key === '.' ? ex : ex[key];
    // a subpath pattern (`"./*"`, `"./adapters/*"`) lists every subpath it matches: substitute the matched part
    if (t === undefined && typeof ex === 'object') for (const [k, v] of Object.entries(ex)) {
      const i = k.indexOf('*'); if (i < 0 || !key.startsWith(k.slice(0, i)) || !key.endsWith(k.slice(i + 1)) || key.length < k.length - 1) continue;
      const m = key.slice(i, key.length - (k.length - i - 1));
      let vv = v; if (vv && typeof vv === 'object') vv = vv.types || vv.import || vv.default || vv.require;
      if (typeof vv === 'string') { t = vv.split('*').join(m); break; }
    }
    if (t && typeof t === 'object') t = t.types || t.import || t.default || t.require;
    if (typeof t !== 'string') return null;
    // O3b: an export that points at an unbuilt output file (`./dist/x.js`, `./dist/x.d.ts`) is served from the
    // package's source in a checkout: the same path under src/, with a source extension
    if (!fs.existsSync(path.join(d, t))) {
      const stem = t.replace(/^\.?\//, '').replace(/^(dist|build|out|lib)\//, '').replace(/\.d\.(ts|mts|cts)$|\.(js|mjs|cjs|ts|mts|cts)$/, '');
      for (const base of ['src/', '']) for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.js']) {
        const c = path.join(d, base + stem + ext);
        if (fs.existsSync(c)) return c;
      }
    }
    return path.join(d, t);
  } catch { return null; }
}
// the moduleResolution of the program a file belongs to: its nearest tsconfig.json inside the fixture, else the oracle's
const _mrCache = new Map();
function moduleResolutionOf(containing) {
  let d = path.dirname(path.resolve(containing));
  while (d.startsWith(SRC)) {
    if (_mrCache.has(d)) return _mrCache.get(d);
    const f = path.join(d, 'tsconfig.json');
    if (fs.existsSync(f)) {
      let v = options.moduleResolution;
      try { const pc = ts.parseJsonConfigFileContent(ts.readConfigFile(f, ts.sys.readFile).config || {}, ts.sys, d); v = ts.getEmitModuleResolutionKind(pc.options); } catch { }
      _mrCache.set(d, v); return v;
    }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return options.moduleResolution;
}
function workspaceOpts(spec, containing) {
  for (const [n, d] of workspace) if (spec === n || spec.startsWith(n + '/')) {
    const sub = spec === n ? '' : spec.slice(n.length + 1);
    const t = exportsTarget(d, sub);
    if (t) return { baseUrl: d, paths: { [spec]: [t] }, pathsBasePath: d };
    // SPEC R22a: a package whose `exports` does not list this subpath resolves only where the TypeScript compiler
    // resolves it. node10 ignores `exports` and reads the package directory itself; bundler, node16 and nodenext
    // enforce `exports`, so the import is unbound (no synthetic `src/` paths for it)
    let hasExports = false;
    try { hasExports = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).exports !== undefined; } catch { }
    if (hasExports) {
      const mr = containing ? moduleResolutionOf(containing) : options.moduleResolution;
      if (mr !== ts.ModuleResolutionKind.Node10 && mr !== ts.ModuleResolutionKind.Classic) return null;
      return { baseUrl: d, moduleResolution: ts.ModuleResolutionKind.Node10, paths: { [spec]: [sub ? path.join(d, sub) : d] }, pathsBasePath: d };
    }
    return { baseUrl: d, paths: { [n]: [d, path.join(d, 'src')], [n + '/*']: [path.join(d, '*'), path.join(d, 'src', '*')] }, pathsBasePath: d };
  }
  return null;
}
// ONE resolver for every project-side lookup (program building, module order, require), so a module the
// program contains is never evaluated out of order because a second lookup could not find it
function resolveSpec(rawSpec, containing, opts = options) {
  const spec = canonicalSpec(rawSpec);
  let r = ts.resolveModuleName(spec, containing, opts, host).resolvedModule;
  if (!r && !spec.startsWith('.') && !spec.startsWith('/')) {
    for (const po of [pathsOpts(containing), workspaceOpts(spec, containing)]) {
      if (r || !po) continue;
      r = ts.resolveModuleName(spec, containing, { ...opts, ...po }, host).resolvedModule;
      if (r && r.isExternalLibraryImport) r = undefined;
    }
    if (!r) r = ts.resolveModuleName(spec, ANCHOR, opts, host).resolvedModule;
  }
  return r;
}
function isProjectSpec(spec, containing) {
  if (spec.startsWith('.') || spec.startsWith('/')) return true;
  const r = resolveSpec(spec, containing);
  return !!(r && path.resolve(r.resolvedFileName).startsWith(SRC + path.sep) && !r.resolvedFileName.includes(`${path.sep}node_modules${path.sep}`));
}
host.resolveModuleNameLiterals = (lits, containing, redirected, opts) => lits.map(lit => ({ resolvedModule: resolveSpec(lit.text, containing, opts) }));
const program = ts.createProgram(DENO_CFG ? [...files, path.join(HERE, 'deno-shims', 'deno.d.ts')] : files, options, host);
const checker = program.getTypeChecker();phase('program');

const srcFiles = program.getSourceFiles().filter(sf => path.resolve(sf.fileName).startsWith(SRC + path.sep));

if (!NO_TYPECHECK) {
  const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file && srcFiles.includes(d.file)
    && !/\.(js|mjs|cjs|jsx)$/.test(d.file.fileName));
  if (diags.length) {
    for (const d of diags.slice(0, 8)) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start || 0);
      process.stderr.write(`REFUSED (does not typecheck): ${path.relative(SRC, d.file.fileName)}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}\n`);
    }
    process.exit(2);
  }
}

const rel = f => path.relative(SRC, path.resolve(f)).split(path.sep).join('/');
const loc = n => { const sf = n.getSourceFile(); const p = sf.getLineAndCharacterOfPosition(n.getStart(sf)); return `${rel(sf.fileName)}:${p.line + 1}:${p.character + 1}`; };
const inPkg = (decl, pkgs) => { const f = path.resolve(decl.getSourceFile().fileName); return pkgs.some(p => f.includes(`${path.sep}node_modules${path.sep}${p}${path.sep}`)); };
// ─────────────────────────────────────────────────────────────────────────────
// CALL-CHAIN ORACLE (callchain harness). Compiler-resolved caller->callee edges over the whole project.
// Rows (TSV):
//   fn     KEY  KIND  NAME  ENDLINE            every function-like with a body, plus each module (KEY rel:1:1)
//   edge   CALLER  CALLEE  KIND  SITE  FEATS    KIND call|new|deco|tag|closure|fnref|impl|virt
//   unres  CALLER  SITE  REASON  CALLEE_TEXT  FEATS     the compiler names no project declaration it can follow
//   lib    CALLER  SITE  LIB  CALLEE_TEXT          resolved into a library / lib.d.ts (chain boundary)
// ─────────────────────────────────────────────────────────────────────────────
const isSrcDecl = d => d && path.resolve(d.getSourceFile().fileName).startsWith(SRC + path.sep) && !d.getSourceFile().fileName.includes("/node_modules/") && !d.getSourceFile().isDeclarationFile;
const isFnNode = n => (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
  || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n)
  || ts.isSetAccessorDeclaration(n)) && !!n.body;
const isJsFile = f => /\.(js|mjs|cjs|jsx)$/.test(f);
const endLine = n => n.getSourceFile().getLineAndCharacterOfPosition(n.getEnd()).line + 1;
function fnName(n) {
  if (n.name) return n.name.getText();
  if (ts.isConstructorDeclaration(n)) return 'constructor';
  const p = n.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p))) return p.name.getText();
  return ts.isArrowFunction(n) ? '<arrow>' : '<function>';
}
function encl(n) {
  for (let p = n.parent; p; p = p.parent) if (isFnNode(p)) return p;
  return null;
}
const keyOf = fnOrNull => fnOrNull ? loc(fnOrNull) : null;
const modKey = sf => `${rel(sf.fileName)}:1:1`;
const callerKey = n => { const f = encl(n); return f ? loc(f) : modKey(n.getSourceFile()); };
const rows = [];
const emit = (...a) => rows.push(a.map(x => String(x ?? '').replace(/[\t\n]/g, ' ')).join('\t'));
const short = n => n.getText().replace(/\s+/g, ' ').slice(0, 80);

// ── class hierarchy in the project: ancestor symbol -> implementing/extending class decls ──
const resolveSym = s => (s && (s.flags & ts.SymbolFlags.Alias)) ? checker.getAliasedSymbol(s) : s;
const descendants = new Map(); // ancestor decl node -> Set(class decl)
function heritageDecls(cls) {
  const outD = [];
  for (const h of cls.heritageClauses || []) for (const t of h.types) {
    let s; try { s = resolveSym(checker.getSymbolAtLocation(t.expression)); } catch { }
    for (const d of s?.declarations || []) if (ts.isClassLike(d) || ts.isInterfaceDeclaration(d)) outD.push(d);
  }
  return outD;
}
const allClasses = [];
for (const sf of srcFiles) (function v(n) { if (ts.isClassLike(n)) allClasses.push(n); ts.forEachChild(n, v); })(sf);
for (const c of allClasses) {
  const seen = new Set(); const stack = heritageDecls(c);
  while (stack.length) {
    const a = stack.pop(); if (seen.has(a)) continue; seen.add(a);
    if (!descendants.has(a)) descendants.set(a, new Set()); descendants.get(a).add(c);
    stack.push(...heritageDecls(a));
  }
}
const memberName = d => d.name && (ts.isIdentifier(d.name) || ts.isStringLiteral(d.name) || ts.isPrivateIdentifier(d.name)) ? d.name.text : null;
function implsOf(decl) {
  // decl: a member of an interface / class (abstract or concrete). Returns concrete overriding members in subclasses.
  const owner = decl.parent; const nm = memberName(decl); const res = [];
  if (!owner || !nm || !descendants.has(owner)) return res;
  for (const c of descendants.get(owner)) for (const m of c.members || []) {
    if (memberName(m) === nm && isFnNode(m) && !(ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Static)) res.push(m);
    if (memberName(m) === nm && ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) res.push(m.initializer);
  }
  return res;
}
// ── features of a call site, for break classification ──
function rootOf(e) {
  while (true) {
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) e = e.expression;
    else if (ts.isCallExpression(e)) e = e.expression;
    else if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
    else return e;
  }
}
function siteFeats(node, calleeExpr) {
  const f = [];
  const sf = node.getSourceFile();
  if (isJsFile(sf.fileName)) f.push('js');
  if (!calleeExpr) return f;
  const txt = calleeExpr.getText();
  if (/(^|\W)(c|ctx|context)\.(get|var)\b/.test(txt) || /\bc\.env\b/.test(txt)) f.push('ctxdi');
  if (/\bawait import\(|\bimport\(/.test(txt)) f.push('dynimport');
  let ce = calleeExpr;
  while (ts.isParenthesizedExpression(ce) || ts.isAwaitExpression(ce) || ts.isNonNullExpression(ce) || ts.isAsExpression(ce)) ce = ce.expression;
  if (ts.isCallExpression(ce)) f.push('callresult');
  if (ts.isElementAccessExpression(ce)) f.push('elementaccess');
  if (node.questionDotToken || (ce.questionDotToken)) f.push('optional');
  const r = rootOf(calleeExpr);
  if (r.kind === ts.SyntaxKind.ThisKeyword) {
    for (let q = node.parent; q; q = q.parent) {
      if (ts.isArrowFunction(q)) continue;
      if (isFnNode(q) || ts.isClassStaticBlockDeclaration?.(q)) {
        if ((ts.getCombinedModifierFlags(q) & ts.ModifierFlags.Static) || ts.isClassStaticBlockDeclaration?.(q)) f.push('staticthis');
        if (ts.isArrowFunction(node.parent) || true) { let a = node.parent; let viaArrow = false; while (a && a !== q) { if (ts.isArrowFunction(a)) viaArrow = true; a = a.parent; } if (viaArrow) f.push('arrowthis'); }
        break;
      }
    }
    // this.x.m(): x a constructor parameter property or assigned from a ctor parameter -> DI
    if (ts.isPropertyAccessExpression(calleeExpr) && ts.isPropertyAccessExpression(calleeExpr.expression)) {
      const fld = calleeExpr.expression.name.text;
      let s; try { s = checker.getSymbolAtLocation(calleeExpr.expression.name); } catch { }
      for (const d of s?.declarations || []) {
        if (ts.isParameter(d) && ts.isConstructorDeclaration(d.parent)) f.push('ctordi');
        if (ts.isPropertyDeclaration(d) && (d.decorators || ts.getDecorators?.(d))?.length) f.push('ctordi');
      }
      void fld;
    }
    f.push('this');
  }
  if (ts.isIdentifier(r)) {
    let s; try { s = checker.getSymbolAtLocation(r); } catch { }
    if (s && (s.flags & ts.SymbolFlags.Alias)) {
      // re-export: the import names a module that is not where the declaration lives
      const imp = s.declarations?.[0];
      let decl = resolveSym(s)?.declarations?.[0];
      let im = imp; while (im && !ts.isImportDeclaration(im) && !ts.isImportEqualsDeclaration(im)) im = im.parent;
      if (im && ts.isImportDeclaration(im) && !isProjectSpec(im.moduleSpecifier.text, sf.fileName)) f.push('librt');
      if (im && ts.isImportEqualsDeclaration(im)) f.push('librt?');
      if (im && ts.isImportDeclaration(im) && decl) {
        const r2 = resolveSpec(im.moduleSpecifier.text, sf.fileName);
        if (r2 && path.resolve(r2.resolvedFileName) !== path.resolve(decl.getSourceFile().fileName)) f.push('reexport');
      }
    }
    for (const d of (s && !(s.flags & ts.SymbolFlags.Alias) ? s.declarations : []) || []) {
      if (ts.isVariableDeclaration(d) && d.initializer && /import\(/.test(d.initializer.getText())) f.push('dynimport');
      const direct = ce === r;   // the callee IS the identifier: a function value is called
      if (ts.isParameter(d)) f.push(direct ? 'param' : 'recv-param');
      if (ts.isParameter(d) && !d.type && (ts.isArrowFunction(d.parent) || ts.isFunctionExpression(d.parent))
        && d.parent.parent && (ts.isCallExpression(d.parent.parent) || ts.isNewExpression(d.parent.parent))) f.push('ctxparam');
      if (ts.isBindingElement(d)) f.push(direct ? 'destructured' : 'recv-destructured');
      let vd = d; while (vd && !ts.isVariableDeclaration(vd) && !ts.isParameter(vd)) vd = vd.parent;
      if (vd && ts.isVariableDeclaration(vd) && vd.initializer && /(^|\W)(c|ctx|context)\.(get|var)\b|\bc\.env\b/.test(vd.initializer.getText().slice(0, 200))) f.push('ctxdi');
      if (ts.isVariableDeclaration(d) && d.initializer && /\brequire\(\s*['"][^.\/]/.test(d.initializer.getText())) f.push('librt');
      if (ts.isVariableDeclaration(d) && d.initializer && /\brequire\(/.test(d.initializer.getText())) f.push('require');
    }
  }
  return [...new Set(f)];
}
const edgeSeen = new Map();
function addEdge(caller, calleeNode, kind, site, feats) {
  const k = `${caller}\t${loc(calleeNode)}\t${kind}\t${loc(site)}`;
  if (edgeSeen.has(k)) return;
  edgeSeen.set(k, 1);
  emit('edge', caller, loc(calleeNode), kind, loc(site), feats.join(','));
}
const libName = d => {
  const f = path.resolve(d.getSourceFile().fileName);
  const m = f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return m ? m[1] : (f.includes('/typescript/lib/') ? 'ts-lib' : (f.endsWith('.d.ts') ? 'dts:' + rel(f) : 'other'));
};
function classify(node, caller, calleeExpr, kind) {
  // R21 (hono torture chains/): a function read out of a table or an array by ELEMENT ACCESS. The compiler names one
  // declaration even when several are possible (functions of one signature collapse into one type), so its answer
  // is kept only for a literal key on an object; a key the program does not decide is `dynkey`, and an element of a
  // (non-tuple) array is `arrayelem`: both unresolved here, left to the run-time trace
  let cx = calleeExpr;
  while (cx && (ts.isParenthesizedExpression(cx) || ts.isNonNullExpression(cx) || ts.isAsExpression(cx))) cx = cx.expression;
  if (cx && ts.isElementAccessExpression(cx)) {
    let kt, ot; try { kt = checker.getTypeAtLocation(cx.argumentExpression); ot = checker.getTypeAtLocation(cx.expression); } catch { }
    const lit = kt && (kt.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral));
    const arr = ot && checker.isArrayType && checker.isArrayType(ot);
    if (!lit || arr) { emit('unres', caller, loc(node), lit ? 'arrayelem' : 'dynkey', short(calleeExpr), siteFeats(node, calleeExpr).join(',')); return; }
  }
  let sig; try { sig = checker.getResolvedSignature(node); } catch { sig = undefined; }
  let d = sig?.declaration;
  const feats = siteFeats(node, calleeExpr);
  if (!d) {
    if (ts.isNewExpression(node)) {
      // implicit constructor: the class declares none; nothing in project code runs except field initialisers
      let s; try { s = resolveSym(checker.getSymbolAtLocation(node.expression)); } catch { }
      const cd = s?.declarations?.find(x => ts.isClassLike(x));
      if (cd && isSrcDecl(cd)) return; // no body to enter
      if (cd) { emit('lib', caller, loc(node), libName(cd), short(node.expression)); return; }
    }
    let t; try { t = checker.getTypeAtLocation(calleeExpr || node); } catch { }
    const reason = !t ? 'notype' : (t.flags & ts.TypeFlags.Any) ? 'any' : (t.flags & ts.TypeFlags.Unknown) ? 'unknown' : 'nosig';
    emit('unres', caller, loc(node), reason, short(calleeExpr || node), feats.join(','));
    return;
  }
  if (!isSrcDecl(d)) { emit('lib', caller, loc(node), libName(d), short(calleeExpr || node)); return; }
  if (ts.isJSDocSignature?.(d) || ts.isFunctionTypeNode(d) || ts.isCallSignatureDeclaration(d) || ts.isConstructorTypeNode(d) || ts.isJSDocFunctionType?.(d)) {
    emit('unres', caller, loc(node), 'fnvalue', short(calleeExpr || node), feats.join(',')); return;
  }
  const isAbstract = (ts.isMethodDeclaration(d) && !d.body) || ts.isMethodSignature(d) || ts.isPropertySignature(d) || ts.isConstructSignatureDeclaration?.(d);
  if (isAbstract) {
    const impls = implsOf(d);
    if (!impls.length) { emit('unres', caller, loc(node), 'iface-noimpl', short(calleeExpr || node), [...feats, 'iface'].join(',')); return; }
    for (const m of impls) addEdge(caller, m, 'impl', node, [...feats, 'iface']);
    return;
  }
  if (isFnNode(d)) {
    addEdge(caller, d, kind, node, feats);
    if (ts.isMethodDeclaration(d)) for (const m of implsOf(d)) addEdge(caller, m, 'virt', node, [...feats, 'virt']);
    return;
  }
  if (ts.isFunctionDeclaration(d) && !d.body) { // overload signature: the implementation is the body sibling
    const impl = d.parent && (d.parent.statements || []).find(x => ts.isFunctionDeclaration(x) && x.body && x.name?.text === d.name?.text);
    if (impl) { addEdge(caller, impl, kind, node, feats); return; }
  }
  emit('unres', caller, loc(node), 'decl:' + ts.SyntaxKind[d.kind], short(calleeExpr || node), feats.join(','));
}
for (const sf of srcFiles) {
  emit('fn', modKey(sf), 'MODULE', '<module>', sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1);
  const visit = (node) => {
    if (isFnNode(node)) {
      emit('fn', loc(node), ts.SyntaxKind[node.kind], fnName(node), endLine(node));
      // a function handed over as an argument: the enclosing function passes it (callback / higher-order hop)
      const p = node.parent;
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && (p.arguments || []).includes(node))
        addEdge(callerKey(node), node, 'closure', p, siteFeats(p, p.expression));
    }
    // a function REFERENCE handed over as an argument (app.get('/', handler), arr.map(this.f))
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments) {
      for (const a of node.arguments) {
        if (!(ts.isIdentifier(a) || ts.isPropertyAccessExpression(a))) continue;
        let s; try { s = resolveSym(checker.getSymbolAtLocation(ts.isIdentifier(a) ? a : a.name)); } catch { }
        for (const d of s?.declarations || []) {
          let fnD = isFnNode(d) ? d : (ts.isVariableDeclaration(d) && d.initializer && isFnNode(d.initializer) ? d.initializer : null);
          if (fnD && isSrcDecl(fnD)) addEdge(callerKey(node), fnD, 'fnref', node, siteFeats(node, node.expression));
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind !== ts.SyntaxKind.ImportKeyword)
        classify(node, callerKey(node), node.expression, 'call');
    } else if (ts.isNewExpression(node)) classify(node, callerKey(node), node.expression, 'new');
    else if (ts.isDecorator(node)) classify(node, callerKey(node), node.expression, 'deco');
    else if (ts.isTaggedTemplateExpression(node)) classify(node, callerKey(node), node.tag, 'tag');
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// ── package entry exports (non-HTTP entries): each workspace package's entry module ──
for (const [pkgName, d] of workspace) {
  let ent = exportsTarget(d, '');
  if (!ent) for (const c of ['src/index.ts', 'index.ts', 'src/index.js', 'index.js', 'lib/index.js']) if (fs.existsSync(path.join(d, c))) { ent = path.join(d, c); break; }
  if (!ent) { try { const mn = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).main; if (mn && fs.existsSync(path.join(d, mn))) ent = path.join(d, mn); } catch { } }
  if (!ent) continue;
  const sf = program.getSourceFile(ent) || program.getSourceFiles().find(x => path.resolve(x.fileName) === path.resolve(ent));
  if (!sf || !srcFiles.includes(sf)) continue;
  const ms = checker.getSymbolAtLocation(sf); if (!ms) continue;
  for (const ex of checker.getExportsOfModule(ms)) {
    const s = resolveSym(ex);
    for (const dd of s?.declarations || []) {
      if (!isSrcDecl(dd)) continue;
      if (isFnNode(dd)) emit('pkgexport', loc(dd), pkgName, ex.name);
      else if (ts.isVariableDeclaration(dd) && dd.initializer && isFnNode(dd.initializer)) emit('pkgexport', loc(dd.initializer), pkgName, ex.name);
      else if (ts.isClassDeclaration(dd)) for (const m of dd.members) {
        const fl = ts.getCombinedModifierFlags(m);
        if (isFnNode(m) && !(fl & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && !(m.name && ts.isPrivateIdentifier(m.name)))
          emit('pkgexport', loc(m), pkgName, ex.name + '.' + (memberName(m) || 'constructor'));
      }
    }
  }
}
process.stdout.write(rows.join('\n') + '\n');
process.stderr.write(`cc-oracle: ${srcFiles.length} files, ${rows.length} rows, ${((Date.now() - T0) / 1000).toFixed(1)}s\n`);
