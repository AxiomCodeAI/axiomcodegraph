#!/usr/bin/env node
// =============================================================================
// Rewrite a TypeScript tree so that, at run time, every call site reports which
// declaration actually ran.
//
//   f(a)          ->  __ax.e(__ax.s(SITE), f(a))
//   function g(){}->  function g(){ __ax.enter(DECL); ... }
//   x => x + 1    ->  x => { __ax.enter(DECL); return (x + 1); }
//
// WHY TEXT EDITS AND NOT THE TYPESCRIPT PRINTER
// Re-printing through `ts.createPrinter` reformats every file, which makes the
// mirror impossible to diff against the original and moves every position. The
// ids are computed from the ORIGINAL positions and baked into the text, so the
// rewritten file never has to be mapped back. Insert-only edits applied from the
// end of the file keep every untouched byte untouched.
//
// WHAT IS DELIBERATELY NOT INSTRUMENTED
// Each skip is counted and printed, because a site that is silently dropped is
// indistinguishable from one the engine got right.
//   vi.mock / jest.mock a test runner HOISTS these to the top of the module by
//                       rewriting the source before it runs, and it recognises them
//                       by SYNTAX. Wrapped in `__ax.e(__ax.s(n), ...)` the hoister
//                       no longer sees a top-level call and emits a broken module
//                       ('})const __vi_import_0__ = ...'). Caught by the integrity
//                       check on zustand: 13 files passed, 12 after instrumenting.
//   super(...)          wrapping it is not worth the constructor-ordering risk
//   direct eval(...)    wrapping turns direct eval into indirect eval, which is
//                       a different scope. A semantic change, not a cost.
//   import(...)         a module load, not a call into user code
//   a decorator's call  the expression position is constrained
//   inner links of an optional chain
//                       wrapping `a?.b()` inside `a?.b().c()` defeats the
//                       short-circuit: the original returns undefined, the
//                       rewrite calls `.c()` on undefined. Only the OUTERMOST
//                       link of a chain is wrapped, where that cannot happen.
//
// Usage: instrument.mjs --src <dir> --out <dir> --tables <dir> [--ts <typescript.js>]
// =============================================================================
import fs from 'node:fs'
import path from 'node:path'
import {loadTypeScript} from '../ground-truth/load-typescript.mjs'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : fallback
}
const SRC = path.resolve(arg('src'))
const OUT = path.resolve(arg('out'))
const TABLES = path.resolve(arg('tables'))
// THE COMPILER COMES FROM THE SHARED LOADER, like every other tool here.
// It used to be `createRequire(...)` of a default that was an absolute path in one
// developer's home directory, so the instrumenter ran on exactly one machine and
// died with MODULE_NOT_FOUND everywhere else. Two things follow from routing it
// through load-typescript.mjs instead of restoring a better default:
//   - the PROJECT'S OWN compiler is preferred, which is what an instrumenter needs.
//     It parses the subject's syntax, so a project pinned to an older TypeScript
//     must be read by that TypeScript or the rewrite is against a different grammar.
//   - the API-surface check applies. Loading a compiler package that does not ship
//     the JavaScript API (see #239) now REFUSES and names what is missing, instead
//     of failing somewhere inside the walk with a TypeError.
// `--ts` and $AX_TYPESCRIPT still win, expressed as the loader's own override so
// there is one precedence order in the tree rather than two.
const TS_OVERRIDE = arg('ts', process.env.AX_TYPESCRIPT)
if (TS_OVERRIDE) process.env.TS_MODULE_PATH = TS_OVERRIDE
const ts = loadTypeScript(SRC, {toolName: 'instrument'})

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'website',
  'docs',
  '.next',
  '.yarn',
  'flow-typed',
])
const EXTS = ['.ts', '.tsx', '.mts', '.cts']
// A build or test config is TypeScript too, but it is loaded by the tool itself
// -- vite bundles vitest.config.ts in its own process, outside the tracer -- so a
// rewritten one dies with `__ax is not defined` before a single test runs.
const CONFIG_FILE = /\.config\.[cm]?tsx?$/
// Calls a test runner rewrites statically, before anything executes.
const HOISTED_CALL = /^(vi|jest)\.(mock|doMock|unmock|doUnmock|hoisted|requireActual|requireMock)$/

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      walk(path.join(dir, e.name), acc)
    } else if (e.isFile()) {
      const n = e.name
      if (n.endsWith('.d.ts') || n.endsWith('.d.mts') || n.endsWith('.d.cts')) continue
      if (CONFIG_FILE.test(n)) {
        skip('tool_config')
        continue
      }
      if (EXTS.some((x) => n.endsWith(x))) acc.push(path.join(dir, n))
    }
  }
  return acc
}

