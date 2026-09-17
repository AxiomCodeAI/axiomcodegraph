# C# Phase 0 — addendum 2: async is patchable, and (a) holds

Answers 1–3. **`async` is fixed in the fork.** The conditional on the ruling is met.

Ruling recorded: hermeticity is a product constraint per §0 of `BUILDING-A-PARSER.md`
("no network, no install step and no lockfile resolution … cacheable and diffable"), and C#
gets the same answer TypeScript got. **Option (a), the fork.**

---

## 0. The headline

| | 0.23.1 | fork (0.23.5 @ ABI 14) | **fork + async patch** |
|---|---|---|---|
| files with a parse error | 18.88% | 8.62% | **3.01%** |
| of corpus, **truncating** | — | 1.27% | **0.32%** |
| **declarations lost vs Roslyn** | — | 6.44% | **0.37%** |
| declaration **recovery** | — | 93.56% | **99.63%** |
| linq-heavy-A error rate | 20.9% | 8.8% | **1.3%** |

**99.63% of declarations recovered, 0.37% lost — 477 of 129,151.**

---

## 1. Of the 8.62%, how much truncates?

You were right that these must not share a percentage. Bucketed by the fraction of file
bytes inside a maximal `ERROR` node:

**On the unpatched fork (8.62%):**

| | files | of errors | of corpus |
|---|---|---|---|
| `LOCAL` (<5% of bytes in ERROR) | 500 | 75.3% | 6.49% |
| `PARTIAL` (5–50%) | 66 | 9.9% | 0.86% |
| **`TRUNCATING` (>50%)** | **98** | **14.8%** | **1.27%** |

### The proxy is validated, not assumed

"Bytes inside ERROR" is a proxy. Checked against Roslyn's declaration counts, on files
**without** `#if` (Roslyn parses one branch, tree-sitter both, so `#if` files are not
comparable and their difference is not the defect being measured):

| bucket | n | declarations recovered vs Roslyn |
|---|---|---|
| `LOCAL` | 120 | **98.0%** |
| `PARTIAL` | 62 | 50.6% |
| `TRUNCATING` | 83 | **22.7%** |

Cleanly monotonic, so the buckets mean what they say.

### The number that replaces the file percentage

Weighting by declarations rather than files, corpus-wide (6,979 comparable files, 129,151
declarations):

- unpatched fork: **93.56% recovery, 6.44% lost**
- **patched fork: 99.63% recovery, 0.37% lost**

So 8.62% was indeed overstating the damage — three quarters of it recovers locally — but
1.27% truncating was still real, and it is now 0.32%.

---

## 2. `async` is patchable. Here is the patch.

**And my "the conflicts cascade, unbounded" was wrong.** I added two conflicts by hand, saw
a third suggestion, and concluded it did not terminate. I should have automated it instead
of extrapolating from two data points. Automated, **it converges on round 3**:

```
round 1: added [$.modifier, $._lambda_expression_init, $.anonymous_method_expression, $._reserved_identifier]
round 2: added [$.modifier, $._lambda_expression_init, $._reserved_identifier]
round 3: GENERATE SUCCEEDED
```

The whole patch is **three lines** of `grammar.js`: `'async'` added to
`_reserved_identifier` (the contextual-keyword list it was missing from — it was only ever
in `modifier`), plus the two conflict declarations above.

### It fixes the bug and does not break the modifier

```
--- the async bug ---            --- async as a MODIFIER still works ---
ok  if (async) { }               ok  async Task M(){ }
ok  async ? a : b                ok  async () => 1
ok  F(q, async: true)            ok  async delegate { }
ok  var x = async;               ok  async (int x) => x
ok  await X(async)               ok  public static async Task M(){ }
```

No regression on anything the fork had already fixed — collection expressions with spread,
`class C;`, `params ReadOnlySpan`, null-conditional `a?[0]`, LINQ query syntax.

### And it costs nothing measurable

- **Injectivity gate**: same single violation as unpatched upstream (`collection_element`
  conflating `ExpressionElement`/`SpreadElement`). The patch introduces **no new ambiguity**.
- **Parse speed**: 7.4 MB/s patched vs 6.0 MB/s unpatched 0.23.5. Not slower; the
  difference is loader and JIT noise, not a real speedup.
- **Determinism**: two runs over 400 files, byte-identical tree digests.

---

## 3. What was between 8.62% and 3.01%

**It was entirely `async`.** 8.62% − 3.01% = 5.61%, and the patched fork lands exactly on
3.01% / 232 files — the floor, reached. No other cause lived in that gap.

