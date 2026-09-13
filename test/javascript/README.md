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
3. **ORACLE** — `expected/<name>.oracle`: one line per compiler-decided site with the
   scorer's bucket. A MISSED or WRONG line that is not in
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

## Environment

`AXIOM_PARSER` — path to the parser entrypoint (default `../../../Parser/dist/index.js`).

## The corpus evaluation

`run-evaluation.sh <project> <work-dir> [--production]` runs one real project end to
end: parse → solve → oracle → per-site score. Development and held-out corpora are kept
outside the repository; the held-out set is validation only and no rule is derived from
its unresolved rows.
