# C# front end — Phase 0 decision memo

**Status:** awaiting human ruling. No schema, no relation, no parser source exists on this
branch. Two questions, each answered with a measurement.

Branch `cs-oracle` off `c-sharp` off `main`. Nothing here merges to `main`.

> **Process note.** `c-sharp` and `cs-oracle` were created early in this session and both
> were **deleted underneath me** while I was measuring — the shared-checkout hazard §2 of the
> worktree protocol warns about. They have been recreated. If they vanish again, everything
> below is reproducible from the scripts named in §4.

---

## 0. The corpus

| repo | stratum | files scanned |
|---|---|---|
| multitarget-A | multi-targeting, `#if`-heavy | 942 |
| multitarget-B | multi-targeting | 216 |
| bcl-slice-A (System.Text.Json, Collections, Linq, Memory, Numerics) | BCL-style | 791 |
| linq-heavy-A | LINQ-heavy, modern C# 12 | 5,756 |

**7,725 `.cs` files discovered, 20 generated excluded (`*.Designer.cs`, `*.g.cs`,
`*.generated.cs`, `*.AssemblyInfo.cs`), 7,705 scanned, 100.0 MB.** `obj/`, `bin/` and
`packages/` excluded by path.

No held-back stratum has been selected. That is deliberate — choosing it before the schema
is settled invites fitting the schema to it — and it is `cs-corpus`'s to close. Note also
that three strata from §4 of the brief are **not** represented here: source-generator-using
code, old-style C# 5/6, and modern app code. Every number below describes library code.

---

## 1. Question one — the parse layer

### Recommendation: **`tree-sitter-c-sharp@0.23.1`, Roslyn confined to the out-of-process oracle.**

Adopt it — but **1(b) failed**, and per instruction that is the headline, not a footnote.

### 1(a) Peer range — checked first, and it composes

The repo pins `tree-sitter ^0.21.1`, resolving to **0.21.1**.

| grammar version | peer range | composes with `^0.21.1` |
|---|---|---|
| 0.21.1 / 0.21.2 / 0.21.3 / 0.23.0 | `^0.21.0` | yes |
| **0.23.1** | **`^0.21.1`** | **yes — exact match** |
| 0.23.5 (latest) | `^0.25.0` | **no** |

Verified by installing, not by reading metadata: `tree-sitter@0.21.1` +
`tree-sitter-c-sharp@0.23.1` installs with **no peer warnings**, loads, and parses.

**The check can fail**, confirmed on purpose: `tree-sitter@0.21.1` + `0.23.5` is a hard npm
`ERESOLVE` refusal, not a warning.

**0.23.5 has a second, independent barrier.** Its Node binding is **ESM-only with a
top-level await**, so `require()` fails outright with `ERR_REQUIRE_ASYNC_MODULE`. Every
parser in this repo is CommonJS. Even with the peer range satisfied, 0.23.5 could not be
loaded the way `java-parser.ts` loads `tree-sitter-java`.

**And the upgrade path is blocked by Groovy, not by C#.** If anyone proposes moving the repo
to `tree-sitter@0.25` to get 0.23.5:

| grammar | latest | peer range |
|---|---|---|
| `tree-sitter-java` | 0.23.5 | `^0.21.1` — fine either way |
| `tree-sitter-python` | 0.25.0 | `^0.25.0` (0.23.6 available for the old line) |
| **`tree-sitter-groovy`** | **0.1.2 — the only release that exists** | **`^0.21.1`** |

There is no Groovy grammar above 0.1.2. A `tree-sitter@0.25` bump strands it.

### 1(b) Grammar completeness — **this is the failure**

52 modern-C# constructs probed; 46 clean and producing the expected node. **Three of the six
misses were my own wrong node names, not grammar gaps** — the grammar produces
`preproc_nullable`, `or_pattern`/`and_pattern` and `global_attribute` where I had guessed
otherwise. Correcting the harness before reporting is §7, and it removed half the apparent
failures.

Of the four constructs the brief names specifically: **file-scoped namespaces, records and
primary constructors all parse correctly** (including multi-line primary constructors with
base-class argument lists, which I checked separately because a real linq-heavy-A failure looked
like one). **Collection expressions do not.**

Five real defects, and the interesting column is the last one:

