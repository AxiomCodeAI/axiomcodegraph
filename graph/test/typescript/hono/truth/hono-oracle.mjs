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
// usage: node hono-oracle.mjs <src-dir> [--json]
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
const isSrcDecl = d => d && path.resolve(d.getSourceFile().fileName).startsWith(SRC + path.sep);

// ── abstract values ─────────────────────────────────────────────────────────
// app:    { k:'app', store, base, path, id }  (a basePath clone shares store)
// str:    { k:'str', v }
// fn:     { k:'fn', node }                    user function
// libfn:  { k:'libfn', name, site }           a function a library call produced (cors(), zValidator())
// list:   { k:'list', items }                 createHandlers(...), arrays
// route:  { k:'routedef', method, path }      createRoute({...})
// client: { k:'client', app, segs }           hc<AppType>() / testClient(app) and its property paths
// factory:{ k:'factory' }
// obj:    { k:'obj', props: Map }
// unk:    { k:'unk', why }
const UNK = why => ({ k: 'unk', why });
// undef:  { k:'undef' }                       a property an object literal the program shows does not have
//   (`input.routes` when definePlugin was given `{ id, register }`): a loop over it runs no times, `x ?? y` is y.
//   Only for a CLOSED literal (no unknown spread, no computed or accessor member) and a property name that no
//   assignment `a.<name> = ..` anywhere in the program writes; otherwise unknown, as before
const UNDEF = { k: 'undef' };
let storeSeq = 0, entrySeq = 0, altSeq = 0, mountSeq = 0;
const stores = [];
function newApp(node) {
  const store = { id: ++storeSeq, entries: [], mounted: false, origin: loc(node), notFound: null, onError: null };
  stores.push(store);
  return { k: 'app', store, base: '/', path: '/', origin: store.origin };
}
// mergePath, transcribed from hono/dist/utils/url.js of the pinned version
function mergePath(base, sub, ...rest) {
  if (rest.length) sub = mergePath(sub, ...rest);
  return `${base?.[0] === '/' ? '' : '/'}${base}${sub === '/' ? '' : `${base?.at(-1) === '/' ? '' : '/'}${sub?.[0] === '/' ? sub.slice(1) : sub}`}`;
}

const out = { regby: new Set(), unserved: new Set(), partial: new Set(), submount: [], route: [], mw: [], entry: new Set(), ctx: new Set(), rpc: new Set(), request: new Set(), unknown: new Set() };
// unknown rows: SITE  REASON  FN  (REASON from SPEC section 4's closed list; FN = the method it is attributed to)
const siteFn = new Map();
function unknownAt(node, reason, fnKey) { out.unknown.add(`${loc(node)}\t${reason}\t${fnKey || enclosingFn(node)}`); }
const handlerKey = v => v.k === 'fn' ? loc(v.node) : v.k === 'libfn' ? `lib:${v.name}@${v.site}` : null;

function lexicalCond(node) {
  for (let n = node.parent; n && !ts.isFunctionLike(n) && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isForOfStatement(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) return 'loop_registration';
    if (ts.isIfStatement(n) || ts.isConditionalExpression(n)) return 'conditional_registration';
  }
  return null;
}
function addEntry(app, method, p, hv, kind, site, node) {
  if (app.dyn && kind === 'mw' && p.k === 'str') {
    // middleware on a rebased holder: kept aside for the routes later mounted into it (partialMount)
    const hs0 = hv.k === 'list' ? hv.items : [hv];
    app.store.dynMws = app.store.dynMws || [];
    for (const h of hs0) {
      const k = handlerKey(h);
      if (k) app.store.dynMws.push({ seq: ++entrySeq, method, path: p.v, key: k, kind, val: h, anyBase: p.v === '*' || p.v === '/*', alt: hv.k === 'alt' ? hv.alt : undefined });
      // a middleware the program cannot name (a loop over a run-time list) is a marker in the order, as on a root
      else app.store.dynMws.push({ seq: ++entrySeq, method, path: p.v, key: null, kind: 'dyn', val: h, anyBase: p.v === '*' || p.v === '/*' });
    }
    return;
  }
  if (app.dyn) {
    if (kind === 'handler') {
      const k = handlerKey(hv), V = method === 'ALL' ? 'ANY' : method;
      out.partial.add(`${k}\t${V}\t${app.dyn}`); unknownAt(node, app.dyn, k);
      // SPEC 3.3: a route registered straight on a rebased holder keeps its decidable chain: the holder's own
      // middleware registered before it whose scope matches inside the holder (all its paths share the one unknown
      // prefix); a run-time middleware list among them makes the chain dynamic_middleware_list
      if (k && p.k === 'str') {
        const before = (app.store.dynMws || []).filter(m => m.method === 'ALL' || m.method === method);
        const router = new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
        before.forEach((m, j) => router.add(m.method, m.anyBase ? '*' : m.path, j));
        let matched; try { matched = new Set(router.match(method === 'ALL' ? 'GET' : method, samplePath(p.v))[0].map(x => x[0])); } catch { matched = new Set(); }
        let at = -1, lastAlt, dynamic = false;
        before.forEach((m, j) => {
          if (!matched.has(j)) return;
          if (m.kind === 'dyn') { dynamic = true; return; }
          if (!(m.alt && m.alt === lastAlt)) at++;
          lastAlt = m.alt; partialMw.add(`${m.key}\t${k}\t${V}\t${at}`);
        });
        if (dynamic) out.unknown.add(`${loc(node)}\tdynamic_middleware_list\t${k}`);
      }
    }
    return;
  }
  if (p.k !== 'str') { const k = handlerKey(hv); out.partial.add(`${k}\t${method === 'ALL' ? 'ANY' : method}\tdynamic_route_path`); unknownAt(node, 'dynamic_route_path', k); return; }
  const full = mergePath(app.base, p.v);
  const hs = hv.k === 'list' ? hv.items : hv.k === 'alt' ? hv.items : [hv];
  const alt = hv.k === 'alt' ? `a${++altSeq}` : undefined;
  for (const h of hs) {
    const key = handlerKey(h);
    if (!key) {
      // a middleware the program cannot name (a loop over a run-time list, a non-literal spread): a marker in the
      // registration order, so every chain it may join is declared dynamic_middleware_list (SPEC 3.3, hono-1-06)
      if (kind === 'mw') app.store.entries.push({ seq: ++entrySeq, method, path: full, key: null, kind: 'dyn', site, val: h });
      else unknownAt(node, 'unresolved_handler');
      continue;
    }
    app.store.entries.push({ seq: ++entrySeq, method, path: full, key, kind, site, val: h, regFn: node ? enclosingFn(node) : '?', alt, loopTag: loopTagNow() });
    if (h.k === 'fn') handlerFns.add(h.node);
    // SPEC 3.1: a registration written inside a loop or behind a condition (lexically, within its own function)
    const lc = condDepth && node ? lexicalCond(node) : null;
    if (lc) unknownAt(node, lc, h.k === 'fn' ? key : undefined);
  }
}

// ── environment: values keyed by DECLARATION node ───────────────────────────
const env = new Map();
const evaluating = new Set();
function declOf(id) {
  let s = checker.getSymbolAtLocation(id);
  if (!s) return null;
  if (s.flags & ts.SymbolFlags.Alias) { try { s = checker.getAliasedSymbol(s); } catch { } }
  return s.valueDeclaration || (s.declarations && s.declarations[0]) || null;
}
function valueOfDecl(d) {
  if (!d) return UNK('no_declaration');
  if (env.has(d)) return env.get(d);
  if (!isSrcDecl(d)) return { k: 'libdecl', decl: d };
  if (ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d) || ts.isMethodDeclaration(d)) return { k: 'fn', node: d };
  if (ts.isVariableDeclaration(d) && d.initializer && !evaluating.has(d)) {
    // lazily, for a const read before its module ran (memoised: no double registration)
    evaluating.add(d); const v = evalExpr(d.initializer); evaluating.delete(d); env.set(d, v); return v;
  }
  if (ts.isBindingElement(d)) {
    // `const { a } = <value>` / `const { a } = require('./m')`: the member of the evaluated initializer
    const vd = d.parent && d.parent.parent;
    if (vd && ts.isVariableDeclaration(vd) && vd.initializer && ts.isObjectBindingPattern(d.parent)) {
      // O15: a destructured name whose initializer reads it back (through an object shorthand) is a cycle:
      // the value is unknown, never a stack overflow
      if (evaluating.has(d)) { noteCycle(d); return UNK('cycle'); }
      evaluating.add(d);
      let src; try { src = evalExpr(vd.initializer); } finally { evaluating.delete(d); }
      const prop = (d.propertyName || d.name).getText();
      let v = null;
      if (src.k === 'obj' && src.props.has(prop)) { const p = src.props.get(prop); if (!p.val) p.val = evalExpr(p.node); v = p.val; }
      else if (src.k === 'module') { const ed = moduleExportDecl(src.sf, prop); if (ed) v = valueOfDecl(ed); } // O16: `const { x } = await import('./m')`
      // O15: memoised like a const (a call frame's own bindings are reset per call by inline), so a chain of
      // destructures is evaluated once, not once per read
      env.set(d, v || UNK('destructured'));
      return env.get(d);
    }
    return UNK('destructured');
  }
  if (ts.isPropertyAccessExpression(d) && d.parent && ts.isBinaryExpression(d.parent) && d.parent.left === d) return env.get(d.parent) ?? evalExpr(d.parent.right); // `module.exports.a = fn`
  if (ts.isExportAssignment(d)) return env.get(d) ?? evalExpr(d.expression);
  if (ts.isShorthandPropertyAssignment(d)) { const vs = checker.getShorthandAssignmentValueSymbol(d); return vs ? valueOfDecl(vs.valueDeclaration) : UNK('shorthand'); }
  if (ts.isPropertyAssignment(d)) return evalExpr(d.initializer);
  if (ts.isBinaryExpression(d)) return env.get(d) ?? evalExpr(d.right);
  if (ts.isSourceFile(d)) return { k: 'module', sf: d };
  return UNK('opaque_declaration');
}

