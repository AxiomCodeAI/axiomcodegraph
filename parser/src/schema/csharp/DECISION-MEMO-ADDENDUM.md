# C# Phase 0 — addendum: the contradiction, the repriced parse layer, and the gate

Answers to the three points raised against `DECISION-MEMO.md`. Read that first; this
supersedes its §2 conclusion about MSBuild and reprices its §1.

---

## 1. The contradiction — resolved. **.NET is not required. Q1 stands.**

### Retraction first

**The memo's claim that `DefineConstants` "is not derivable by reading the `.csproj`" is
wrong, and I am retracting it.** It was the load-bearing half of the §2 recommendation and
it was an artifact of my classifier, not a property of the corpus.

The error: I flagged any value containing a `$(…)` reference as `COMPUTED`. multitarget-A's
declarations end `;$(AdditionalConstants)`, so all 13 were called unresolvable — which is
where "39.4% needs MSBuild" came from. But `AdditionalConstants` is a user-extension hook
that is **never defined anywhere in the corpus**, and MSBuild expands an undefined property
to the empty string. The symbol lists themselves are literal, and the conditions are on
`$(TargetFramework)` alone:

```xml
<PropertyGroup Condition="'$(TargetFramework)'=='net8.0'">
  <DefineConstants>HAVE_APPCONTEXT;HAVE_ADO_NET;…;$(AdditionalConstants)</DefineConstants>
</PropertyGroup>
```

This is the failure mode §7 names directly — a check that reports a result it is not
actually measuring. I filed against the corpus what was a defect in my regex.

### (a) How far an XML parse gets you — 100% of declarations

Re-classified with MSBuild's actual semantics (undefined property → empty; a condition over
`$(TargetFramework)`/`$(Configuration)` is evaluable given the TFM, which under option 3 is
an **input**):

| | declarations | share |
|---|---|---|
| `COND_ON_TFM_OR_CFG` | 23 | 69.7% |
| `LITERAL` | 10 | 30.3% |
| **needs real MSBuild** | **0** | **0.0%** |

**33 of 33 declarations, across all four repos, resolve from XML alone.** Per repo:
multitarget-A 100%, multitarget-B 100%, bcl-slice-A 100%, linq-heavy-A 100%. multitarget-A — the case I
had called unresolvable — is 100%.

### (b) The implicit constants are a table we own, verified against MSBuild

`NET8_0_OR_GREATER` and friends are a pure function of the TFM. I built the table and
checked it against the **actual csc command line** MSBuild produces (`dotnet build -v:diag`,
grep `/define:`):

```
MATCH  net8.0           14 symbols
MATCH  net6.0           12 symbols
MATCH  netstandard2.0   10 symbols
MATCH  netstandard2.1   11 symbols
MATCH  net48            16 symbols
MATCH  net472           15 symbols

table reproduces MSBuild exactly for all 6 TFMs
negative control (drop one symbol): detectable
```

The rule is three ordered ladders (`netcoreapp`, `netstandard`, `netfx`) plus the family
tokens. ~40 lines. **No SDK, no MSBuild, no .NET.**

Two caveats, stated rather than buried:

- `DefineConstants` at *evaluation* time does not include the `_OR_GREATER` symbols; they
  are added during the build. So `dotnet msbuild -getProperty:DefineConstants` is **not**
  the ground truth — the csc command line is. I used the wrong source first and it gave a
  short, plausible, wrong answer.
- **TFM discovery** — reading which frameworks a project targets — is 87.7% from XML
  (64/73 `.csproj`). The other 12.3% are bcl-slice-A's `$(NetCoreAppCurrent)` style
  properties defined in `eng/` files outside my sparse checkout, so 87.7% is a floor.
  This is a **convenience, not a requirement**: under option 3 the framework is supplied.

### Conclusion

.NET is required by **the oracle only**. The parser needs an XML read, an ancestor walk for
`Directory.Build.props`, a string-comparison condition evaluator, and a ~40-line table. The
hermeticity argument for keeping Roslyn out of the parser is intact and **Q1 stands on its
own merits**.

One genuinely environmental finding for the oracle: multitarget-A pins **SDK 10.0.300** in
`global.json`, and `dotnet msbuild` refuses to run at all without that exact SDK. That is an
oracle-side environmental class to classify, not a parser problem.

---

## 2. The parse layer, repriced

### The bisection you asked for first

| grammar | as-is | after the `async` fix |
|---|---|---|
| **0.23.1** (composes with `^0.21.1`) | **18.88%** | **14.15%** |
| **0.23.5** (needs tree-sitter `^0.25.0`) | **8.62%** | **3.01%** |

