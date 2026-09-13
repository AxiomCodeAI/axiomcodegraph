# JavaScript front end — Phase 0 decision memo

**Status:** awaiting human ruling. No schema, no relation, no parser source exists on this
branch. Three questions, three recommendations, and the measurement behind each.

**All three were independently re-measured in a later session on a rebuilt corpus with freshly
written probes (§5). Thirteen of fifteen headline claims reproduced; one was qualified and one
did not reproduce and is marked in place.** §6 adds Node/V8 as the second implementation, with
its competence boundary.

**Phase-0 review: Q1 approved (two front ends, `js_*`), Q3 approved (emit normally with a
module-system column). Q2 was held pending a filtered rate, a negative control and a residual
split — all three are in §7. §8 closes the two open items.**

Branch `js-oracle` off `js` off `main`. Nothing here merges to `main`.

---

## 0. The corpus every number below is measured on

**This corpus is a library and framework *source* population, not "JavaScript".** 84.3% of
files are the CommonJS/prototype stratum, a one-file-per-method utility library alone is 38.2% of files and the top two
packages are 63.7%, and there is **no application code**. Every headline number below carries
that qualifier; §0.3 of the schema document states it in full and names the three distortions
it causes.

Stratified per §6 of `BUILDING-JAVASCRIPT.md`, then filtered. **3,170 `.js`/`.mjs`/`.cjs`/`.jsx`
files discovered, 140 excluded, 3,030 measured, 17.1 MB.** For scale, the TypeScript
front end's primary adjudication corpus (a mid-size TypeScript library) is 322 files and 2.7 MB.

| stratum | files | members |
|---|---|---|
| CommonJS / prototype-era | 2,382 | a runtime standard library 423, a bundler's own source 712, a one-file-per-method utility library 1,043, a CommonJS web framework 141, `a test runner` 63 |
| JSDoc-typed | 295 | a media library 123, a small UI library 115, a charting library 57 |
| JSX in `.js` | 165 | `a static-site framework/packages` 127, a small JSX application 38 |
| Pure ESM | 123 | a pure-ESM process library 105, a fetch polyfill 13, a globbing library 3, a spinner library 1, a concurrency helper 1 |
| Dual / transitional | 65 | a dual-published HTTP client 62, a terminal-colour library 3 |

### Exclusions, stated

**140 files excluded**, by content and path, never silently:
`BUILD_DIR` 94, `BUNDLER_PREAMBLE` 31 (bundler runtime preamble markers),
`LONG_LINE` 7 (>1,000 chars on one line), `GENERATED_MONOLITH` 4 (`a one-file-per-method utility library.js` and
friends — the concatenated build shipped beside the modules it was built from),
`SOURCE_MAP_COMMENT` 2, `MINIFIED_EXTENSION` 2.

**One selection decision that is not an exclusion, because it would be dishonest to
call it one.** a bundler's own source's repository carries 14,262 `.js` files, ~13,800 of them one- and
two-line synthetic compiler test cases under `test/`. They are hand-written, so no content
filter removes them, and left in they are **86% of the corpus** and would set every ratio in
this memo. I restricted a bundler's own source, a static-site framework, a small UI library, a media library, a charting library and a test runner to their
shipped source subtrees. That is a choice about what population these numbers describe, and
it belongs in the open rather than in a regex.

**The held-back corpus is now selected, and named before the schema was written** (§0.4 of
`JAVASCRIPT-FACT-SCHEMA.md`): **the Flow holdout** (v2 `src/`, Flow-annotated) and
**the application holdout** (server source, real application code). Neither has been
cloned, parsed or counted; no number in this memo or the schema comes from either. The Flow holdout is
chosen because it can falsify `declaredTypeSource = SYNTACTIC_FLOW`, which currently rests on
64 parameters in one package; the application holdout because §0.3 records that this corpus contains **no
application code at all**.

---

## 1. Question one — one front end or two?

### Recommendation: **Option B. JavaScript is its own front end, `js_*`.**

### The deciding measurement

Module edges, by where they are borne — 3,030 files:

| | edges |
|---|---|
| **expression-borne** (`require(…)`, `module.exports =`, `exports.foo =`, `Object.defineProperty(exports, …)`, dynamic `import()`) | **12,482** |
| **declaration-borne** (`import`/`export` declarations, `export` modifier, `export default`) | **2,986** |
| **expression-borne share** | **80.7%** |

The aggregate is not the finding, because it is a weighted average over a corpus I chose the
weights of. **The finding is that the distribution is bimodal at the file level:**

- **2,403 files are 100% expression-borne**
- **580 files are 100% declaration-borne**
- **30 files are mixed**
- per-file median expression-borne share: **100%**

Per stratum, it is nearly a step function:

| stratum | decl | expr | expr share |
|---|---|---|---|
| cjs-prototype | 200 | 11,943 | **98.4%** |
| jsx-in-js | 381 | 515 | 57.5% |
| dual | 224 | 7 | 3.0% |
| jsdoc-typed | 1,455 | 16 | 1.1% |
| esm | 726 | 1 | 0.1% |

Sensitivity, because a one-file-per-method utility library's 1,043 tiny per-method modules are a third of the file count:
whole corpus 80.7%; **minus a one-file-per-method utility library 74.2%**; **minus a one-file-per-method utility library *and* a bundler's own source 59.9%**. The
conclusion does not depend on the two biggest members.

Two supporting counts, both of which break the ported TypeScript traversal rather than just
the schema:

- **1,330 of 9,623 `require()` calls (13.8%) are not top-level statements** — 1,299 inside a
  function body, 31 inside a block or conditional. A module-edge extractor that walks the
  file's statement list, which is what `ts-import-extractor.ts` does because every TypeScript
  module edge is a top-level declaration, misses one require in seven.