// the leftmost identifier of `a.b.c(...)`/`a()` when it is bound by an import from a package: a library
// call even when the package cannot be resolved (it is still kept in the chain, never dropped)
function rootImport(callee) {
  let n = callee;
  while (ts.isPropertyAccessExpression(n) || ts.isCallExpression(n) || ts.isElementAccessExpression(n)) n = n.expression;
  if (!ts.isIdentifier(n)) return null;
  const s = checker.getSymbolAtLocation(n);
  for (const d of (s && s.declarations) || []) {
    const decl = ts.isImportSpecifier(d) ? d.parent.parent.parent : ts.isImportClause(d) ? d.parent : ts.isNamespaceImport(d) ? d.parent.parent : null;
    if (!decl || !decl.moduleSpecifier) continue;
    const ms = decl.moduleSpecifier.text;
    if (isProjectSpec(ms, d.getSourceFile().fileName)) return null;
    return `${libLabel(ms)}.${callee.getText().replace(/\s+/g, '').replace(/\(.*$/s, '')}`;
  }
  return null;
}
const reassignCache = new Map();
function isReassigned(d) {
  if (reassignCache.has(d)) return reassignCache.get(d);
  const sym = checker.getSymbolAtLocation(d.name); let hit = false;
  (function v(n) {
    if (hit) return;
    const target = ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment ? n.left
      : (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) ? n.operand : null;
    if (target && ts.isIdentifier(target) && checker.getSymbolAtLocation(target) === sym) hit = true;
    ts.forEachChild(n, v);
  })(d.getSourceFile());
  reassignCache.set(d, hit); return hit;
}
function libName(callee) {
  // `cors` imported from 'hono/cors' -> 'hono/cors.cors'
  const id = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  let s = checker.getSymbolAtLocation(id);
  if (!s) return rootImport(callee);
  const decls = s.declarations || [];
  for (const d of decls) {
    const ms = ts.isImportSpecifier(d) ? d.parent.parent.parent.moduleSpecifier.text : ts.isImportClause(d) ? d.parent.moduleSpecifier.text : null;
    // a project module (relative, aliased, workspace): a library call only when that module re-exports a library
    // function (O14 `export { cors } from 'hono/cors'`) or exports a member of a library call's result (O10)
    if (ms && isProjectSpec(ms, d.getSourceFile().fileName)) return libViaProject(s);
    if (ts.isImportSpecifier(d)) return `${libLabel(ms)}.${(d.propertyName || d.name).text}`;
    if (ts.isImportClause(d)) return `${libLabel(ms)}.default`;
  }
  // O10: `const { upgradeWebSocket } = createBunWebSocket()`: a member of a library call's result is a library function
  const lb = decls.find(x => ts.isBindingElement(x) && x.parent.parent.initializer && ts.isCallExpression(x.parent.parent.initializer)
    && x.parent.parent.initializer.expression.getText() !== 'require');
  if (lb) { const inner = libName(lb.parent.parent.initializer.expression); if (inner) return `${inner}().${(lb.propertyName || lb.name).getText()}`; }
  // `const { cors } = require('hono/cors')`: named by the required specifier, before alias resolution
  const bd = decls.find(x => ts.isBindingElement(x) && x.parent.parent.initializer && ts.isCallExpression(x.parent.parent.initializer)
    && x.parent.parent.initializer.expression.getText() === 'require' && ts.isStringLiteralLike(x.parent.parent.initializer.arguments[0]));
  if (bd) {
    const rs = bd.parent.parent.initializer.arguments[0].text;
    if (isProjectSpec(rs, bd.getSourceFile().fileName)) return libViaRequire(bd.parent.parent.initializer, (bd.propertyName || bd.name).getText());
    return `${libLabel(rs)}.${(bd.propertyName || bd.name).getText()}`;
  }
  if (s.flags & ts.SymbolFlags.Alias) { try { s = checker.getAliasedSymbol(s); } catch { } }
  const d = s.valueDeclaration || (s.declarations && s.declarations[0]);
  if (d && !isSrcDecl(d)) {
    const f = path.resolve(d.getSourceFile().fileName); const m = f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    return `${m ? m[1] : 'lib'}.${s.name}`;
  }
  // `const { cors } = require('hono/cors')`
  if (d && ts.isBindingElement(d) && d.parent.parent.initializer && ts.isCallExpression(d.parent.parent.initializer)
      && d.parent.parent.initializer.expression.getText() === 'require') {
    return `${d.parent.parent.initializer.arguments[0].text}.${(d.propertyName || d.name).getText()}`;
  }
  return null;
}
// a binding that names a library function: `const { f } = libCall()` (O10) or `const { f } = require('pkg')`
function libOfBinding(d) {
  if (!d || !ts.isBindingElement(d)) return null;
  const init = d.parent && d.parent.parent && d.parent.parent.initializer;
  if (!init || !ts.isCallExpression(init)) return null;
  const nm = (d.propertyName || d.name).getText();
  if (init.expression.getText() === 'require') {
    const a = init.arguments[0];
    if (!a || !ts.isStringLiteralLike(a)) return null;
    return isProjectSpec(a.text, d.getSourceFile().fileName) ? libViaRequire(init, nm) : `${libLabel(a.text)}.${nm}`;
  }
  const inner = libName(init.expression);
  return inner ? `${inner}().${nm}` : null;
}
// an import from a PROJECT module that ends at a library function: re-exported (`export { cors } from 'hono/cors'`,
// O14), or a project binding of one (`export const { upgradeWebSocket } = createBunWebSocket()`, O10)
function libViaProject(sym) {
  let s = sym;
  for (let i = 0; i < 12 && s && (s.flags & ts.SymbolFlags.Alias); i++) {
    for (const d of s.declarations || []) {
      const ed = ts.isExportSpecifier(d) ? d.parent.parent : null;
      if (ed && ed.moduleSpecifier && !isProjectSpec(ed.moduleSpecifier.text, d.getSourceFile().fileName))
        return `${libLabel(ed.moduleSpecifier.text)}.${(d.propertyName || d.name).text}`;
    }
    let n; try { n = checker.getImmediateAliasedSymbol(s); } catch { n = null; }
    if (!n || n === s) break;
    s = n;
  }
  if (s && (s.flags & ts.SymbolFlags.Alias)) { try { s = checker.getAliasedSymbol(s); } catch { } }
  const d = s && (s.valueDeclaration || (s.declarations && s.declarations[0]));
  if (!d) return null;
  if (!isSrcDecl(d)) { const m = path.resolve(d.getSourceFile().fileName).match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); return `${m ? m[1] : 'lib'}.${s.name}`; } // `export * from 'pkg'`
  return libOfBinding(d);
}
// a member of a PROJECT CommonJS module's exports that is a library function (`module.exports = { upgradeWebSocket }`)
function libViaRequire(reqCall, name) {
  const v = requireValue(reqCall);
  const p = v.k === 'obj' && v.props.get(name);
  if (!p || !p.node) return null;
  let id = p.node;
  if (ts.isIdentifier(id) && id.parent && ts.isShorthandPropertyAssignment(id.parent)) {
    const vs = checker.getShorthandAssignmentValueSymbol(id.parent);
    return libOfBinding(vs && (vs.valueDeclaration || (vs.declarations && vs.declarations[0])));
  }
  if (ts.isIdentifier(id)) return libOfBinding(declOf(id));
  return null;
}
// SPEC R2: a receiver whose DECLARED type is the app class (a property, field, getter, parameter) whose value
// the program does not show is an app of unknown prefix
function isTypedApp(expr) {
  let t;
  try { t = checker.getTypeAtLocation(expr); } catch { return false; }
  const sym = t && (t.getSymbol() || t.aliasSymbol);
  const d = sym && sym.declarations && sym.declarations[0];
  return !!(d && isHonoClassDecl(d));
}
function unresolvedAppCall(name, e) {
  const partial = (key, verb) => { out.partial.add(`${key}\t${verb}\tunresolved_app_value`); unknownAt(e, 'unresolved_app_value', key); };
  if (name === 'route') {
    const sub = evalExpr(e.arguments[1]);
    if (sub.k !== 'app') { unknownAt(e, 'unresolved_mount'); return UNK('app'); }
    // O23: inside a plugin method that a host calls over a list (the O11 pass), the mount is a list mount: the engine's
    // R13 reason, unresolved_mount; elsewhere a typed receiver of unknown value is unresolved_app_value (R2)
    partialMount(sub, pluginPass ? 'unresolved_mount' : 'unresolved_app_value', e, []);
    return UNK('app');
  }
  if (VERBS.includes(name) || name === 'on' || name === 'openapi') {
    const hs = argVals(e.arguments.slice(name === 'on' ? 2 : 1));
    const h = name === 'openapi' ? evalExpr(e.arguments[1]) : hs[hs.length - 1];
    const k = h && handlerKey(h);
    if (k) { partial(k, name === 'all' ? 'ANY' : name === 'on' || name === 'openapi' ? '?' : name.toUpperCase()); if (h.k === 'fn') handlerFns.add(h.node); }
    return UNK('app');
  }
  return UNK('app');
}
function isHonoClassDecl(d) {
  return d && (ts.isClassDeclaration(d) || ts.isVariableDeclaration(d)) && d.name
    && ['Hono', 'OpenAPIHono', 'HonoBase'].includes(d.name.getText()) && inPkg(d, ['hono', '@hono/zod-openapi']);
}
function classDeclOfNew(expr) {
  let s = checker.getSymbolAtLocation(expr);
  if (!s) return null;
  if (s.flags & ts.SymbolFlags.Alias) { try { s = checker.getAliasedSymbol(s); } catch { } }
  return s.valueDeclaration || (s.declarations && s.declarations[0]);
}

