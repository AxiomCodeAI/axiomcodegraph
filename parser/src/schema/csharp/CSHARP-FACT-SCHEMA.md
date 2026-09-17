# C# fact-table schema — v1.15

## 0.0 VERSION MAP — which version contains which ruling

**Authoritative. Cite this table, not a commit message.**

Two agents were using my version numbers differently: cs-impl reported *"v1.7 applied"* meaning
FIELD/PROPERTY/EVENT, cs-corpus reported *"v1.7's expression-position type references landed"* and
called FIELD/PROPERTY/EVENT v1.8. **cs-corpus is right.** Both then pre-registered row-count
movements against their own numbering, which is how a sweep reads a ruling as a regression.

**The root cause is mine and it is not the agents':** this document's title said **v1.1** while
containing v1.9 rulings, so there was no single place stating the current version. Version had to
be inferred from commit messages — and a commit message names *one ruling*, never *the document*.
A version number that means two things is worse than no version number.

| version | commit | the ruling(s) it contains | changes emission? |
|---|---|---|---|
| — | `5341706` | `SCHEMA-CONSTRAINTS.md`: parser emits IR, engine resolves; LINQ call synthesis **withdrawn** | yes |
| **v1** | `7926f9f` | 22 relations; `cs_type` keyed on the **declaration site** | yes |
| **v1.1** | `785f738` | heritage `INTERFACE`/`ENUM_UNDERLYING_TYPE`; `cs_method.isAccessor`; `defineConstantsKey` canonical; grammar-field gate | yes |
| **v1.2** | `88f4e7c` | the **eight column lists** incl. `cs_expression`; eight arity fixes; `file`-local scope key; `REQUIRED` removed; `shapeVariants` | yes |
| **v1.3** | `91ea98b` | §4.0 the three categories; **three DELETEs** (`ARGUMENT_LIST`, `LAMBDA_BODY`, `OwnerKind.VARIABLE`); `#pragma`/`#region` are not comments; **`var _ = M()` is a LOCAL** | yes |
| **v1.4** | `fa30dac` | `cs_comment.directiveKind` **deleted**; `cs_call_site.isExtensionCallSyntax` **deleted**; gate 7 upheld; the `#if` branch inversion explained | yes |
| **v1.4.1** | `82ea33b` | the **parity-slot test** joins §4.0's admission tests; the parse limit re-attributed to cs-fixtures' measurement | **no** |
| **v1.5** | `f346eaf` | **one tree** for blessing and running; the two-layer cross-project gate | no (gate only) |
| **v1.6** | `4b40082` | four `CsRootContext` deletions + `OwnerKind.BLOCK`; **top-level entry point** = `Program.<Main>$`; **grammar fork approved** → `grammarRegime` bumps to `fork6` | yes |
| — | `afab5fb` | scrub of the schema documents; §0.1.1 names what stops being checkable | no |
| **v1.7** | `b3bc397` | **expression-position type references** — eight `CsTypeRefContext` values + `CsReferenceOwnerKind.EXPRESSION`/`USING` | yes |
| **v1.8** | `350b770` | **`CsReferencedEntityKind` gains FIELD/PROPERTY/EVENT**; the 71/72 count reconciled | yes |
| **v1.9** | `9699fe9` | **stored expectations ruled YES**; the three-state bar | no (test layer) |
| **v1.15** | *this* | `cs_type_parameter` gains `hasUnmanagedConstraint` at column 12 — CS-ORACLE-6. Arity 15 → 16; no hash moves | **yes — arity** |
| **v1.14** | | records that section 3.12's `CsExpressionKind.DISCARD` ruling is **UNIMPLEMENTED** at fork11, measured; no column, vocabulary or order changes | no |
| **v1.13** | | ratifies cs-impl's empty-set convention for `defineConstantsKey` (`''`, not a digest of nothing) and requires presence-not-truthiness checks on it | no |
| **v1.12** | `c15ffa0` | **RETRACTS** v1.10's claim that span nesting catches CS-CORPUS-22 — a consistency invariant cannot catch a coherent misparse; the two impossibility invariants that do; and §4A.0, a first green is weaker evidence than a first red | no |
| **v1.11** | `307b4b2` | why a regime bump lands in one commit: an expectation with wrong provenance is **unrefutable** | no |
| **v1.10** | `689708b` | **CS-CORPUS-22**: an object creation's span runs to the end of its initializer, which is its own child node; plus the span-containment gate | yes |
| **v1.9.1** | `dc3b87d` | **RETRACTION** of v1.9's premise: `csharp-tests.ts` exists (7,716 lines) and bar item 2 is MET. The ruling stands but relocates to a `bless.ts` in the oracle; `targetFramework`/`defineConstantsKey` provenance is the one genuinely open bar item | no |

**Restate against this table.** The two movements pre-registered for sweep 6 are:
`UNCLASSIFIED` dropping is **v1.8**, `cs_type_reference` jumping is **v1.7**. Both are rulings
landing, not drift.

**And it is now mechanical.** `schema-arity-selfcheck.py` asserts that the title version equals
the highest `RULING (vX)` in the body, so a ruling added without advancing the title is a named
failure rather than a silent divergence.

---

**Column order is the contract.** v1 is approved. v1.1 applies the four conditions attached
to that approval: an enum widening, one column append, one key-canonicalisation rule, and one
gate. **No column is reordered and no existing column changes meaning**, so the freeze is not
reopened. Column-count deltas: `cs_method` 34 → 35. Everything else unchanged.

Bound by `SCHEMA-CONSTRAINTS.md`: **the parser emits IR, the engine resolves.** No
cross-file following, no extends-chain walking, no multi-hop property resolution. Same-file
one-hop links only. The metric is **IR completeness**, never resolution rate.

---

## 0. The measurements that drove this

Not a port of Java's tables. Every decision below has a number behind it.

### 0.1 The corpus

**9,568 files, seven repositories, five strata.** Generated files (`*.Designer.cs`, `*.g.cs`,
`*.generated.cs`, `*.AssemblyInfo.cs`) and `obj/`/`bin/` excluded.

| stratum | repos | files |
|---|---|---|
| linq-heavy | linq-heavy-A | 5,756 |
| source-generator | sourcegen-A, sourcegen-B | 1,325 |
| multi-target | multitarget-A, `multitarget-B` | 1,158 |
| bcl | bcl-slice-A (5 libraries) | 791 |
| modern-app | modern-app-A | 538 |

**Held back, chosen before this document existed and not looked at: holdout-primary**
(reserve: holdout-reserve). Recorded in the coordination log with the rule that the
commit which first measures it must say so.

### 0.1.1 What the scrub costs, stated rather than left to be discovered

The stratum identities above are **neutral ids**, adopted verbatim from
`src/test-data/csharp/CORPUS-MANIFEST.json` (`.scrub.ids`) rather than invented here — a
second naming scheme would be worse than the names. Their meaning lives in a key **outside
this tree**.

**Every measurement is kept. One class of claim stops being independently checkable, and it is
named here because a document that silently becomes unverifiable is worse than one that says
which claim it can no longer reproduce.**

| claim | still checkable? | by what |
|---|---|---|
| all per-stratum counts, ratios and distributions in §0 | **yes** | they are in this document and in `CORPUS-MANIFEST.json`, and internally cross-check |
| the parse-error, truncation and declaration-recovery numbers | **yes, against a re-derived corpus** — but only to the precision the shape allows | a reader with the key can reconstruct the strata and re-run |
| **that a given number came from exactly the bytes I measured** | **NO** | see below |

**Why the last one is gone, and it is my doing rather than the scrub's.** The three-layer
design is *shape published, content digest published, identity private*. Layer 2 — a SHA-256
over each stratum's sorted path-plus-file-hash list — is what turns a scrubbed document into a
fingerprintable one: a reader hashes their own copy and gets the same value or knows they have
a different corpus.

**I cannot produce that digest for the Phase 0 numbers.** They were measured against shallow
clones in a session scratchpad that was cleared, at commits I did not record. So for §0's
figures the digest layer is **unrecoverable, not pending** — no later work reconstructs it,
because the snapshot no longer exists.

The consequence, stated plainly: **§0's numbers are reproducible in shape and not in
provenance.** A reader can rebuild strata matching these ids and these counts and should expect
results close to these; they cannot confirm they have the same bytes. Every number measured
from `CORPUS-MANIFEST.json` onward *is* fingerprintable, because `cs-corpus` pins its corpus
and records the parser, fixture, schema and grammar commit for each sweep.

This is the fourth instance of §0.4's rule and the most expensive: the measurement survived
because it was written down, but its **provenance** did not, because that lived only on disk.

**Old-style C# 5/6 is absent.** It tests whether these decisions generalise, not what they
are; deferred deliberately.

### 0.2 The parse layer

`tree-sitter-c-sharp@0.23.5` grammar regenerated at **ABI 14**, plus a three-line `async`
patch, on **unchanged `tree-sitter ^0.21.1`**. Roslyn stays out of the parser process —
hermeticity, per §0 of `BUILDING-A-PARSER.md`, ruled a product constraint.

**3.01% of files carry a parse error; 0.32% truncate; 99.63% of declarations are recovered
against Roslyn** — 477 lost of 129,151, **on library code**. 1.60% of the residual is
`#if` splitting a construct, irreducible for any both-branches parser.

### 0.3 The numbers each §2 decision rests on

| construct | count | drives |
|---|---|---|
| properties | **39,239** | `cs_property` is its own relation |
| methods | 97,113 | — |
| nullable type references | 56,551 | `isNullableAnnotated` on the reference |
| file-scoped namespaces | **7,626** vs 1,795 block | `namespaceStyle` column |
| extension methods | **4,147** | three facts, none resolved |
| explicit interface specifiers | **4,733** | a member with no accessible name |
| primary constructors | **2,816** (2,782 class + 34 struct) | synthesized members |
| partial type declarations | **1,662** across **897** identities | the primary key, §2.1 |
| generic type declarations | 1,526; **167** same-name-different-arity | arity is in the identity |
| LINQ query expressions | **1,462** (5,096 clauses) | `cs_query_clause`, no synthesis |
| operators + conversions | 760 + 582 | a cast that invokes user code |
| records | 303 (32 `record struct`, 108 positional) | `TypeCategory` values |
| indexers | 218 | `cs_property.isIndexer` |
| events | 130 field-like + 67 with accessors | `cs_event` |
| `#nullable` directives | 497 (453 `disable`) | per-region context |
| `global using` files | 33; `<ImplicitUsings>` on in 59 projects | rows with no syntax |

---

## 0.4 Where a measurement lives — the standing rule

**Anything a measurement rests on lives in a repository, not `/tmp`.**

This is written into the schema because it has now cost three separate losses: my own Phase 0
probes, `js-oracle`'s measurement corpus, and `js-corpus`'s sweep drivers. Session scratchpads
are cleared without warning. Every number in §0 survived only because it had been written into
this document and the coordination log before the scratchpad went.

Concretely: a probe whose output is quoted in a decision belongs in
`../parser-oracle/csharp/`, and a number quoted in a decision belongs in the document that
makes the decision. A measurement that exists only as terminal output has **already been
lost**; it just does not know it yet.

---

## 1. Naming, placement, key chaining

```
cs_<entity>       C# source under analysis   ← the parser emits ONLY these
lib_cs_<entity>   external / third-party     ← the ENGINE stages these
```

`cs_*.isExternal` is a **parity slot, always `false`** on parser output, so the layout is
byte-identical when the engine stages `lib_cs_*`. Per the Python and TypeScript precedent,
`lib_cs_*` **body** relations (`lib_cs_expression`, `lib_cs_call_site`, `lib_cs_block`,
`lib_cs_variable`, `lib_cs_query_clause`, `lib_cs_parse_gap`) are **declared and never
staged** — reference assemblies have no bodies.

`HASH_ALGO` stays `md5`; PKs are `PREFIX_<md5hex>` via `EntityUtils.generateEntityHash`,
components joined with `||`, values through `EntityUtils.escapeTsv`. Filenames follow
`all-csharp-<plural>.csv` plus `skipped-csharp-files.csv`.

**Trailer convention, inherited from Java and TypeScript and applied to every relation:**
`… , isExternal, serviceVersionLinkHash, <entity>UniqueHash` are the **last three columns**.

### Key chaining — every child keys off its parent's hash

```
cs_module.hash            = f(filePath, baseMservPath, targetFramework, defineConstantsKey, startLine, emissionRegime, serviceVersion)
cs_type.hash              = f(csModuleLinkHash, name, arity, declarationScopeKey, startLine, startColumn)
cs_type_heritage.hash     = f(csTypeLinkHash, position, heritageText, startLine)
cs_type_parameter.hash    = f(ownerLinkHash, position, name)
cs_type_reference.hash    = f(ownerLinkHash, parentReferenceHash, position, depth, startLine, startColumn)
cs_method.hash            = f(csModuleLinkHash, csTypeLinkHash, name, arity, signature, startLine, startColumn)
cs_method_parameter.hash  = f(csMethodLinkHash, position, name, parameterMode)
cs_property.hash          = f(csTypeLinkHash, name, isIndexer, startLine, startColumn)
cs_event.hash             = f(csTypeLinkHash, name, startLine, startColumn)
cs_field.hash             = f(csTypeLinkHash, name, startLine, startColumn)
cs_attribute.hash         = f(ownerLinkHash, ownerKind, position, attributeName, startLine)
cs_expression.hash        = f(csModuleLinkHash, expressionOwnerHash, parentExpressionHash, position, startLine, startColumn)
cs_call_site.hash         = f(csExpressionLinkHash)                    ← 1:1, pure chain
cs_query_clause.hash      = f(csExpressionLinkHash, position, clauseKind)
cs_preproc_region.hash    = f(csModuleLinkHash, startLine, endLine, conditionText)
```