| # | construct | 0.23.1 | 0.23.5 |
|---|---|---|---|
| 1 | **`async` as an ordinary identifier in expression position** (`if (async)`, `async ? a : b`, `F(q, async: true)`) | **ERROR** | **still ERROR** |
| 2 | C# 13 `allows ref struct` | ERROR | **still ERROR** |
| 3 | C# 12 semicolon-body type (`class C;`, `struct S;`, `interface I;`) | ERROR | fixed |
| 4 | C# 13 params collections (`params ReadOnlySpan<int>`) | ERROR | fixed |
| 5 | **C# 12 collection expressions — silently MANGLED, no ERROR** | wrong node | fixed |

**Defect 5 is the dangerous one**, and it is §4's lesson exactly — a correctly-positioned
node with the wrong kind is invisible to every count-based check. `int[] x = [1,2,3];`
produces `element_binding_expression` with `argument` children, in **every** position
(field initialiser, local, argument, return, nested). Spread `..a` becomes
`range_expression`. Nothing errors. A recall check would report 100%.

It is recoverable but only by a rule that must be written down: `element_binding_expression`
is **overloaded**. Its other use is the null-conditional index `a?[0]`, which I verified
produces the same node — disambiguated **only** by the parent being
`conditional_access_expression`. The real indexer `dict[1,2]` is a different node
(`element_access_expression`), so the ambiguity is two-way, not three-way.

**Defect 1 is the expensive one, because its blast radius is not local.**

```
50 clean classes                  -> 50 methods, 50 classes recovered
50 clean classes, 1 bad in middle -> 25 methods, 25 classes recovered
real linq-heavy-A file (2,110 chars)   ->  0 methods recovered of 9
```

One `async`-as-identifier occurrence **truncates the remainder of the file**. This is not a
missing row; it is every row after the first occurrence.

At corpus scale: **1,455 of 7,705 files (18.88%) carry a parse ERROR.**

| repo | error files | rate |
|---|---|---|
| `linq-heavy-A` | 1,205 / 5,756 | 20.9% |
| `bcl-slice-A` | 128 / 791 | 16.2% |
| `multitarget-B` | 31 / 216 | 14.4% |
| `multitarget-A` | 91 / 942 | 9.7% |

**365 of the 1,455 (25.1%) are confirmed as defect 1 by deletion** — renaming the
identifier `async` and re-parsing makes the file parse. All 365 are in linq-heavy-A, 30.3% of its
failures. A regex claiming the cause would have been a guess; removing the cause is proof.
The remaining 1,090 cluster on defect 3 (`class C;` — 36+29+17+12+8 in the top clusters) and
on `#if`, which §2 covers.

**Roslyn parses all five, cleanly.** Verified, not assumed — `Microsoft.CodeAnalysis.CSharp`
4.12.0 on SDK 8.0.401, `CSharpSyntaxTree.ParseText`, at both `CSharp12` and `CSharp13`:
ten of ten clean.

### 1(c) The 32,767-character limit — applies, and the workaround transfers

**CORRECTED (v1.4), and the correction is methodological.** What I measured was:

```
largest source DIRECT parsing handles fully : 32,712 chars (468 members)
first size that fails                       : 32,783 chars (469 members)
```

I bisected on **member count**, so my granularity was one member — about 70 characters — and
the bracket `[32,712, 32,783]` straddles 32,767. I then wrote "the boundary is 32,767". That
was **inference from a bracket plus a plausible round number** (2^15 − 1), not a measurement,
and it should not have been stated as one.

**cs-fixtures established the value**, bisecting on characters directly against the patched
grammar:

> **The limit is exactly 32,767 characters. 32,767 parses; 32,768 throws.**

My bracket is consistent with that and does not establish it. The corrected value is
cs-fixtures'.

**And it counts CHARACTERS, not bytes.** A 32,767-character source containing 1,000 non-ASCII
characters is 33,767 bytes and **parses**. Two consequences:

1. The threshold test must use `sourceCode.length`, never `Buffer.byteLength`.
2. **A boundary fixture generated by byte count cannot demonstrate the throw.** Build the
   "must fail" file to 32,768 *bytes* and, if any character is non-ASCII, it is still under
   32,768 *characters* — so it parses, the assertion never fires, and the gate is **vacuous
   while looking green**. That is the unsafe direction, and it is a gate defect rather than a
   parser one.