// ── expressions ─────────────────────────────────────────────────────────────
let depth = 0;
// O15: a bound on nested evaluation. Every value is computed by recursion over declarations, so a cycle the
// memo sets do not catch would overflow the stack; past the bound the value is unknown (a declared gap)
let evalDepth = 0;
const EVAL_DEPTH_MAX = 1200;
const cycles = new Set();
function noteCycle(n) { const l = loc(n); if (!cycles.has(l)) { cycles.add(l); if (DEBUG) process.stderr.write(`O15: evaluation cycle cut at ${l}\n`); } }
let evalCount = 0;
const inlineStack = [], hot = new Map();
function evalExpr(e) {
  if (DEBUG) {
    if (e && evalCount < 3000000) { const l = loc(e); hot.set(l, (hot.get(l) || 0) + 1); }
    if (++evalCount % 5000000 === 0) process.stderr.write(`O15 progress: ${evalCount} evaluations; inlined: ${inlineStack.join(' > ')}; hottest: ${[...hot].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => k + ' x' + n).join(', ')}\n`);
  }
  if (evalDepth >= EVAL_DEPTH_MAX) { if (e) noteCycle(e); return UNK('eval_depth'); }
  evalDepth++;
  try { return evalExpr0(e); } finally { evalDepth--; }
}
function evalExpr0(e) {
  if (!e) return UNK('none');
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression?.(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { k: 'str', v: e.text };
  if (ts.isTemplateExpression(e)) {
    let s = e.head.text;
    for (const sp of e.templateSpans) { const v = evalExpr(sp.expression); if (v.k !== 'str') return UNK('template_part'); s += v.v + sp.literal.text; }
    return { k: 'str', v: s };
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = evalExpr(e.left), b = evalExpr(e.right);
    return a.k === 'str' && b.k === 'str' ? { k: 'str', v: a.v + b.v } : UNK('concat_part');
  }
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    // `x ?? []`: the left value when the program shows it, else unknown (a run-time value may be there)
    const a = evalExpr(e.left);
    if (a.k === 'undef') return evalExpr(e.right);
    return a.k === 'unk' ? UNK('nullish') : a;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    let v = evalExpr(e.right); env.set(e, v);
    // SPEC R8a/R8b: an app holder re-pointed at a basePath clone of the SAME app under a condition is rebased only at
    // run time: every route registered through it afterwards is partial (dynamic_mount_prefix), never exact
    const rebase = (old) => (condDepth > 0 && v.k === 'app' && old && old.k === 'app' && old.store === v.store && old.base !== v.base && !v.dyn)
      ? (v = { ...v, dyn: 'dynamic_mount_prefix' }) : v;
    // SPEC 2 [iter2] flow through fields: `this.f = <app>` makes `this.f` that app in every method of the class
    if (ts.isPropertyAccessExpression(e.left) && e.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const fd = declOf(e.left.name); if (fd && isSrcDecl(fd)) env.set(fd, rebase(env.get(fd)));
    }
    // R8b: the same for a `let` variable (`let app = new Hono(); if (base) app = app.basePath(base)`): the binding
    // follows the assignment, so later registrations go through the (rebased) clone
    if (ts.isIdentifier(e.left)) {
      const vd = declOf(e.left);
      if (vd && ts.isVariableDeclaration(vd) && isSrcDecl(vd) && !(vd.parent.flags & ts.NodeFlags.Const) && env.has(vd) && v.k === 'app') env.set(vd, rebase(env.get(vd)));
    }
    return v;
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return { k: 'fn', node: e };
  if (e.kind === ts.SyntaxKind.NullKeyword) return UNDEF; // `null` and `undefined` are both an absent value here
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return UNDEF;
    const d = declOf(e);
    if (d && ts.isParameter(d)) return env.has(d) ? env.get(d) : UNK('parameter');
    if (d && ts.isVariableDeclaration(d) && !(d.parent.flags & ts.NodeFlags.Const) && !env.has(d)) return UNK('mutable');
    const v = valueOfDecl(d);
    if (v.k === 'str' && d && ts.isVariableDeclaration(d) && !(d.parent.flags & ts.NodeFlags.Const) && isReassigned(d)) return UNK('reassigned_let');
    return v;
  }
  if (ts.isArrayLiteralExpression(e)) {
    const items = [];
    for (const x of e.elements) {
      if (ts.isSpreadElement(x)) { const v = evalExpr(x.expression); if (v.k === 'list') items.push(...v.items); else items.push(v); }
      else items.push(evalExpr(x));
    }
    return { k: 'list', items };
  }
  if (ts.isObjectLiteralExpression(e)) {
    const props = new Map();
    let open = false;
    for (const p of e.properties) {
      if (p.name && ts.isComputedPropertyName(p.name)) open = true;
      if (ts.isGetAccessor(p) || ts.isSetAccessor(p)) open = true;
      if (ts.isPropertyAssignment(p)) {
        const pr = { node: p.initializer };
        // a nested object literal is evaluated now, while the parameters of an enclosing helper call are bound
        // (`({ content: { 'application/json': { schema } } })`, hono-3-04); a parameter read keeps its argument
        // inside a call being inlined every property is read NOW, as JavaScript does: read later, after the call's
        // locals are reset, `{ handler: routes }` would evaluate the local's initializer again (a second, empty app)
        if (ts.isObjectLiteralExpression(p.initializer) || depth > 0) pr.val = evalExpr(p.initializer);
        else if (ts.isIdentifier(p.initializer)) {
          const d = declOf(p.initializer); if (d && paramArgNode.has(d)) pr.argNode = paramArgNode.get(d);
          // a local of the function being inlined (`{ handler: routes }` returned by a factory) is read NOW: read
          // later, after the call's locals are reset, it would evaluate its initializer again (a second app)
        }
        props.set(p.name.getText().replace(/^['"]|['"]$/g, ''), pr);
      }
      else if (ts.isShorthandPropertyAssignment(p)) {
        const vs = checker.getShorthandAssignmentValueSymbol(p);
        const d = vs && (vs.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(vs) : vs);
        const dd = d && (d.valueDeclaration || (d.declarations && d.declarations[0]));
        const pr = { node: p.name, val: d ? valueOfDecl(dd) : UNK('shorthand') };
        if (dd && paramArgNode.has(dd)) pr.argNode = paramArgNode.get(dd);
        props.set(p.name.text, pr);
      }
      else if (ts.isMethodDeclaration(p)) props.set(p.name.getText(), { val: { k: 'fn', node: p } });
      else if (ts.isSpreadAssignment(p)) { const v = evalExpr(p.expression); if (v.k === 'obj') { if (v.open) open = true; for (const [k, x] of v.props) props.set(k, x); } else if (v.k !== 'undef') open = true; } // `{ ...helper(schema), required: true }`
    }
    // O24: an app written into an entry of a route list (`[{ path, handler: app }]`) is served only if something
    // mounts that entry; remember the entry so an app nothing mounts or serves is not reported as a root
    if (e.parent && ts.isArrayLiteralExpression(e.parent)) for (const [, pr] of props) if (pr.val && pr.val.k === 'app' && !pr.val.store.listEntry) pr.val.store.listEntry = pr.node || e;
    return { k: 'obj', props, node: e, open };
  }
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    const recv = calleeRecv.has(e.expression) ? calleeRecv.get(e.expression) : evalExpr(e.expression);
    let name = ts.isPropertyAccessExpression(e) ? e.name.text : (ts.isStringLiteralLike(e.argumentExpression) ? e.argumentExpression.text : null);
    if (name == null && ts.isElementAccessExpression(e) && recv.k === 'obj') { const kv = evalExpr(e.argumentExpression); if (kv.k === 'str') name = kv.v; } // `mods[path]` in a for..in
    if (recv.k === 'client') return { ...recv, segs: [...recv.segs, name == null ? HOLE : name] }; // a dynamic key is one segment
    if (recv.k === 'obj' && name != null && recv.props.has(name)) { const p = recv.props.get(name); if (!p.val) p.val = evalExpr(p.node); return p.val; }
    if (recv.k === 'obj' && recv.open === false && name != null && ts.isObjectLiteralExpression(recv.node) && !assignedPropNames().has(name)) return UNDEF;
    if (recv.k === 'undef') return UNDEF; // `x?.y` on an absent x (a plain read would throw: nothing runs either way)
    if (recv.k === 'module' && name != null) {
      const ed = moduleExportDecl(recv.sf, name); // through `export { x } from './x'` barrels
      if (ed) return valueOfDecl(ed);
      const s = checker.getSymbolAtLocation(e.name || e.argumentExpression); return s ? valueOfDecl(s.valueDeclaration) : UNK('module_member');
    }
    if (recv.k === 'app' && name === 'fetch') { recv.store.fetchRead = true; return { k: 'fetch', app: recv }; }
    // O17: `const createAdminMiddleware = adminFactory.createMiddleware` keeps the factory's method
    if (recv.k === 'factory' && ['createMiddleware', 'createHandlers', 'createApp'].includes(name)) return { k: 'factoryMethod', factory: recv, name };
    if (ts.isPropertyAccessExpression(e)) {
      const d = declOf(e.name);
      if (d && isSrcDecl(d) && (ts.isPropertyDeclaration(d) || ts.isPropertySignature(d))) {
        if (env.has(d)) return env.get(d); // a field assigned an app (`this.app = createApp()`)
        if (ts.isPropertyDeclaration(d) && d.initializer && !evaluating.has(d)) { evaluating.add(d); const v = evalExpr(d.initializer); evaluating.delete(d); env.set(d, v); return v; }
      } else if (d && isSrcDecl(d) && ts.isGetAccessorDeclaration(d) && d.body && depth < 8) return inline(d, []); // a getter is a call
      else if (d && isSrcDecl(d)) return valueOfDecl(d);
    }
    return UNK('member');
  }
  if (ts.isNewExpression(e)) {
    const d = classDeclOfNew(e.expression);
    if (isHonoClassDecl(d)) return newApp(e);
    // a subclass of Hono declared in the project
    if (d && ts.isClassDeclaration(d) && d.heritageClauses) {
      for (const h of d.heritageClauses) for (const t of h.types) if (isHonoClassDecl(classDeclOfNew(t.expression))) return newApp(e);
    }
    if (d && ts.isClassDeclaration(d) && isSrcDecl(d) && depth < 8) {
      for (const m of d.members) if (ts.isPropertyDeclaration(m) && m.initializer && !env.has(m)) { evaluating.add(m); env.set(m, evalExpr(m.initializer)); evaluating.delete(m); }
      const ctor = d.members.find(m => ts.isConstructorDeclaration(m) && m.body);
      if (ctor && !inlinedFns.has(ctor)) inline(ctor, e.arguments || []);
      return { k: 'instance', cls: d };
    }
    return UNK('new_other');
  }
  if (ts.isCallExpression(e)) return evalCall(e);
  if (ts.isAwaitExpression(e)) return evalExpr(e.expression);
  if (ts.isConditionalExpression(e)) {
    // `cond ? topoSort(list.filter(..)) : list.filter(..)`: two known lists are one list of their elements, a subset
    // of which runs (R13b)
    const a = evalExpr(e.whenTrue), b = evalExpr(e.whenFalse);
    if (a.k === 'list' && b.k === 'list') {
      const items = [...a.items]; for (const x of b.items) if (!items.includes(x)) items.push(x);
      const same = a.items.length === b.items.length && a.items.every(x => b.items.includes(x));
      return { k: 'list', items, derived: same ? joinDerived(a.derived, b.derived) : 'filtered' };
    }
    return UNK('conditional');
  }
  return UNK('expr');
}

const VERBS = ['get', 'post', 'put', 'delete', 'options', 'patch', 'query', 'all'];
function argVals(args) {
  const vs = [];
  for (const a of args) {
    if (ts.isSpreadElement(a)) { const v = evalExpr(a.expression); if (v.k === 'list') vs.push(...v.items); else vs.push(UNK('spread')); }
    else vs.push(evalExpr(a));
  }
  return vs;
}

// O15: the receiver of `a.b(..)` as evalCall computed it. A user-function lookup evaluates the callee `a.b` again,
// which re-evaluated `a`: twice per link, 2^n for a long builder chain (`.option(..)` x 20)
const calleeRecv = new Map();
// R12: module lists the program spells literally. `import.meta.glob(<literal pattern(s)>)` is an object keyed by the
// matched files' paths (eager: the module; lazy: a function returning it), `require.context(dir, deep, /re/)` a
// function over its keys; Object.entries / values / keys / fromEntries over a known object follow the values
function globRegex(pat) {
  let r = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '*' && pat[i + 1] === '*') { r += pat[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += pat[i + 2] === '/' ? 2 : 1; }
    else if (ch === '*') r += '[^/]*';
    else if (ch === '?') r += '[^/]';
    else if (ch === '{') { const j = pat.indexOf('}', i); r += '(?:' + pat.slice(i + 1, j).split(',').map(x => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j; }
    else r += ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r + '$');
}
function filesMatching(fromFile, pats) {
  const dir = path.dirname(path.resolve(fromFile)), hits = new Map();
  const pos = pats.filter(p => !p.startsWith('!')), neg = pats.filter(p => p.startsWith('!')).map(p => p.slice(1));
  for (const sf of srcFiles) {
    let r = path.relative(dir, path.resolve(sf.fileName)).split(path.sep).join('/');
    if (!r.startsWith('.')) r = './' + r;
    if (pos.some(p => globRegex(p).test(r)) && !neg.some(p => globRegex(p).test(r))) hits.set(r, sf);
  }
  return hits;
}
function moduleListCall(e) {
  const c = e.expression;
  if (!ts.isPropertyAccessExpression(c)) return null;
  const obj = c.expression, nm = c.name.text;
  if (ts.isMetaProperty(obj) && nm === 'glob') {
    const a = e.arguments[0] && evalExpr(e.arguments[0]);
    const pats = a && a.k === 'str' ? [a.v] : a && a.k === 'list' && a.items.every(x => x.k === 'str') ? a.items.map(x => x.v) : null;
    if (!pats) return UNK('glob');
    const opt = e.arguments[1] && evalExpr(e.arguments[1]);
    const eager = opt && opt.k === 'obj' && opt.props.has('eager') && opt.props.get('eager').node.kind === ts.SyntaxKind.TrueKeyword;
    const props = new Map();
    for (const [k, sf] of filesMatching(e.getSourceFile().fileName, pats)) {
      globbed.add(sf); evalModule(sf);
      const mod = moduleExports(sf);
      props.set(k, { val: eager ? mod : { k: 'thunk', val: mod } });
    }
    return { k: 'obj', props, node: e };
  }
  if (ts.isIdentifier(obj) && obj.text === 'require' && nm === 'context') {
    const d = e.arguments[0] && evalExpr(e.arguments[0]), deep = e.arguments[1] && e.arguments[1].kind === ts.SyntaxKind.TrueKeyword;
    const re = e.arguments[2] && ts.isRegularExpressionLiteral(e.arguments[2]) ? e.arguments[2].text : null;
    if (!d || d.k !== 'str' || !re) return UNK('require_context');
    const m = re.match(/^\/(.*)\/([a-z]*)$/), rx = new RegExp(m[1], m[2]);
    const base = path.resolve(path.dirname(e.getSourceFile().fileName), d.v), mods = new Map();
    for (const sf of srcFiles) {
      const f = path.resolve(sf.fileName); if (!f.startsWith(base + path.sep)) continue;
      const r = './' + path.relative(base, f).split(path.sep).join('/');
      if ((!deep && r.slice(2).includes('/')) || !rx.test(r)) continue;
      globbed.add(sf); evalModule(sf); mods.set(r, moduleExports(sf));
    }
    return { k: 'reqctx', mods };
  }
  // `Object.assign(fn, { meta })` returns its first argument
  if (ts.isIdentifier(obj) && obj.text === 'Object' && nm === 'assign' && e.arguments[0]) return evalExpr(e.arguments[0]);
  if (ts.isIdentifier(obj) && obj.text === 'Object' && ['entries', 'values', 'keys', 'fromEntries'].includes(nm)) {
    const v = e.arguments[0] && evalExpr(e.arguments[0]);
    if (nm === 'fromEntries') {
      if (!v || v.k !== 'list') return UNK('from_entries');
      const props = new Map();
      for (const it of v.items) if (it.k === 'list' && it.items[0] && it.items[0].k === 'str') props.set(it.items[0].v, { val: it.items[1] || UNK('entry') });
      return { k: 'obj', props, node: e, derived: v.derived };
    }
    if (!v || v.k !== 'obj') return UNK('object_' + nm);
    const ents = [...v.props].map(([k, p]) => [k, pv_(p)]);
    const items = nm === 'entries' ? ents.map(([k, x]) => ({ k: 'list', items: [{ k: 'str', v: k }, x] })) : nm === 'values' ? ents.map(([, x]) => x) : ents.map(([k]) => ({ k: 'str', v: k }));
    return { k: 'list', items, derived: v.derived };
  }
  return null;
}
const globbed = new Set(), opaqueMounts = [];
let pluginPass = false;
function isModuleListArg(a) {
  while (a && (ts.isParenthesizedExpression(a) || ts.isAsExpression(a) || ts.isNonNullExpression(a) || ts.isAwaitExpression(a))) a = a.expression;
  return !!a && ts.isPropertyAccessExpression(a) && a.name.text === 'default';
}
function methodOf(cls, name) {
  for (let c = cls, i = 0; c && i < 10; i++) {
    const m = c.members.find(x => ts.isMethodDeclaration(x) && x.body && x.name && x.name.getText() === name);
    if (m) return m;
    const h = c.heritageClauses && c.heritageClauses.find(x => x.token === ts.SyntaxKind.ExtendsKeyword);
    const b = h && classDeclOfNew(h.types[0].expression);
    c = b && ts.isClassDeclaration(b) && isSrcDecl(b) ? b : null;
  }
  return null;
}
function factoryCall(f, name, e) {
  if (name === 'createApp') { const a = newApp(e); if (f.initApp && depth < 8) inline(f.initApp, [], [a]); return a; }
  if (name === 'createMiddleware') return evalExpr(e.arguments[0]);
  return { k: 'list', items: argVals(e.arguments) }; // createHandlers
}
// R13: array methods over a KNOWN list follow the values. map/flatMap run the callback per element; a filter, a
// sort, a slice (a subset or a new order) gives the same elements marked `derived`: which of them run, and in which
// order, is decided at run time, so a mount over it is partial (unresolved_mount), never exact
function joinDerived(...ds) { return ds.includes('filtered') ? 'filtered' : ds.includes('reordered') ? 'reordered' : undefined; }
function listMethod(recv, name, e) {
  const cb = e.arguments[0] && evalExpr(e.arguments[0]);
  const call = (it, i) => cb && cb.k === 'fn' && cb.node.body && depth < 8 ? inline(cb.node, [], [it, { k: 'str', v: String(i) }]) : UNK('callback');
  if (name === 'map') return { k: 'list', items: recv.items.map(call), derived: recv.derived };
  if (name === 'flatMap') return { k: 'list', items: recv.items.flatMap((it, i) => { const v = call(it, i); return v.k === 'list' ? v.items : [v]; }), derived: recv.derived };
  if (name === 'forEach') { recv.items.forEach((it, i) => call(it, i)); return UNK('void'); }
  // R13b: a filter keeps a run-time SUBSET (each element's registrations are conditional); a sort / slice / reverse
  // keeps the elements in a run-time ORDER
  // a null element never survives the usual `filter((p) => !!p)`; and a body that reads it mounts nothing
  if (name === 'filter') return { k: 'list', items: recv.items.filter(it => it.k !== 'undef'), derived: 'filtered' };
  if (['sort', 'toSorted', 'slice', 'reverse', 'toReversed'].includes(name)) return { k: 'list', items: recv.items, derived: recv.derived || 'reordered' };
  if (name === 'push' || name === 'unshift') { const vs = argVals(e.arguments); recv.items[name === 'push' ? 'push' : 'unshift'](...vs); recv.derived = joinDerived(recv.derived, 'reordered', ...loopCtx.map(c => c.kind)); return { k: 'str', v: String(recv.items.length) }; }
  if (name === 'concat') { const more = argVals(e.arguments); return { k: 'list', items: [...recv.items, ...more.flatMap(v => v.k === 'list' ? v.items : [v])], derived: joinDerived(recv.derived, ...more.map(v => v.derived)) }; }
  return null;
}
// property names some assignment `a.<name> = ..` / `a['<name>'] = ..` writes anywhere in the program: a read of such a
// name on an object literal that lacks it may see the written value, so it stays unknown
let assignedProps = null;
function assignedPropNames() {
  if (assignedProps) return assignedProps;
  assignedProps = new Set();
  for (const sf of srcFiles) (function v(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = n.left;
      if (ts.isPropertyAccessExpression(l)) assignedProps.add(l.name.text);
      else if (ts.isElementAccessExpression(l) && ts.isStringLiteralLike(l.argumentExpression)) assignedProps.add(l.argumentExpression.text);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText() === 'Object' && ['assign', 'defineProperty', 'defineProperties'].includes(n.expression.name.text)) assignedProps.add('*');
    ts.forEachChild(n, v);
  })(sf);
  if (assignedProps.has('*')) assignedProps = { has: () => true }; // Object.assign(target, ..) can add any name
  return assignedProps;
}
function evalCall(e) {
  try { return evalCall0(e); } finally { if (ts.isPropertyAccessExpression(e.expression)) calleeRecv.delete(e.expression.expression); }
}
function evalCall0(e) {
  const callee = e.expression;
  const special = moduleListCall(e);
  if (special) return special;
  if (ts.isElementAccessExpression(callee)) { const f = evalExpr(callee); if (f.k === 'thunk') return f.val; }
  if (ts.isIdentifier(callee) && callee.text === 'require') return requireValue(e);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return requireValue(e); // O16: `await import('./m')` is that module
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    const recv = evalExpr(callee.expression);
    calleeRecv.set(callee.expression, recv); // O15: read back below instead of evaluating the chain again
    if (recv.k === 'app') return appMethod(recv, name, e);
    if (recv.k !== 'app' && isTypedApp(callee.expression)) return unresolvedAppCall(name, e);
    if (name === 'route' && e.arguments.length >= 2) {
      // SPEC 2 [iter2]: a mount argument is never a root, even when the receiver is not recognised
      const sub = evalExpr(e.arguments[1]);
      if (sub.k === 'app') { partialMount(sub, 'unresolved_mount', e, []); return UNK('route_on_unknown'); }
    }
    if (recv.k === 'client') return clientCall(recv, name, e);
    if (recv.k === 'factory' && ['createApp', 'createMiddleware', 'createHandlers'].includes(name)) return factoryCall(recv, name, e);
    if (recv.k === 'list') { const r = listMethod(recv, name, e); if (r) return r; }
    if (recv.k === 'undef') return UNDEF; // `routes.map(..)` on an absent list: nothing runs
    if (recv.k === 'reqctx' && name === 'keys') return { k: 'list', items: [...recv.mods.keys()].map(v => ({ k: 'str', v })) };
  }
  if (testCallbacks(e)) return UNK('test');
  const lname = libName(callee);
  if (lname) {
    const short = lname.split('.').pop();
    if (/^(hono\/factory|hono)\.createMiddleware$/.test(lname)) return evalExpr(e.arguments[0]);
    if (/^hono\/factory\.createFactory$/.test(lname)) {
      // SPEC 3.1: initApp's registrations happen first on every app the factory makes
      const o = e.arguments[0] && evalExpr(e.arguments[0]);
      const ia = o && o.k === 'obj' && o.props.get('initApp');
      const iv = ia && (ia.val || evalExpr(ia.node));
      return { k: 'factory', initApp: iv && iv.k === 'fn' ? iv.node : null };
    }
    if (/^hono\/client\.hc$/.test(lname)) {
      // JavaScript has no type argument: SPEC 3.5 matches the client against every served app (route_shape)
      const js = /\.(js|mjs|cjs|jsx)$/.test(e.getSourceFile().fileName) && !e.typeArguments;
      return { k: 'client', app: js ? 'ANY_APP' : clientApp(e), segs: [], via: 'hc' };
    }
    if (/^hono\/testing\.testClient$/.test(lname)) { const a = evalExpr(e.arguments[0]); return { k: 'client', app: a.k === 'app' ? a : null, segs: [], via: 'testClient' }; }
    if (/^@hono\/zod-openapi\.createRoute$/.test(lname)) return routeDef(e.arguments[0]);
    if (/^@hono\/node-server\.serve$/.test(lname)) { serveSite(e); return UNK('server'); }
    if (short === 'createRoute' || short === 'serve') return UNK('lib');
    const lf = { k: 'libfn', name: lname, site: loc(e) };
    if (/^(@hono\/zod-validator\.zValidator|hono\/validator\.validator)$/.test(lname) && e.arguments.length >= 2) {
      const t = evalExpr(e.arguments[0]);
      if (t.k === 'str') lf.validator = { target: t.v, schema: short === 'zValidator' ? e.arguments[1] : null };
    }
    if (/^hono\/combine\.(every|some|except)$/.test(lname)) {
      // the combinator is the middleware node; the project functions it runs are entry points
      const as = argVals(short === 'except' ? e.arguments.slice(1) : e.arguments);
      for (const v of as) if (v.k === 'fn') combinedFns.add(loc(v.node));
      if (short === 'except') {
        // SPEC 3.1: applies to its scope minus the literal excluded paths
        const ex = evalExpr(e.arguments[0]);
        const xs = ex.k === 'list' ? ex.items : [ex];
        if (xs.every(x => x.k === 'str')) lf.except = xs.map(x => x.v);
        else unknownAt(e, 'dynamic_except');
      }
    }
    return lf;
  }
  // a user function called here: inline it (factories, register(app) helpers, middleware factories)
  if (ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee)) {
    const f = evalExpr(callee);
    if (f.k === 'factoryMethod') return factoryCall(f.factory, f.name, e);
    if (f.k === 'thunk') return f.val;
    if (f.k === 'reqctx') { const k = evalExpr(e.arguments[0]); return k.k === 'str' && f.mods.has(k.v) ? f.mods.get(k.v) : UNK('require_context_key'); }
    // a method called on an instance the program built (`s.controller()` with `s` = new OAuth()): that class's own
    // method (or an inherited one), never every implementation of the declared type's method
    if (ts.isPropertyAccessExpression(callee) && calleeRecv.has(callee.expression) && calleeRecv.get(callee.expression).k === 'instance' && depth < 8) {
      const m = methodOf(calleeRecv.get(callee.expression).cls, callee.name.text);
      if (m) return inline(m, e.arguments);
    }
    if (f.k === 'fn' && f.node.body && depth < 8) return inline(f.node, e.arguments);
    if (f.k === 'fn' && !f.node.body && ts.isPropertyAccessExpression(callee) && depth < 8) {
      // an abstract / interface method on a receiver the program does not pin down: every project implementation
      // may run (hono-2-01), so each is evaluated and their results are all candidates
      const impls = implementationsOf(f.node);
      const vals = impls.map(m => inline(m, e.arguments));
      return vals.length === 1 ? vals[0] : { k: 'list', items: vals };
    }
  }
  if (testCallbacks(e)) return UNK('test');
  // O26: the arguments of a call the oracle cannot follow (`expect(await app.request('/x'))`) still run, in place:
  // left for a later pass, `app` would be read after the test's locals are reset, a second, empty app (unserved)
  for (const a of e.arguments) if (!ts.isFunctionLike(a)) evalExpr(a);
  return UNK('call');
}