// ── id tables ───────────────────────────────────────────────────────────────
let nextSite = 0
let nextDecl = 0
const sites = [] // id, file, sl, sc, el, ec, kind, calleeText, enclosingDecl
const decls = [] // id, file, sl, sc, name, kind
const callbacks = [] // siteId, declId, argIndex
const skips = new Map()
function skip(reason) {
  skips.set(reason, (skips.get(reason) || 0) + 1)
}

const scriptKind = (f) => (f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

// A call that is an INNER link of an optional chain must not be wrapped: in
// `a?.b().c()` the original returns undefined when `a` is nullish, while the
// rewrite would call `.c()` on undefined. Only the OUTERMOST link is wrapped.
// The `?.` is carried by ONE node of the chain (the first link), not by every
// node, so the test has to look at the whole chain rather than at this node.
const isChainLink = (n) =>
  ts.isPropertyAccessExpression(n) ||
  ts.isElementAccessExpression(n) ||
  ts.isCallExpression(n) ||
  ts.isNonNullExpression(n) ||
  ts.isTaggedTemplateExpression(n)

function chainInfo(node) {
  let root = node
  while (root.parent && isChainLink(root.parent) && root.parent.expression === root) root = root.parent
  let optional = false
  for (let n = root; n && isChainLink(n); n = n.expression) if (n.questionDotToken) optional = true
  return {inner: root !== node, optional}
}

function insideDecorator(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isDecorator(n)) return true
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false
  }
  return false
}

function isAmbient(node) {
  for (let n = node; n; n = n.parent) {
    if (n.modifiers && n.modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return true
  }
  return false
}

function declName(node, sf) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  if (node.name && ts.isStringLiteral(node.name)) return node.name.text
  if (ts.isConstructorDeclaration(node)) {
    const cls = node.parent
    return (cls && cls.name && cls.name.text ? cls.name.text : '<anon>') + '.constructor'
  }
  const p = node.parent
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
  if (p && ts.isPropertyAssignment(p) && p.name && p.name.text) return p.name.text
  if (p && ts.isPropertyDeclaration(p) && p.name && p.name.text) return p.name.text
  if (p && ts.isBinaryExpression(p) && p.left && p.left.getText) {
    try {
      return p.left.getText(sf)
    } catch {
      return '<anon>'
    }
  }
  return '<anon>'
}

// A PROXY TRAP is invoked by the ENGINE OF THE LANGUAGE, on a property access or
// an `in` test, never by a call written at a site. Measured on immer, whose whole
// draft mechanism is a Proxy: the `get` trap ran during receiver evaluation at
// `s.aMap.set(...)` and consumed that site's marker, so the trap was recorded as
// the target of `set` -- and of `expect(res).toBe`, and of 200 other sites it has
// nothing to do with. Treated like a getter: counted, never consuming.
const PROXY_TRAPS = new Set([
  'get', 'set', 'has', 'deleteProperty', 'ownKeys', 'getOwnPropertyDescriptor',
  'defineProperty', 'apply', 'construct', 'getPrototypeOf', 'setPrototypeOf',
  'isExtensible', 'preventExtensions',
])
// invoked implicitly by a protocol, but ALSO callable by name; kept scoreable and
// filtered at join time by whether the site actually wrote the name
const IMPLICIT_PROTOCOL = new Set(['toString', 'valueOf', 'toJSON', 'then'])

const memberName = (n) =>
  n && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) ? n.name.text : null

