# JavaScript engine regression suite

Hand-written cases, each solved and scored against the TypeScript compiler running over
plain JavaScript (`allowJs` + `checkJs`). `./run-tests.sh --oracle` is the whole thing.

## What a case is

```
cases/<NN-name>/
  src/     the client — parsed to IR and analysed; carries its own package.json so the
           module system (`"type": "module"` or not) is decided the way it is in a project
  lib/     optional — the case's own "library", parsed SEPARATELY and handed to the engine
           with --library, exactly as a dependency parsed from source is
```

## What can fail

1. **COVERAGE GUARD** — every row of `all-javascript-call-sites.csv` must appear as the
   FromExpr of some edge, resolved or explicitly unresolved. A site that appears nowhere
   was dropped silently.
2. **EDGE GOLDEN** — `expected/<name>.edges`: the normalized edges, per call SITE, with
   the confidence class and the target's position. Hashes never appear.
3. **DIAGNOSTICS GOLDEN** — `expected/<name>.diag` (and `.lib.diag` with a library):
   the DECLARED blind spots beside the edges: every parse gap per module, the modules
   marked partial, each unresolved import with its cause (`computed_specifier`,
   `not_staged`, `builtin`), each unresolved site with its reason, and the package
   entries (`main` / `exports`) of every package in the parse. A rule change that turns
   a refusal into a silent nothing fails here.