- **33 `require(<non-literal>)`** — unresolvable by construction. They need a row that says so,
  not a guess and not silence.

### The column cost, both directions

The TypeScript column-order baseline is frozen and **append-only**
(`src/test/typescript-gates/column-order.baseline.json`, 20 relations, 471 columns).

- **Option A appends 27 JS-only columns across 12 of the 20 relations.** Each lands at the tail
  of its relation regardless of what it is about — `requireNestingKind` after
  `tsImportUniqueHash` — and each is permanently empty for every TypeScript row.
- In the other direction, **23 existing columns are structurally inapplicable to JavaScript**
  (`isTypeOnly` ×4, `isAmbient`, `isAbstract`, `returnTypeName`, `typeParameterCount` ×2,
  `isParameterProperty`, `targetTsVersion`, `strictBindCallApply`, …), permanently empty for
  every JavaScript row.

That column count is a hand classification of the frozen baseline, printed in full in the
probe script so it can be argued with. It is the weakest number in this memo and it is not
the one the recommendation rests on.

### The number that says these are different languages

TypeScript's schema is Java-shaped because **85.3% of parameters carry a type annotation**.
The same measurement on this corpus, 38,903 parameters:

| channel | parameters | share |
|---|---|---|
| syntactic type annotation | 64 | **0.165%** |
| JSDoc `@param {T}` / `@type` | 14,170 | **36.4%** |

Two things follow, and the second was a surprise.

1. The declared-type regime really is Python's, not Java's. 0.165% versus 85.3%.
2. **The brief's "approximately zero" is right about syntax and wrong about the language.**
   JSDoc supplies a real declared type for **36.4%** of parameters, `@returns` for 20.8% of
   functions, and it is wildly bimodal by package — a bundler's own source 66.9%, a one-file-per-method utility library 73.0%, a media library
   63.9%, against a CommonJS web framework 1.8% and a pure-ESM process library 0%. JSDoc is not a comment feature to bolt on
   later. It is *the* type channel, and §2 below shows it is also the single best predictor
   of whether anything resolves at all.

Alongside that: **6,459 of 31,063 functions (20.8%)** carry a JSDoc `@returns`, and
2,591 of 56,491 variable declarations (4.6%) carry a JSDoc `@type`.

And all 64 syntactic annotations are in a static-site framework, 6 of the files carrying an `@flow` pragma.
They are **Flow**, not TypeScript. See §3.

### Why this decides it

The argument in §1 of the brief is that in CommonJS the module graph lives in the expression
relation, so under Option A `ts_import` must accept rows minted by the expression extractor
— inverting the build order in §1 of `BUILDING-A-PARSER.md`, where expressions come *last*
because they reference everything else. The measurement says that is not an edge case to be
handled: it is **98.4% of module edges in the CommonJS stratum** and the majority form
corpus-wide. A front end whose primary module-edge path runs backwards through its own build
order is not a mode of another front end.

### What I would expect to see if I were wrong

Expression-borne share **under ~25% corpus-wide**, with no stratum above 50% — i.e. real JS
having largely moved to ESM and `require` surviving only in build scripts. I would also
expect the per-file distribution to be *unimodal and mixed* rather than 2,403-vs-580 at the
extremes, because a mixed distribution means one relation really can serve both and the
`isExpressionBorne` column is doing genuine work rather than partitioning the table in two.

---

## 2. Question two — what is the resolution ceiling?

### Recommendation: **build the oracle; write resolution gates, but banded and classified, never as one global rate.**

### The measurement, and the trap that had to be removed first

Method is deliberately identical to `../parser-oracle/typescript/oracle/resolution.ts`, which
measured **9,627 / 9,627 = 100%** on TypeScript: same `getResolvedSignature`, same three
call-like node kinds, same exclusion of declaration files. Only `allowJs: true, checkJs: true`
and the input changed. typescript@**6.0.3**, the pinned oracle compiler.

**The first run reported 100% resolved on every package, including a CommonJS web framework.** That is §7
exactly — a check incapable of returning failure. `getResolvedSignature` does **not** return
`undefined` when the callee is `any`; it returns tsc's internal **`anySignature`**, a signature
object with no declaration. A direct port of the TypeScript oracle to JavaScript reports a
perfect score on code it resolved nothing in.

Corrected partition — a signature *with a declaration* is the only real answer:

| outcome | JavaScript (128,126 calls) | TypeScript control (15,961 calls) |
|---|---|---|
| **RESOLVED** (signature + declaration) | **45.4%** | **99.4%** |
| **ANY_SIGNATURE** (oracle declines: callee is `any`) | **54.1%** | 0.3% |
| **SYNTHESIZED** (implicit ctor etc. — honest terminal) | 0.5% | 0.3% |
| no signature at all | 0.0% | 0.0% |

