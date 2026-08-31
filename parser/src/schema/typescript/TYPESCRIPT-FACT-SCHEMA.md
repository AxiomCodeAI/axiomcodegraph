# TypeScript fact-table schema — proposal v1 (for approval)

**Author:** `ts-oracle`  **Status:** **APPROVED 2026-08-27** — spine frozen, building against it.
**Scope:** the base-relation contract between the TypeScript parser and the Souffle engine.

**21 relation pairs, 481 columns** — of which a **10-relation / 295-column spine** is what I
recommend freezing first (§9). Declarations will be **generated from this document** by
`gen_decls.py`, with `gen_decls.py --check` in CI, exactly as Python does. A hand-maintained
`.dl` drifts silently; that is not a risk worth taking twice.

Once approved this is frozen: **column order is the contract.** A later reorder invalidates
every golden file, every projection, and every `decls_base.dl` edit. Column *names* and enum
*values* are not frozen (the `.dl` carries only `c0..cN`); column *positions* are.

**§10 records every decision**, including the four approved rulings and the six questions I
closed myself with measurement. Nothing in this document is unanswered; two items are deferred
with a recorded trigger and a gate check that will raise them.

---

## 0. What I did instead of designing from Java outward

I measured two corpora with `typescript@6.0.3`'s own compiler, then designed to the numbers.
The Java relations encode Java's assumptions — nominal subtyping, one declaration per name,
no type-level computation — and TypeScript violates all three. Where a Java relation survives
contact with the measurement, I kept its column order to the position so the projection ports
as a rename. Where it does not, I say so and why.

