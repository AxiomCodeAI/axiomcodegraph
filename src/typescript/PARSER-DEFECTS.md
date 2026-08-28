# TypeScript parser defects and contract notes

Found while building `src/typescript/engine/` against the parser IR. Every item was
measured against a **fresh** extraction, not a checked-in export — the engine notes
record four Python defects that were retracted because they were filed against a stale
IR, and the same mistake is available here.

**Parser revision measured:** `Parser@b26271a` (branch `fix/ts-object-literal-computed-keys`),
rebuilt with `npm run build` immediately before each measurement.

Nothing here was worked around in the parser. Where the engine compensates, the
compensation is named and its rule file is given, so the workaround can be deleted the
day the defect is fixed.

---

## PD-TS-1 — JSX component calls are not emitted at all

**Severity: blocking for any React / Preact / Solid codebase.**

`ts_call_site.callKind = JSX_COMPONENT_CALL` is declared in the schema (§4.15.1) and
emitted by nothing. `ts-expression-walker.ts:506` states the decision outright:

> The tag is deliberately NOT walked: `<Badge/>` as a call to Badge is
> JSX_COMPONENT_CALL, which is reserved and stays at zero rows.

Measured on **zustand** (13 `.tsx` files, all of which the parser DOES parse —
`scriptKind = TSX`, 303 call sites in `tests/basic.test.tsx` alone):

| | parser IR | tsc oracle |
|---|---|---|
| JSX_COMPONENT_CALL sites | **0** | **144** |
| JSX_ELEMENT / JSX_SELF_CLOSING expression rows | **0** | — |
| `ts_module.hasJsxContent` on a file full of JSX | **false** | — |

144 of 4,346 call sites — 3.3% here because zustand is a state library whose JSX lives
only in tests. On an application the ratio inverts: a React component tree is mostly
JSX, and every component invocation would be invisible.

`hasJsxContent = false` on a `.tsx` file that is full of JSX is a second, smaller bug
in the same area, and it is the one that makes the first hard to notice — a consumer
checking that column concludes the file has no JSX.

**Engine status:** the rules are already written and waiting.
`callee-resolution.dl` resolves `JSX_COMPONENT_CALL` by tag name, distinguishes an
uppercase component from a lowercase intrinsic, and `call_chain.dl` classifies the
intrinsic as `intrinsic_terminal` rather than a blind spot. They derive nothing today
because no row carries the kind. **No engine change is needed when the parser emits.**

---

## PD-TS-2 — `export =` produces no export row and no module column

An `export = X` inside `declare module "x" { … }` leaves BOTH
`ts_export` (no row) and `ts_module.exportAssignmentLinkHash` (empty) with nothing in
them. Measured:

| package | modules | ts_export rows | methods |
|---|---|---|---|
| `@types/node` | 198 | **0** | 6,929 |
| `tree-sitter` (`export = Parser`) | 3 | **0** | 65 |

`typescript.d.ts` is the one that DOES emit an export-assignment row, so the shape is
supported somewhere and lost inside `declare module`.

**Consequence:** a CommonJS-shaped dependency — which is most `@types/*` packages —
has an EMPTY export table, so no client→lib edge into one can exist.

**Engine compensation** (`resolution/module-graph.dl`, rule (h) and
`import_binds_interop`): a module with no export surface at all falls back to its
top-level declarations, and a default/namespace import of such a module also binds the
export of the same local name. Both are name-based heuristics, both are gated on the
module having no real export surface, and both are counted —
`module_export_recovered` and `import_binds_interop` are exported relations so the
size of the workaround is visible. Delete them when this is fixed.

---

## PD-TS-3 — module resolution is run for imports and not for exports

`ts_import.resolvedFilePath` / `resolvedModuleLinkHash` are filled by
`ts.resolveModuleName`. `ts_export.resolvedSourceModuleLinkHash` is not.

Measured on this engine's own corpus and on vitest:

| corpus | re-export rows | with a resolved source module |
|---|---|---|
| the Parser repository | 300 `NAMED_EXPORT` re-exports | **0** |
| vitest | 19 | **1** |

A barrel file — `export { X } from '@/a/b/X'` — is therefore a dead end, and barrel
files are how essentially every TypeScript package presents itself. Before the engine
compensated, 425 client `NAMED` import bindings resolved to nothing and 89 references
to a class **in the same repository** were reported as unresolved.

**Engine compensation** (`module-graph.dl`, routes 4–6): the specifier is resolved
three ways — from another import of the same non-relative specifier, by joining a
relative specifier onto the exporting module's directory, and by matching the
specifier's multi-segment tail against a module path with each legal extension
appended. `export_specifier_unresolved` counts what still fails.

