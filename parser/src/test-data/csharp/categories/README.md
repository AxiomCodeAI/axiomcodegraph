# `src/test-data/csharp/categories/` — the consolidated C# fixture tree

Promoted by `cs-corpus` from `src/test-data/csharp/staging/`, which is
`cs-fixtures`' directory and was **read, never written**. Nothing here was
hand-edited into agreement with anything: every `.cs` file is byte-identical to
its source in `staging/` unless it is listed as an addition below, and every
project's compile status was **measured** and compared against what it declares.

## Layout

Twelve categories carry the names `src/test-data/java/` uses, so the two
languages line up:

```
annotations  blocks  enums  expressions  imports  integration  local-variables
method-type-parameters  methods  type-parameters  type-references  type-registry
```

Eighteen carry names Java has no word for, because C# has the construct and Java
does not:

```
async-iterators  collections  delegates  events  explicit-interface  extensions
functions  linq  misc  namespaces  operators  parameters  partial  patterns
properties  strings  structs-records  tuples
```

and `projects/` holds the twenty-one whose **governing configuration** is the
fixture.

### `modules` has no C# port, and none was invented

Java's `modules` category is one file, `module-info.java` — the JPMS module
declaration. **C# has no module declaration.** The nearest C# question is
namespace *style*, file-scoped versus block versus several per file, which is a
`cs_module` column rather than a declaration, and it is covered by
`namespaces/`. Recorded here because an absent construct needs a decision, not
silence.

## Every category governs itself

In `staging/`, one `.csproj` governed twelve categories and another governed
eighteen. The tuple that decides what a fixture's bytes *mean* — `TargetFramework`,
`LangVersion`, `Nullable`, `ImplicitUsings`, `DefineConstants` — therefore lived
two directories above the file it governed.

Each category now has its own project, with every value byte-for-byte the
parent's. A difference would silently change every row beneath it, which is why
the files say so.

**One dependency became visible in the process.** Five categories reference the
attribute *types* declared in `annotations/` **by qualified name, with no
`using`**. Under one project that was ambient and undeclarable. The first scan
for it grepped for `using Fixtures.` and found nothing — absence of a match was
not absence of the thing. The **build** found it, and the five now carry a
`ProjectReference`.

## What was added, and why each one

Ten fixtures, each closing a value the enum-emission audit found **declared and
never emitted anywhere** — not in this tree and not in 12,054 files of real C#
across six strata. Every one was first shown *emittable* on a throwaway probe,
so a coverage gap could not be filed as a parser gap.

| added | closes |
|---|---|
| `projects/proj-walk-gaps/` | nothing in the audit — it is regression cover for six measured parser defects |

### Seven more were written, measured, and then removed

`cs-corpus` and `cs-fixtures` closed the *same* enum-coverage holes
independently and at the same time — attribute targets, `scoped`, `required`,
`/** */` doc comments, the two error-ratio parse-gap buckets and the
unevaluable `#if`. `cs-fixtures` authored theirs in `staging/`, which is the
authored source, and this tree is a promotion of it.

The overlap was resolved by **measurement, not by seniority**: with both sets
present, each of `cs-corpus`'s seven was the sole cover for **nothing**, so all
seven were removed and coverage was re-measured, unchanged. The eighth — the
`#pragma`-at-end-of-file pair, the one file that *was* a sole cover — went the
same way one round later, when `cs-fixtures` authored its own pair in
`proj-grammar-gate/` from the finding. Nothing of `cs-corpus`'s enum-closing
fixtures remains, which is the intended end state: fixtures are `cs-fixtures`'
to author, and the audit's job was to say which ones.

**Coverage went from 397 to 407 of 460 declared values** when measured against
`cs-impl@915ea7f`. Re-measured against `cs-impl@c4ad2dd`, which landed while
the sweep was running and changed the barrel — `CsExpressionKind.ARRAY_CREATION`
added, ten `CsDirectiveKind` values removed — it is **398 of 451**, and the 53 that
remain are *exactly* `cs-impl`'s own `MEASURED_GAPS` plus `RESERVED_ENUM_VALUES`,
with **zero unexplained**. Every declared value the parser is currently able to
emit has a fixture.

**That number was 415 for one commit, and 415 was wrong.** A value observed
*anywhere* counted as emitted, and seventeen of the seventeen were shared
strings — `CsMethodKind.ANONYMOUS_METHOD` read as emitted because
`expressions.kind` carries `CsExpressionKind.ANONYMOUS_METHOD`. The audit in
`tools/csharp/enum-emission-audit.mjs` now binds each column to the enum whose
values it carries and scores per `(enum, column)`. Same lesson `js-corpus`
recorded: 35 of 264 strings are declared by more than one enum.

Five entries on `cs-impl`'s lists are falsified by this tree — three
`MEASURED_GAPS` that are emitted (`RANGE`, `SIZEOF`, `SPREAD_ELEMENT`) and two
`RESERVED_ENUM_VALUES` that carry rows in their own column
(`CsMethodKind.ANONYMOUS_METHOD`, `CsTypeRefKind.FUNCTION_POINTER`). The audit
is red on the last two until they move, and that is the audit working. An
earlier version of this paragraph said twenty-two; nineteen of those were the
shared-string error. Retracted in `findings-corpus.jsonl`.

Two of the ten — `TYPEVAR` and `REQUIRED` — are still absent from all 12,054
corpus files and exist **only** here. That is the fixture tree earning its keep:
a corpus-only audit would report them as unreachable.

### Three of them the compiler had to teach me

- **CS1730** — assembly and module attributes must precede every other element.
  Written below the namespace first.
- **CS9032 / CS9034** — a `required` member may be neither less visible than its
  type nor `readonly`. Both spellings were written, both rejected; the reason is
  kept in the source rather than deleted with the code.
- **CS1517** — `#if 0` and `#if X && (1 == 1)` are *invalid preprocessor
  expressions*. So `CsActivationSource.UNEVALUATED` is reachable only on source
  `csc` also refuses: the parser's evaluator and `csc`'s accept the same tiny
  grammar. The fixture moved to a non-compiling project and says why.

## One prune declined

**`projects/proj-extension-hidden/Extensions.cs`** and
`projects/proj-extension-visible/Extensions.cs` are **byte-identical** — the only
such pair in the tree — and they stay that way.

They are identical *by design*. `cs-fixtures` built the pair so the two projects
differ in exactly one `using Acme.Text;` line, which is what makes extension-method
**visibility** adjudicable: the two fact bases must differ in one `cs_using` row
and nothing else, same receivers, same member names, same argument lists.
Collapsing them destroys the property the pair exists to prove. **The redundancy
is the fixture.**

More generally, 23 of 274 files are the sole cover for at least one declared
value. None was deleted, this sweep or any other.

## Verification

- **31 of 31** verifiable projects: declared `CsFixtureCompiles` equals measured.
  One is skipped by its `NOT-VERIFIABLE-HERE` marker and the skip is announced.
  The sweep *compares* rather than passing whatever it is told — it reported 12
  mismatches on its first run, every one real.
- **274 files, 0 extraction errors, 127,055 foreign keys, 0 failures.**
- **No goldens were regenerated, because none exist.** `cs-impl`'s gate corpus is
  written from inline strings inside `csharp-tests.ts` and does not reference
  `src/test-data/csharp/` at all, so no expected value anywhere depended on this
  move. Nothing was hand-edited into agreement.

## `staging/` still exists

It is `cs-fixtures`' directory and not `cs-corpus`'s to delete. Retiring it is
their call once this tree is accepted.