// SPEC R1 (O1): an app built and exercised inside a test callback is a served root, so a test runner's
// callbacks (describe/it/test/hooks, incl. .only/.skip/.each(...)) are evaluated where they are registered
const TEST_FNS = new Set(['describe', 'it', 'test', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach', 'bench', 'suite']);
function testCallbacks(e) {
  let n = e.expression;
  while (ts.isPropertyAccessExpression(n) || ts.isCallExpression(n)) n = n.expression;
  if (!ts.isIdentifier(n) || !TEST_FNS.has(n.text)) return false;
  const d = declOf(n);
  if (d && isSrcDecl(d) && !ts.isImportSpecifier(d) && !(ts.isFunctionDeclaration(d) && !d.body)) return false; // a project function called `test` (an ambient `declare function it` is the runner's)
  for (const a of e.arguments) if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && depth < 8) inline(a, []);
  return true;
}
function implementationsOf(decl) {
  const owner = decl.parent, name = decl.name && decl.name.getText(), out = [];
  if (!owner || !name) return out;
  const ownerSym = owner.name && checker.getSymbolAtLocation(owner.name);
  for (const sf of srcFiles) (function v(n) {
    if (ts.isClassDeclaration(n) && n !== owner) {
      const t = checker.getTypeAtLocation(n);
      const bases = [...(checker.getBaseTypes ? (t.isClassOrInterface() ? checker.getBaseTypes(t) : []) : []), ...((n.heritageClauses || []).flatMap(h => h.types.map(x => checker.getTypeAtLocation(x))))];
      if (bases.some(b => b.getSymbol() === ownerSym)) for (const m of n.members) if (ts.isMethodDeclaration(m) && m.body && m.name.getText() === name) out.push(m);
    }
    ts.forEachChild(n, v);
  })(sf);
  return out;
}
function requireValue(e) {
  const s = e.arguments[0] && ts.isStringLiteralLike(e.arguments[0]) ? e.arguments[0].text : null;
  if (!s || !isProjectSpec(s, e.getSourceFile().fileName)) return UNK('require_pkg');
  const r = resolveSpec(s, e.getSourceFile().fileName);
  const sf = r && program.getSourceFile(r.resolvedFileName);
  if (!sf) return UNK('require_unresolved');
  evalModule(sf);
  return moduleExports(sf);
}
// the declaration an ES module exports under `name` (through re-exports)
function moduleExportDecl(sf, name) {
  const ms = checker.getSymbolAtLocation(sf);
  let ex = ms && checker.getExportsOfModule(ms).find(x => x.name === name);
  if (!ex) return null;
  if (ex.flags & ts.SymbolFlags.Alias) { try { ex = checker.getAliasedSymbol(ex); } catch { } }
  return ex.valueDeclaration || (ex.declarations && ex.declarations[0]) || null;
}
function moduleExports(sf) {
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.left.getText() === 'module.exports') return env.get(st.expression) ?? evalExpr(st.expression.right);
  }
  // O7: `module.exports.a = v` / `exports.a = v` make an exports object of those members
  const props = new Map();
  for (const st of sf.statements) {
    const be = ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken ? st.expression : null;
    const m = be && be.left.getText().match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/);
    if (m) props.set(m[1], { node: be.right, val: env.get(be) });
  }
  return props.size ? { k: 'obj', props, node: sf } : { k: 'module', sf };
}

const inlinedFns = new Set(), handlerFns = new Set();
const paramArgNode = new Map(); // a parameter of a function being inlined -> the argument expression it is bound to
function localDecls(fnNode) {
  const out = [];
  (function v(n) { if (n !== fnNode && ts.isFunctionLike(n)) return; if (ts.isVariableDeclaration(n) || ts.isBindingElement(n)) out.push(n); ts.forEachChild(n, v); })(fnNode.body || fnNode);
  return out;
}
function inline(fnNode, args, vals) {
  inlinedFns.add(fnNode);
  depth++;
  if (DEBUG) inlineStack.push(loc(fnNode));
  const saved = [];
  for (const d of localDecls(fnNode)) { saved.push([d, env.get(d)]); env.delete(d); } // R6: a fresh app per call
  const savedArgs = fnNode.parameters.map(p => [p, paramArgNode.get(p)]);
  // a parameter passed straight on (`jsonBody(schema, ..)` inside another helper) keeps the ORIGINAL argument
  const argNodes = fnNode.parameters.map((p, i) => {
    const a = !vals && !p.dotDotDotToken ? args[i] : null;
    if (!a) return null;
    const d = ts.isIdentifier(a) ? declOf(a) : null;
    return d && paramArgNode.has(d) ? paramArgNode.get(d) : a;
  });
  fnNode.parameters.forEach((p, i) => {
    if (argNodes[i]) paramArgNode.set(p, argNodes[i]); else paramArgNode.delete(p);
    saved.push([p, env.get(p)]);
    if (vals) env.set(p, vals[i] || UNK('missing_arg'));
    else if (p.dotDotDotToken) env.set(p, { k: 'list', items: argVals(args.slice(i)) });
    // a parameter a real call leaves out is undefined (R17: `hit(path)` sends no init, so GET), not unknown
    else env.set(p, args[i] ? evalExpr(args[i]) : (p.initializer ? evalExpr(p.initializer) : p.questionToken ? UNDEF : UNK('missing_arg')));
  });
  let ret = UNK('no_return');
  retAlts.push([]);
  if (fnNode.body && !ts.isBlock(fnNode.body)) ret = evalExpr(fnNode.body);
  else if (fnNode.body) ret = evalBlock(fnNode.body.statements) ?? UNK('no_return');
  // SPEC 3.1 (hono-3-03): a factory whose returns are several middleware (a pass-through arrow in a branch, a library
  // call otherwise) yields ALL of them, as alternatives at one chain position
  const alts = retAlts.pop();
  const mwLike = v => v && (v.k === 'fn' || v.k === 'libfn');
  if (alts.length && alts.every(mwLike) && (mwLike(ret) || (ret.k === 'unk' && ret.why === 'no_return'))) {
    const items = mwLike(ret) ? [...alts, ret] : alts;
    ret = items.length === 1 ? items[0] : { k: 'alt', items };
  }
  for (const [p, a] of savedArgs) { if (a === undefined) paramArgNode.delete(p); else paramArgNode.set(p, a); }
  for (const [p, v] of saved) { if (v === undefined) env.delete(p); else env.set(p, v); }
  if (DEBUG) inlineStack.pop();
  depth--;
  return ret;
}