It **throws**; it does not truncate silently. The callback workaround from
`java-parser.ts:38-47`, ported verbatim in shape (8 KB chunks, threshold 30,000), recovers
**469/469** members at the boundary and **3,000/3,000** at 222 KB.

**It transfers faithfully, and I checked rather than assumed.** Files in the
(30,000, 32,767] window can be parsed *both* ways, so any difference is the callback and not
the file. Over the 56 such files in the corpus:

| | files |
|---|---|
| clean both ways | 35 |
| ERROR both ways | 21 |
| **clean direct, ERROR via callback** | **0** |
| **differing node counts** | **0** |

This matters because the raw numbers invite the wrong conclusion: files over 30 KB error at
55–57% against 15–18% for smaller files, which reads as "the callback corrupts trees". It
does not. Large files are simply harder files. The controlled comparison is what separates
the two, and without it I would have filed a defect against the workaround.

**656 of 7,705 files (8.51%) exceed 32,767** — the common path for real C#, as the brief
predicted from Python.

### Why not Roslyn in the parser

Roslyn's syntax-only `CSharpSyntaxTree.ParseText` is the better parser, and §1(b) quantifies
by how much: it is clean on all five constructs where tree-sitter is not, and it has no
32 KB limit.

It is rejected because it makes **a .NET runtime a hard dependency of the parser process**.
The parser is a Node library that runs on arbitrary customer checkouts; shelling out to
`dotnet` per file or per run is a different product. That argument is hermeticity, and it is
the same one §0 of `BUILDING-A-PARSER.md` makes for keeping `ts.Program` out of the
TypeScript parser.

**It is not a speed argument.** Roslyn would not be slower, and this memo does not claim it
would be.

> **On using the official parser's output.** There is a real third option — consume compiled
> output, the way the JDK's ClassFile API lets a Java tool read `.class` metadata without
> parsing source. For C# that means assembly metadata via `System.Reflection.Metadata`. It is
> worth stating why it is not proposed for the *parser*: it requires the project to have been
> **built**, which is a stronger environmental precondition than a .NET bcl-slice-A, not a weaker
> one; and it discards the thing this IR is made of — byte ranges, line numbers and the
> expression tree. Metadata has no statement bodies and no call sites. Where the official
> parser genuinely is the right answer is exactly where this memo already puts it: the
> **oracle**, out of process, authorising expectations the in-repo gate then checks frozen.

### What I would expect to see if I were wrong

A peer range that does not compose (it does), or an error rate in the low single digits with
no cascading failures — i.e. tree-sitter being merely incomplete rather than
non-recovering. The 0-of-9-methods result on a real file is what makes defect 1 a blocker
for linq-heavy-A-shaped code rather than a known gap.

### Consequences the human should weigh before ruling

1. **Defects 1 and 2 are unfixed in every published version.** They need upstream issues and
   a recorded expectation that ~19% of files in linq-heavy-A-shaped corpora will not parse until
   then. The `cs-corpus` agent must not read that as a parser defect.
2. **Defect 5 needs a schema-level decision now**, not later: `element_binding_expression`
   means two different things, and the disambiguation rule (parent is
   `conditional_access_expression`) belongs in the schema document before any row exists.
3. If the ~19% is judged unacceptable, the honest alternative is **not** Roslyn-in-parser but
   **vendoring a patched grammar** — which is a real cost and a real maintenance burden, and
   should be decided deliberately rather than discovered.

---

## 2. Question two — `#if`, and what "the source" is

### Recommendation: **Option 3 — one emission per target framework, framework in `cs_module`'s primary key — with the `DefineConstants` set supplied as an INPUT, never inferred.**

### The divergence, demonstrated rather than asserted

Same seven lines of source, both parsers:

```
tree-sitter 0.23.1  -> 2 methods:  System.Span<byte> | byte[]
Roslyn 4.12         -> 1 method,  selected by DefineConstants:
    DefineConstants=[]                   -> byte[]
    DefineConstants=[NET8_0_OR_GREATER]  -> System.Span<byte>
```

The parser emits two rows where the oracle can adjudicate one. Every such row is a
disagreement that is not a parser defect.

### The measurement the brief asked for

**726 of 7,705 files (9.4%) contain `#if`; 2,091 outermost regions; 718 carry an `#else`.**