function objectLiteralIsProxyHandler(obj) {
  let traps = 0
  for (const m of obj.properties) {
    const nm = memberName(m)
    if (nm && PROXY_TRAPS.has(nm)) traps++
  }
  if (traps >= 2) return true
  const p = obj.parent
  // `const objectTraps: ProxyHandler<ProxyState> = {...}`
  if (p && ts.isVariableDeclaration(p) && p.type) {
    try {
      if (p.type.getText().includes('ProxyHandler')) return true
    } catch {}
  }
  // `new Proxy(target, {...})` / `Proxy.revocable(target, {...})`
  if (p && (ts.isNewExpression(p) || ts.isCallExpression(p))) {
    try {
      const callee = p.expression.getText()
      if (callee === 'Proxy' || callee === 'Proxy.revocable') return true
    } catch {}
  }
  return false
}

// A HANDLER IS NOT ALWAYS AN OBJECT LITERAL. The check above reaches a trap written
// as a member of one, and misses every trap ASSIGNED INTO a handler afterwards:
//
//     const arrayTraps: ProxyHandler<[S]> = {}
//     for (const key in objectTraps) arrayTraps[key] = function () { ... }
//     arrayTraps.set = function (state, prop, value) { ... }
//
// which is how a handler that forwards to another one is written. Those functions
// were instrumented as ordinary declarations, so they CONSUMED the marker of
// whatever site was open when the language invoked them -- and because the receiver
// is a draft, that is any native operation on a draft anywhere in the program.
// Measured on immer 061c242: 19 of 366 executed production sites carried the array
// handler as a target, `base.push`, `obj.map`, `Reflect.getOwnPropertyDescriptor`
// and `getPrototypeOf` among them. None of them calls it.
//
// The names of these are collected per file before the walk, so an assignment that
// appears before the declaration it targets is still recognised.
const proxyHandlerNames = new Set()