`async` is 25.1% of 0.23.1's errors but **65.1%** of 0.23.5's. The number that decides the
question is not the `async` share — it is that **the version gap is worth more than the
`async` fix** on 0.23.1 (18.88 → 8.62 vs 18.88 → 14.15).

The 3.01% floor decomposes:

| | files | of corpus |
|---|---|---|
| residual contains `#if` — **irreducible for any both-branches parser** | 123 | **1.60%** |
| residual with no `#if` — genuine grammar residue | 109 | **1.41%** |

The first half is Q2's `FRAGMENT` class arriving as parse errors. No tree-sitter version
fixes it; Roslyn never sees it, because it preprocesses first.

### (a) Fork the grammar — **I built it, and it works**

Not an estimate. The artifact exists:

1. Take 0.23.5's `grammar.js` (the package ships it) and its hand-written `src/scanner.c`.
2. `tree-sitter generate --abi 14` with `tree-sitter-cli@0.25.10`.
3. Replace 0.23.5's ESM-with-top-level-await binding with a **3-line CommonJS loader**.
4. `node-gyp rebuild`.

```
LOADED: tree-sitter 0.21.1 + fork (0.23.5 grammar source regenerated at ABI 14)
ok    C#12 collection expression   [collection_expression] 
ok    C#12 empty []                [collection_expression]
ok    C#12 spread                  [collection_expression] [spread_element]
ok    C#12 class C;
ok    C#13 params span
ERROR C#13 allows ref struct
ERROR async as identifier
ok    null-cond a?[0]
```

Full corpus through the fork: **8.62% as-is, 3.01% after `async`** — byte-identical to
0.23.5, so the regeneration is faithful.

**Why this is cheaper than it sounds.** tree-sitter 0.21.1 accepts ABI **13–14**; 0.23.1
emits 14, 0.23.5 emits 15. So you cannot vendor 0.23.5's `parser.c`, but you *can*
regenerate its grammar at ABI 14. **The repo's `tree-sitter ^0.21.1` never moves, so Groovy
is safe** and both barriers in the memo (peer range and ESM) dissolve. Build: 8.5 s.

**What it actually costs, stated honestly:**

- A **prebuild matrix** — darwin-arm64/x64, linux-x64/arm64, win32-x64 — or a C toolchain at
  install time on customer machines. This is the real recurring cost and it is not small;
  it is the thing `prebuildify` exists for and the thing that breaks on the platform you did
  not test.
- A **29.7 MB generated `parser.c`**, vendored or generated at install.
- Re-doing it on each upstream release, plus a fork-vs-upstream diff to review.

**What it does *not* buy.** I tried to fix `async` on top. Adding `'async'` to
`_reserved_identifier` produces an LR conflict against `modifier`; adding the conflict the
CLI suggests produces another, against `_lambda_expression_init_repeat1`. **The conflicts
cascade.** This is genuine grammar work of unbounded size, not a patch. So the fork buys
**18.88% → 8.62%**, not → 3.01%.

### (b) Roslyn syntax-only, repriced given §1

§1 removes the argument that .NET is required anyway. So Roslyn-in-parser **adds a hard .NET
runtime dependency that nothing else needs**, to a Node library running on arbitrary
customer checkouts. The hermeticity argument is undiminished — it is now the *only* thing
standing, and it stands cleanly.

Priced fairly, it buys more than the memo credited:

- **0% parse errors** — Roslyn was clean on all five constructs at both `CSharp12` and `CSharp13`.
- **No 32,767 limit**, so the callback path and its 8.51% of files disappear.
- **The `#if` `FRAGMENT` class disappears entirely**, because Roslyn preprocesses before
  parsing and never sees a split construct. That is the 1.60% irreducible residue *and* a
  large part of Q2's difficulty, gone.

That last point is the strongest argument for Roslyn and the memo did not make it.

### (c) Accept and classify

On 0.23.1: 18.88%, 14.15% after an `async` fix that does not exist. Too high — and the
failure truncates files rather than dropping single rows, so the row loss is worse than the
file percentage.

On the fork: **8.62%**, floor 3.01% if `async` is ever fixed upstream.

### Recommendation

**Option (a), the fork, pinned and vendored** — 8.62%, with the residual classified and both
defects filed upstream. It keeps hermeticity, keeps `tree-sitter ^0.21.1`, keeps Groovy
working, and is a built artifact rather than a plan.