**No child key is derived from a dotted name**, and no key is derived from a *merged* type —
§2.1.

---

## 2. The five things with no clean Java or TypeScript analogue

### 2.1 Partial types — the primary key, stated before any row exists

**Measured.** 1,662 partial declarations across **897 type identities**:

| parts in source | identities |
|---|---|
| **1** | **686 (76.5%)** |
| 2 | 123 |
| 3–8 | 65 |
| 10–30 | 20 |
| 72, 88 | 2 |

Maximum **88 parts** (`TestNamespace+DbContextModel`, linq-heavy-A's compiled model).

**The finding that decides the design: 76.5% of partial identities have exactly ONE part in
source.** Those are source-generator types — the other half exists only after a build, in a
file that is not on disk. A schema that assumed "partial implies N files present" would be
wrong three times in four.

**The decision — the same shape TypeScript reached, for a simpler reason.**

> **`cs_type` has one row per DECLARATION SITE. The merged type is identified by a
> non-unique group key, not by a primary key.**

- **Primary key** = `md5(csModuleLinkHash ‖ name ‖ arity ‖ declarationScopeKey ‖ startLine ‖ startColumn)`.
  Always unique, always parser-derivable, never needs cross-file knowledge.
- **`declarationGroupKey`** = `md5(declarationScopeKey ‖ name ‖ arity)`. **This is the merged
  type's identity.** Deliberately not unique: N parts produce N rows carrying the same group
  key, and the engine forms the merged type by grouping on it.
- **`declarationScopeKey`** = the enclosing namespace and containing-type chain, as written:
  `NS:<namespace>` or `NESTED:<parent declarationGroupKey>` — **except for `file`-local types**.

> **RULING (v1.2). A `file`-local type carries the module hash in its scope key:**
> `FILE:<csModuleLinkHash>:NS:<namespace>`.
>
> `file class C` in two files in one namespace is **two unrelated types** — that is the whole
> point of the `file` modifier, and source generators emit exactly this shape to avoid
> colliding with user code. Without the module hash both parts share a
> `declarationGroupKey` and the engine merges two types that cannot see each other.
> cs-impl already does this; the schema was wrong and is corrected here.

**Why this is simpler than TypeScript's and therefore stronger.** C#'s merge rule is
*syntactic and local*: same namespace, same containing-type chain, same name, same arity,
same compilation. No `mergeScopeKey` table of six shapes, no resolved-module augmentation
target, no cross-declaration-kind merging (a `partial class` never merges with an
`interface`). The key is computable from one file with no resolution at all.

**Three consequences, stated.**

1. **No `isPrimaryDeclaration`, no `declarationIndex`.** Choosing "the" declaration needs all
   of them, which is cross-file. The engine derives an ordinal by sorting the group on
   `(filePath, startLine, startColumn)` — total and deterministic.
2. **`isPartial` is carried per declaration**, and a **single-part group is normal, not a
   defect** — 76.5% of them. A gate asserting "every partial group has ≥2 parts" would fail
   on correct output.
3. **Arity is in the key.** `Foo<T>` and `Foo<T,U>` are different types; 167 name collisions
   in the corpus are resolved by arity alone.

**Adjudicable, therefore tier 2 — but only in ONE TREE.** The oracle partitions by Roslyn's
`ISymbol.DeclaringSyntaxReferences` and asserts **set equality** with our partition by
`declarationGroupKey`, both directions

> **RULING (v1.5). One tree for blessing and for running, and no fixture reference may cross a
> project boundary. `categories/` is canonical.**
>
> This gate is the reason. `DeclaringSyntaxReferences` is **0 for a metadata symbol**, so a
> partial whose other part arrived from an assembly rather than from source **reports zero
> parts** — and the partial-type gate, which keys on exactly this property, passes while
> measuring nothing. cs-fixtures found the live case: `Lambdas.cs` sees `Fixtures.cs` as a
> **source** symbol under `staging/` and as a **metadata** symbol from `Annotations.dll` under
> `categories/`. Same bytes, different `SymbolKind`.
>
> More generally: **the parser reads files, never assemblies, so it always sees source.** A
> blessing taken from a tree where the same symbol is metadata has no syntax to compare
> against, and every such case reads as a parser defect that is really an artifact of how the
> corpus was partitioned.
>
> Two gates, one hermetic and one not:
> `src/test/csharp-gates/no-cross-project-reference.py` catches the **declared cause** —
> `ProjectReference`, a non-framework `<Reference>`, any `<HintPath>` — with no `dotnet` and no
> network. `../parser-oracle/csharp/` mode `symbolkinds` catches the **consequence** even when
> the project file looks clean: a stale dll, an implicit reference, a future re-partition.
>
> The first reports the five real cases (`categories/{expressions,integration,methods,`
> `type-parameters,type-references}`, each referencing `../annotations/Annotations.csproj`) and
> passes once they are gone. It exits **non-zero when the fixture tree is absent**, so an
> unrunnable gate cannot be mistaken for a passing one — with source-generated parts excluded, which is
itself the check that the 76.5% is what we think it is.

### 2.2 `#if` — which rows exist

Ruled: **option 3, one emission per target framework, framework in `cs_module`'s primary
key** — the shape `emissionRegime` has for `py_module` and `ts_module`.

`cs_module`'s key carries **`targetFramework`** and **`defineConstantsKey`**.

> **`defineConstantsKey` is canonical, and this is load-bearing because it sits in a primary
> key.** It is `md5` of the **resolved active symbol set**, **deduplicated**, **sorted by
> ordinal code-point order**, joined with `;`. Case is preserved — C# preprocessor symbols
> are case-sensitive. Two projects declaring the same constants in different order, or
> listing one twice, **must** produce the same key; without canonicalisation the same program
> partitions into two module identities and every child hash below it forks.
>
> **The EMPTY SET returns `''`, and the convention is cs-impl's rather than mine (v1.13).** The
> schema was **silent** on the empty case, and silence in a primary-key rule is a defect. A digest
> of nothing would read as *"some symbols, whose value happens to be this"* — a different claim,
> and one no consumer could distinguish from a real key. `''` reads as *"no symbols"*, which is
> what it means. Ratified.
>
> Two consequences, both found when the bless driver first ran on a real fact base and refused
> every claim:
>
> 1. **`''` is a legitimate value, not an absent one.** Any check on this field must test
>    **presence**, not truthiness. A falsy check refuses every project that declares no
>    preprocessor symbols — which is most of them.
> 2. **An absent field and an empty one must not look the same at a boundary.** The driver requires
>    `--define-constants-key` explicitly: `""` is the operator saying *no symbols*, a missing flag
>    is the operator not having decided, and a default would erase the difference. Both are **parser inputs**, never inferred: 33/33 `DefineConstants`
declarations in the corpus resolve from XML plus a `$(TargetFramework)`/`$(Configuration)`
condition evaluator, and the implicit `NET*_OR_GREATER` symbols are a ~40-line table verified
against the csc command line for six TFMs. **No MSBuild, no .NET in the parser.**

### 2.2.1 Gate 7 stands — the EMISSION is wrong — RULING (v1.4)

**A comment inside an inactive `#if` branch is not emitted.** Gate 7 is worded correctly and
the emission is the defect.

The tempting argument the other way — *a comment is not a program element, it documents the
file* — loses to one structural fact: **`cs_comment.ownerHash` points at a declaration.**
Under option 3 an inactive branch's declarations are not emitted, so an emitted comment from
that branch has an owner that does not exist. **That is a dangling FK**, and FK integrity is a
day-one gate. A relation cannot be exempt from branch selection while carrying a foreign key
into relations that are not.

So: a row is emitted iff **its enclosing region is active**, with no exception for comments,
and `cs_comment` inherits branch selection like everything else.

### 2.2.2 The inversion — the ACTIVE branch dropped, `#else` always emitted — RULING (v1.4)

cs-impl's larger version of the same report is **the more serious defect**, and the grammar
explains it exactly. Verified against the vendored grammar:

```
preproc_if
  identifier          "NET8"          <- the CONDITION
  method_declaration  "void Active()" <- the THEN branch: a DIRECT CHILD, not wrapped
  preproc_else
    method_declaration "void Inactive()"   <- the ELSE branch: nested INSIDE preproc_else
```

**The then-branch has no wrapper node.** Its members are direct siblings of the condition,
while the else-branch *is* wrapped, in `preproc_else`. An implementation that treats "a branch
is the children of a `preproc_*` node" therefore finds the `#else` and never finds the `#if` —
which is precisely the reported symptom.

And `#elif` **nests right-recursively**, it is not a flat list:

```
preproc_if > preproc_elif > preproc_else
```

**The rule:**

| branch | its members are |
|---|---|
| `#if` | named children of `preproc_if` **after** the condition identifier and **before** any `preproc_elif`/`preproc_else` child |
| `#elif` | named children of `preproc_elif`, same rule, recursively |
| `#else` | named children of `preproc_else` |

Evaluate the conditions in order; emit the members of the first branch whose condition holds,
and **prune the rest**. Note that the non-selected members are *descendants of `preproc_if`*,
so any walk that simply recurses through a `declaration_list` emits **both** branches — which
is the 16.9%-of-regions problem arriving as duplicate declarations rather than as a parse
error.

**Gate:** a fixture with `#if`/`#elif`/`#else` where all three branches declare a
distinguishable member, asserted under at least two different `defineConstantsKey` values, so
that selecting the wrong branch and selecting no branch are **different failures**.

---

`cs_preproc_region` records every region with its condition text and whether it was active,
so a row's provenance is auditable. Regions whose content is not independently parseable —
**16.9% of regions**, splitting a base list, an `else` chain, a parameter list — are recorded
with `regionShape = FRAGMENT` and **no child rows**. That is the honest terminal: option 1
cannot represent them and silence would hide them.

### 2.3 Reified generics — the spine difference, checked column by column

C# generics are **reified**: `List<int>` and `List<string>` are distinct runtime types. Java's
model encodes erasure in places, and I checked each rather than assuming.

| Java column | ports? | why |
|---|---|---|
| `typeName`, `completeTypeName` | **yes** | `List` vs `List<int>`; the pair already carries what reification needs |
| `parentReferenceHash`, `depth`, `position` | **yes** | the reference *tree* is what distinguishes `List<List<int>>` |
| `arrayDimensions` | yes | |
| **`wildcardVariance`** | **NO** | Java has **use-site** variance (`? extends T` at the reference). C# has **declaration-site** variance (`in`/`out` on the type parameter) and no wildcards at all. |

So `cs_type_reference` drops `wildcardVariance`, and `cs_type_parameter` gains
**`varianceModifier`** (`IN` \| `OUT` \| `NONE`). Same information, different relation —
exactly the kind of thing "check each rather than assuming the column means the same" is for.

### 2.4 Properties, indexers and events — neither field nor method

**39,239 properties** against 97,113 methods. A property is not a field (it has up to two call
targets) and not a method (it is a data location). Both reductions lose something the engine
needs.

> **`cs_property` is its own relation, and each accessor is ALSO emitted as a `cs_method` row
> owned by the property.**

That gives the engine the data location *and* the two call targets, which is the whole point.
Same for `cs_event` (130 field-like + 67 with accessors) and indexers (218, carried as
`cs_property.isIndexer = true` — an indexer *is* a property with parameters).

**`+=` on an event is a subscription, not an assignment.** §3's defect class exactly. It gets
a wrapper expression node with `EVENT_SUBSCRIBE` / `EVENT_UNSUBSCRIBE` in `expressionKind`
and the handler parented as a child — not a `COMPOUND_ASSIGNMENT` with the operator in a
column.

### 2.5 Extension methods and LINQ — structure, not resolution

**Extension methods (4,147).** The IR carries **three facts, as written, and resolves none of
them**: the `this`-parameter marker (`cs_method_parameter.parameterMode = THIS`), the
declaring static class (`cs_method.csTypeLinkHash`, already there), and the governing `using`
set (`cs_using` rows for the file, plus `global using` and implicit usings). The parser does
**not** decide whether an extension is visible at a call site, and does **not** bind
`xs.Count()` to a declaration.

**LINQ (1,462 query expressions, 5,096 clauses).** Call synthesis is **withdrawn**. Query
clauses get a wrapper node, children parented to it, clause kind in a column — §3's rule.
`from` 2,051 · `select` 1,461 · `where` 708 · `join` 437 · `order_by` 309 · `let` 72 ·
`group` 58. The engine desugars.

`from`/`where`/`select` is structure the parser can see. `Where()`/`Select()` is a resolution
outcome it cannot — which overload, on which receiver type, through which extension method in
which `using` scope.

### 2.6 `using` in four forms, one of which has no syntax

`cs_using.usingKind` ∈ `NAMESPACE` · `STATIC` · `ALIAS` · `GLOBAL_NAMESPACE` ·
`GLOBAL_STATIC` · `GLOBAL_ALIAS` · **`IMPLICIT`**.

**59 projects enable `<ImplicitUsings>`, and 33 files carry `global using`.** Implicit usings
appear in **no file anywhere** — they are SDK-injected. They are emitted as `cs_using` rows
with `usingKind = IMPLICIT`, `startLine = 0`, and `originFile = ''`, from the same table that
supplies `DefineConstants`. An import relation with rows no file-walking extractor can
produce is unusual enough to state loudly.

---

## 3. The relations — column order is the contract

22 relations. `★` marks no Java analogue.

### 3.1 `cs_module` — 26 columns ★
```
name, qualifiedName, fileName, filePath, baseMservPath, namespaceStyle, namespaceCount,
targetFramework, defineConstantsKey, langVersion, nullableContextDefault, hasTopLevelStatements,
implicitUsingsEnabled, projectPath, assemblyName, emissionRegime, grammarRegime, startLine, endLine,
parseErrorCount, parseErrorBytes, isGeneratedOutput, csModuleInitMethodLinkHash,
isExternal, serviceVersionLinkHash, csModuleUniqueHash
```
`namespaceStyle` ∈ `FILE_SCOPED` (7,626) · `BLOCK` (1,795) · `NONE` · `MIXED` (13 files have
>1 namespace). `grammarRegime` names the parse mechanism (**`ts-cs-0.23.5-abi14-fork6`** as of the grammar fork, §4.0.4) and is
**coarse and in the key**, for the reason `emissionRegime` is: a patch bump must not rewrite
every hash.

> **Why a regime bump must land in ONE commit with the rules that cause it.**
>
> Split across two commits there is a window where the grammar already produces `fork8` trees
> while `grammarRegime` still says `fork6`. A golden blessed in that window is **attributed to a
> grammar that never produced it**.
>
> **An expectation with wrong provenance is UNREFUTABLE.** That is the whole problem, and it is
> worse than an absent expectation rather than merely different. An absent expectation is a gap
> anyone can see. A wrong-provenance expectation is internally consistent, passes its own gate,
> and **nothing downstream can tell it is wrong** — every later disagreement reads as a defect in
> the thing being measured, because the record says the answer was authorised under a regime it
> was not.
>
> A wrong number is contradicted by the next measurement. A wrong *attribution* is confirmed by
> every subsequent check, because each one re-reads the same false provenance and agrees with it.
> §4A.3 sequences the bump for this reason, and `bless` **refuses** when the regime it is told
> disagrees with the regime it observes. `parseErrorBytes` is what makes the 0.32%-truncating population queryable rather
than anecdotal.

### 3.2 `cs_type` — 30 columns
```
name, qualifiedName, arity, typeCategory, typeAccess, typeModifiers, typePlacement,
declarationScopeKey, declarationGroupKey, isPartial, isStatic, isAbstract, isSealed, isReadOnly,
isRefLikeStruct, isFileLocal, isRecord, hasPrimaryConstructor, primaryConstructorArity,
nullableContext, csModuleLinkHash, containingTypeLinkHash, csNamespaceName, startLine, endLine,
startColumn, attributeCount, isExternal, serviceVersionLinkHash, csTypeUniqueHash
```
`typeCategory` ∈ `CLASS` · `STRUCT` · `INTERFACE` · `ENUM` · `RECORD` · `RECORD_STRUCT` ·
`DELEGATE`. `isRefLikeStruct` is `ref struct` (stack-only, cannot be boxed) — a real
constraint an engine must not ignore.

### 3.3 `cs_type_heritage` — 13 columns
```
csTypeLinkHash, position, heritageText, baseTypeName, baseTypeArity, heritageKind,
hasPrimaryConstructorArguments, startLine, startColumn, csTypeReferenceLinkHash,
isExternal, serviceVersionLinkHash, csTypeHeritageUniqueHash
```
`heritageKind` ∈ `BASE_OR_INTERFACE` · `INTERFACE` · `ENUM_UNDERLYING_TYPE` ·
`TYPE_PARAMETER_CONSTRAINT`.

**v1 collapsed further than the language requires.** `class C : A, IB` is genuinely
undecidable — only resolution says which is the base class. But the language decides the
answer outright in four places, and v1 was discarding that:

| owner | rule | `heritageKind` |
|---|---|---|
| `interface` | a base list may contain only interfaces | `INTERFACE` |
| `struct` | cannot have a base class | `INTERFACE` |
| `record struct` | cannot have a base class | `INTERFACE` |
| `enum` | the entry is the **underlying type**, not a base or an interface | `ENUM_UNDERLYING_TYPE` |
| `class` / `record class`, **position 0** | may or may not be the base class | `BASE_OR_INTERFACE` |
| `class` / `record class`, **position ≥ 1** | a base class must come first, so anything after it is an interface | `INTERFACE` |

**Measured over 14,217 base-list entries: 4,284 (30.1%) are decidable by language rule.**

| owner | `INTERFACE` | `ENUM_UNDERLYING_TYPE` | `BASE_OR_INTERFACE` |
|---|---|---|---|
| class | 3,217 | — | 9,875 |
| interface | 526 | — | — |
| struct | 448 | — | — |
| enum | — | 92 | — |
| record class | 1 | — | 58 |

The **position rule is the larger half** and was not in the condition as written: the three
named owner kinds contribute 1,066 entries, while `class`/`record` positions ≥ 1 contribute
**3,218 more**. `BASE_OR_INTERFACE` is now reserved for exactly the 69.9% that genuinely
cannot be known from syntax, and the engine decides only those.

Java's `JavaHeritageKind` extends/implements split still does not port — but the residual
ambiguity is 69.9%, not 100%.

### 3.4 `cs_type_parameter` — 16 columns ★ (v1.15)
```
ownerLinkHash, ownerKind, position, name, varianceModifier, constraintText, hasStructConstraint,
hasClassConstraint, hasNotNullConstraint, hasConstructorConstraint, hasAllowRefStructConstraint,
hasUnmanagedConstraint, constraintTypeCount, isExternal, serviceVersionLinkHash,
csTypeParameterUniqueHash
```
`varianceModifier` ∈ `IN` · `OUT` · `NONE` — §2.3.

#### 3.4.1 `hasUnmanagedConstraint` — RULING (v1.15), CS-ORACLE-6

**Position: column 12, immediately after `hasAllowRefStructConstraint` and immediately before
`constraintTypeCount`.** The five existing constraint booleans are contiguous; a sixth belongs
inside that run and not appended after the count, because a reader scanning the constraint block
must not have to know that one member of it lives elsewhere. `constraintTypeCount` and everything
after it shift by one. **Arity 15 → 16.**

**This moves no hash.** `cs_type_parameter.hash = f(ownerLinkHash, position, name)` — §2's key
does not read any constraint column, so no PK and no FK changes. It is a pure arity change, which
is exactly the kind that is silent and fatal if a consumer is not rebuilt: `gen_decls.py --check`
and the arity gate are what make it loud.

**Semantics.** `true` iff the constraint list contains the `unmanaged` keyword.

**`hasStructConstraint` is ALSO true, and that is not redundancy.** `unmanaged` implies the struct
constraint — a blittable value type with no managed references — and the implied fact is already
written by cs-impl at `403c88b`. The two columns answer different questions and both are needed:

| question | column |
|---|---|
| is `T` a value type? | `hasStructConstraint` |
| may `T` be used with `fixed`, pointer types, `stackalloc`? | `hasUnmanagedConstraint` |

Writing only the implication loses the second; writing only the specific fact makes every consumer
re-derive the first. A reader must never have to know that one flag entails another.

**`constraintTypeCount` does not change.** `unmanaged` is a contextual keyword, not a type, and it
stays out of the count — which is what made this invisible: excluded from the count as a keyword,
and given no boolean as a keyword either, so it fell between the two.

**Why not read `constraintText`.** It holds `where T : unmanaged`, so the information was never
lost — but free text is not a vocabulary. A consumer would have to parse C# to use it, and the
defect class this closes is precisely *the parts are right and the structure is absent*.

**Found by reconciliation, not by reading:** Roslyn's 53 `TypeConstraint` nodes against our 39
`constraintTypeCount` + 12 `hasNotNullConstraint` left a remainder of exactly 2, and the corpus
holds exactly 2 `unmanaged` constraints.

> **`where T : default` is the same shape and is NOT ruled here.** It is in the extractor's
> `NON_TYPE_CONSTRAINTS` set with no boolean, so it is excluded from the count and recorded
> nowhere structured — identical to `unmanaged` before this ruling, but with **zero live sites in
> the 302-fixture corpus**. It is reported in the free-text reconciliation for a ruling of its own
> rather than given a column unasked, because a column that is false on every row is a parity slot
> and needs a zero-row assertion to go with it.

### 3.5 `cs_type_reference` — 22 columns
```
kind, context, ownerLinkHash, referenceOwnerKind, parentReferenceHash, position, depth,
typeName, completeTypeName, typeArgumentCount, arrayRank, isNullableAnnotated, isPointer,
isTuple, tupleElementCount, typeParameterLinkHash, startLine, endLine, startColumn,
isExternal, serviceVersionLinkHash, csTypeReferenceUniqueHash
```
### 3.5.1 Expression-position type references — CONFIRMED — RULING (v1.7)

**The reservation is lifted, and it was mine to lift.** Eight `CsTypeRefContext` values plus
`CsReferenceOwnerKind.EXPRESSION` and `USING` were reserved on "blocked on `cs_expression`
having no column list" and "blocked on `cs_using`'s heading disagreeing with its list". Both
blockers were removed by my own v1.3 and v1.4, and I did not go back and revisit the
reservations that rested on them. **A reservation resting on a resolved blocker is a ruling
nobody revisited, and the nobody here is me.**

Measured consequence while it stood: **zero `cs_type_reference` rows in any expression context**,
`castTypeReferenceLinkHash` empty on every cast, 24,375 typed lambda parameters with no type
tree — **the engine has no type edge from any expression at all.**

**Confirmed as proposed.** No column changes: `ownerLinkHash` + `referenceOwnerKind` are already
a generic owner pair, and `cs_expression.castTypeReferenceLinkHash` already exists for exactly
this.

| context | position | owner |
|---|---|---|
| `CAST` | `(T)x` | the expression |
| `OBJECT_CREATION` | `new T(…)` | the expression |
| `ARRAY_CREATION` | `new T[n]` | the expression |
| `TYPE_PATTERN` | `is T`, `case T t` | the expression |
| `METHOD_TYPE_ARGUMENT` | `M<T>()` | the expression |
| `TYPEOF` | `typeof(T)` | the expression |
| `TYPE_OPERAND` | see below — **must be enumerated** | the expression |
| `LAMBDA_PARAMETER` | `(int x) => …` | the **parameter** row (`referenceOwnerKind = METHOD_PARAMETER`) |
| `USING_ALIAS_TARGET` | `using F = A.B.C` | the **`cs_using`** row (`referenceOwnerKind = USING`) |

**Why this is IR and not resolution:** a type reference records the name **as written**, its
position and its reference tree. `cs_type_reference` has no `referencedTypeRegistryLinkHash` —
§3.5 deleted it — so nothing here resolves a name to a declaration. The engine gets the three
things it needs and does the join.

**Four conditions on the confirmation.**

**1. This inverts §1's build order, and needs a second pass rather than a reordering.** The
canonical order is `… → type_reference → expression → call_site`, but an expression-position
reference keys off the expression's hash, so it cannot be minted in the first pass.
**Declaration-position references — field types, return types, parameters, heritage, constraints
— stay in pass one exactly as documented. Expression-position references are a SECOND pass after
expressions.** This is the same shape as JavaScript's module edges arriving from the expression
walk, and it is stated so it is a decision rather than a surprise.

**2. `TYPE_OPERAND` must be enumerated, not a catch-all.** §4.0 test 2 asks for a population you
can state; a context whose membership is "the other ones" drifts silently and cannot be audited.
Enumerate it in the enum's own doc comment — `default(T)`, `sizeof(T)`, `stackalloc T[…]` — and
if a construct is not on that list it gets its own value rather than being swept in.

**3. `as T` is NOT `CAST`.** `(T)x` can invoke a user-defined `implicit`/`explicit` conversion
operator, which is §2's "a cast that invokes user code is a call edge that looks like a type
reference". `x as T` cannot — it is reference-or-boxing only, and never runs user code.
Collapsing them would tell the engine to look for a conversion operator that cannot exist.
Give `as` its own context (`AS_TYPE`) or place it in the enumerated `TYPE_OPERAND` set
explicitly; do not fold it into `CAST`.

**4. A 1:1 gate on the cast pair, both directions.** A `CAST` expression carries
`castTypeReferenceLinkHash` forward and the reference carries `ownerLinkHash` back. Two links,
one pair — which is the shape that **doubles** rather than collides (§2). Assert: every `CAST`
expression has exactly one type reference with `context = CAST` and that owner, and every such
reference has exactly one `CAST` expression pointing at it.

**On `LAMBDA_PARAMETER`, which is the weakest of the ten and confirmed anyway.** The owner chain
already distinguishes it — parameter → method → `methodKind = LAMBDA` — so it is one hop from
being redundant. Confirmed because lambda and method parameters share one relation, and a
consumer filtering type references by context should not have to join through two relations to
exclude lambdas. The absence of such a reference remains the signal that a lambda parameter is
**inferred**, which is the fact that matters.

**No `referencedTypeRegistryLinkHash`.** Java's is 0 of 67,938 by design; adding a C# column
that Roslyn *could* fill is exactly the resolved-link column `SCHEMA-CONSTRAINTS.md` forbids.
`isNullableAnnotated` covers 56,551 references.

### 3.6 `cs_method` — 35 columns
```
name, qualifiedName, arity, signature, methodKind, returnTypeName, methodAccess, methodModifiers,
isStatic, isAbstract, isVirtual, isOverride, isSealed, isAsync, isIterator, isExtension,
isPartialDefinition, isPartialImplementation, explicitInterfaceName, operatorToken, conversionKind,
csModuleLinkHash, csTypeLinkHash, isAccessor, ownerMemberLinkHash, ownerMemberKind, parameterCount,
startLine, endLine, startColumn, bodyKind, attributeCount,
isExternal, serviceVersionLinkHash, csMethodUniqueHash
```
**35 columns.** `isAccessor` is the v1.1 append.
`methodKind` ∈ `METHOD` · `CONSTRUCTOR` · `STATIC_CONSTRUCTOR` · `PRIMARY_CONSTRUCTOR` ·
`DESTRUCTOR` · `OPERATOR` · `CONVERSION_OPERATOR` · `LOCAL_FUNCTION` · `PROPERTY_GET` ·
`PROPERTY_SET` · `PROPERTY_INIT` · `INDEXER_GET` · `INDEXER_SET` · `EVENT_ADD` ·
`EVENT_REMOVE` · `LAMBDA` · `ANONYMOUS_METHOD`. `ownerMemberLinkHash` is how an accessor
points back at its `cs_property` or `cs_event` (§2.4), and it is **required**: non-empty
exactly when `isAccessor` is true, empty otherwise. `methodKind` carries the accessor
**role**; `ownerMemberKind` ∈ `PROPERTY` · `INDEXER` · `EVENT` carries what it belongs to. `explicitInterfaceName` is the
interface **as written** — 4,733 sites; the parser does not resolve it. `bodyKind` ∈ `BLOCK` ·
`EXPRESSION` · `NONE`.

### 3.7 `cs_method_parameter` — 18 columns
```
csMethodLinkHash, position, name, parameterMode, typeName, completeTypeName, isNullableAnnotated,
hasDefaultValue, defaultValueText, isParams, isThis, scopedModifier, attributeCount,
startLine, startColumn, isExternal, serviceVersionLinkHash, csMethodParameterUniqueHash
```
`parameterMode` ∈ `VALUE` · `REF` · `OUT` · `IN` · `REF_READONLY` · `PARAMS` · `THIS`.
**An `out` parameter is a second return channel** — `TryParse` is in every C# codebase — and
the mode is a column, not a kind, per §3's "variant in a field".

### 3.8 `cs_property` — 26 columns ★
```
name, isIndexer, propertyTypeName, completeTypeName, isNullableAnnotated, propertyAccess,
getAccessorAccess, setAccessorAccess, hasGetter, hasSetter, setterKind, isRequired, isStatic,
isAbstract, isVirtual, isOverride, explicitInterfaceName, initializerExpressionLinkHash,
csTypeLinkHash, startLine, endLine, startColumn, attributeCount,
isExternal, serviceVersionLinkHash, csPropertyUniqueHash
```
`setterKind` ∈ `SET` · `INIT` · `NONE` (635 `init`). `getAccessorAccess`/`setAccessorAccess`
carry asymmetric accessibility — 581 sites of `{ get; private set; }`. 218 indexers.

### 3.9 `cs_event` — 17 columns ★
```
name, eventTypeName, completeTypeName, eventKind, eventAccess, isStatic, isVirtual, isOverride,
explicitInterfaceName, csTypeLinkHash, startLine, endLine, startColumn, attributeCount,
isExternal, serviceVersionLinkHash, csEventUniqueHash
```
`eventKind` ∈ `FIELD_LIKE` (130) · `WITH_ACCESSORS` (67).

### 3.10 `cs_field` — 27 columns
```
name, fieldTypeName, completeTypeName, potentialQualifiedName, isAmbiguous, fieldAccess,
fieldModifiers, isStatic, isReadOnly, isConst, isVolatile, isRequired, isFixedSizeBuffer,
isNullableAnnotated, memberKind, csTypeLinkHash, csModuleLinkHash, typeReferenceLinkHash,
initializerExpressionLinkHash, declarationIndex, attributeCount, startLine, endLine, startColumn,
isExternal, serviceVersionLinkHash, csFieldUniqueHash
```
`fieldModifiers` is a comma-set following Java's `typeModifier`, and it is what makes
`VOLATILE`, `CONST` and `FIXED` **reachable** — they were unemittable only because this
relation had no list (§4). `declarationIndex` separates `int a, b;` into two rows with
distinct keys; without it they collide, and **duplicates double**.
`memberKind` ∈ `FIELD` · `EVENT_BACKING` · `ENUM_BACKING`.

### 3.11 `cs_enum_member` — 18 columns
```
name, qualifiedName, ordinal, hasInitializer, initializerText, constantValue, valueKind,
csTypeLinkHash, csModuleLinkHash, ownerTypeName, csExpressionLinkHash, attributeCount,
startLine, endLine, startColumn,
isExternal, serviceVersionLinkHash, csEnumMemberUniqueHash
```
`constantValue` is filled **only when the initializer is a literal**; `valueKind` ∈ `IMPLICIT` ·
`LITERAL` · `COMPUTED`. A `COMPUTED` member carries `csExpressionLinkHash` and an empty
`constantValue` — evaluating `A | B` is the engine's, not the parser's.

### 3.12 `cs_variable` — 28 columns
```
name, variableTypeName, completeTypeName, potentialQualifiedName, isAmbiguous, isImplicitlyTyped,
isNullableAnnotated, declarationKind, scopeKind, scopeDepth, isConst, refKind, isScoped,
csTypeLinkHash, csMethodLinkHash, csModuleLinkHash, csBlockLinkHash, hasInitializer,
initializerExpressionLinkHash, typeReferenceLinkHash, deconstructionIndex, declarationIndex,
startLine, endLine, startColumn,
isExternal, serviceVersionLinkHash, csVariableUniqueHash
```
`declarationKind` ∈ `LOCAL` · `FOREACH` · `USING` · `FIXED` · `OUT_VAR` · `PATTERN` ·
`DECONSTRUCTION` · `CATCH` · `QUERY_RANGE`. **`OUT_VAR` is the second return channel** —
`int.TryParse(s, out var n)` declares `n` here and nowhere else.
`refKind` ∈ `NONE` · `REF` · `REF_READONLY`; `isScoped` is separate because **`scoped` has two
tree shapes** (§5.1) and conflating it with `refKind` loses a lifetime constraint.

> **RULING (v1.3) — `var _ = M()`, answered by Roslyn rather than by taste, and the answer
> inverts the common assumption.**
>
> Measured with `GetDeclaredSymbol` / `GetSymbolInfo`, Roslyn 4.12, `LanguageVersion.CSharp13`:
>
> | source | Roslyn says | ruling |
> |---|---|---|
> | `var _ = M();` | **`ILocalSymbol`** | **a real LOCAL.** Emit a `cs_variable` row. |
> | `int _ = M();` | `ILocalSymbol` | LOCAL. Emit. |
> | `_ = M();` with **no** `_` in scope | **`IDiscardSymbol`** | DISCARD. **No** `cs_variable` row. |
> | `_ = M();` with a local `_` in scope | **`ILocalSymbol`** | an assignment to that local. |
> | `out _`, `out var _`, `is T _`, `(a, _) = …` | discard **designation** node | DISCARD. No row. |
>
> **`var _ = M()` is not a discard.** C# treats `_` as a discard only in *designation* and
> *assignment-target* positions — never in a variable declarator that has an initializer.
>
> So the parser's rule is syntactic and needs no resolution:
> 1. a `variable_declarator` named `_` → `cs_variable`, `declarationKind = LOCAL`;
> 2. a discard **designation** node → no `cs_variable` row; an expression with
>    `kind = DISCARD`;
> 3. `_ = e` in assignment-target position → `DISCARD` **iff no local named `_` is in scope**.
>    That last is a **same-file, one-hop scope lookup**, which the IR rule permits — the same
>    grounding cs-impl used to take `METHOD_GROUP` from 2,080 rows to 1.
>
> `declarationKind` therefore gains **no** `DISCARD` value: a discard never produces a
> `cs_variable` row at all. `CsExpressionKind.DISCARD` carries it instead.
>
> #### STATUS at `ts-cs-0.23.5-abi14-fork11`: this ruling is UNIMPLEMENTED (v1.14)
>
> `CsExpressionKind` has 47 values and `DISCARD` is not one of them. The ruling above is a
> **specification, not a description** — read it as what the parser must do, not as what it
> does. Recorded here because a reader who assumes otherwise will build on a column that is
> never written.
>
> Measured over the 302 category fixtures, oracle mode `discard` against the fact base:
>
> | | |
> |---|---|
> | sites Roslyn classifies DISCARD | **227** (225 `_ = expr;` assignment targets, 2 designations) |
> | of those, marked as a discard by the parser | **0** |
> | `cs_expression` rows with `potentialQualifiedName == '_'` | **234** |
> | `cs_variable` rows actually named `_` | **3** |
>
> So roughly **231 of 234** `_` references can never resolve. Each is emitted as a plain
> `NAME_REFERENCE`, so the engine will attempt resolution and fail — and every failure reads as
> an unresolved reference when it is a discard that **correctly binds nothing**. The cost is not
> a missing row; it is a non-defect population inflating the number by which the front end is
> judged.
>
> The claim `expressions.discardClassification` is therefore **`REFUSED:ORACLE_DISAGREES`**, and
> that is the claims layer working: it declined to freeze a wrong expectation. Handed to cs-impl
> as CS-ORACLE-2. Adding the enum value is cs-impl's to make — the vocabulary belongs to the
> extractor that emits it, and the enum-emission audit must see the value and the rows land
> together.

### 3.13 `cs_using` — 15 columns ★
```
usingKind, namespaceOrTypeName, aliasName, aliasTargetText, isGlobal, isStatic, isImplicit,
originFile, csModuleLinkHash, position, startLine, startColumn,
isExternal, serviceVersionLinkHash, csUsingUniqueHash
```
### 3.14 `cs_attribute` — 19 columns
```
attributeName, qualifiedName, attributeTarget, ownerHash, ownerKind, csTypeLinkHash,
csModuleLinkHash, attributeListIndex, position, argumentCount, hasNamedArguments,
typeReferenceLinkHash, csExpressionLinkHash, startLine, endLine, startColumn,
isExternal, serviceVersionLinkHash, csAttributeUniqueHash
```
`attributeTarget` ∈ `NONE` · `ASSEMBLY` · `MODULE` · `TYPE` · `METHOD` · `FIELD` · `PROPERTY` ·
`EVENT` · `PARAM` · `RETURN` · `TYPEVAR`. C# attributes are **inert metadata**, like Java
annotations and unlike TypeScript decorators, so there is no `decoratorSemantics` analogue and
no execution-order column. `[assembly: X]` has no owner declaration — `ownerKind = MODULE`.

### 3.15 `cs_attribute_argument` — 14 columns
```
argumentName, argumentValue, valueKind, position, isNamedArgument, parentAttributeHash,
referencedTypeReferenceLinkHash, csExpressionLinkHash, startLine, endLine, startColumn,
isExternal, serviceVersionLinkHash, csAttributeArgumentUniqueHash
```
`isNamedArgument` distinguishes `[X(1)]` from `[X(Name = 1)]` — positional and named arguments
bind differently and a single `argumentName` column cannot say which.

### 3.16 `cs_expression` — 35 columns ★spine

**Ported from `ts_expression` (34), not invented.** Every later relation chains off this hash,
so it is stated in full before any of them emits.

```
kind, edgeRole, rootContext, expressionOwnerKind, expressionOwnerHash, parentExpressionHash,
position, depth, csTypeLinkHash, csModuleLinkHash, literalKind, literalValue, operatorString,
unaryFixity, methodReferenceKind, referencedEntityKind, referencedEntityHash,
anonymousDeclarationHash, potentialQualifiedName, isAmbiguous, argumentCount, typeArgumentCount,
isSpread, isNullConditional, isNullForgiving, castTypeReferenceLinkHash, isCheckedContext,
returnStatementIndex, startLine, startColumn, endLine, endColumn,
isExternal, serviceVersionLinkHash, csExpressionUniqueHash
```

**The five that differ from TypeScript, each with its reason:**

| column | why |
|---|---|
| **`methodReferenceKind`** | TypeScript's is a documented **parity slot, always `""`**. **C# fills it.** A method group conversion — `Action a = M;` — is a reference to a method with *no call syntax at all*, and this column is the only thing that says so. |
| **`castTypeReferenceLinkHash`** | a cast that invokes a user-defined `implicit`/`explicit` operator **is a call edge that looks like a type reference** (§2, 582 conversion operators). The expression carries the target type reference so the engine can decide; the parser does not resolve whether user code runs. |
| **`isNullForgiving`** | `!` — the C# analogue of TypeScript's `isNonNullAsserted`, renamed to the language's own term per §2's naming rule. |
| **`isCheckedContext`** | `checked`/`unchecked` changes which operator is invoked. C# 11 has `operator checked +`, so this is a *target* discriminator, not a flag. |
| **`isSpread`** | `..e` in a collection expression. Kept because the grammar's `collection_element` is **overloaded** with the non-spread case (§5) and this is where the disambiguation lands. |

TypeScript's `isTypeOnlyReachable` does **not** port: C# has no type-only expression
constructs, so it would be a column that is always `false`.

**`kind` (`CsExpressionKind`) — the wrapper-node values that §3 of `BUILDING-A-PARSER.md`
exists to force.** Each of these emits **one wrapper with its children parented to it and the
variant in a column**, never bare parts:

`EVENT_SUBSCRIBE` · `EVENT_UNSUBSCRIBE` (`+=`/`-=` on an event is a *subscription*, not a
compound assignment — §2.4) · `ASSIGNMENT` · `COMPOUND_ASSIGNMENT` (operator in
`operatorString`, one kind for all of `+= -= *= /= ??= ||=`) · `CAST` · `AS_EXPRESSION` ·
`IS_PATTERN` · `SWITCH_EXPRESSION` · `SWITCH_ARM` · `WITH_EXPRESSION` · `RANGE` · `INDEX` ·
`TUPLE` · `DECONSTRUCTION` · `INTERPOLATED_STRING` · `INTERPOLATION` · `LAMBDA` ·
`ANONYMOUS_METHOD` · `ANONYMOUS_OBJECT` · `COLLECTION_EXPRESSION` · `SPREAD_ELEMENT` ·
`QUERY` · `AWAIT` · `NAMEOF` · `TYPEOF` · `SIZEOF` · `STACKALLOC` · `DEFAULT` · `THROW_EXPRESSION` ·
`REF_EXPRESSION` · `POINTER_INDIRECTION` · `ADDRESS_OF` · `NAME_REFERENCE` · `MEMBER_ACCESS` ·
`ELEMENT_ACCESS` · `INVOCATION` · `OBJECT_CREATION` · `LITERAL` · `PARENTHESIZED`.

**`PARENTHESIZED` is emitted, not skipped.** §6: a tree rooted at a non-emitting node dies
before its children are enqueued, and `return (a && b.c())` cost admin-ui 1,808 expressions in
TypeScript. Unwrap at the root, but emit the row.

### 3.16.1 Object creation with an initializer — where the expression ENDS — RULING (v1.10)

**CS-CORPUS-22.** The parser currently gives **three** answers for the span of
`new Foo { A = 1 }`, and an inconsistency is a defect whichever end is ruled correct, because
`endLine`/`endColumn` are columns and three answers make them unusable.

**Ruled: the creation's span runs to the END of the initializer, and the initializer is its own
child node.** Measured against Roslyn, which is unambiguous in all five forms:

| source | `ObjectCreation`-family span | initializer node |
|---|---|---|
| `new Q()` | `[41,48)` `'new Q()'` | — |
| `new Q { }` | `[66,75)` `'new Q { }'` | `ObjectInitializer` `[72,75)` |
| `new Q() { }` | `[93,104)` `'new Q() { }'` | `ObjectInitializer` `[101,104)` |
| `new List<int> { 1, 2 }` | `[122,171)` whole | `CollectionInitializer` `[163,171)` |
| `new int[] { 1, 2 }` | `[189,207)` whole | `ArrayInitializer` `[199,207)` |
| `new { X = 1 }` | `[225,238)` whole | — |

**Why the short span is not merely different but wrong**, and this is the argument rather than
the appeal to Roslyn:

1. **The initializer's contents are CHILD expressions of the creation.** `A = 1` is parented to
   it. If the creation's span ends at `Foo`, every one of those children sits **outside its
   parent's span** — and "the innermost expression containing position P" becomes undefined,
   which is how an engine finds the expression that owns a position.
2. **Node identity is the byte range** (§2). A span that stops short makes
   `new Foo { A = 1 }` and `new Foo { B = 2 }` differ only in children, not in identity — and
   §2's rule is that duplicates **double** rather than collide.
3. `new Q()` and `new Q() { }` would be indistinguishable by span, and the initializer's
   presence is a real fact about the construct.

**The gate this needs, and it generalises past this construct:**

> **Every child expression's span must be contained in its parent's span.**
> `child.start >= parent.start && child.end <= parent.end`, for every row with a
> `parentExpressionHash`.

It belongs beside the 1:1 call-site check as a spine invariant, and its negative control is a
hand-built row whose child span exceeds its parent's.

> ### RETRACTION (v1.12) — span nesting does NOT catch this defect
>
> v1.10 said this gate *"would have caught all three answers without anyone knowing the construct
> existed."* **That is false**, and cs-fixtures measured it at the defect's own commit: **0
> violations before the fix and 0 after**, with a synthetic out-of-parent row proving the checker
> fires. The gate works; my claim about its reach did not.
>
> **Why, and this is the generalisation worth more than the gate:** a wrong parse builds an
> **internally consistent** tree. `new HashSet<Node>(c) { … }` misparsed becomes
> `BINARY(BINARY(new HashSet < Node) > CAST((c){…}))` — and **every child sits inside its wrong
> parent.** Containment holds perfectly, because the parser built a coherent tree of the wrong
> shape.
>
> > **A consistency invariant cannot catch a coherent misparse. Only an IMPOSSIBILITY invariant
> > can.**
>
> Consistency says *the tree hangs together*. A misparse produces a tree that hangs together. What
> discriminates is a fact that **cannot be true of valid C#** regardless of how the tree is
> arranged.
>
> **The two that do discriminate**, from cs-fixtures, each one line over `cs_expression` and each
> impossible in valid C# — **five sites pre-fix, zero post-fix**:
>
> | invariant | why it is impossible |
> |---|---|
> | no `INITIALIZER` has a `CAST` parent | an object/collection initializer is never the operand of a cast |
> | no `OBJECT_CREATION` ends on an identifier character | a creation ends at `)`, `}` or `]` — never mid-name |
>
> **Keep check 36 explicitly.** It is a real invariant and it catches a real class — a *malformed*
> tree, where a child genuinely escapes its parent. It simply does not catch a *well-formed tree of
> the wrong shape*, which is what a misparse is. Two gates, two classes, and neither substitutes.
>
> I made the v1.10 claim without asking for the measurement. The structural derivation was sound
> and the conclusion about coverage did not follow from it.

### 3.17 `cs_call_site` — 21 columns ★spine
```
callKind, calleeName, receiverKind, receiverExpressionLinkHash, receiverTypeName,
csExpressionLinkHash, csModuleLinkHash, callerMethodLinkHash, callerTypeLinkHash,
argumentCount, namedArgumentCount, typeArgumentCount, refArgumentCount, outArgumentCount,
isConditional, isQueryDesugarCandidate, startLine, startColumn,
isExternal, serviceVersionLinkHash, csCallSiteUniqueHash
```
`callKind` ∈ `METHOD_CALL` · `FUNCTION_CALL` · `CONSTRUCTOR_CALL` · `BASE_CONSTRUCTOR_CALL` ·
`THIS_CONSTRUCTOR_CALL` · `DELEGATE_INVOKE` · `LOCAL_FUNCTION_CALL` · `OPERATOR_CALL` ·
`CONVERSION_CALL` · `ELEMENT_ACCESS_CALL` · `NULL_CONDITIONAL_CALL`. **Reserved, zero rows:**
`DYNAMIC_CALL` (syntax cannot decide — the C# analogue of TS's `INDEX_CALL`),
`EXTENSION_REDUCED_CALL`, `QUERY_DESUGARED_CALL` (the engine's, per §2.5).
> **`isExtensionCallSyntax` is DELETED (v1.4).** cs-corpus measured it across **782,388
> rows** and found it a deterministic function of syntax carrying **zero bits**, flagging
> **20× more calls than are extension calls**. Both halves of that are right, and they point
> the same way.
>
> The column as specified recorded `a.B()` *shape* — which is exactly `callKind ==
> METHOD_CALL`. §4.0 test 3: information already carried by an existing column, so **delete**.
>
> The question it was reaching for — *is this an extension call* — fails §4.0 test 1: it needs
> the receiver's **type** and the governing `using` set, which is resolution. It does not
> become a reserved value either, because **the IR already carries what the engine needs**:
> `cs_method.isExtension` (grounded in the `this` parameter, §2.5), the declaring static class,
> and the `cs_using` set. The join is the engine's.
>
> **A column that cannot vary is worse than absent, because a consumer reads it as evidence.**

### 3.18 `cs_query_clause` — 14 columns ★
```
csExpressionLinkHash, parentQueryLinkHash, position, clauseKind, identifierName, sourceExpressionLinkHash,
bodyExpressionLinkHash, intoIdentifier, isDescending, startLine, startColumn,
isExternal, serviceVersionLinkHash, csQueryClauseUniqueHash
```
`clauseKind` ∈ `FROM` · `LET` · `WHERE` · `JOIN` · `JOIN_INTO` · `ORDER_BY` · `ORDER_BY_ORDERING` ·
`SELECT` · `GROUP` · `INTO`.

### 3.19 `cs_block` — 23 columns
```
blockKind, order, nestingDepth, csTypeLinkHash, csMethodLinkHash, csModuleLinkHash,
methodOwnerHash, parentContainerHash, tryStatementHash, catchTypeNames, resourceCount,
conditionExpressionLinkHash, switchSectionIndex, labelName, isUnsafe, isChecked,
startLine, endLine, startColumn, endColumn,
isExternal, serviceVersionLinkHash, csBlockUniqueHash
```
`blockKind` ∈ `METHOD_BODY` · `CONSTRUCTOR_BODY` · `ACCESSOR_BODY` · `LOCAL_FUNCTION_BODY` ·
`LAMBDA_BODY` · `IF` · `ELSE` · `FOR` · `FOREACH` · `WHILE` · `DO` · `SWITCH_SECTION` · `TRY` ·
`CATCH` · `FINALLY` · `USING` · `LOCK` · `FIXED` · `UNSAFE` · `CHECKED` · `UNCHECKED` ·
`LABELED` · `ANONYMOUS`. **`LABELED` is present because TypeScript's absence of it was a
measured defect** — `outer: for (…)` emitted the loop and dropped the label (§3).
`resourceCount` covers both `using (…)` and the C# 8 `using var` declaration form.

### 3.20 `cs_comment` — 15 columns
```
commentKind, commentText, ownerHash, ownerKind, commentIndex, csModuleLinkHash, xmlDocTags,
isDocumentation, startLine, endLine, startColumn, endColumn,
isExternal, serviceVersionLinkHash, csCommentUniqueHash
```
`commentKind` ∈ `LINE` · `BLOCK` · `XML_DOC_LINE` · `XML_DOC_BLOCK`. `xmlDocTags` is a
comma-set of tag names (`summary`, `param`, `returns`, `typeparam`, `inheritdoc`, …) — the
tag NAMES only. XML doc is **not** a declared-type channel in C# the way JSDoc is in
JavaScript: C# already has declaration-site types, so `<param>` is documentation, not a
fallback annotation.

> **RULING (v1.3). `#pragma` and `#region` are NOT comments.** A directive is not a comment,
> and `cs_preproc_region` exists to hold it. **`commentKind` having no value that a `#region`
> is, is the answer, not a gap** — recorded here so it is not proposed again.
>
> They are `cs_preproc_region` rows. `regionKind` ∈ `IF` · `ELIF` · `ELSE` · `REGION` ·
> `PRAGMA_WARNING` · `PRAGMA_CHECKSUM` · `NULLABLE` · `DEFINE` · `UNDEF` · `LINE` · `ERROR` ·
> `WARNING`. The grammar agrees: a `#pragma` is a `preproc_pragma` node, never a `comment`.
>
> **`cs_comment.directiveKind` is DELETED (v1.4), not reserved.** I proposed keeping it as an
> always-empty parity slot to avoid a reorder; that was ruled against, correctly. **A
> parse-time assertion guarding a column with no population is a column that reads as
> evidence to anyone who finds it later.** `#region` and `#pragma` are `cs_preproc_region`
> rows, so `directiveKind` has nothing left to hold. `cs_comment` is 16 → **15 columns**.
>
> The reorder is taken **now, before any golden is blessed** — which is the only moment it is
> free. A parity slot is right when a column has a real population in a *sibling* language
> (TypeScript's `methodReferenceKind`, which C# fills). It is wrong when the column can never
> have a population anywhere.
### 3.21 `cs_parse_gap` — 12 columns ★
```
csModuleLinkHash, gapKind, nodeType, parentNodeType, startLine, endLine, startColumn, byteLength,
coveragePercent, isExternal, serviceVersionLinkHash, csParseGapUniqueHash
```
`gapKind` ∈ `ERROR_LOCAL` · `ERROR_PARTIAL` · `ERROR_TRUNCATING` · `INSERTED_NODE` ·
`SELF_REPORTING_NODE` · `PREPROC_FRAGMENT`.

> **RULING (v1.2), from cs-impl's finding: this grammar signals a parse error THREE ways and
> only one of them is an `ERROR` node.** `MISSING_NODE` is renamed `INSERTED_NODE` and
> `SELF_REPORTING_NODE` is added, because the old value was **structurally impossible to
> emit** — the detector it implied could not reach the thing it named.

| # | shape | detector | population |
|---|---|---|---|
| 1 | an `ERROR` node | `node.type === 'ERROR'` | 1,340 gaps |
| 2 | an **inserted** node | `isMissing` **OR** (`isNamed` **AND** `startIndex === endIndex`) | 172 gaps |
| 3 | a node that **is** the error, neither `ERROR` nor missing | deepest `hasError` node, as a fallback | 26 files (9.3% of erroring files) |

Two traps in shape 2, both measured by cs-impl: **`isMissing` is unreliable** — on
`bcl-slice-A:Math.cs` the defect is a zero-width `identifier` with
`isMissing` **false** — and the inserted node is usually **anonymous** (a `;` or `}`), so a
named-only walk cannot reach one at all.

**And `hasError` does not propagate reliably.** On the same file the failing node has
`hasError` true and its **parent has it false**, so a walk that prunes on `hasError` stops one
level *above* the defect. **This invalidates pruning as an optimisation anywhere in this
repo**, and cs-impl has flagged it to Java and Python as unverified exposure.

**Consequence for my own Phase 0 numbers, stated rather than quietly corrected:** the
truncation split (LOCAL / PARTIAL / TRUNCATING) bucketed on bytes inside `ERROR` nodes
**only** — shape 1. Files whose defect is shape 2 or 3 contribute zero `ERROR` bytes and were
therefore bucketed `LOCAL`. The *file* counts are unaffected (they used `rootNode.hasError`,
which sees all three), and so is the 99.63% declaration-recovery figure (measured against
Roslyn, not against ERROR nodes). But **the 0.32%-truncating figure is a floor, not a
measurement**, until it is recomputed with all three detectors. Recorded in the coordination
log as an open item against my own number.

### 3.22 `cs_preproc_region` — 15 columns ★
```
csModuleLinkHash, regionKind, conditionText, conditionSymbols, isActive, regionShape,
branchIndex, branchCount, activationSource, parentRegionLinkHash, startLine, endLine,
isExternal, serviceVersionLinkHash, csPreprocRegionUniqueHash
```
`regionShape` ∈ `TYPE_LEVEL` (32.9%) · `DECLARATION` (23.9%) · `STATEMENT` (25.2%) ·
`ENUM_MEMBERS` (1.1%) · `FRAGMENT` (16.9%) · `EMPTY`.

---

## 4. Enum audit and reserved values

Every declared value is exercised by a fixture or carries a **zero-row assertion**. Reserved
on day one, with the reason:

| value | relation | why reserved |
|---|---|---|
| `DYNAMIC_CALL` | `cs_call_site` | a fact about a value's runtime type, not syntax |
| `EXTENSION_REDUCED_CALL` | `cs_call_site` | `ReducedFrom` is an oracle question |
| `QUERY_DESUGARED_CALL` | `cs_call_site` | the engine desugars, §2.5 |
| `TYPE_PARAMETER_CONSTRAINT` | `cs_type_heritage` | emitted only if constraints move here |

### 4.0 The three categories, and the boundary between them — RULING (v1.3)

cs-impl's formulation, adopted verbatim because it is better than mine:

> **A reservation is a decision that syntax cannot decide it. A gap is a defect with a
> measurement. Asserting both at zero is how a defect becomes a design.**

That last clause is the whole reason this section exists. A `MEASURED_GAPS` entry and a
`RESERVED_ENUM_VALUES` entry look identical from the fact base — both are a declared value
with zero rows — so without a stated boundary a defect quietly becomes a design decision and
`GAP_BAR` never reaches its floor.

| | `RESERVED_ENUM_VALUES` | `MEASURED_GAPS` | **DELETED** |
|---|---|---|---|
| why zero rows | syntax **cannot** decide it | not built **yet** | the value should not exist |
| expected rows | zero **forever** | **non-zero**, once built | n/a |
| must carry | the reason syntax cannot decide it | a **measured population**, an **owner**, and a **closing condition** | the reason, recorded once |
| how it ends | a ruling that changes the schema | `GAP_BAR` reaches zero, the entry is **deleted**, the value becomes ordinary | already ended |

**The admission tests, applied in this order:**

1. Can you state a rule by which **syntax alone** could decide it? If yes it is **not** a
   reservation — it is a gap, or it is already emittable.
2. Can you state the **measured population** it would have? If no it is **not** a gap. An
   entry with no number is a reservation that has not been argued, or a deletion that has not
   been taken.
3. Is the information already carried by an **existing edge, link or column**? Then **delete**.

**A `MEASURED_GAPS` entry with no number, no owner and no closing condition is promoted to
`RESERVED` or deleted at the next review. It does not sit.** That is the ratchet rule from §8
of `BUILDING-A-PARSER.md` — a bar that only falls, and the commit lowering it is the commit
that earns it — applied to enum values rather than to a count.

### 4.0.0 The fourth category, and the test that keeps it honest: PARITY SLOTS

A **parity slot** is a column that is always empty on *this* language's output, kept so the
layout matches a sibling language. It is the fourth way a thing can be empty, and it is the one
most easily abused, because "it's a parity slot" is available as a defence for any empty column.

> **A parity slot is correct when the column has a real population in a SIBLING LANGUAGE. It
> is wrong when the column can never have a population anywhere.**

| | correct | wrong |
|---|---|---|
| example | TypeScript's `methodReferenceKind`, correctly always `""` — **C# fills it**, because a method group conversion is a reference to a method with no call syntax | `cs_comment.directiveKind`, which I proposed and which was **deleted**: `#region` and `#pragma` are `cs_preproc_region` rows, so no language fills it |
| test | name the sibling relation and the population | if you cannot name one, it is not parity — it is a **deletion you have not taken** |

The reason this matters more than tidiness: **a parse-time assertion guarding a column with no
population is a column that reads as evidence to anyone who finds it later.** An always-empty
column with a zero-row gate looks exactly like a measured fact whose value happens to be
absent, and the next reader has no way to tell the difference.

**The same test kills the reserved-value version of the mistake.** A *reserved enum value*
implies a fact the parser might one day emit. `cs_call_site.isExtensionCallSyntax` was neither
parity nor reservation: the IR already carries the three facts the engine needs —
`cs_method.isExtension` grounded in the `this` parameter, the declaring static class, and the
`cs_using` set — so the join is the engine's and **there was nothing to reserve**. Deleted, not
reserved.

So the admission tests in full, in order: **is it already carried** (delete) · **can syntax
decide it** (emit, or it is a gap) · **can you state its population** (gap, else not a gap) ·
**does a sibling language fill it** (parity slot, else delete).

### 4.0.1 Three values DELETED — RULING (v1.3)

cs-impl routed these as duplicates of an edge that already exists. Test 3 above says delete,
and for the third the case is stronger than duplication.

| value | why it is deleted |
|---|---|
| **`CsExpressionKind.ARGUMENT_LIST`** | a pure container. An argument is already a **child of the `INVOCATION` wrapper** with `edgeRole = ARGUMENT` and `position` giving its index, and `cs_call_site.argumentCount` gives the count. The triple `(parent, edgeRole, position)` carries strictly more than a container node does — it survives two calls on one line, which a shared container would not. |
| **`CsExpressionKind.LAMBDA_BODY`** | a lambda body is **already** one of two things that exist: a **block-bodied** lambda is a `cs_block` with `blockKind = LAMBDA_BODY` (§3.19), and an **expression-bodied** one is a child expression with `edgeRole = LAMBDA_BODY`. Delete it from `CsExpressionKind` only — **the `cs_block.blockKind` and `CsEdgeRole` values of the same name stay**, and deleting the wrong one of the three would lose the body. |
| **`CsExpressionOwnerKind.VARIABLE`** | **not merely redundant — actively harmful, so this one is a keep-or-delete on different grounds.** An expression's owner is its enclosing **executable scope**, because that is what `cs_call_site.callerMethodLinkHash` is derived from. In `void M() { var x = Foo(); }` the call `Foo()` must report `M` as its caller. Setting the owner to the *variable* would make every call inside an initializer report no caller, and the engine would have to re-derive it by walking variable → method. The attachment to the variable is already carried, in the right direction, by `cs_variable.initializerExpressionLinkHash`. |

**None of the three is a gap**, so none belongs in `MEASURED_GAPS`, and none carries a
zero-row assertion — an assertion on a value that no longer exists is itself dead weight.

### 4.0.2 Five `CsRootContext` values and `OwnerKind.BLOCK` — CONFIRMED — RULING (v1.6)

cs-impl applied these by §4.0's reasoning and routed them for overturn rather than assuming the
analogy held. **Confirmed, all six** — and the four `CsRootContext` ones share one cause, so the
ruling is a general test rather than four separate judgements.

**The test: a `CsRootContext` value must name a NON-EXPRESSION parent.** `rootContext` records
where an expression *tree begins* — the syntactic position whose parent is a statement or a
declaration. If the parent is itself an expression, the value describes a **child edge** and
belongs in `CsEdgeRole`, where the parent hash and `position` already place it.

| deleted from `CsRootContext` | its parent | belongs in |
|---|---|---|
| `AWAIT_OPERAND` | the `await` expression | `CsEdgeRole` |
| `INTERPOLATION` | the interpolated-string expression | `CsEdgeRole` |
| `COLLECTION_ELEMENT` | the collection expression | `CsEdgeRole` |
| `QUERY_CLAUSE` | the query expression | `CsEdgeRole` + `cs_query_clause` |

**The warning that goes with it, because it is the same trap as `LAMBDA_BODY`:** delete these
from `CsRootContext` **only**. The information must survive as an **edge role**, and deleting
the same-named `CsEdgeRole` value instead would lose the child's relationship to its parent —
which is §3's defect class, the parts emitted and the structure absent.

**`CsExpressionOwnerKind.BLOCK` — deleted, for the reason `VARIABLE` was.** An expression's
owner is its enclosing **executable scope**, because that is what `cs_call_site.callerMethodLinkHash`
derives from. A block always belongs to a method, so `BLOCK` is one hop further from the caller
and carries nothing `cs_block` does not already carry.

The case that makes `BLOCK` tempting is **top-level statements** — a file with no type and no
method. §4.0.3 answers it, and the answer is a method, not a block. So the tempting case does
not need it either.

### 4.0.3 Top-level statements — what owns the statements — RULING (v1.6)

Answered by Roslyn, not chosen. `CSharpCompilation.GetEntryPoint` and
`SemanticModel.GetEnclosingSymbol` over a top-level-statements file:

```
entryPointSymbol         <top-level-statements-entry-point>
  metadataName           <Main>$
  containingType         Program   metadataName=Program  kind=Class  accessibility=Internal
  isStatic               True      returnType=void
  methodDeclaringSyntaxRefs  1  -> CompilationUnit [0..102)
  typeDeclaringSyntaxRefs    1  -> CompilationUnit [0..102)
globalStatement@14 .. @82  enclosingSymbol=<Main>$  kind=Method
localFunction Helper()     containing=<Main>$
```

**The statements are owned by a METHOD**, and the decisive detail is that **both the method and
its type carry exactly one `DeclaringSyntaxReference`, pointing at the `CompilationUnit`.** They
are not symbols without syntax — so they are adjudicable, and the partial-type gate, which keys
on `DeclaringSyntaxReferences`, is not broken by them.

**The emission:**

| row | value |
|---|---|
| `cs_type` | name `Program`, arity 0, `typeCategory = CLASS`, `typeAccess = INTERNAL`, `declarationScopeKey = NS:` (global namespace), position = the compilation unit, `typeModifiers` includes **`SYNTHESIZED`** |
| `cs_method` | name `<Main>$`, `methodKind = `**`TOP_LEVEL_ENTRY_POINT`**, `isStatic = true`, `returnTypeName = void`, owned by that type, position = the compilation unit |
| statements | ordinary `cs_expression` / `cs_block` rows owned by that method — so a call in a top-level statement has a real `callerMethodLinkHash` |
| a top-level local function | `methodKind = LOCAL_FUNCTION`, contained by `<Main>$`, exactly as Roslyn reports |

Both are **enum/set widenings**, so no column changes and no reorder.

> **The consequence that touches the primary key, and it is not obvious.** A user-written
> `public partial class Program { }` — the standard ASP.NET pattern for making the entry point
> visible to tests — **merges with the synthesised one.** Measured: `DeclaringSyntaxReferences`
> is **2**, one `CompilationUnit` and one `ClassDeclaration`, and the user's member is visible
> on the merged type.
>
> So the synthesised row must carry **the same `declarationGroupKey`** as a user-written
> `Program` at global scope — `md5(NS: ‖ Program ‖ 0)` — and it must be emitted with
> **`isPartial = true` even though no `partial` keyword exists anywhere in its syntax.**
> Otherwise a gate asserting "only partial types have multi-part groups" fails on correct
> output, which is the §2.1 shape again: a reasonable-looking assertion that the language
> falsifies.

### 4.0.5 `CsReferencedEntityKind` gains FIELD, PROPERTY, EVENT — CONFIRMED — RULING (v1.8)

**Confirmed, and consistency requires it.** A bare name matched against the **members the
enclosing type declares in this file** is one lookup in one file — the *same* fact class as
`METHOD_GROUP`, which I already confirmed on exactly that reasoning and which took a
shape-only 2,080 rows down to 1. Refusing it here while allowing it there would be
inconsistent, and 1.25 M references are `UNKNOWN` where the answer is in the same file.

It is **IR completeness, not resolution**: the parser is not resolving a name to a
declaration in another file, and the engine still does all the cross-file work.

**Four conditions, and the first two are what keep it on the right side of the line.**

**1. Lookup order is C#'s own, and a nearer binding wins.** `local` → `parameter` →
member declared on the enclosing type **in this file**. If a local or parameter of that name is
in scope, the reference is **not** a field, property or event. cs-impl already tracks locals and
`cs_variable` records them, so the precedence is implementable rather than aspirational.

**2. Inherited members and other-file partial parts stay `UNKNOWN`.** A bare name may be
declared on a base type, or on another `partial` part of the same type in a different file.
Neither is same-file one-hop: the first needs the base type resolved, the second crosses a file
boundary even though `declarationGroupKey` identifies the group. **Both must stay `UNKNOWN`.**
That under-approximates, which is the safe direction — §3's rule is that failing toward *invented*
edges is worse than failing toward missing ones.

**3. Bare names only.** `this.Foo` and `x.Foo` are member accesses whose answer depends on the
**receiver's type**, which is resolution. This ruling covers the name with no qualifier, and
nothing else — the same boundary that made `METHOD_GROUP` legitimate and
`INSTANCE_METHOD_GROUP` a reservation.

**4. The three kinds are exactly distinguishable, so none of this is a guess.** `cs_field`,
`cs_property` and `cs_event` are three relations, and C# forbids a type declaring two members of
the same name across them. A same-file lookup therefore returns one kind or none — there is no
tie to break and no priority order to invent.

**Gate, and it guards the over-classification direction.** This ruling moves rows *out* of
`UNKNOWN`, so its risk is the mirror of `METHOD_GROUP`'s: classifying too much rather than too
little. Assert that **no reference is classified `FIELD`, `PROPERTY` or `EVENT` when a local or
parameter of that name is in scope at that position**, with a fixture where a local shadows a
field of the same name — the case that must come back `LOCAL_VARIABLE`. And report the
before/after `UNKNOWN` count with a sample, as was done for `METHOD_GROUP`.

### 4.0.4 Grammar fork review — APPROVED, with three integration consequences — RULING (v1.6)

Reviewed as a **schema-adjacent change**, not a bug fix: a fork patch alters what *every*
consumer parses, so its consequences land on keys and columns rather than on one extractor.

**The six rules are approved.** Each fixes a shape upstream mis-recovers, each is documented in
the patch at the point of change, each has a grammar-gate probe, and 0 of 6,035 measured files
broke. Four of them fix defects in the **worst** class — not a missing row but a **wrong value in
a primary-key component, or a lost call edge**:

| rule | what upstream did | why it is schema-adjacent |
|---|---|---|
| `_base_list` accepting `preproc_if_in_base_list` | displaced the class **name** into an `ERROR` and took the directive's symbol as the name | `name` is in **`cs_type`'s primary key** |
| `preproc_if_in_function_body` / `_in_property_body` | recovered a property with an `ERROR` child and **a method named by the next keyword** | `name` is in **`cs_method`'s primary key** |
| `variable_declaration` split on `implicit_type` + `invocation_expression` as an lvalue | parsed `Local(x) = value` as a *declaration of type `Local`*, and **the call vanished** | a **lost call edge** — IR completeness |
| `constant_pattern` restricted to arithmetic/shift | `x is null && P(x)` parsed as `x is (null && P(x))`, **swallowing the right operand** | corrupted expression structure |
| `slice_pattern` | `[var head, .. var tail]` was a parse error whose recovery could swallow the enclosing switch | lost `cs_variable` rows + truncation |

**Three consequences that are mine to state, because they change the schema rather than the
parser.**

**1. `grammarRegime` MUST change, and it is in a primary key.** `cs_module`'s key carries
`grammarRegime`, currently `ts-cs-0.23.5-abi14-async1`. That token no longer describes this
grammar — it has six more rules. **Leave it and two different grammars produce the same module
hash**, so a golden blessed under one silently validates the other, and the fork's whole point
(different trees for the same bytes) becomes invisible. Bump to **`ts-cs-0.23.5-abi14-fork6`**.
This is the reason a fork patch is reviewed here and not merged as a fix.

**2. `variable_declarator` now has TWO TREE SHAPES — it belongs in `shapeVariants` (§5.1).**
From the fork's own `node-types.json`:

```
variable_declarator   fields: ['name']   children: [bracketed_argument_list, expression, tuple_pattern]
```

For `var (a, b) = e` the `tuple_pattern` **replaces** the name, so **`childForFieldName('name')`
returns `null`** — the same null-field-lookup that produced "0 primary constructors in a .NET 8
reference app". A `cs_variable` row built from the `name` field alone gets an empty name and a
`deconstructionIndex` that never fires. Added to the allowlist.

**3. `class_declaration` can now hold a `preproc_if` where a `base_list` was**, so
`cs_type_heritage` must descend through an aliased `preproc_if` **and apply branch selection
there**. Consequence for §3.3's position rule: **`position` is computed over the SELECTED entries
only, per emission.** `class C : A` `#if X` `, IB` `#endif` has `IB` at position 1 in one
emission and absent in another — which is correct under option 3 and would be incoherent under
option 1.

**And one measurement note, in the safe direction.** My 3.01% error rate and 99.63% declaration
recovery were measured with the **async patch only**. The fork fixes four further defect classes,
so both should improve. **They are now a floor, not a current reading**, and should be
re-measured under `fork6` before either is quoted again.

### 4.1 `CsMethodModifier.REQUIRED` is removed — RULING (v1.2)

`required` is legal **only on a property or a field**, so it can never appear in
`cs_method.methodModifiers`. It is carried as a boolean on both owners — `cs_property.isRequired`
(218 sites, already emitted and gated) and **`cs_field.isRequired`**, now that §3.10 has a list.
Removing it from the enum is correct; giving `cs_property` a modifier set would add a column to
a relation cs-impl is already emitting, for no information gain.

`VOLATILE`, `CONST` and `FIXED` were unreachable for a different reason — they are **field**
modifiers and `cs_field` had no column list. **§3.10's `fieldModifiers` makes all three
reachable.** They come off the reserved list; their zero-row assertions are replaced by
non-zero expectations, which is the outcome the audit exists to produce.

---

## 4A. Day-one gates

### 4A.0 A new check's first GREEN deserves more suspicion than its first red

Three instruments of mine have now failed against **themselves** on their first real run:

| check | what its first run found |
|---|---|
| `--assert-all-buckets` on the candidate classifier | my **detector** was wrong, twice — `GetTypeInfo` returns nothing where `GetSymbolInfo` answers |
| `check-append-only.sh` | my **signal** was wrong — author *count* cannot distinguish "nobody has written here yet" from "someone's rows were destroyed" |
| the fork8 injectivity audit | my **scope** was wrong — `identifier` is a token, and the enclosing construct varies by definition |

The established rule is that a new check's first red is more likely the check than the tree. The
**inversion** is the part nobody writes down:

> **A fresh check that comes back GREEN immediately has either found a clean tree, or has been
> built unable to see. Those are indistinguishable from the result alone — and the base rate says
> the second is common.**

So a first green is *weaker* evidence than a first red, not stronger. A first red hands you
something to examine; a first green hands you nothing, and the temptation is to bank it.

**Mine have never come back green first.** Every one of the three had to be corrected before it
said anything true. That is the base rate this rule is drawn from, and it is why every check in
this schema carries a negative control that runs in the same pass — not to prove the check works
once, but because a check without one is a claim about a tree that may be a claim about nothing.

### 4A.1 Grammar-field existence — the gate that was missing ★

**Every `(node type, accessor, name)` the extractor reads must exist in the grammar's own
`src/node-types.json`.** Checked before any row is produced.

This is the gate behind the phase's worst defect. `childForFieldName('parameters')` is
**correct** on `method_declaration` — a real field — and **silently null** on
`class_declaration`, where the parameter list is a *child*, not a field. The call site looks
identical; the failure is a `null`; the consequence was **0 primary constructors in a .NET 8
reference app** and **173 generic types against 19,567 classes**. Both were caught by
implausibility, not by a test, which is luck and does not scale.

It is the structural counterpart of the TypeScript recall probe, which reported 99.8–100%
across eleven corpora while being *incapable* of seeing that 31% of calls were missing. The
probe measured something real; it just could not see the thing it claimed to measure. This
gate asserts the instrument can see the thing **before** any number exists.

Prototyped and demonstrated to fail on purpose:

```
SCHEMA READS: 14 reads, 0 invalid

NEGATIVE CONTROL (the bug as written): 2 reads, 2 invalid
   class_declaration.field(parameters)      -> not a field; children include: … parameter_list …
   class_declaration.field(type_parameters) -> not a field; children include: … type_parameter_list …
```

It names the fix as well as the fault.

**It also earned its keep on first run**, against the committed artifact, by catching a
second instance of the same class: **the grammar is inconsistent across sibling type
declarations.** `interface_declaration` binds `type_parameters` as a *field*;
`class_declaration`, `struct_declaration` and `record_declaration` do not — for those the
list is only a child of type `type_parameter_list`. So the same accessor is right for
interfaces and silently null for the other three. **Arity is in `cs_type`'s primary key**, so
that would fork the identity of every generic class. `cs-impl` must read arity as a **child**,
uniformly.

(The first run also produced one false positive, now fixed: `node-types.json` *partitions*
into fields and children, but the tree exposes a field-bound node as a named child too, so a
`child` read is satisfied by either.)

Artifact:
`src/test/csharp-gates/grammar-field-reads.json` — the declared read-set — checked against
the vendored grammar's `node-types.json`, so a grammar bump that renames a field is a **named
gate failure** rather than a column that quietly goes empty.

### 4A.2 Accessor 1:1 — the doubling trap ★

`cs_property` **and** `cs_method` both describe the same getter, by design: IL has accessors
as methods and the call graph needs them as targets. But §2 of `BUILDING-A-PARSER.md` is
explicit that **duplicates DOUBLE, they do not collide** — a member reached by two visit
paths produced an identical PK and the row count silently doubled.

**Measured, and the scale is why this cannot be left implicit:**

| | count |
|---|---|
| declared accessors (`get` 33,694 · `set` 26,320 · `init` 635 · `add` 67 · `remove` 67) | **60,783** |
| of those, auto (no body) | 55,449 |
| of those, with a body | 5,334 |
| expression-bodied properties (implicit `get`) | 5,666 |
| **`cs_method` rows contributed by accessors** | **66,449** |
| method declarations in the corpus | 97,113 |

**That is a 68% inflation of `cs_method`.** Any count of methods that does not filter
`isAccessor` is wrong by two thirds and says nothing about it — which is exactly the
condition's point.

The gate asserts, per type:

1. every declared accessor has **exactly one** `cs_method` row — no more, no fewer;
2. every `cs_method` row with `isAccessor = true` has a **non-empty** `ownerMemberLinkHash`
   resolving to a `cs_property` or `cs_event` **in the same file**, and `isAccessor = false`
   rows have it empty;
3. `methodKind` is one of the accessor kinds **iff** `isAccessor` is true.

Auto-accessors (55,449 of 60,783) still get rows: they have no body but they are call
targets.

---

## 4A.2 The integration worktree carries a marker — RULING (v1.10)

The rule I wrote was *"`c-sharp` is checked out only during a merge, by me, and never left — if
`../wt/cs-integration` exists, either a merge is in progress or I left a mess."* **cs-fixtures hit
that the same day and correctly reported it rather than touching it**, noting it could not tell
which from outside.

It could not, and that was a defect in my rule: it named an ambiguity instead of removing one.
This time the directory was a **live merge** and completed normally.

**Fixed:** the worktree carries `MERGE-IN-PROGRESS` at its root, written when it is created and
removed with it:

```
owner:   cs-oracle
started: 2026-09-13T21:47:32Z
branch:  c-sharp
purpose: schema v1.10 — …
```

So an observer can now decide from outside:

| what you see | what it means |
|---|---|
| no directory | nothing in progress — the normal state |
| directory **with** a recent marker | a merge is live; wait, do not touch |
| directory **without** a marker, or with a stale one | **left behind** — say so, and it is safe to remove |

A rule that tells the reader "I can't tell you which" is half a rule. The marker costs four lines
and converts the ambiguity into a fact.

## 4A.3 Sequencing a regime bump — fork8 — RULING (v1.10)

`grammarRegime` is in `cs_module`'s **primary key**, so a bump moves **every module hash, and
therefore every child hash in every relation**. A sweep run across a bump reads a total
fact-base change as a defect population — the largest possible false positive, and it arrives
looking like catastrophe rather than like a rename.

**The order is not negotiable, and each step must complete before the next begins:**

| # | step | owner | done when |
|---|---|---|---|
| 1 | land the two grammar rules and bump `grammarRegime` to `fork8` — **in one commit** | cs-impl | `FROZEN_GRAMMAR_REGIME` in `csharp-tests.ts` equals the parser's constant |
| 2 | re-run the **grammar-field-reads** gate against the new `node-types.json` | cs-impl | green, or a named field change |
| 3 | re-run the **injectivity audit + `shapeVariants`** against the new grammar | cs-oracle | green, or a new allowlist entry with its disambiguator |
| 4 | **re-bless every golden** through the oracle under `fork8` | cs-oracle | every expectation's provenance reads `fork8` |
| 5 | **only then** sweep | cs-corpus | — |

**Why step 1 is one commit.** If the rules land and the regime bumps separately, there is a
commit where the grammar produces `fork8` trees while the module hash still says `fork6`. Any
golden blessed there is attributed to a grammar that never produced it — and that is
*unattributable*, which is worse than absent.

**Why step 3 is mine and comes before step 4.** A new grammar rule can make an existing node
type carry a second meaning — which is exactly what `element_binding_expression` did and what the
allowlist exists to name. Blessing goldens over an unaudited grammar freezes a
misclassification as intended.

**What cs-corpus should expect at step 5**, pre-registered so it is not read as movement:

- **every** `cs_*UniqueHash` changes. That is the bump, not drift. A diff of hashes is not a diff
  of facts.
- **row counts should be unchanged** except where the two new rules parse something previously
  unparseable. **That delta is the only real signal in the sweep**, and it should be small and
  attributable to the two rules by name.
- `cs_parse_gap` should **fall** by whatever the two rules fix, and by nothing else.

**If a row count moves anywhere the two rules do not reach, that is a defect** — and it is
findable precisely *because* everything else was pre-registered as expected to move.

## 4B. Stored expectations — YES, and the hole they fill — RULING (v1.9)

> ### RETRACTION (v1.9.1) — v1.9's premise was FALSE, and I mis-measured it
>
> v1.9 said *"`src/test/csharp-tests.ts` does not exist"* and *"C# has 0 stored expectations"*.
> **Both are wrong.** cs-impl built it at `d900fd3`, it is **7,716 lines**, and it was present at
> the very commit I measured.
>
> **How I got it wrong:** I ran
> `git ls-tree -r --name-only c-sharp -- src/test | grep -iE "csharp" | head -20`. The
> `csharp-gates/tree-sitter-c-sharp/*` entries sort first and filled all twenty lines, so `head`
> truncated the output *before* reaching `csharp-tests.ts`. **I read absence-from-output as
> absence-from-tree** — §7's "absence of a match is not absence of the thing", with `head` as the
> mechanism. Running the same command unpiped shows the file immediately.
>
> **What is actually true**, measured properly:
>
> | v1.9 claimed | actually |
> |---|---|
> | the in-repo gate does not exist | it exists, 7,716 lines, with a negative control per check |
> | it blocks seven-point-bar item 2 | **item 2 is MET** — the gate exists and can fail |
> | `grammarRegime` provenance is missing | **frozen** as `FROZEN_GRAMMAR_REGIME = 'ts-cs-0.23.5-abi14-fork6'` |
> | classification drift is unseen | **partly covered** — `callKind` is asserted at specific sites, e.g. `BASE_CONSTRUCTOR_CALL` owned by its primary constructor |
>
> **What remains, and it is smaller and elsewhere than v1.9 said:**
>
> 1. **No `bless.ts` for C#.** JavaScript has one; the C# oracle has `harness/`, `oracle/` and
>    `self-test/` and no stored-claim layer at all. There is nothing that records **which
>    relations the oracle can adjudicate** versus which it cannot.
> 2. **`targetFramework` and `defineConstantsKey` are not frozen** anywhere, so an expectation
>    does not say which program it describes — the one C#-specific bar item that is genuinely open.
> 3. **The three states are unrepresented.** The suite is invariant-based, which is a different
>    thing from claim-based: it asserts *properties that must hold*, not *answers the oracle
>    authorised*.
>
> So the ruling **stands in substance and moves in location**: the work is a `bless.ts` on the
> **oracle** side, not a rewrite of `csharp-tests.ts`. And the bar's emphasis changes — what must
> be demonstrated is that blessing can **REFUSE**, because *a bless that cannot return `REFUSED`
> looks identical to one that agrees.*

**Ruled: C# gets stored expectations** — as a claims layer in the oracle, per the retraction above.

### Why the gates do not already cover it

Every C# gate is an **invariant check** — a property re-derived each run. None stores an
adjudicated answer about specific source. So consider an extractor change that emits
`METHOD_CALL` where it used to emit `CONSTRUCTOR_CALL` at a known site, with both values legal:

| gate | does it catch that? |
|---|---|
| PK uniqueness / FK integrity | no — the row is well-formed |
| arity contract | no — the column count is unchanged |
| enum-emission audit | no — both values are emitted somewhere |
| node-type injectivity | **no** — that catches *grammar*-level kind confusion, not *extractor*-level classification drift |
| determinism | no — it is deterministic, just different |
| derived-column sweep | no — the column is still derived and still asserted |

That is §4's lesson stated as a hole: **a correctly-positioned row with the wrong kind is
invisible to every count-based check we have.** The injectivity gate closed the half of it that
the grammar causes. Stored expectations close the half the extractor causes, and nothing else
does.

### Why Java having none does not settle it

Java is the most mature front end here and carries no stored expectations, so "no" was
available. It is rejected for one reason: **Java is evidence that you can ship without them, not
that they are unnecessary.** Java's maturity comes from corpus exposure, and the documented cost
is `referencedTypeRegistryLinkHash` at **0 populated rows out of 67,938** — a fact that stood
unnoticed long enough to become the design. A claims layer is precisely what surfaces "this has
been empty the whole time".

### The bar, adopting JavaScript's three states

> **Every relation whose content Roslyn independently answers carries an oracle-backed claim.
> Every relation it cannot adjudicate is either frozen as drift-only with the reason recorded,
> or refused with the reason recorded. No relation is silently absent.**

| state | when | C# examples |
|---|---|---|
| **oracle-backed** | Roslyn answers it independently | call target and overload choice (`candidates`), declaration count for partials (`DeclaringSyntaxReferences`), `_` as local vs discard, the top-level entry point's owner, source-vs-metadata symbol kind |
| **drift-only** | **our** vocabulary, which Roslyn has no opinion on, but which must not change silently | `cs_expression.kind`, `edgeRole`, `rootContext`, `CsCallKind`'s split, `declarationScopeKey`'s shape — frozen so a reclassification is a named failure |
| **refused** | the value legitimately varies with the environment | `defineConstantsKey` when supplied as an input, absolute paths, `serviceVersionLinkHash`, anything timing-derived |

**Two C#-specific requirements the JavaScript model does not need.**

1. **Every stored expectation names the `targetFramework` and `defineConstantsKey` it was
   blessed under.** Under option 3 the same file legitimately produces different rows per
   framework, so an unqualified expectation is not merely fragile — it is **ambiguous about
   which program it describes.**
2. **`grammarRegime` is part of an expectation's provenance.** A grammar bump changes trees for
   the same bytes, which is the entire reason the fork required a regime bump. It is already in
   `cs_module`'s primary key, so it is carried — but a blessing taken under `fork6` must not be
   read as validating a later regime.

### Scope, and what it is not

`src/test/csharp-tests.ts` runs **no `dotnet`, no compilation, no network** — it compares against
frozen expectations and nothing else. The oracle in `../parser-oracle/csharp/` **authorises**
them; the in-repo gate only **detects drift**. A suite that can re-bless itself has a failure
mode indistinguishable from success, which is why those live in different repositories.

**Owner: me.** It is **not** blocking cs-impl, and — per the retraction — **not** blocking
seven-point-bar item 2 either, which `csharp-tests.ts` already satisfies. It is the claims layer
that is missing, and its bar is that **blessing can refuse**.

---

## 5. The injectivity allowlist — a named artifact

`src/test/csharp-gates/node-type-injectivity.allowlist.json`. Every grammar node type we
consume maps to exactly one Roslyn `SyntaxKind`, or it is listed here with its disambiguator.

| node type | meanings | disambiguator | status |
|---|---|---|---|
| `collection_element` | `ExpressionElement` \| `SpreadElement` | child is `..expr` → spread | **live** |
| `element_binding_expression` | `CollectionExpression` \| `ElementBindingExpression` | parent is `conditional_access_expression` → index | **resolved; zero-row assertion** |

A grammar bump that changes either is a **named gate failure**, never a silent
reclassification. This is the inverse of the enum-emission audit — one node type carrying two
meanings, rather than one declared value never emitted.

### 5.1 `shapeVariants` — the allowlist's mirror image — RULING (v1.2)

**Yes, cs-impl's three cases belong here.** The allowlist above covers *one node type with two
meanings*; these are *one construct with two tree shapes*. Same failure mode, opposite
direction: **none loses a row, all three corrupt a column, and no count can find any of them.**

| construct | the two shapes | what breaks if only one is handled |
|---|---|---|
| primary-constructor base invocation | `class P(int a) : Base(a)` is **flat**; `record R(int X) : Parent(X)` is **wrapped** in `primary_constructor_base_type` | `baseTypeName` becomes `"Parent(X)"` — a name no `using` scope resolves — and the invocation is lost |
| `params` parameter | `params object[] a` is wrapped in a `parameter`; **`params int[] d` is not** — it is flat siblings of `parameter_list`, which declares name and type as fields on *itself* | **the parameter is dropped entirely.** `params` is in `string.Format`, every logging call, most assertion helpers |
| `scoped` | `scoped Span<int> f` wraps the type in `scoped_type`; `scoped ref int g` emits a `modifier` | `isScoped` false — a **lifetime** constraint lost, so a `ref struct` appears free to escape — and `completeTypeName` becomes `"scoped System.Span<int>"` |

**Gate:** each variant's fixture must exercise **both** shapes and the emitted columns must
agree. A fixture covering one shape passes while the other corrupts a column silently — which
is exactly how all three survived a 9,607-file corpus.

---

## 6. What does not port

| Java / TypeScript | C# | why |
|---|---|---|
| `referencedTypeRegistryLinkHash` | **dropped** | 0 of 67,938 by design; Roslyn could fill it, which is precisely the argument against |
| `java_type_reference.wildcardVariance` | **moved** to `cs_type_parameter.varianceModifier` | use-site vs declaration-site variance |
| `JavaHeritageKind` extends/implements split | **collapsed** to `BASE_OR_INTERFACE` | C# syntax does not distinguish them |
| `ts_type.mergeScopeKey` (6 shapes) | **simplified** to `declarationScopeKey` | C# merging is syntactic and local |
| `methodReferenceKind` parity slot (always `""` in TS) | **filled** | C# method groups are real |
| Java annotations (inert metadata) | `cs_attribute` — same shape | closest port in the set |

---

## 7. Tier 3 — authored, not derivable

1. **`grammarRegime` token value** — coarse by choice, like `emissionRegime`.
2. **`isQueryDesugarCandidate`** — a hint, not a claim. May be dropped before freeze.
3. **`gapKind` thresholds** (5% / 50%) — validated against Roslyn at 98.0 / 50.6 / 22.7%
   declaration recovery, but the cut points are chosen.

---

## 8. What I need approved

1. **Column order of all 22 relations** — the contract.
2. **§2.1 `cs_type`'s primary key**, and that a **single-part partial group is normal** (76.5%).
3. **§2.2** `targetFramework` + `defineConstantsKey` in `cs_module`'s key, defines as an input.
4. **§2.4** `cs_property` / `cs_event` as their own relations, accessors *also* as `cs_method`.
5. **§2.5** LINQ emits clauses, never synthesized calls.
6. **§3.3** heritage does not distinguish base from interface.
7. **§3.5** no `referencedTypeRegistryLinkHash`, and no resolved-link column anywhere.

### v1.1 additions, per the four conditions

8. **§3.3** heritage emits `INTERFACE` / `ENUM_UNDERLYING_TYPE` where the language decides —
   30.1% of entries — and reserves `BASE_OR_INTERFACE` for the 69.9% that cannot be known.
9. **§3.6** `cs_method.isAccessor` (35 columns) with a required `ownerMemberLinkHash`.
10. **§2.2** `defineConstantsKey` is deduplicated and ordinal-sorted before hashing.
11. **§4A** two day-one gates: grammar-field existence, and accessor 1:1.

---

**Stopping here.** No `gen_decls.py`, no `.dl`, no parser source until this is signed off.
