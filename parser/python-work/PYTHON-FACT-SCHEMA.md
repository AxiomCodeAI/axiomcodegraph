# Python fact-table schema — proposal v7 (for approval)

**Author:** A0 (oracle)  **Status:** PROPOSED — not approved, nothing built against it
**Scope:** the base-relation contract between the Python parser and the Souffle engine.
**19 relation pairs, 425 columns** — of which a **10-relation / 266-column spine** is what
I recommend freezing first (§10). Declarations are **generated from this document** by
`gen_decls.py`; run `gen_decls.py --check` in CI.

Nothing in `src/` has been written. This document is the thing to approve. Once approved
it becomes frozen: a later column reorder invalidates every golden file, every projection,
and every `decls_base.dl` edit.

**Changes in v7** — three simplifications, all from the human pushing back on relations
I had over-engineered:
- **`py_field_write` DELETED.** Every column was already on `py_expression` (verified
  against real parser output); the only addition was a join key, and that join belongs in
  the resolution layer. −1 relation, −10 columns, no lost facts.
- **`py_type_inference` DELETED**, folded into 4 appended `py_expression` columns. A union
  is a property of a *binding*, not an expression — every parser-side inference is 1:1
  with one node, so the 1:N justification was wrong. −1 relation, −13 columns.
  **`py_expression` 35 → 39: this touches a frozen spine relation and needs sign-off.**
- **`py_decorator` restated as Java's annotation relation** — same slot, same columns,
  shared `annotation_on` projection. Nothing changed but the doc was unclear.

**19 relations / 425 columns.** Spine 10 / 266.

**Changes in v6** — two human decisions:
- **Target 3.10.4 CONFIRMED, not inverted.** Rationale recorded: 3.0–3.11 is the richer regime,
  so emission there and gating off for 3.12 is subtractive; the reverse leaves the path
  unexercised. Independent of the corpus, so the corpus question no longer gates the freeze.
- **Python 2 REVERTED — Python 3 only, tree-sitter as the single front end** (§6). Removed 3
  spine columns (`hasFutureAbsoluteImport`, `hasExecStatement`, `parentParameterLinkHash`) and
  13 enum values; kept `futureImports`, `typeCommentPayload` and `isTypeCommentDerived`, which
  are Python 3 concerns and were mislabelled as Py2-only. **Spine 265 → 262 columns.**
- **New safety requirement (§6.2):** tree-sitter parses Py2 *without erroring*, so Python-3-only
  needs an explicit **rejection** path — detect Py2-only node types, emit no facts, record why.
  Absence of support is not the same as rejection.
- Coordination log: 3 falsified rows **retracted**, 4 stale rows superseded, 0 left open.
- `HANDOFF-parser-core-32k.md` — the 32,767-char limit written up for an owner outside this fleet.

**Changes in v5** — I tested a claim I had only asserted, and it was wrong:
- **§6.2(a) RETRACTED.** `tree-sitter-python@0.21.0` parses Python 2 natively — first-class
  `print_statement`, `chevron`, `exec_statement`, comma-`except_clause`, `tuple_pattern` params.
  **99.59% of the filtered CPython 2.7 stdlib parses clean.** 7 of the 8 constructs I said it
  could not handle, it handles.
- **Source rewriter CANCELLED.** It was justified entirely by that wrong list. The residual is
  one construct (`exec <complex expr>`, 5 files, 0.41%); backtick-repr occurs **zero** times in
  the 2.7 stdlib. `py_source_bridge_edit` → **`py_parse_gap`**: record the gap, never rewrite
  source, positions stay measured.
- **Q11 DISSOLVED.** `tree-sitter-python@0.21.0` peers `tree-sitter ^0.21.0`; our `^0.21.1`
  satisfies it. No core bump, no Java/Groovy rebuild.
- **§6.3 added** — direct answer on assuming Python 3 only.
- pyenv 2.7.18 keeps its place, as the **symtable oracle**, not as a parsing workaround.
  *(Superseded in v6: Python 2 reverted entirely — the 2.7 oracle is no longer used. §6.)*

**Changes in v4**, from review:
- **`emissionRegime` + `targetVersion` added to `py_module`** and put in its PK. v3's §4.4 was
  driven by a "target version" no column recorded, so 3.10 and 3.12 fact sets were structurally
  different but indistinguishable from inside the fact table.
- **`__all__` added** (`hasDunderAll` / `dunderAllIsStatic` / `dunderAllNames`) — absent from v3
  entirely, and Q9's re-export resolution depends on it. 2/65 are dynamically built, hence the flag.
- **Target set decided:** 3.10.4 exactly, sole Py3 target for the spine freeze; version axis in
  the harness from day one. One question surfaced back to you (see §9).
- **Q7/Q9/Q12 recorded as decisions**, Q7 on syntactic-fact grounds rather than row count.

**Changes in v3**, from review:
- **`py_scope` / `py_method` PK collisions fixed** — `startColumn` added to both keys (§2.2,
  §2.7). Reproduced on 3.10.4; 0.60% of scopes affected; it silently merged binding sets.
- **§4.4 comprehension matrix corrected** — Py2 is three behaviours, not one: set/dict comps
  *do* get scopes, with a second synthetic binding `_[1]` that v2 never mentioned.
- **`.0` whitelist count corrected** — ~2,056 on a 3.10 target, not 673.
- **Q1 retracted** — my "no 3.10 on this machine" was measured from a conda shell; 3.10.4 is
  what `python3` actually resolves to. Downgraded to an interpreter-pinning requirement.
- **§2.21 inference tightened** — parser emits only purely syntactic evidence; the rest is the
  engine's.
- **Q5 withdrawn** — already decided by frozen column positions; restated as a decision.
- **`decls_base_py.dl` is now generated from this doc** and CI-checked (§Appendix A).
- **§10 added** — recommend freezing the 10-relation spine first.

**Changes in v2**, from your answers:
- **Q4/Q8** — relations renamed `java_py_*` → **`py_*`** (one prefix per core language);
  `lib_py_*` is populated by the **engine**, not the parser (§1).
- **Q3** — *(SUPERSEDED in v6: Python 2 was subsequently reverted — see §6.)* One unified
  schema for Python 2 and Python 3; dialect as a column rather than a separate relation set.
- **Q6** — **type inference added** as a new `py_type_inference` relation (§2.21), because a
  union is 1:N. Literals, collection literals, constructor calls, casts and `isinstance`
  guards are inferred by the parser with an explicit `evidence` + `confidence` ladder.
- **Q10** — **§0.5 added**: what the IR is for, the five-layer approach, where the
  verifiability boundary sits, and the build order.
- **Q2 — done, not just approved**: CPython **2.7.18 installed and verified**. It immediately
  produced a schema-relevant finding (§4.4) that changes how the harness must work.

---

## 0. How I arrived at this

I did not design this from the Java schema outward. I measured a real corpus first, because
the Java relations encode Java's assumptions (declared types everywhere, single inheritance,
no module-level code) and Python violates all three.

Corpus: SQLAlchemy, Scrapy, Flask, Django, IPython, `_pytest`, tornado, requests, boto3,
botocore — **959 files, 4,043 classes, 20,301 functions, 66,677 call sites**, parsed with
CPython's own `ast`. Raw scripts in `/tmp/pyscan/` (throwaway; not deliverables).

The numbers that drove the design:

| Measurement | Value | Consequence for the schema |
|---|---|---|
| Parameters with **no** type annotation | **68.2%** (30,745 / 45,092) | Declared-type receiver typing — Java's primary mechanism — covers under a third of Python. Argument→parameter flow must be the primary mechanism, so call sites must carry enough to link args to params **by keyword as well as position**. |
| Naive name-based CHA candidates per attribute call | **24.63 avg**, 1.22M candidate edges over 49k call sites | Polymorphism reduction is the whole game. 21% of call sites have >10 candidate classes. |
| Attribute calls whose name is defined by **exactly one** class | **24.9%** | Free precision from name-only lookup. Worth a dedicated path. |
| Attribute calls whose name is defined by **zero** classes | **24.0%** | Module functions / stdlib / dict access. Must not be silently dropped — needs module+import resolution, not class resolution. |
| Receiver is a **bare name** (`x.foo()`) | **50.7%** of attribute calls (20,040) | Binding/scope resolution is the single highest-value mechanism. `py_scope` + `py_binding` are the spine, not an auxiliary. |
| Receiver is `self` | **19.6%** (7,753) | Requires the attribute table, which requires solving `self.x` with no declaration site. |
| Receiver is an attribute chain (`self.repo.get()`) | **18.8%** (7,418) | Field-type → method lookup, depth 2. |
| Receiver is a call result | **7.3%** (2,886), of which **28% are `super()`** | Return-type flow; and `super()` needs a real C3 MRO. |
| Attribute chain depth | 83% depth-1, 16% depth-2, 99.98% ≤ depth-3 | Chain walk can be depth-capped at 5, like Java's. |
| Classes with multiple inheritance | **12.1%** (404) | MRO / C3 linearization is not optional. `py_type_base.position` is load-bearing. |
| `self.x = ...` writes | 7,124 — **only 67% in `__init__`** | An attribute is a *set of writes across methods*, not a declaration. Drives the `py_field` identity decision (§4.1). |
| `isinstance(...)` sites | **2,123** | The main type-narrowing lever. Drove adding `conditionExpressionLinkHash` to `py_block`. |
| Keyword arguments at call sites | **12,000** | Drove adding `argumentKeywordName` to `py_expression`. Positional linking alone loses these. |
| Relative imports | **38%** of from-imports (5,973) | `relativeLevel` and parser-side module resolution are mandatory. |
| Module-level executable statements | 3,006 across 826 files (3.6/file) | Synthetic `<module>` method is mandatory (§4.2). |
| Decorated functions | **22%** (4,503); `@property` 1,014, `@overload` 567 | Decorators *replace* the object. `@property` turns an attribute read into a call. |
| `__getattr__` / `__getattribute__` classes | 72 of 4,043 = **1.8%** | Escape hatches are rarer than feared. Mark them; don't redesign around them. |
| `import *` | 22 sites | Rare. Mark as a soundness hole; don't expand. |
| Classes with no explicit base | **19.5%** (638) | Implicit `object`, trivial MRO — distinguishable from a real C3 linearisation, hence `mroKind`. |

Two things I found that would have silently corrupted every golden file — see §9, they are
the first things you need to rule on.

---

## 0.5 What the IR is for, and the approach  *(answering Q10)*

### Purpose

The IR is **not an AST dump**. Its purpose is narrow and worth stating precisely:

> A flat, positional fact base over which Datalog can compute a **sound call graph, then
> narrow it**, and over which information flow can be traced by joins alone — never by
> re-parsing, re-deriving names, or matching text.

Everything in the schema is justified by that sentence or it should not be there. Three
things follow from it directly.

**1. The IR must make the 24.63-candidate problem tractable.** Naive name-based dispatch
gives 1.22M candidate edges over 49k call sites. The IR's job is to carry exactly the facts
that collapse that number: the binding a name resolves to, the scope chain to walk when it
does not, the *ordered* base list for MRO, the guard that narrows a receiver, and — where
derivable — the type itself. Any column that does not participate in reducing or explaining
that fan-out is dead weight.

**2. The IR must be honest about what it does not know.** Python is not statically typed and
68.2% of parameters carry no annotation. An IR that papers over this produces a call graph
that looks precise and is wrong — the worst outcome, because nobody notices. So imprecision
is **first-class data**: `argFlowIsPrecise`, `isArgsKwargsPassthrough`, `receiverKind=UNKNOWN`,
`resolvedCalleeKind=UNRESOLVED`, `confidence`, `usesWildcardImport`, `HAS_GETATTR`. The engine can
then report "unresolvable by construction" instead of silently emitting nothing.

**3. The IR must be exactly verifiable where it claims certainty.** This is what makes the
oracle possible at all. Every fact the parser emits is either something CPython can confirm
(`symtable` for scopes and bindings, `ast` for structure) or is explicitly marked as an
inference with a `confidence` level. There is no third category.

### Approach: five layers, with the verifiability boundary drawn between 3 and 4

| Layer | Produced by | Content | Oracle-verifiable? |
|---|---|---|---|
| **0 — Syntax** | tree-sitter | spans, node kinds, tree shape → `py_expression`, `py_block`, `py_comment` | **yes**, against `ast` |
| **1 — Scope & binding** | parser, mirroring CPython's algorithm | `py_scope`, `py_binding` — the scope tree and every `(scope, name)` | **yes**, against `symtable`, by set equality |
| **2 — Declarations** | parser | `py_module`, `py_type`, `py_type_base`, `py_method`, `py_method_parameter`, `py_field`, `py_import`, `py_decorator` | **yes**, against `ast` |
| **3 — Local resolution & certain inference** | parser | intra-module name→entity links; `py_type_inference` rows at `CERTAIN`/`PROBABLE` | **yes** — resolution is decidable within one module |
| **4 — Global reasoning** | **engine** | cross-module resolution, C3/MRO, call graph, argument flow, return flow, union widening, `lib_py_*` | **no** — validated by outcome, not by CPython |

**The boundary between 3 and 4 is the single most important design decision here.** The
parser stops exactly where CPython stops being able to answer. `symtable` will tell you that
`x` in this function is a local bound twice; it will not tell you what class `x` holds. So
bindings are parser work and receiver types are engine work — with the narrow exception of
inferences CPython *can* confirm (`x = 3`), which is why §2.21 has a `confidence` column
rather than being merged into the entity rows.

Put the boundary anywhere else and one of two failures follows: push inference into the
parser and the oracle can no longer validate it, so wrong facts become permanent; pull
bindings into the engine and you rebuild `symtable` in Datalog, badly.

### Why flat, positional, all-`symbol`