const pv_ = p => p.val || (p.val = evalExpr(p.node)); // an object property's value, memoised
function routeDef(arg) {
  const o = evalExpr(arg);
  if (o.k !== 'obj') return UNK('route_object');
  const m = o.props.get('method'), p = o.props.get('path');
  const mv = m ? evalExpr(m.node) : UNK('no_method'), pv = p ? evalExpr(p.node) : UNK('no_path');
  const mwp = o.props.get('middleware');
  // SPEC 3.9: the request and response schemas of a route object, by validation target
  const schemas = [];
  const rq = o.props.get('request'), rqv = rq && (rq.val || evalExpr(rq.node));
  if (rqv && rqv.k === 'obj') {
    for (const [prop, target] of [['params', 'param'], ['query', 'query'], ['headers', 'header'], ['cookies', 'cookie']]) {
      const x = rqv.props.get(prop); if (x && x.node) schemas.push([target, x.argNode || x.node]);
    }
    const body = rqv.props.get('body'), bv = body && pv_(body);
    const content = bv && bv.k === 'obj' && bv.props.get('content'), cv = content && pv_(content);
    if (cv && cv.k === 'obj') for (const [mt, x] of cv.props) {
      const mv2 = pv_(x), sc = mv2.k === 'obj' && mv2.props.get('schema');
      if (sc) schemas.push([/json/.test(mt) ? 'json' : /form/.test(mt) ? 'form' : mt, sc.argNode || sc.node]);
    }
  }
  // hono-3-04: a response written by a project helper (`200: jsonContent(User, 'me')`) names the helper's argument
  const rs = o.props.get('responses'), rsv = rs && pv_(rs);
  if (rsv && rsv.k === 'obj') for (const [, x] of rsv.props) {
    const r1 = pv_(x), c1 = r1.k === 'obj' && r1.props.get('content'), cv1 = c1 && pv_(c1);
    if (cv1 && cv1.k === 'obj') for (const [, y] of cv1.props) { const yv = pv_(y), sc = yv.k === 'obj' && yv.props.get('schema'); if (sc) schemas.push(['response', sc.argNode || sc.node]); }
  }
  return { k: 'routedef', method: mv, path: pv, middleware: mwp ? evalExpr(mwp.node) : null, node: arg, schemas };
}

function clientApp(e) {
  const ta = e.typeArguments && e.typeArguments[0];
  if (!ta) return null;
  let t = ta;
  for (let i = 0; i < 4 && t; i++) {
    if (ts.isTypeQueryNode(t)) { const v = evalExpr(t.exprName); return v.k === 'app' ? v : null; }
    if (ts.isTypeReferenceNode(t)) {
      let s = checker.getSymbolAtLocation(t.typeName);
      if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      const d = s && s.declarations && s.declarations[0];
      t = d && ts.isTypeAliasDeclaration(d) ? d.type : null;
    } else break;
  }
  return null;
}

function serveSite(e) {
  const o = e.arguments[0] && evalExpr(e.arguments[0]);
  if (o && o.k === 'obj' && o.props.has('fetch')) evalExpr(o.props.get('fetch').node);
}

function appMethod(app, name, e) {
  const args = e.arguments, site = loc(e);
  if (VERBS.includes(name)) {
    const vs = argVals(args);
    let p, hs;
    if (vs[0] && vs[0].k === 'str') { app.path = vs[0].v; p = vs[0]; hs = vs.slice(1); }
    else if (vs[0] && vs[0].k === 'unk' && args[0] && isStringTyped(args[0])) { p = vs[0]; hs = vs.slice(1); }
    else { p = { k: 'str', v: app.path }; hs = vs; }
    hs.forEach((h, i) => addEntry(app, name.toUpperCase(), p, h, i === hs.length - 1 ? 'handler' : 'mw', site, e));
    return app;
  }
  if (name === 'on') {
    const mv = evalExpr(args[0]), pv = evalExpr(args[1]);
    const ms = mv.k === 'list' ? mv.items : [mv], ps = pv.k === 'list' ? pv.items : [pv];
    const hs = argVals(args.slice(2));
    if (ms.some(m => m.k !== 'str')) { const k = handlerKey(hs[hs.length - 1] || UNK('')); out.partial.add(`${k}\t?\tdynamic_verb`); unknownAt(e, 'dynamic_verb', k); return app; }
    if (ps.some(x => x.k !== 'str')) { for (const m of ms) addEntry(app, m.v.toUpperCase(), UNK('p'), hs[hs.length - 1], 'handler', site, e); return app; }
    for (const p of ps) { app.path = p.v; for (const m of ms) hs.forEach((h, i) => addEntry(app, m.v.toUpperCase(), p, h, i === hs.length - 1 ? 'handler' : 'mw', site, e)); }
    return app;
  }
  if (name === 'use') {
    const vs = argVals(args);
    let p, hs;
    if (vs[0] && vs[0].k === 'str') { p = vs[0]; hs = vs.slice(1); }
    else if (vs[0] && vs[0].k === 'unk' && args[0] && isStringTyped(args[0])) { for (const h of vs.slice(1)) unknownAt(e, 'dynamic_route_path', handlerKey(h) || undefined); return app; }
    else { p = { k: 'str', v: '*' }; hs = vs; }
    app.path = p.v;
    for (const h of hs) addEntry(app, 'ALL', p, h, 'mw', site, e);
    return app;
  }
  if (name === 'basePath') {
    const pv = evalExpr(args[0]);
    if (pv.k !== 'str') return { k: 'app', store: app.store, base: app.base, path: '/', origin: app.origin, dyn: 'dynamic_mount_prefix' };
    return { k: 'app', store: app.store, base: mergePath(app.base, pv.v), path: '/', origin: app.origin };
  }
  if (name === 'route') {
    const pv = evalExpr(args[0]), subv = evalExpr(args[1]);
    // a call dispatched over several implementations yields several apps: each is mounted the same way
    const subs = subv.k === 'list' ? subv.items.filter(x => x.k === 'app') : [subv];
    if (!subs.length || subs[0].k !== 'app') { unknownAt(e, 'unresolved_mount'); if (isModuleListArg(args[1])) opaqueMounts.push(e); return app; }
    for (const sub of subs) mountOne(app, pv, sub, e, site);
    return app;
  }
  return appMethod2(app, name, e);
}
// SPEC 3.3 [iter2]: a partial route (prefix unknown) still has a decidable chain: the sub-app's OWN middleware (matched
// inside the sub-app, whose paths are all under the one unknown prefix) after the parent's `*` / `/*` middleware
// registered before the mount. `mwp` rows: (mw, handler, verb, position); path and app are not decidable
const partialMw = new Set();
function partialMount(sub, reason, e, parentMws) {
  sub.store.mounted = true;
  const ents = [...sub.store.entries];
  const router = new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  ents.forEach((en, i) => router.add(en.method, en.path, i));
  ents.forEach((en, i) => {
    if (en.kind !== 'handler') return;
    const V = en.method === 'ALL' ? 'ANY' : en.method;
    out.partial.add(`${en.key}\t${V}\t${reason}`); unknownAt(e, reason, en.key);
    let matched; try { matched = router.match(en.method === 'ALL' ? 'GET' : en.method, samplePath(en.path))[0].map(x => x[0]); } catch { matched = null; }
    if (!matched || !matched.includes(i)) return;
    const seq = [...(parentMws || []), ...matched.filter(j => j < i).map(j => ents[j])];
    let at = -1, lastAlt;
    // a run-time middleware list before the route makes its partial chain dynamic too
    if (seq.some(x => x.kind === 'dyn')) out.unknown.add(`${en.site}\tdynamic_middleware_list\t${en.key}`);
    for (const x of seq) {
      if (x.kind === 'dyn' || !(x.kind === 'mw' || callsNext(x.val)) || (x.val.except && x.val.except.includes(en.path))) continue;
      if (!(x.alt && x.alt === lastAlt)) at++;
      lastAlt = x.alt; partialMw.add(`${x.key}\t${en.key}\t${V}\t${at}`);
    }
  });
}
// the parent's middleware that applies to every path (`*`, `/*`), registered before now, and the scoped ones that
// cannot be decided against an unknown prefix
function parentStarMws(app, e) {
  const all = [...app.store.entries, ...(app.store.dynMws || [])].sort((a, b) => a.seq - b.seq);
  const star = [];
  for (const m of all) if (m.kind === 'dyn' && m.method === 'ALL' && (m.path === '*' || m.path === '/*' || m.anyBase)) star.push(m);
  else if (m.kind === 'mw' && m.method === 'ALL') {
    if (m.path === '*' || m.path === '/*' || m.anyBase) star.push(m);
    else if (m.val.k === 'fn') out.unknown.add(`${loc(e)}\tpartial_route_scope\t${m.key}`);
  }
  return star;
}
function mountOne(app, pv, sub, e, site) {
  {
    sub.store.mounted = true;
    // R13b: a mount inside a loop over a filtered / reordered list of KNOWN elements is exact (conditional when
    // filtered); only an undecidable path is partial
    const why = app.dyn || (pv.k !== 'str' ? 'dynamic_mount_prefix' : null);
    if (why) {
      // every route of the sub-app is still emitted, partially, with the reason: never dropped; SPEC 3.3 [iter2]: a
      // scoped `use` already on this app cannot be decided against routes whose prefix is unknown
      const pm = sub.store.entries.some(r => r.kind === 'handler') ? parentStarMws(app, e) : [];
      partialMount(sub, why, e, pm);
      return app;
    }
    // the EFFECTIVE prefix: route() on a basePath'd app mounts under mergePath(base, prefix) (hono-base.js)
    out.submount.push(`${mergePath(app.base, pv.v)}\t${loc(e.expression.name)}`);
    const target = { ...app, base: mergePath(app.base, pv.v) };
    const ms = ++mountSeq, tag = loopTagNow(), filtered = loopCtx.some(c => c.kind === 'filtered');
    for (const r of [...sub.store.entries]) {
      target.store.entries.push({ ...r, seq: ++entrySeq, path: mergePath(target.base, r.path), site: r.site, alt: r.alt && `${r.alt}m${ms}`, loopTag: tag ? [...(r.loopTag || []), ...tag] : r.loopTag });
      if (filtered && r.kind === 'handler') unknownAt(e, 'conditional_registration', r.key);
    }
    return app;
  }
}
function appMethod2(app, name, e) {
  const args = e.arguments, site = loc(e);
  if (name === 'mount') {
    const pv = evalExpr(args[0]);
    if (pv.k !== 'str') { unknownAt(e, 'dynamic_mount_prefix'); return app; }
    const fv = evalExpr(args[1]);
    if (fv.k === 'fn') {
      // O8: a mounted foreign handler is a route (ANY prefix/*) with a middleware chain like any other
      app.store.foreign = app.store.foreign || []; app.store.foreign.push(loc(fv.node));
      app.store.entries.push({ seq: ++entrySeq, method: 'ALL', path: mergePath(app.base, pv.v, '*'), key: loc(fv.node), kind: 'handler', mount: true, site, val: fv, regFn: enclosingFn(e) });
    }
    else unknownAt(e, 'foreign_mount');
    return app;
  }
  if (name === 'openapi') {
    const rd = evalExpr(args[0]);
    if (rd.k !== 'routedef' || rd.method.k !== 'str' || rd.path.k !== 'str') { unknownAt(e, rd.k === 'routedef' && rd.method.k !== 'str' ? 'dynamic_verb' : 'dynamic_route_path', handlerKey(evalExpr(args[1])) || undefined); return app; }
    const h = evalExpr(args[1]);
    const mws = rd.middleware ? (rd.middleware.k === 'list' ? rd.middleware.items : [rd.middleware]) : [];
    const p = { k: 'str', v: rd.path.v.replaceAll(/\/{(.+?)}/g, '/:$1') };
    app.path = p.v;
    for (const m of mws) addEntry(app, rd.method.v.toUpperCase(), p, m, 'mw', site, e);
    addEntry(app, rd.method.v.toUpperCase(), p, h, 'handler', site, e);
    if (app.store.entries.length) app.store.entries[app.store.entries.length - 1].routedef = rd;
    return app;
  }
  if (name === 'notFound' || name === 'onError') {
    const h = evalExpr(args[0]);
    if (h.k === 'fn') app.store[name] = h;
    return app;
  }
  if (name === 'request') { requestCall(app, e); return UNK('response'); }
  if (name === 'fetch') { app.store.fetchRead = true; requestCall(app, e, true); return UNK('response'); }
  if (name === 'fire') app.store.fetchRead = true;
  if (name === 'doc' || name === 'doc31' || name === 'fire') return app;
  return UNK('app_method');
}