function collectProxyHandlers(sf) {
  proxyHandlerNames.clear()
  const note = (n) => { if (n && ts.isIdentifier(n)) proxyHandlerNames.add(n.text) }
  const walk = (n) => {
    // `const X: ProxyHandler<...> = ...`, whatever the initialiser is
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      try {
        if (n.type && n.type.getText().includes('ProxyHandler')) note(n.name)
      } catch {}
      if (n.initializer && ts.isObjectLiteralExpression(n.initializer)
          && objectLiteralIsProxyHandler(n.initializer)) note(n.name)
    }
    // `new Proxy(target, X)` / `Proxy.revocable(target, X)`
    if (ts.isNewExpression(n) || ts.isCallExpression(n)) {
      let callee = ''
      try { callee = n.expression.getText() } catch {}
      if ((callee === 'Proxy' || callee === 'Proxy.revocable') && n.arguments) {
        note(n.arguments[1])
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
}

// The object an assignment target is rooted at: `X.set` and `X[key]` are both X.
function assignmentRootName(target) {
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    return ts.isIdentifier(target.expression) ? target.expression.text : null
  }
  return null
}

function isProxyTrap(node) {
  const holder = ts.isMethodDeclaration(node)
    ? node
    : node.parent && ts.isPropertyAssignment(node.parent)
      ? node.parent
      : null
  if (holder) {
    const nm = memberName(holder)
    if (!nm || !PROXY_TRAPS.has(nm)) return false
    const obj = holder.parent
    return !!obj && ts.isObjectLiteralExpression(obj) && objectLiteralIsProxyHandler(obj)
  }
  // `<handler>.<trap> = function () {}` / `<handler>[<expr>] = function () {}`
  const a = node.parent
  if (!a || !ts.isBinaryExpression(a) || a.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return false
  }
  if (a.right !== node) return false
  const root = assignmentRootName(a.left)
  if (!root || !proxyHandlerNames.has(root)) return false
  // A COMPUTED key on a handler is a trap whatever it resolves to: the object exists
  // to hold traps and nothing else is assigned into it. A NAMED key has to be one of
  // the thirteen, so a helper parked on the same object stays scoreable.
  if (ts.isElementAccessExpression(a.left)) return true
  const nm = a.left.name && ts.isIdentifier(a.left.name) ? a.left.name.text : null
  return !!nm && PROXY_TRAPS.has(nm)
}

// a declaration whose body does not start at a call site: see runtime.cjs `aux`
const isAux = (node) =>
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  !!node.asteriskToken ||
  isProxyTrap(node)

const declKind = (node) =>
  ts.isFunctionDeclaration(node)
    ? 'function'
    : ts.isMethodDeclaration(node)
      ? 'method'
      : ts.isConstructorDeclaration(node)
        ? 'constructor'
        : ts.isGetAccessorDeclaration(node)
          ? 'getter'
          : ts.isSetAccessorDeclaration(node)
            ? 'setter'
            : ts.isArrowFunction(node)
              ? 'arrow'
              : 'function_expression'

// ── one file ────────────────────────────────────────────────────────────────
function instrumentFile(abs) {
  const rel = path.relative(SRC, abs)
  const text = fs.readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKind(abs))
  collectProxyHandlers(sf)
  const edits = [] // {pos, text, rank}
  const lc = (p) => {
    const {line, character} = sf.getLineAndCharacterOfPosition(p)
    return [line + 1, character + 1]
  }

  // declId of the nearest enclosing instrumented function, filled as we descend
  const fnStack = []
  // a function expression handed over at a call site is that site's callback; the
  // declaration is reached later in the same traversal, so the node is remembered
  // here and resolved to its id once the file is walked.
  const pendingCallbacks = []
  const declIdOf = new Map()
  // A site whose chain contains a link we refused to wrap can be handed the enter
  // of that unwrapped link's callee -- `maybe?.b?.().c()` recorded `b` as the
  // target of the `.c()` site. The site is flagged so the join treats its targets
  // as unattributable rather than as a disagreement with the engine.
  const siteIdOfNode = new Map()
  const chainRootsWithSkippedLink = new Set()

  function visit(node) {
    let pushed = false

    if (ts.isFunctionLike(node) && node.body && !isAmbient(node)) {
      const id = nextDecl++
      const [sl, sc] = lc(node.getStart(sf))
      const kind = declKind(node)
      const hook = isAux(node) ? 'aux' : 'enter'
      const nm = declName(node, sf)
      const tag = isProxyTrap(node)
        ? 'proxy_trap'
        : node.asteriskToken
          ? kind + '_generator'
          : IMPLICIT_PROTOCOL.has(nm)
            ? kind + '_implicit'
            : kind
      decls.push([id, rel, sl, sc, nm, tag])
      declIdOf.set(node, id)
      if (ts.isBlock(node.body)) {
        edits.push({pos: node.body.getStart(sf) + 1, text: `__ax.${hook}(${id});`, rank: 2, end: node.body.getEnd()})
      } else {
        // expression-bodied arrow
        edits.push({pos: node.body.getStart(sf), text: `{__ax.${hook}(${id});return (`, rank: 2, end: node.body.getEnd()})
        edits.push({pos: node.body.getEnd(), text: `);}`, rank: -2, end: node.body.getEnd()})
      }
      fnStack.push({id, node})
      pushed = true
    }

    const isCall = ts.isCallExpression(node)
    const isNew = ts.isNewExpression(node)
    const isTagged = ts.isTaggedTemplateExpression(node)
    if (isCall || isNew || isTagged) {
      const reason = callSkipReason(node, isCall, sf)
      if (reason) {
        skip(reason)
        if (reason === 'optional_chain_inner') {
          let root = node
          while (root.parent && isChainLink(root.parent) && root.parent.expression === root)
            root = root.parent
          chainRootsWithSkippedLink.add(root)
        }
      } else {
        const id = nextSite++
        siteIdOfNode.set(node, id)
        const [sl, sc] = lc(node.getStart(sf))
        const [el, ec] = lc(node.getEnd())
        let calleeText = ''
        try {
          calleeText = (isTagged ? node.tag : node.expression).getText(sf).slice(0, 120)
        } catch {}
        sites.push([
          id,
          rel,
          sl,
          sc,
          el,
          ec,
          isNew ? 'new' : isTagged ? 'tagged' : 'call',
          calleeText.replace(/[\t\n\r]+/g, ' '),
          fnStack.length ? fnStack[fnStack.length - 1].id : '',
          '',
        ])
        edits.push({pos: node.getStart(sf), text: `__ax.e(__ax.s(${id}),`, rank: 1, end: node.getEnd()})
        edits.push({pos: node.getEnd(), text: `)`, rank: -1, end: node.getEnd()})

        // a function expression handed over AT this site is this site's callback:
        // when it runs, it consumes this site's marker (see runtime.cjs), and the
        // join needs to know that is a callback rather than the site's callee.
        const args = isCall || isNew ? node.arguments || [] : []
        args.forEach((a, i) => {
          const f = ts.isArrowFunction(a) || ts.isFunctionExpression(a) ? a : null
          if (f) pendingCallbacks.push({site: id, node: f, argIndex: i})
        })
      }
    }

    ts.forEachChild(node, visit)
    if (pushed) fnStack.pop()
  }

  visit(sf)
  for (const root of chainRootsWithSkippedLink) {
    const id = siteIdOfNode.get(root)
    if (id !== undefined) sites[sites.findIndex((r) => r[0] === id)][9] = 'unwrapped_chain_link'
  }
  for (const c of pendingCallbacks) {
    const d = declIdOf.get(c.node)
    if (d !== undefined) callbacks.push([c.site, d, c.argIndex])
  }

  if (!edits.length) return {rel, changed: false}

  edits.sort((a, b) => b.pos - a.pos || a.rank - b.rank || a.end - b.end)
  let out = text
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos)
  const dest = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(dest), {recursive: true})
  fs.writeFileSync(dest, out)
  return {rel, changed: true}
}