**Corpus A — project code** (`Parser` + `SCA`, this fleet's own TypeScript): 297 project
files, 557 files in-program, 9,627 call/new sites.
**Corpus B — the ecosystem** (`@types/node`, `type-fest`, `rxjs`, `zod`, `effect`, `fp-ts`,
plus `lib.*.d.ts`): 1,113 declaration files. Corpus B is not an aside — it is precisely the
`lib_ts_*` population, and it is where the type system actually gets used.

Scripts are throwaway (`/tmp/ts6probe`, `/tmp/tscorpus`); the numbers are reproducible from
this document's claims.

### 0.0 The measurements that drove the design

| Measurement | Value | Consequence for the schema |
|---|---|---|
| Call/new sites where `getResolvedSignature` returns a signature | **9,627 / 9,627 = 100%** | Resolution is **decidable**, not plausible. The closed-world gate has a real 100% ceiling and every link is checkable against tsc. Python's 51% receiver-typing gap has no analogue here. |
| Resolved signatures with **no declaration node** | **225 (2.3%)** | Implicit constructors, synthesized members. `ts_call_site` needs `SYNTHESIZED_NO_DECLARATION` — an honest terminal, not a missing row. |
| Call targets declared **outside** the project | **5,002 / 9,627 = 52.0%** (42.3% `lib.*.d.ts`, 9.7% `node_modules`) | `lib_ts_*` is not an afterthought: more than half the call graph's leaves live there. A project-only closed world fails by construction. |
| Call targets that are a **`MethodSignature`** (an interface member, no body) | **4,261 (44.3%)** | The single most consequential number. In Java an interface target closes via `IMPLEMENTS_INTERFACE`. Here, 44% of targets are bodiless signatures — and (next row) 60% of classes declare no `implements`. |
| … of those, declared **outside** the project | **4,256 / 4,274 = 99.6%** | Bodiless interface targets are overwhelmingly *ambient*. So this is the same shape as Python's stub problem, and `lib_ts_*` carrying declarations-only is the correct model. |
| Classes with an `implements` clause | **59 / 149 = 39.6%** | 60.4% of classes satisfy their interfaces with no syntax saying so. `IMPLEMENTS_INTERFACE` cannot be the subtyping mechanism (§3.2). |
| Assignable (class, interface) pairs that are **structural-only** | **14 / 65 = 21.5%** | One satisfaction fact in five is invisible to an `implements`-reading extractor. |
| Assignable pairs that are **bidirectional** | **10 / 65 = 15.4%** | Mutual assignability is common and is **not** identity. A satisfaction relation must carry direction. |
| Interfaces with **no** declared implementer | **91 / 99 = 91.9%** | Most interfaces are data shapes, never implemented. An eager all-pairs satisfaction relation would be mostly noise → needs the pruning columns in §3.2. |
| Calls to a multi-declaration symbol resolving to a **non-first** declaration | **427 / 550 = 77.6%** | Picking the first declaration is wrong 78% of the time. A call site must point at a **signature**, never at a name. |
| Overload signatures (Corpus B) | **11,599** | Overload identity is a first-class column (`signatureRole`), not a flag. |
| Parameters with a type annotation | **85.3%** (A), **99.998%** (B) | The inverse of Python's 31.8%. Declared-type receiver typing is the primary mechanism, exactly as Java. This is why TypeScript needs no binder pass to be useful. |
| Symbols with **more than one declaration** (Corpus B) | **1,986**, max **43** declarations for one symbol | `name → single entity` is false at scale. The primary key must be stated before any row exists (§3.1). |
| Merge shapes observed | interface+interface **94**, class+interface **28**, function+namespace **84** | Merging crosses *declaration kinds*, so it cannot be a per-relation concern. |
| `import type` declarations (Corpus B) | **1,690 / 3,702 = 45.6%**, plus 34 inline `{ type X }` | Type-only is not an edge case; it is half the import graph. It must be flagged at emit time. |
| Union type nodes (Corpus B) | **11,382**; p50 **2**, p90 **3**, p99 **7**, **max 208**; 45 nested | Settles §3.4: **N rows with a parent FK**, never one row with a children column. A 208-member comma-set is not a column. |
| Max type-node nesting depth | **19** | Java/Python cap traversal at 5. A cap of 5 truncates real `.d.ts`. Cap at 20 with `isTruncated`. |
| Type-level constructs (Corpus B) | conditional **2,174**, mapped **605**, template-literal **161**, `infer` **1,337**, indexed-access **2,354**, `keyof`/`readonly`/`unique` **3,030**, `typeof` **775** | 10,436 nodes with no Java or Python analogue. They belong to `ts_type_reference` and must never reach `ts_expression`. |
| Anonymous structural types (Corpus B) | function types **21,956**, type literals **5,015** | Most *types* are not *declarations*. `ts_type` therefore holds declarations only; anonymous shapes live in the `ts_type_reference` tree. |
| Type parameters (Corpus B) | **42,032**; constrained 7,697; defaulted 2,014; **variance-annotated 562**; **`const` 87** | `in`/`out` (4.7) and `const` (5.0) occur in the wild. Both get columns; neither is hypothetical. |
| `readonly` members / optional members (Corpus B) | **8,901** / **5,196** | Optionality is load-bearing for structural satisfaction (a missing optional member does not break assignability) → `requiredMemberCount` on `ts_type`. |
| Parameter properties (`constructor(private x: T)`) | 8 (A) | One parameter declares a field. No Java or Python analogue; needs a cross-FK, not a duplicated row. |

### 0.1 DECISION REQUIRED — the parse layer

`CONTRIBUTING-typescript.md` leaves this open and says everything downstream depends on it.
I measured both options rather than reasoning about them.

**Recommendation: `ts.createSourceFile` from `typescript@6.0.3`. Not tree-sitter.**

| | `ts.createSourceFile` | `tree-sitter-typescript` |
|---|---|---|
| Measured throughput, no Program | **10.5 MB/s** — 2,931 files / 25.9 MB / 2,652,944 nodes in **2.47 s** | not measured; irrelevant if it cannot parse the input |
| Files failing to parse, same corpus | **0** | unknown; grammar lags (below) |
| Grammar currency | **is the reference implementation** | **0.23.2, published 2024-11-11** — ~21 months stale as of today; misses `const` type parameters, and TS/JS syntax moves faster than any other language here |
| 32,767-char buffer limit | none | **4.7% of real TypeScript files exceed it**; the largest in the corpus is `lib.dom.d.ts` at **2.3 MB**. This is the bug class Python paid for twice, and here it hits `.d.ts` — i.e. exactly the 52% of the call graph that lives outside the project |
| Architectural symmetry | breaks it: a `LanguageParser` that is not tree-sitter backed | reuses `LanguageParser` / `ParserFactory` / the callback workaround |
| Rule four (“no `ts.Program`”) | **satisfied** — `createSourceFile` is a pure function of text; no Program, no `node_modules`, no typecheck | satisfied |

Two things I verified specifically because they decide the question:

1. **`ts.createSourceFile` needs no Program.** It is text → AST, in-process, and it produced
   zero parse diagnostics over 25.9 MB including `lib.dom.d.ts`, `type-fest`, and `effect`.
2. **`ts.resolveModuleName` also needs no Program.** Measured: `"./a.js"` → `a.ts` with
   extension `.ts`, and an unresolvable specifier returns `undefined` — an honest negative.
   So **import resolution is parser-legal**, which is what makes `ts_import.resolvedFilePath`
   a tier-1/2 column rather than engine work.

The cost is one `LanguageParser` implementation that is not tree-sitter backed. I judge that
cheaper than a 4.7% silent truncation rate on the half of the call graph we cannot re-derive.

### 0.2 The TypeScript 6 ceiling — recorded, per your ruling

**Pinned oracle: `typescript@6.0.3`.** Verified in this repo: `ts.createProgram`,
`ts.createSourceFile`, `ts.resolveModuleName`, `ts.forEachChild` and the full `TypeChecker`
are all present; `getResolvedSignature` and `isTypeAssignableTo` behave as on 5.9.3.

**6.x is the ceiling for a compiler-as-library oracle.** I confirmed the shape of the cliff
independently: `typescript@7.0.2` is `type: "module"` with `"." → "./lib/version.cjs"`,
ships per-platform native binaries (`@typescript/typescript-darwin-arm64`, …), and exposes no
`ts.createProgram` and no `TypeChecker`. Its JS surface is `typescript/unstable/sync`
(an RPC client that drives the Go process) and `typescript/unstable/ast` — and that AST module
**contains no parser**: no `createSourceFile`, no `forEachChild`, only AST types, a scanner,
`is*` predicates and a visitor. Parsing happens in Go; JS receives a decoded AST over the wire.

**Consequence to plan for now, not later.** If 7.x becomes the only maintained line:

- **The oracle must move to driving the compiler out of process** — `typescript/unstable/sync`
  or tsserver over a pipe. The `Checker` surface there is adequate
  (`getSymbolAtLocation`, `getTypeAtLocation`, `getResolvedSignature`, `isTypeAssignableTo`,
  `getPropertiesOfType`, `getBaseTypes`, `getAliasedSymbol`, `getExportsOfModule`), and
  `createVirtualFileSystem` exists for in-memory fixtures. So the oracle survives the move;
  it changes transport, not capability.
- **The parser does not survive it.** There is no in-process JS parser in 7.x. Under 7.x-only,
  the parse layer must either stay on a pinned 6.x `typescript` dependency (viable: parsing is
  a pure function, so an old parser is a *known* parser, not a broken one) or move to
  tree-sitter and accept the grammar lag. This is the reason to record `emissionRegime` in
  `ts_module` and in its primary key (§4.1): a 6.x-parsed fact base and a 7.x-parsed fact base
  must be structurally distinguishable from inside the fact table, not just in a golden file.
- `tsconfig.json` in this repo now carries `"ignoreDeprecations": "6.0"` because 6.0.3 errors
  on `moduleResolution: node` and `baseUrl`, both of which **stop functioning in 7.0**. The
  `@/*` path aliasing will need migrating off `baseUrl` before any 7.x move. Filed, not fixed.

---

## 1. Naming, placement, key chaining

**One prefix per core language, `lib_` layered on top as provenance.** `java_*`/`lib_*` is not
a language distinction; it is project-under-analysis vs external. So:

```
ts_<entity>       TypeScript source under analysis   ← the parser emits ONLY these
lib_ts_<entity>   external / third-party TypeScript  ← the ENGINE stages these
```

Every entity keeps the `X` / `lib_X` pair with identical columns, so a projection keeps its
two-rule shape. Per the Python precedent, `lib_ts_*` **body** relations
(`lib_ts_expression`, `lib_ts_call_site`, `lib_ts_block`, `lib_ts_variable`,
`lib_ts_parse_gap`) are **declared and never staged** — ambient declarations have no bodies,
which is exactly why `lib_ts_*` gets declarations only. Corpus B is the evidence: 1,113
declaration files, 11,599 overload signatures, and not one function body among them.

`ts_type.isExternal` and `ts_module.isExternal` are **parity slots, always `false`** on parser
output, so the layout is byte-identical when the engine stages `lib_ts_*`.

**Constants** (`src/constants/entity-constants.ts`), one prefix per PK:

```
TS_MODULE  TS_TYPE  TS_TYPE_HERITAGE  TS_TYPE_PARAMETER  TS_TYPE_REFERENCE
TS_METHOD  TS_METHOD_PARAMETER  TS_FIELD  TS_FIELD_POSITION  TS_ENUM_MEMBER
TS_VARIABLE  TS_IMPORT  TS_EXPORT  TS_EXPRESSION  TS_CALL_SITE  TS_BLOCK
TS_COMMENT  TS_DECORATOR  TS_DECORATOR_ARGUMENT  TS_PARSE_GAP  TS_TYPE_SATISFIES
```

`HASH_ALGO` stays `md5`; PKs are `PREFIX_<md5hex>` via `EntityUtils.generateEntityHash`,
components joined with `||`, values through `EntityUtils.escapeTsv`. CSV filenames follow
`all-typescript-<plural>.csv` plus `skipped-typescript-files.csv`.

### Key-chaining discipline

Following `FieldRegistry` — which builds its hash from `typeRegistryLinkHash`, never from a
re-derived qualified name — **every child key chains off its parent's hash**:

```
ts_module.hash            = f(filePath, baseMservPath, declaredSpecifier, startLine, emissionRegime, serviceVersion)
ts_type.hash              = f(tsModuleLinkHash, escapedName, mergeScopeKey, startLine, startColumn)
ts_type_heritage.hash     = f(tsTypeLinkHash, clauseToken, position, heritageText, startLine)
ts_type_parameter.hash    = f(ownerLinkHash, position, name)
ts_method.hash            = f(tsModuleLinkHash, tsTypeLinkHash, qualifiedName, signature, startLine, startColumn)
ts_method_parameter.hash  = f(tsMethodLinkHash, position, paramName, paramKind)
ts_field.hash             = f(filePath, tsTypeLinkHash, name, fieldTypeName, startLine, startColumn)
ts_expression.hash        = f(tsModuleLinkHash, expressionOwnerHash, parentExpressionHash, position, startLine, startColumn)
ts_call_site.hash         = f(tsExpressionLinkHash)                    ← 1:1, pure chain
```

No child key is derived from a dotted name. **And no key is derived from a *merged symbol*** —
see §3.1, which is the one place this discipline had to be extended rather than copied.

---

## 2. Cross-language naming rule (inherited unchanged)

Fact-layer names follow the language spec; projection-layer names are shared and neutral.

| | Java | TypeScript |
|---|---|---|
| enum value | `TYPE_ON_DEMAND` | `NAMESPACE` (`import * as ns`) |
| column | `isOnDemand` | `isWildcard` *(same position, same meaning)* |
| projection | `import_wildcard` | **`import_wildcard`** — identical |

Where the terms genuinely diverge the language wins at the fact layer: TypeScript keeps
`TYPE_ONLY_NAMED`, `IMPORT_EQUALS_REQUIRE`, `EXPORT_ASSIGNMENT`, `SATISFIES_TARGET`,
`INFER`, `MAPPED` — none of which has a neutral cross-language reading, and renaming them to
match Java would be false parity.

---

## 3. The five things with no Java or Python analogue

These are the decisions the schema exists to make. Each is stated before any row exists.

### 3.1 Declaration merging — the primary key

**The problem, measured.** 1,986 symbols in Corpus B have more than one declaration; one has
**43**. Merging crosses declaration kinds (interface+interface 94, class+interface 28,
function+namespace 84). And it crosses **files**: I verified that
`declare module "./a.js" { interface Shape { extra: boolean } }` in `b.ts` merges into `a.ts`'s
`Shape` — tsc reports declarations in *both* files and a merged property set `[area, extra]`.
So neither "one row per name" nor "one row per file" is correct.

**The decision.**

> **`ts_type` (and `ts_method`, `ts_field`) has one row per DECLARATION SITE.
> The merged entity is identified by a non-unique group key, not by a primary key.**

- **Primary key** = the declaration site: `md5(tsModuleLinkHash ‖ escapedName ‖ mergeScopeKey ‖
  startLine ‖ startColumn)`. Always unique, always parser-derivable, never needs cross-file
  knowledge.
- **`declarationGroupKey`** = `md5(mergeScopeKey ‖ escapedName)`. **This is the merged
  entity's identity.** It is deliberately *not* unique: N declarations of one type produce N
  rows carrying the same group key, and the engine forms the merged type by grouping on it.
- **`mergeScopeKey`** is the binder's own merge criterion, expressed syntactically:

  | shape | `mergeScopeKey` |
  |---|---|
  | exported from a module file | `MODULE_EXPORTS:<tsModuleLinkHash>` |
  | module-local (not exported) | `MODULE_LOCALS:<tsModuleLinkHash>` |
  | in a global script or `declare global` | `GLOBAL` |
  | inside `declare module "x" { … }` (augmentation) | `MODULE_EXPORTS:<resolved target module hash>` |
  | inside a namespace | `NS:<parent declarationGroupKey>` |
  | inside a function body | `LOCALS:<tsMethodLinkHash>` |

This mirrors TypeScript's actual rule — a symbol *is* a `(symbol table, escaped name)` pair,
and merging *is* "same table, same name" — so it is right by construction rather than by
approximation. Note the augmentation row: the key uses the **resolved target** module, which
is why `ts.resolveModuleName` being parser-legal (§0.1) matters to the key and not just to
imports.

**Why this is verifiable and therefore tier 2, not tier 3.** The formula is authored, but its
*consequence* is checkable: the oracle partitions declarations by tsc's symbol identity and
asserts **set equality** with our partition by `declarationGroupKey`, in both directions. A
formula whose output the reference implementation can adjudicate is not a judgement call.
This is the schema exploiting the stronger oracle exactly where Python could not.

**Three consequences to state explicitly.**

1. **No `isPrimaryDeclaration` column, and no `declarationIndex`.** Choosing "the" declaration
   requires seeing all of them, which is cross-file, which the parser may not do. The engine
   derives an ordinal by sorting the group on `(filePath, startLine, startColumn)` — total and
   deterministic. A column here would be a lie in a single-file extraction.
2. **`declarationSpaces`** (`TYPE`, `VALUE`, `NAMESPACE`, comma-set) is carried per declaration,
   because merging is legal only when the spaces do not collide (class+interface merges;
   class+class is an error). The engine needs the spaces to know what a group *means*, and the
   parser can read them off the node kind.
3. **`typeCategory` of a merged group is authored** (§5, tier 3): when one group has both
   `CLASS_TYPE` and `INTERFACE_TYPE` declarations — 28 measured — the group's category is a
   priority decision the schema invents. The per-declaration category stays tier 2.

### 3.2 Structural satisfaction — `IMPLEMENTS_INTERFACE` does not port

**Measured:** 60.4% of classes declare no `implements`; 21.5% of assignable (class, interface)
pairs are structural-only; 15.4% are bidirectional; 91.9% of interfaces have no implementer at
all; and 2 interfaces in Corpus A are empty, hence satisfied by everything.

**The decision — three relations doing three different jobs, and only two of them are the
parser's.**

1. **`ts_type_heritage`** (§4.3) records the *syntax* of `extends` / `implements`, ordered.
   It carries **`inheritsMembers`**: `true` for `extends` (which really does inherit members),
   `false` for `implements` (a compile-time assertion that inherits nothing). Java conflates
   these because in Java both are authoritative for subtyping. Here `implements` is
   **non-authoritative and optional**, so `IMPLEMENTS_INTERFACE` survives only as a
   `ts_type_reference.context` value describing where a name was written — never as a
   subtyping edge.
2. **`ts_type` carries the shape**: `memberCount`, `requiredMemberCount`, `shapeDigest`. These
   exist to make candidate generation cheap — 91.9% of interfaces have no implementer, and the
   empty shape is satisfied by everything, so an engine that does not prune first computes
   noise at `O(classes × interfaces)`.
3. **`ts_type_satisfies`** (§4.21) is **declared but never staged by the parser.** Satisfaction
   requires `isTypeAssignableTo`; the parser has no checker; therefore the parser must not
   pretend. The relation is populated by the **engine** (member-wise matching over
   `ts_field` ∪ `ts_method`), and **adjudicated by the oracle** (`isTypeAssignableTo`). It
   carries `direction` and `evidence` (`DECLARED_IMPLEMENTS` | `DECLARED_EXTENDS` |
   `STRUCTURAL_DERIVED`) because 15.4% of pairs are mutually assignable and mutual
   assignability is **not** identity.

This is the deliberate division the brief asks for: the parser emits the evidence, the engine
derives the relation, and the oracle *measures the engine's error* — a gate Python could never
have, because duck typing is undecidable and structural typing is not.

### 3.3 Type-only constructs must never reach the call graph

**Measured:** 45.6% of Corpus B's import declarations are `import type`; 2,491 type aliases;
10,436 conditional/mapped/template-literal/`infer`/indexed-access/`keyof`/`typeof` nodes.

**The decision — four mechanisms, all at emit time, none downstream.**

1. **Type nodes live only in `ts_type_reference`.** A conditional, mapped, template-literal,
   `infer`, `keyof` or `typeof` type is a `ts_type_reference` row with the corresponding
   `kind`. It never produces a `ts_expression` row, so no call-graph rule can reach it — the
   containment is structural, not a filter someone must remember to apply.
2. **`isTypeOnly` is a hard column** on `ts_type` (true for `INTERFACE_TYPE`,
   `TYPE_ALIAS_TYPE`), `ts_method` (true for `METHOD_SIGNATURE`, `CALL_SIGNATURE`,
   `CONSTRUCT_SIGNATURE`, `FUNCTION_TYPE_SIGNATURE`), `ts_field` (true for
   `PROPERTY_SIGNATURE`), `ts_import`, `ts_export` and `ts_type_reference`
   (`isTypeOnlyPosition`).
3. **Type aliases *do* get `ts_type` rows** (`typeCategory = TYPE_ALIAS_TYPE`,
   `isTypeOnly = true`), because they are named declarations, they merge, they can be
   `extends`-ed, and there are 2,491 of them. Their RHS hangs off
   `aliasTargetReferenceLinkHash` into the `ts_type_reference` tree. What they do **not** get
   is any path into `ts_call_site`.
4. **The gate enforces it** (§8): a type-only fixture that produces a single call-graph row is
   a parser bug, and the suite says so by name rather than by coverage percentage.

### 3.4 Unions and intersections — N rows, not one

**Measured:** 11,382 union type nodes; p50 arity 2, p90 3, p99 7, **max 208**; 45 contain a
nested union or intersection; max type-node depth 19.

**The decision.** `A | B | C` is **one parent row** (`kind = UNION`, `childCount = 3`) plus
**N child rows**, each with `position` and `parentReferenceHash` — the same tree Java already
uses for `Map<K, V>`, so `type-resolution.dl` ports as a rename. A comma-set column was the
tempting alternative and the measurement kills it three times over: 208 members will not fit a
column anyone wants to read, members are arbitrary nested type nodes rather than names, and 45
nodes nest.

Two consequences:

- **`depth` is capped at 20, not 5.** Java and Python cap at 5. Measured max is 19, so a cap of
  5 truncates real `.d.ts`. Truncation sets `isTruncated`, so a lost subtree is visible rather
  than silent.
- **The parser emits *source* order and *source* arity, and the oracle must not compare against
  the checker's normalized union.** Verified on 6.0.3: `string | number | boolean` has source
  order `[string, number, boolean]` but checker order `[string, number, false, true]` — tsc
  normalizes `boolean` into two literal types and reorders by type id. Comparing member-wise
  against the checker would fail on correct output. The oracle compares **type-node trees**;
  `typeToString` is used for reporting, never for equality.

### 3.5 Ambient declarations — `lib_ts_*` gets declarations only

**Measured:** 52.0% of call targets are declared outside the project; 99.6% of bodiless
interface targets are external; 173 ambient module declarations; 11,756 `declare` modifiers;
zero function bodies in 1,113 declaration files.

**The decision.**

- A `.d.ts` file is a `ts_module` row with `moduleKind = DECLARATION_FILE`,
  `isDeclarationFile = true`.
- `declare module "x" { … }` is **its own `ts_module` row** (`moduleKind =
  AMBIENT_MODULE_DECLARATION`, `declaredSpecifier = "x"`), because it is an independently
  importable namespace and a merge scope. One file can hold many, so `declaredSpecifier` and
  `startLine` are in the module PK.
- `declare global { … }` is `moduleKind = GLOBAL_AUGMENTATION` with
  `mergeTableKey = GLOBAL`.
- `lib_ts_*` body relations are declared, never staged (§1). Bodiless declarations must never
  be mistaken for implementations, so `ts_method.bodyPresence` distinguishes
  `NO_BODY_AMBIENT` / `NO_BODY_INTERFACE` / `NO_BODY_OVERLOAD` / `NO_BODY_ABSTRACT` from
  `HAS_BODY` — this is the column that stops the engine attributing a call *implementation* to
  a `.d.ts` line.

---

## 4. The relations

Full ordered column lists. **Position is the contract. New columns append only.**
Every row ends `… serviceVersionLinkHash, <entityUniqueHash>`.

Legend:
`[J]` position matches `java_*` exactly — the projection ports as a literal rename.
`★` no Java analogue. `""` empty string is the legal "absent" value (Souffle has no nulls).
`T` tier: **1** = AST-structural, **2** = checker-derived and oracle-adjudicated,
**3** = authored (see §5; weaker, and reported separately).

> **A caution on tier 1, specific to this language.** If the parse layer is
> `ts.createSourceFile` (§0.1), then the parser and the oracle share a parser. Tier-1
> agreement is therefore *close to tautological about parsing* — it tests the mapping from
> node to row and column, not the parse. The load-bearing evidence in this schema is tier 2,
> which is why there is so much more of it than Python had. Do not read a tier-1 pass as
> "the parse is correct"; read it as "the projection of the parse is correct".

---

### 4.1 `ts_module` / `lib_ts_module` — 27 columns ★

A `.ts`/`.tsx`/`.d.ts` file, **or** an ambient module declaration, **or** a global
augmentation. No Java analogue: Java's package is implicit in `qualifiedName`, but a
TypeScript module is the unit of import resolution, the merge table for symbols, and the
boundary between module scope and global scope.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | file stem, or the quoted specifier for an ambient module |
| 1 | `qualifiedName` | 2 | the specifier by which this module is importable (extension-stripped, project-relative); for ambient, the declared specifier |
| 2 | `fileName` | 1 | `views.ts` |
| 3 | `filePath` | 1 | repo-relative |
| 4 | `baseMservPath` | 1 | service root (Java convention) |
| 5 | `moduleKind` | 1 | `SOURCE_MODULE` \| `SCRIPT_GLOBAL` \| `DECLARATION_FILE` \| `AMBIENT_MODULE_DECLARATION` \| `MODULE_AUGMENTATION` \| `GLOBAL_AUGMENTATION` \| `JSON_MODULE` |
| 6 | `scriptKind` | 1 | `TS` \| `TSX` \| `DTS` \| `MTS` \| `CTS` \| `JSON` — `ts.ScriptKind`, decides JSX parsing |
| 7 | `declaredSpecifier` | 1 | the `"x"` of `declare module "x"`; `""` for files. **In the PK** — one file may hold many (173 measured) |
| 8 | `isDeclarationFile` | 1 | `.d.ts` |
| 9 | `isExternalModule` | 1 | has a top-level `import`/`export` — **decides module scope vs global scope**, hence the merge table |
| 10 | `isAmbient` | 1 | contents are `declare`-only |
| 11 | `packageName` | 2 | owning npm package for external files; `""` for project files |
| 12 | `mergeTableKey` ★ | 2 | `GLOBAL` \| `MODULE_EXPORTS:<hash>` \| `MODULE_LOCALS:<hash>` — the §3.1 scope-key prefix minted by this module |
| 13 | `moduleResolutionMode` | 1 | `NODE16` \| `NODENEXT` \| `BUNDLER` \| `NODE10` \| `CLASSIC` — from the governing tsconfig |
| 14 | `tsConfigPath` | 1 | which tsconfig governs this file (resolution differs per project) |
| 15 | `targetTsVersion` ★ | 1 | exact compiler version at emit — `6.0.3`. **Provenance only, deliberately NOT in the PK** (see below) |
| 16 | `emissionRegime` ★ | 1 | **coarse token, never a version string**: `ts6-inproc` \| (future) `ts7-tsserver`. **In the PK**, per §0.2 and the note below |
| 17 | `startLine` | 1 | 1 for a file; the `declare module` line for an ambient row |
| 18 | `endLine` | 1 | |
| 19 | `hasTopLevelAwait` | 1 | forces module semantics |
| 20 | `hasJsxContent` | 1 | |
| 21 | `moduleInitMethodLinkHash` ★ | 1 | FK→`ts_method` — the synthetic `<module>` initializer owning top-level executable statements |
| 22 | `exportAssignmentLinkHash` ★ | 1 | FK→`ts_export` for `export = X`; `""` |
| 23 | `defaultExportLinkHash` ★ | 1 | FK→`ts_export`; `""` |
| 24 | `isExternal` | 1 | parity slot, always `false` on parser output |
| 25 | `serviceVersionLinkHash` | 1 | |
| 26 | `tsModuleUniqueHash` | — | **PK** |

**PK** `TS_MODULE_md5(filePath ‖ baseMservPath ‖ declaredSpecifier ‖ startLine ‖ emissionRegime ‖ serviceVersionLinkHash)`
**FKs** 21→`ts_method`, 22/23→`ts_export` (back-patched after those rows are minted;
accumulate-then-export makes this free).

#### Why `emissionRegime` is a coarse token and `targetTsVersion` is not in the key

`emissionRegime` is in the PK for the reason Python put it there: every child key chains off
the module hash, so a 6.x fact base and a 7.x fact base for the same file can never collide
even if both are loaded at once. §0.2 makes that live rather than hypothetical.

But it must be **coarse**. `targetTsVersion` (`6.0.3`) is the wrong granularity for a key:
a patch bump to `6.0.4` would change the module hash, and therefore **every child hash in the
entire fact base**, and therefore every golden file — for a release that cannot change a single
fact. The regime token names the *emission mechanism*, which is what actually changes fact
shape: `ts6-inproc` is "parsed in-process by the TypeScript 6 JS API"; `ts7-tsserver` would be
"obtained from a 7.x compiler over a pipe". Two mechanisms, two regimes, and every patch
release inside one mechanism shares a token.

`targetTsVersion` stays as a **non-key provenance column** so the exact compiler is still
recorded and a golden-file mismatch is still explainable — it just cannot cascade.

---

### 4.2 `ts_type` / `lib_ts_type` — 33 columns

A **type declaration**: class, interface, enum, type alias, namespace, or class expression.
Positions 0–11 mirror `java_type` 0–11, so `type_decl` / `type_lines` port as a rename.

**Anonymous structural types are NOT here** — 21,956 function types and 5,015 type literals in
Corpus B have no name, no declaration and no merge identity; they live in the
`ts_type_reference` tree (§4.5). `ts_type` is declarations only, which is what keeps it
key-able.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` [J] | 1 | `UserService`; `"default"` for `export default class {}`; `""` for a class expression |
| 1 | `qualifiedName` [J] | 1 | module specifier + namespace path + name |
| 2 | `fileName` [J] | 1 | |
| 3 | `typeCategory` [J] | 2 | `CLASS_TYPE` \| `INTERFACE_TYPE` \| `ENUM_TYPE` \| `CONST_ENUM_TYPE` \| `TYPE_ALIAS_TYPE` \| `NAMESPACE_TYPE` \| `CLASS_EXPRESSION_TYPE`. Tier 2: checkable against `SymbolFlags` (Class 32, Interface 64, Enum 384, TypeAlias 524288, Module 1536). **Tier 3 only for a merged group** (§5) |
| 4 | `typeAccess` [J] | 1 | `EXPORTED_ACCESS` \| `DEFAULT_EXPORT_ACCESS` \| `MODULE_LOCAL_ACCESS` \| `GLOBAL_ACCESS` \| `NAMESPACE_LOCAL_ACCESS`. TypeScript visibility is export-based, not modifier-based — Java's `PACKAGE_ACCESS` has no analogue |
| 5 | `typeModifier` [J] | 1 | comma-set: `ABSTRACT`, `DECLARE`, `CONST`, `EXPORT`, `DEFAULT_EXPORT`, `GENERIC` |
| 6 | `typePlacement` [J] | 1 | `TOP_LEVEL_PLACEMENT` \| `NAMESPACE_PLACEMENT` \| `NESTED_PLACEMENT` \| `LOCAL_PLACEMENT` (in a function body) \| `EXPRESSION_PLACEMENT` (class expression) \| `AMBIENT_MODULE_PLACEMENT` |
| 7 | `filePath` [J] | 1 | |
| 8 | `baseMservPath` [J] | 1 | |
| 9 | `startLine` [J] | 1 | |
| 10 | `endLine` [J] | 1 | |
| 11 | `isExternal` [J] | 1 | parity slot |
| 12 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 13 | `enclosingTypeLinkHash` ★ | 1 | FK→ self (namespace or class nesting); `""` — explicit, so no line-range trick is needed |
| 14 | `enclosingMethodLinkHash` ★ | 1 | FK→`ts_method` for a class declared inside a function |
| 15 | `declarationGroupKey` ★ | 2 | **the merged entity's identity** — `md5(mergeScopeKey ‖ escapedName)`. **Not unique** (§3.1) |
| 16 | `mergeScopeKey` ★ | 2 | the §3.1 table: `MODULE_EXPORTS:<h>` \| `MODULE_LOCALS:<h>` \| `GLOBAL` \| `NS:<groupKey>` \| `LOCALS:<methodHash>` |
| 17 | `escapedName` ★ | 1 | the binder's table key (`__String`); `"default"` for a default export |
| 18 | `declarationSpaces` ★ | 1 | comma-set `TYPE`, `VALUE`, `NAMESPACE` — which meanings this declaration occupies |
| 19 | `isAmbientDeclaration` ★ | 1 | `declare`, or inside a `.d.ts` |
| 20 | `isTypeOnly` ★ | 1 | **true for `INTERFACE_TYPE` and `TYPE_ALIAS_TYPE`** — no runtime entity; the call graph must never traverse this row (§3.3) |
| 21 | `typeParameterCount` | 1 | |
| 22 | `heritageCount` | 1 | number of `ts_type_heritage` rows |
| 23 | `memberCount` ★ | 1 | own declared members (fields + methods + index/call/construct signatures) |
| 24 | `requiredMemberCount` ★ | 1 | members without `?` — an optional member cannot break assignability, so this is the number satisfaction pruning uses |
| 25 | `shapeDigest` ★ | 3 | **TIER 3.** md5 over the normalized sorted `(memberName:kind:arity:optional)` set. **A pruning aid with no semantic claim** — equal digests are candidates, never a satisfaction fact (§5) |
| 26 | `aliasTargetReferenceLinkHash` ★ | 1 | FK→`ts_type_reference` — RHS of a type alias; `""` |
| 27 | `isExported` | 1 | cheap join, redundant with `typeAccess` |
| 28 | `hasIndexSignature` ★ | 1 | affects assignability and property lookup (126 measured) |
| 29 | `startColumn` ★ | 1 | **required for PK uniqueness** — class expressions and namespace-merged declarations can share a line |
| 30 | `endColumn` | 1 | |
| 31 | `serviceVersionLinkHash` | 1 | |
| 32 | `tsTypeUniqueHash` | — | **PK** |

**PK** `TS_TYPE_md5(tsModuleLinkHash ‖ escapedName ‖ mergeScopeKey ‖ startLine ‖ startColumn)`
**FKs** 12→`ts_module`, 13→`ts_type`, 14→`ts_method`, 26→`ts_type_reference`.
**Group key** 15 — the join key for "the type", used by every resolution rule.

---

### 4.3 `ts_type_heritage` / `lib_ts_type_heritage` — 20 columns ★

One row per `extends`/`implements` clause entry. Modelled on `py_type_base`, **not** on Java's
`type_reference`-only model, because heritage entries are ordered, can be arbitrary expressions
(mixins), and — critically — **`implements` is not authoritative for subtyping** (§3.2).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `heritageKind` | 1 | `EXTENDS_CLASS` \| `EXTENDS_INTERFACE` \| `IMPLEMENTS_CLAUSE` \| `EXTENDS_EXPRESSION` (mixin `extends f(Base)`) \| `EXTENDS_TYPE_LITERAL` |
| 1 | `clauseToken` | 1 | `EXTENDS` \| `IMPLEMENTS` |
| 2 | `position` | 1 | 0-based within its clause list (an interface may extend N) |
| 3 | `heritageText` | 1 | normalized source — `ns.Base<T>` |
| 4 | `heritageSimpleName` | 1 | rightmost identifier; `""` if not name-shaped |
| 5 | `heritageQualifiedPath` | 1 | full dotted path if name-shaped |
| 6 | `typeArgumentCount` | 1 | |
| 7 | `inheritsMembers` ★ | 1 | **`true` for `EXTENDS_*`, `false` for `IMPLEMENTS_CLAUSE`.** The column that stops Java's conflation: `extends` inherits members, `implements` asserts and inherits nothing |
| 8 | `tsTypeLinkHash` | 1 | FK→`ts_type` — the **subtype**; parent for key chaining |
| 9 | `tsModuleLinkHash` | 1 | FK→`ts_module` |
| 10 | `tsExpressionLinkHash` | 1 | FK→`ts_expression` for a mixin base; `""` |
| 11 | `tsTypeReferenceLinkHash` | 1 | FK→`ts_type_reference` — the twin row that feeds the shared name→type resolver |
| 12 | `resolvedTypeLinkHash` | 2 | FK→`ts_type`, parser-local resolution only; `""` |
| 13 | `resolvedGroupKey` | 2 | `declarationGroupKey` of the resolved supertype; `""` |
| 14 | `isResolvedLocally` | 2 | |
| 15 | `isDynamic` | 1 | `true` for `EXTENDS_EXPRESSION` — a computed base the parser cannot name |
| 16 | `startLine` | 1 | |
| 17 | `startColumn` | 1 | |
| 18 | `serviceVersionLinkHash` | 1 | |
| 19 | `tsTypeHeritageUniqueHash` | — | **PK** |

**PK** `TS_TYPE_HERITAGE_md5(tsTypeLinkHash ‖ clauseToken ‖ position ‖ heritageText ‖ startLine)`

Every entry **also** emits a `ts_type_reference` row (col 11 links them), so heritage names
resolve through the existing name→type machinery with no new rules. This relation adds only
ordering, the mixin/dynamic distinction, and `inheritsMembers`.

---

### 4.4 `ts_type_parameter` / `lib_ts_type_parameter` — 20 columns

Positions 0–6 mirror `java_type_parameter` 0–6. **One relation, not two.** Java has separate
`java_type_parameter` and `java_method_type_parameter`; TypeScript attaches type parameters to
**seven** owner kinds (class, interface, type alias, function, method, arrow, call/construct
signature) plus mapped and `infer` types, so N relations would multiply without adding
information. `ownerKind` + `ownerLinkHash` carries it instead. **This is a deliberate
divergence from Java** and it costs the `method_type_parameter` projection a rename plus an
`ownerKind` filter.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `paramName` [J] | 1 | `T` |
| 1 | `position` [J] | 1 | 0-based |
| 2 | `ownerTypeName` [J] | 1 | |
| 3 | `ownerQualifiedName` [J] | 1 | |
| 4 | `filePath` [J] | 1 | |
| 5 | `startLine` [J] | 1 | |
| 6 | `tsTypeLinkHash` [J] | 1 | FK→`ts_type`; `""` when the owner is a function |
| 7 | `ownerKind` ★ | 1 | `CLASS` \| `INTERFACE` \| `TYPE_ALIAS` \| `FUNCTION` \| `METHOD` \| `ARROW` \| `CALL_SIGNATURE` \| `CONSTRUCT_SIGNATURE` \| `MAPPED_TYPE` \| `INFER_TYPE` |
| 8 | `ownerLinkHash` ★ | 1 | polymorphic FK — `ts_type` \| `ts_method` \| `ts_type_reference` |
| 9 | `constraintReferenceLinkHash` | 1 | FK→`ts_type_reference`; `""` (7,697 constrained of 42,032) |
| 10 | `constraintText` | 1 | `extends keyof T` as written |
| 11 | `defaultReferenceLinkHash` | 1 | FK→`ts_type_reference`; `""` (2,014 measured) |
| 12 | `defaultText` | 1 | |
| 13 | `varianceAnnotation` ★ | 1 | `IN` \| `OUT` \| `IN_OUT` \| `""` — TS 4.7. **562 measured**; this is Java's `WildcardVariance` slot in spirit, but declaration-site, not use-site |
| 14 | `isConst` ★ | 1 | `const T` — TS 5.0. **87 measured** |
| 15 | `hasConstraint` | 1 | |
| 16 | `hasDefault` | 1 | |
| 17 | `startColumn` | 1 | |
| 18 | `serviceVersionLinkHash` | 1 | |
| 19 | `tsTypeParameterUniqueHash` | — | **PK** |

**PK** `TS_TYPE_PARAMETER_md5(ownerLinkHash ‖ position ‖ paramName)`

---

### 4.5 `ts_type_reference` / `lib_ts_type_reference` — 30 columns

The **type-node tree**. Positions 0–16 mirror `java_type_reference` 0–16, so the whole
name→type layer in `type-resolution.dl` ports with a relation rename. This is also where every
type-level construct lives (§3.3) and where unions become N rows (§3.4).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `kind` [J] | 1 | `TYPE_REFERENCE` \| `PRIMITIVE` \| `LITERAL` \| `ARRAY` \| `TUPLE` \| `UNION` \| `INTERSECTION` \| `FUNCTION_TYPE` \| `CONSTRUCTOR_TYPE` \| `TYPE_LITERAL` \| `CONDITIONAL` \| `MAPPED` \| `TEMPLATE_LITERAL` \| `INDEXED_ACCESS` \| `TYPE_QUERY` (`typeof x`) \| `TYPE_OPERATOR` (`keyof`/`readonly`/`unique`) \| `INFER` \| `TYPE_PREDICATE` \| `IMPORT_TYPE` \| `THIS_TYPE` \| `PARENTHESIZED` \| `REST` \| `OPTIONAL` \| `NAMED_TUPLE_MEMBER` \| `TYPE_VARIABLE` \| `INTRINSIC` |
| 1 | `context` [J] | 1 | `SUPER_TYPE` \| `IMPLEMENTS_CLAUSE` \| `TYPE_PARAM_CONSTRAINT` \| `TYPE_PARAM_DEFAULT` \| `FIELD_TYPE` \| `METHOD_RETURN` \| `METHOD_PARAM` \| `VARIABLE_TYPE` \| `TYPE_ALIAS_RHS` \| `TYPE_ARGUMENT` \| `AS_TARGET` \| `SATISFIES_TARGET` \| `TYPE_ASSERTION` \| `TYPE_PREDICATE_TARGET` \| `INDEX_SIGNATURE_KEY` \| `INDEX_SIGNATURE_VALUE` \| `MAPPED_CONSTRAINT` \| `MAPPED_TEMPLATE` \| `CONDITIONAL_CHECK` \| `CONDITIONAL_EXTENDS` \| `CONDITIONAL_TRUE` \| `CONDITIONAL_FALSE` \| `TEMPLATE_SPAN` \| `IMPORT_TYPE_QUALIFIER` \| `ENUM_MEMBER_TYPE` \| `HERITAGE_TWIN` |
| 2 | `tsTypeLinkHash` [J] | 1 | FK→`ts_type` — enclosing declaration |
| 3 | `typeParameterLinkHash` [J] | 1 | FK→`ts_type_parameter` when this reference *is* a type variable; `""` |
| 4 | `referencedTypeLinkHash` [J] | 2 | FK→`ts_type` when locally resolved; `""` |
| 5 | `parentReferenceHash` [J] | 1 | FK→ self — `string`'s parent is the `UNION` node |
| 6 | `position` [J] | 1 | index among siblings — **source order** (§3.4) |
| 7 | `depth` [J] | 1 | 0 = outermost; **capped at 20** (measured max 19) |
| 8 | `typeName` [J] | 1 | rightmost simple name — `User` |
| 9 | `completeTypeName` [J] | 1 | full written text — `Array<Map<string, User>>` |
| 10 | `typeVariableName` [J] | 1 | `T` if a type variable; `""` |
| 11 | `arrayDimensions` [J] | 1 | populated for `T[][]`; `""` otherwise |
| 12 | `wildcardVariance` [J] | 1 | repurposed: `READONLY` for `readonly T[]`, `UNIQUE` for `unique symbol`, else `""`. TypeScript has no use-site wildcards |
| 13 | `startLine` [J] | 1 | |
| 14 | `endLine` [J] | 1 | |
| 15 | `typeReferenceOwnerHash` [J] | 1 | polymorphic FK |
| 16 | `referenceOwnerKind` [J] | 1 | `TYPE` \| `METHOD` \| `METHOD_PARAM` \| `FIELD` \| `VARIABLE` \| `TYPE_PARAMETER` \| `EXPRESSION` \| `DECORATOR` \| `HERITAGE` \| `TYPE_REFERENCE` \| `ENUM_MEMBER` \| `EXPORT` |
| 17 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 18 | `childCount` ★ | 1 | **source** arity — a 208-member union has `childCount = 208` and 208 child rows |
| 19 | `isTypeOnlyPosition` ★ | 1 | `true` unless the node sits in a value-bearing position (e.g. `new C<T>()` type arguments). The structural guarantee of §3.3 |
| 20 | `resolvedGroupKey` ★ | 2 | `declarationGroupKey` of the referenced declaration; `""` |
| 21 | `isResolvedLocally` ★ | 2 | |
| 22 | `importSpecifier` ★ | 1 | for `import("mod").T`; `""` |
| 23 | `isOptionalElement` ★ | 1 | `[a?: T]` tuple element, or `?` on the annotated member |
| 24 | `isRestElement` ★ | 1 | `[...T[]]` |
| 25 | `literalValue` ★ | 1 | for `kind = LITERAL` — `'a'`, `42`, `true` (12,706 measured) |
| 26 | `isTruncated` ★ | 1 | the depth cap was hit; a lost subtree is visible, never silent |
| 27 | `startColumn` ★ | 1 | |
| 28 | `serviceVersionLinkHash` | 1 | |
| 29 | `tsTypeReferenceUniqueHash` | — | **PK** |

**PK** `TS_TYPE_REFERENCE_md5(typeReferenceOwnerHash ‖ context ‖ parentReferenceHash ‖ position ‖ depth ‖ completeTypeName ‖ startLine ‖ startColumn)`

---

### 4.6 `ts_method` / `lib_ts_method` — 43 columns

Every function-shaped declaration: function, method, constructor, accessor, arrow, function
expression, class static block, and **every bodiless signature** — method signatures, call and
construct signatures, and overload signatures. **Positions 0–20 are byte-for-byte
`java_method` 0–20**, so `method_decl` / `method_owner` / `method_kind` port as renames.

Two measurements shape this relation. Overload signatures number **11,599** in Corpus B and
**77.6%** of overloaded calls resolve to a non-first declaration, so a call site must be able
to name **one signature**; hence `signatureRole` and a per-signature PK. And **703** arrow
functions in Corpus A with **161** of them appearing as resolved call targets, so arrows are
`ts_method` rows, not expression detail.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` [J] | 1 | `getUser`; `<constructor>`, `<arrow>`, `<function-expression>`, `<call-signature>`, `<construct-signature>`, `<static-block>`, `<module>` for the unnamed |
| 1 | `signature` [J] | 1 | `getUser(id)` — name + parameter shape |
| 2 | `detailedSignature` [J] | 1 | with annotations, optionality and defaults — **this is what distinguishes overloads** |
| 3 | `qualifiedName` [J] | 1 | module + namespace + owner + name |
| 4 | `filePath` [J] | 1 | |
| 5 | `startLine` [J] | 1 | |
| 6 | `endLine` [J] | 1 | |
| 7 | `tsTypeLinkHash` [J] | 1 | **the owning type OR shape.** FK→`ts_type` normally; FK→`ts_type_reference` when `methodKind` is a `TYPE_LITERAL_*`, `FUNCTION_TYPE_SIGNATURE` or `CONSTRUCTOR_TYPE_SIGNATURE` value (§4.8.1). `""` only where no owner exists — a module-level function, an arrow, `MODULE_INITIALIZER` |
| 8 | `ownerTypeName` [J] | 1 | |
| 9 | `ownerQualifiedName` [J] | 1 | |
| 10 | `methodAccess` [J] | 1 | `PUBLIC_ACCESS` \| `PRIVATE_ACCESS` \| `PROTECTED_ACCESS` \| `PRIVATE_NAME_ACCESS` (`#m`) \| `EXPORTED_ACCESS` \| `MODULE_LOCAL_ACCESS` |
| 11 | `methodModifier` [J] | 1 | comma-set: `STATIC`, `ABSTRACT`, `ASYNC`, `GENERATOR`, `DECLARE`, `OVERRIDE`, `OPTIONAL`, `EXPORT`, `DEFAULT_EXPORT` |
| 12 | `returnTypeName` [J] | 1 | annotation text; `""` when inferred |
| 13 | `isVarArgs` [J] | 1 | has a rest parameter |
| 14 | `hasReceiverParameter` [J] | 1 | an explicit `this: T` parameter — same slot, TypeScript meaning |
| 15 | `defaultValueExpression` [J] | 1 | `""` — parity slot, unused |
| 16 | `methodKind` [J] | 1/3 | `FUNCTION_DECLARATION` \| `METHOD_DECLARATION` \| `CONSTRUCTOR` \| `GETTER` \| `SETTER` \| `ARROW_FUNCTION` \| `FUNCTION_EXPRESSION` \| `METHOD_SIGNATURE` \| `CALL_SIGNATURE` \| `CONSTRUCT_SIGNATURE` \| `TYPE_LITERAL_METHOD_SIGNATURE` ★ \| `TYPE_LITERAL_CALL_SIGNATURE` ★ \| `TYPE_LITERAL_CONSTRUCT_SIGNATURE` ★ \| `FUNCTION_TYPE_SIGNATURE` \| `CONSTRUCTOR_TYPE_SIGNATURE` \| `OBJECT_LITERAL_METHOD` \| `CLASS_STATIC_BLOCK` \| `MODULE_INITIALIZER` ★. Node-kind-driven (tier 1); the **priority order** is tier 3 (§5) |
| 17 | `parameterCount` [J] | 1 | |
| 18 | `hasTypeParameters` [J] | 1 | |
| 19 | `throwsExceptions` [J] | 1 | comma-set of `throw new X` type names in the body — *inferred*; TypeScript has no `throws` |
| 20 | `enclosingMemberLinkHash` [J] | 1 | FK→ self — closures |
| 21 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 22 | `declarationGroupKey` ★ | 2 | §3.1 group key — **this is also the overload set's identity** |
| 23 | `mergeScopeKey` ★ | 2 | |
| 24 | `escapedName` ★ | 1 | |
| 25 | `signatureRole` ★ | 1 | `SOLE` \| `OVERLOAD_SIGNATURE` \| `IMPLEMENTATION` \| `AMBIENT`. 11,599 overload signatures measured |
| 26 | `overloadIndex` ★ | 1 | 0-based among sibling signatures **within the same file** (overloads cannot span files except by merging, which `declarationGroupKey` covers) |
| 27 | `bodyPresence` ★ | 1 | `HAS_BODY` \| `NO_BODY_OVERLOAD` \| `NO_BODY_AMBIENT` \| `NO_BODY_INTERFACE` \| `NO_BODY_ABSTRACT`. **Must never be a call *implementation* target** — 44.3% of resolved targets are bodiless |
| 28 | `isTypeOnly` ★ | 1 | true for `METHOD_SIGNATURE`, `CALL_SIGNATURE`, `CONSTRUCT_SIGNATURE`, `FUNCTION_TYPE_SIGNATURE` (§3.3) |
| 29 | `isAsync` | 1 | |
| 30 | `isGenerator` | 1 | |
| 31 | `isAbstract` | 1 | |
| 32 | `isStatic` | 1 | |
| 33 | `optionalParameterCount` ★ | 1 | 5,394 measured; changes arity matching |
| 34 | `restParameterIndex` ★ | 1 | index of the rest parameter; `""` |
| 35 | `typeParameterCount` | 1 | |
| 36 | `thisParameterTypeName` ★ | 1 | the `this: T` annotation; `""` |
| 37 | `returnTypeReferenceLinkHash` | 1 | FK→`ts_type_reference`; `""` |
| 38 | `isTypePredicateReturn` ★ | 1 | `x is Y` — a narrowing function (440 measured); the engine's narrowing lever |
| 39 | `startColumn` ★ | 1 | **required for PK.** `const [a, b] = [() => 1, () => 2]` yields two arrows with identical name, signature and line — the lambda hazard Python found, in a language with 703 of them |
| 40 | `endColumn` | 1 | |
| 41 | `serviceVersionLinkHash` | 1 | |
| 42 | `tsMethodUniqueHash` | — | **PK** |

**PK** `TS_METHOD_md5(tsModuleLinkHash ‖ tsTypeLinkHash ‖ qualifiedName ‖ signature ‖ startLine ‖ startColumn)`

---

### 4.7 `ts_method_parameter` / `lib_ts_method_parameter` — 29 columns

Positions 0–11 mirror `java_method_parameter` 0–11 (the hash moves to the end).
**85.3%** of project parameters and **99.998%** of ambient parameters carry an annotation, so
this relation is the primary receiver-typing mechanism — the inverse of Python, where 68.2%
had none and argument flow had to carry the load.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `paramName` [J] | 1 | `""` for a binding pattern (destructured parameter) |
| 1 | `position` [J] | 1 | 0-based; an explicit `this` is position 0 |
| 2 | `tsMethodLinkHash` [J] | 1 | FK→`ts_method` — **parent** |
| 3 | `parameterBaseType` [J] | 1 | annotation minus type arguments |
| 4 | `parameterTypeName` [J] | 1 | full annotation text; `""` for the 14.7% |
| 5 | `potentialQualifiedName` [J] | 2 | |
| 6 | `isAmbiguous` [J] | 2 | |
| 7 | `isFinal` [J] | 1 | always `false` — parity slot |
| 8 | `isVarArgs` [J] | 1 | rest parameter (1,820 measured) |
| 9 | `isReceiverParameter` [J] | 1 | explicit `this` parameter |
| 10 | `startLine` [J] | 1 | |
| 11 | `endLine` [J] | 1 | |
| 12 | `paramKind` ★ | 1 | `REQUIRED` \| `OPTIONAL` \| `REST` \| `THIS` \| `BINDING_OBJECT` \| `BINDING_ARRAY` \| `PARAMETER_PROPERTY` |
| 13 | `isOptional` | 1 | `?` (5,394 measured) — **changes arity matching, so it is not cosmetic** |
| 14 | `hasDefault` | 1 | |
| 15 | `defaultValueText` | 1 | normalized source; `""` |
| 16 | `defaultValueKind` | 1 | `NONE` \| `STRING` \| `NUMBER` \| `BOOL` \| `NULL` \| `UNDEFINED` \| `OBJECT` \| `ARRAY` \| `CALL` \| `NEW` \| `IDENTIFIER` \| `ARROW` \| `TEMPLATE` \| `UNKNOWN` |
| 17 | `isParameterProperty` ★ | 1 | `constructor(private x: T)` — **one parameter declares a field.** No Java or Python analogue |
| 18 | `parameterPropertyModifier` ★ | 1 | comma-set `PRIVATE`, `PROTECTED`, `PUBLIC`, `READONLY` |
| 19 | `declaredFieldLinkHash` ★ | 1 | FK→`ts_field` — the field this parameter declares; `""`. A cross-FK, **not** a duplicated row |
| 20 | `bindingPatternText` ★ | 1 | source of the destructuring pattern; `""` |
| 21 | `bindingSourceKind` ★ | 1 | `NONE` \| `PROPERTY` \| `INDEX` \| `OBJECT_REST` \| `ARRAY_REST` — what a name bound by a pattern parameter binds. `NONE` for an ordinary parameter and for the pattern row itself |
| 22 | `bindingSource` ★ | 1 | the property name for `PROPERTY`, the index for `INDEX`, the index a rest starts at for `ARRAY_REST`; `""` otherwise |
| 23 | `typeReferenceLinkHash` | 1 | FK→`ts_type_reference`; `""` |
| 24 | `tsExpressionLinkHash` | 1 | FK→`ts_expression` — default-value root; `""` |
| 25 | `decoratorCount` ★ | 1 | parameter decorators (legacy DI pattern) |
| 26 | `startColumn` | 1 | |
| 27 | `serviceVersionLinkHash` | 1 | |
| 28 | `tsMethodParameterUniqueHash` | — | **PK** |

**PK** `TS_METHOD_PARAMETER_md5(tsMethodLinkHash ‖ position ‖ paramName ‖ paramKind)`

---

### 4.8 `ts_field` / `lib_ts_field` — 29 columns

Class properties, interface property signatures, index signatures, auto-accessors, parameter
properties, and object-literal properties. Positions 0–12 mirror `java_field` 0–12, and the PK
chains off `tsTypeLinkHash` exactly as `FieldRegistry` chains off `typeRegistryLinkHash` —
never off a re-derived qualified name.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` [J] | 1 | `""` for an index signature |
| 1 | `fieldTypeName` [J] | 1 | annotation text; `""` when inferred |
| 2 | `fieldBaseType` [J] | 1 | minus type arguments |
| 3 | `potentialQualifiedName` [J] | 2 | |
| 4 | `isAmbiguous` [J] | 2 | |
| 5 | `filePath` [J] | 1 | |
| 6 | `startLine` [J] | 1 | |
| 7 | `endLine` [J] | 1 | |
| 8 | `tsTypeLinkHash` [J] | 1 | **the owning type OR shape**; **parent for key chaining.** FK→`ts_type` normally; FK→`ts_type_reference` when `memberKind` is a `TYPE_LITERAL_*` value (§4.8.1) |
| 9 | `ownerTypeName` [J] | 1 | |
| 10 | `ownerQualifiedName` [J] | 1 | |
| 11 | `fieldAccess` [J] | 1 | `PUBLIC_ACCESS` \| `PRIVATE_ACCESS` \| `PROTECTED_ACCESS` \| `PRIVATE_NAME_ACCESS` (`#x` — a *hard* runtime private, unlike `private`) \| `EXPORTED_ACCESS` \| `MODULE_LOCAL_ACCESS` |
| 12 | `fieldModifier` [J] | 1 | comma-set: `STATIC`, `READONLY`, `DECLARE`, `ABSTRACT`, `OVERRIDE`, `OPTIONAL`, `DEFINITE_ASSIGNMENT`, `ACCESSOR` |
| 13 | `memberKind` ★ | 1 | `PROPERTY_DECLARATION` \| `PROPERTY_SIGNATURE` \| `INDEX_SIGNATURE` \| `TYPE_LITERAL_PROPERTY` ★ \| `TYPE_LITERAL_INDEX_SIGNATURE` ★ \| `PARAMETER_PROPERTY` \| `OBJECT_LITERAL_PROPERTY` \| `AUTO_ACCESSOR` |
| 14 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 15 | `isOptional` ★ | 1 | `?` — **5,196 measured; an absent optional member does not break assignability**, so §3.2 depends on this column |
| 16 | `hasDefiniteAssignment` ★ | 1 | `x!: T` |
| 17 | `isReadonly` ★ | 1 | 8,901 measured |
| 18 | `isStatic` | 1 | |
| 19 | `indexKeyTypeName` ★ | 1 | for `INDEX_SIGNATURE` — `string`/`number`/`symbol`/template (126 measured). A call through an index signature resolved to a `FunctionType` in the measurement, so this is a live resolution path |
| 20 | `isTypeOnly` ★ | 1 | true for `PROPERTY_SIGNATURE` (§3.3) |
| 21 | `typeReferenceLinkHash` | 1 | FK→`ts_type_reference`; `""` |
| 22 | `initializerExpressionLinkHash` | 1 | FK→`ts_expression`; `""` |
| 23 | `originParameterLinkHash` ★ | 1 | FK→`ts_method_parameter` for a parameter property; `""` |
| 24 | `memberGroupKey` ★ | 2 | `md5(ownerGroupKey ‖ escapedName ‖ isStatic)` — the member's identity across a **merged** owner, so a property declared in an augmentation joins the same member as one declared in the original. **A hash is one-way and must never be the only carrier of a relationship** — see §4.8.1 |
| 25 | `startColumn` | 1 | |
| 26 | `endColumn` | 1 | |
| 27 | `serviceVersionLinkHash` | 1 | |
| 28 | `tsFieldUniqueHash` | — | **PK** |

**PK** `TS_FIELD_md5(filePath ‖ tsTypeLinkHash ‖ name ‖ fieldTypeName ‖ startLine ‖ startColumn)`

#### 4.8.1 Anonymous shape members — the owner FK  *(raised by `ts-impl`, 2026-08-27)*

**Question asked: does this need another oracle? No. It needs a schema decision, which is
this section, and one line in an invariant the gate already runs.**

`{ toCsv(): string }` has member rows and nothing links the shape to them. Measured over the
fixture corpus plus this repository: **337 type literals holding 1,128 members**; **28 calls**
resolve to a `MethodSignature` inside a type literal and **74** to a `FunctionType`; and
**1,352 property accesses** resolve to a type-literal member, which is the number that matters
because property-chain walking is how a receiver gets typed. Real instances in this repo —
`entity.toCsv()` where the parameter is `{ toCsv(): string; getCsvHeader(): string }[]`. So the
link is load-bearing, not theoretical.

**Why no oracle.** Type-literal membership is `member.parent === typeLiteralNode` — a parent
pointer. It is **tier 1, purely syntactic**, and the parser already holds the value: it arrives
as the `typeLiteralHash` argument to its own `onTypeLiteralMember` callback. An oracle here
would be asking the TypeChecker to adjudicate a parent pointer. The two questions about
anonymous shapes that *do* need the checker are already blessed and gated:

| question | oracle call | already blessed? |
|---|---|---|
| which member does this call resolve to | `getResolvedSignature` | **yes** — 295 `MethodSignature`, 41 `CallSignature`, 42 `ConstructSignature`, 45 `FunctionType` targets in `EXPECTED_CALL_RESOLUTION` |
| does a concrete type satisfy this shape | `isTypeAssignableTo` | **yes** — `ts_type_satisfies` (§4.21) |
| which shape declares this member | *none — it is a parent pointer* | n/a |

**The actual defect is that the information is present and un-joinable.** The parser does carry
the type literal's identity, inside `memberGroupKey = md5(typeLiteralHash ‖ name ‖ false)`. That
is a *one-way* hash: nothing can join on it, in either direction. Its reasoning for
`tsTypeLinkHash: ''` was right — "inventing a `ts_type` would create a type the source does not
declare" — and §4.2 agrees, which is why anonymous shapes are deliberately absent from
`ts_type`. The mistake was concluding that the owner therefore had nowhere to go.

**Decision: widen the existing owner FK; do not append, and do not invent a `ts_type` row.**

- `ts_field` c8 and `ts_method` c7 point at `ts_type` **or** `ts_type_reference`.
- Discriminated by an **existing** column — `memberKind` / `methodKind` — using owner-qualified
  enum values. That is not a new sin: `OBJECT_LITERAL_PROPERTY`, `PARAMETER_PROPERTY` and
  `OBJECT_LITERAL_METHOD` are already owner-qualified, so the enum's design already works this
  way. `FUNCTION_TYPE_SIGNATURE` and `CONSTRUCTOR_TYPE_SIGNATURE` need no new value: a function
  type node is the only thing that can own them.
- Enum **values** are free to add — §0: names and values are not the frozen contract, column
  **order** is. Arity is unchanged, so no golden is invalidated and there is no re-freeze. This
  is the same mechanism as c16 (§4.14), applied a second time, which is a virtue: one pattern,
  not two inventions.
- **It restores key chaining.** `ts_field`'s PK chains off c8. With `""` there, the discipline
  §1 exists to enforce — child keys chain off the parent, never off a re-derived name — is
  simply broken for 127 rows. Filling it repairs that.

**The widening cannot mis-join.** PKs are `PREFIX_<md5hex>`, and the prefixes differ
(`TS_TYPE_…` vs `TS_TYPE_REFERENCE_…`), so an existing rule that joins c8 against `ts_type`
finds **no match** for a shape member rather than a wrong one. Fail-safe in the only direction
that matters: absent, never incorrect. A rule wanting class and interface members only should
filter on `memberKind`, which it should have been doing anyway.

**`""` is still correct for some rows, and the gate must not demand otherwise.** Measured, the
416 rows with an empty owner are three different things, and a blanket "owner must be non-empty"
rule would be wrong about two of them:

| category | rows | verdict |
|---|---|---|
| **anonymous shape members** — `PROPERTY_SIGNATURE` 124, `FUNCTION_TYPE_SIGNATURE` 115, `CONSTRUCTOR_TYPE_SIGNATURE` 8, `METHOD_SIGNATURE` 5, `INDEX_SIGNATURE` 3, `CALL_SIGNATURE` 3, `CONSTRUCT_SIGNATURE` 1 | **259** | **must be filled** — this section |
| **no owning type exists** — `MODULE_INITIALIZER` 67, `ARROW_FUNCTION` 43, `FUNCTION_EXPRESSION` 27 | 137 | `""` is **correct**. The module owns the initializer (`ts_module.moduleInitMethodLinkHash`); an arrow is reached by `ts_variable.boundFunctionLinkHash` or c16 |
| **owner is an object literal EXPRESSION** — `OBJECT_LITERAL_METHOD` 16, plus `GETTER` 2 / `SETTER` 2 if they sit in one | 20 | **a separate gap, not this one.** The owner is a `ts_expression` row, not a type or a shape. Left open deliberately rather than folded in — see OQ-10 |

So the gate asserts the owner is filled **for the enumerated shape-owned kinds only**, ratcheted
so `ts-impl` is not blocked by a slot that landed after their commit.

---

### 4.9 `ts_field_position` / `lib_ts_field_position` — 3 columns

Parity with `java_field_position`, unchanged. Declaration order within the owner — load-bearing
because a class's field order determines a parameter-property constructor's positional shape.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `tsFieldLinkHash` | 1 | FK→`ts_field` — **parent** |
| 1 | `position` | 1 | 0-based declaration order within the owning type |
| 2 | `tsFieldPositionUniqueHash` | — | **PK** |

**PK** `TS_FIELD_POSITION_md5(tsFieldLinkHash ‖ position)`

---

### 4.10 `ts_enum_member` / `lib_ts_enum_member` — 18 columns

`java_enum_constant` analogue. TypeScript enums differ in two ways that need columns: members
may be **computed** (so the value is not always statically known), and a `const enum` is
**inlined at use sites**, so a reference to one has no runtime member to link to.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` [J] | 1 | |
| 1 | `qualifiedName` [J] | 1 | |
| 2 | `ordinal` [J] | 1 | declaration order |
| 3 | `initializerText` [J] | 1 | `""` if none |
| 4 | `hasInitializer` [J] | 1 | |
| 5 | `hasBody` [J] | 1 | always `false` — parity slot (Java enum constants may have bodies; TypeScript's may not) |
| 6 | `filePath` [J] | 1 | |
| 7 | `startLine` [J] | 1 | |
| 8 | `endLine` [J] | 1 | |
| 9 | `tsTypeLinkHash` [J] | 1 | FK→`ts_type` — owning enum |
| 10 | `ownerTypeName` [J] | 1 | |
| 11 | `ownerQualifiedName` [J] | 1 | |
| 12 | `valueKind` ★ | 1 | `NUMERIC_LITERAL` \| `STRING_LITERAL` \| `IMPLICIT_ORDINAL` \| `COMPUTED` |
| 13 | `constantValue` ★ | 2 | the literal value when statically known; `""` for `COMPUTED` |
| 14 | `isConstEnumMember` ★ | 1 | member of a `const enum` — **inlined at use sites, so a reference may have no runtime target** |
| 15 | `tsExpressionLinkHash` | 1 | FK→`ts_expression` — initializer root; `""` |
| 16 | `serviceVersionLinkHash` | 1 | |
| 17 | `tsEnumMemberUniqueHash` | — | **PK** |

**PK** `TS_ENUM_MEMBER_md5(tsTypeLinkHash ‖ name ‖ ordinal)`

---

### 4.11 `ts_variable` / `lib_ts_variable` — 31 columns

`java_local_variable`'s analogue, **widened to module and global scope**, because in TypeScript
a module-level `const` is a first-class declaration and — measured — **161 resolved call
targets are arrow functions**, which are reached through the variable that binds them. Java
never needed that; Python folded it into `py_binding`. Positions 0–8 mirror
`java_local_variable` 0–8.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` [J] | 1 | `""` for a binding pattern |
| 1 | `variableTypeName` [J] | 1 | annotation text; `""` when inferred |
| 2 | `variableBaseType` [J] | 1 | |
| 3 | `potentialQualifiedName` [J] | 2 | |
| 4 | `isAmbiguous` [J] | 2 | |
| 5 | `filePath` [J] | 1 | |
| 6 | `startLine` [J] | 1 | |
| 7 | `endLine` [J] | 1 | |
| 8 | `scopeKind` [J] | 1 | `MODULE_SCOPE` \| `GLOBAL_SCOPE` \| `FUNCTION_BODY` \| `ARROW_BODY` \| `BLOCK_SCOPE` \| `FOR_BINDING` \| `CATCH_BINDING` \| `NAMESPACE_SCOPE` \| `AMBIENT_SCOPE` |
| 9 | `scopeDepth` [J] | 1 | lexical depth |
| 10 | `isConst` [J-ish] | 1 | Java's `isFinal` slot, TypeScript meaning: `const` |
| 11 | `isTypeInferred` [J-ish] | 1 | Java's `isVarInferred` slot: no annotation present |
| 12 | `tsTypeLinkHash` [J] | 1 | FK→`ts_type` — enclosing type; `""` |
| 13 | `tsMethodLinkHash` [J] | 1 | FK→`ts_method` — enclosing function; `""` at module scope |
| 14 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 15 | `tsBlockLinkHash` ★ | 1 | FK→`ts_block` — the block that scopes a `let`/`const`; `""` |
| 16 | `declarationKind` ★ | 1 | `CONST` \| `LET` \| `VAR` \| `USING` \| `AWAIT_USING` \| `CATCH` \| `FOR_OF` \| `FOR_IN` \| `FOR_INIT` |
| 17 | `hasInitializer` | 1 | |
| 18 | `initializerKind` | 1 | `ARROW` \| `FUNCTION_EXPRESSION` \| `NEW` \| `CALL` \| `OBJECT_LITERAL` \| `ARRAY_LITERAL` \| `LITERAL` \| `IDENTIFIER` \| `AS_EXPRESSION` \| `SATISFIES` \| `AWAIT` \| `TEMPLATE` \| `CLASS_EXPRESSION` \| `NONE` \| `UNKNOWN` |
| 19 | `boundFunctionLinkHash` ★ | 1 | FK→`ts_method` when the initializer is an arrow or function expression — **the link that makes `const f = () => …; f()` resolvable** (161 measured targets) |
| 20 | `typeReferenceLinkHash` | 1 | FK→`ts_type_reference`; `""` |
| 21 | `initializerExpressionLinkHash` | 1 | FK→`ts_expression`; `""` |
| 22 | `isExported` | 1 | |
| 23 | `isAmbientDeclare` | 1 | |
| 24 | `isDestructuring` | 1 | |
| 25 | `bindingSourceKind` ★ | 1 | `NONE` \| `PROPERTY` \| `INDEX` \| `OBJECT_REST` \| `ARRAY_REST` — what a destructured name binds. `NONE` for every ordinary declaration |
| 26 | `bindingSource` ★ | 1 | the property name for `PROPERTY`, the index for `INDEX`, the index a rest starts at for `ARRAY_REST`; `""` otherwise |
| 27 | `declarationGroupKey` ★ | 2 | module-scope variables can merge with a namespace of the same name, so they carry the §3.1 key too |
| 28 | `startColumn` | 1 | |
| 29 | `serviceVersionLinkHash` | 1 | |
| 30 | `tsVariableUniqueHash` | — | **PK** |

**PK** `TS_VARIABLE_md5(tsModuleLinkHash ‖ tsMethodLinkHash ‖ tsBlockLinkHash ‖ name ‖ startLine ‖ startColumn)`

**Note — no `ts_scope` / `ts_binding` relation, deliberately.** Python needed those because
`symtable` was its oracle and bindings were the only thing it could prove. Here the oracle
answers a *stronger* question per identifier (`getSymbolAtLocation` → declaration node), so the
schema records resolution **per reference** on `ts_expression` (cols 14–15) instead of a scope
table, and the lexical chain is recoverable from `ts_block` → `ts_method` → `ts_type` →
`ts_module`. This keeps the shape Java-like and makes the oracle check per-reference resolution
rather than set equality over scopes. If measurement later shows shadowing cases the chain
cannot express, `ts_scope` is an additive relation — see OQ-6.

---

### 4.12 `ts_import` / `lib_ts_import` — 27 columns

Positions 0–8 mirror `java_import` 0–8, so `import_single` / `import_wildcard` port as renames.
**45.6%** of Corpus B's import declarations are `import type`, so type-only is a first-class
column, not a flag bolted on.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `importKind` [J] | 1 | `NAMED` \| `NAMED_ALIAS` \| `DEFAULT` \| `NAMESPACE` \| `SIDE_EFFECT` \| `TYPE_ONLY_NAMED` \| `TYPE_ONLY_DEFAULT` \| `TYPE_ONLY_NAMESPACE` \| `INLINE_TYPE_SPECIFIER` \| `IMPORT_EQUALS_REQUIRE` \| `IMPORT_EQUALS_ENTITY` \| `DYNAMIC_IMPORT` \| `TYPE_IMPORT_NODE` \| `REQUIRE_CALL` \| `TRIPLE_SLASH_REFERENCE` |
| 1 | `importedPath` [J] | 1 | the specifier as written — `./a.js`, `node:os`, `rxjs/operators` |
| 2 | `moduleOrEntityName` [J] | 1 | Java's `packageOrTypeName` slot: the module specifier, or the entity path for `import x = a.b.C` |
| 3 | `simpleName` [J] | 1 | the locally bound name |
| 4 | `filePath` [J] | 1 | |
| 5 | `lineNumber` [J] | 1 | |
| 6 | `isTypeOnly` [J-slot] | 1 | Java's `isStatic` slot, repurposed: declaration-level **or** specifier-level type-only (1,690 + 34 measured) |
| 7 | `isWildcard` [J] | 1 | Java's `isOnDemand` slot: `import * as ns` — projection name stays `import_wildcard` (§2) |
| 8 | `isModuleImport` [J] | 1 | parity slot, always `false` (no TypeScript analogue of JEP 476) |
| 9 | `originalName` ★ | 1 | the exported name in the source module; `""` for namespace/side-effect |
| 10 | `aliasName` ★ | 1 | `""` if not aliased |
| 11 | `isDefaultImport` ★ | 1 | |
| 12 | `isSideEffectOnly` ★ | 1 | `import "./polyfill"` — no binding, but a real module edge |
| 13 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` — the importing module |
| 14 | `resolvedModuleLinkHash` ★ | 2 | FK→`ts_module`; `""` |
| 15 | `resolvedFilePath` ★ | 2 | from `ts.resolveModuleName` — **parser-legal without a Program** (§0.1) |
| 16 | `resolutionKind` ★ | 2 | `RELATIVE_FILE` \| `PATHS_ALIAS` \| `NODE_MODULES_TYPES` \| `NODE_MODULES_SOURCE` \| `PACKAGE_EXPORTS` \| `AMBIENT_MODULE` \| `BUILTIN_NODE` \| `UNRESOLVED` |
| 17 | `resolvedExtension` ★ | 2 | `.ts` \| `.tsx` \| `.d.ts` \| `.mts` \| `.cts` \| `.json` \| `""` |
| 18 | `isExternalTarget` ★ | 2 | did **not** resolve to a `ts_module` in this analysis — an honest negative, not a claim about the outside world |
| 19 | `packageName` ★ | 2 | owning package when external |
| 20 | `specifierHasExtension` ★ | 1 | `./a.js` vs `./a` — decides which resolution rules apply |
| 21 | `importClauseIndex` ★ | 1 | position within the clause (`{ a, b, c }`) |
| 22 | `tsExpressionLinkHash` ★ | 1 | FK→`ts_expression` for `import()` / `require()`; `""` |
| 23 | `startColumn` | 1 | |
| 24 | `isExternal` | 1 | parity slot |
| 25 | `serviceVersionLinkHash` | 1 | |
| 26 | `tsImportUniqueHash` | — | **PK** |

**PK** `TS_IMPORT_md5(tsModuleLinkHash ‖ importedPath ‖ importKind ‖ simpleName ‖ lineNumber ‖ importClauseIndex)`

One import declaration with N named specifiers produces **N rows**, one per bound name, because
each binds a distinct name and may be individually type-only.

---

### 4.13 `ts_export` / `lib_ts_export` — 21 columns ★ — NO JAVA ANALOGUE

Java has no export relation: visibility is a modifier and there is no re-export. TypeScript
needs one — Corpus B has **1,251** export declarations, **86** `export *`, **74**
`import x = require()`, and a re-export chain is the only path from an importer to the real
declaration. Python solved the same problem with `__all__`, which is a weaker instrument.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `exportedName` | 1 | the name importers see; `"default"` for a default export |
| 1 | `localName` | 1 | the local declaration's name; `""` for a pure re-export |
| 2 | `exportKind` | 1 | `INLINE_DECLARATION` (`export class X`) \| `NAMED_EXPORT` \| `NAMED_ALIAS` \| `DEFAULT_EXPORT` \| `DEFAULT_EXPRESSION` \| `EXPORT_STAR` \| `EXPORT_STAR_AS_NAMESPACE` \| `EXPORT_ASSIGNMENT` (`export =`) \| `TYPE_ONLY_NAMED` \| `TYPE_ONLY_STAR` \| `EXPORT_IMPORT_EQUALS` |
| 3 | `isTypeOnly` | 1 | `export type { X }` — must not create a call-graph edge |
| 4 | `isDefault` | 1 | |
| 5 | `isReExport` | 1 | has a `from` clause |
| 6 | `sourceSpecifier` | 1 | the `from "x"`; `""` |
| 7 | `tsModuleLinkHash` | 1 | FK→`ts_module` |
| 8 | `resolvedSourceModuleLinkHash` | 2 | FK→`ts_module` for a re-export; `""` |
| 9 | `exportedEntityKind` | 1 | `TYPE` \| `METHOD` \| `FIELD` \| `VARIABLE` \| `ENUM` \| `NAMESPACE` \| `MODULE` \| `EXPRESSION` \| `UNKNOWN` |
| 10 | `exportedEntityLinkHash` | 2 | polymorphic FK to the exported declaration; `""` |
| 11 | `exportedGroupKey` | 2 | `declarationGroupKey` of the exported declaration — survives merging |
| 12 | `position` | 1 | order within the export clause |
| 13 | `startLine` | 1 | |
| 14 | `endLine` | 1 | |
| 15 | `startColumn` | 1 | |
| 16 | `isAmbient` | 1 | |
| 17 | `tsExpressionLinkHash` | 1 | FK→`ts_expression` for `export default <expr>`; `""` |
| 18 | `isExternal` | 1 | parity slot |
| 19 | `serviceVersionLinkHash` | 1 | |
| 20 | `tsExportUniqueHash` | — | **PK** |

**PK** `TS_EXPORT_md5(tsModuleLinkHash ‖ exportedName ‖ exportKind ‖ sourceSpecifier ‖ startLine ‖ position)`

`EXPORT_STAR` deserves a note: it exports *everything* from the source module, and the set is
not knowable from this row alone. The engine expands it by joining the source module's exports.
That is a real soundness surface — like Python's `import *`, but at **86 sites** rather than 22,
so it is not an edge case here.

---

### 4.14 `ts_expression` / `lib_ts_expression` — 34 columns ★spine

Positions 0–24 are **byte-for-byte `java_expression` 0–24**, so `expr_kind`, `expr_child`,
`expr_owner` and the whole call-resolution projection port as renames. Appended columns carry
what TypeScript adds: optional chaining, `as`/`satisfies`, spread, and per-reference
resolution.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `kind` [J] | 1 | `CALL_EXPRESSION` \| `NEW_EXPRESSION` \| `PROPERTY_ACCESS` \| `ELEMENT_ACCESS` \| `IDENTIFIER_REFERENCE` \| `THIS_REFERENCE` \| `SUPER_REFERENCE` \| `LITERAL` \| `TEMPLATE_EXPRESSION` \| `TAGGED_TEMPLATE` \| `ARROW_FUNCTION` \| `FUNCTION_EXPRESSION` \| `CLASS_EXPRESSION` \| `OBJECT_LITERAL` \| `ARRAY_LITERAL` \| `BINARY_EXPRESSION` \| `UNARY_EXPRESSION` \| `TERNARY_EXPRESSION` \| `ASSIGNMENT_EXPRESSION` \| `COMPOUND_ASSIGNMENT` \| `AS_EXPRESSION` \| `SATISFIES_EXPRESSION` \| `TYPE_ASSERTION` \| `NON_NULL_EXPRESSION` \| `AWAIT_EXPRESSION` \| `YIELD_EXPRESSION` \| `SPREAD_ELEMENT` \| `DYNAMIC_IMPORT` \| `JSX_ELEMENT` \| `JSX_SELF_CLOSING` \| `DELETE_TYPEOF_VOID` \| `SEQUENCE_EXPRESSION` |
| 1 | `edgeRole` [J] | 1 | `ROOT` \| `RECEIVER` \| `QUALIFIER` \| `ARGUMENT` \| `METHOD_NAME` \| `PROPERTY_NAME` \| `INDEX_ARGUMENT` \| `LEFT_OPERAND` \| `RIGHT_OPERAND` \| `TERNARY_*` \| `UNARY_OPERAND` \| `AS_OPERAND` \| `SATISFIES_OPERAND` \| `SPREAD_OPERAND` \| `TEMPLATE_SPAN` \| `ARROW_BODY` \| `OBJECT_PROPERTY_VALUE` \| `ARRAY_ELEMENT` \| `TAG_EXPRESSION` \| `JSX_ATTRIBUTE_VALUE` \| `JSX_CHILD` |
| 2 | `rootContext` [J] | 1 | where the root expression sits (statement / initializer / return / condition / …) |
| 3 | `expressionOwnerKind` [J] | 1 | `METHOD` \| `FIELD` \| `VARIABLE` \| `BLOCK` \| `TYPE` \| `MODULE_INIT` \| `DECORATOR` \| `EXPORT` \| `ENUM_MEMBER` \| `PARAMETER_DEFAULT` |
| 4 | `tsTypeLinkHash` [J] | 1 | enclosing type; `""` |
| 5 | `expressionOwnerHash` [J] | 1 | polymorphic FK — enclosing owner |
| 6 | `parentExpressionHash` [J] | 1 | FK→ self |
| 7 | `position` [J] | 1 | index among siblings of the same role (argument index) |
| 8 | `depth` [J] | 1 | |
| 9 | `literalType` [J] | 1 | `STRING` \| `NUMBER` \| `BIGINT` \| `BOOLEAN` \| `NULL` \| `UNDEFINED` \| `REGEX` \| `TEMPLATE` \| `NO_SUBSTITUTION_TEMPLATE` \| `""` |
| 10 | `literalValue` [J] | 1 | |
| 11 | `methodReferenceKind` [J] | 1 | `""` — parity slot; TypeScript has no `::` |
| 12 | `unaryFixity` [J] | 1 | `PREFIX` \| `POSTFIX` \| `""` |
| 13 | `operatorString` [J] | 1 | `+`, `??`, `&&=`, … |
| 14 | `referencedEntityKind` [J] | 2 | `TYPE` \| `METHOD` \| `FIELD` \| `VARIABLE` \| `PARAMETER` \| `ENUM_MEMBER` \| `IMPORT_BINDING` \| `NAMESPACE` \| `THIS` \| `SUPER` \| `AMBIENT_GLOBAL` \| `UNKNOWN` |
| 15 | `referencedEntityHash` [J] | 2 | FK to the resolved declaration; `""`. **The oracle checks this against `getSymbolAtLocation`** |
| 16 | `anonymousDeclarationHash` [J] | 1 | **the declaration this expression introduces.** Polymorphic, discriminated by c0 `kind`: FK→`ts_type` for `CLASS_EXPRESSION`; **FK→`ts_method` for `ARROW_FUNCTION` / `FUNCTION_EXPRESSION`**; `""` otherwise. Widened from Java's `anonymousTypeHash` — see below |
| 17 | `potentialQualifiedName` [J] | 2 | |
| 18 | `isAmbiguous` [J] | 2 | |
| 19 | `returnStatementIndex` [J] | 1 | |
| 20 | `startLine` [J] | 1 | |
| 21 | `startColumn` [J] | 1 | |
| 22 | `endLine` [J] | 1 | |
| 23 | `endColumn` [J] | 1 | |
| 24 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 25 | `isOptionalChain` ★ | 1 | `a?.b`, `a?.()`, `a?.[i]` — changes nullability, not the target |
| 26 | `isNonNullAsserted` ★ | 1 | `a!` |
| 27 | `assertedTypeReferenceLinkHash` ★ | 1 | FK→`ts_type_reference` for `as T` / `satisfies T` / `<T>x`; `""`. **The one place a type node hangs off an expression** — and it is a *type* FK, so no call-graph rule reaches it |
| 28 | `isSpread` ★ | 1 | `f(...args)` — **marks where positional argument flow is provably imprecise** |
| 29 | `argumentCount` ★ | 1 | on a call/new node |
| 30 | `typeArgumentCount` ★ | 1 | explicit type arguments at the call site |
| 31 | `isTypeOnlyReachable` ★ | 1 | this node is reachable only from a type position (should always be `false`; a `true` row is a bug the gate reports) |
| 32 | `serviceVersionLinkHash` | 1 | |
| 33 | `tsExpressionUniqueHash` | — | **PK** |

**PK** `TS_EXPRESSION_md5(tsModuleLinkHash ‖ expressionOwnerHash ‖ parentExpressionHash ‖ edgeRole ‖ position ‖ startLine ‖ startColumn)`

#### Why c16 was WIDENED and not appended  *(raised by `ts-impl`, 2026-08-27)*

`ts-impl` found that an IIFE — `(function () { … })()` or `(() => { … })()` — has a callee
`ts_expression` row and a `ts_method` row, **and no FK between them.** c16 covered a class
expression and nothing covered a function one, so the engine's only route from the call to its
target was to match positions. Three call sites in the corpus, and it was classified
`needsSchemaSlot` and raised rather than papered over, which is the right call: it is a schema
gap, not a parser gap.

**It is a Java gap that TypeScript inherited.** Verified, not assumed:
`src/parsers/java/extractors/type-method-extractor.ts` builds
`posKey = ${startLine}:${startCol}:${endLine}:${endCol}` in `collectLambdaHashes` to link a
Java lambda to its method — the position match, done inside the extractor, three times over.
So Java has the same hole and hides it in extraction code, which is exactly what a fact schema
exists to prevent: §0.5's rule is that the engine joins by key and never by re-deriving or
text-matching.

**Widened, not appended, and the distinction matters.**

- Appending a column changes `ts_expression`'s arity from 34, and `ts_expression` is a frozen
  spine relation whose columns 0–24 are byte-for-byte `java_expression`. That is a re-freeze:
  every golden file, every projection, every `decls_base.dl` edit. Python paid this exact cost
  once (`py_expression` 35 → 39) and flagged it as needing sign-off.
- Widening c16 costs **nothing**: same arity, same order, no golden invalidated. Column *names
  and meanings* are not the frozen contract; column *order* is (§0).
- A polymorphic FK needs a discriminator, and **c0 `kind` already is one.** The mapping is
  total and closed, so there is nothing to keep in sync:

  | `kind` | c16 points at |
  |---|---|
  | `CLASS_EXPRESSION` | `ts_type` |
  | `ARROW_FUNCTION`, `FUNCTION_EXPRESSION` | `ts_method` |
  | anything else | `""` |

  Every other polymorphic FK in this schema is paired with a discriminator
  (`typeReferenceOwnerHash`/`referenceOwnerKind`, `expressionOwnerHash`/`expressionOwnerKind`,
  `ownerLinkHash`/`ownerKind`). This one gets its discriminator for free.

The Java projection keeps working: `anonymousTypeHash` read as "the anonymous type" is still
correct for `CLASS_EXPRESSION`, which is the only kind Java's own extractor ever fills it for.
A rule that wants only types filters on `kind = CLASS_EXPRESSION`, which it should have been
doing anyway.

**Consequence for `ts_method`:** no reverse column is needed. `ts_variable.boundFunctionLinkHash`
already covers `const f = () => …`, and with c16 filled the IIFE's callee expression reaches its
`ts_method` directly. One direction closes the call graph; two would be redundant state to keep
consistent.

---

### 4.15 `ts_call_site` / `lib_ts_call_site` — 25 columns ★spine

1:1 with a `CALL_EXPRESSION`, `NEW_EXPRESSION` or `TAGGED_TEMPLATE` expression row — a pure key
chain off `ts_expression`, exactly as `py_call_site` chains off `py_expression`. This relation
exists because **the flagship gate lives here**: every resolved target is compared against
`checker.getResolvedSignature`, and the measurement says that comparison is meaningful
(9,627/9,627 resolvable; 77.6% of overloaded calls pick a non-first declaration).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `callKind` | 1 | `FUNCTION_CALL` \| `METHOD_CALL` \| `CONSTRUCTOR_CALL` \| `SUPER_CALL` \| `TAGGED_TEMPLATE_CALL` \| `INDEX_CALL` (through an index signature) \| `DYNAMIC_IMPORT_CALL` \| `DECORATOR_CALL` \| `OPTIONAL_CALL` \| `JSX_COMPONENT_CALL` (**reserved, emitted by nothing in freeze 1** — §4.15.1) |
| 1 | `calleeName` | 1 | the simple name at the call site; `""` for a computed callee |
| 2 | `receiverKind` | 1 | `NONE` \| `IDENTIFIER` \| `THIS` \| `SUPER` \| `PROPERTY_CHAIN` \| `CALL_RESULT` \| `ELEMENT_ACCESS` \| `PARENTHESIZED` \| `NON_NULL` \| `AS_EXPRESSION` \| `AWAIT_RESULT` \| `UNKNOWN` |
| 3 | `receiverExpressionLinkHash` | 1 | FK→`ts_expression`; `""` |
| 4 | `receiverTypeName` | 1 | the receiver's **declared** type name when a declaration site gives it; `""`. 85.3% annotation coverage is why this is usually populated |
| 5 | `tsExpressionLinkHash` | 1 | FK→`ts_expression` — **parent, 1:1** |
| 6 | `tsModuleLinkHash` | 1 | FK→`ts_module` |
| 7 | `callerMethodLinkHash` | 1 | FK→`ts_method` — the enclosing function (via `ts_block` when the call sits in a block) |
| 8 | `callerTypeLinkHash` | 1 | FK→`ts_type`; `""` |
| 9 | `argumentCount` | 1 | |
| 10 | `spreadArgumentIndex` | 1 | index of the first spread argument; `""`. **Where this is set, positional argument flow is provably imprecise** |
| 11 | `typeArgumentCount` | 1 | |
| 12 | `resolvedSignatureLinkHash` | 2 | FK→`ts_method` — **the specific signature**, not the name. `""` when unresolved |
| 13 | `resolvedGroupKey` | 2 | `declarationGroupKey` of the target's overload set |
| 14 | `resolvedTargetKind` | 2 | `PROJECT_IMPLEMENTATION` \| `PROJECT_SIGNATURE` \| `AMBIENT_SIGNATURE` \| `LIB_SIGNATURE` \| `SYNTHESIZED_NO_DECLARATION` \| `INDEX_SIGNATURE` \| `UNRESOLVED`. Measured distribution: 45.7% project, 42.3% lib, 9.7% node_modules, 2.3% synthesized |
| 15 | `resolvedOverloadIndex` | 2 | which overload won; `""` when not an overload set |
| 16 | `overloadCandidateCount` | 2 | size of the overload set considered |
| 17 | `isOverloadResolved` | 2 | the set had >1 candidate and one was chosen |
| 18 | `resolutionEvidence` | 2 | `DECLARED_RECEIVER_TYPE` \| `IMPORT_BINDING` \| `LOCAL_BINDING` \| `THIS_MEMBER` \| `SUPER_MEMBER` \| `NAMESPACE_QUALIFIED` \| `INDEX_SIGNATURE` \| `AMBIENT_GLOBAL` \| `NONE` |
| 19 | `isTypeOnlyTarget` | 1 | **must always be `false`.** A `true` row means a type-only construct reached the call graph — §3.3's tripwire, and the gate fails on it by name |
| 20 | `isAmbientTarget` | 2 | target has no body — the closed-world gate counts these as *closed*, per §8 |
| 21 | `startLine` | 1 | |
| 22 | `startColumn` | 1 | |
| 23 | `serviceVersionLinkHash` | 1 | |
| 24 | `tsCallSiteUniqueHash` | — | **PK** |

**PK** `TS_CALL_SITE_md5(tsExpressionLinkHash)` — a pure chain; a call site *is* an expression.

#### 4.15.1 TSX — representation reserved now, emitted by nothing (RULED)

TSX is **out of the first freeze**. Corpus A has zero `.tsx` files, so there is nothing to
measure and no fixture to authorise against. But the representation is stated now, because
deciding it later would mean choosing under pressure from whatever the first TSX fixture
happens to look like.

**A JSX element is a call to its component.** `<Button size="lg">text</Button>` is
`Button({ size: "lg", children: "text" })` — not an analogy, that is the emit. So:

- `ts_call_site.callKind = JSX_COMPONENT_CALL`, `calleeName` = the tag name.
- The **whole props object is argument 0**, not one argument per attribute. `argumentCount` is
  1, or 0 for `<Button />` with no attributes and no children. Attributes are `ts_expression`
  rows with `edgeRole = JSX_ATTRIBUTE_VALUE` under that argument; children fold into the
  reserved `children` prop as `JSX_CHILD`. Mapping attributes to parameters positionally would
  be wrong — a component has exactly one parameter.
- A **lowercase** tag (`<div>`) is an intrinsic element, not a component: it resolves to a
  member of `JSX.IntrinsicElements` in an ambient declaration, so its target is an
  `AMBIENT_SIGNATURE` and it never links to project code.
- `ts_module.scriptKind = TSX` and `hasJsxContent` already carry the file-level facts.

**Freeze-1 obligation:** the enum values exist and **zero rows carry them**. The gate asserts
that emptiness, so the day TSX is switched on, the change shows up as a gate failure rather
than as new rows appearing unremarked.

**Who fills columns 12–18.** The parser fills them **only where resolution is syntactically
decidable**: a call to an imported name with a single signature, a call on a receiver whose
declared type is a locally declared class with a single method of that name, a `super.m()`.
Everything else is left `""` / `UNRESOLVED` for the engine. The oracle then adjudicates *both*:
a parser-filled value that disagrees with `getResolvedSignature` is a hard failure; an
engine-filled one is a measured error rate. That is the split the brief asks for — the parser
never guesses, and the guess it does not make becomes a number rather than a silence.

---

### 4.16 `ts_block` / `lib_ts_block` — 21 columns

Positions 0–17 mirror `java_block` 0–17, so `block_owner` / `block_kind` / `block_parent` port
as renames. Blocks matter here for the same reason as in Java — caller attribution — **plus**
one TypeScript-specific reason: a block is the scope of a `let`/`const`, so it is the lexical
link `ts_variable` needs in the absence of a `ts_scope` relation (§4.11).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `blockKind` [J] | 1 | `FUNCTION_BODY` \| `ARROW_BODY` \| `IF` \| `ELSE_IF` \| `ELSE` \| `FOR` \| `FOR_OF` \| `FOR_IN` \| `FOR_AWAIT_OF` \| `WHILE` \| `DO_WHILE` \| `TRY` \| `CATCH` \| `FINALLY` \| `SWITCH_CASE` \| `SWITCH_DEFAULT` \| `LABELED` \| `STATIC_BLOCK` \| `BARE_BLOCK` \| `MODULE_BODY` \| `NAMESPACE_BODY` |
| 1 | `order` [J] | 1 | |
| 2 | `filePath` [J] | 1 | |
| 3 | `startLine` [J] | 1 | |
| 4 | `endLine` [J] | 1 | |
| 5 | `startColumn` [J] | 1 | |
| 6 | `endColumn` [J] | 1 | |
| 7 | `nestingDepth` [J] | 1 | |
| 8 | `tsTypeLinkHash` [J] | 1 | |
| 9 | `methodOwnerHash` [J] | 1 | FK→`ts_method` |
| 10 | `parentContainerHash` [J] | 1 | FK→ self / method / module-init |
| 11 | `tryStatementHash` [J] | 1 | FK→ the `TRY` block for a `CATCH`/`FINALLY` |
| 12 | `resourceCount` [J] | 1 | `using` / `await using` declarations in this block (TypeScript 5.2's analogue of try-with-resources) |
| 13 | `caughtExceptionTypes` [J] | 1 | comma-set; **almost always `""`** — a TypeScript `catch` binding is `unknown` (or `any`) and cannot be typed, so unlike Java this column is nearly always empty. Kept for parity, not for information |
| 14 | `ownerTypeName` [J] | 1 | |
| 15 | `ownerQualifiedName` [J] | 1 | |
| 16 | `ownerMethodName` [J] | 1 | |
| 17 | `conditionExpressionLinkHash` ★ | 1 | FK→`ts_expression` — the guard, so the engine can narrow on `typeof x === "string"` / `x instanceof C` / a type predicate call (440 predicates measured) |
| 18 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 19 | `serviceVersionLinkHash` | 1 | |
| 20 | `tsBlockUniqueHash` | — | **PK** |

**PK** `TS_BLOCK_md5(methodOwnerHash ‖ parentContainerHash ‖ blockKind ‖ order ‖ startLine ‖ startColumn)`

---

### 4.17 `ts_comment` / `lib_ts_comment` — 14 columns

Positions 0–9 mirror `java_comment` 0–9. TypeScript adds JSDoc that carries *semantics* even in
`.ts`: `@deprecated`, `@internal`, `@ts-expect-error`, `@overload`.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `commentKind` [J] | 1 | `LINE` \| `BLOCK` \| `JSDOC` \| `TRIPLE_SLASH_DIRECTIVE` \| `TS_DIRECTIVE` (`@ts-ignore` / `@ts-expect-error`) |
| 1 | `commentText` [J] | 1 | escaped |
| 2 | `startLine` [J] | 1 | |
| 3 | `startColumn` [J] | 1 | |
| 4 | `endLine` [J] | 1 | |
| 5 | `endColumn` [J] | 1 | |
| 6 | `ownerHash` [J] | 1 | polymorphic FK — the documented declaration; `""` |
| 7 | `commentIndex` [J] | 1 | |
| 8 | `filePath` [J] | 1 | |
| 9 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 10 | `jsDocTags` ★ | 1 | comma-set of tag names present — `deprecated`, `internal`, `param`, `returns`, `see`, `template` |
| 11 | `directiveKind` ★ | 1 | `TS_IGNORE` \| `TS_EXPECT_ERROR` \| `TS_NOCHECK` \| `REFERENCE_PATH` \| `REFERENCE_TYPES` \| `REFERENCE_LIB` \| `""`. `REFERENCE_*` are real module edges and also feed `ts_import` |
| 12 | `serviceVersionLinkHash` | 1 | |
| 13 | `tsCommentUniqueHash` | — | **PK** |

**PK** `TS_COMMENT_md5(filePath ‖ startLine ‖ startColumn ‖ commentIndex)`

---

### 4.18 `ts_decorator` / `lib_ts_decorator` — 21 columns

**Java's annotation relation, same slot, same shared `annotation_on` projection.** Positions
0–12 mirror `java_annotation` 0–12. But a decorator is *not* an annotation: it is an expression
that **runs and can replace the decorated entity**, which is why it needs
`tsExpressionLinkHash` and `decoratorSemantics`. This is the same distinction Python drew for
`py_decorator`.

TypeScript now has **two** decorator systems, and they are not interchangeable: standard
decorators (TS 5.0, ECMAScript stage 3) and legacy `experimentalDecorators`. They differ in
evaluation order, in what they receive, and in whether parameter decorators are legal at all.
`decoratorSystem` records which one the governing tsconfig selected — without it, a fact base
mixes two semantics under one relation.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `decoratorName` [J] | 1 | `Injectable`, `Component` |
| 1 | `kind` [J] | 1 | `MARKER` \| `CALL` \| `MEMBER_EXPRESSION` \| `COMPUTED` |
| 2 | `context` [J] | 1 | `CLASS_DECLARATION` \| `METHOD_DECLARATION` \| `FIELD_DECLARATION` \| `ACCESSOR_DECLARATION` \| `PARAMETER_DECLARATION` \| `AUTO_ACCESSOR` |
| 3 | `ownerHash` [J] | 1 | polymorphic FK — the decorated entity |
| 4 | `tsTypeLinkHash` [J] | 1 | |
| 5 | `typeParameterHash` [J] | 1 | `""` — parity slot |
| 6 | `parentDecoratorHash` [J] | 1 | `""` — TypeScript decorators do not nest |
| 7 | `depth` [J] | 1 | |
| 8 | `position` [J] | 1 | **application order matters**: standard decorators apply bottom-up |
| 9 | `startLine` [J] | 1 | |
| 10 | `endLine` [J] | 1 | |
| 11 | `isMetaDecorator` [J] | 1 | `""`/`false` — parity slot |
| 12 | `argumentCount` [J-ish] | 1 | Java's slot 12 was `typeAnnotationUniqueHash`; here the hash moves to the end and 12 carries argument count |
| 13 | `decoratorSystem` ★ | 1 | `STANDARD_TC39` \| `LEGACY_EXPERIMENTAL` — from the governing tsconfig |
| 14 | `decoratorSemantics` ★ | 1 | `REPLACES_TARGET` \| `OBSERVES_TARGET` \| `UNKNOWN` — a decorator may substitute the entity, which no Java annotation can |
| 15 | `tsExpressionLinkHash` ★ | 1 | FK→`ts_expression` — the decorator expression, because it is **called at runtime** |
| 16 | `resolvedDecoratorMethodLinkHash` ★ | 2 | FK→`ts_method` — the decorator factory/function; `""` |
| 17 | `tsModuleLinkHash` ★ | 1 | FK→`ts_module` |
| 18 | `startColumn` | 1 | |
| 19 | `serviceVersionLinkHash` | 1 | |
| 20 | `tsDecoratorUniqueHash` | — | **PK** |

**PK** `TS_DECORATOR_md5(ownerHash ‖ decoratorName ‖ position ‖ startLine ‖ startColumn)`

---

### 4.19 `ts_decorator_argument` / `lib_ts_decorator_argument` — 13 columns

Positions 0–10 mirror `java_annotation_argument` 0–10, so the projection ports as a rename.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `argumentName` [J] | 1 | property name inside an options object; `""` for positional |
| 1 | `argumentValue` [J] | 1 | normalized source |
| 2 | `valueType` [J] | 1 | `STRING` \| `NUMBER` \| `BOOLEAN` \| `NULL` \| `UNDEFINED` \| `IDENTIFIER` \| `OBJECT` \| `ARRAY` \| `ARROW` \| `CALL` \| `CLASS_REFERENCE` \| `TEMPLATE` \| `UNKNOWN` |
| 3 | `position` [J] | 1 | |
| 4 | `parentDecoratorHash` [J] | 1 | FK→`ts_decorator` — **parent** |
| 5 | `referencedTypeHash` [J] | 2 | FK→`ts_type` when the value is a class reference (the DI pattern); `""` |
| 6 | `nestedObjectHash` [J] | 1 | FK→ self for a nested object literal; `""` |
| 7 | `arrayIndex` [J] | 1 | |
| 8 | `startLine` [J] | 1 | |
| 9 | `endLine` [J] | 1 | |
| 10 | `tsExpressionLinkHash` ★ | 1 | FK→`ts_expression`; `""` |
| 11 | `serviceVersionLinkHash` | 1 | |
| 12 | `tsDecoratorArgumentUniqueHash` | — | **PK** |

**PK** `TS_DECORATOR_ARGUMENT_md5(parentDecoratorHash ‖ position ‖ argumentName ‖ arrayIndex)`

---

### 4.20 `ts_parse_gap` / `lib_ts_parse_gap` — 10 columns ★

`py_parse_gap`'s analogue: record what was not parsed, **never rewrite source**, positions stay
measured. Under `ts.createSourceFile` this relation should always be empty — measured 0 failures
over 25.9 MB — and that is precisely why it must exist: an always-empty relation that suddenly
has rows is a signal, whereas a missing relation is a silence.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `gapKind` | 1 | `PARSE_DIAGNOSTIC` \| `UNSUPPORTED_SYNTAX` \| `FILE_TOO_LARGE` \| `ENCODING_ERROR` \| `READ_ERROR` \| `EXCLUDED_BY_CONFIG` |
| 1 | `diagnosticCode` | 1 | the TypeScript diagnostic number; `""` |
| 2 | `message` | 1 | escaped |
| 3 | `filePath` | 1 | |
| 4 | `startLine` | 1 | |
| 5 | `startColumn` | 1 | |
| 6 | `endLine` | 1 | |
| 7 | `tsModuleLinkHash` | 1 | FK→`ts_module`; `""` if the module row could not be minted |
| 8 | `serviceVersionLinkHash` | 1 | |
| 9 | `tsParseGapUniqueHash` | — | **PK** |

**PK** `TS_PARSE_GAP_md5(filePath ‖ startLine ‖ startColumn ‖ gapKind ‖ diagnosticCode)`

---

### 4.21 `ts_type_satisfies` / `lib_ts_type_satisfies` — 16 columns ★ — DECLARED, NOT PARSER-STAGED

The structural-typing relation (§3.2). **The parser emits no rows here.** Satisfaction needs
`isTypeAssignableTo`; the parser has no checker; a parser-emitted row would be a guess dressed
as a fact. Populated by the **engine** from `ts_field` ∪ `ts_method` ∪ `ts_type_heritage`, and
**adjudicated by the oracle**.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `sourceGroupKey` | 2 | the satisfying type (`declarationGroupKey`) |
| 1 | `targetGroupKey` | 2 | the satisfied type |
| 2 | `sourceTypeLinkHash` | 2 | FK→`ts_type` — a representative declaration |
| 3 | `targetTypeLinkHash` | 2 | FK→`ts_type` |
| 4 | `direction` | 2 | `SOURCE_TO_TARGET` \| `BIDIRECTIONAL`. **15.4% of pairs are bidirectional and that is not identity** |
| 5 | `evidence` | 2 | `DECLARED_IMPLEMENTS` \| `DECLARED_EXTENDS` \| `STRUCTURAL_DERIVED`. Measured: 78.5% declared, **21.5% structural-only** |
| 6 | `matchedMemberCount` | 2 | required target members matched |
| 7 | `targetRequiredMemberCount` | 2 | from `ts_type.requiredMemberCount` |
| 8 | `isExactShape` | 2 | source has no members beyond the target's |
| 9 | `isTrivialTarget` | 2 | target has zero required members — **satisfied by everything**; 2 measured, and they would otherwise dominate the relation |
| 10 | `derivationMethod` | 3 | `MEMBER_WISE` \| `DIGEST_PRUNED` \| `HERITAGE_CLOSURE` — how the engine reached it (tier 3: our procedure, not tsc's) |
| 11 | `oracleAgreement` | 2 | `AGREES` \| `FALSE_POSITIVE` \| `FALSE_NEGATIVE` \| `UNCHECKED` — written by the **oracle**, never by the engine. This column is the measurement of §3.2's honesty |
| 12 | `sourceModuleLinkHash` | 2 | |
| 13 | `targetModuleLinkHash` | 2 | |
| 14 | `serviceVersionLinkHash` | 1 | |
| 15 | `tsTypeSatisfiesUniqueHash` | — | **PK** |

**PK** `TS_TYPE_SATISFIES_md5(sourceGroupKey ‖ targetGroupKey ‖ direction)`

Column 11 is unusual and deliberate: the relation carries its own error term. An engine-derived
satisfaction edge is not a fact about TypeScript, it is a claim, and the schema makes the claim
falsifiable in place rather than in a report nobody reads.

---

## 5. Tier classification, and what actually landed in tier 3

Python ended with four tier-3 fields — `typeCategory`, `typeModifier`, `methodKind`,
`importKind`. You expected a **smaller** tier 3 here, and predicted `typeCategory =
INTERFACE_TYPE` would be in it. **I verified rather than accepted, and the prediction is wrong
in an interesting way.**

| Field | Python's tier | TypeScript's tier | Why it moved |
|---|---|---|---|
| `typeCategory` | 3 (priority order authored) | **2**, with a tier-3 residue | tsc reports it directly: `SymbolFlags.Class = 32`, `Interface = 64`, `Enum = 384`, `TypeAlias = 524288`, `Module = 1536`. So `INTERFACE_TYPE` **is** a symbol flag, not an invention. Residue: a *merged group* holding both class and interface declarations (28 measured) needs an authored priority. Also, raw flags carry noise — I measured `Shape.flags = 33554496` = `Interface | Transient` after an augmentation — so the oracle must mask to the meaning bits before comparing. That masking rule is authored; the mapping is not |
| `typeModifier` | 3 (`CALLABLE_INSTANCE` undefined) | **1** | every value is a keyword on the node: `abstract`, `declare`, `const`, `export`, `default`. Nothing is inferred from behaviour |
| `methodKind` | 3 (priority order + unrecognised-decorator default, 7.1% error) | **1**, with a tier-3 residue | node kind decides it: `FunctionDeclaration`, `MethodDeclaration`, `Constructor`, `GetAccessor`, `ArrowFunction`, `MethodSignature`, `CallSignature`, `ConstructSignature`, `ClassStaticBlockDeclaration`. No decorator inspection is needed, which is what made Python's version weak. Residue: the priority order when a node satisfies several (an `async` generator method; an arrow assigned to a class property — is that `ARROW_FUNCTION` or `METHOD_DECLARATION`?) |
| `importKind` | 3 for 1 of 9 values (`DYNAMIC`) | **1** for 14 of 15; **2** for the 15th | every value is a node shape: `ImportDeclaration` + `isTypeOnly` + `namedBindings` kind, `ImportEqualsDeclaration`, `import()` in a value vs a type position (the parent node decides — tier 1). The 15th is `REQUIRE_CALL`: deciding whether `require` is *the* `require` needs the local binding, which the parser resolves lexically and the oracle confirms via `getSymbolAtLocation` → **tier 2, not tier 3**. Measured 0 in Corpus A, 74 `import =` in Corpus B |
| `declarationGroupKey` / `mergeScopeKey` | no analogue | **2** | authored formula, oracle-adjudicated consequence: set equality against tsc's symbol partition, both directions (§3.1). This is the case that best shows why tier 3 shrank — a stronger oracle converts authored formulas into checkable ones |
| `resolvedSignatureLinkHash`, `resolvedTargetKind`, `resolvedOverloadIndex` | would have been 3 | **2** | `getResolvedSignature`. Python had no analogue at all; 51% of its call sites were unadjudicable |
| `ts_type_satisfies.*` | no analogue (duck typing is undecidable) | **2** | `isTypeAssignableTo` decides it exactly |

### The whole of tier 3 — five items

Everything below is **me deciding**. It buys author separation (`ts-oracle` writes it,
`ts-impl` implements it, so a disagreement is visible instead of encoded twice by one hand). It
buys **no ground truth**. Report it separately; never aggregate it with the tsc-adjudicated
gate.

1. **`typeCategory` of a merged group** — when one `declarationGroupKey` holds both
   `CLASS_TYPE` and `INTERFACE_TYPE` declarations (28 measured). **Decision: the value space
   wins over the type space** — `CLASS_TYPE`, because the group has a runtime entity and the
   call graph needs to know that. Per-declaration categories stay tier 2 and remain emitted, so
   nothing is lost.
2. **`methodKind` priority order.** **Decision, highest first:** `CONSTRUCTOR` →
   `GETTER`/`SETTER` → `CLASS_STATIC_BLOCK` → `METHOD_SIGNATURE`/`CALL_SIGNATURE`/
   `CONSTRUCT_SIGNATURE` (bodiless, by node kind) → `METHOD_DECLARATION` → `ARROW_FUNCTION` →
   `FUNCTION_EXPRESSION` → `FUNCTION_DECLARATION`. `async` and generator are **modifiers**, not
   kinds — Python conflated them and needed 6 extra enum values for it. An arrow assigned to a
   class property is `ARROW_FUNCTION` with `tsTypeLinkHash` set: the node kind wins, the owner
   is recorded, and no information is lost either way.
3. **`shapeDigest` normalization** (`ts_type.25`). Authored: md5 over the sorted set of
   `name:memberKind:arity:isOptional`, excluding private-name members (`#x`, which cannot
   participate in structural satisfaction), excluding `static` members, index signatures folded
   in as `[key:T]`. **A pruning aid with no semantic claim**: equal digests are *candidates*.
   An unequal digest must never be read as "does not satisfy" — inherited members and optional
   members break that inference, which is exactly why `ts_type_satisfies` carries `evidence`
   and `oracleAgreement` rather than trusting the digest.