Not an inherited constraint — it is the right shape for this job. Souffle joins on
hash-indexed columns, so a nested or variant-typed IR would have to be flattened before any
rule could run, and the flattening would itself be unverified code between the oracle and
the engine. Positional-and-flat means a projection is a column rename (fact #4), the fact
files are diffable, and byte-identical output is achievable and checkable.

The cost is that column order is frozen on approval. That is why this document exists.

### Build order

The FK diagram in §3 ranks the four data-flow paths by measured frequency. The IR should be
built in that order, because each path is independently testable and the first two cover
70% of attribute calls:

1. **Scope + binding spine** (`py_module`, `py_scope`, `py_binding`) — unlocks the 50.7%
   bare-name receiver case and is 100% oracle-checkable, so the harness is trustworthy before
   anything harder is attempted.
2. **Declarations** (`py_type`, `py_type_base`, `py_method`, `py_method_parameter`,
   `py_import`) — unlocks `self` dispatch (19.6%) and MRO.
3. **Expressions + call sites** (`py_expression`, `py_call_site`) — unlocks chains (18.8%)
   and argument flow.
4. **Attributes + inference** (`py_field`, `py_field_write`, `py_type_inference`) — unlocks
   `self.repo.get()` and literal/constructor typing.
5. **Everything else** (`py_decorator`, `py_block`, `py_comment`, bridge/audit).

This is also my answer to Q10's scoping half: stage 1 alone is a complete, verifiable
deliverable, and it is the stage that makes the oracle an arbiter rather than a hope.

---

## 1. Naming and placement  *(decided — Q4, Q8)*

**One prefix per core language.** `java_*` is Java, `py_*` is Python, the next language takes
its own `lan_*`. The prefix names the language; `lib_` remains the external marker layered on
top of it:

```
py_<entity>       Python source under analysis     ← the parser emits ONLY these
lib_py_<entity>   external / third-party Python    ← the ENGINE populates these
```

The `X` / `lib_X` pair per entity is preserved with identical columns, so fact #2 holds and
every projection keeps its two-rule shape.

**The parser's output surface is exactly the `py_*` relations.** Per Q8, deciding what is
external is the engine's job: the engine identifies third-party methods and stages
`lib_py_*` from its own external-identification pass. The parser has no site-packages walk to
do and no `isExternal` policy to enforce. Two consequences, both simplifications:

- `py_module.isExternal` / `py_type.isExternal` are retained as **parity slots, always
  `false`** on parser output. They exist so that when the engine stages `lib_py_*` the layout
  is byte-identical — which is what fact #2 requires.
- The parser resolves imports only within the repo. `py_import.isExternalTarget` therefore
  means precisely "did not resolve to a `py_module` in this analysis" — an honest negative,
  not a claim about the outside world. The engine turns that into a real external identity.

All `lib_py_*` are declared so engine rules can reference them; per fact #3 the body
relations (`lib_py_expression`, `lib_py_call_site`, `lib_py_block`, `lib_py_binding`,
`lib_py_field_write`, `lib_py_type_inference`) are declarations-only and not expected to be
staged.

**Constants to add** (`src/constants/entity-constants.ts`), one prefix per PK:

```
PY_MODULE  PY_SCOPE  PY_BINDING  PY_TYPE  PY_TYPE_BASE  PY_TYPE_REFERENCE
PY_METHOD  PY_METHOD_PARAMETER  PY_FIELD  PY_FIELD_WRITE  PY_DECORATOR
PY_DECORATOR_ARGUMENT  PY_IMPORT  PY_EXPRESSION  PY_CALL_SITE  PY_TYPE_INFERENCE
PY_COMMENT  PY_BLOCK  PY_PARSE_GAP  PY_TYPE_PARAMETER (3.12, deferred)
```

`HASH_ALGO` stays `md5`. PKs are `PREFIX_<md5hex>` via `EntityUtils.generateEntityHash`,
components joined with `||` exactly as `FieldRegistry` / `BlockRegistry` do. All TSV values
pass through `EntityUtils.escapeTsv`.

CSV filenames follow `all-python-<plural>.csv` (`all-python-modules.csv`,
`all-python-bindings.csv`, …) plus `skipped-python-files.csv`.

### Key-chaining discipline

Following `FieldRegistry` (which builds its hash from `typeRegistryLinkHash`, never from a
re-derived qualified name), **every child key chains off its parent's hash**:

```
py_module.hash        = f(filePath, baseMservPath, qualifiedName, serviceVersionLinkHash)
py_scope.hash         = f(pyModuleLinkHash, parentScopeLinkHash, …)   ← recursive chain
py_type.hash          = f(pyModuleLinkHash, …)
py_method.hash        = f(pyModuleLinkHash, pyTypeLinkHash, …)
py_method_parameter   = f(pyMethodLinkHash, …)
py_binding.hash       = f(pyScopeLinkHash, name)
py_expression.hash    = f(pyScopeLinkHash, expressionOwnerHash, parentExpressionHash, …)
py_call_site.hash     = f(pyExpressionLinkHash)                        ← 1:1, pure chain
```

No child key is ever derived from a dotted name. A rename of an outer scope changes every
descendant hash, which is correct: they are different entities.

---

### 1.1 Cross-language naming rule

Derived from what the Java parser already does, rather than invented — it looks inconsistent
at a glance but is principled:

| layer | Java | rule |
|---|---|---|
| enum value | `TYPE_ON_DEMAND` | the **language spec's** term (JLS: "import on demand") |
| column | `isOnDemand` | the language spec's term |
| **Souffle projection** | **`import_wildcard`** | the **neutral, cross-language** term |
| doc comments | "Wildcard type import" | neutral |

So: **fact-layer names follow the language; projection-layer names are shared.** That is what
makes a rule port across languages while each fact table still reads correctly to someone who
knows that language.

Applied to Python, the two coincide — the Python Language Reference calls `from x import *` a
**wildcard** import, and Java's projection already uses that word — so there is no tradeoff:

| | Java | Python |
|---|---|---|
| enum value | `TYPE_ON_DEMAND` / `STATIC_ON_DEMAND` | `FROM_WILDCARD` / `RELATIVE_WILDCARD` |
| column c7 | `isOnDemand` | `isWildcard` *(same position, same meaning)* |
| projection | `import_wildcard` | **`import_wildcard`** — identical |

Column **names** and enum **values** are not the frozen contract; column **order** is. So this
rename costs nothing post-freeze, and `gen_decls.py --check` is unaffected (the `.dl` carries
only `c0..cN`).

Where the terms genuinely diverge, the language wins at the fact layer. Python keeps `STARRED`
/ `DOUBLE_STARRED` / `STAR_ARGUMENT` for `*args` / `**kwargs` and `EXCEPT_STAR` for `except*` —
those are Python's `*` splat and PEP 654, unrelated to wildcard imports, and renaming them to
match Java would be false parity.

---

## 2. The relations

Full ordered column lists. **Position is the contract.** New columns append only.
Every row ends `… serviceVersionLinkHash, <entityUniqueHash>`.

Where a position matches `java_*` exactly, it is marked `[J]` — those projections port as a
literal rename.

Legend: `FK→x` foreign key; `★` Python-specific, no Java analogue; `""` means empty string
is the legal "absent" value (Souffle has no nulls).

---

### 2.1 `py_module` / `lib_py_module` — 24 columns ★

A `.py` / `.pyi` file. No Java analogue: Java's package is implicit in `qualifiedName`, but
Python's module is a first-class runtime namespace object, is the unit of import resolution,
and executes top-to-bottom.

| # | Column | Meaning |
|---|---|---|
| 0 | `name` | last dotted segment — `views` |
| 1 | `qualifiedName` | full dotted path — `app.web.views` |
| 2 | `fileName` | `views.py` |
| 3 | `filePath` | repo-relative path |
| 4 | `baseMservPath` | service root (Java convention) |
| 5 | `moduleKind` | `MODULE` \| `PACKAGE_INIT` \| `NAMESPACE_PACKAGE` \| `SCRIPT` \| `STUB` \| `MAIN_GUARD_SCRIPT` |
| 6 | `packageQualifiedName` | containing package; `""` at top level |
| 7 | `isPackage` | `true` for `__init__.py` |
| 8 | `isStub` | `true` for `.pyi` |
| 9 | `pythonDialect` ★ | **Detection / rejection signal:** `PY3` \| `PY2_DETECTED_REJECTED` \| `PY_UNKNOWN`. Python 2 is out of scope (§6), but tree-sitter parses it *without erroring*, so a Py2 file must be detected and rejected rather than silently misinterpreted |
| 10 | `targetVersion` ★ | **exact patch** of the interpreter this analysis targets — `3.10.4`, `2.7.18`. Provenance; pairs with invariant #10 |
| 11 | `emissionRegime` ★ | **What the FACTS were emitted under:** `PY3_0_11` \| `PY3_12_PLUS`. The single column the engine branches on for comprehension scoping (§4.4) |
| 12 | `grammarUsed` ★ | `TS_PYTHON3` \| `TS_PYTHON3_PARTIAL` \| `UNPARSED` — `PARTIAL` means at least one `py_parse_gap` row exists for this module |
| 13 | `futureImports` | comma-set. Still load-bearing in Py3: **`annotations`** (PEP 563) decides whether annotations are strings at runtime |
| 14 | `encodingDeclared` | PEP 263 cookie; `""` if none |
| 15 | `hasModuleDocstring` | |
| 16 | `hasDunderAll` ★ | an `__all__` assignment exists at module level |
| 17 | `dunderAllIsStatic` ★ | `__all__` is a list/tuple of **string literals only** — i.e. `dunderAllNames` is complete and authoritative |
| 18 | `dunderAllNames` ★ | comma-set of exported names; `""` when absent **or** when not static |
| 19 | `moduleInitMethodLinkHash` ★ | FK→`py_method` — the synthetic `<module>` initializer (§4.2) |
| 20 | `moduleScopeLinkHash` ★ | FK→`py_scope` — the module scope |
| 21 | `isExternal` | parity slot, always `false` on parser output (§1) |
| 22 | `serviceVersionLinkHash` | |
| 23 | `pyModuleUniqueHash` | **PK** |

**PK** `PY_MODULE_md5(filePath ‖ baseMservPath ‖ qualifiedName ‖ emissionRegime ‖ serviceVersionLinkHash)`
**FKs** 20→`py_method`, 21→`py_scope` (both back-patched after those rows are minted;
accumulate-then-export makes this free).

#### Why `emissionRegime` is a column *and* in the key

§4.4 says emission is driven by "dialect **plus the declared target version**" — but v3 had no
version column anywhere, so the very finding that made §4.4 correct was unrecordable. A 3.10
run and a 3.12 run over identical source produce structurally different fact sets (~1,383
comprehension scopes present vs absent) while both stamped `pythonDialect=PY3`. Invariant #10
puts the interpreter in the *golden file*, but the **engine consumes the fact table**, and
from there the regime was unrecoverable.

**Two columns, not one, because they answer different questions.** `pythonDialect` is a
property of the *file* — with Python 2 out of scope it is now a **detection/rejection**
signal (`PY3` \| `PY2_DETECTED_REJECTED` \| `PY_UNKNOWN`, §6.2), not a semantics selector.
`emissionRegime` is a property of the *analysis run*. They stay separate because one file can
be analysed under either regime, and a rejected file has no regime at all. `targetVersion` carries the exact patch for
reproducibility; `emissionRegime` is the coarse enum so the engine branches on **one equality
test** rather than parsing a version string — which §0.5 forbids.

**In the PK** because every child key chains off the module hash, so putting the regime here
propagates it through the entire fact base: 3.10 facts and 3.12 facts for the same file can
never collide, even if someone loads both databases at once. That is the key-chaining
discipline doing exactly the job it exists for, and it costs nothing today.

#### `__all__`

Absent from v3 entirely. It is purely syntactic, fully oracle-checkable from `ast`, and it
gates whether a re-export is public API — which Q9 (§9) depends on: `from .models import User`
in an `__init__.py` only makes `pkg.User` public if `__all__` permits it, and the engine
cannot chase what the parser never emitted.

`dunderAllIsStatic` (18) exists because `__all__` is not always a literal. Measured over the
959-file corpus: **65 modules define `__all__`, 63 static, 2 dynamic** — `__all__ = __all__ + _d`
(IPython `core/display.py`) and a list containing a bare `Name`. Also possible are
`__all__ += [...]` and `__all__.extend(...)`. At 3% this is small, but treating a dynamically
built `__all__` as a complete export list is silently wrong in exactly the direction that
hides public API, so the flag marks it rather than the parser guessing — the same discipline
as `argFlowIsPrecise` and `confidence`.

---

### 2.2 `py_scope` / `lib_py_scope` — 25 columns ★

A direct mirror of `symtable.SymbolTable`. No Java analogue. This exists so the oracle can
assert **set equality** with CPython rather than eyeballing structure — it is the reason
precision/recall are well-defined for this schema at all.

| # | Column | Meaning |
|---|---|---|
| 0 | `scopeKind` | `MODULE` \| `CLASS` \| `FUNCTION` \| `LAMBDA` \| `COMPREHENSION_LIST` \| `COMPREHENSION_SET` \| `COMPREHENSION_DICT` \| `GENERATOR_EXPRESSION` \| `TYPE_PARAM` (3.12) \| `TYPE_ALIAS` (3.12) \| `ANNOTATION` (3.14) |
| 1 | `name` | symtable's own name: module name, class name, function name, `lambda`, `listcomp`, `genexpr`, … |
| 2 | `qualifiedName` | CPython `__qualname__` semantics **including `<locals>`** — `Outer.method.<locals>.inner` |
| 3 | `nestingDepth` | 0 at module |
| 4 | `parentScopeLinkHash` | FK→`py_scope`; `""` at module scope — **the spine** |
| 5 | `pyModuleLinkHash` | FK→`py_module` |
| 6 | `ownerKind` | `MODULE` \| `TYPE` \| `METHOD` \| `LAMBDA` \| `COMPREHENSION` |
| 7 | `ownerHash` | FK→`py_module`/`py_type`/`py_method`, polymorphic by col 6 |
| 8 | `isNested` | `SymbolTable.is_nested()` — **verbatim** |
| 9 | `isOptimized` | `SymbolTable.is_optimized()` — **verbatim** |
| 10 | `hasChildren` | `SymbolTable.has_children()` — **verbatim** |
| 11 | `symtableId` ★ | `SymbolTable.get_id()` — oracle cross-check handle only; never joined on |
| 12 | `usesWildcardImport` | a `from x import *` occurs here → names may be unbound |
| 13 | `isGenerator` | *ast-derived*, not symtable (see §7) |
| 14 | `isCoroutine` | *ast-derived* |
| 15 | `declaresGlobal` | a `global` statement occurs here |
| 16 | `declaresNonlocal` | a `nonlocal` statement occurs here |
| 17 | `filePath` | |
| 18 | `startLine` | `SymbolTable.get_lineno()` |
| 19 | `startColumn` ★ | **ast-derived — required for PK uniqueness, see below** |
| 20 | `endLine` | ast-derived |
| 21 | `endColumn` | ast-derived |
| 22 | `scopeOrdinal` ★ | 0-based index among sibling scopes of the same parent, source order |
| 23 | `serviceVersionLinkHash` | |
| 24 | `pyScopeUniqueHash` | **PK** |

**PK** `PY_SCOPE_md5(pyModuleLinkHash ‖ parentScopeLinkHash ‖ scopeKind ‖ name ‖ startLine ‖ startColumn)`
**FKs** 4→`py_scope` (self), 5→`py_module`, 7→ polymorphic.

#### Why `startColumn` is in the key — a real collision, not a theoretical one

`(module, parent, kind, name, startLine)` is **not unique**. Two lambdas or two
comprehensions on one line are distinct symtables with an identical key. Reproduced on
3.10.4:

```
g = (lambda: 1, lambda: 2)
h = [x for x in a] + [y for y in b]

key=('function','lambda',1)    occurrences=2  symbol sets=[[], []]
key=('function','listcomp',2)  occurrences=2  symbol sets=[['.0','x'], ['.0','y']]
                                              ^^^^^^^^^^^^^^^^^^^^^^ DIFFERENT
```

Measured across ~4,000 site-packages files: **37 colliding scopes / 6,129 scope-introducing
nodes (0.60%)**, including `IPython/utils/text.py:743` and `:745` — and IPython is in this
document's own corpus.

The blast radius is not contained to `py_scope`. `py_binding` is keyed
`f(pyScopeLinkHash, name)` and `py_expression` carries `pyScopeLinkHash`, so **one collision
silently merges two scopes' entire binding sets and expression trees** — and the listcomp
case above shows the merged sets genuinely differ (`x` vs `y`). It breaks Appendix B
invariant #2 (no PK collisions) and #8 (scope-tree forest) simultaneously, and it does so
before a single parser line is written.

**Where `startColumn` comes from.** `symtable` exposes only `get_lineno()`, never a column.
`startColumn` is therefore ast-derived, and the harness pairs symtable scopes to their `ast`
nodes **in source order** (CPython emits `get_children()` in source order, which is also what
`scopeOrdinal` records). `scopeOrdinal` is deliberately **not** in the PK: it is guaranteed
unique but shifts when a sibling is inserted, which would churn every descendant hash.
`startColumn` is stable under unrelated edits and is what the other span-bearing relations
(`py_block`, `py_expression`) already key on.

Columns 8–11 are verbatim symtable output *in symtable's own order*. 14/15 are marked
ast-derived because CPython 3.12's `symtable.Function` **does not expose** `is_generator()`
or `returns_value()` — I verified the exact API surface (§7). Mislabelling those as
symtable-verified would have made the harness assert something it cannot check.

---

### 2.3 `py_binding` / `lib_py_binding` — 29 columns ★

One row per **(scope, name)** — exactly `symtable.Symbol`. This is Python's
`local_variable` table *and* its global/nonlocal/free/import/parameter table, unified.
It is why 50.7% of method calls (bare-name receivers) become resolvable.

| # | Column | Meaning |
|---|---|---|
| 0 | `name` | |
| 1 | `pyScopeLinkHash` | FK→`py_scope` — **parent** |
| 2 | `bindingKind` | `LOCAL` \| `GLOBAL_EXPLICIT` \| `GLOBAL_IMPLICIT` \| `NONLOCAL` \| `FREE` \| `CELL` \| `PARAMETER` \| `IMPORTED` \| `CLASS_ATTRIBUTE` \| `MODULE_LEVEL` \| `BUILTIN` \| `ANNOTATED_ONLY` \| `UNKNOWN` |
| 3 | `bindingOrigin` | `ASSIGNMENT` \| `AUGMENTED_ASSIGNMENT` \| `ANNOTATED_ASSIGNMENT` \| `ANNOTATION_ONLY` \| `FUNCTION_DEF` \| `CLASS_DEF` \| `IMPORT` \| `FOR_TARGET` \| `WITH_TARGET` \| `EXCEPT_TARGET` \| `COMPREHENSION_TARGET` \| `WALRUS` \| `GLOBAL_STMT` \| `NONLOCAL_STMT` \| `PARAMETER` \| `DEL` \| `MATCH_CAPTURE` \| `STAR_TARGET` \| `TUPLE_UNPACK_TARGET` \| `LAMBDA_PARAM` \| `TYPE_ALIAS` \| `MULTIPLE` |
| 4 | `isParameter` | `Symbol.is_parameter()` |
| 5 | `isLocal` | `Symbol.is_local()` |
| 6 | `isGlobal` | `Symbol.is_global()` |
| 7 | `isNonlocal` | `Symbol.is_nonlocal()` |
| 8 | `isFree` | `Symbol.is_free()` |
| 9 | `isImported` | `Symbol.is_imported()` |
| 10 | `isAssigned` | `Symbol.is_assigned()` |
| 11 | `isReferenced` | `Symbol.is_referenced()` |
| 12 | `isDeclaredGlobal` | `Symbol.is_declared_global()` |
| 13 | `isAnnotated` | `Symbol.is_annotated()` |
| 14 | `isNamespace` | `Symbol.is_namespace()` — the name binds a `def`/`class` here |
| 15 | `bindingCount` ★ | distinct binding sites for this name in this scope |
| 16 | `firstBindingLine` | |
| 17 | `lastBindingLine` | |
| 18 | `declaredTypeName` | annotation text; `""` if unannotated (**68% of params**) |
| 19 | `declaredBaseType` | annotation minus subscripts — `Optional[User]` → `Optional` |
| 20 | `potentialQualifiedName` | parser's best resolution of the annotation |
| 21 | `isAmbiguous` | |
| 22 | `targetEntityKind` | `TYPE` \| `METHOD` \| `IMPORT` \| `PARAMETER` \| `VARIABLE` \| `MODULE` \| `TYPE_VAR` \| `TYPE_ALIAS` \| `NONE` |
| 23 | `targetEntityHash` | FK→`py_type`/`py_method`/`py_import`/`py_method_parameter`; `""` |
| 24 | `pyModuleLinkHash` | FK→`py_module` |
| 25 | `pyMethodLinkHash` | FK→`py_method` — enclosing function; `""` at module/class scope. **This is the `java_local_variable` col-13 analogue**, so `local-flow.dl` ports directly |
| 26 | `filePath` | |
| 27 | `serviceVersionLinkHash` | |
| 28 | `pyBindingUniqueHash` | **PK** |

**PK** `PY_BINDING_md5(pyScopeLinkHash ‖ name)` — one row per symbol per scope, by
construction. Collisions are impossible, which makes the PK-collision check a real assertion
rather than a formality.

Columns 4–14 are the **complete** `symtable.Symbol` predicate set (11 predicates, verified
against 3.12 — there are no others, and `is_cell` is not public). Column-for-column
comparison against CPython is the harness's core assertion.

All 11 are available on every supported target (3.10 and 3.12 alike), so the harness compares
the full set unconditionally — no feature detection. *(A Python 2 caveat lived here in v5:
Py2's `Symbol` exposed only 9. Python 2 is out of scope per §6, so it no longer applies.)*

---

### 2.4 `py_type` / `lib_py_type` — 25 columns

A `class` statement. Positions 0–11 mirror `java_type` 0–11.

| # | Column | Meaning |
|---|---|---|
| 0 | `name` [J] | `UserService` |
| 1 | `qualifiedName` [J] | `app.services.UserService` (module qname + `__qualname__`) |
| 2 | `fileName` [J] | |
| 3 | `typeCategory` [J] | `CLASS_TYPE` \| `EXCEPTION_CLASS_TYPE` \| `ENUM_CLASS_TYPE` \| `PROTOCOL_TYPE` \| `ABC_TYPE` \| `NAMEDTUPLE_TYPE` \| `TYPEDDICT_TYPE` \| `DATACLASS_TYPE` \| `METACLASS_TYPE` \| `GENERIC_TYPE` |
| 4 | `typeAccess` [J] | `PUBLIC_ACCESS` \| `PROTECTED_ACCESS` (`_X`) \| `PRIVATE_ACCESS` (`__X`) |
| 5 | `typeModifier` [J] | comma-set: `ABSTRACT,FINAL,FROZEN,SLOTS,GENERIC,RUNTIME_CHECKABLE,HAS_GETATTR,HAS_SETATTR,HAS_CALL,CALLABLE_INSTANCE` |
| 6 | `typePlacement` [J] | `TOP_LEVEL_PLACEMENT` \| `NESTED_PLACEMENT` \| `LOCAL_PLACEMENT` \| `CONDITIONAL_PLACEMENT` \| `TYPE_CHECKING_PLACEMENT` |
| 7 | `filePath` [J] | |
| 8 | `baseMservPath` [J] | |
| 9 | `startLine` [J] | |
| 10 | `endLine` [J] | |
| 11 | `isExternal` [J] | |
| 12 | `pyModuleLinkHash` ★ | FK→`py_module` |
| 13 | `enclosingTypeLinkHash` ★ | FK→`py_type`; `""` — **explicit, so no `type_lines` line-range trick is needed** |
| 14 | `enclosingMethodLinkHash` ★ | FK→`py_method` for classes defined inside a function (60 in corpus) |
| 15 | `scopeLinkHash` ★ | FK→`py_scope` — the class-body scope |
| 16 | `classInitMethodLinkHash` ★ | FK→`py_method` — synthetic `<classbody>` (§4.2) |
| 17 | `declaringBindingLinkHash` ★ | FK→`py_binding` — the name this class binds in its parent scope |
| 18 | `metaclassName` | the `metaclass=` keyword argument; `""` if none |
| 19 | `baseCount` | number of positional `py_type_base` rows — MRO arity sanity check |
| 20 | `hasDynamicBase` | `true` if any base is not name-shaped (`mixin_factory()`) |
| 21 | `mroKind` ★ | `C3_LINEARIZABLE` \| `SINGLE_INHERITANCE` \| `IMPLICIT_OBJECT` \| `DYNAMIC_UNKNOWN` |
| 22 | `docstring` | escaped; `""` |
| 23 | `serviceVersionLinkHash` | |
| 24 | `pyTypeUniqueHash` | **PK** |

**PK** `PY_TYPE_md5(pyModuleLinkHash ‖ qualifiedName ‖ name ‖ startLine ‖ endLine)`

`mroKind` (21) exists because **19.5% of classes have no explicit base** and **12.1% have
more than one**, so the engine must distinguish "implicit `object`, trivial MRO" from a real
C3 linearisation from `DYNAMIC_UNKNOWN` (a computed base it cannot linearise) — without
re-deriving it from `py_type_base` on every query.

---

### 2.5 `py_type_base` / `lib_py_type_base` — 16 columns ★

One row per base-class expression. **Not** a `type_reference`: Python bases are ordered
(C3 depends on it), can be arbitrary expressions, and `metaclass=`/`total=` keywords are
syntactically bases but semantically are not. 12.1% of classes have >1 base.

| # | Column | Meaning |
|---|---|---|
| 0 | `baseKind` | `NAME` \| `DOTTED_NAME` \| `SUBSCRIPT` (`Generic[T]`, 14.6% of bases) \| `CALL` (dynamic factory) \| `KEYWORD_METACLASS` \| `KEYWORD_OTHER` \| `STARRED` \| `IMPLICIT_OBJECT` |
| 1 | `position` | **0-based MRO order** among positional bases; `""` for keyword rows |
| 2 | `baseText` | normalized source — `collections.abc.Mapping` |
| 3 | `baseSimpleName` | rightmost identifier — `Mapping`; `""` if not name-shaped |
| 4 | `baseDottedPath` | full dotted path if name-shaped; `""` |
| 5 | `keywordName` | `metaclass` / `total` / `""` |
| 6 | `pyTypeLinkHash` | FK→`py_type` — the **subclass**; parent for key chaining |
| 7 | `pyModuleLinkHash` | FK→`py_module` |
| 8 | `pyExpressionLinkHash` | FK→`py_expression` — the base expression node |
| 9 | `pyTypeReferenceLinkHash` | FK→`py_type_reference` — the twin row that feeds the shared name→type resolver |
| 10 | `resolvedTypeLinkHash` | FK→`py_type`, parser-local only; `""` |
| 11 | `isResolvedLocally` | |
| 12 | `isDynamic` | `true` for `CALL` / `STARRED` |
| 13 | `startLine` | |
| 14 | `serviceVersionLinkHash` | |
| 15 | `pyTypeBaseUniqueHash` | **PK** |

**PK** `PY_TYPE_BASE_md5(pyTypeLinkHash ‖ position ‖ keywordName ‖ baseText ‖ startLine)`

Every positional base **also** emits a `py_type_reference` row (col 9 links them), so the
existing `type_ref_resolves` machinery resolves base names with no new rules; `py_type_base`
adds only the ordering and the keyword/dynamic distinctions that `type_reference` cannot carry.

---

### 2.6 `py_type_reference` / `lib_py_type_reference` — 25 columns

Positions 0–16 mirror `java_type_reference` 0–16 so the whole ~250-line
`type-resolution.dl` name→type layer ports with a relation rename.

| # | Column | Meaning |
|---|---|---|
| 0 | `kind` [J] | `NAME` \| `DOTTED_NAME` \| `SUBSCRIPT` \| `UNION_PEP604` \| `OPTIONAL` \| `STRING_FORWARD_REF` \| `LITERAL_TYPE` \| `CALLABLE` \| `TUPLE_TYPE` \| `TYPE_VAR` \| `ANY` \| `NONE_TYPE` \| `ELLIPSIS_TYPE` \| `UNKNOWN` |
| 1 | `context` [J] | `BASE_CLASS` \| `METACLASS` \| `METHOD_PARAM` \| `METHOD_RETURN` \| `FIELD_TYPE` \| `VARIABLE_ANNOTATION` \| `CAST_TARGET` \| `ISINSTANCE_TYPE` \| `ISSUBCLASS_TYPE` \| `EXCEPT_TYPE` \| `RAISE_TYPE` \| `TYPE_ALIAS` \| `TYPEVAR_BOUND` \| `GENERIC_ARGUMENT` \| `OVERLOAD_SIGNATURE` \| `TYPE_COMMENT` |
| 2 | `pyTypeLinkHash` [J] | FK→`py_type` — enclosing class |
| 3 | `typeParameterLinkHash` [J] | `""` unless PEP 695 |
| 4 | `referencedTypeLinkHash` [J] | FK→`py_type` resolved; `""` |
| 5 | `parentReferenceHash` [J] | FK→ self — `int`'s parent is `List` in `List[int]` |
| 6 | `position` [J] | index among subscript args / siblings |
| 7 | `depth` [J] | 0 = outermost (the `"0"` filter in `type-hierarchy.dl` depends on this) |
| 8 | `typeName` [J] | rightmost simple name — `User` |
| 9 | `completeTypeName` [J] | full written text — `typing.Optional[app.models.User]` |
| 10 | `typeVariableName` [J] | `T` if a TypeVar; `""` |
| 11 | `arrayDimensions` [J] | `""` — parity slot, unused |
| 12 | `wildcardVariance` [J] | `COVARIANT` \| `CONTRAVARIANT` \| `INVARIANT` \| `""` (TypeVar variance) |
| 13 | `startLine` [J] | |
| 14 | `endLine` [J] | |
| 15 | `typeReferenceOwnerHash` [J] | FK, polymorphic |
| 16 | `referenceOwnerKind` [J] | `TYPE` \| `METHOD` \| `METHOD_PARAM` \| `FIELD` \| `BINDING` \| `EXPRESSION` \| `DECORATOR` \| `TYPE_BASE` \| `BLOCK` |
| 17 | `pyScopeLinkHash` ★ | FK→`py_scope` — annotations resolve in a *scope*, not a file |
| 18 | `pyModuleLinkHash` ★ | FK→`py_module` |
| 19 | `isStringForwardRef` ★ | 573 in corpus |
| 20 | `isTypeCommentDerived` ★ | came from a PEP 484 `# type:` comment rather than annotation syntax — valid Python 3, and `ast.parse(type_comments=True)` reads it (163 files in the corpus) |
| 21 | `isOptional` ★ | annotation admits `None` — `Optional[X]` is the #1 subscript (3,517) |
| 22 | `pyExpressionLinkHash` ★ | FK→`py_expression` |
| 23 | `serviceVersionLinkHash` | |
| 24 | `pyTypeReferenceUniqueHash` | **PK** |

**PK** `PY_TYPE_REFERENCE_md5(typeReferenceOwnerHash ‖ context ‖ parentReferenceHash ‖ position ‖ depth ‖ completeTypeName ‖ startLine)`

---

### 2.7 `py_method` / `lib_py_method` — 36 columns

`def`, `async def`, `lambda`, and the two synthetic initializers.
**Positions 0–20 are byte-for-byte `java_method` 0–20** — `method_decl`, `method_owner`,
`method_kind` port as literal renames.

| # | Column | Meaning |
|---|---|---|
| 0 | `name` [J] | `<lambda>`, `<module>`, `<classbody>` for synthetics |
| 1 | `signature` [J] | `get_user(self, user_id)` — Python has no overloading, name+arity is identity |
| 2 | `detailedSignature` [J] | with annotations and defaults |
| 3 | `qualifiedName` [J] | CPython `__qualname__` incl. `<locals>` — a true key |
| 4 | `filePath` [J] | |
| 5 | `startLine` [J] | |
| 6 | `endLine` [J] | |
| 7 | `pyTypeLinkHash` [J] | FK→`py_type`; `""` for module-level functions (16% of functions) |
| 8 | `ownerTypeName` [J] | |
| 9 | `ownerQualifiedName` [J] | |
| 10 | `methodAccess` [J] | `PUBLIC_ACCESS` \| `PROTECTED_ACCESS` \| `PRIVATE_ACCESS` (name-mangled) \| `DUNDER_ACCESS` |
| 11 | `methodModifier` [J] | comma-set: `ASYNC,GENERATOR,STATIC,CLASS,PROPERTY,SETTER,DELETER,ABSTRACT,OVERLOAD,FINAL,CACHED,SYNTHETIC` |
| 12 | `returnTypeName` [J] | `-> X` text; `""` (53% have none) |
| 13 | `isVarArgs` [J] | `*args` present |
| 14 | `hasReceiverParameter` [J] | first param is `self`/`cls` |
| 15 | `defaultValueExpression` [J] | `""` — parity slot, unused (§5) |
| 16 | `methodKind` [J] | `FUNCTION` \| `INSTANCE_METHOD` \| `STATIC_METHOD` \| `CLASS_METHOD` \| `PROPERTY_GETTER` \| `PROPERTY_SETTER` \| `PROPERTY_DELETER` \| `CONSTRUCTOR` (`__init__`) \| `ALLOCATOR` (`__new__`) \| `DUNDER_METHOD` \| `ABSTRACT_METHOD` \| `OVERLOAD_STUB` \| `LAMBDA` \| `NESTED_FUNCTION` \| `GENERATOR` \| `ASYNC_FUNCTION` \| `ASYNC_GENERATOR` \| `MODULE_INITIALIZER` ★ \| `CLASS_INITIALIZER` ★ |
| 17 | `parameterCount` [J] | including `self`/`cls` |
| 18 | `hasTypeParameters` [J] | |
| 19 | `throwsExceptions` [J] | comma-set of `raise X` type names in the body — *inferred*, Python has no `throws` (§4.6) |
| 20 | `enclosingMemberLinkHash` [J] | FK→`py_method` — closures (5.3% of functions) |
| 21 | `pyModuleLinkHash` ★ | FK→`py_module` |
| 22 | `scopeLinkHash` ★ | FK→`py_scope` — this function's own scope |
| 23 | `declaringBindingLinkHash` ★ | FK→`py_binding`; `""` for lambdas |
| 24 | `posOnlyCount` | before `/` (PEP 570) |
| 25 | `kwOnlyCount` | after `*` |
| 26 | `hasKwArgs` | `**kwargs` — 11.9% of functions |
| 27 | `isArgsKwargsPassthrough` ★ | **both** `*args` and `**kwargs` (2.8%). Marks where positional param-flow is *provably* unsound, so the engine reports imprecision instead of inventing it |
| 28 | `isAsync` | |
| 29 | `isGenerator` | contains `yield` |
| 30 | `decoratorCount` | |
| 31 | `bodyIsStub` ★ | body is only `...`/`pass`/docstring — `@overload` stubs (567), `Protocol` members, `.pyi`. **Must never be a call target** |
| 32 | `startColumn` ★ | **required for PK uniqueness — see below.** Appended rather than placed next to `startLine` (c5) so Java parity across 0–20 is preserved |
| 33 | `endColumn` | |
| 34 | `serviceVersionLinkHash` | |
| 35 | `pyMethodUniqueHash` | **PK** |

**PK** `PY_METHOD_md5(pyModuleLinkHash ‖ pyTypeLinkHash ‖ qualifiedName ‖ signature ‖ startLine ‖ startColumn)`

`startLine` is required despite `__qualname__`: `@overload` stubs repeat name+signature, and
conditional `if X: def f() else: def f()` redefines it. **`startColumn` is required on top of
that, for the same reason as `py_scope` (§2.2): lambdas.** `g = (lambda: 1, lambda: 2)`
produces two `py_method` rows whose `qualifiedName` (`f.<locals>.<lambda>`), `signature` and
`startLine` are all identical — the previous key merged them into one. Two `def`s cannot
share a line (a compound statement cannot follow a `;`), so this is a lambda-only hazard,
but lambdas are 369 rows in the corpus and the failure is silent.

---

### 2.8 `py_method_parameter` / `lib_py_method_parameter` — 22 columns

Positions 0–11 mirror `java_method_parameter` 0–11 (the hash moves to the end).

| # | Column | Meaning |
|---|---|---|
| 0 | `paramName` [J] | `""` for the bare `*` and `/` markers |
| 1 | `position` [J] | 0-based; `self`/`cls` is 0 |
| 2 | `pyMethodLinkHash` [J] | FK→`py_method` — **parent** |
| 3 | `parameterBaseType` [J] | annotation minus subscripts |
| 4 | `parameterTypeName` [J] | full annotation text; `""` for **68.2%** |
| 5 | `potentialQualifiedName` [J] | |
| 6 | `isAmbiguous` [J] | |
| 7 | `isFinal` [J] | always `false` — parity slot |
| 8 | `isVarArgs` [J] | `*args` |
| 9 | `isReceiverParameter` [J] | `self`/`cls` at position 0 |
| 10 | `startLine` [J] | |
| 11 | `endLine` [J] | |
| 12 | `paramKind` ★ | `POSITIONAL_OR_KEYWORD` \| `POSITIONAL_ONLY` \| `KEYWORD_ONLY` \| `VAR_POSITIONAL` \| `VAR_KEYWORD` \| `POSITIONAL_ONLY_MARKER` \| `KEYWORD_ONLY_MARKER` |
| 13 | `hasDefault` | |
| 14 | `defaultValueText` | normalized source; `""` |
| 15 | `defaultValueKind` | `NONE` \| `NONE_LITERAL` \| `STRING` \| `NUMBER` \| `BOOL` \| `LIST` \| `DICT` \| `SET` \| `TUPLE` \| `CALL` \| `NAME` \| `LAMBDA` \| `ELLIPSIS` \| `UNKNOWN` |
| 16 | `isMutableDefault` | list/dict/set/call default — a standing CWE-shaped finding |
| 17 | `annotationIsString` | forward reference |
| 18 | `bindingLinkHash` ★ | FK→`py_binding` — this param's binding in the function scope |
| 19 | `pyExpressionLinkHash` | FK→`py_expression` — default-value expression root; `""` |
| 20 | `serviceVersionLinkHash` | |
| 21 | `pyMethodParameterUniqueHash` | **PK** |

**PK** `PY_METHOD_PARAMETER_md5(pyMethodLinkHash ‖ position ‖ paramName ‖ paramKind)`

---

### 2.9 `py_field` / `lib_py_field` — 29 columns

Class attributes **and** instance attributes recovered from `self.x = …`.
Positions 0–12 mirror `java_field` 0–12. See §4.1 for the identity decision.

| # | Column | Meaning |
|---|---|---|
| 0 | `name` [J] | |
| 1 | `fieldTypeName` [J] | annotation text; `""` |
| 2 | `fieldBaseType` [J] | |
| 3 | `potentialQualifiedName` [J] | |
| 4 | `isAmbiguous` [J] | |
| 5 | `filePath` [J] | |
| 6 | `startLine` [J] | first write |
| 7 | `endLine` [J] | |
| 8 | `pyTypeLinkHash` [J] | FK→`py_type` — owner |
| 9 | `ownerTypeName` [J] | |
| 10 | `ownerQualifiedName` [J] | |
| 11 | `fieldAccess` [J] | `PUBLIC_ACCESS` \| `PROTECTED_ACCESS` \| `PRIVATE_ACCESS` \| `DUNDER_ACCESS` |
| 12 | `fieldModifier` [J] | comma-set: `CLASS_VAR,INSTANCE_VAR,SLOT,FINAL,CLASSVAR_ANNOTATED,PROPERTY_BACKED,DATACLASS_FIELD,ENUM_MEMBER,READ_ONLY` |
| 13 | `fieldOrigin` ★ | `CLASS_BODY_ASSIGN` \| `CLASS_BODY_ANNOTATION_ONLY` \| `SELF_ASSIGN` \| `SELF_AUGASSIGN` \| `SLOTS_ENTRY` \| `DATACLASS_FIELD` \| `NAMEDTUPLE_FIELD` \| `TYPEDDICT_KEY` \| `ENUM_MEMBER` \| `SETATTR_DYNAMIC` |
| 14 | `declaringMethodLinkHash` ★ | FK→`py_method` — the method containing the **first** `self.x = …`; `""` for class-body fields |
| 15 | `receiverName` ★ | `self` / `cls` / the actual first-param name; `""` |
| 16 | `isDeclaredInInit` ★ | first write is in `__init__`/`__new__`/`__post_init__` — **only 67%** |
| 17 | `writeCount` ★ | distinct write sites merged into this row |
| 18 | `writtenInMethodCount` ★ | distinct methods that write it — `>1` means cross-method state |
| 19 | `firstWriteLine` | |
| 20 | `hasAnnotation` | |
| 21 | `annotationIsString` | |
| 22 | `initializerText` | normalized RHS of the first write; `""` |
| 23 | `initializerKind` | `NONE` \| `LITERAL` \| `CALL` \| `NAME` \| `ATTRIBUTE` \| `LAMBDA` \| `COMPREHENSION` \| `UNKNOWN` |
| 24 | `pyModuleLinkHash` | FK→`py_module` |
| 25 | `bindingLinkHash` ★ | FK→`py_binding` for class-body fields; **`""` for `self.*` — no binding exists, which is precisely the modelling problem** |
| 26 | `pyExpressionLinkHash` | FK→`py_expression` — first write's target node |
| 27 | `serviceVersionLinkHash` | |
| 28 | `pyFieldUniqueHash` | **PK** |

**PK** `PY_FIELD_md5(pyTypeLinkHash ‖ name ‖ fieldOrigin)` — deliberately **not** line-based.

---

### 2.10 `py_field_write` — **REMOVED, redundant with `py_expression`**

Deleted. Every column it carried is already on `py_expression`, verified against the
real parser output for `self.repo = r` / `self.count = self.count + 1`:

| it was going to hold | already on `py_expression` |
|---|---|
| attribute name | `literalValue` |
| write vs read | `isWrite`, `nameContext = STORE`, `edgeRole = ASSIGNMENT_TARGET` |
| receiver | `dottedPath` (`self.repo`) |
| writing method | `expressionOwnerHash` + `expressionOwnerKind = METHOD` |
| assigned value | the sibling `ASSIGNMENT_VALUE` under the same parent |
| write vs read of the same attribute | `self.count` is STORE at depth 0 **and** LOAD at depth 1 |

The only thing it added was `pyFieldLinkHash` — a **join key**, not a fact. Linking a
write expression to its merged `py_field` row is `(pyTypeLinkHash, literalValue)`, which
is a **resolution rule**, exactly like Java's `type_ref_resolves`. My earlier argument
that "projections must be single-relation, so it needs its own table" confused the
projection layer with the resolution layer, which is allowed to join.

**Net: one fewer relation, ten fewer columns, no lost facts.**

---

### 2.11 `py_field_position` / `lib_py_field_position` — 3 columns

Exact `java_field_position` shape. Earns its place beyond parity: `@dataclass` (49 classes)
and `NamedTuple` (32) generate `__init__` **in field-declaration order**, so positional
argument flow into a dataclass constructor is undefined without it.

`0 pyTypeLinkHash · 1 pyFieldLinkHash · 2 position`

---

### 2.12 `py_decorator` / `lib_py_decorator` — 21 columns

**This IS Java's annotation relation.** It occupies `java_annotation`'s slot, mirrors its
columns at 0–3, and `py_decorator_argument` mirrors `java_annotation_argument` at 0–9.
The name follows §1.1's rule — fact-layer names use the language's own word, and Python
says "decorator" — while the **projection is shared**: both languages project to
`annotation_on(Prov, Name, Kind, Context, OwnerHash, Hash)`, so the Java rules port
unchanged. Only the *semantics* differ (§4.3): a Java annotation is inert metadata, a
Python decorator is a call that replaces the decorated object. That difference lives in
`replacesTarget` (c17) and `builtinKind` (c16), not in a different relation shape. 22% of functions are decorated. See §4.3 —
these are **not** annotations.

| # | Column | Meaning |
|---|---|---|
| 0 | `decoratorName` [J] | rightmost identifier — `route` |
| 1 | `kind` [J] | `BARE` \| `CALL` \| `ATTRIBUTE` \| `ATTRIBUTE_CALL` \| `SUBSCRIPT` \| `EXPRESSION` (PEP 614) |
| 2 | `context` [J] | `TYPE_DECLARATION` \| `METHOD_DECLARATION` \| `NESTED_FUNCTION_DECLARATION` |
| 3 | `ownerHash` [J] | FK→`py_type` **or** `py_method`, polymorphic by col 2 |
| 4 | `pyTypeLinkHash` | FK→`py_type` — enclosing class; `""` |
| 5 | `pyMethodLinkHash` | FK→`py_method`; `""` if on a class |
| 6 | `position` | 0-based **source order, top-down** |
| 7 | `applicationOrder` ★ | 0-based **bottom-up = the order they actually execute** |
| 8 | `startLine` | |
| 9 | `endLine` | |
| 10 | `dottedPath` | text before the parens — `app.route`; `""` |
| 11 | `fullText` | normalized full source |
| 12 | `argumentCount` | `""` for `BARE` |
| 13 | `pyExpressionLinkHash` | FK→`py_expression` |
| 14 | `resolvedTargetHash` | parser-local resolution; `""` |
| 15 | `isKnownBuiltin` | |
| 16 | `builtinKind` | `STATICMETHOD` \| `CLASSMETHOD` \| `PROPERTY` \| `SETTER` \| `DELETER` \| `ABSTRACTMETHOD` \| `OVERLOAD` \| `FINAL` \| `CACHED_PROPERTY` \| `LRU_CACHE` \| `DATACLASS` \| `CONTEXTMANAGER` \| `WRAPS` \| `NONE` |
| 17 | `replacesTarget` ★ | `true` when the decorator returns something other than the function — the decorated name **no longer refers to the `def`** |
| 18 | `pyModuleLinkHash` | FK→`py_module` |
| 19 | `serviceVersionLinkHash` | |
| 20 | `pyDecoratorUniqueHash` | **PK** = `PY_DECORATOR_md5(ownerHash ‖ position ‖ fullText ‖ startLine)` |

Corpus: `property` 1,014, `classmethod` 635, `overload` 567, `staticmethod` 82, then a long
framework tail (`memoized_property`, `hookimpl`, `fixture`, `line_magic`, `setter`,
`contextmanager`, `wraps`). `builtinKind` covers the head; `dottedPath` + `fullText` keep the
tail queryable without an ever-growing enum.

---

### 2.13 `py_decorator_argument` / `lib_py_decorator_argument` — 15 columns

Positions 0–9 mirror `java_annotation_argument` 0–9. Framework routes and permissions live
here (`@app.route("/admin/<id>", methods=["POST"])`).

`0 argumentName · 1 argumentValue · 2 valueType · 3 position · 4 parentDecoratorLinkHash [FK] ·
5 referencedTypeHash · 6 nestedDecoratorHash (reserved, always "") · 7 arrayIndex ·
8 startLine · 9 endLine · 10 isKeyword ★ · 11 isStarred ★ · 12 pyExpressionLinkHash ·
13 serviceVersionLinkHash · 14 pyDecoratorArgumentUniqueHash`

`valueType`: `STRING_LITERAL` \| `NUMBER_LITERAL` \| `BOOLEAN_LITERAL` \| `NONE_LITERAL` \|
`LIST` \| `DICT` \| `TUPLE` \| `SET` \| `NAME_REFERENCE` \| `ATTRIBUTE_REFERENCE` \| `CALL` \|
`LAMBDA` \| `FSTRING` \| `UNKNOWN`

**PK** `PY_DECORATOR_ARGUMENT_md5(parentDecoratorLinkHash ‖ position ‖ arrayIndex ‖ argumentName ‖ argumentValue)`

---

### 2.14 `py_import` / `lib_py_import` — 24 columns

Positions 0–8 mirror `java_import` 0–8. From-imports outnumber module-imports 6:1; **38% are
relative**.

| # | Column | Meaning |
|---|---|---|
| 0 | `importKind` [J] | `MODULE_IMPORT` \| `MODULE_IMPORT_ALIAS` \| `FROM_MEMBER` \| `FROM_MEMBER_ALIAS` \| `FROM_WILDCARD` \| `RELATIVE_MEMBER` \| `RELATIVE_WILDCARD` \| `FUTURE` \| `DYNAMIC` |
| 1 | `importedPath` [J] | fully-resolved dotted path of the imported thing |
| 2 | `packageOrTypeName` [J] | the module the member comes from; `""` for `MODULE_IMPORT` |
| 3 | `simpleName` [J] | **the name actually bound** in the importing namespace |
| 4 | `filePath` [J] | |
| 5 | `lineNumber` [J] | |
| 6 | `isStatic` [J] | always `false` — parity slot |
| 7 | `isWildcard` [J] | `true` for `import *`. **Parity slot for `java_import.isOnDemand` (c7)** — same position, same meaning; the name follows Python's own term (see §1.1) |
| 8 | `isModuleImport` [J] | the bound name refers to a module, not a member |
| 9 | `relativeLevel` ★ | leading dots; `0` = absolute |
| 10 | `originalName` ★ | pre-alias name |
| 11 | `aliasName` ★ | `""` if none |
| 12 | `resolvedModuleLinkHash` ★ | FK→`py_module` — resolved **within the repo**; `""` if external |
| 13 | `resolvedTargetKind` ★ | `MODULE` \| `TYPE` \| `FUNCTION` \| `VARIABLE` \| `PACKAGE` \| `UNRESOLVED` \| `AMBIGUOUS` |
| 14 | `resolvedTargetHash` ★ | FK→`py_type`/`py_method`/`py_binding`; `""` |
| 15 | `isExternalTarget` ★ | resolves outside the repo |
| 16 | `distributionName` ★ | PyPI distribution if known |
| 17 | `isTypeCheckingOnly` ★ | under `if TYPE_CHECKING:` — 338 blocks. **Calling one of these at runtime is a bug, i.e. a finding** |
| 18 | `isConditional` ★ | inside `try`/`except ImportError`/`if` |
| 19 | `pyScopeLinkHash` ★ | FK→`py_scope` — imports can be function-local |
| 20 | `pyModuleLinkHash` | FK→`py_module` — the **importing** module |
| 21 | `bindingLinkHash` ★ | FK→`py_binding` |
| 22 | `serviceVersionLinkHash` | |
| 23 | `pyImportUniqueHash` | **PK** = `PY_IMPORT_md5(pyModuleLinkHash ‖ lineNumber ‖ importKind ‖ importedPath ‖ simpleName)` |

Two rules worth pinning: `from a import b, c` emits **three rows**? No — **two**, one per
bound name. `import a.b.c` emits **one** row with `simpleName="a"`, `importedPath="a.b.c"`,
`isModuleImport=true`, because that statement binds only `a`.

---

### 2.15 `py_expression` / `lib_py_expression` — 39 columns

The spine. **Positions 0–23 mirror `java_expression` 0–23**; `expressions.dl` ports by
changing the hash index 24→34 and adding placeholders.

| # | Column | Meaning |
|---|---|---|
| 0 | `kind` [J] | see enum below |
| 1 | `edgeRole` [J] | role in the parent — see enum below |
| 2 | `rootContext` [J] | the statement form the root sits in |
| 3 | `expressionOwnerKind` [J] | `MODULE` \| `TYPE` \| `METHOD` \| `LAMBDA` \| `BLOCK` \| `FIELD` \| `BINDING` \| `METHOD_PARAMETER` \| `DECORATOR` \| `IMPORT` \| `COMPREHENSION_SCOPE` |
| 4 | `pyTypeLinkHash` [J] | FK→`py_type`; `""` at module level |
| 5 | `expressionOwnerHash` [J] | FK, polymorphic by col 3 |
| 6 | `parentExpressionHash` [J] | FK→ self; `""` at roots |
| 7 | `position` [J] | ordinal among siblings in the same `edgeRole` |
| 8 | `depth` [J] | |
| 9 | `literalType` [J] | `STRING` \| `BYTES` \| `RAW_STRING` \| `FSTRING` \| `INTEGER` \| `FLOAT` \| `COMPLEX` \| `BOOLEAN` \| `NONE` \| `ELLIPSIS` |
| 10 | `literalValue` [J] | **the name slot** — method name on `CALL`, attribute name on `ATTRIBUTE_ACCESS`, identifier on `NAME_REFERENCE`, literal text on `LITERAL`. Same contract as Java col 10 |
| 11 | `comprehensionKind` [J-slot] | `LIST` \| `SET` \| `DICT` \| `GENERATOR` \| `ASYNC_*` \| `NONE` (occupies Java's `methodReferenceKind`) |
| 12 | `unaryFixity` [J] | `PREFIX` \| `NONE` — Python has no postfix |
| 13 | `operatorString` [J] | `+`, `==`, `is not`, `not in`, `//`, `@`, `:=` |
| 14 | `referencedEntityKind` [J] | `TYPE` \| `METHOD` \| `FIELD` \| `ATTRIBUTE` \| `MODULE` \| `IMPORT` \| `PARAMETER` \| `LOCAL_VARIABLE` \| `GLOBAL_VARIABLE` \| `NONLOCAL_VARIABLE` \| `FREE_VARIABLE` \| `BUILTIN` \| `SELF` \| `CLS` \| `SUPER` \| `COMPREHENSION_VARIABLE` \| `EXCEPT_VARIABLE` \| `WALRUS_TARGET` \| `UNKNOWN` |
| 15 | `referencedEntityHash` [J] | FK; `""` when unresolved |
| 16 | `lambdaScopeHash` [J-slot] | FK→`py_scope` for `LAMBDA`/comprehension nodes — the scope this node introduces (occupies Java's `anonymousTypeHash`) |
| 17 | `potentialQualifiedName` [J] | |
| 18 | `isAmbiguous` [J] | |
| 19 | `returnStatementIndex` [J] | |
| 20 | `startLine` [J] | |
| 21 | `startColumn` [J] | |
| 22 | `endLine` [J] | |
| 23 | `endColumn` [J] | |
| 24 | `pyScopeLinkHash` ★ | FK→`py_scope` — **the scope this expression evaluates in**. Java resolves names by file; Python resolves by scope chain. This is the single most important added column |
| 25 | `pyModuleLinkHash` ★ | FK→`py_module` |
| 26 | `bindingLinkHash` ★ | FK→`py_binding` when this node reads or writes a bound name; `""`. **Resolves the 50.7% bare-name receiver case** |
| 27 | `nameContext` ★ | `LOAD` \| `STORE` \| `DEL` — mirrors `ast.Load`/`Store`/`Del` exactly |
| 28 | `isWrite` ★ | convenience for `nameContext != LOAD` |
| 29 | `argumentKeywordName` ★ | the `k` in `f(k=v)`; `""` otherwise. **12,000 keyword args** — without this, argument→parameter flow (the primary typing mechanism, given 68% unannotated params) can only link positionally and silently loses them |
| 30 | `isAwaited` | |
| 31 | `isStarred` | `*x` / `**x` in a call or literal |
| 32 | `dottedPath` ★ | for attribute chains, the full `a.b.c` text; `""`. 16% of receivers are depth-2 chains |
| 33 | `inferredTypeName` ★ | the type of THIS node, when syntactically derivable; `""` otherwise. Folded in from the deleted `py_type_inference` (§2.21) — one expression, one type |
| 34 | `inferredTypeKind` ★ | `BUILTIN_SCALAR` \| `BUILTIN_COLLECTION` \| `USER_CLASS` \| `NONE_TYPE` \| `CALLABLE` \| `UNKNOWN` |
| 35 | `inferenceEvidence` ★ | `LITERAL` \| `COLLECTION_LITERAL` \| `FSTRING` \| `COMPREHENSION` \| `ANNOTATION` \| `CAST` \| `DEFAULT_VALUE` \| `NONE`. Parser emits **syntactic evidence only** |
| 36 | `inferenceConfidence` ★ | `CERTAIN` \| `PROBABLE` \| `NONE` |
| 37 | `serviceVersionLinkHash` | |
| 38 | `pyExpressionUniqueHash` | **PK** |

**PK** `PY_EXPRESSION_md5(pyScopeLinkHash ‖ expressionOwnerHash ‖ expressionOwnerKind ‖ rootContext ‖ kind ‖ edgeRole ‖ parentExpressionHash ‖ position ‖ depth ‖ literalValue ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)` — same construction as `ExpressionReference.generateHash`, with scope added.

**`kind` enum:** `CALL`, `ATTRIBUTE_ACCESS`, `SUBSCRIPT`, `SLICE`, `NAME_REFERENCE`,
`LITERAL`, `FSTRING`, `FSTRING_INTERPOLATION`, `TUPLE`, `LIST`, `SET`, `DICT`,
`LIST_COMPREHENSION`, `SET_COMPREHENSION`, `DICT_COMPREHENSION`, `GENERATOR_EXPRESSION`,
`LAMBDA`, `CONDITIONAL_EXPRESSION`, `BINARY_OPERATION`, `UNARY_OPERATION`,
`BOOLEAN_OPERATION`, `COMPARISON`, `ASSIGNMENT_EXPRESSION` (walrus), `STARRED`,
`DOUBLE_STARRED`, `AWAIT`, `YIELD`, `YIELD_FROM`, `ASSIGNMENT`, `AUGMENTED_ASSIGNMENT`,
`ANNOTATED_ASSIGNMENT`, `SELF_REFERENCE`, `CLS_REFERENCE`, `MATCH_PATTERN`, `ELLIPSIS`.

**There is deliberately no `OBJECT_CREATION`.** See §4.5.

**`edgeRole` enum:** `ROOT`, `CALLEE`, `RECEIVER`, `ARGUMENT`, `KEYWORD_ARGUMENT`,
`STAR_ARGUMENT`, `DOUBLE_STAR_ARGUMENT`, `ATTRIBUTE_OBJECT`, `SUBSCRIPT_OBJECT`,
`SUBSCRIPT_INDEX`, `SLICE_LOWER`, `SLICE_UPPER`, `SLICE_STEP`, `ASSIGNMENT_TARGET`,
`ASSIGNMENT_VALUE`, `ANNOTATION`, `DEFAULT_VALUE`, `DECORATOR_EXPR`, `BASE_CLASS`,
`CONDITION`, `BODY`, `ORELSE`, `OPERAND_LEFT`, `OPERAND_RIGHT`, `UNARY_OPERAND`,
`COMPREHENSION_ELEMENT`, `COMPREHENSION_ITERABLE`, `COMPREHENSION_TARGET`,
`COMPREHENSION_CONDITION`, `FSTRING_EXPRESSION`, `RETURN_VALUE`, `YIELD_VALUE`,
`AWAIT_OPERAND`, `WITH_CONTEXT`, `WITH_TARGET`, `EXCEPT_TYPE`, `EXCEPT_TARGET`,
`RAISE_EXC`, `RAISE_CAUSE`, `LAMBDA_BODY`, `MATCH_SUBJECT`, `MATCH_PATTERN`.

`RECEIVER` is kept as the role name (not `ATTRIBUTE_OBJECT`) for `CALL` nodes specifically,
so `call-site.dl`'s `java_expression(_, "RECEIVER", …)` pattern ports unchanged.

---

### 2.16 `py_call_site` / `lib_py_call_site` — 26 columns ★

In Java this is *derived* in `call-site.dl`. For Python it is a **base relation**, because
the call shape is not recoverable from one positional pattern: keyword args, `*`/`**`
spreading, chained receivers, `super()`, and — the point — **the receiver's syntactic shape,
which is all we honestly know about a duck-typed receiver**.

| # | Column | Meaning |
|---|---|---|
| 0 | `callKind` | `SIMPLE_CALL` \| `METHOD_CALL` \| `CHAINED_CALL` \| `SUPER_CALL` \| `SELF_CALL` \| `CLS_CALL` \| `MODULE_CALL` \| `SUBSCRIPT_CALL` \| `DYNAMIC_CALL` \| `DECORATOR_CALL` \| `INSTANCE_CALL` (`__call__`) \| `BUILTIN_CALL` \| `UNKNOWN_CALLEE_CALL` |
| 1 | `calleeName` | invoked simple name |
| 2 | `calleeDottedPath` | full written path — `self.repo.get_user`; `""` |
| 3 | `receiverText` | `self.repo`; `""` for bare calls |
| 4 | `receiverKind` ★ | `NONE` \| `SELF` \| `CLS` \| `SUPER` \| `NAME` \| `ATTRIBUTE` \| `CALL_RESULT` \| `SUBSCRIPT` \| `LITERAL` \| `MODULE` \| `TYPE` \| `UNKNOWN` — **the duck-typing answer: record the shape, let the engine do the typing** |
| 5 | `pyExpressionLinkHash` | FK→`py_expression` (the `CALL` node) — **parent, 1:1** |
| 6 | `receiverExpressionLinkHash` | FK→`py_expression`; `""` |
| 7 | `pyScopeLinkHash` | FK→`py_scope` — the calling scope |
| 8 | `pyMethodLinkHash` | FK→`py_method` — **the caller** (never `""`: module-level calls get `<module>`) |
| 9 | `pyTypeLinkHash` | FK→`py_type`; `""` |
| 10 | `pyModuleLinkHash` | FK→`py_module` |
| 11 | `positionalArgCount` | |
| 12 | `keywordArgCount` | |
| 13 | `hasStarArgs` | |
| 14 | `hasDoubleStarArgs` | |
| 15 | `keywordNames` | comma-set, source order |
| 16 | `argFlowIsPrecise` ★ | `false` when `hasStarArgs`/`hasDoubleStarArgs` — positional arg→param flow is **provably** unsound here. Make the imprecision a fact instead of a silent wrong answer |
| 17 | `resolvedCalleeKind` | `METHOD` \| `TYPE` \| `MODULE_FUNCTION` \| `BUILTIN` \| `IMPORTED` \| `UNRESOLVED` — parser-local best effort; `UNRESOLVED` is the honest default and the engine overrides |
| 18 | `resolvedCalleeHash` | `""` if unresolved |
| 19 | `isModuleLevelCall` ★ | executed at import time |
| 20 | `isConditional` | inside `if`/`try` |
| 21 | `startLine` | |
| 22 | `startColumn` | |
| 23 | `endLine` | |
| 24 | `serviceVersionLinkHash` | |
| 25 | `pyCallSiteUniqueHash` | **PK** = `PY_CALL_SITE_md5(pyExpressionLinkHash)` — pure chain off the parent |

For `SUPER_CALL`: 98% of `super()` uses are `super().m()`. Python's `super()` is **not**
virtual dispatch — it is an MRO-ordered lookup starting *after* the enclosing class. Col 9
(`pyTypeLinkHash`) gives the engine the slice point; `py_type_base.position` gives the order.
The explicit form `super(A, self)` — still valid Python 3 — carries its anchor in the
`ARGUMENT` children of the expression, so no extra column is needed.

---

### 2.17 `py_comment` / `lib_py_comment` — 15 columns

Positions 0–8 mirror `java_comment` 0–8.

`0 kind · 1 text · 2 filePath · 3 startLine · 4 startColumn · 5 endLine · 6 endColumn ·
7 ownerHash [FK, polymorphic] · 8 commentIndex · 9 ownerKind · 10 pyModuleLinkHash ·
11 typeCommentPayload ★ · 12 isDocstring · 13 serviceVersionLinkHash · 14 pyCommentUniqueHash`

`kind`: `LINE_COMMENT` \| `SHEBANG` \| `ENCODING_COOKIE` \| `TYPE_COMMENT` \| `NOQA` \|
`PRAGMA` \| `DOCSTRING_MODULE` \| `DOCSTRING_CLASS` \| `DOCSTRING_FUNCTION` \|
`DOCSTRING_ATTRIBUTE` \| `BLOCK_COMMENT_RUN`

**PK** `PY_COMMENT_md5(filePath ‖ kind ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)` — Java parity.

`typeCommentPayload` (11) holds the annotation from `# type: List[int]`. PEP 484 type
comments are **valid Python 3** — `ast.parse(type_comments=True)` parses them — and 163 files
in the corpus use them. Those also emit a `py_type_reference` with `isTypeCommentDerived=true`.

Docstrings: a docstring is genuinely a string *expression*, and `ast` says so. It is emitted
**both** as a `py_comment` (`DOCSTRING_*`) and as a `py_expression` `LITERAL`. The
duplication is intentional and the harness must whitelist it, or it will be reported as a
recall failure forever.

---

### 2.18 `py_block` / `lib_py_block` — 27 columns

Positions 0–16 mirror `java_block` 0–16.

| # | Column | Meaning |
|---|---|---|
| 0 | `kind` [J] | `IF` \| `ELIF` \| `ELSE` \| `FOR` \| `ASYNC_FOR` \| `WHILE` \| `TRY` \| `EXCEPT` \| `EXCEPT_STAR` \| `FINALLY` \| `WITH` \| `ASYNC_WITH` \| `MATCH` \| `CASE` \| `FUNCTION_BODY` \| `CLASS_BODY` \| `MODULE_BODY` \| `LAMBDA_BODY` \| `COMPREHENSION_BODY` |
| 1 | `order` [J] | |
| 2 | `filePath` [J] | |
| 3 | `startLine` [J] | |
| 4 | `endLine` [J] | |
| 5 | `startColumn` [J] | |
| 6 | `endColumn` [J] | |
| 7 | `nestingDepth` [J] | |
| 8 | `pyTypeLinkHash` [J] | FK→`py_type`; `""` |
| 9 | `methodOwnerHash` [J] | FK→`py_method` — **never `""`**: module-level blocks get `<module>` |
| 10 | `parentContainerHash` [J] | FK→`py_block`/`py_expression`/`py_module` |
| 11 | `tryStatementHash` [J] | FK→`py_block` — the `TRY` an `EXCEPT`/`FINALLY`/`ELSE` belongs to |
| 12 | `resourceCount` [J] | number of `with` items |
| 13 | `caughtExceptionTypes` [J] | comma-set — `ValueError,KeyError` (108 tuple-form handlers) |
| 14 | `ownerTypeName` [J] | |
| 15 | `ownerQualifiedName` [J] | |
| 16 | `ownerMethodName` [J] | |
| 17 | `pyScopeLinkHash` ★ | FK→`py_scope` |
| 18 | `pyModuleLinkHash` ★ | FK→`py_module` |
| 19 | `conditionExpressionLinkHash` ★ | FK→`py_expression` — the `if`/`while` test. **2,123 `isinstance()` sites**: `if isinstance(x, Foo): x.m()` narrows the receiver from a 24-candidate fan to exactly one. Without this FK the engine would have to text-parse `conditionText` |
| 20 | `conditionText` | normalized source; `""` |
| 21 | `exceptTargetName` | the `e` in `except X as e`; `""` if unbound |
| 22 | `hasElseClause` | for `TRY`/`FOR`/`WHILE` |
| 23 | `isModuleLevel` ★ | |
| 24 | `isTypeCheckingGuard` ★ | `if TYPE_CHECKING:` — 338 blocks |
| 25 | `serviceVersionLinkHash` | |
| 26 | `pyBlockUniqueHash` | **PK** |

**PK** `PY_BLOCK_md5(filePath ‖ pyTypeLinkHash ‖ methodOwnerHash ‖ kind ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)`

---

### 2.19 `py_parse_gap` / `lib_py_parse_gap` — 10 columns ★

One row per construct the grammar could not represent. **Records the gap; does not repair
it.** Replaces v3's `py_source_bridge_edit`, which existed to audit a source rewriter that
§6.2(a) has now cancelled — tree-sitter parses 99.59% of the CPython 2.7 stdlib unaided, so
rewriting source (and putting every position in the fact table behind a mapping) to recover
0.41% of files is the wrong trade.

`0 pyModuleLinkHash [FK] · 1 constructKind · 2 disposition · 3 startLine · 4 startColumn · 5 endLine · 6 endColumn · 7 sourceText · 8 serviceVersionLinkHash · 9 pyParseGapUniqueHash`

- `constructKind`: `EXEC_COMPLEX_EXPR` (the only measured real gap — `exec tmpl % (a,)`,
  `exec f.read() in g,l`) \| `PY2_CONSTRUCT_DETECTED` (a Py2-only node type — the module is
  rejected wholesale, §6.2) \| `ERROR_NODE` \| `MISSING_NODE`
- `disposition`: `ERROR_NODE` (grammar flagged it) \| `MISPARSED_SILENTLY` (grammar produced a
  plausible-but-wrong node — backticks) \| `SKIPPED`

**PK** `PY_PARSE_GAP_md5(pyModuleLinkHash ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn ‖ constructKind)`

**Zero rows for ~99.6% of modules, Python 2 included.** A non-empty table names exactly what
the parser could not represent and where — the assertion Q12's negative fixture set exists to
make.

---

### 2.20 `py_type_parameter` / `lib_py_type_parameter` — 14 columns — **DEFERRED**

PEP 695 only (3.12+). Declared now so the position contract is fixed, **not emitted** for
≤3.11. See §6.

`0 paramName · 1 position · 2 ownerName · 3 ownerQualifiedName · 4 filePath · 5 startLine ·
6 ownerLinkHash [FK→py_type|py_method] · 7 ownerKind · 8 boundText · 9 variance ·
10 defaultText (PEP 696) · 11 pyScopeLinkHash [FK] · 12 serviceVersionLinkHash ·
13 pyTypeParameterUniqueHash`

For ≤3.11, `TypeVar` is a **runtime assignment**, not syntax (255 in corpus). It is a
`py_binding` row with `targetEntityKind=TYPE_VAR`. No relation needed.

---

### 2.21 `py_type_inference` — **REMOVED, folded into `py_expression`**

Deleted as a relation. The justification for making it 1:N was unions — `x = 3` then
`x = "hi"`. That reasoning was wrong about *where* the union lives.

**A union is a property of a BINDING, not of an expression.** Every inference the
**parser** is allowed to make is 1:1 with a single expression node:

| evidence | the expression it types |
|---|---|
| `LITERAL` | `3` → that node is `int` |
| `COLLECTION_LITERAL` | `[1,2]` → that node is `list` |
| `FSTRING` | `f"{x}"` → that node is `str` |
| `COMPREHENSION` | `[f(i) for i in y]` → that node is `list` |
| `ANNOTATION` | the annotation expression names a type |
| `CAST` | `cast(Foo, v)` → that call node is `Foo` |
| `DEFAULT_VALUE` | the default expression |

One expression, one type, every time. `x = 3; x = "hi"` is **two** `ASSIGNMENT_VALUE`
expressions, each singly typed — the union emerges from a join over the binding, which
is engine work and needs no storage.

So this becomes **four appended columns on `py_expression`**, not a 17-column relation:

| # | Column | Meaning |
|---|---|---|
| 33 | `inferredTypeName` | `int`, `str`, `list`, `Foo`; `""` when nothing is derivable |
| 34 | `inferredTypeKind` | `BUILTIN_SCALAR` \| `BUILTIN_COLLECTION` \| `USER_CLASS` \| `NONE_TYPE` \| `CALLABLE` \| `UNKNOWN` |
| 35 | `inferenceEvidence` | `LITERAL` \| `COLLECTION_LITERAL` \| `FSTRING` \| `COMPREHENSION` \| `ANNOTATION` \| `CAST` \| `DEFAULT_VALUE` \| `NONE` |
| 36 | `inferenceConfidence` | `CERTAIN` \| `PROBABLE` \| `NONE` |

**Net: one fewer relation, thirteen fewer columns.** `py_expression` goes 35 → 39.

> **FREEZE IMPACT — needs sign-off.** `py_expression` is in the frozen spine. Columns
> **c0–c32 do not move**; `serviceVersionLinkHash` and the PK shift from c33/c34 to
> c37/c38, which is what the "append only, hash last" convention does on every append.
> Spine goes 262 → 266 columns. This is the sanctioned evolution path, but it is still a
> change to a frozen relation and I am not making it unilaterally.

The engine still appends its own inferences (`CONSTRUCTOR_CALL`, `BUILTIN_CALL`,
`ISINSTANCE_GUARD`) — as derived rows, not stored ones. The tier split from
`FIELD-CLASSIFICATION-SPEC.md` is unchanged: the parser emits only syntactic evidence.

---

## 3. FK diagram — what the resolution layer traverses

```
                          ┌─────────────────┐
                          │   py_module     │◄──────── every entity carries pyModuleLinkHash
                          └────┬───────┬────┘
             moduleScopeLinkHash│       │moduleInitMethodLinkHash
                                ▼       ▼
                       ┌──────────┐  ┌──────────────────┐
              ┌───────►│ py_scope │  │ py_method        │
              │        └────┬─────┘  │  "<module>"      │  ← synthetic; gives module-level
   parentScope│             │        └──────────────────┘     code a caller (§4.2)
   (recursive)└─────────────┤
                            │ pyScopeLinkHash
                            ▼
                     ┌─────────────┐
                     │ py_binding  │  one row per (scope, name) == symtable.Symbol
                     └──────┬──────┘
                            │ targetEntityHash / bindingLinkHash
      ┌─────────────────────┼────────────────────────┬──────────────────┐
      ▼                     ▼                        ▼                  ▼
┌──────────┐         ┌─────────────┐          ┌───────────┐      ┌──────────┐
│ py_type  │         │  py_method  │          │ py_import │      │py_method_│
└──┬────┬──┘         └──┬───┬───┬──┘          └─────┬─────┘      │parameter │
   │    │               │   │   │                   │            └────┬─────┘
   │    │pyTypeLinkHash │   │   │enclosingMember    │resolvedModule   │binding
   │    └───────────────┘   │   └──►(self, closures)└──►py_module     └──►py_binding
   │                        │
   │ pyTypeLinkHash         │ pyMethodLinkHash
   ▼                        ▼
┌──────────────┐      ┌──────────┐
│ py_type_base │      │ py_block │──conditionExpressionLinkHash──┐
│ (ORDERED →   │      └────┬─────┘   (isinstance narrowing)      │
│  C3 MRO)     │           │ methodOwnerHash ──► py_method       │
└──────┬───────┘           │                                     │
       │pyTypeReferenceLinkHash                                  │
       ▼                                                         │
┌────────────────────┐                                           │
│ py_type_reference  │  ← annotations, bases, isinstance, cast,   │
└────────┬───────────┘    except, raise, # type: comments        │
         │referencedTypeLinkHash                                 │
         └──► py_type                                            │
                                                                 │
┌──────────┐   pyTypeLinkHash    ┌──────────────┐                │
│ py_field │◄────────────────────│   py_type    │                │
└────┬─────┘                     └──────────────┘                │
     │ declaringMethodLinkHash ──► py_method                     │
     │ pyFieldLinkHash                                           │
     ▼                                                           │
┌────────────────┐                                               │
│ py_field_write │─valueExpressionLinkHash──┐                    │
└────────────────┘                          │                    │
                                            ▼                    ▼
                                   ┌──────────────────────────────────┐
                                   │        py_expression             │
                                   │  pyScopeLinkHash  ──► py_scope   │
                                   │  bindingLinkHash  ──► py_binding │
                                   │  parentExpression ──► self       │
                                   │  lambdaScopeHash  ──► py_scope   │
                                   └──────────────┬───────────────────┘
                                                  │ 1:1
                                                  ▼
                                          ┌───────────────┐
                                          │ py_call_site  │
                                          │ receiverExpr ─┼──► py_expression
                                          │ pyMethodLink ─┼──► py_method (CALLER)
                                          └───────────────┘

  py_decorator ──ownerHash──► py_type | py_method
       └── py_decorator_argument ──parentDecoratorLinkHash──► py_decorator
```

### The four data-flow paths the engine must walk

Ordered by corpus frequency — this is the build order I'd suggest for the engine.

**① Bare-name receiver — 50.7% of attribute calls (20,040 sites)**
```
py_call_site(receiverKind="NAME", pyScopeLinkHash=S, receiverExpressionLinkHash=E)
  → py_expression(E).bindingLinkHash                                → py_binding B
  → if B unresolved: walk py_scope.parentScopeLinkHash upward       → py_binding B'
  → B.targetEntityKind ∈ {IMPORT,TYPE,METHOD,PARAMETER,VARIABLE}
      IMPORT     → py_import.resolvedTargetHash / resolvedModuleLinkHash
      PARAMETER  → param-flow: arg exprs at every call site of the owning method
                   (linked BY POSITION and BY argumentKeywordName)
      VARIABLE   → local-flow: py_field_write / assignment value expr type
  → py_method_name_in_type(callee, T)
```
The scope-chain walk (`py_scope.parentScopeLinkHash`) is Python's substitute for Java's
file-scoped import resolution. It is a transitive closure over one FK.

**② `self` receiver — 19.6% (7,753)**
```
py_call_site(receiverKind="SELF", pyTypeLinkHash=T)
  → py_method_name_in_type(calleeName, T)  direct
  → plus C3 MRO ancestors from py_type_base ORDER BY position
```
No CHA fan needed — `self` is exactly the enclosing class or a subclass. This is the single
biggest precision win available and it costs nothing.

**③ Attribute chain — 18.8% (7,418), 99.98% within depth 3**
```
py_expression(dottedPath="self.repo.get_user")
  → py_field(pyTypeLinkHash=T, name="repo").fieldTypeName        (annotated: 32%)
  → else py_field_write.valueExpressionLinkHash → expr type       (unannotated: 68%)
  → py_method_name_in_type("get_user", thatType)
```

**④ Call-result receiver — 7.3% (2,886), of which 28% is `super()`**
```
receiverKind="SUPER"  → C3 linearization of py_type_base, sliced AFTER pyTypeLinkHash
                        (NOT virtual dispatch — this is the correctness trap)
receiverKind="CALL_RESULT" → resolve inner call → callee py_method.returnTypeName
                        → else return-flow over the callee's RETURN_VALUE expressions
```

### Polymorphism reduction, in FK terms

Naive name-only lookup gives **24.63 candidates per attribute call**. The reducers, in order
of measured value:

| Reducer | Mechanism | Reaches |
|---|---|---|
| Unique-name shortcut | name defined by exactly 1 class | **24.9%** of sites, free |
| Not-a-method shortcut | name defined by 0 classes → module/import/stdlib path | **24.0%** |
| `self` scoping | path ② — never fan to unrelated classes | 19.6% of attribute calls |
| Binding + scope chain | path ① — resolves the name to one entity | 50.7% |
| `isinstance` narrowing | `py_block.conditionExpressionLinkHash` | 2,123 sites |
| `cast()` | `py_type_reference(context=CAST_TARGET)` | 359 sites |
| Annotation | `parameterTypeName` / `returnTypeName` | 32% of params, 47% of returns |
| Explicit imprecision | `argFlowIsPrecise=false`, `isArgsKwargsPassthrough`, `DYNAMIC_CALL`, `usesWildcardImport`, `HAS_GETATTR` | ~1,600 sites: **report, don't guess** |

---

## 4. Where Python has no Java analogue — modelling choices

### 4.1 `self.*` attributes with no declaration site

**Measured:** 7,124 `self.x = …` writes; **only 67% in `__init__`**; 1,538 of 4,043 classes
have them; plus 1,620 writes to *other* objects' attributes.

Java's field is one declaration with one type at one line. Python's attribute is a *set of
writes* scattered across methods, often with no annotation.

**Choice.** `py_field` identity is `(pyTypeLinkHash, name, fieldOrigin)` — **not** line-based.
All `self.x` writes in a class collapse into one row carrying `writeCount`,
`writtenInMethodCount`, and `firstWriteLine`; every individual write is preserved in
`py_field_write`.

**Why.** A line-keyed identity would make `self.x` three unrelated entities in a class that
writes it in `__init__`, `reset()`, and `close()`, and the resolution layer would have to
re-merge them by name on every join — a join it cannot express as a projection. The merged
row is also what a *reader* of the code means by "the `x` attribute".

**Corollary — class var and instance var stay separate rows.** `x = 1` in the class body and
`self.x = 2` in a method produce **two** rows (`CLASS_BODY_ASSIGN`, `SELF_ASSIGN`). They are
different objects with different lifetimes and CPython resolves them differently. Two rows =
the engine sees both candidates = sound over-approximation, consistent with the engine's
existing philosophy.

**Corollary — foreign attribute writes get no field row.** `other.attr = v` (1,620 sites)
produces **no** `py_field` row, because we cannot know `other`'s class at parse time. It is
fully present in `py_expression` with `nameContext=STORE`. The engine may promote it to a
field once it types `other`. The parser does not guess.

**`__slots__` (420 classes) is a real declaration site** — `fieldOrigin=SLOTS_ENTRY`, and it
is authoritative: a slotted class *cannot* gain other attributes.

### 4.2 Module-level executable code

**Measured:** 3,006 executable module-level statements across 826 files (3.6/file); 398 of
them are whole blocks (`if`/`try`/`for`).

Java has no analogue — there is no code outside a method. But `expr_ultimate_method` in
`ownership.dl` requires every expression to reach a *method*, or call attribution fails.

**Choice.** Emit a **synthetic method** per module: `name="<module>"`,
`methodKind=MODULE_INITIALIZER`, `methodModifier` contains `SYNTHETIC`, `pyTypeLinkHash=""`,
`scopeLinkHash` = the module scope. Every module-level block, expression and call site takes
it as owner, so `py_block.methodOwnerHash` and `py_call_site.pyMethodLinkHash` are **never
empty**. Likewise a `<classbody>` `CLASS_INITIALIZER` per class.

**Why.** `ownership.dl`'s own comment says the Java parser already mints synthetic
`<clinit>`/`<init>` methods for initializer blocks. This is the same move, and it means
`expr_ultimate_method`, `local-flow.dl`, `param-flow.dl` and the whole call-chain layer work
on Python with zero new rules. The alternative — teaching every rule to handle an empty owner
— touches every file in `resolution/`.

`isModuleLevelCall` on `py_call_site` keeps import-time execution distinguishable, which
matters: a module-level call runs on *import*, so it is reachable from every importer.

### 4.3 Decorators vs annotations

**Measured:** 4,503 decorated functions (22%), 214 decorated classes.

A Java annotation is inert metadata. A Python decorator is **a function application that
replaces the decorated object.** `@lru_cache def f()` means the name `f` is now a
`functools._lru_cache_wrapper`, not the `def`.

**Choice.** Separate relation `py_decorator` (not `py_annotation`), with the same *shape* as
`java_annotation` so the projection is a rename, plus three columns Java cannot have:
- `applicationOrder` (7) — bottom-up, the order they actually execute; `position` (6) stays
  top-down source order. Both, because reporting wants one and semantics wants the other.
- `replacesTarget` (17) — the decorator returns something other than the function. The
  engine must not assume `f` still refers to the `def`.
- `builtinKind` (16) — the ones that change *dispatch*, not just behaviour.

**The dispatch-critical cases:**
- `@property` (1,014) — turns `obj.x` from an attribute read into a **method call**. Both a
  `py_method` (`PROPERTY_GETTER`) and a `py_field` (`PROPERTY_BACKED`) exist for the name, so
  the engine sees both candidates.
- `@staticmethod` / `@classmethod` (717) — change whether arg 0 is the receiver, which shifts
  every positional argument→parameter link by one.
- `@overload` (567) — `bodyIsStub=true`; these are **declarations, never call targets**.
- `@abstractmethod` (40) — the concrete target is in an implementor.

The framework tail (`hookimpl`, `fixture`, `line_magic`, `memoized_property`, …) is *not*
enumerated. `dottedPath` + `fullText` + `py_decorator_argument` keep it queryable, and a
framework model can be layered in the engine without a schema change. Enumerating it would
guarantee a schema change per framework.

### 4.4 Comprehension scopes

**Measured:** 2,056 comprehension scopes (listcomp 1,061, genexpr 673, dictcomp 228, setcomp 94).

**Two live regimes.** Python 2 is out of scope (§6), so the emission rule below covers only
`PY3_0_11` and `PY3_12_PLUS`. Verified directly on 3.10.4 and 3.12.4, same source, all four
constructs:

| Construct | **Py3.0–3.11** (`PY3_0_11`) | **Py3.12+** (`PY3_12_PLUS`) |
|---|---|---|
| `listcomp` | own scope + synthetic `.0` | **no scope** (PEP 709 inlined; target listed in the enclosing scope but semantically isolated) |
| `setcomp` | own scope + `.0` | no scope (inlined) |
| `dictcomp` | own scope + `.0` | no scope (inlined) |
| `genexpr` | own scope + `.0` | own scope + `.0` |

Raw output, `def f(a)` containing one of each:

```
PY3.10  f.syms=['a','d','g','l','s']             ← nothing leaked
        child listcomp  syms=['.0','i']
        child setcomp   syms=['.0','j']
        child dictcomp  syms=['.0','k']
        child genexpr   syms=['.0','m']
PY3.12  f.syms=['a','d','g','i','j','k','l','s'] ← i,j,k inlined into f
        child genexpr   syms=['.0','m']
```

**Emission rule**, driven entirely by `py_module.emissionRegime` (c11):

```
PY3_0_11    COMPREHENSION_LIST/SET/DICT -> emit a scope (synthetic binding: .0)
            GENERATOR_EXPRESSION        -> emit a scope (synthetic binding: .0)
PY3_12_PLUS COMPREHENSION_LIST/SET/DICT -> emit NO scope
            GENERATOR_EXPRESSION        -> emit a scope (synthetic binding: .0)
```

**Why this is a trap and not a detail.** The two regimes disagree structurally on the most
common construct in the language, and **neither runtime semantics nor symtable shape alone
tells you which regime produced a fact set**: 3.10 and 3.12 agree semantically (the target is
isolated in both) but disagree structurally. A harness that infers the regime from the
oracle's own output will be confidently wrong on one of them, and the failure surfaces as
"the parser is broken". Hence `emissionRegime` is an **input**, recorded in the fact table
(§2.1) and in every golden file (invariant #10).

This is also why 3.10.4 is the freeze target (§9): `PY3_0_11` is the *richer* regime, so
emission is implemented there and **gated off** for 3.12 — subtractive, and every golden file
exercises the path.

**Synthetic binding the harness must whitelist.** `.0` — the implicit iterator parameter — is
a genuine `symtable.Symbol` and appears as a `py_binding` row. On a `PY3_0_11` target that is
**every** comprehension and generator expression: **~2,056 occurrences** in the measured
corpus, not the 673 genexprs an earlier draft implied. A harness that does not whitelist it
reports a spurious extra binding on all of them.

> *Historical:* Python 2.7 was measured before it was descoped and formed a third regime —
> `listcomp` inlined **and leaking**, `setcomp`/`dictcomp` scoped with an extra synthetic
> `_[1]`. Recorded only so the finding is not re-derived; no emission rule follows from it.

### 4.5 Duck-typed call receivers

**Measured:** 24.63 naive candidates per attribute call; 1.22M candidate edges over 49k sites.

**Choice.** The parser records the receiver's **syntactic shape** (`receiverKind`) and its
**expression** (`receiverExpressionLinkHash`). Where the type is *derivable*, it emits a
`py_type_inference` row (§2.21); where it is not, `resolvedCalleeKind=UNRESOLVED` is the
honest default. The distinction that matters is **derivation vs guessing**, not inference vs
no-inference:

- `x = 3; x.bit_length()` — `x` is an `int`. Certain, `ast` proves it, so the parser emits it
  (`evidence=LITERAL`).
- `x = Foo(); x.m()` — derivable, but only once `Foo` resolves, so this is an **engine**
  inference row (`evidence=CONSTRUCTOR_CALL`), not a parser one. See §2.21.
- `def f(x): x.m()` — unknown. 68.2% of parameters look like this. The parser emits
  *nothing*; `receiverKind=NAME` plus the binding FK is what it honestly knows, and the
  engine resolves it through argument flow.

**Corollary — there is still no `OBJECT_CREATION` expression kind, and that is now cost-free.**
Python construction is `Foo(...)`, syntactically identical to a call; 6,384 bare-name calls in
the corpus are capitalised and *might* be constructors. `ast` cannot tell, so stamping
`OBJECT_CREATION` on the expression would put an unverifiable guess inside the layer the
oracle validates byte-for-byte. Instead `py_expression.kind` stays `CALL` and the construction
fact lives in `py_type_inference` as an engine-emitted `CONSTRUCTOR_CALL` row. The engine
gets the same answer; the syntax layer stays exactly checkable; and a failed resolution
degrades to a missing inference row instead of a mislabelled expression. This is a real divergence from the
Java schema and I want it acknowledged explicitly.

**Corollary — escape hatches are marked, not modelled.** `getattr`/`setattr` (982),
`__getattr__`/`__getattribute__` (72 classes), `eval`/`exec` (51), `import *` (22). Each gets
a marker (`callKind=DYNAMIC_CALL`, `typeModifier` `HAS_GETATTR`, `usesWildcardImport`) so the
engine can report "unresolvable by construction" rather than silently emitting no edge. At
1.8% of classes these are not worth redesigning around — but they *are* worth being able to
name in a report.

### 4.6 `throwsExceptions` is inferred, not declared

`py_method` col 19 keeps Java's `throwsExceptions` position, but Python has no `throws`
clause. It is populated by walking `raise X` in the body (2,497 raises, 90% of them
`raise Foo(...)`). It is an **under-approximation** — propagated exceptions are not included.
Flagged so nobody reads it as a guarantee. The alternative, leaving the slot empty, wastes a
parity column that has real use.

---

## 5. Java relations with no Python analogue

| Java relation | Disposition |
|---|---|
| `java_type_parameter` | **Not emitted** ≤3.11. `TypeVar` is a runtime assignment (255 in corpus), captured as `py_binding` with `targetEntityKind=TYPE_VAR`. PEP 695 syntax is §2.20, deferred. |
| `java_method_type_parameter` | Same — no syntactic method type parameters before 3.12. |
| `java_annotation` / `_argument` | Replaced by `py_decorator` / `py_decorator_argument`. Same shape, different semantics (§4.3). |
| `java_enum_constant` / `_argument` | **No separate relation.** Python `Enum` members are class-body assignments: `py_field` with `fieldModifier` containing `ENUM_MEMBER`, in a `py_type` with `typeCategory=ENUM_CLASS_TYPE`. Only 42 enum classes in the corpus; a dedicated relation would carry no column the field row lacks. |
| `java_type_lines` | **Not needed.** It exists because Java's flattened nested `qualifiedName` forces line-range containment to find nested types. `py_type.enclosingTypeLinkHash` is explicit, so nesting is a direct FK. This removes the `member_chain` / `nested_fqn_path` string-slicing machinery entirely — one of the larger simplifications Python buys us. |
| `java_local_variable` | **Folded into `py_binding`.** A Python local is a symbol in a function scope; `nonlocal`/`global`/`free`/parameter/import bindings are the same table. `py_binding.pyMethodLinkHash` occupies the same role as `java_local_variable` col 13, so `local-flow.dl` ports directly. A separate relation would duplicate rows and give the harness two things to reconcile against one `symtable` answer. |
| `java_field_position` | **Kept** as `py_field_position` — dataclass/NamedTuple `__init__` order depends on it. |
| `defaultValueExpression` (`java_method` col 15) | Parity slot, always `""`. Java uses it for annotation element defaults; Python's parameter defaults live on `py_method_parameter` cols 13–16 where they belong. |
| `isStatic` (`java_import` col 6) | Parity slot, always `false`. |
| `arrayDimensions` (`java_type_reference` col 11) | Parity slot, always `""`. |
| `unaryFixity` POSTFIX | Never emitted — Python has no postfix operators. |
| config relations (`xml`/`yaml`/`properties`/`gradle`) | Orthogonal; unchanged and unaffected. |

---

## 6. Python 2 — OUT OF SCOPE, and how we reject it safely

**Decision (human): Python 2 is reverted. Python 3 only. tree-sitter is the single parsing
front end.** No CPython-2 oracle, no dialect divergence handling, no Py2 semantics in the
engine.

### 6.1 What was removed, and what it costs to reverse

The distinction that matters is **columns vs enum values**, because they have very different
reversal costs:

**Columns removed — expensive to re-add (a re-freeze), so this is the consequential part:**

| Relation | Column | Why it was Py2-only |
|---|---|---|
| `py_module` | `hasFutureAbsoluteImport` | `absolute_import` is a no-op in Py3 |
| `py_scope` | `hasExecStatement` | the Py2 `exec` *statement* deoptimised a scope; Py3's `exec()` is an ordinary function and does not |
| `py_method_parameter` | `parentParameterLinkHash` | existed solely for Py2 `def f((a,b))` tuple parameters |

All three are in the **spine**, so removing them now is free and removing them later would
not have been. Spine: 265 → **262 columns**.

**Columns deliberately KEPT — they earn their place on Python 3:**

- `py_module.futureImports` — `from __future__ import annotations` (PEP 563) decides whether
  annotations are strings at runtime. Very much a Py3 concern.
- `py_comment.typeCommentPayload` and `py_type_reference.isTypeCommentDerived` — PEP 484
  `# type:` comments are **valid Python 3** and `ast.parse(type_comments=True)` supports them.
  These were mislabelled as "Py2's only annotation channel"; that was true *and* incomplete.
- `py_module.pythonDialect` / `emissionRegime` — see §6.2 and §4.4. Neither is a Py2 artefact.

**Enum values removed — cheap to re-add** (a new enum value changes no column position, so it
never forces a re-freeze): `PY2_7`, `OLD_STYLE_CLASS_TYPE`, `NEW_STYLE_CLASS_TYPE`,
`OLD_STYLE_DFS`, `IMPLICIT_RELATIVE`, `TUPLE_UNPACK*`, `BACKTICK_REPR`,
`PRINT_STATEMENT_EXPR`, `EXEC_EXPRESSION`, `OCTAL_LEGACY`, `UNICODE_STRING`, `LONG`, `<>`.

If Python 2 is ever wanted again, the enum values come back for free; the three columns
above are what would need a re-freeze. That asymmetry is the reason to record it here.

### 6.2 The safety consequence: Py2 must be REJECTED, not merely unsupported

This is the non-obvious part, and it is created by the decision rather than removed by it.

§6.2(a) of v5 established that **tree-sitter parses Python 2 without erroring** — 99.59% of
the CPython 2.7 stdlib parses clean, with first-class `print_statement`, `exec_statement`,
`chevron`, comma-`except_clause` and `tuple_pattern` nodes. In a Py2-supporting build that
was good news. **In a Python-3-only build it is a hazard**: a stray Py2 file produces a
full, confident, plausible-looking fact set whose scoping semantics we are not applying —
leaking list comprehensions, old-style attribute lookup, implicit relative imports. It fails
silently, which is the failure mode this whole document is organised against.

So "Python 3 only" requires an explicit rejection path, not the absence of a support path:

1. **Detect.** After parsing, test for Py2-only node types — `print_statement`,
   `exec_statement`, `chevron`, `except_clause` with two bare identifiers, `tuple_pattern`
   inside `parameters`. These are unambiguous: none can occur in valid Python 3.
2. **Reject.** Set `py_module.pythonDialect = PY2_DETECTED_REJECTED`, emit **no** facts for
   the module, and write a `skipped-python-files.csv` row with the reason.
3. **Record why.** Emit `py_parse_gap` rows naming the offending construct and its span, so
   the rejection is auditable rather than a silent absence.

Detection is a node-type test on an already-built tree, so it costs one pass and no new
dependency.

### 6.3 What this changes in the toolchain

- **CPython 2.7.18 is no longer part of the oracle.** It stays installed at
  `~/.pyenv/versions/2.7.18` but is unused; I have not deleted it, since it took several
  minutes to build and is inert on disk. One command removes it if you want it gone.
- **The version axis stays regardless.** `PY3_0_11` vs `PY3_12_PLUS` differ at every
  list/set/dict comprehension (§4.4), so version-pinned interpreters, `emissionRegime` and
  invariant #10 are all still required. Dropping Python 2 removed none of that machinery —
  worth stating plainly, because it was the main thing Py2 was blamed for.
- **`py_parse_gap` survives**, re-motivated: it now records Py3 ERROR/MISSING nodes and Py2
  rejections, not rewriter edits.

## 7. What the oracle can and cannot verify

This determines what the harness may assert, so it is part of the schema contract.

**`symtable` is ground truth for:** scope tree shape and nesting; every `(scope, name)`
binding; and exactly these 11 `Symbol` predicates — `is_parameter`, `is_local`, `is_global`,
`is_nonlocal`, `is_free`, `is_imported`, `is_assigned`, `is_referenced`, `is_declared_global`,
`is_annotated`, `is_namespace`. I enumerated the API on 3.12: **there are no others**, and
`is_cell` is not public. On `SymbolTable`: `is_nested`, `is_optimized`, `has_children`,
`get_lineno`, `get_id`, `get_type`; on `Class`: `get_methods`; on `Function`:
`get_parameters`, `get_locals`, `get_globals`, `get_nonlocals`, `get_frees`.

**Python 2 is out of scope (§6), so there is no Py2 oracle.** For the record, since it was
measured before the decision: CPython 2.7's `Symbol` exposes **9** predicates, not 11 —
`is_nonlocal` and `is_annotated` do not exist — so a harness that assumed 11 would have
raised `AttributeError` rather than reading falsy. That asymmetry no longer applies.

**The oracle is still version-dispatched, for a Python-3-only reason.** `PY3_0_11` and
`PY3_12_PLUS` disagree about comprehension scopes (§4.4), so the harness selects an
interpreter by absolute path keyed on `py_module.emissionRegime` and runs it as a
subprocess. Dropping Python 2 removed none of this machinery.

**`symtable` does NOT model** — so `ast` is the independent second implementation, exactly as
the brief anticipated: attribute writes (`self.x`) at all; expression structure; decorators;
base-class expressions; call sites and arguments; comments; line/column spans beyond a scope's
first line; `is_generator` / `returns_value` (**not exposed on 3.12's `Function`**, contrary
to older documentation — a live trap for anyone porting from a prior prototype).

Consequences for the schema, already applied: `py_scope` cols 14/15 are labelled ast-derived,
not symtable-verified. `py_field` has no symtable analogue whatsoever and is checked against
`ast` alone, which is precisely why §4.1's identity rule needs your sign-off — the harness
cannot appeal to CPython to settle it.

---

## 8. Version coverage: what 3.12+ would additionally need

You asked what it costs to also cover 3.12+. **Everything below is purely additive** — new
relations, appended columns, new enum values. **No existing position moves.** So you can
approve the 3.10 schema now and add 3.12 later without invalidating a single golden file.

| Feature | Needs |
|---|---|
| PEP 695 `class C[T]`, `def f[T]()` | Emit `py_type_parameter` (§2.20, already position-fixed); `py_type.typeParameterSyntax`-equivalent already covered by `hasTypeParameters`; new `py_scope.scopeKind=TYPE_PARAM` (already in the enum) |
| PEP 695 `type X = ...` | New `py_scope.scopeKind=TYPE_ALIAS` (already in enum) + `py_binding.targetEntityKind=TYPE_ALIAS` (already in enum). **No new relation.** |
| PEP 696 type-param defaults (3.13) | `py_type_parameter` col 10 `defaultText` — already reserved |
| PEP 709 comprehension inlining (3.12) | **Behavioural, not syntactic** — the oracle must normalise (§4.4/§9) |
| `except*` (3.11) | `py_block.kind=EXCEPT_STAR` — already in enum |
| `match` (3.10) | `MATCH`/`CASE` block kinds, `MATCH_PATTERN` expression kind — already in enum (0 uses in corpus; these libs target ≤3.9) |
| PEP 604 `X | Y` (3.10) | `py_type_reference.kind=UNION_PEP604` — already in enum |
| PEP 649 deferred annotations (3.14) | `py_scope.scopeKind=ANNOTATION` — already in enum |
| Tooling | `tree-sitter-python@0.21.0` is **additive today** — it peers `tree-sitter ^0.21.0` and our pin `^0.21.1` satisfies it. **PEP 695 specifically** needs ≥ 0.23, which peers `^0.22.1` and therefore rebuilds the Java/Groovy bindings: a cross-language change with Java regression risk, to be scheduled deliberately. 0.25.0 still carries `print_statement` / `exec_statement` / `chevron`, so that bump does not cost Python 2 support. CPython ≥ 3.12 for the oracle (already present). |

The only genuinely new *relation* is `py_type_parameter`, and I have already fixed its
columns so adding it later is a `decls_base.dl` append and nothing else.

---

## 9. Decisions taken, and what is still open

### Resolved in this round

**Q2 — Python 2 oracle. ~~APPROVED and DONE~~ → SUPERSEDED by the v6 revert (§6).** Recorded for history: `pyenv` + **CPython 2.7.18** installed at
`~/.pyenv/versions/2.7.18`. Verified live: Py2 `symtable` runs, list comprehensions do not
create a child scope and the loop variable lands in the enclosing function, `genexpr` does
create one, and `exec` flips `is_optimized` to `False`. The 2.7 stdlib that ships with it is
also the Py2 validation corpus I was missing. The oracle becomes a version-dispatched
subprocess (the two CPythons cannot share a process).

**Q3 — Unified schema. SUPERSEDED by the v6 revert (§6): Python 3 only, and Py2 files are
now explicitly rejected (§6.2).** Recorded for history: Py2 and Py3 were to emit into the
same `py_*` relations, dialect as a column. Since skipping is off the table, the
grammar gap turned out not to exist: tree-sitter parses Python 2 natively (§6.2a, measured
99.59% clean on the 2.7 stdlib). The residual 0.41% is recorded via `py_parse_gap`, not
rewritten. Consumers must read `pythonDialect` before interpreting `typeCategory`, `mroKind`,
or comprehension scoping.

**Q4 — Naming.** `py_*` for Python source, `lib_py_*` for external. One prefix per core
language; the next language takes its own `lan_*`. §1 rewritten.

**Q6 — Type inference. Adopted, as a relation.** New `py_type_inference` (§2.21). A union is
1:N, so `x = 3; x = "hi"` is two rows and `unionSize == "1"` is the monomorphic test. An
`evidence` ladder records *how* we know (`LITERAL`, `CONSTRUCTOR_CALL`, `COLLECTION_LITERAL`,
`CAST`, `ISINSTANCE_GUARD`, …) and `confidence` records how far to trust it. **The parser
emits only `CERTAIN` and `PROBABLE`**; `POSSIBLE` needs call resolution, is not
oracle-checkable, and is therefore the engine's to append to the same relation. This also
dissolves the `OBJECT_CREATION` tension: the expression stays a `CALL` (verifiable syntax),
the construction fact becomes an inference row (§4.5).

**Q8 — `lib_py_*` is the engine's.** The parser emits only `py_*`. It does no site-packages
walk and enforces no `isExternal` policy; `isExternal` columns are parity slots always
`"false"` on parser output, and `py_import.isExternalTarget` means only "did not resolve
in-repo". §1 rewritten.

**Q10 — IR purpose and approach.** Answered in §0.5: the IR exists to let Datalog compute a
sound call graph and then narrow it, by joins alone. Five layers, with the verifiability
boundary drawn between layer 3 (local resolution + certain inference, parser) and layer 4
(cross-module resolution, MRO, flow, engine) — the parser stops exactly where CPython stops
being able to answer. Build order follows the measured frequency of the four data-flow paths,
starting with the scope/binding spine because it is 100% oracle-checkable and unlocks the
50.7% bare-name case.

### Decided this round (review-driven)

**Target set — 3.10.4, CONFIRMED, and explicitly NOT inverted to 3.12.**

The deciding argument is an engineering one and is stronger than my corpus-based reasoning:
**3.0–3.11 is the *richer* regime.** Comprehension scopes exist there, so implementing
comprehension-scope emission against 3.10 and then *gating it off* for 3.12 is
**subtractive** — the code path is written, exercised by every golden file, and disabled by
one `emissionRegime` test. Starting at 3.12 inverts that into an additive change against a
path that was never exercised, which is exactly how a regime gets shipped untested. This
holds regardless of what the analysed corpus runs, so the corpus question no longer gates
the freeze.

Original reasoning, still valid: Pinning the exact patch,
not "3.10". Version axis in the harness from day one; 3.12 added at the second freeze. The
axis is the expensive part and it is already paid for: `PY3_0_11` vs `PY3_12_PLUS` already
forces a version-dispatched oracle and invariant #10 forces version recording, so another
regime later is a table entry, not new machinery. *(v5 credited this cost to Python 2; that
was wrong — it is a Python-3-only cost and survives the revert.)* And 3.12 goldens are *not* a cheap copy of 3.10's — they differ
across every list/set/dict comprehension — so maintaining two diverging golden sets while the
parser is still churning buys nothing. Noted: `/usr/bin/python3` (3.9.6) is the same
`PY3_0_11` regime as 3.10 and therefore adds coverage of nothing.

> **The one input that flips this, and only you have it: what Python do the codebases we
> actually analyse run?** If they are 3.11+, make 3.12 primary. Goldens built against a
> regime our targets do not use is worse than having fewer goldens. Everything above assumes
> 3.10-era targets; say the word and I invert it.

**Q7 — yes, base relation, but on the right grounds.** The 66k-row figure I gave was a
non-argument. The actual reason: `receiverKind` is a **syntactic** fact, and deriving it in
Datalog means reconstructing syntax from the expression tree — which §0.5 explicitly forbids
("never by re-parsing, re-deriving names, or matching text"). It is also already inside the
spine, so it is decided; this paragraph exists so it is not re-litigated later.

**Q9 — engine-side, and now unblocked.** Re-export resolution is transitive closure over the
import graph, i.e. layer 4 by §0.5's own boundary; having the parser compute a fixpoint would
breach the line §0.5 spends a section defending. But it was contingent on `__all__`, which
v3 did not emit — the engine cannot chase what the parser never recorded. With
`hasDunderAll` / `dunderAllIsStatic` / `dunderAllNames` on `py_module` (§2.1), Q9 needs no
further schema change.

**Q12 — SUPERSEDED by the v6 revert (§6): with Python 2 out of scope there is no Py2
corpus.** Recorded for history — yes for grammar coverage, no for statistics, filtered: Measured on the
installed 2.7.18 stdlib: **1,922 `.py` files, 650 (34%) under `test/`, `lib2to3/tests/` or
`idlelib/idle_test/`, leaving 1,272**. Those trees contain deliberately-unparseable fixtures —
`test/badsyntax_nocaret.py`, `test/badsyntax_future4.py`, `test/bad_coding.py`,
`lib2to3/tests/data/false_encoding.py`, `.../infinite_recursion.py` — which left in would
generate spurious `skipped-python-files.csv` rows and `py_parse_gap` noise, so every
sweep would open by re-triaging known-intentional failures.

- **Correctness corpus:** the 1,272 filtered files. Of these, **334 (26%) are rejected by
  Python 3 `ast`** — i.e. they genuinely exercise the Py2 bridge. That is a substantially
  better validation set than I expected and it is the strongest argument for this corpus.
- **Negative fixture set:** keep a handful of the deliberately-broken files on purpose.
  "The parser fails cleanly and records why" is itself worth asserting, and these are the
  only ground-truth-broken inputs we will get for free.
- **Not for statistics.** The §0 fan-out and annotation-coverage numbers stay on the
  site-packages corpus. Stdlib code is old, framework-free and decorator-light, so it would
  understate exactly the polymorphism problem the IR exists to solve.

### Still open

**Q11 — DISSOLVED, not deferred.** I claimed adding the Python grammar would force a
tree-sitter core bump and rebuild the Java/Groovy bindings. The actual peer ranges:

```
tree-sitter-python@0.21.0  peers tree-sitter ^0.21.0   <- our pin ^0.21.1 SATISFIES this
tree-sitter-python@0.23.6  peers tree-sitter ^0.22.1
tree-sitter-python@0.25.0  peers tree-sitter ^0.25.0
```

`0.21.0` drops straight in: no core bump, no Java or Groovy rebuild, no cross-language
regression risk. Only 0.23+ needs a newer core, solely for PEP 695, which §2.20 already
defers. 0.25.0 still contains the Python 2 rules, so that eventual bump does not cost Py2
support — worth re-verifying at the time, but the rules are there today.

**Nothing schema-level is open. The freeze is approved.** Two implementation items are
logged for other owners:

1. **`py2_rejection_path` (A3)** — tree-sitter parses Py2 without erroring, so Python-3-only
   needs an explicit rejection path, not merely an absent support path (§6.2).
2. **`tree_sitter_32k_limit` (unowned, outside A0–A5)** — `HANDOFF-parser-core-32k.md`.

For the record, the question that used to sit here:

> ~~What Python version do the codebases we actually analyse run?~~ **CLOSED.** The freeze
> target is 3.10.4 on engineering grounds that hold independent of the corpus: `PY3_0_11` is
> the richer regime, so emission is implemented there and gated off for 3.12 (subtractive,
> and exercised by every golden file). The corpus answer would only change *ordering*, not
> correctness, so it no longer gates anything.

*(The Python-2 engine-semantics question that sat here is closed: Python 2 is out of scope,
§6.)*

## 10. Recommendation: freeze the spine first  *(taking Q10's smaller cut)*

19 relations × 425 columns, all `symbol`-typed, position as the only contract, frozen on
approval — a column-order error is silent and invalidates every golden file. The `py_scope`
PK collision is precisely the class of defect a smaller first cut surfaces cheaply, and it
was found by review rather than by me. That is an argument for reducing what gets frozen in
round one.

**Freeze these 10 now** — by §3's own analysis they support all four data-flow paths:

| Relation | Cols | Why in the spine |
|---|---|---|
| `py_module` | 25 | root of every FK chain; carries `emissionRegime` and `__all__` |
| `py_scope` | 26 | the name-resolution spine |
| `py_binding` | 29 | path ① — 50.7% of receivers |
| `py_type` | 25 | path ② |
| `py_type_base` | 16 | MRO ordering, 12.1% multiple inheritance |
| `py_method` | 36 | callers and callees |
| `py_method_parameter` | 23 | argument→parameter flow, the primary typing mechanism |
| `py_import` | 24 | 38% relative; cross-module edges |
| `py_expression` | 39 | path ③, and now carries syntactic type inference |
| `py_call_site` | 26 | path ④ |

**Defer these 11** to a second freeze, once the spine has produced byte-identical, FK-clean
output on both dialects: `py_type_reference`, `py_field`, `py_field_position`, `py_decorator`,
`py_decorator_argument`, `py_comment`, `py_block`, `py_parse_gap`, `py_type_parameter`.

Deferring costs little and de-risks a lot. `py_field` carries the §4.1 identity decision that
`symtable` cannot arbitrate (Q6-adjacent, and the most likely to be re-litigated);
`py_type_inference` is the layer with no oracle at all; `py_block`/`py_comment` sit on no
data-flow path. Meanwhile the spine is the part that is **100% oracle-checkable**, so it is
where the harness earns the right to be called an arbiter.

The two deferred relations that are load-bearing soonest are `py_field` (path ③ needs
attribute types) and `py_block` (`isinstance` narrowing). Both can join the second freeze
without touching a spine column — the FKs point *from* them *to* the spine, not the reverse.

## Appendix A — `decls_base_py.dl`

**Generated from this document**, not hand-maintained: `gen_decls.py` parses the column
tables in §2, cross-checks each header's stated arity against the actual number of numbered
column rows (both the table form and the inline `0 a · 1 b` form), fails on any gap or
mismatch, and emits the `.decl` pairs grouped into spine and deferred.

`python3 gen_decls.py --check` re-generates and diffs; a non-zero exit means the `.dl` has
drifted from the doc. That check exists because v2 shipped an Appendix A claiming arities
were "verified programmatically" while the `.dl` had in fact fallen behind a rename and was
missing a relation entirely. **A verification claim that is not itself executed is worse than
no claim** — it buys false confidence. This is now invariant #11.

Current state: 19 relations, 38 declarations, 425 columns, 0 unverified.

---

## Appendix B — invariants the harness will enforce

Independent of the fact content, and testable on any corpus:

1. **Referential integrity** — every non-empty `*LinkHash` resolves to an existing PK in its
   target relation. Polymorphic FKs (`ownerHash`, `expressionOwnerHash`,
   `typeReferenceOwnerHash`) resolve in the relation selected by their discriminator column.
2. **No PK collisions** — within each relation, the last column is unique. Deliberately
   strongest for `py_binding`, where `(scope, name)` uniqueness is guaranteed by symtable's
   own model, making a collision a genuine parser bug rather than a hash accident.
3. **Prefix discipline** — every PK matches `^PY_[A-Z_]+_[0-9a-f]{32}$` and its prefix
   matches its relation.
4. **`serviceVersionLinkHash` present and identical** on every row of a single analysis, and
   positioned immediately before the PK in every relation.
5. **Byte-identical output across runs** — same input, same bytes, including row order.
   Requires a total order on the accumulate-then-export step (the Java analyzer's chunked
   TSV writer is already deterministic given a stable accumulation order).
6. **Column-count invariance** — each TSV's field count equals its declared arity on every
   row; catches unescaped tabs/newlines slipping past `escapeTsv`.
7. **Ownership totality** — every `py_expression`, `py_block` and `py_call_site` reaches a
   `py_method` (§4.2 guarantees this) and a `py_scope`.
8. **Scope-tree acyclicity** — `parentScopeLinkHash` forms a forest with exactly one root per
   module; likewise `parentExpressionHash` per owner.
9. **Oracle agreement** — `py_scope` set-equals CPython's scope tree, and `py_binding`
   set-equals CPython's `(scope, name)` symbols with **all 11** `Symbol` predicates matching,
   **after `emissionRegime` normalisation** (§4.4) and after whitelisting the
   synthetic `.0` and `_[1]` bindings. Reported as precision/recall per entity kind, with
   every disagreement classified — never merely counted.
10. **Interpreter pinning** — the oracle selects its CPython by **absolute path** per target
    dialect, never via `python3` or ambient PATH, and records the path and full `sys.version`
    in every golden file. The environment that produced a golden file must be recoverable
    from it. (This invariant exists because I got exactly this wrong: I reported "no 3.10 on
    this machine" from a conda shell while `python3` resolved to 3.10.4 outside it.)
11. **Schema/declaration agreement** — `decls_base_py.dl` is **generated from** this
    document's column tables, and CI re-generates and diffs it. Appendix A previously claimed
    arities were "verified programmatically" while the `.dl` had in fact drifted behind a
    rename. A claim of verification that is not itself executed is worse than no claim.