The control is the same classifier, the same compiler and `node_modules` present, run over
431 real TypeScript files (this repo's own `src/`). Without it the JavaScript number is
unattributable — 45.4% could have been the classifier or the compiler. It is the language.

### Environmental, classified before reporting

§7: missing `node_modules` accounted for 10,068 of a mid-size TypeScript library's 10,162 incomplete TypeScript
hand-offs. **Here it accounts for 3.7%.** Of 69,304 `any` declines, only 2,548 trace to a
module specifier that failed to resolve.

I installed dependencies for three packages and re-measured to check that claim rather than
assert it:

| package | RESOLVED, deps absent | RESOLVED, deps installed |
|---|---|---|
| a CommonJS web framework | 12.8% | **12.9%** |
| a media library | 75.2% | **75.2%** |
| a small UI library | 19.4% | **43.6%** |

The small UI library moves a long way; the web framework does not move at all. Its ceiling is genuinely ~13%
because a CommonJS web framework builds its API by mutating prototypes and assigning `module.exports = function(){}`,
so `app.use`, `req.*` and `res.*` are `any` no matter how complete the checkout is. **The
TypeScript lesson inverts here:** there, almost every incomplete hand-off was environmental
and reporting them as gaps would have been wrong. Here almost none are, and writing them off
as environmental would be the wrong call by the same margin.

### What predicts resolution — monotonic, and it is JSDoc

| JSDoc `@param` density of the file | files | calls | RESOLVED |
|---|---|---|---|
| 0% | 740 | 48,327 | **26.8%** |
| 1–25% | 134 | 18,259 | 38.2% |
| 25–50% | 202 | 15,728 | 58.1% |
| 50–75% | 315 | 18,434 | 61.5% |
| 75–100% | 888 | 23,070 | **73.2%** |

Monotonic across all five bands, a 2.7× swing. **(Re-measurement gets 24.1% → 74.1% with one
inversion at the 50–75% band — the swing holds, strict monotonicity does not. A gate must not
assert it. See §5.)** By comparison the module system moves it much
less: ESM-syntax files 61.1%, CJS-syntax files 42.1%, mixed 28.0% — and ESM files have
*lower* JSDoc density (28.3% vs 37.7%), so the two effects are separable and both real.

Range by package: **12.9% at the lowest to 82.9% at the highest.**

### Why gates are still worth writing

The failure mode of a 45.4% oracle is a gate that reads 54.1% declines as parser defects.
Three things stop that:

1. **`RESOLVED` / `ANY_SIGNATURE` / `SYNTHESIZED` is a partition and the oracle emits all
   three.** Only `RESOLVED` authorises an expectation. `ANY_SIGNATURE` is the oracle
   declining, recorded as such, and a gate that counts it as a miss has a ceiling of 45.4%
   and reports a defect population that does not exist.
2. **The gate bands by JSDoc density**, because a flat corpus-wide rate mixes a 26.8%
   population with a 73.2% one and a regression in either is invisible in the average.
3. **The gate is not vacuous where it applies.** 5,809 calls resolve against a symbol with
   several declarations, and **1,335 of them (23.0%) resolve to a declaration that is not the
   first**. **(⚠ CLOSED in §8.1: both numbers are correct about different questions. 61% of the time
   `sig.declaration` is not in the callee symbol's declaration list at all; counting those as
   "not first" gives 82.4%, excluding them gives 21.5% ≈ this 23.0%. Neither is a gate
   threshold — see §8.1 for the rule that replaces them.)** A parser that always picks the first declaration is wrong 23% of the time and
   would still pass a name-keyed expectation — the same failure the TypeScript oracle
   documents at 77.6%.

### What I would expect to see if I were wrong

JavaScript `RESOLVED` **above ~85%**, within striking distance of the TypeScript control, with
the `any` share concentrated in a few identifiable packages rather than spread across every
stratum. I would also expect installing `node_modules` to move a CommonJS web framework materially — if it had
gone 12.8% → 60%, the ceiling would be a checkout property and the whole recommendation
(band, classify, never gate on a global rate) would be unnecessary machinery.

---

## 3. Question three — ESM or CommonJS, and the script-kind call

### Recommendation: **emit normally. Never skip, never a `SkippedFileReason`. Carry `moduleSystem`, `moduleSystemSource` and a conflict flag as columns.**

### Who decides, measured

Nearest-ancestor `package.json` `"type"`, default `commonjs`, with `.mjs`/`.cjs` overriding:

| how the module system was decided | files | share |
|---|---|---|
| `package.json` present, **no `"type"` field** → default commonjs | 2,290 | **75.6%** |
| **no `package.json` at or above the file** → default commonjs | 421 | **13.9%** |
| `package.json` `"type": "module"` | 287 | 9.5% |
| `.cjs` extension | 18 | 0.6% |
| `.mjs` extension | 14 | 0.5% |

**89.5% of files are CommonJS by default rather than by declaration** — nothing states it. And
for 13.9% there is no governing file at all. Any column recording the module system must also
record *how it was decided*, or a defaulted CommonJS and a declared one are indistinguishable.

### How often real code contradicts its governing config

| contradiction | files | share |
|---|---|---|
| static `import`/`export` in a **CommonJS-governed** file | **309** | **10.20%** |
| `require()` in a **`"type": "module"`** file (illegal) | **0** | 0.00% |
| `module.exports` / `exports.x =` in a `"type": "module"` file | **0** | 0.00% |
| `import.meta` in a CommonJS-governed file | 0 | 0.00% |
| both systems in one file | 29 | 0.96% |

Two false positives were removed before counting, and without them the number would be
inflated and the recommendation made on a wrong basis: **`createRequire()` makes `require`
legal in an ESM file**, and **dynamic `import()` is legal in CommonJS** — only the static
declaration forms count.

The mismatch is entirely one-directional, and the 309 files are a media library (123),
a small UI library (102), a static-site framework (46) and a small JSX application (38). **Every one is bundler
input.** They are ESM source compiled by rollup, a bundler's own source or babel, in a package whose
`package.json` describes the *published CommonJS artefact*, not the source. Node's rule never
applies to them because Node never loads them.

So "contradicts its governing config" is really "**`package.json` `"type"` is not the authority
for build-time source**". Skipping these files would discard 10.2% of the corpus, including
the entirety of three of the five strata's source trees — a correctness loss to enforce a rule
that does not govern the file. Flag-and-emit costs one column and loses nothing.

### The JSX script-kind call: it does not have to be made

The brief and `ts-fact-extractor.ts:455` both treat this as live — "`ts.ScriptKind` decides
whether `<` opens JSX, so it cannot be guessed". **For JavaScript that is not true, and I
checked rather than assumed:**

```
JS   languageVariant=JSX  parseDiagnostics=0  jsxElements=1
JSX  languageVariant=JSX  parseDiagnostics=0  jsxElements=1
TS   languageVariant=Standard  parseDiagnostics=5  jsxElements=0     <- the check can fail
TSX  languageVariant=JSX  parseDiagnostics=0  jsxElements=1
```

`ts.ScriptKind.JS` **already has `languageVariant = JSX`**. TypeScript enables JSX for all
JavaScript, because `<T>x` angle-bracket type assertions are not JavaScript syntax, so there
is no ambiguity to trade against — the trade-off that makes `.ts` vs `.tsx` a real decision
does not exist in `.js`.

Corroborated across the corpus: of 2,942 `.js` files parsed both ways, **0 differ** — 0 clean
under one kind and broken under the other, 0 with differing node counts. 28 `.js` files
contain JSX and all parse identically either way. That null result is only trustworthy
because the `TS` row above shows the comparison can return non-null.

**So: always `ScriptKind.JS` for `.js`/`.mjs`/`.cjs`, `ScriptKind.JSX` for `.jsx`. No Babel
config to read, no bundler config, no fallback to document.** `hasJsxContent` becomes
provenance recorded after the fact, not a parse-time decision.

### The real script-kind problem is Flow, not JSX

All **64** syntactic type annotations in the corpus are in a static-site framework `.js` files, 6 carrying an
`@flow` pragma. `ts.createSourceFile` in JS mode parses Flow's annotation syntax into real
`.type` nodes because it overlaps TypeScript's, so these files produce **type annotations in a
JavaScript fact base**. Where Flow and TypeScript syntax diverge (`?T`, `{| |}`, `import type`,
variance sigils) it will instead mis-parse silently.

This is small here — 64 of 38,903 parameters, 0.165%, one package — and I am not proposing
anything for it. It is recorded so that it is a known quantity rather than a surprise, and so
that whoever meets a `js_method_parameter` carrying a type annotation knows where it came
from. `js-corpus` should size it on a Flow-bearing corpus before anyone acts.

### What I would expect to see if I were wrong

`require()` appearing in `"type": "module"` files at any material rate — the direction that is
an actual runtime crash rather than a bundler's business. That count is **0 of 287**. If it
were, say, 5%, "emit normally" would be emitting facts about programs that cannot run, and
flag-and-emit would have to become skip-or-quarantine. I would also expect a non-zero count of
`.js` files whose parse differs between `ScriptKind.JS` and `ScriptKind.JSX`; a single one
would reopen the script-kind question.

---

## 4. What these three answers imply for the schema — not proposed, just entailed

Listed so the human can see what approving §1–§3 commits to. **No relation is proposed here.**

- `js_module`'s primary key needs the module system in it, or a file's identity changes with a
  `package.json` edit it does not contain. This is the same shape as `ts_module`'s
  `emissionRegime`.
- `js_import` and `js_export` must accept rows minted by the expression walk, which means the
  build order in §1 of `BUILDING-A-PARSER.md` needs an explicit second pass for JavaScript
  rather than a quiet exception.
- JSDoc is a first-class declared-type channel, not comment extraction: it drives 36.4% of
  parameter types and predicts resolution 26.8% → 73.2%.
- `@typedef` (1,900) and `@callback` (109) declare types with no declaration syntax anywhere,
  so `js_type` has rows whose only evidence is a comment.
- 434 `X.prototype.m = function` and 233 `X.prototype.p = value` are §3's defect class in its
  purest form. `util.inherits` (2) and `Object.create(B.prototype)` (4) are rare **in this
  corpus** and that is a corpus property, not a language property — Node's `lib/` has been
  modernised. Do not size the prototype work from these two numbers.

---

## 5. Independent re-measurement (second session, rebuilt corpus)

Everything in §§1–3 was re-measured from scratch on a **rebuilt corpus and freshly written
probes**, on the instruction to verify rather than trust. The original probes were gone, so
nothing was reused: different corpus construction, different code, same three questions. Where
the two disagree the disagreement is recorded here rather than edited away.

**Replication corpus: 2,781 discovered, 43 excluded, 2,738 measured, 15.5 MB.** Same strata and
same subtree restrictions; a static-site framework, `a test runner`, a fetch polyfill, a globbing library, a spinner library, a concurrency helper and
`a terminal-colour library` are absent and a small JSX application (38 files) is the whole of the JSX stratum, so
absolute counts differ and ratios are the thing being compared. Upstream drift is visible and
small (a bundler's own source 712 → 699, a CommonJS web framework 141 → 141, a runtime standard library 423 → 423).

| # | claim | original | re-measured | verdict |
|---|---|---|---|---|
| 1 | expression-borne share | 80.7% | **83.6%** | holds |
| 1 | minus a one-file-per-method utility library / minus a one-file-per-method utility library+a bundler's own source | 74.2% / 59.9% | **77.3% / 61.8%** | holds |
| 1 | per-file bimodality (expr / decl / mixed) | 2,403 / 580 / 30 | **2,300 / 431 / 0** | holds, more extreme |
| 1 | `require()` not a top-level statement | 13.8% | **13.6%** | holds |
| 2 | `getResolvedSignature` never returns `undefined` | claim | **0 of 105,599**, and 0 of 3 synthetically | holds |
| 2 | RESOLVED / ANY_SIGNATURE | 45.4% / 54.1% | **47.4% / 52.0%** | holds |
| 2 | a CommonJS web framework is not environmental | 12.8% → 12.9% | **12.8% → 12.9%** | holds exactly |
| 2 | some packages *are* environmental (a small UI library) | 19.4% → 43.6% | **77.9% → 84.8%** | direction holds |
| 2 | JSDoc density predicts resolution | 26.8% → 73.2%, monotonic | **24.1% → 74.1%, one inversion** | holds; see below |
| 2 | resolves to a non-first declaration | 23.0% | **82.0%** | **not reproduced** |
| 3 | `ScriptKind.JS` has `languageVariant = JSX` | claim | **confirmed** | holds |
| 3 | governance: type-absent / none / type=module | 75.6 / 13.9 / 9.5% | **76.0 / 15.4 / 8.6%** | holds |
| 3 | files contradicting their governing config | 10.2% | **6.2%** (+0.9% JSX, below) | holds, corpus-sensitive |
| 3 | `require()` in a `"type":"module"` file | 0 | **0** | holds |

### Two corrections

**JSDoc monotonicity is slightly overstated.** Re-measured the bands run
24.1% → 39.5% → 61.8% → **59.6%** → 74.1%: the 50–75% band sits below the 25–50% band. The
2.7×–3.1× swing from bottom band to top is intact and so is the recommendation to band the
gate, but "monotonic across all five bands" is a property of the original corpus, not of the
language. A gate must not assert monotonicity.

**The non-first-declaration number did not reproduce and should not be used until it is
settled.** 23.0% against 82.0% is too wide to be corpus drift; the two probes are almost
certainly counting different denominators (which symbol the declaration list is taken from, and
whether overloads in `lib.*.d.ts` are included). My own probe is ad hoc and I found a real bug
in another part of it today, so I am *not* claiming the original is wrong — only that the claim
is currently unverified. It is the sole support for "the gate is not vacuous where it applies",
so `js-oracle` must re-derive it inside `../parser-oracle/javascript/` before any gate leans on
it.

### One bug found in the new probe, recorded because it nearly became a finding

The first run of the re-measurement reported **`require()` not top-level: 0 of 9,055 (0.0%)**,
which would have contradicted the original 13.8% outright. The predicate was wrong, not the
original: it walked to the *top-level ancestor* of the `require`, which for a nested call is the
enclosing top-level statement, so every `require` looked top-level. A null result that flatly
contradicts a prior measurement is the signature §11 describes. Rewritten with an explicit
self-test that asserts the predicate returns **both** answers on a fixture with one top-level
and four nested `require`s, it returns 13.6%.

---

## 6. Node/V8 as the second implementation, and where it stops

The brief asks for Node's own resolver as a second implementation because "tsc *models* Node
resolution; Node *is* it". Extending that: **V8 itself adjudicates what a file is**, by whether
the source compiles as a CommonJS script (`new vm.Script`, function-wrapped) or as an ES module
(`new vm.SourceTextModule`). That is the authoritative implementation, in the same sense that
the JDK's classfile API is authoritative for Java rather than a model of it.

**Its competence boundary, established by self-test rather than assumed:**

| V8 can prove | how |
|---|---|
| **ESM** | `import` / `export` / `import.meta` / top-level `await` are syntax, and fail to compile as a script |
| **CommonJS** | only via top-level `return`, legal *solely* inside the CJS function wrapper, and other sloppy-mode-only constructs |
| **neither** | everything else — `require`, `module` and `exports` are ordinary identifiers in an ES module, so a CommonJS file compiles cleanly as ESM and fails only at **run** time |

The self-test initially failed, asserting that pure CommonJS would compile only as CJS. It
compiles as both. That is the oracle declining, not a defect, and it is the same distinction
§2 draws for `ANY_SIGNATURE` — so the partition this oracle can decide is **`ESM_ONLY` vs
`BOTH`**, and `CJS_ONLY` is a narrow special case rather than the complement.

Verdict over the 2,738 files:

| | files | share |
|---|---|---|
| compiles as **both** (contains no ESM syntax) | 2,297 | 83.9% |
| **ESM only** | 406 | 14.8% |
| **neither** | 25 | 0.9% |
| **CJS only** (top-level `return`) | 10 | 0.4% |

Three results matter:

- **`ESM_ONLY` under a CommonJS-governed config: 170 files, 6.2%** — the same phenomenon the
  original memo measured syntactically at 10.2%, now confirmed by the engine that would refuse
  to run them. Every one is a small UI library or a small JSX application: bundler input, as before.
- **`CJS_ONLY` under a `"type":"module"` config: 0.** The direction that is a real runtime
  crash stays at zero under the authoritative implementation, which is the falsifier §3 named.
- **The 25 "neither" files are all JSX**, and V8 rejects JSX because JSX is not JavaScript.
  That is the second oracle declining on a construct outside its language, and it must be
  classified as such — never as a parse failure. Counting it as a defect would manufacture a
  25-file population that does not exist, and would have been easy to do: the CommonJS error
  message on those files reads `Cannot use import statement outside a module`, which looks like
  a real module-system finding until you notice the ESM attempt failed on the `<`.

The 10 `CJS_ONLY` files are all internal modules of a runtime standard library, using a top-level `return` to bail out of
a module early — a construct with **no ESM spelling at all**, and one the parser should expect
to meet in exactly this population.

**This does not change any recommendation.** It raises the confidence on §3 from a syntactic
count to an adjudicated one, and it supplies the second implementation §2 of the brief asks
for, with its competence boundary written down before any gate consumes it.

---

## 7. Question two, answered — the decidable fraction, the control, and the residual

Added after the phase-0 review, which accepted Q1 and Q3 and held Q2 pending three things.
All three are below. The corpus is §5's (2,738 files); the compiler is typescript@6.0.3.

### 7.1 The negative control comes first, because the rate is meaningless without it

A hand-labelled fixture with calls that **must** be decided and calls that **must** be
declined, run through the exact classifier used on the corpus:

```
  ok  known(1)                  expect=RESOLVED got=RESOLVED     ok  cb(1)            expect=ANY got=ANY_SIGNATURE
  ok  new Explicit(1)           expect=RESOLVED got=RESOLVED     ok  obj.whatever()   expect=ANY got=ANY_SIGNATURE
  ok  fromDep(2)                expect=RESOLVED got=RESOLVED     ok  gone.thing()     expect=ANY got=ANY_SIGNATURE
  ok  JSON.stringify({})        expect=RESOLVED got=RESOLVED     ok  this.dynamic()   expect=ANY got=ANY_SIGNATURE
  ok  [1,2].map(fn)             expect=RESOLVED got=RESOLVED     ok  o.nope()         expect=ANY got=ANY_SIGNATURE
  ok  k.m(3)                    expect=RESOLVED got=RESOLVED
  ok  new Klass()               expect=SYNTH    got=SYNTHESIZED
  MUST be DECIDED  : 8/8      MUST be DECLINED : 5/5      NEGATIVE CONTROL PASS
```

**The control failed twice before it passed, and both failures were informative.**

1. `new Klass()` where `Klass` declares no constructor returns a signature with **no
   declaration** — I had labelled it `RESOLVED`. It is `SYNTHESIZED`, and `SYNTHESIZED` is
   **not a decline**: the oracle knows exactly what is constructed, there is simply no
   constructor node to point at. So the partition is three-way and the decidable set is
   `RESOLVED ∪ SYNTHESIZED`.
2. `new Klass().m(3)` is *two* call-like nodes on one line, and line-based labelling tagged
   both. A fixture defect, fixed in the fixture.

### 7.2 The decidable fraction

| outcome | calls | share |
|---|---|---|
| **RESOLVED** — signature **with** a declaration | 50,133 | 47.5% |
| **SYNTHESIZED** — target known, no declaration node | 607 | 0.6% |
| **ANY_SIGNATURE** — the oracle **declines** | 54,859 | 52.0% |
| `NO_SIGNATURE` | 0 | 0.0% |
| **DECIDABLE (RESOLVED + SYNTHESIZED)** | **50,740** | **48.0%** |

**And the denominator is wrong, by the ruling on Q1.** 9,055 of those "call sites" are
`require()`, which Q1 rules is a **module edge**, not a call. Removing them:

> **decidable fraction on the call-graph denominator: 50,740 / 96,544 = 52.6%**

That is the number to rule on. It is not a lower bound that better tooling improves — `require()`
was always a module edge; counting it as an unresolved call was the measurement's error.

### 7.3 The residual, split by cause — SUPERSEDED, see §7.3a

The table below is on the **full** denominator and contains two labels that a later review
correctly rejected: `NO_DECLARATION` (a classifier artefact) and `REQUIRE_CALL` (module edges
that the very next paragraph removes from the denominator). **§7.3a replaces it.** Kept in
place rather than deleted so the correction is auditable.

The 54,859 declines, attributed per call by walking the callee to its leftmost root and
classifying that root's declaration:

| cause | calls | share of declines | environmental? |
|---|---|---|---|
| `NO_DECLARATION` — callee symbol has no declaration (untyped global, `require(...)()` result) | 13,860 | 25.3% | no |
| `REQUIRE_CALL` — a module edge, not a call site | 9,055 | 16.5% | **not a call** |
| `DESTRUCTURED_ANY` — `const {a} = …` off an untyped value | 8,579 | 15.6% | no |
| `LOCAL_UNTYPED_VAR` | 8,154 | 14.9% | no |
| `IMPLICIT_ANY_PARAM` | 5,390 | 9.8% | no |
| `THIS_ANY` — `this` in a plain function | 3,792 | 6.9% | no |
| `NO_SYMBOL` — computed/dynamic callee | 2,191 | 4.0% | no |
| **`ENV_UNRESOLVED_MODULE`** | **1,737** | **3.2%** | **yes** |
| `TYPED_PARAM_STILL_ANY` — annotated, still `any` | 1,343 | 2.4% | no |
| remainder (9 buckets, each <1%) | 758 | 1.4% | no |

> **Environmental: 3.2% of declines, 1.6% of all call sites.**

This is the per-call attribution the review asked for, and it independently reproduces the
original memo's 3.7%. (My §5 pass reported 88.6% for this and was wrong: it marked *every*
decline in a file environmental if *any* import in that file failed to resolve. The corrected
attribution traces each individual callee.)

### 7.3a The residual, corrected — on the call-graph denominator, with the labels fixed

Three defects in §7.3, all found by review, all confirmed by re-measurement:

**(a) `REQUIRE_CALL` was incoherent.** It listed the 9,055 `require()` calls as *unresolved
call sites* in a table whose denominator the next paragraph removed them from. They are module
edges. Removed from the denominator entirely; the decidable fraction is unchanged at **52.6%**,
because they were never in the numerator.

**(b) `NO_DECLARATION` was a bug in my probe, not a category.** It collided by name with
`SYNTHESIZED` and the two *are* distinct — `SYNTHESIZED` means the **signature** has no
declaration and the callee type is **not** `any` (target known); the old bucket meant the
callee **root symbol** had none and the type **was** `any`. Disjoint by construction, so the
decidable fraction does not move. But the bucket was inflated by my own alias-following:
`getAliasedSymbol()` on `var request = require('an HTTP test helper')` returns a **declaration-less**
symbol when the target module is untyped JavaScript. Verified on a concrete site — `request`
has `flags = Alias` and **1** declaration; the *aliased* symbol has none. Following the alias
only when the target actually has declarations collapses the bucket from **14,900 to 212**, and
all 212 are `require('x')()` — an immediately-invoked require result.

**(c) The real category the review predicted.** Calls **through a required binding** are the
single largest cause:

| cause | declines | share |
|---|---|---|
| **required binding → Node builtin, no `@types/node`** | 11,196 | **24.4%** |
| destructured from an untyped value | 8,579 | 18.7% |
| local variable inferred `any` | 7,780 | 17.0% |
| implicit-`any` parameter | 5,390 | 11.8% |
| **required binding → module resolved but untyped** | 3,887 | 8.5% |
| `this` is `any` | 3,792 | 8.3% |
| callee root has no symbol (computed/dynamic) | 2,191 | 4.8% |
| annotated parameter still `any` | 1,343 | 2.9% |
| **required binding → npm package not installed** | 673 | 1.5% |
| remainder (8 buckets) | 1,173 | 2.6% |
| **denominator** | **45,804** | |

**Calls through a required binding total 15,759 = 34.4% of declines.** Renamed so no label
denotes two things: `REQUIRED_BINDING__*` is a call *through* a binding, and `require()` itself
is not in this table at all.

### 7.4 The finding to write down, so `js-corpus` does not go looking for one

> **RETRACTED.** The claim that stood here — *"JavaScript has no large environmental class,
> which inverts TypeScript's 10,068-of-10,162"* — is **withdrawn**. It was accepted at review
> and banked before the measurement that falsifies it existed. It was drawn too broadly from a
> measurement that was itself correct: a CommonJS web framework really does move only 12.8% → 12.9% when its
> `node_modules` are installed. What follows replaces it.

**There are THREE classes, not two, and the middle one is new to this repo.** Splitting by
*what kind of specifier* failed:

- **npm package not installed: 1.5%.** Small, exactly as claimed, and a CommonJS web framework installing its
  `node_modules` moves 12.8% → 12.9% confirms it.
- **Node builtin with no `@types/node`: 24.4%.** Large. Forcing `types:["node"]` moves a CommonJS web framework
  **12.9% → 21.9%** — and that null result was only trusted after proving the check could
  differ, since merely `npm install`-ing `@types/node` changed nothing (tsc was not loading it).

### The three classes, and the instruction `js-corpus` actually gets

| class | share of declines | fixable by preparing the checkout? | precedent |
|---|---|---|---|
| **environmental-and-fixable** — npm package not installed | **1.5%** | **yes**, `npm install` | TypeScript's class (10,068 of 10,162) |
| **environmental-but-UNFIXABLE** — Node builtin, no ambient declarations | **24.4%** | **no.** Nothing installable *in the repo under analysis* supplies them; they come from `lib.*.d.ts`, which ships with the compiler | **neither TypeScript nor Python needed this category** |
| **language-intrinsic** — untyped params, untyped locals, destructured untyped values, `this`, module resolved but untyped | **74.1%** | no, and not a defect | Python's 51% receiver gap |

**The corrected instruction to `js-corpus`:** do not hunt a missing-dependency explanation —
that class is real but is 1.5%. **Do** classify ambient-declaration declines as a **third
category, environmental-but-unfixable**, and never report them as either a parser gap or a
checkout defect. They are the `lib_*` population, which TypeScript already measures at 42.3% of
its call targets, and the fix is to mint that population once (§8, OQ-2) — not to prepare the
corpus differently.

### Are the decline buckets a partition, or overlapping tags?

**A partition, first-match, one label per decline — verified, not asserted.** The buckets sum to
**45,804, exactly the `ANY_SIGNATURE` count.**

The specific worry — that `require('fs').readFile()` is both "a call through a required
binding" and "a Node builtin with no types" — does not arise, and for two separate reasons:

1. **The builtin bucket is *nested inside* the required-binding family, not parallel to it.**
   It is assigned inside the `if (specifier)` branch, so the 24.4% is a **subset** of the 34.4%,
   never an overlap. The family decomposes cleanly:

   | `REQUIRED_BINDING__*` family | declines | of the family | of all declines |
   |---|---|---|---|
   | Node builtin, no `@types/node` | 11,196 | 71.0% | **24.4%** |
   | module resolved but untyped | 3,887 | 24.7% | 8.5% |
   | npm package not installed | 673 | 4.3% | 1.5% |
   | relative path unresolved | 3 | 0.0% | 0.0% |
   | **family total** | **15,759** | 100% | **34.4%** |

2. **The literal example lands in neither.** `require('fs').readFile()` has *no binding at all*,
   so the callee root walks to the `require` identifier and it is classified
   `ROOT_SYMBOL_UNDECLARED` — a third bucket, 212 rows corpus-wide. Confirmed on a purpose-built
   fixture covering all seven shapes, each receiving exactly one label.

So **the 24.4% lever reads correctly and is not double-counted.** The one number that moved is
`relative_path_unresolved`, which I previously reported as 0 and is **3** — and unlike the rest
those three would be genuine defects, since a relative specifier that fails to resolve is a real
broken edge. Handed to `js-corpus` to confirm rather than assumed.

The consequence is directional and worth stating plainly: on TypeScript, reporting the
incomplete hand-offs as parser gaps would have been wrong. **On JavaScript, writing them off as
environmental would be wrong by the same margin.** The declines are the language — untyped
parameters, untyped locals, destructured untyped values and `this`. No amount of corpus
preparation recovers them, and a corpus agent hunting a missing-dependency explanation will
find nothing and burn the time finding it.

---

## 8. The two open items, closed

### 8.1 Non-first declaration: both numbers are right, about different things

Resolved. The 23.0% and the 82.0% are different questions, and the discriminator is whether
`sig.declaration` is in the callee symbol's declaration list **at all**:

| | calls | |
|---|---|---|
| resolved calls whose callee symbol has >1 declaration | 5,081 | the population (original: 5,809 — same population, corpus drift) |
| **`sig.declaration` is not in that list at all** | **3,097** | **61.0%** |
| present in the list, but not at index 0 | 1,090 | 21.5% |
| present at index 0 | 894 | 17.6% |

`decls[0] !== sig.declaration` counts the 3,097 as "not first" and yields **82.4%**.
`decls.indexOf(sig.declaration) > 0` excludes them and yields **21.5%** — the original's
**23.0%**, within corpus drift. Neither probe was wrong; they were never the same measurement.
Stable across provenance (lib-only 81.8%, project-only 91.5%), so it is not a `lib.d.ts`
overload artefact.

**The engineering conclusion supersedes both numbers.** 61% of the time the resolved
declaration is **not among the callee symbol's declarations**, so a parser or gate that
identifies a call target by "the callee symbol's declaration list" is looking in the wrong
place in the majority of multi-declaration cases. The gate must compare against
`sig.declaration` directly. Recorded as the rule; neither percentage is a gate threshold.

### 8.2 Walker audit: the ancestor-walk shape, everywhere it occurs

The `require()`-not-top-level bug was an ancestor walk that returned the top-level *ancestor*
rather than testing the node. Fixing the cause rather than the instance means finding every
predicate of that shape. There are four, and all four now have a self-test that asserts the
predicate returns **more than one answer** on a fixture built to force both:

| walker | question | discriminating case | status |
|---|---|---|---|
| `isTopLevelStmt` | 1 | 1 top-level vs 4 nested `require` | fixed + self-tested |
| `inFunctionBody` | 1 | function / arrow / method vs bare block | self-tested, was correct |
| `governingType` (nearest-ancestor `package.json`) | **3** | nested `package.json` must beat the root one, and they must disagree | self-tested, was correct |
| `specifierOf` / `rootOf` | 2 | `require` vs non-`require` initialiser; 6 callee shapes | self-tested, was correct |

`governingType` is the one that mattered most to check: it is load-bearing for Q3 and has
exactly the shape that failed. Its fixture makes the nearest and farthest `package.json`
*disagree*, so a walker that ran to the root would produce the wrong answer rather than the
same one.

### 8.3 Recorded as non-properties

Two absences, written down because silence reads as a bug later:

- **JSDoc banding is not monotonic.** 24.1% → 39.5% → 61.8% → **59.6%** → 74.1%. The bottom-to-top
  swing (~3×) is real and is what justifies banding the gate. **No gate may assert
  monotonicity across bands**; asserting it would fail on a corpus for a reason that is not a
  regression.
- **V8 is scoped to the ESM-provable part only.** It can prove ESM; it cannot prove CommonJS,
  because `require`/`module`/`exports` are ordinary identifiers in an ES module and fail only at
  run time. Any module-system claim from V8 must **exclude the JSX confound first** — the 25
  files that compile as neither are JSX, not module-system evidence.

---

## 9. Reproducing

Probes are throwaway and live outside the repo, under the session scratchpad — originally
(`probe/corpus.ts`, `q1-module-edges.ts`, `q1b-js-only.ts`, `q1c-annotations.ts`,
`q1d-columns.ts`, `q2-resolution.ts`, `q2-ts-control.ts`, `q2-join.ts`, `q3-module-system.ts`,
`jsxcheck.ts`), and for the §5–§6 re-measurement (`js/corpus.ts`, `q1.ts`, `selftest-q1.ts`,
`q2.ts`, `q2-pkg.ts`, `verify-ab.ts`, `q3-v8.mjs`, `cjsonly.mjs`). The re-measurement probes
were written without reference to the originals, which is the only reason their agreement
carries information. They run against `../parser-oracle`'s pinned **typescript@6.0.3**. None of
them is a deliverable and none should be checked in; the oracle in
`../parser-oracle/javascript/` supersedes them once §1 is ruled on.

---

## 10. Summary

| # | question | recommendation | headline |
|---|---|---|---|
| 1 | one front end or two | **two — `js_*`, own front end** | 80.7% of module edges expression-borne (re-measured **83.6%**); 98.4% in CJS; bimodal per file |
| 2 | resolution ceiling | **build the oracle; gate banded and classified, never a global rate** | **decidable 52.6%** on the call-graph denominator (48.0% before removing `require()` module edges) vs TypeScript's 99.4%; negative control 8/8 and 5/5; declines only **3.2% environmental** |
| 3 | ESM/CJS and script kind | **emit normally + conflict column; `ScriptKind.JS` always** | 10.2% contradict their config (re-measured 6.2%, all bundler input); **0** illegal `require` under V8 adjudication; 0 files parse differently |

**Stopping here.** I have not written a schema, a relation or any parser source. On a ruling
I will build `../parser-oracle/javascript/` and return with the schema for a second approval.

**Two items carry forward into that work rather than blocking the ruling:** the
non-first-declaration number must be re-derived inside the oracle before any resolution gate
depends on it (§5), and the V8 adjudicator of §6 should ship as part of
`../parser-oracle/javascript/` alongside the tsc oracle, since the two decline on different
things and the disagreement is the useful signal.