4. **ORACLE** — `expected/<name>.oracle`: one line per compiler-decided site with the
   scorer's bucket. A site the checker names by TYPE identity rather than by value (two
   same-typed functions in one array, a widened `symbol` key, a call result, a ternary) is
   `type_ambiguous` and undecided: the checker's declaration there is an inference, not a
   fact, and scoring it called a correct engine answer WRONG (#607). A MISSED or WRONG line that is not in
   `expected/<name>.known-missing` fails the run whether or not the golden was
   rewritten, and a known-missing entry that STARTS resolving fails too, so the debt
   list cannot rot.

`--bless` regenerates the goldens; it refuses to run without `--oracle`, because the two
goldens are built by the same normalizer and blessing one leaves the other describing
the previous engine.

## What the cases cover

| case | mechanism |
|---|---|
| 01 | CommonJS: `require` in its three binding forms, `module.exports = {…}`, `exports.x =`, classes, `super`, statics, getters, constructor functions with prototype members, object-literal methods, `.call`/`.apply`/`.bind`, IIFE, callbacks |
| 02 | ESM: named/default/namespace imports, class expressions, object-literal methods and `this` inside them, `@returns`/`@type`, `F.prototype = {…}`, `Object.assign(F.prototype, …)`, chained calls, assignment after declaration |
| 03 | every spelling of a default export: named function, named class, expression, anonymous function, object literal — including the two the parser files under the local name (parser#176) |
| 04 | parameter defaults, defaults inside a destructured parameter, a destructured parameter's properties, a class field holding an arrow, a field typed with a JSDoc function type |
| 05 | arrays: literal elements, `[i]`, `push`, `forEach`/`map`/`find` callbacks, `for..of`, `[first] = xs`, `@type {T[]}`, `@type {Array<T>}` |
| 06 | CommonJS idioms: `exports`/`module.exports` as the file's own surface, `var app = exports = module.exports = {}`, `module.exports = function` with properties, a computed member's `this`, `util.inherits`, a user-defined `apply`/`call` beside `Function.prototype`'s |
| 07 | an ESM class hierarchy across files with default-exported classes, `super()`, `super.m()`, `new this.constructor()`, `@param {import('./x.js').default}`, a typedef alias, a JSDoc-typed field read on a subclass instance |
| 09 | callbacks and events: `on`/`once` handlers reached from `emit` by literal name, a computed name matching every handler, `setTimeout`/`then`/`forEach` callbacks and a project function's callback parameter all carrying `callback_registered` edges |
| 10 | values through control flow and keys: ternary, `\|\|`, `??`, `&&`, reassignment on branches, `(0, f)()`, `(x).m()`, nested object paths written after the literal, `{ ...base }`, `Object.assign`, `Object.freeze`, `Object.defineProperty`/`defineProperties`, `arr[0]()`, closures and currying, optional calls, counters, a conditional call — the destructuring paths #487 leaves out are known-missing |
| 11 | class members: static inheritance and `new this()`, arrow fields, getters as values, a setter, `#private`, `[Symbol.iterator]`, a mixin `(Sup) => class extends Sup`, a conditional superclass, `Object.create(proto, descriptors)`, `Reflect.construct`, a singleton, a bound constructor — the setter's parameter is known-missing (no SETTER_INVOCATION site) |
| 12 | promises and generators: `Promise.resolve`, `new Promise` with the executor's `resolve`, `.then` continuations, `Promise.all`/`race`, `Array.from`, `Object.entries`, `new Map(entries)`, `yield`/`yield*`, `.next().value`, `for..of`/spread/`for await` over a generator |
| 13 | CommonJS surfaces: directory and `package.json` main resolution, a file beside a same-named directory, `module.exports = require(…)`, `{ ...require(…) }` spreads, a dead `exports.x` after `module.exports =`, `exports.a = exports.b = f`, `Object.defineProperty(exports, …)` with `value` and `get`, a conditional export, circular requires, a JSON require, `module.exports.one()` inside the file |
| 14 | ES re-exports: `export * from`, `export * as ns from`, `export { a as b } from`, `export { default } from`, `export { default as x } from`, `export { local as default }`, a mutable `let` export, `await import()` in its three forms, `createRequire`, a side-effect import, an anonymous `export default class extends`, `extends B.Base` through a namespace import |
| 15 | JSDoc forms: `@this`, `/** @type */ (x)` casts, `@type {T[]}`, `@type {{ w: T }}`, `Map<K,V>`, `Set<T>`, `Promise<T>`, `@typedef`, `import('./types').Name` , a superclass that is a member of a `require()` call |
| 16 | heritage forms: `extends ns.Base` at module and function level, class expressions named and anonymous, `(Sup) => class extends Sup` with the class the callers passed, a conditional superclass (`multi_inferred`) |
| 17 | qualified heritage with a same-named import in the file — the shape that once produced a WRONG superclass (#479) |
| 18 | precision: a module function, a static and an instance method sharing one name; a parameter, a local and an inner function shadowing it; `map(fn, this)` versus unbound; a getter returning a function; quoted, numeric, template and concatenated keys; polymorphic and pass-through receivers; a rebound `let`; a registry key written twice; `new.target` — the golden holds zero WRONG |
| 20 | an ES module importing CommonJS files: a default import of an `exports.x =` surface, of a `module.exports = {…}` object, of a function with members added after `module.exports =`; the named and namespace spellings of the same file; a destructuring of the default binding |
| 19 | class fields: `dep = new Service()`, `#priv = …`, `static shared = …`, `static #hidden = …`, an array field, an object field, a function-expression field whose `this` is the instance — read through `this`, `Holder.x` and `this.x` in a static |
| 21 | `concat` and `flat` results: the receiver's elements plus each array argument's elements and each non-array argument, `Array.of(...).concat(...).at(-1)`, a spread beside them, and the receiver left unchanged after `concat` (#606) |
| 22 | `for..of` heads that are patterns: `[, fn]` over pairs, `{ fn }` over objects, `[, fn]` over `Object.entries`, a nested `{ meta: { hooks: [first] } }`, `{ run }` over a Set of instances, `[key, fn]` over a Map, `[first, ...rest]`, a renamed property, `let`, and the plain binding beside them (#604) |
| 23 | `Object.setPrototypeOf(Child.prototype, Parent.prototype)` as constructor-function inheritance: an inherited method on a Child instance, a grandchild chained the same way, the static side `Object.setPrototypeOf(Child, Parent)` (`Child.make()`), and the plain-object form beside them (#605) |
| 25 | platform stream hooks: `write()` / `end()` / `destroy()` on a `Writable` subclass reach `_write` / `_final` / `_destroy`, `resume()` on a `Readable` reaches `_read`, `write()` / `end()` on a `Transform` reach `_transform` / `_flush`, a `stream.Duplex` subclass both sides, a subclass of a subclass inherits the hooks, and a plain class with a `write` and a `_write` of its own is a control (#611) |
| 28 | a dependency DECLARED and NOT INSTALLED (no `node_modules` in the client): its IR staged with `--library` links through the package's own entry facts, `require('alpha')` to the `require` build, `import ... from 'alpha'` and `import('alpha')` to the `import` build only, `alpha/sub` to the subpath, an export naming an absent file (`staged_unreached`) and a package never staged (`not_staged`) left `ambiguous_unknown` (#602) |
| 29 | the global object: `globalThis.x = f`, `global.x = f`, `Object.assign(globalThis, { x: f })` and a nested registry read back as `globalThis.x()`, `global.x()`, a bare `x()`, a local alias of `globalThis`, with `globalThis.setTimeout` and `global.process.cwd()` as platform controls (#641) |
| 31 | computed member names fixed by syntax: `['lit']() {}`, `` [`tpl`]() {} ``, `[42]() {}`, `get ['acc']()`, `['named'] = () => …` on a class and `` [`olit`]() {} `` on an object literal, each reached by name; the symbol-keyed `[kRun]() {}` beside them carries its key (#598) |
| 30 | a subpath PATTERN export of a staged package on an uninstalled client: `kit/feat/alpha` through `"./feat/*"`, an exact entry beside the pattern winning for `kit/feat/beta`, a conditional pattern read from a `.js` (`require` build) and an `.mjs` (`import` build), a `null` pattern refusing `kit/internal/*`, and a path no file backs (#642) |
| 32 | symbol-keyed members: `[kRun]() {}` on a class, `this[kDone] = () => …` in a constructor, `Queue.prototype[kWrite] = function () {}`, `{ [kRun]: function run() {} }` and `{ [kDone]() {} }` in a literal, a symbol from `require('./symbols')`, `Symbol.for('shared')` on both sides, each called through `obj[k]()`; a key that is the `Symbol` function itself or a symbol parameter stays `dynamic_terminal` (#597) |
| 33 | an object typedef with `@property` members (#651): `@typedef {Object} S` + `@property {NormalModule} module`, read through a same-file `@type` on a constructor field, an imported typedef on a parameter, an inline `{ module: NormalModule }`, an intersection alias, an array member iterated, and a `string` member (ambient) |
| 34 | a class whose `@extends` tag names the grandparent while the clause names the parent (#656): `super()`, `super.createEl()`, `this.createEl()` and `super.dispose()` resolve to the clause's class; the compiler oracle marks those sites `jsdoc_extends` (undecided) instead of scoring the runtime-correct edge WRONG; a control whose tag and clause agree stays decided |
| 08 | a dependency under `node_modules`, staged as `--library` from a copy parsed separately: `require('dep')` as a function, a destructured class and function, an instance returned by the library, `boundary_lib` on every edge |
| 24 | the `@import` JSDoc tag (TypeScript 5.5+): a default, a named, a renamed and a namespace binding, each read through a `@param`, beside the older `@typedef {import(…)}` as the control (#621) |
| 26 | a class extending a platform builtin (#619): a lazy registry reading `super.get`, a constructor seeding through `super(entries)`, `super.forEach` / `super.values` on `Map` and `Set` subclasses, `this.set` / `this.get` inside the subclass, an instance iterated and `forEach`ed from outside, an `Error` subclass, the plain `Map` control |
| 27 | parse gaps (#617): a computed `require`, a missing and a builtin specifier, a file parsed with errors, a JSDoc type the parser cannot read beside a readable and an absent one, `eval` and `with`; pinned in the diagnostics golden |
| 29 | a qualifier-less `import("./x")` JSDoc type (#631): `@typedef {import("./Module")} Module` of a CommonJS class module, the inline `@param {import("./Module")}` form, a module that exports through `exports.x =` (the type is the namespace object), an ES module and its `.Widget` member, beside the `.default` control |

## Environment

`AXIOM_PARSER` — path to the parser entrypoint (default `parser/dist/index.js` in this repository).

## Execution oracles

`torture/run.sh` and `realapp/run.sh` score the graph against what actually RAN — see their
READMEs. `realapp` needs network once (`npm ci`) and exits 77 without it. Both gate the
compiler's verdicts too, through `tools/oracle_gate.py` (the same gate as the cases) against
a `known-compiler.txt` beside the `known-missing.txt` of executed edges (#610).

## The corpus evaluation

`run-evaluation.sh <project> <work-dir> [--production]` runs one real project end to
end: parse → solve → oracle → per-site score. Development and held-out corpora are kept
outside the repository; the held-out set is validation only and no rule is derived from
its unresolved rows.