4. **`ts_type_satisfies.derivationMethod`** — how the engine reached the edge. Our procedure,
   not tsc's, so it cannot be adjudicated even though the edge itself can.
5. **The `SymbolFlags` masking rule** used by the oracle when checking `typeCategory`:
   compare only `Class | Interface | Enum | ConstEnum | TypeAlias | Function | Module |
   Variable`, ignoring `Transient`, `Optional`, `Alias`, `Prototype`, `ExportStar`. Authored
   because the noise bits are an implementation detail of tsc, not a documented contract —
   measured live (`Interface | Transient` on an augmented interface).

**Tier 3 is 5 items over 481 columns.** Python's was 4 items over 425 with materially more
riding on each (a 7.1% measured error rate on the `methodKind` default alone). The reduction is
not cleverness; it is the oracle answering questions CPython could not.

---

## 6. Java ↔ TypeScript relation mapping, both directions

### 6.1 Java relations that port, and how cleanly

| Java relation | TypeScript | Ports? |
|---|---|---|
| `java_type` (14) | `ts_type` (33) | **0–11 identical.** `type_decl` / `type_lines` are renames |
| `java_type_reference` (18) | `ts_type_reference` (30) | **0–16 identical.** The whole name→type layer is a rename; `wildcardVariance` is repurposed (§4.5 c12) |
| `java_type_parameter` (8) + `java_method_type_parameter` (10) | `ts_type_parameter` (20) | **Two collapse to one** — 0–6 identical, then `ownerKind`. Deliberate divergence (§4.4) |
| `java_method` (22) | `ts_method` (43) | **0–20 identical.** `method_decl` / `method_owner` / `method_kind` are renames |
| `java_method_parameter` (13) | `ts_method_parameter` (27) | **0–11 identical** |
| `java_field` (14) | `ts_field` (29) | **0–12 identical**; hash-chaining discipline preserved exactly |
| `java_field_position` (3) | `ts_field_position` (3) | identical |
| `java_expression` (25) | `ts_expression` (34) | **0–24 identical.** `expr_kind` / `expr_child` / `expr_owner` are renames — the single most valuable port |
| `java_local_variable` (19) | `ts_variable` (29) | 0–8 identical; widened to module/global scope (§4.11) |
| `java_block` (18) | `ts_block` (21) | **0–17 identical.** `caughtExceptionTypes` survives but is near-always `""` |
| `java_import` (11) | `ts_import` (27) | 0–8 identical, with two slots repurposed: `isStatic`→`isTypeOnly`, `isOnDemand`→`isWildcard`. `import_wildcard` stays `import_wildcard` |
| `java_annotation` (13) | `ts_decorator` (21) | 0–12 mirrored; **shared `annotation_on` projection** |
| `java_annotation_argument` (11) | `ts_decorator_argument` (13) | 0–10 identical |
| `java_comment` (10) | `ts_comment` (14) | 0–9 identical |
| `java_enum_constant` (13) | `ts_enum_member` (18) | 0–11 mirrored |