### And the 3.01% floor, named

| | files | of corpus |
|---|---|---|
| contains `#if` — **irreducible for any both-branches parser** | 123 | **1.60%** |
| genuine grammar residue | 109 | **1.41%** |

The 1.41%, clustered and each confirmed by reducing it to a one-liner:

| construct | status |
|---|---|
| huge linq-heavy-A generated compiled-model baselines (`BigModel/*EntityType.cs`) | ~27 files; generated output, classify as provenance |
| **null-conditional element *assignment*** `a?[i] = v` | ERROR — a real gap, distinct from `a?[0]` which parses |
| **`allows ref struct` on a delegate declaration** | ERROR — C# 13, known |
| **pointer-deref assignment** `*(Vector2*)d = s` | ERROR — `unsafe` |
| **collection expression as a bare argument** `F([p])` | ERROR — narrower than the fixed cases |

All four are candidates for the same treatment as `async`, and all four should be filed
upstream regardless. None is load-bearing at 1.41% combined.

---

## 4. The fork, as a thing to maintain

Recipe, reproducible and already executed:

1. `grammar.js` + `src/scanner.c` from `tree-sitter-c-sharp@0.23.5`.
2. Three-line patch: `'async'` into `_reserved_identifier`, two conflict entries.
3. `tree-sitter generate --abi 14` (`tree-sitter-cli@0.25.10`).
4. Three-line CommonJS binding replacing the ESM/top-level-await one.
5. `node-gyp rebuild` — 8.5 s.

Loads on **unchanged `tree-sitter ^0.21.1`**, so Groovy and the other two grammars are
untouched. The costs from addendum 1 stand and are the real ones: a **prebuild matrix**
(darwin-arm64/x64, linux-x64/arm64, win32-x64) or a C toolchain at install, a 29.7 MB
generated `parser.c`, and a fork-vs-upstream diff to review per release. The patch itself is
three lines, which is the part that keeps the diff reviewable.

---

## 5. Injectivity-audit allowlist — carried into the schema, as instructed

Every overloaded node type gets a row: the type, its disambiguator, and the assertion that a
grammar bump changing it is a **named gate failure**, never a silent reclassification.

| node type | meanings | disambiguator | on the patched fork |
|---|---|---|---|
| `collection_element` | `ExpressionElement` \| `SpreadElement` | child is `..expr` → spread, else element | **live — must be allowlisted** |
| `element_binding_expression` | `CollectionExpression` \| `ElementBindingExpression` | parent is `conditional_access_expression` → index binding, else collection expression | **resolved** by the fork; retained as a **zero-row assertion** so a regression is named |

The second row is the pattern §4 asks for: a reserved entry with a zero-row assertion, so
the day it comes back it surfaces as a named failure rather than as rows nobody noticed.

---

## 6. Two instrument errors in this phase, both mine

Recording these because both produced a confident wrong answer from a correct-looking
measurement, which is what §7 is about.

1. **`-getProperty:DefineConstants` omits the `_OR_GREATER` symbols** — they are added
   during the build, not at evaluation. An official tool, a short plausible answer, wrong.
   **The csc command line (`dotnet build -v:diag`, grep `/define:`) is the ground truth.**
   The next person will reach for the flag; this is why the table is verified against csc.
2. **"The conflicts cascade, unbounded"** — extrapolated from two hand iterations. Automating
   the loop converged on round 3. Two data points are not a trend, and the cost of being
   wrong here was nearly recommending Roslyn against a ruled constraint.

---

## 7. Summary

| # | question | answer |
|---|---|---|
| 1 | how much of 8.62% truncates | 1.27% of corpus (14.8% of errors); 75.3% recover locally at 98.0% declaration recovery. Proxy validated against Roslyn, monotonic 98.0 / 50.6 / 22.7 |
| 2 | is `async` patchable | **Yes — three lines.** Converges in 2 conflicts. Modifier still works, no regressions, no new ambiguity, no slowdown, deterministic. **8.62% → 3.01%**, truncating **1.27% → 0.32%**, declarations lost **6.44% → 0.37%** |
| 3 | what was the 5.6% | **Entirely `async`.** The floor is reached. It is 1.60% `#if`-irreducible + 1.41% grammar, the latter named to four constructs |

**(a) holds.** Hermeticity is kept, `tree-sitter ^0.21.1` is untouched, and the operating
point is **99.63% declaration recovery**.

Still no schema, no relation, no parser source. Ready for the schema on your word.