---

## PD-TS-4 — `resolvedFilePath` has the extension stripped

Not a defect; a contract subtlety that costs a silent join failure.

    ts_import.resolvedFilePath   src/analysis-methods/java/MethodRegistry
    ts_module.filePath           src/analysis-methods/java/MethodRegistry.ts
    ts_import.resolvedExtension  .ts

An equality join on the raw column matches **nothing**, with no error — the failure
mode the whole engine is built to avoid. The extension column must be re-appended
first. Worth stating in the schema doc beside the column.

---

## PD-TS-5 — a PROPERTY_ACCESS node carries no name

The property name is on the node's `PROPERTY_NAME` child, and the access node's own
`literalValue` is empty. Measured on the Parser repository: 32,649 PROPERTY_ACCESS
nodes, 32,649 `PROPERTY_NAME` children, 32,649 empty `literalValue` columns.

Reading the name off the access node — which is where an IDENTIFIER_REFERENCE keeps
its name, so it is the natural place to look — yields `""` and every rule keyed on it
derives nothing. Cost before the engine read the child instead: `this.rows.push(x)`
had no receiver type at all, and `push` alone was 478 unresolved sites of which 428
were this shape.

Either populating the column or documenting it would do. Documenting is enough.

---

## PD-TS-6 — `receiverKind = UNKNOWN` for ordinary typed receivers

`ts_call_site.receiverKind` is UNKNOWN for receivers the type layer understands
perfectly well. Measured on the Parser repository, among sites whose target is in
`lib.es5.d.ts`: 283 sites carry UNKNOWN, and their receivers are

| receiver expression | count | example |
|---|---|---|
| `ARRAY_LITERAL` | 180 | `[a, b].join(",")` |
| `LITERAL` | 60 | `"x".split(",")` |
| `BINARY_EXPRESSION` | 43 | `(a + b).trim()` |

The enum has no value for "an expression that is not an identifier, a call or a
property chain", so these fall to UNKNOWN. Low severity — the receiver EXPRESSION
link is correct, which is what actually matters — but a consumer that trusts the label
to gate its lookup loses all of them. The engine now ignores the label and uses the
expression.

---

## PD-TS-7 — library extraction skips `dist/`

`TS_SKIP_DIRECTORIES` excludes `dist`, which is right for a project and wrong for a
library: a published package ships its declarations there. Measured on **vitest**:
extracting the package root yields 21 shim modules and none of the real declarations,
so `expect`, `it` and `describe` are unreachable and every assertion in a test suite is
an unresolved call.

This is arguably not a parser bug — the parser has no way to know it is being asked for
a library rather than a project. But there is no flag to say so either. Either an
`--as-library` mode, or documenting that a library must be staged from its declaration
directory, would close it. The evaluation harness currently does the latter
(`test/typescript/run-evaluation.sh` stages `dist/`, `lib/`, `types/` as extra roots
when the package root declares nothing).

---

## Contract notes that are not defects

* **`ts_type_reference.resolvedGroupKey` and `isResolvedLocally` are always empty**
  (18,192 rows, 0 resolved), as are `ts_type_heritage.resolvedTypeLinkHash` and
  `resolvedGroupKey` (84 rows, 0 resolved). This is rule four working as designed —
  the parser has no checker — and it makes name→type resolution entirely the engine's
  job. Stated here only because the columns exist and a reader may assume they are
  populated.

* **`completeTypeName` carries type ARGUMENTS.** `Map<string, string>` has
  `typeName = "Map"` and `completeTypeName = "Map<string, string>"`. So
  `typeName == completeTypeName` is NOT a qualified/unqualified discriminator: under
  it every generic reference is misfiled as qualified. Measured cost before the engine
  truncated at the first `<`: 334 of 648 `Map` references resolved to nothing while
  the other 314 resolved fine — the kind of half-working that is easy to mis-attribute
  to a staging gap.

* **`referencedEntityHash` is populated and it is excellent.** 18,147 VARIABLE,
  14,386 PARAMETER, 5,410 IMPORT_BINDING, 359 METHOD, 193 TYPE, all with a real FK.
  The Java engine re-binds receivers by name inside the enclosing method because its
  IR has nothing here; none of that machinery is needed, and none of it is written.
  Worth protecting in any future schema change.

* **The site universe is exactly right.** The parser and `getResolvedSignature`
  independently find **14,076** call sites on the Parser repository and **23,011** on
  remeda — identical counts, and every one joins on its source span. For a conservation
  contract that is the strongest possible evidence, and it is what makes the accuracy
  numbers mean anything. The only divergence found anywhere is PD-TS-1.