### 6.2 Java relations with **no** TypeScript analogue

| Java | Why it does not port |
|---|---|
| `java_property_key`, config XML / YAML / properties relations | Spring configuration. TypeScript's equivalents (`package.json`, `tsconfig.json`, `.env`) are a separate concern and out of scope for this schema |
| `java_method_type_parameter` as a *separate relation* | folded into `ts_type_parameter` (§4.4) |
| `TypeRefContext.PERMITS` | `sealed` has no TypeScript analogue. A union of literal types is the idiom, and it is a `ts_type_reference` `UNION`, not a heritage edge |
| `TypeRefContext.IMPLEMENTS_INTERFACE` **as a subtyping edge** | **§3.2.** Survives as a `context` value describing where a name was written; does **not** survive as a subtyping fact. This is the single biggest semantic non-port |
| `TypeAccess.PACKAGE_ACCESS` | no packages. Replaced by `MODULE_LOCAL_ACCESS` |
| `WildcardVariance.{UNBOUNDED,EXTENDS,SUPER}` | no use-site wildcards. Replaced by *declaration-site* `varianceAnnotation` (`in`/`out`, 562 measured) |
| `MethodModifier.{SYNCHRONIZED,NATIVE,STRICTFP}` | no analogue |
| `FieldModifier.{VOLATILE,TRANSIENT}` | no analogue |
| `TypeCategory.{RECORD_TYPE,ANNOTATION_INTERFACE_TYPE}` | no analogue. `ANNOTATION_TYPE` becomes `ts_decorator` referencing an ordinary function |
| `ExpressionKind.{METHOD_REFERENCE,INSTANCEOF_PATTERN,SWITCH_EXPRESSION}` | no `::`; `instanceof` has no pattern form; `switch` is not an expression. `methodReferenceKind` is kept as a parity slot |