**But this is now a genuine judgement call and I want to be explicit about the axis:** (b)
buys 8.62% → 0%, removes the 32 KB workaround, and dissolves the `FRAGMENT` class, at the
price of a .NET runtime on every machine that runs the parser. If the human weights
"the fact base is complete on modern C#" above "the parser is a self-contained Node library",
(b) is the better answer and I would not argue against it. I recommend (a) because the
hermeticity constraint reads as a product constraint rather than an engineering preference —
if that reading is wrong, the recommendation flips.

---

## 3. The gate for the CLASS — prototyped, not described

The collection-expression defect is silent: correct position, wrong kind, invisible to
recall, completeness and error counts. A fixture asserting "this span is a collection
expression" catches the *instance*. The **class** is *one grammar node type carrying two
meanings*, and this catches it:

**A. Span-aligned kind agreement.** For every byte span where Roslyn and tree-sitter both
produce a node, the IR kind we would emit must agree with the kind Roslyn's `SyntaxKind`
maps to.

**B. Node-type injectivity audit — the class-level check.** For each tree-sitter node type
we consume, collect the Roslyn `SyntaxKind` set observed at the same span across the corpus.
If no single kind is common to every occurrence, the type is **overloaded** and must sit on
an explicit allowlist with a documented disambiguator and a test proving it separates.

**This is the exact inverse of the enum-emission audit.** That one finds a declared value
never emitted; this one finds one node type carrying two meanings. Same discipline, same
explicit-allowlist shape, opposite direction.

### It works, and it can fail

Against **0.23.1**, on a 12-line fixture, with no knowledge of the bug:

```
INJECTIVITY VIOLATIONS: 2
  element_binding_expression: no single Roslyn kind fits all 6 occurrences
      CollectionExpression       e.g. "[1, 2, 3]" (parent=variable_declarator)
      ElementBindingExpression   e.g. "[0]"       (parent=conditional_access_expression)
  argument: no single Roslyn kind fits all 11 occurrences
      ExpressionElement / SpreadElement / Argument
```

Against **the fork / 0.23.5**, same gate, same fixture: both violations gone — **and it
surfaces a new real one**, `collection_element` conflating `ExpressionElement` and
`SpreadElement`. So it returns non-null on a broken grammar, null on the fixed one for the
known defect, and still finds what remains.

**Harness correction, because most of what this finds is the harness.** The first version
flagged `integer_literal` too. That was a false positive: Roslyn nests wrapper nodes at
*identical* spans (`ExpressionElement` wraps the literal inside it), so "the Roslyn kind at
a span" is a **set**, not a value. Comparing against the outermost alone manufactures
violations. Corrected rule: a type is consistent if some single kind appears in the
candidate set of every occurrence.

### Where it lives

Check B needs Roslyn, so it runs in **`../parser-oracle/csharp/`** and freezes its output.
`src/test/csharp-gates/` asserts the frozen allowlist — no `dotnet`, no network, per §3 of
the brief. The allowlist is the deliverable: every overloaded node type we accept is written
down with its disambiguator, so the day a grammar bump changes one, it is a named gate
failure rather than a silent reclassification.

---

## 4. Summary

| | finding |
|---|---|
| **contradiction** | **Resolved. .NET not required.** 33/33 `DefineConstants` declarations resolve from XML; the implicit table reproduces MSBuild exactly for 6 TFMs. My earlier "needs MSBuild" claim is **retracted** — it was a regex flagging an extension hook that is never defined. |
| **bisection** | 0.23.1: 18.88% → 14.15% after `async`. 0.23.5/fork: 8.62% → 3.01%. Floor splits 1.60% `#if`-irreducible / 1.41% grammar. |
| **(a) fork** | **Built and working.** 0.23.5 grammar at ABI 14 + CJS binding, on unchanged tree-sitter 0.21.1. 8.62%. Cost: prebuild matrix. Does **not** fix `async` — conflicts cascade. |
| **(b) Roslyn** | Repriced **up**: 0% errors, no 32 KB limit, and the `#if` `FRAGMENT` class disappears. Cost: a .NET runtime as a hard dependency. Hermeticity is now the only argument against — and it is clean. |
| **(c) accept** | 8.62% on the fork, classified. 18.88% on 0.23.1 is too high. |
| **gate** | Prototyped. Span-aligned kind agreement + **node-type injectivity audit** with an allowlist. Catches the class, demonstrated to fail on the broken grammar and pass on the fixed one. |

**Still no schema, no relation, no parser source.** Stopping again.