function isStringTyped(n) { const t = checker.getTypeAtLocation(n); return !!(t.flags & (ts.TypeFlags.StringLike)); }

function enclosingFn(n) {
  for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) && p.body) return loc(p);
  return `${rel(n.getSourceFile().fileName)}:1:1`; // the module initializer, as the IR places it
}

function requestCall(app, e, isFetch) {
  // app.request(url, init) | app.request(new Request(url, init)) | app.fetch(new Request(url, init), env)
  let urlArg = e.arguments[0], initArg = isFetch ? null : e.arguments[1];
  if (urlArg && ts.isNewExpression(urlArg) && urlArg.expression.getText() === 'Request') { initArg = urlArg.arguments && urlArg.arguments[1]; urlArg = urlArg.arguments && urlArg.arguments[0]; }
  else if (isFetch) return; // `fetch(req, env, ctx) { return app.fetch(req, env, ctx) }` forwards a request (R4): no call of its own
  let pv = evalExpr(urlArg);
  // SPEC 3.5 [iter2]: a template's undecidable hole stands for exactly one segment
  if (pv.k !== 'str' && urlArg && ts.isTemplateExpression(urlArg)) {
    let t = urlArg.head.text;
    for (const sp of urlArg.templateSpans) { const v = evalExpr(sp.expression); t += (v.k === 'str' ? v.v : HOLE) + sp.literal.text; }
    pv = { k: 'str', v: t };
  }
  if (pv.k !== 'str') { unknownAt(e, 'dynamic_rpc_path'); return; }
  const reqPath = /^https?:\/\//.test(pv.v) ? pv.v.replace(/^https?:\/\/[^/]*/, '') || '/' : pv.v;
  const method = httpMethodOf(initArg);
  pendingRequests.push({ app, method, path: reqPath.split(/[?#]/)[0], from: enclosingFn(e), site: loc(e) }); // R9
}
// SPEC R17 (O25): the HTTP method a request init gives. No init, an absent one, or a known object without `method`
// is GET (the default); a literal `method` is that verb; anything else (an init the program does not show, a
// non-literal method, a `method` some assignment may set later, hono-6-03) is '*': not decidable, so the request
// joins every route on its path, on any verb, with Confidence method_unknown (base_unknown wins when both are unknown)
function httpMethodOf(initArg) {
  const init = initArg && evalExpr(initArg);
  if (!init || init.k === 'undef') return 'GET';
  if (init.k !== 'obj') return '*';
  if (init.props.has('method')) { const m = evalExpr(init.props.get('method').node); return m.k === 'str' ? m.v.toUpperCase() : '*'; }
  return init.open || assignedPropNames().has('method') ? '*' : 'GET';
}
const ANY_VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
const HOLE = '\u0000';
const FILE_URL = 'file:';
const LOCAL_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::[^/?#]*)?([/?#].*)?$/;
// the URL a fetch spells, with HOLE for every piece the program does not show (R14: a non-literal base is a hole)
function urlText(x) {
  if (!x) return HOLE;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  if (ts.isStringLiteralLike(x)) return x.text;
  if (ts.isTemplateExpression(x)) { let t = x.head.text; for (const sp of x.templateSpans) t += urlText(sp.expression) + sp.literal.text; return t; }
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) return urlText(x.left) + urlText(x.right);
  if (ts.isNewExpression(x) && x.expression.getText() === 'URL' && x.arguments && x.arguments.length >= 1) {
    const p = urlText(x.arguments[0]);
    if (x.arguments.length === 1 || /^https?:\/\//.test(p)) return p;
    // O21: `new URL('../x.ttf', import.meta.url)` is a file next to the module, not a request
    const ba = x.arguments[1];
    if (ts.isPropertyAccessExpression(ba) && ts.isMetaProperty(ba.expression) && ba.name.text === 'url') return FILE_URL;
    const b = urlText(x.arguments[1]), o = b.match(/^https?:\/\/[^/?#]*/);
    return (o ? o[0] : HOLE) + (p.startsWith('/') ? p : '/' + p);
  }
  const v = evalExpr(x);
  return v.k === 'str' ? v.v : HOLE;
}
function localFetch(e) {
  const a = e.arguments[0];
  if (!a) return;
  const u = urlText(a);
  let p = null, conf = '';
  const m = u.match(LOCAL_URL);
  const sl = !m && u.match(/^https?:\/\/([A-Za-z0-9_-]+)(?::[^/?#]*)?([/?#].*)?$/); // R14a: a single-label host
  if (m) p = m[1] || '/';
  else if (sl && !/^\d+$/.test(sl[1])) { p = sl[2] || '/'; conf = 'base_unknown'; }
  else {
    // R14: a base the program does not spell (a parameter, an env read, `env.X ?? 'http://localhost:3003'`) may reach
    // this program's routes: joined on the path with confidence base_unknown. A literal external host never joins
    const r = u.startsWith(HOLE) ? u.replace(/^\u0000+(?::[^/?#]*)?/, '') : /^https?:\/\/\u0000/.test(u) ? u.replace(/^https?:\/\/[^/?#]*/, '') : null;
    if (r && r.startsWith('/')) { p = r; conf = 'base_unknown'; }
  }
  if (p == null) return;
  // O21: a base_unknown path with no literal segment (`${base}/${key}`) names no route
  if (conf && !p.split(/[?#]/)[0].split('/').some(x => x && x !== HOLE)) return;
  const method = httpMethodOf(e.arguments[1]);
  pendingRequests.push({ app: 'ANY_APP', method, path: (p.split(/[?#]/)[0]) || '/', from: enclosingFn(e), site: loc(e), local: true, conf });
}
// a path with holes against a route pattern: a hole, a `:param` (any form) is one segment; a trailing `*` is the rest
function shapeMatch(route, p) {
  const r = route.split('/').filter(Boolean), q = p.split('/').filter(Boolean);
  for (let i = 0; i < r.length; i++) {
    if (r[i] === '*' && i === r.length - 1) return true;
    if (i >= q.length) return false;
    // hono-5-07: `/api/skills${path}`: a segment of literal text then a hole that may span segments matches a route
    // segment starting with that text, and anything after it
    if (q[i] !== HOLE && q[i].includes(HOLE) && i === q.length - 1) return r[i].startsWith(q[i].split(HOLE)[0]) || (r[i].startsWith(':') && q[i].indexOf(HOLE) > 0);
    if (q[i] === HOLE || r[i].startsWith(':') || r[i] === '*') continue;
    if (r[i] !== q[i]) return false;
  }
  return r.length === q.length;
}
const CLIENT_VERBS = { $get: 'GET', $post: 'POST', $put: 'PUT', $delete: 'DELETE', $patch: 'PATCH', $options: 'OPTIONS' };
function clientCall(c, name, e) {
  if (name in CLIENT_VERBS) pendingRpc.push({ c, method: CLIENT_VERBS[name], from: enclosingFn(e), site: loc(e) });
  return UNK('client_response');
}
const pendingRequests = [], pendingRpc = [];
const platformFns = new Set();
const combinedFns = new Set();

// ── statements ──────────────────────────────────────────────────────────────
function evalBlock(stmts) {
  for (const st of stmts) { const r = evalStmt(st); if (r) return r; }
  return null;
}
function evalStmt(st) {
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) {
      if (!d.initializer || env.has(d)) continue;
      if (ts.isIdentifier(d.name)) env.set(d, evalExpr(d.initializer));
      else evalExpr(d.initializer);
    }
    return null;
  }
  if (ts.isExpressionStatement(st)) { evalExpr(st.expression); return null; }
  if (ts.isExportAssignment(st)) {
    const v = evalExpr(st.expression); env.set(st, v);
    // `export default { fetch: app.fetch, scheduled, queue }`: the platform calls the others too (SPEC 3.6)
    if (v.k === 'obj' && v.props.has('fetch')) for (const k of ['scheduled', 'queue']) {
      const p = v.props.get(k); if (!p) continue;
      const f = p.val || evalExpr(p.node); if (f.k === 'fn') platformFns.add(loc(f.node));
    }
    return null;
  }
  if (ts.isReturnStatement(st)) return st.expression ? evalExpr(st.expression) : UNK('void');
  if (ts.isIfStatement(st)) {
    const r0 = condReason; condReason = 'conditional_registration'; condDepth++;
    const s0 = entrySeq;
    const rt = evalStmt(st.thenStatement);
    const s1 = entrySeq;
    const re = st.elseStatement ? evalStmt(st.elseStatement) : null;
    // if / else each registering ONE middleware on the same app: one of them runs, at one chain position
    if (st.elseStatement && s1 - s0 === 1 && entrySeq - s1 === 1) {
      const a = stores.flatMap(x => x.entries).find(x => x.seq === s0 + 1), b = stores.flatMap(x => x.entries).find(x => x.seq === s1 + 1);
      if (a && b && a.kind === 'mw' && b.kind === 'mw' && a.method === b.method && a.path === b.path && !a.alt && !b.alt
          && stores.some(x => x.entries.includes(a) && x.entries.includes(b))) a.alt = b.alt = `a${++altSeq}`;
    }
    // R15 clause 2: if / else registering DIFFERENT numbers of middleware on one app: each branch starts at the same
    // position, and every later position on a chain holding them is decided at run time (dynamic_middleware_list)
    if (st.elseStatement && s1 > s0 && entrySeq > s1 && !(s1 - s0 === 1 && entrySeq - s1 === 1)) {
      for (const store of stores) {
        const tm = store.entries.filter(x => x.seq > s0 && x.seq <= s1 && x.kind === 'mw');
        const em = store.entries.filter(x => x.seq > s1 && x.seq <= entrySeq && x.kind === 'mw');
        if (!tm.length || !em.length || tm.length === em.length) continue;
        const g = `b${++altSeq}`;
        for (const x of tm) x.br = { g, side: 't' };
        for (const x of em) x.br = { g, side: 'e' };
      }
    }
    condDepth--; condReason = r0;
    // a return inside a branch is one of the function's results (kept as an alternative, see inline)
    for (const r of [rt, re]) if (r && retAlts.length) retAlts[retAlts.length - 1].push(r);
    return null;
  }
  if ((ts.isForOfStatement(st) || ts.isForInStatement(st)) && ts.isVariableDeclarationList(st.initializer) && st.initializer.declarations.length === 1) {
    let it = evalExpr(st.expression);
    // `for (const k in obj)`: the keys of a known object (an import.meta.glob result, R12)
    if (ts.isForInStatement(st)) it = it.k === 'obj' ? { k: 'list', items: [...it.props.keys()].map(v => ({ k: 'str', v })), derived: it.derived } : UNK('for_in');
    if (it.k === 'undef') return null; // a loop over an absent property runs no times
    if (it.k === 'list') {
      // a loop over a known list: the body runs once per element with the variable bound (still a loop registration);
      // array and object patterns bind the element's parts (`for (const [, mod] of Object.entries(m))`)
      const vd = st.initializer.declarations[0], r0 = condReason, saved = [];
      const decls = []; (function ds(n) { if (ts.isIdentifier(n)) return; for (const el of n.elements) if (ts.isBindingElement(el)) { decls.push(el); ds(el.name); } })(vd.name);
      for (const d of [vd, ...decls]) saved.push([d, env.get(d)]);
      condReason = 'loop_registration'; condDepth++;
      const lid = ++loopSeq;
      it.items.forEach((item, idx) => {
        if (item.k === 'undef') return; // a null element: the body guards it or throws, it mounts nothing
        if (it.derived) loopCtx.push({ id: lid, idx, kind: it.derived });
        bindPattern(vd, vd.name, item); evalStmt(st.statement);
        if (it.derived) loopCtx.pop();
      });
      condDepth--; condReason = r0;
      for (const [d, v] of saved) { if (v === undefined) env.delete(d); else env.set(d, v); }
      return null;
    }
  }
  if (ts.isForOfStatement(st) || ts.isForStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st)) { const r0 = condReason; condReason = 'loop_registration'; condDepth++; evalStmt(st.statement); condDepth--; condReason = r0; return null; }
  if (ts.isBlock(st)) return evalBlock(st.statements);
  return null;
}

let condDepth = 0, condReason = '', loopSeq = 0;
// R13b: the derived (filtered / reordered) loops the evaluation is inside, with the element index of each
const loopCtx = [];
const loopTagNow = () => loopCtx.length ? loopCtx.map(c => `${c.id}:${c.idx}`) : undefined;
function bindPattern(decl, name, v) {
  if (ts.isIdentifier(name)) { env.set(decl, v); return; }
  if (ts.isArrayBindingPattern(name)) name.elements.forEach((el, i) => { if (ts.isBindingElement(el)) bindPattern(el, el.name, v.k === 'list' && v.items[i] ? v.items[i] : UNK('pattern')); });
  else if (ts.isObjectBindingPattern(name)) for (const el of name.elements) {
    const key = (el.propertyName || el.name).getText(), p = v.k === 'obj' && v.props.get(key);
    bindPattern(el, el.name, p ? pv_(p) : v.k === 'module' && moduleExportDecl(v.sf, key) ? valueOfDecl(moduleExportDecl(v.sf, key)) : UNK('pattern'));
  }
}
const retAlts = [];
const evaluated = new Set();
function evalModule(sf) {
  if (evaluated.has(sf)) return;
  evaluated.add(sf);
  // imports first, in source order: ES module evaluation order
  for (const st of sf.statements) {
    const spec = (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && st.moduleSpecifier.text;
    if (!spec || (ts.isImportDeclaration(st) && st.importClause && st.importClause.isTypeOnly)) continue;
    const r = resolveSpec(spec, sf.fileName);
    const dep = r && program.getSourceFile(r.resolvedFileName);
    if (dep && srcFiles.includes(dep)) evalModule(dep);
  }
  for (const st of sf.statements) evalStmt(st);
}
phase('typechecked');
for (const sf of srcFiles) evalModule(sf);
phase('modules evaluated');
// O11: a method of an object literal that nothing in the program calls but that mounts sub-apps (a plugin's
// `register(app) { app.route('/x', sub) }`, called by a host over a run-time plugin list) still runs: its parameters
// are unknown, so the sub-apps it mounts are mounted under an unknown receiver (partial), never roots. It runs before
// the uncalled-function pass below, so a builder it calls makes the mounted app, not a second root
const mountsInside = f => { let hit = false; (function v(n) { if (hit) return; if (n !== f && ts.isFunctionLike(n)) return; if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'route' && n.arguments.length >= 2) hit = true; ts.forEachChild(n, v); })(f.body); return hit; };
for (const sf of srcFiles) (function v(n) {
  if (ts.isObjectLiteralExpression(n)) for (const p of n.properties) {
    const f = ts.isMethodDeclaration(p) ? p : ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer)) ? p.initializer : null;
    if (f && f.body && !inlinedFns.has(f) && !handlerFns.has(f) && mountsInside(f)) { pluginPass = true; inline(f, []); pluginPass = false; }
  }
  ts.forEachChild(n, v);
})(sf);
// O2: a module-level function nothing in the program calls (a server assembled inside `startServer(opts)`)
// still runs when its caller outside the program calls it: evaluate each such body once, parameters unknown
for (const sf of srcFiles) for (const st of sf.statements) {
  const fns = [];
  if (ts.isFunctionDeclaration(st) && st.body) fns.push(st);
  if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns.push(d.initializer);
  for (const f of fns) if (!inlinedFns.has(f) && !handlerFns.has(f)) inline(f, []);
}
phase('uncalled functions evaluated');
// test and client code runs in functions nobody in the program calls (a test runner does): visit every
// `.request(...)` and `.$verb(...)` call not yet seen and evaluate its receiver: a read with no
// registration side effect, so it cannot add a route
const seenSites = new Set([...pendingRequests, ...pendingRpc].map(r => r.site));
function sweep(n) {
  // hono-3-02: the platform `fetch` to this machine (`http://localhost:${port}/x`) is a request to the served apps,
  // matched on their composed full paths
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fetch' && !seenSites.has(loc(n))) {
    const d = declOf(n.expression);
    if (!d || !isSrcDecl(d)) { seenSites.add(loc(n)); localFetch(n); }
  }
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    const nm = n.expression.name.text;
    if ((nm === 'request' || nm === 'fetch' || nm in CLIENT_VERBS) && !seenSites.has(loc(n))) {
      seenSites.add(loc(n));
      const recv = evalExpr(n.expression.expression);
      if (recv.k === 'app' && (nm === 'request' || nm === 'fetch')) requestCall(recv, n, nm === 'fetch');
      else if (recv.k === 'client') clientCall(recv, nm, n);
    }
  }
  ts.forEachChild(n, sweep);
}
srcFiles.forEach(sweep);

phase('requests swept');
// R12.2: when a mount reads its app from a module list the program cannot spell (`mod.default` over a run-time list),
// a default-exported app that no module imports, nothing mounts, and nothing serves (no `fetch` read, no fire()) may be
// one of those modules: its routes are partial (unresolved_mount), never exact roots. The module that performs the
// mount, and every module that imports it, is the entry, never a candidate
if (opaqueMounts.length) {
  const imported = new Set(globbed), importsOf = new Map();
  for (const sf of srcFiles) {
    const deps = [];
    (function v(n) {
      let spec = null;
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) spec = n.moduleSpecifier.text;
      else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) spec = n.arguments[0].text;
      if (spec) { const r = resolveSpec(spec, sf.fileName); const d = r && program.getSourceFile(r.resolvedFileName); if (d && srcFiles.includes(d)) { deps.push(d); imported.add(d); } }
      ts.forEachChild(n, v);
    })(sf);
    importsOf.set(sf, deps);
  }
  const entry = new Set(opaqueMounts.map(e => e.getSourceFile()));
  for (let grew = true; grew;) { grew = false; for (const [sf, deps] of importsOf) if (!entry.has(sf) && deps.some(d => entry.has(d))) { entry.add(sf); grew = true; } }
  for (const sf of srcFiles) {
    if (imported.has(sf) || entry.has(sf)) continue;
    for (const st of sf.statements) {
      const v = ts.isExportAssignment(st) && !st.isExportEquals ? env.get(st) : null;
      if (!v || v.k !== 'app' || v.store.mounted || v.store.fetchRead) continue;
      partialMount(v, 'unresolved_mount', opaqueMounts[0], []);
    }
  }
}
// ── results ─────────────────────────────────────────────────────────────────
// SPEC 3.3 rule 4: a verb registration whose function declares `next` and calls it is middleware
// for the later routes it matches
function callsNext(v) {
  if (v.k !== 'fn' || !v.node.parameters || v.node.parameters.length < 2) return false;
  const nx = v.node.parameters[1].name; if (!ts.isIdentifier(nx)) return false;
  let hit = false;
  (function f(n) { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nx.text) hit = true; ts.forEachChild(n, f); })(v.node.body);
  return hit;
}
function samplePath(p) {
  // a concrete request path the pattern matches (checked below against the router itself)
  return p.split('/').map(seg => {
    if (seg === '*') return 'w';
    return seg.replace(/:([A-Za-z0-9_]+)(\{([^}]*)\})?\??/g, (_, n, __, re) => {
      if (!re) return 'v1';
      for (const c of ['1', 'a', 'v1', 'x.png', 'abc', '2024']) if (new RegExp(`^(?:${re})$`).test(c)) return c;
      return 'v1';
    });
  }).join('/').replace(/\*/g, 'w') || '/';
}
// O24 / R13: an app that only a route-list entry holds, that nothing mounts, requests, reads `.fetch` of or makes a
// client for, is served at no path: no exact root. Its handlers routed by no other app are partial unresolved_mount
// (a loader the program does not show may mount the entry); handlers another app serves need nothing more
{
  const reqd = new Set([...pendingRequests, ...pendingRpc.map(r => ({ app: r.c.app }))].map(r => r.app && r.app.store).filter(Boolean));
  for (const st of stores) if (st.listEntry && !st.mounted && !st.fetchRead && !reqd.has(st)) st.dropped = true;
  const routed = new Set(stores.filter(st => !st.dropped).flatMap(st => st.entries.filter(en => en.kind === 'handler').map(en => en.key)));
  for (const st of stores.filter(x => x.dropped)) for (const en of st.entries) {
    if (en.kind !== 'handler' || routed.has(en.key)) continue;
    const V = en.method === 'ALL' ? 'ANY' : en.method;
    out.partial.add(`${en.key}\t${V}\tunresolved_mount`); unknownAt(st.listEntry, 'unresolved_mount', en.key);
  }
}
const roots = stores.filter(s => !s.mounted && !s.dropped);
const allFns = new Set();
const chains = []; // { handler, chain:[keys], store }
for (const st of stores) {
  for (const en of st.entries) if (en.val.k === 'fn') allFns.add(en.key);
  for (const k of ['notFound', 'onError']) if (st[k]) allFns.add(loc(st[k].node));
  for (const f of st.foreign || []) allFns.add(f);
  for (const m of st.dynMws || []) if (m.val.k === 'fn') allFns.add(m.key); // middleware registered on a rebased holder
  if (st.mounted || st.dropped) continue;
  const router = new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  st.entries.forEach((en, i) => router.add(en.method, en.path, i));
  st.entries.forEach((en, i) => {
    if (en.kind !== 'handler') return;
    const V = en.method === 'ALL' ? 'ANY' : en.method;
    out.route.push(`${V}\t${en.path}\t${en.key}\t${st.origin}\t${i}`);
    // SPEC 4 [iter2] route_registered_by: the method enclosing the registering call
    out.regby.add(`${en.regFn}\t${en.key}\t${V}\t${en.path}\t${st.origin}`);
    const m = en.method === 'ALL' ? 'GET' : en.method;
    const sp = samplePath(en.path);
    let matched;
    try { matched = router.match(m, sp)[0].map(x => x[0]); } catch (err) { matched = null; }
    if (!matched || !matched.includes(i)) { out.unknown.add(`${en.site}\tORACLE_UNDECIDED_mw_chain\t${en.key}`); return; }
    const chain = [], pos = [];
    let dynamic = false, at = -1, lastAlt, brOpen = null; const brs = new Map();
    for (const j of matched) {
      if (j === i) break; const x = st.entries[j]; if (x.kind === 'dyn') { dynamic = true; continue; }
      // R15 clause 2: an unequal if / else pair: each branch counts from the same base; positions after it continue
      // after the longer branch, and the chain is dynamic_middleware_list
      if (x.br && (x.kind === 'mw' || callsNext(x.val))) {
        const b = brs.get(x.br.g) || { base: at, t: 0, e: 0 }; brs.set(x.br.g, b);
        const p = b.base + (++b[x.br.side]); at = Math.max(at, p); lastAlt = undefined;
        chain.push(x.key); pos.push(p); brOpen = x.br.g; continue;
      }
      if (brOpen && (x.kind === 'mw' || callsNext(x.val))) dynamic = true;
      // R13b: middleware another element of a filtered / reordered loop brought in may be absent or elsewhere
      if (x.loopTag && x.loopTag.some(t => !(en.loopTag || []).includes(t)) && (x.kind === 'mw' || callsNext(x.val))) dynamic = true;
      if ((x.kind === 'mw' || callsNext(x.val)) && !(x.val.except && x.val.except.includes(en.path))) {
        if (!(x.alt && x.alt === lastAlt)) at++; // alternatives of one factory call share a position (hono-3-03)
        lastAlt = x.alt; chain.push(x.key); pos.push(at);
      }
    }
    if (dynamic) out.unknown.add(`${en.site}\tdynamic_middleware_list\t${en.key}`);
    // R3: the served root app the chain belongs to is part of the row (one chain per app)
    chain.forEach((mk, o) => out.mw.push(`${mk}\t${en.key}\t${V}\t${en.path}\t${pos[o]}\t${st.origin}`));
    chains.push({ handler: en.key, chain, store: st, entry: en });
  });
}
for (const f of platformFns) allFns.add(f);
// a handler registered on a recognised app is an http entry point even when its path is only partly
// known (orchestrator ruling, iteration 1): the framework still calls it
for (const r of out.partial) { const k = r.split('\t')[0]; if (!k.startsWith('lib:')) allFns.add(k); }
for (const f of combinedFns) allFns.add(f);
for (const f of allFns) out.entry.add(`${f}\thttp`);

// ctx: c.set(K) in a function of a chain -> c.get(K) / c.var.K in a later function of the same chain
const sets = new Map(), gets = new Map(); // fnloc -> Set(key)
function isContext(n) {
  // untyped JavaScript: the first parameter of a function the router calls (a registered handler or middleware)
  if (ts.isIdentifier(n)) {
    const d = declOf(n);
    if (d && ts.isParameter(d) && d.parent.parameters[0] === d && allFns.has(loc(d.parent))) return true;
  }
  const t = checker.getTypeAtLocation(n);
  const s = t.getSymbol() || t.aliasSymbol;
  const d = s && s.declarations && s.declarations[0];
  return !!(d && s.name === 'Context' && inPkg(d, ['hono']));
}
// within ONE function a key flows to itself only when a read comes after a set (SPEC 3.4, j == i)
const firstSet = new Map(), lastGet = new Map();
function notePos(f, k, isSet, pos) {
  const key = f + '\t' + k;
  if (isSet) { if (!firstSet.has(key) || pos < firstSet.get(key)) firstSet.set(key, pos); }
  else if (!lastGet.has(key) || pos > lastGet.get(key)) lastGet.set(key, pos);
}
const selfFlows = (f, k) => firstSet.has(f + '\t' + k) && lastGet.has(f + '\t' + k) && firstSet.get(f + '\t' + k) < lastGet.get(f + '\t' + k);
function scanCtx(n) {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['set', 'get'].includes(n.expression.name.text)
      && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && isContext(n.expression.expression)) {
    const isSet = n.expression.name.text === 'set';
    const m = isSet ? sets : gets;
    const f = enclosingFn(n); if (!m.has(f)) m.set(f, new Set()); m.get(f).add(n.arguments[0].text);
    notePos(f, n.arguments[0].text, isSet, n.getStart());
  }
  if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'var'
      && isContext(n.expression.expression)) {
    const f = enclosingFn(n); if (!gets.has(f)) gets.set(f, new Set()); gets.get(f).add(n.name.text);
    notePos(f, n.name.text, false, n.getStart());
  }
  ts.forEachChild(n, scanCtx);
}
srcFiles.forEach(scanCtx);
for (const { handler, chain } of chains) {
  const seq = [...chain, handler];
  seq.forEach((s, i) => {
    for (const k of sets.get(s) || []) for (let j = i; j < seq.length; j++) if ((gets.get(seq[j]) || new Set()).has(k) && (j > i || selfFlows(s, k))) out.ctx.add(`${s}\t${seq[j]}\t${k}`);
  });
}
// SPEC R23: a partial route's DECIDED chain (its `mwp` rows; a may-apply middleware is not in it) carries context keys
// exactly as an exact chain does: a setter at position p flows to a reader at a later position or to the handler
const pchains = new Map(); // handler -> [{ fn, at }]
{ const routed = new Set(out.route.map(r => r.split('\t')[2]));
  for (const r of partialMw) { const [m, h, , at] = r.split('\t'); if (routed.has(h)) continue;
    if (!pchains.has(h)) pchains.set(h, []); pchains.get(h).push({ fn: m, at: +at }); } }
for (const [h, ms] of pchains) {
  const seq = [...ms, { fn: h, at: Infinity }];
  for (const a of seq) for (const k of sets.get(a.fn) || []) for (const b of seq)
    if ((gets.get(b.fn) || new Set()).has(k) && (b.at > a.at || (b.fn === a.fn && selfFlows(a.fn, k)))) out.ctx.add(`${a.fn}\t${b.fn}\t${k}`);
}
// a reader whose key no function earlier on any of its chains sets: SPEC 3.4 no_setter_on_chain
for (const [r, keys] of gets) for (const k of keys) {
  if ([...out.ctx].some(x => x.split('\t')[1] === r && x.split('\t')[2] === k)) continue;
  if (!chains.some(c => c.handler === r || c.chain.includes(r)) && !pchains.has(r) && ![...pchains.values()].some(ms => ms.some(m => m.fn === r))) continue;
  out.unknown.add(`${r}\tno_setter_on_chain\t${r}`);
}

// rpc and app.request: matched by Hono's router on the target app's store
function routerFor(st) {
  if (!st._router) { st._router = new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] }); st.entries.forEach((en, i) => st._router.add(en.method, en.path, i)); }
  return st._router;
}
const verbOk = (en, m) => m === '*' || en.method === m || en.method === 'ALL';
// R17: the first handler Hono's router picks for this path, per verb (every verb when the method is '*')
function firstHandlers(st, m, p) {
  const out_ = [];
  for (const v of m === '*' ? ANY_VERBS : [m === 'HEAD' ? 'GET' : m]) {
    let hs; try { hs = routerFor(st).match(v, p)[0].map(x => st.entries[x[0]]); } catch { hs = []; }
    const h = hs.find(x => x.kind === 'handler'); if (h && !out_.includes(h)) out_.push(h);
  }
  return out_;
}
const holeRows = (r, entries, p) => {
  const hs = entries.filter(en => en.kind === 'handler' && verbOk(en, r.method) && shapeMatch(en.path, p));
  const shown = p.split(HOLE).join('${}');
  if (!hs.length) { out.unknown.add(`${r.site}\tdynamic_rpc_path\t${r.from}`); return; }
  for (const h of hs) (r.c ? out.rpc : out.request).add(`${r.from}\t${r.method}\t${shown}\t${h.key}${r.method === '*' ? '\tmethod_unknown' : ''}`);
};
for (const r of pendingRequests) {
  if (r.app === 'ANY_APP') {
    // a request to this machine: every served root app may answer; no row when none does (it may be another process)
    const isTest = f => /(\.test\.|\.spec\.|__tests__\/)/.test(f);
    for (const st of stores.filter(x => !x.mounted && !x.dropped)) {
      const cf = r.conf ? `\t${r.conf}` : r.method === '*' ? '\tmethod_unknown' : '';
      // O21: a request whose base is unknown is not joined to a test file's app from outside test code
      if (r.conf && isTest(st.origin) && !isTest(r.site)) continue;
      if (r.path.includes(HOLE)) { for (const h of st.entries.filter(en => en.kind === 'handler' && verbOk(en, r.method) && shapeMatch(en.path, r.path))) out.request.add(`${r.from}\t${r.method}\t${r.path.split(HOLE).join('${}')}\t${h.key}${cf}`); continue; }
      // O21: an unknown-base request reaching only a catch-all handler is no route match
      for (const h of firstHandlers(st, r.method, r.path)) if (!(r.conf && /(^|\/)\*$/.test(h.path))) out.request.add(`${r.from}\t${r.method}\t${r.path}\t${h.key}${cf}`);
    }
    continue;
  }
  if (r.path.includes(HOLE)) { holeRows(r, r.app.store.entries, r.path); continue; }
  const hs = firstHandlers(r.app.store, r.method, r.path);
  for (const h of hs) out.request.add(`${r.from}\t${r.method}\t${r.path}\t${h.key}${r.method === '*' ? '\tmethod_unknown' : ''}`);
  if (!hs.length) out.unserved.add(`${r.from}\t${r.method} ${r.path}`);
}
for (const r of pendingRpc) {
  if (!r.c.app) { out.unknown.add(`${r.site}\tunresolved_rpc_app_type\t${r.from}`); continue; }
  const segs = r.c.segs.filter(s => s !== 'index');
  const p = '/' + segs.join('/');
  // the client spells the PATTERN; it is served by the handler registered under exactly that pattern
  const cand = r.c.app === 'ANY_APP' ? stores.filter(st => !st.mounted && !st.dropped).flatMap(st => st.entries) : r.c.app.store.entries;
  if (p.includes(HOLE)) { holeRows(r, cand, p); continue; }
  const hs = cand.filter(en => en.kind === 'handler' && (en.method === r.method || en.method === 'ALL') && en.path === p);
  const h = hs[0];
  for (const x of hs.slice(1)) if (r.c.app === 'ANY_APP') out.rpc.add(`${r.from}\t${r.method}\t${p}\t${x.key}`);
  if (h) out.rpc.add(`${r.from}\t${r.method}\t${p}\t${h.key}`);
  else out.unserved.add(`${r.from}\t${r.method} ${p}`);
}

// ── SPEC 3.9: route_schema and valid_read ──────────────────────────────────
// A schema is named by its DECLARATION: a const's name (`<file>:<line>:<col>` of the identifier, as the
// IR places a variable), or `expr@<loc>` for an inline schema. Composition carries it: every project
// schema const a schema is built from (extend/merge/pick/omit/partial, z.array(B), fields, .openapi()) is a
// base, and the route is reached from each base too.
function schemaKey(n) {
  if (!n) return { key: 'expr@?', init: undefined }; // a createRoute schema slot with no expression node (stress-2 guard)
  if (n.parent && ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n) {
    // `{ schema }` shorthand: the schema is the variable the shorthand names
    const vs = checker.getShorthandAssignmentValueSymbol(n.parent); const d = vs && vs.valueDeclaration;
    if (d && ts.isVariableDeclaration(d) && isSrcDecl(d) && d.initializer) return { key: loc(d.name), init: d.initializer };
  }
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression?.(n)) n = n.expression;
  if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
    const d = declOf(ts.isPropertyAccessExpression(n) ? n.name : n);
    if (d && ts.isVariableDeclaration(d) && isSrcDecl(d) && d.initializer) return { key: loc(d.name), init: d.initializer };
  }
  return { key: `expr@${loc(n)}`, init: n };
}
function schemaBases(init, seen = new Set()) {
  const out = [];
  if (!init) return out; // stress-2 guard
  (function v(n) {
    if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      const d = declOf(n);
      if (d && ts.isVariableDeclaration(d) && isSrcDecl(d) && d.initializer && !seen.has(d)
          && !ts.isArrowFunction(d.initializer) && !ts.isFunctionExpression(d.initializer)) { // O19: a helper is no schema
        seen.add(d);
        if (/\bz\.|\.(extend|merge|pick|omit|partial|openapi)\(/.test(d.initializer.getText())) { out.push(loc(d.name)); out.push(...schemaBases(d.initializer, seen)); }
      }
    }
    ts.forEachChild(n, v);
  })(init);
  return out;
}
const schemaRows = new Set(), validRows = new Set();
for (const { handler, chain, store, entry } of chains) {
  const byTarget = new Map();
  const add = (target, node) => { const sk = schemaKey(node); byTarget.set(target, sk.key); for (const k of [sk.key, ...schemaBases(sk.init)]) schemaRows.add(`${handler}\t${target}\t${k}`); };
  for (const mk of chain) {
    const mv = store.entries.find(x => x.key === mk);
    const vd = mv && mv.val.validator;
    if (vd) { if (vd.schema) add(vd.target, vd.schema); else byTarget.set(vd.target, null); }
  }
  if (entry.routedef) for (const [t, n] of entry.routedef.schemas) if (t !== 'response') add(t, n); else { const sk = schemaKey(n); for (const k of [sk.key, ...schemaBases(sk.init)]) schemaRows.add(`${handler}\t${t}\t${k}`); }
  entry.validTargets = byTarget;
}
function scanValid(n) {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'valid'
      && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === 'req'
      && isContext(n.expression.expression.expression) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
    const f = enclosingFn(n), t = n.arguments[0].text;
    for (const c of chains) if (c.handler === f) {
      if (c.entry.validTargets.has(t)) { const sk = c.entry.validTargets.get(t); if (sk !== null) validRows.add(`${loc(n)}\t${f}\t${t}\t${sk === null ? '-' : sk}`); }
      else out.unknown.add(`${loc(n)}\tvalid_without_validator\t${f}`);
    }
  }
  ts.forEachChild(n, scanValid);
}
srcFiles.forEach(scanValid);

phase('results');
const lines = [];
for (const r of out.route) lines.push(`route\t${r}`);
for (const r of out.mw) lines.push(`mw\t${r}`);
for (const r of [...out.entry].sort()) lines.push(`entry\t${r}`);
for (const r of [...out.ctx].sort()) lines.push(`ctx\t${r}`);
for (const r of [...out.rpc].sort()) lines.push(`rpc\t${r}`);
for (const r of [...out.request].sort()) lines.push(`request\t${r}`);
for (const r of out.submount) lines.push(`submount\t${r}`);
for (const r of [...schemaRows].sort()) lines.push(`schema\t${r}`);
for (const r of [...validRows].sort()) lines.push(`validread\t${r}`);
// O12: a handler with a route row is not also partial (nor its partial reason rows)
{
  const routed = new Set(out.route.map(r => r.split('\t')[2]));
  const PARTIAL_REASONS = new Set(['unresolved_app_value', 'unresolved_mount', 'dynamic_mount_prefix', 'dynamic_route_path', 'dynamic_verb']);
  for (const r of [...out.partial]) if (routed.has(r.split('\t')[0])) out.partial.delete(r);
  for (const r of [...out.unknown]) { const c = r.split('\t'); if (PARTIAL_REASONS.has(c[1]) && routed.has(c[2])) out.unknown.delete(r); }
}
for (const r of [...out.partial].sort()) lines.push(`partial\t${r}`);
{ const routed = new Set(out.route.map(r => r.split('\t')[2])); for (const r of [...partialMw].sort()) if (!routed.has(r.split('\t')[1])) lines.push(`mwp\t${r}`); }
for (const r of [...out.regby].sort()) lines.push(`regby\t${r}`);
for (const r of [...out.unserved].sort()) lines.push(`unserved\t${r}`);
for (const r of [...out.unknown].sort()) lines.push(`unknown\t${r}`);
// --stores: every store's full entry list in registration order, for the runtime cross-check
// (a mount's runtime handler is hono's wrapper: shown as a library entry; a dynamic marker is no runtime entry)
if (STORES) for (const st of stores) st.entries.filter(en => en.kind !== 'dyn').forEach((en, i) => lines.push(`store\t${st.origin}#${st.id}\t${st.mounted ? 'mounted' : st.dropped ? 'unserved' : 'root'}\t${i}\t${en.method}\t${en.path}\t${en.mount ? 'lib:mount' : en.key}\t${en.kind}\t${en.alt || ''}`));
// streamed: one joined string exceeds V8's maximum string length on a 400-route project (stress-2 guard)
{ let buf = []; for (const l of lines) { buf.push(l); if (buf.length >= 20000) { fs.writeSync(1, buf.join('\n') + '\n'); buf = []; } } if (buf.length) fs.writeSync(1, buf.join('\n') + '\n'); }