### 6.3 TypeScript relations and columns with **no** Java analogue

| TypeScript | Why it must exist |
|---|---|
| `ts_module` | the unit of import resolution **and** the symbol merge table. Java's package is implicit in a qualified name; a TypeScript module is not |
| `ts_export` | Java has no re-export. 1,251 export declarations and 86 `export *` in Corpus B, and a re-export chain is the only path from importer to declaration |
| `ts_type_satisfies` | structural typing. Java needs no such relation because `implements` is authoritative |
| `ts_parse_gap` | honest record of what was not parsed (from Python, not Java) |
| `declarationGroupKey` / `mergeScopeKey` / `declarationSpaces` | declaration merging. Java has exactly one declaration per name |
| `signatureRole` / `overloadIndex` / `bodyPresence` | Java resolves overloads by signature at one declaration site. TypeScript has N bodiless signatures plus one implementation, and 44.3% of call targets are bodiless |
| `isTypeOnly` (five relations) | Java has no type-only constructs. Half of Corpus B's imports are type-only |
| `isParameterProperty` / `declaredFieldLinkHash` | `constructor(private x: T)` — one parameter declares a field |
| `varianceAnnotation` / `isConst` (type parameters) | TS 4.7 / 5.0 |
| `isOptional` (parameters, fields) | Java has no optional members; here optionality changes both arity matching and assignability |
| `decoratorSystem` / `decoratorSemantics` | two incompatible decorator systems, and a decorator can replace its target |
| `isOptionalChain` / `isNonNullAsserted` / `assertedTypeReferenceLinkHash` | `?.`, `!`, `as`, `satisfies` |
| `TYPE_QUERY` / `CONDITIONAL` / `MAPPED` / `TEMPLATE_LITERAL` / `INFER` type-reference kinds | 10,436 nodes with no Java or Python analogue |