Each region's first branch was lifted out and classified by what it can stand as. The
classifier was verified to return **all six labels on purpose** before its output was
trusted — and it needed that, because the first version reported `STATEMENT: 0` in every
repo. C# 9 top-level statements make a bare `Log();` parse clean at file level, so the
"is it a compilation unit" test matched everything and the ordering was wrong.

| what the region guards | regions | share |
|---|---|---|
| `TYPE_LEVEL` — whole `using`s / whole types | 687 | 32.9% |
| `STATEMENT` — statements inside a body | 526 | 25.2% |
| `DECLARATION` — type members | 500 | 23.9% |
| **`FRAGMENT` — splits a construct** | **354** | **16.9%** |
| `ENUM_MEMBERS` | 22 | 1.1% |
| `EMPTY` | 2 | 0.1% |

**Declaration-level (`TYPE_LEVEL` + `DECLARATION` + `ENUM_MEMBERS`) = 1,209 = 57.8%.
Statement-level = 526 = 25.2%. A `#if` guards a declaration 2.3× more often than a
statement inside a body.**

So the brief's escape hatch — "if it is rare, the cost of option 2 is small and known" — is
**closed**. It is not rare. Option 2 discards declarations in 57.8% of regions, and those
are precisely the rows the engine resolves against.

### The category the brief does not anticipate

**16.9% of regions are `FRAGMENT`: the `#if` splits a syntactic construct**, not a
declaration and not a statement. Real examples:

```csharp
public class JObject : JContainer
#if HAVE_COMPONENT_MODEL
    , ICustomTypeDescriptor          // splits a BASE LIST
#endif

    else if (value is DateTimeOffset d)   // splits an IF/ELSE CHAIN
    case PrimitiveTypeCode.DBNull:        // splits a SWITCH BODY
    , int extraParam                      // splits a PARAMETER LIST
```

This is concentrated, not uniform — **multitarget-B 103/188 = 54.8%**, bcl-slice-A 114/461 = 24.7%,
multitarget-A 135/1,316 = 10.3%, linq-heavy-A 5/126 = 4.0%.

It matters because **it caps option 1**. "Emit the union of all branches with a condition
column" presumes both branches are independently parseable. For one region in six they are
not — there is no tree in which `, ICustomTypeDescriptor` is a node. These are also a large
part of the residual parse errors in §1(b): tree-sitter cannot nest them, so the region
becomes an `ERROR`.

### Does the `emissionRegime` precedent actually fit?

Partly, and I would rather say where it does not than lean on it.

**It fits in mechanism.** Both put a token in the module's primary key so that otherwise
identical rows from the same file stay distinct, and both make a re-emission under different
conditions a visible key change rather than a silent overwrite. That is the right shape.

**It does not fit in three respects:**

1. **Cardinality.** `emissionRegime` has one live value (`ts6-inproc`) and one reserved
   (`ts7-tsserver`). `TargetFramework` has as many values as the project multi-targets. In
   this corpus 11 of 73 `.csproj` files multi-target — bounded, but it means the fact base
   for those projects multiplies, and `cs_module`'s row count is no longer one per file.
2. **Origin.** `emissionRegime` is chosen by *us* and is deliberately coarse — the constants
   file is explicit that a version string in a key would churn every golden file for a patch
   release. `TargetFramework` is chosen by *the project under analysis*. We do not control
   its cardinality or its churn.
3. **Derivability, and this is the one that bites.** `emissionRegime` is a constant we write
   down. `DefineConstants` is not derivable by reading the `.csproj`:
   - **47 of the `TargetFramework` values in this corpus are MSBuild property references** —
     `$(DefaultNetCoreTargetFramework)`, `$(NetCoreAppCurrent)`, `$(NetMinimum)` — resolvable
     only by evaluating MSBuild.
   - multitarget-A's symbols are **authored, not computed**: `HAVE_BIG_INTEGER`,
     `FEATURE_DEFAULT_INTERFACE`, `HAVE_DATE_TIME_OFFSET`. Nothing derives those from a TFM
     string. The top conditions corpus-wide are `DNXCORE50` (231), `DEBUG` (144),
     `!NET20` (117), `FEATURE_DEFAULT_INTERFACE` (96).

