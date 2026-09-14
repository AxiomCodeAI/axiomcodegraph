# Linking fixture — every shape a published package can present itself in

The other two fixtures are client-only. The only library either of them ever stages is
TypeScript's own `lib.*.d.ts`, so the question this engine exists to answer — *given the
IR of an external library, do we land on the exact right declaration inside it* — was
measured nowhere.

This fixture is thirteen hand-written packages in `vendor/`, installed into a scratch
`node_modules` at run time and extracted to library IR by the parser CLI exactly the way a
real dependency is. Every call in `src/` has one right declaration and at least one
plausible wrong one, so a link that matches on the callee's *name* is decidable as wrong
rather than merely unproven.

Nothing is hand-asserted. `tsc` decides what each call resolves to; the comments name the
expected declaration for a human reader and are never read by the harness.

```bash
bash test/typescript/fixtures/linking/run.sh
```

## The matrix

| package / file | the mechanism it isolates |
|---|---|
| `@tt/named` | plain named exports — the baseline everything else is measured against |
| `@tt/collide` | **the same exported name** as `@tt/named`, different parameter type |
| `@tt/default` | `export default`, plus a static that returns an instance |
| `@tt/legacy` | `export =` over a namespace, reached by `import = require` *and* by `import * as` |
| `@tt/barrel` | `export *` (names no symbols at all) and `export * as ns` |
| `@tt/chain` | a three-hop re-export chain that **renames at every hop** |
| `@tt/subpath` | an `exports` map with no `main` and no `types`, and a subpath that is not a directory |
| `@tt/overload` | overload sets that must survive extraction and re-linking as library IR |
| `@tt/generic` | `T` bound by a *client* argument, `Promise<T>`, and a library interface the client implements |
| `@tt/merged` | class+namespace merging, interface merging, an ambient enum |
| `plainjs` + `@types/plainjs` | the declarations live in a package the client never names |
| `src/ambient-virtual.d.ts` | an ambient module — a specifier that resolves to no file on disk |
| `src/link-merged.ts` | **module augmentation**: the client reopens a library class |

`src/link-chains.ts` adds the question a per-site score cannot ask: a four-hop chain
`entryPoint -> stageOne -> stageTwo -> stageThree -> @tt/named encode`, three client edges
then exactly one library edge, plus direct and mutual recursion.

## What it measured

```
call sites 87   decidable 73
EXACT 64  0.877     SOUND_SUPERSET 1     WRONG 0     MISSED 8

overload sites 13  ->  EXACT 12
  on NON-FIRST choices only:  8 of 8   1.000

client/library boundary:  52 client->library, 12 client->client, MISCLASSIFIED 0
call-graph edges:         64 of 72 held   0.889
chains:                   deepest oracle hop 4, deepest hop the engine holds 4
```

Zero wrong targets and zero misclassified boundaries. The engine never picked the other
package's `encode`, never crossed the two `Sink.write` declarations, and the four-hop chain
survives intact — so the module graph, the boundary split and the overload comparison all
hold across the library boundary, not just inside a project.

## The eight it did not get, and what each one is

Every miss is one mechanism, and they are not a long tail:

| site | mechanism |
|---|---|
| `tools.charlie(n)` | **`export * as ns`** — the namespace re-export form |
| `legacy.nested.deepPack(x)` | **a nested namespace** — one walk lands, two do not |
| `Codec.of('seed').transform(x)` | **a static's return type** used as the next receiver |
| `first(runners).run('x')` ×2 | **a generic return type bound by the argument** — `T` never gets substituted, so the receiver is lost |
| `wrap(...).map((r) => r.run('y'))` | the same, one level deeper: the callback parameter is typed by `T` |
| `sink.write.bind(sink)` / `write(...)` | **a method used as a value** — `Function.bind` and the call on its result |

Three of the eight are one root cause: a generic function's return type is not substituted
with the inferred type argument, so `first(items)` produces no receiver type. That is the
single highest-value fix this fixture points at, and `@tt/generic` exists so the fix has a
target it can be checked against.

Everything else in the matrix passed on the first run — `export =`, `export *`, the
renaming chain, subpath exports, the `@types` split, the ambient module, module
augmentation, class+namespace merging, interface merging, and every one of the thirteen
library overload sites.