---

## 7. FK diagram — what the resolution layer must traverse

```
                          ts_module ──────────────────────────────┐
                        (merge table, resolution unit)            │
                              │                                   │
        ┌─────────────────────┼──────────────────┬────────────────┤
        │                     │                  │                │
    ts_import            ts_export           ts_type          ts_variable
   resolvedModule ───▶ resolvedSourceModule    │              boundFunction ──┐
        │                     │                │                    │        │
        │ (module edge)       │ (re-export     │                    │        │
        │                     │  chain)        │                    │        │
        ▼                     ▼                ▼                    ▼        │
   ┌──────────────────────────────────────────────────────────────────┐      │
   │  declarationGroupKey  ── the MERGED entity (N declarations ▶ 1)  │      │
   │  md5(mergeScopeKey ‖ escapedName)   §3.1   max N measured = 43   │      │
   └──────────────────────────────────────────────────────────────────┘      │
        │                │                 │                  │              │
        │                │                 │                  │              │
   ts_type_heritage  ts_type_parameter  ts_method          ts_field          │
   (extends/impl,    (constraint,       (signatureRole,    (memberGroupKey,  │
    inheritsMembers)  variance, const)   bodyPresence,      isOptional,      │
        │                 │              overloadIndex)     indexKey)        │
        │                 │                 │   ▲              │             │
        │                 ▼                 │   │              ▼             │
        │           ts_type_reference ──────┘   │        ts_field_position    │
        │           (the TYPE GRAPH: union/     │                            │
        │            intersection/conditional/  │                            │
        │            mapped/template/infer —    │                            │
        │            N rows, parentReferenceHash│                            │
        │            §3.4, depth ≤ 20)          │                            │
        │                                       │                            │
        ▼                                       │                            │
   ts_type_satisfies ◀── ENGINE derives, ORACLE adjudicates (§3.2, §4.21)    │
   (direction, evidence, oracleAgreement)       │                            │
                                                │                            │
   ══════════════════ THE CALL GRAPH ═══════════╪════════════════════════════╪═════
                                                │                            │
   ts_block ──── methodOwnerHash ──────────▶ ts_method ◀──────────────────────┘
   (caller attribution;                         ▲   resolvedSignatureLinkHash
    let/const scope;                            │   (THE SIGNATURE, not the name)
    conditionExpression → narrowing)            │
        │                                       │
        ▼                                       │
   ts_expression ──── 1:1 ────▶ ts_call_site ───┘
   (receiver, arguments,        (callKind, receiverKind, resolvedTargetKind,
    referencedEntityHash)        resolvedOverloadIndex, isTypeOnlyTarget=false)
        │
        └── assertedTypeReferenceLinkHash ──▶ ts_type_reference
            (the ONLY expression→type edge; a TYPE FK, so no call-graph
             rule can cross it — §3.3)

   ts_decorator ──▶ ts_decorator_argument        ts_comment      ts_parse_gap
   (runs; may replace target)                    (JSDoc, directives)
```