**Therefore the recommendation has a second half, and it is the load-bearing half:** the
active `DefineConstants` set must be a **parser input** — configuration, defaulted to a
documented constant, recorded in the module row — and must **never** be inferred from the
`.csproj`. Inferring it requires MSBuild evaluation, which requires a .NET bcl-slice-A, which
reintroduces exactly the dependency §1 rejects Roslyn-in-parser to avoid.

So: option 3 for the key shape, with an explicit input for the conditions, and a
`FRAGMENT`-region escape that is recorded as unrepresentable rather than emitted wrong.

### What I would expect to see if I were wrong

`#if` guarding statements far more often than declarations — which would make option 2 cheap
and this whole question a footnote. The measured ratio is 2.3:1 the other way. I would also
expect `FRAGMENT` near zero; at 16.9%, and 54.8% in multitarget-B, option 1 cannot be made
complete no matter how the condition column is designed.

---

## 3. Pinned constants, recorded now because unpinned they drift

Proposed for `../parser-oracle/csharp/harness/constants.ts`, following
`python/harness/constants.ts`:

| constant | value | why |
|---|---|---|
| `ROSLYN_PACKAGE_VERSION` | **`4.12.0`** | `Microsoft.CodeAnalysis.CSharp`. Verified working. |
| `LANG_VERSION` | **`CSharp13`** | Set explicitly. Under 4.12.0, `LanguageVersion.Latest` maps to `CSharp13` — but `Latest` is a moving target by definition and must not be what an expectation is blessed under. |
| `TARGET_FRAMEWORK` | **`net8.0`** | The adjudication default. |
| `DEFINE_CONSTANTS` | **`[]`** plus the per-project set, supplied as input | Not inferable; see §2. |
| `EMISSION_REGIME` | `roslyn4-oop` | Coarse, naming the mechanism, matching the TypeScript convention. |
| grammar | `tree-sitter-c-sharp@0.23.1` | Pinned exactly, not `^`. |

**One correction to the brief.** It says "the Roslyn/SDK version … decides which
`LangVersion` parses". Measured: the **NuGet package version decides**, and it is decoupled
from the installed SDK. Roslyn 4.12.0 gives `CSharp13` on SDK **8.0.401**, which is a C# 12
SDK and the only one on this machine. So the oracle needs the package pinned, and the SDK
only needs to be new enough to build a `net8.0` console app. That is a materially weaker
environmental requirement than "install the .NET 9 SDK", and it is worth having measured.

---

## 4. Reproducing

Throwaway probes, outside the repo, under the session scratchpad `cs/`:
`probe/constructs.js` (52-construct sweep), `probe/collexpr.js` (defect 5),
`probe/limit.js` (limit bracket — superseded by cs-fixtures' character bisection), `probe/callbackctl.js` (callback control),
`probe/scan.js` (corpus census), `probe/errdecomp.js`, `probe/firsterr.js`,
`probe/asyncattrib.js` (confirm-by-deletion), `probe/ifcensus.js` + `probe/verify.js`
(§2 census and its self-check), `roslyn/` (Roslyn 4.12 probe). None is a deliverable.

---

## 5. Summary

| # | question | recommendation | headline |
|---|---|---|---|
| 1a | peer range | `tree-sitter-c-sharp@0.23.1` | peers `^0.21.1` exactly; 0.23.5 needs `^0.25.0` **and** is ESM-only; upgrade blocked by `tree-sitter-groovy`, which has one release |
| 1b | grammar completeness | **adopt, but this failed** | **18.88% of 7,705 files carry a parse ERROR**; `async`-as-identifier truncates the rest of the file (0 of 9 methods on a real file) and is unfixed in every version; **collection expressions are silently mangled, not errored** |
| 1c | 32,767 limit | port the `java-parser.ts` callback | limit is **exactly 32,767 characters** (32,767 parses, 32,768 throws) — established by **cs-fixtures**; my member-count bisection only bracketed it. Workaround verified **faithful** (0 differences on 56 files parseable both ways); 8.51% of files exceed it |
| 2 | `#if` | **option 3**, defines as an input | `#if` guards a declaration **2.3× more often** than a statement (57.8% vs 25.2%), so option 2 is not cheap; **16.9% split a construct**, so option 1 cannot be complete |

**Stopping here.** No schema, no relation, no parser source. On a ruling I will build
`../parser-oracle/csharp/` and return with the schema for a second approval.