function callSkipReason(node, isCall, sf) {
  if (isCall && node.expression.kind === ts.SyntaxKind.SuperKeyword) return 'super_call'
  if (isCall && node.expression.kind === ts.SyntaxKind.ImportKeyword) return 'dynamic_import'
  if (isCall && ts.isIdentifier(node.expression) && node.expression.text === 'eval')
    return 'direct_eval'
  if (isCall) {
    let callee = ''
    try {
      callee = node.expression.getText(sf)
    } catch {}
    if (HOISTED_CALL.test(callee)) return 'hoisted_by_test_runner'
  }
  if (insideDecorator(node)) return 'decorator'
  if (isAmbient(node)) return 'ambient'
  const ch = chainInfo(node)
  if (ch.inner && ch.optional) return 'optional_chain_inner'
  return null
}

// ── run ─────────────────────────────────────────────────────────────────────
const files = walk(SRC, [])
fs.mkdirSync(OUT, {recursive: true})
fs.mkdirSync(TABLES, {recursive: true})
let changedFiles = 0
for (const f of files) {
  try {
    if (instrumentFile(f).changed) changedFiles++
  } catch (e) {
    skip('file_error:' + path.relative(SRC, f) + ':' + e.message)
  }
}

const tsv = (rows, header) => header + '\n' + rows.map((r) => r.join('\t')).join('\n') + '\n'
fs.writeFileSync(
  path.join(TABLES, 'sites.tsv'),
  tsv(sites, 'site_id\tfile\tstart_line\tstart_col\tend_line\tend_col\tkind\tcallee_text\tenclosing_decl\tnote'),
)
fs.writeFileSync(
  path.join(TABLES, 'decls.tsv'),
  tsv(decls, 'decl_id\tfile\tstart_line\tstart_col\tname\tkind'),
)
fs.writeFileSync(
  path.join(TABLES, 'callbacks.tsv'),
  tsv(callbacks, 'site_id\tdecl_id\targ_index'),
)
fs.writeFileSync(
  path.join(TABLES, 'instrument-stats.json'),
  JSON.stringify(
    {
      src: SRC,
      files_seen: files.length,
      files_rewritten: changedFiles,
      sites: sites.length,
      decls: decls.length,
      callback_args: callbacks.length,
      skipped: Object.fromEntries(skips),
    },
    null,
    2,
  ) + '\n',
)
console.log(
  `instrumented ${changedFiles}/${files.length} files — ${sites.length} sites, ${decls.length} declarations, ${callbacks.length} callback arguments`,
)
for (const [r, n] of [...skips].sort((a, b) => b[1] - a[1])) console.log(`  skipped ${r}: ${n}`)