### The four traversal paths, ranked by measured frequency

**Path 1 — declared-type receiver (the primary mechanism; 85.3% of parameters annotated).**
```
ts_call_site.receiverExpressionLinkHash
  → ts_expression (IDENTIFIER_REFERENCE) .referencedEntityHash
  → ts_variable | ts_method_parameter | ts_field   [.typeReferenceLinkHash]
  → ts_type_reference (declared annotation)        [.resolvedGroupKey]
  → declarationGroupKey → ts_type (all N declarations)
  → ts_method WHERE escapedName = calleeName       [overload set]
  → ts_call_site.resolvedSignatureLinkHash         [ONE signature]
```
This is the path Java uses and Python could not. It is why this schema is Java-shaped.

**Path 2 — imported name (52.0% of targets are external).**
```
ts_expression.referencedEntityHash → ts_import
  → ts_import.resolvedModuleLinkHash → ts_module
  → [ts_export chain, possibly EXPORT_STAR expansion, possibly N hops]
  → declarationGroupKey → ts_method | ts_type
  → lib_ts_method when the module is external
```

**Path 3 — the structural leg (44.3% of targets are bodiless signatures, 99.6% of them ambient).**
```
ts_call_site.resolvedSignatureLinkHash → ts_method (bodyPresence = NO_BODY_INTERFACE)
  → owner ts_type (INTERFACE_TYPE)
  → ts_type_satisfies WHERE targetGroupKey = owner.declarationGroupKey
  → sourceGroupKey → ts_type (a class)
  → ts_method WHERE memberGroupKey matches   [the implementation]
```
**This is the path Java gets for free and TypeScript does not.** With no `implements` on 60.4%
of classes, `ts_type_satisfies` is the only bridge from a signature target to an implementation
— and 21.5% of the edges it needs exist in no syntax anywhere.

**Path 4 — `this` / `super` members.**
```
ts_expression (THIS_REFERENCE) → enclosing ts_method.tsTypeLinkHash → ts_type
  → declarationGroupKey → ts_field | ts_method  (own members)
  → ts_type_heritage WHERE inheritsMembers = true → transitively, supertype members
```
Note `inheritsMembers`: walking an `IMPLEMENTS_CLAUSE` row here would be **wrong**, because
`implements` inherits nothing. In Java the same walk is correct. This one column is the
difference.

---

## 8. What the oracle can and cannot verify — and the fixture precondition

### 8.1 The layers, and where the verifiability boundary sits

| Layer | Produced by | Content | Oracle-verifiable? |
|---|---|---|---|
| **0 — Syntax** | `ts.createSourceFile` | spans, node kinds, tree shape | **yes**, but see the tier-1 caution (§4): parser and oracle share a parser, so this checks the *projection*, not the parse |
| **1 — Declarations** | parser | `ts_module`, `ts_type`, `ts_method`, `ts_method_parameter`, `ts_field`, `ts_enum_member`, `ts_variable`, `ts_type_parameter`, `ts_type_heritage`, `ts_import`, `ts_export`, `ts_decorator` | **yes** — against the AST, and `typeCategory`/`declarationSpaces` against masked `SymbolFlags` |
| **2 — Merge partition** | parser (`declarationGroupKey`) | which declarations are one entity | **yes, exactly** — set equality against tsc's symbol partition, both directions (§3.1) |
| **3 — Module resolution** | parser (`ts.resolveModuleName`) | `ts_import.resolvedFilePath`, augmentation targets | **yes** — same function the compiler uses |
| **4 — Local call resolution** | parser, only where syntactically decidable | `ts_call_site` cols 12–18 | **yes, exactly** — `getResolvedSignature`, per overload, position-precise. Verified: `f(1)` → `a.ts:3:1`, `f("x")` → `a.ts:2:1` |
| **5 — Structural satisfaction** | **engine** | `ts_type_satisfies` | **yes** — `isTypeAssignableTo`, and the disagreement is recorded in `oracleAgreement` rather than reported elsewhere |
| **6 — Global reasoning** | **engine** | cross-module call graph, narrowing, flow, `lib_ts_*` staging | **no** — validated by outcome |

**The boundary is between 4 and 5, and it is not where Python's was.** Python's parser stopped
where CPython stopped answering — at bindings — and everything about types was engine work.
Here the compiler answers types too, so the parser goes further (local call resolution is
adjudicable) while *satisfaction* is pushed out, because that is the one thing the parser
cannot compute without becoming a typechecker. Rule four draws that line, not convenience.

### 8.2 What the oracle cannot do

- **It cannot check the parse.** Sharing `ts.createSourceFile` means a parser bug that is
  really a tsc bug is invisible to us. Accepted: tsc is the reference implementation, so its
  parse *is* the definition.
- **It cannot compare unions member-wise against the checker.** Verified: source
  `string | number | boolean` vs checker `string | number | false | true`. The oracle compares
  type-node trees; `typeToString` is for reporting only (§3.4).
- **It cannot adjudicate `shapeDigest` or `derivationMethod`** — tier 3 by construction.
- **It cannot verify `lib_ts_*` staging**, which is the engine's external-identification pass.

### 8.3 Fixtures must compile — a precondition, not a coverage metric

**A fixture that does not compile is a broken input, not a coverage gap.** It cannot be
admitted, it cannot be tracked in the ratchet, and it must never be able to break an unrelated
language's gate. Three requirements follow, and I have already applied the third:

1. **Admission requires a clean compile.** `tsc --noEmit` under
   `src/test-data/typescript/staging/tsconfig.json` must be clean before a fixture is admitted
   and before the oracle mints a single expected fact. An expectation derived from a
   non-compiling file is derived from a program tsc has no opinion about — the oracle would be
   authorising noise. A shape that is *resolvable in principle but does not resolve yet* goes to
   `categories/edge-cases/OPEN_*.ts` and the ratchet tracks it; that is a different thing from
   not compiling.
2. **Deliberate type errors need their own tsconfig, and are quarantined.** A fixture whose
   *point* is an error (`@ts-expect-error`, a legacy-decorator file needing
   `experimentalDecorators`) lives in its own subdirectory with its own tsconfig, and the gate
   compiles it separately and asserts the *expected* diagnostic. Note the live case: the
   fixture tsconfig already excludes `annotations/legacy`, which will need
   `experimentalDecorators` — under one shared config that file cannot compile at all.
3. **DONE — fixtures are out of the root program.** I found all 20 existing fixtures inside the
   root `tsc` program (`"include": ["src/**/*"]`), which means one erroring fixture would have
   broken `npm run build` *and* the Python gate's own `tsc --noEmit` check — an unrelated
   language's gate, exactly as you said. `tsconfig.json` now excludes
   `src/test-data/typescript`. Verified after the change: `npm run build` 0,
   `python-tests.ts` 8/8, `java-extractor-tests.ts` 75/75, and the fixtures still compile clean
   under their own tsconfig.

### 8.4 The gate's checks (built after approval)

| check | proves |
|---|---|
| compiles | `tsc --noEmit` clean on the parser **and** on every fixture set under its own tsconfig |
| determinism | two runs over identical input are byte-identical |
| enum conformance | every emitted enum value is a member the TypeScript enum declares |
| golden facts | no frozen fact moved; names the row **and** the column |
| referential integrity | every non-`""` FK resolves to an existing PK |
| merge partition | `declarationGroupKey` partition == tsc's symbol partition (set equality, both directions) |
| **tsc-adjudicated resolution** | every parser-filled `resolvedSignatureLinkHash` equals `getResolvedSignature`, position-precise |
| closed-world | every call site links, or is `AMBIENT_SIGNATURE` / `SYNTHESIZED_NO_DECLARATION`, on a corpus whose ceiling is 100% |
| open-edges ratchet | the known-unresolvable count may fall, never rise |
| type-only isolation | zero `ts_call_site` rows with `isTypeOnlyTarget = true`; zero `ts_expression` rows with `isTypeOnlyReachable = true`; a type-only fixture produces zero call-graph rows |
| tier-3 report | reported **separately**, never aggregated with the adjudicated checks |

The in-repo gate creates **no `ts.Program`**, makes no network call, and compares against frozen
expectations only. Re-freezing lives in `../parser-oracle/typescript`. If the gate could rewrite
its own expectations it would have a failure mode indistinguishable from success.

---

## 9. The spine — frozen first

**10 relations / 295 columns — FROZEN.** In build order. Each stage is independently testable and the
first three cover the measured majority of the call graph.

| # | Relation | Cols | Why it is spine |
|---|---|---|---|
| 1 | `ts_module` | 27 | merge table + resolution unit; every key chains off it |
| 2 | `ts_type` | 33 | declarations + the merge group key |
| 3 | `ts_method` | 43 | 44.3% of targets are signatures; overload identity lives here |
| 4 | `ts_method_parameter` | 27 | 85.3% annotated — the receiver-typing mechanism |
| 5 | `ts_field` | 29 | member lookup and the structural surface |
| 6 | `ts_type_reference` | 30 | the type graph; unions as N rows |
| 7 | `ts_type_heritage` | 20 | ordered heritage + `inheritsMembers` |
| 8 | `ts_import` | 27 | 52.0% of targets are external |
| 9 | `ts_expression` | 34 | ports Java's projection wholesale |
| 10 | `ts_call_site` | 25 | the flagship gate |

Deferred to a second freeze: `ts_export`, `ts_variable`, `ts_type_parameter`, `ts_enum_member`,
`ts_block`, `ts_comment`, `ts_decorator`, `ts_decorator_argument`, `ts_field_position`,
`ts_parse_gap`, `ts_type_satisfies`. Two of those are load-bearing sooner than their position
suggests — `ts_export` (re-export chains are needed to finish Path 2) and `ts_type_satisfies`
(Path 3 does not close without it) — so I would take them in that order.

**Build order, mirroring the measured paths:**
1. `ts_module` + `ts_type` + `ts_method` + `ts_field` + the **merge-partition gate** — because
   until §3.1's partition is proven against tsc, every downstream key is suspect.
2. `ts_type_reference` + `ts_type_heritage` + `ts_import` — the type graph and the module graph.
3. `ts_expression` + `ts_call_site` + the **tsc-adjudicated resolution gate**. This is the check
   Python never got, and `CONTRIBUTING-typescript.md` is right that it should be built first
   among the gates.
4. `ts_export` + `ts_variable`, then `ts_type_satisfies` with its `oracleAgreement` measurement.

---

## 10. Decisions — approved, and the six I closed myself

### 10.1 Approved (2026-08-27)

| # | Ruling |
|---|---|
| **OQ-1** | **`ts.createSourceFile`.** The 32,767-char truncation landing on the `.d.ts` files that carry 52% of call targets settles it |
| **OQ-2** | Ship the 10-relation / 295-column spine. `ts_type_satisfies` stays declared and engine-populated |
| **OQ-4** | `emissionRegime` in the module PK, **as a coarse token** (`ts6-inproc`), never a version string — `6.0.3` in a key would invalidate every hash on a patch bump. `targetTsVersion` stays as non-key provenance (§4.1) |
| **OQ-7** | TSX out of the first freeze; representation stated now, emitted by nothing (§4.15.1) |

Build order confirmed: **merge-partition gate first** — until §3.1's partition is proven
against tsc by set equality, nothing downstream is trustworthy — then the harness, then
`src/test/typescript-tests.ts`.

### 10.2 Closed by measurement (OQ-3, OQ-5, OQ-6, OQ-8)

**OQ-3 — `lib_ts_*` staging: DECIDED (a), the reachability closure.** Measured on the `Parser`
repo: the program pulls in **146 of the 590 `.d.ts` files on disk (24.7%)**, and **2.9 MB of
7.8 MB (37%)**; of the 114 shipped `lib.*.d.ts` files it loads **57**. So (c) "everything on
disk" is a 4× file / 2.7× byte penalty for declarations no call site can reach, and (b) "whole
imported packages" still drags in every unreferenced entry point of `@types/node`. The closure
is not a heuristic — it is the set the compiler itself resolved, so the engine gets it by
walking `ts_import.resolvedModuleLinkHash` transitively from project modules. Recorded as an
engine obligation: compute reachability *before* staging, and stage `lib_ts_*` declarations
only for modules in the closure.

**OQ-5 — depth cap: DECIDED 32, not 20.** Measured max type-node depth is **19**, so 20 admits
everything observed and sits one node from truncating on the next `type-fest` release. The cost
of 32 is zero: no node in 25.9 MB of real TypeScript reaches depth 20, so the extra headroom
emits no extra rows. `isTruncated` stays, because a cap that can never fire is a cap nobody
maintains — and if it ever fires, the row says so.

**OQ-6 — no `ts_scope` relation: DECIDED, and measured rather than asserted.** Over Corpus A,
**34,798** identifier references resolve to a declaration, and the
`ts_block → ts_method → ts_type → ts_module` chain reaches **every one of them**:

| route to the declaration | count |
|---|---|
| same file, enclosing lexical container (the chain) | 32,743 |
| another project file (via `ts_import`) | 18 |
| ambient — `lib.*.d.ts` or `node_modules` | 2,037 |
| **unreachable by the chain** | **0** |

Zero. So the chain is sufficient in fact, not just in principle, and `ts_scope` would be a
relation carrying no information the FKs do not already carry. It stays additive: if a future
corpus produces a non-zero unreachable count, that number is the argument for adding it, and
the gate will report it because the check is now written down.

**OQ-8 — `allowJs` / JSDoc-typed JavaScript: DECIDED out of scope for the first freeze.** It is
not a syntax gap but a **tier** change: in a `.js` file the type annotations live in comments,
so `parameterTypeName`, `returnTypeName` and `fieldTypeName` move from tier 1 (a node) to a
JSDoc parse (`ts_comment.jsDocTags`), and `ts_type` rows would have to be synthesised from
`@typedef` with no declaration node to key on. That is a second schema, not an extension of
this one. The relations already tolerate it — `ts_module.scriptKind` has `JS`/`JSX`,
`ts_comment.commentKind` has `JSDOC` — so nothing has to be reserved beyond what is there.

### 10.4 Open — OQ-10, object-literal members  *(surfaced 2026-08-27)*

`{ m() { … } }` as a **value** — an object literal, not a type literal. Its members
(`OBJECT_LITERAL_METHOD` 16 rows, and any `GETTER`/`SETTER` inside one) have an owner that is
neither a `ts_type` nor a `ts_type_reference`: it is a `ts_expression` row of kind
`OBJECT_LITERAL`. The same widening would extend to it — c8/c7 pointing at a third relation,
discriminated by the same column — and prefixes stay distinct, so it is still fail-safe.

I have **not** taken it, for one reason: unlike the type-literal case, I have no measurement
that a call ever resolves to an object-literal member through the *fact base* rather than
through the variable that holds the literal. `const api = { run() {} }; api.run()` may already
close via `ts_variable` → its type → the member. Before widening a spine FK to a third relation
I want the count, and getting it means measuring which of those 16 are reachable by an existing
path. Flagged rather than folded into §4.8.1, because bundling an unmeasured case with a
measured one is how a schema acquires columns nobody can justify later.

### 10.5 Still open — nothing else

No question in this document is unanswered. Two items are deliberately **deferred with a
recorded trigger** rather than left ambiguous: TSX (a fixture appears) and `ts_scope` (a
non-zero unreachable count). Both have a gate check that will raise them.

---

## Appendix A — `decls_base_ts.dl` is generated, not written

`gen_decls.py` parses the relation tables in this document and emits
`src/schema/typescript/decls_base_ts.dl`:

```
// A type declaration — class / interface / enum / type alias / namespace.
.decl ts_type(c0:symbol, …, c32:symbol)
.decl lib_ts_type(c0:symbol, …, c32:symbol)
```

- positional `c0..cN`, all `symbol` — the engine's contract, unchanged
- both `ts_*` and `lib_ts_*` per entity, identical arity
- `lib_ts_*` **body** relations (`lib_ts_expression`, `lib_ts_call_site`, `lib_ts_block`,
  `lib_ts_variable`, `lib_ts_parse_gap`) declared and never staged
- `gen_decls.py --check` in CI fails if the `.dl` and this document disagree on **arity or
  order** for any relation. Column names live only here; the `.dl` carries positions.

Because column names are not in the `.dl`, a rename is free post-freeze and a reorder is not.
That asymmetry is the whole point of generating it.

## Appendix B — invariants the harness will enforce

1. Every non-`""` FK column resolves to an existing PK in its target relation.
2. Every PK is unique within its relation. (`ts_type`, `ts_method`, `ts_variable` include
   `startColumn` for exactly this reason — 703 arrow functions.)
3. `declarationGroupKey` is **not** unique, and at least one relation must exercise a group of
   size ≥ 2, or the merge gate is vacuous. Corpus B offers a group of size 43.
4. No `ts_call_site` row has `isTypeOnlyTarget = true`. No `ts_expression` row has
   `isTypeOnlyReachable = true`.
5. `ts_method.bodyPresence != HAS_BODY` ⟹ that row is never an *implementation* target.
6. Every `ts_type_reference` row with `childCount > 0` has exactly `childCount` children
   pointing at it via `parentReferenceHash`, unless `isTruncated = true`.
7. `depth = 0` ⟺ `parentReferenceHash = ""` (`type-hierarchy.dl` depends on this in Java).
8. `ts_call_site` count == count of `ts_expression` rows whose `kind` ∈
   {`CALL_EXPRESSION`, `NEW_EXPRESSION`, `TAGGED_TEMPLATE`} — the 1:1 chain holds.
9. The emitting compiler version is recorded in every golden file **and** in
   `ts_module.targetTsVersion`; a mismatch fails the gate rather than being reconciled.
10. Fixtures compile (§8.3) before any expectation is minted.
