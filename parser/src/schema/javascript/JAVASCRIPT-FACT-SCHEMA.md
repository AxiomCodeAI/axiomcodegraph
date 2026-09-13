# JavaScript fact-table schema — proposal v1 (for approval)

**Author:** `js-oracle`  **Status:** **APPROVED — column order FROZEN.** 16 relation pairs,
362 columns, spine 9 / 234. Column *positions* are now the contract; column names and enum
values remain free (the `.dl` carries only `c0..cN`), so `AMBIENT_BUILTIN_TARGET` and
`receiverTypeSource = NODE_BUILTIN` were added under that rule and reopen nothing.
**Scope:** the base-relation contract between the JavaScript parser and the Souffle engine.

**16 relation pairs, 362 columns** — of which a **9-relation / 234-column spine** (§6) is what
I recommend freezing first. Declarations are **generated from this document** by
`gen_decls.py`, with `--check` in CI, exactly as Python and TypeScript do. A hand-maintained
`.dl` drifts silently.

Once approved this is frozen: **column order is the contract.** Column *names* and enum
*values* are not frozen (the `.dl` carries only `c0..cN`); column *positions* are.

This document follows the phase-0 decision memo (`DECISION-MEMO.md`), whose three questions
were ruled on: **Q1 — JavaScript is its own front end, `js_*`.** **Q3 — emit normally, with a
column naming the module system and whether the file contradicts its governing config.**
**Q2 — the resolution ceiling is 52.6% decidable**, and §0.0 explains what that does to the
design.

---

## 0. Designed from JavaScript's measurements, not from TypeScript's tables

The temptation is to copy `ts_*` and delete the type columns. That produces a schema for a
language whose types are declared, and JavaScript's are not. The governing sentence from the
brief is **"JavaScript is syntactically TypeScript and semantically Python"**, and the
measurements say the semantic half dominates every design decision that matters.

All numbers are from the memo's corpus: **2,738 files, 15.5 MB**, five strata
(a CommonJS web framework, a one-file-per-method utility library, a runtime standard library, a bundler's own source, a small UI library, a charting library, a media library, a pure-ESM process library,
a dual-published HTTP client, a small JSX application), 43 files excluded as bundled/minified by stated rule.
Compiler: `typescript@6.0.3`, `allowJs: true, checkJs: true`.

### 0.0 The measurements that drove the design

| Measurement | Value | Consequence for the schema |
|---|---|---|
| Module edges that are **expression-borne** (`require`, `module.exports =`, `exports.x =`) | **11,655 / 13,936 = 83.6%** | The module graph lives in the **expression** relation. `js_import`/`js_export` must accept rows minted by the expression walk, so the build order needs an explicit second pass (§2.1). This is the finding that made JavaScript its own front end. |
| Per-file distribution of that share | **2,300 files 100% expression-borne, 431 files 100% declaration-borne, 0 mixed** | Bimodal, not averaged. `edgeBearer` is a real partition of the table, not a rare flag. |
| `require()` calls that are **not top-level statements** | **1,227 / 9,055 = 13.6%** | A module-edge extractor that walks the file's statement list — which is what `ts-import-extractor.ts` does, because every TypeScript module edge is a top-level declaration — misses **one require in seven**. `js_import.isTopLevel` records it; the extractor must use the expression worklist. |
| `require(<non-literal>)` | **17** | Unresolvable by construction. Needs `specifierKind = NON_LITERAL` and a null `resolvedFilePath`, never a guess. |
| Call sites the oracle can **decide** (`getResolvedSignature` with a declaration, ∪ synthesized) | **50,740 / 96,544 = 52.6%** | The oracle resolves barely half. **The engine must resolve, and the parser's job is IR completeness** — the declared name as written, the importing module, `resolvedFilePath`. A schema that assumes the parser can name the target is a schema for a language this is not. |
| … of the declines, **npm package not installed** | **1.5%** | The classic environmental class is genuinely small, and a CommonJS web framework confirms it: installing `node_modules` moves it 12.8% → 12.9%. |
| … of the declines, **Node builtin with no `@types/node`** | **24.4%** | **A second, larger environmental class that is not the same thing** (§0.5). Loading `@types/node` moves a CommonJS web framework **12.9% → 21.9%**. This is the direct analogue of TypeScript's `lib.*.d.ts` population, where 42.3% of call targets live. |
| … of the declines, **module resolved but untyped JS** | **8.5%** | Language-intrinsic: the file is there and carries no types. |
| Declines that are **calls through a required binding** | **15,759 = 34.4%** | The single largest cause, and the one the schema is shaped by: `const x = require('y'); x.foo()`. `js_variable.initializerKind = REQUIRE_CALL` plus `js_import` is the hop that makes these reconstructable. |
| Parameters with a **syntactic** type annotation | ~~64 / 38,903 = 0.165%~~ — **FALSIFIED. `js-corpus` measures 3,793 / 58,017 = 6.5%** on a corpus with 248 `@flow` files, 59× the original. All of it is **Flow** | Flow is the **second declared-type channel** in JavaScript, not a rounding error — and it is **out of scope** (§2.6). TypeScript's declaration-site mechanism is still absent from JavaScript proper. |
| Parameters with a **JSDoc** declared type | **13,875 / 36,628 = 37.9%**; `@param` **14,307**, `@type` **8,869**, `@returns` **6,073** *(corrected — see §0.0b)* | **JSDoc is the type channel**, not a comment feature. It gets a first-class type-reference tree (§3.14) and `declaredTypeSource` on every typed position (§2.3). |
| `@typedef` / `@callback` | **1,825** / **103** *(corrected — `@typedef` is 2.7× what was reported)* | A type **declaration whose only evidence is a comment**. `js_type` has rows with no declaration syntax anywhere (§2.3), and there are far more of them than first measured. |
| `@returns` on a function | **6,284 / 25,573 = 24.6%** | |
| JSDoc density → oracle resolution | **24.1% → 74.1%** across five bands, **non-monotonic** | Recorded as a **non-property**: no gate may assert monotonicity (§7.4). |
| `X.prototype.m = function` / `X.prototype.p = value` / `X.prototype = {…}` | **361 / 233 / 15** | Members **declared by assignment**. §3 of `BUILDING-A-PARSER.md` in its purest form: the parts emit trivially and the structure is absent. These mint `js_method`/`js_field` rows, not just expressions (§2.2). |
| `X.staticM = function` | **521** | The static counterpart, and more common than the prototype form. |
| `util.inherits` / `Object.create(B.prototype)` / `Object.assign(X.prototype, …)` | **2 / 4 / 2** | An **`extends` edge expressed as a call**. Rare *in this corpus* because a runtime standard library has been modernised — a corpus property, not a language property. Specified, deliberately not sized from these counts. |
| Call kinds | `obj.m()` **46,726**, `fn()` **39,334**, `require()` **9,055**, `new` **7,964**, `obj[expr]()` **663**, `.call()` **541**, `super()` **517**, `.apply()` **318**, `.bind()` **189**, IIFE **113**, `obj?.m()` **28**, tagged template **20**, `eval()` **1**, `new Function()` **1** | The whole set, enumerated before the relation is declared (§5 of the parser doc). `.call/.apply/.bind` put the **receiver in an argument**, which needs `receiverPosition` (§2.4). |
| Binding forms | `const` **35,716**, `let` **5,637**, **`var` 3,705**, destructuring **6,909**, `this` **33,189** | Two binding regimes coexist. `var` is function-scoped and hoisted; `let`/`const` are block-scoped with a temporal dead zone. This is Python's binder problem, and it needs a real scope tree (§3.13), not a flag. |
| Hoisting-relevant declaration forms | function declarations **5,271** (hoisted), function expressions **4,325** (not) | The same syntax category behaves differently by position. `js_method.hoisting` is a column. |
| Accessors | getters **1,225**, setters **137** | A property *read* that invokes a function. Emitted as declarations; the **invocation** is reserved (§2.4). |
| Computed member names | **715** | `obj[expr]` as a declaration name. Names that syntax cannot fix. |
| Max AST depth / p99 | **67** / 26 | TypeScript caps traversal at 20. A cap of 20 truncates real JavaScript. **Cap at 32 with `isTruncated`.** |
| Files whose module system is **defaulted, not declared** | **2,502 / 2,738 = 91.4%** (76.0% `package.json` with no `"type"`, 15.4% no `package.json` at all) | `moduleSystem` alone is not enough. `moduleSystemSource` must say **how it was decided**, or a defaulted CommonJS and a declared one are indistinguishable. |
| Files contradicting their governing config | **170 = 6.2%**, all ESM source under a CommonJS config, all bundler input; **0** the other way | Q3 ruling: emit normally, flag it. `contradictsGoverningConfig` is a column, never a `SkippedFileReason`. |
| `.js` files parsing differently under `ScriptKind.JS` vs `ScriptKind.JSX` | **0 of 2,942** | `ts.ScriptKind.JS` already carries `languageVariant = JSX`. The script-kind decision does not exist for JavaScript; `scriptKind` is recorded as provenance, not read from config. |

### 0.1 What follows from 52.6%, and what does not

It does **not** follow that resolution gates are worthless — it follows that they must be
**banded and classified**. The oracle emits a three-way partition and only one value
authorises an expectation:

| outcome | meaning | may authorise an expectation? |
|---|---|---|
| `RESOLVED` | signature **with** a declaration | **yes** |
| `SYNTHESIZED` | target known, no declaration node (implicit constructor) | yes, as an honest terminal |
| `ANY_SIGNATURE` | callee is `any` — **the oracle declined** | **no** |

`getResolvedSignature` **never returns `undefined` on JavaScript** (0 of 105,599). It returns
tsc's internal `anySignature` for an `any` callee. A direct port of the TypeScript oracle
therefore reports **100% on code it resolved nothing in**, and this schema's gates are written
against the filtered partition for that reason.

### 0.0a Correction: there are THREE environmental classes, and one is new to this repo

An earlier version of this document and of `DECISION-MEMO.md` said **"JavaScript has no large
environmental class"**, on the strength of a CommonJS web framework moving 12.8% → 12.9% when its `node_modules`
were installed. That measurement is correct and the conclusion drawn from it was too broad.

Splitting the unresolved-module declines by **what kind of specifier** failed:

| specifier | declines | share of declines | environmental? |
|---|---|---|---|
| **Node builtin** (`path`, `fs`, `events`, `util`) with no `@types/node` | 11,196 | **24.4%** | **yes — and large** |
| npm package not installed | 673 | 1.5% | yes, and small |
| module resolved, but it is untyped JavaScript | 3,887 | 8.5% | no — language-intrinsic |
| relative path unresolved | 0 | 0.0% | would be a real defect |

**The controlled test, with the null result proven falsifiable first.** Installing
`@types/node` alone changed nothing, because tsc was not loading it. Forcing it with
`types: ["node"]` and `typeRoots`:

```
  default (no types option)      RESOLVED 12.9%
  types:["node"] + typeRoots     RESOLVED 21.9%      <- the check CAN differ
```

So the corrected statement, and the one `js-corpus` is held to:

| class | share of declines | fixable by preparing the checkout? |
|---|---|---|
| environmental-and-**fixable** — npm package absent | 1.5% | yes, `npm install` |
| environmental-but-**UNFIXABLE** — Node builtin, no ambient declarations | **24.4%** | **no.** Nothing installable in the repo under analysis supplies them |
| language-intrinsic | 74.1% | no, and not a defect |

**The middle row is a category neither TypeScript nor Python needed.** TypeScript's
environmental class was entirely the fixable kind (10,068 of 10,162 were missing
`node_modules`). Classifying these as a parser gap would invent a defect population; classifying
them as an ordinary environmental miss would tell the corpus agent to install something that
does not exist. They must be their own bucket.

This is **direct evidence for OQ-2** (§8), which is why that question stopped being a tidy-up.

#### The decline buckets are a partition, not overlapping tags

Verified rather than asserted: the classifier is a **first-match chain assigning exactly one
label**, and the buckets sum to **45,804 — exactly the `ANY_SIGNATURE` count**.

The builtin bucket is **nested inside** the required-binding family, not parallel to it, so the
24.4% is a subset of the family's 34.4% and is never double-counted:

| `REQUIRED_BINDING__*` | declines | of family | of all declines |
|---|---|---|---|
| Node builtin, no ambient declarations | 11,196 | 71.0% | **24.4%** |
| module resolved but untyped | 3,887 | 24.7% | 8.5% |
| npm package not installed | 673 | 4.3% | 1.5% |
| relative path unresolved | 3 | 0.0% | 0.0% |
| **family** | **15,759** | | **34.4%** |

`require('fs').readFile()` — the case that would overlap if anything did — has **no binding at
all**, so its callee root walks to the `require` identifier and it lands in a third bucket
(`ROOT_SYMBOL_UNDECLARED`, 212 rows). Confirmed on a fixture covering seven shapes, each
receiving exactly one label.

### 0.0b Correction: the JSDoc counts, which were wrong in both directions

*(2026-09-11. Found by `js-impl` during extraction, re-measured here.)* The original tag counts
came from calling `ts.getJSDocTags(node)` on every node. That API is wrong for counting, in
**two opposite ways**, and the first version of this document shipped both errors:

- **It returns only ONE attached comment block's tags.** Verified on a fixture: three JSDoc
  blocks attached to one statement give `node.jsDoc.length === 3`, and `getJSDocTags` returns
  `["callback"]` — the other two `@typedef`s are invisible. This is the *normal* shape for
  "declare your types at the top of the module", so it hit `@typedef` hardest.
- **Its results INHERIT to child nodes.** A `@param` tag on a function is returned again for
  the parameter nodes beneath it, so walking every node counts one tag many times.

Reading `node.jsDoc[].tags` directly counts each tag exactly once:

| tag | reported | actual | error |
|---|---|---|---|
| `@param` | 40,551 | **14,307** | over-counted 2.8× (inheritance) |
| `@type` | 18,674 | **8,869** | over-counted 2.1× |
| `@returns` | 11,937 | **6,073** | over-counted 2.0× |
| `@template` | 1,013 | **624** | over-counted 1.6× |
| **`@typedef`** | 677 | **1,825** | **under-counted 2.7×** |
| **`@callback`** | 109 | **103** | — |

**No design decision changes, and one is strengthened.** The parameter-typing share is
**37.9%** measured directly (a `@param` carrying a type expression), against the 36.4%
originally claimed — so the finding that JSDoc is *the* declared-type channel stands on a
number that moved 1.5 points. And `@typedef` being 1,825 rather than 677 makes §2.3's argument
*stronger*: there are 2.7× as many types whose only evidence is a comment as first thought.

**One claim this corpus can no longer support.** Syntactic (Flow) annotations measure **0** here,
against the 64 originally reported — because those 64 were all in a static-site framework, which §0.3 records
as **absent** from the replication corpus. So `declaredTypeSource = SYNTACTIC_FLOW` is a column
justified by a measurement I cannot currently reproduce. It is kept, because the holdout
(the Flow holdout, Flow throughout) was chosen specifically to test it — and if the holdout shows the column
is wrong, that is the holdout doing its job.

### 0.1a The two primary keys, stated before any row exists

Asked for explicitly, and stated here rather than only at §3.1/§3.2, because a PK settled after
rows exist is a PK that gets settled by whatever the extractor happened to do.

```
js_module.PK = JS_MODULE_md5( filePath ‖ baseMservPath ‖ moduleSystem ‖ emissionRegime
                              ‖ serviceVersionLinkHash )

js_type.PK   = JS_TYPE_md5( ownerModuleLinkHash ‖ qualifiedName ‖ startLine ‖ startColumn )
```

**`js_module`.** `moduleSystem` is in the key because `import` under a CommonJS config is a
different program from `import` under an ESM one, and 91.4% of files are defaulted rather than
declared — so a `package.json` edit the file does not contain changes its facts. Keying on it
means the two fact sets are distinguishable rather than one silently overwriting the other.
`governingPackageJsonPath` is deliberately **out** of the key: it is the *evidence* for
`moduleSystem`, and evidence moving without the conclusion moving must not cascade every child
hash. `emissionRegime` is coarse (`js-ts6-inproc`) for the same reason `ts_module`'s is — a
patch bump must not re-key the fact base.

**`js_type`.** `startColumn` is in the key because two class expressions can share a line.
There is **no `declarationGroupKey`**: JavaScript has no declaration merging, so the TypeScript
problem that column exists to solve does not arise here (§3.2). The key chains off
`ownerModuleLinkHash` rather than re-deriving a qualified name, because
`module.exports = class {}` yields a type whose only name is its file's, and two such files in
one directory would collide on any name-derived key.

### 0.2 The rule this schema is judged against

**The parser emits IR. The engine resolves.** No cross-file following, no prototype-chain
walking, no multi-hop property resolution. **Same-file one-hop links only.** Java is the proof:
`referencedTypeRegistryLinkHash` is populated 0 times in 67,938 rows, and that is the design,
not an oversight. TypeScript lost this fight once — cross-file import following and multi-hop
property resolution were written and then deleted.

The measurement that replaces "resolution rate" is **IR completeness**: for every call site, is
every hop an engine would need actually present? A receiver whose type lives in another file
needs **three things and only three**:

1. the declared type **name as written**,
2. the **importing module**, and
3. **`import.resolvedFilePath`**.

If those are present the row is **complete**, even though the parser resolved nothing.

**So the 52.6% ceiling in §0.0 sizes the gates. It is not a licence to emit links.** No
resolved-link column belongs in this schema merely because tsc could fill it — the oracle
having an answer is not a reason for the parser to carry one. Every `resolved*LinkHash` here is
either **tier 3, declared and never staged**, or explicitly **same-file one-hop**:

| column | staging |
|---|---|
| `js_call_site.resolvedMethodLinkHash` | **tier 3, never staged** |
| `js_type_heritage.resolvedTypeLinkHash` | **tier 3, never staged** |
| `js_type_reference.resolvedTypeLinkHash` | **tier 3, never staged** |
| `js_import.resolvedModuleLinkHash` | **tier 3, never staged** |
| `js_expression.resolvedBindingLinkHash` | **tier 2, same-file one-hop only** — the binder's own output, never crossing a module boundary |

For calibration, the same columns in the Python IR as shipped: `py_call_site.resolvedCalleeHash`
is populated in 102 of 137 golden rows, and of those, **65 point inside the same module against
6 that do not**. Same-file dominance is the shipped behaviour, not an aspiration. (Those 6 are
another front end's business; quantified here and handed over, not acted on.)

**CommonJS is the case to watch.** `require('./router')` is a **module edge recorded as
written** — `specifier` as it appears in source, `specifierKind`, and `resolvedFilePath` from
`ts.resolveModuleName`, which needs no Program. It is **not a followed edge**: nothing in this
schema reaches through it to name what `./router` exports. That is precisely the temptation the
83.6% expression-borne finding creates, and §5 shows the three-hop shape that replaces it.

### 0.3 What population these numbers describe

> **Pinned.** `corpus/CORPUS.json` names every package by **peeled commit SHA**, and
> `corpus/materialise.mjs` reconstructs it into a root that is not a scratchpad.
> `materialise.mjs --verify` re-reads `HEAD` and fails on drift. The corpus has been lost
> **twice** to a session-scratchpad clear — once here, once by `js-corpus` during an ENOSPC
> recovery — and both times only committed things survived, so the corpus is now defined by
> something committed. The third-party source is never committed; the recipe is.

The corpus is **2,738 files, 15.5 MB — a library and framework *source* population, not
"JavaScript".** Carried as a qualifier on every number above:

| stratum (§6 of the brief) | files | share | present? |
|---|---|---|---|
| CommonJS / prototype-era | 2,308 | **84.3%** | yes — a one-file-per-method utility library 1,045, a bundler's own source 699, a runtime standard library 423, a CommonJS web framework 141 |
| JSDoc-typed | 214 | 7.8% | thinly — a media library 123, a charting library 57, a small UI library 34; **no Closure-annotated code** |
| Pure ESM | 109 | 4.0% | **one package** (a pure-ESM process library) |
| Dual / transitional | 69 | 2.5% | **one package** (a dual-published HTTP client) |
| JSX in `.js` | 38 | 1.4% | **one small app**; a static-site framework absent |
| Bundled / minified | 43 | — | **excluded by rule**, classified and never counted |

Three distortions to hold in mind when reading any percentage in §0.0:

- **a one-file-per-method utility library alone is 38.2% of files and the top two packages are 63.7%.** Every corpus-wide
  ratio is reported with a leave-one-out sensitivity for exactly this reason.
- **There is no application code at all.** a CommonJS web framework, a one-file-per-method utility library, a bundler's own source and a runtime standard library are
  libraries and tooling. Application code has different import density, far more JSX, and more
  framework-driven indirection.
- **The declared-type numbers are the most population-sensitive.** JSDoc density ranges from
  a CommonJS web framework 1.8% to a one-file-per-method utility library 73.0%, so "36.4% of parameters are JSDoc-typed" is a property of
  this mix and would move a long way on another.

### 0.3a What the de-identification cost, stated rather than hidden

*(2026-09-12, pre-publication.)* Every package name in this document was replaced by a
**role** — "a one-file-per-method utility library", "a runtime standard library" — keeping the
number and dropping the identity. Most claims survive that untouched: a ratio, a distribution,
a leave-one-out sensitivity and a per-stratum share all mean exactly what they meant.

**Three do not, and a document that quietly becomes unverifiable is worse than one that says
which claim it can no longer reproduce.**

1. **The vendor-dialect argument for the Flow holdout (§0.4).** Its force depends on the reader
   knowing that the two packages supplying the entire Flow population **share a vendor**, and
   that the holdout comes from a different one. De-identified, "one house style" is an assertion
   the reader must take on trust. The *measurement* (59×, 248 files, 0 parsing cleanly) is
   unaffected; the *inference about generalisability* is.
2. **The holdout audit trail (§0.4).** "Chosen before anyone believed they were finished" is
   only checkable if the choice is identifiable. As roles, nobody outside can verify the holdout
   was not swapped for an easier one after the fact. Internally the record stands; externally it
   is a claim, not evidence.
3. **Per-package attribution.** "12.9% at the lowest to 82.9% at the highest" can no longer be
   re-measured against a named package, so an outside reader cannot reproduce a single point —
   only the spread.

**Unaffected and worth saying so:** the resolution partition, the three environmental classes,
the decline-cause partition, every column justification, the `@type` host distribution, and the
duplicate-key repro — the last because its **seven-line synthetic minimal case carries no
identity at all**, so the defect remains reproducible from this document by anyone.

The corpus manifest itself is a separate problem and is **not** scrubbed here — §0.3b.

### 0.3b The pinned manifest — three layers, adopted; and one blocking discrepancy

`corpus/CORPUS.json` is the one artefact de-identification would destroy rather than weaken:
its entire function is eight names resolving to eight commit SHAs. Scrubbing it leaves a file
that reproduces nothing. **Adopted 2026-09-12.** Implemented in `corpus/CORPUS.json` (shape + digest, published) and
`materialise.mjs`, which reads identity from `$JS_CORPUS_IDENTITY` and **exits rather than
measure a partial corpus**:

| layer | where | contents |
|---|---|---|
| **shape** | published | strata, file counts, sizes, concentration, exclusion rules — everything §0.3 already states in roles |
| **content digest** | published | a SHA-256 over each stratum's sorted `(relative path, file sha)` list |
| **identity** | **private, outside the repo** | the eight `repo → tag → peeled SHA → subtree` rows |

`materialise.mjs` reads the identity layer from a path given by an environment variable, and
**fails loudly** when it is absent rather than silently measuring nothing.

The digest is what makes this more than hiding: a holder of the private manifest can prove
their materialised tree is **byte-identical** to the one every number here was measured on, and
a reader without it can still see that such a proof exists and was performed. It converts
"trust these numbers" into "this corpus has a fingerprint, and here it is" — which is weaker
than naming it and considerably stronger than silence.

> #### ⚠ The digest immediately found that the manifest does NOT reproduce §0.3
>
> Computing it was not a formality. **The manifest materialises 992 files; §0.3 reports 2,738.**
> Named causes, in `CORPUS.json` `reproduces.causes`: one package was **measured from its
> published npm artifact** and is pinned from its **git tag**, and its ~1,000 per-method files are
> generated at publish time and exist at no SHA — a git manifest **cannot** reproduce it by
> construction; a runtime standard library (423 files) and the JSX stratum (38) are **absent from
> the manifest entirely**; two subtrees are narrower than measured; one tag drifted.
>
> **So §0.3's numbers are currently reproducible from nothing committed.** That is precisely the
> failure this manifest exists to prevent, and it is **blocking for publication**.
>
> **How it was missed is the instructive part.** `materialise.mjs --verify` confirmed that eight
> SHAs resolved and that a second run was idempotent. Both were true, and **neither is the claim
> that the tree matches the measured population.** The mechanism was verified and the thing was
> not — §7.2.1's shape exactly, one level up: a manifest can be populated, resolvable, idempotent
> and wrong.
>
> The fix needs an `npm` source type carrying a tarball integrity hash alongside the `git` type,
> plus the two absent packages. Not done here; it changes what the corpus *is*, and every number
> in this document is measured against the current one.

**The alternative I considered and rejected: a generated fixture corpus** with the same
statistical shape. It would publish cleanly and it would destroy the property that made the
measurements worth anything — that they came from code nobody wrote for this parser. §7 of
`BUILDING-A-PARSER.md` exists because fixtures agree with whoever wrote them.

### 0.4 The held-back corpus — attested publicly, named privately

**Identities live in the private manifest (§0.3b).** A holdout was never cloned, so its name here
would be an attestation about something *absent* — but deleting the name outright leaves the
census guard and the attestation with no referent. So the **discipline publishes and the name
does not**:

> **Two named holdouts, identities in the private manifest, verified absent by seven checks, five
> of which have demonstrated synthetic positives.**

**The holdout digest — it fits, and it needs a salt to bind.** A per-holdout digest published
alongside the attestation is the right addition, because it closes one of the three losses
§0.3a records: *the holdout audit trail*. With it, when a holdout is finally opened, it can be
**proved to be the one pre-registered** — which is what stops a holdout being quietly swapped for
an easier one after the fact, and turns "chosen before anyone believed they were finished" from a
claim into evidence.

**But a bare `sha256(name)` does not bind.** The space of plausible holdout names is a few
thousand well-known repositories, so anyone can enumerate it and match in seconds — the digest
would conceal the name from a casual reader and from nobody else. **The commitment must be
salted, with the salt held in the private manifest**: publish `sha256(salt ‖ identity)`, keep the
salt private, and the pre-registration becomes checkable by a holder and opaque to everyone else.
The same argument as the corpus digest one level down — a fingerprint is only a commitment if it
cannot be reversed by guessing.

Their *roles* are published because the roles carry the argument: one is a **Flow-throughout
framework from a different vendor** than the entire Flow population, which is what makes it a
detector holdout rather than another sample of the same house style; the other is an
**application codebase** in the dialect this corpus otherwise lacks entirely.

#### (historical) The held-back corpus, named before the schema was written

Per §7 of `BUILDING-A-PARSER.md`: chosen **now**, and **not looked at**. Neither has been
cloned, parsed, or counted, and no number in this document comes from either.

| holdout | why this one | which claim it can falsify |
|---|---|---|
| **the Flow holdout** (a major framework, v2 source) — **repurposed 2026-09-12** | Flow throughout. Under §2.6 it is now almost entirely `FLOW_REJECTED`, which makes it a poor JavaScript holdout and an **excellent detector holdout**. And it is a **different vendor's dialect**: `js-corpus`'s Flow population is entirely a Flow-annotated UI framework and a static-site framework, so the detector has only ever been tested against one house style | that the `@flow` detector catches **100%** of its files — against a dialect it has never seen. Any file of it emitting more than a module row is a detection miss, and `SYNTACTIC_FLOW > 0` names it. The original purpose, testing whether the column was under-specified, was answered by `js-corpus` before the holdout was ever opened, by 59× |
| **the application holdout** (server source) | real **application** code, CommonJS, which §0.3 says this corpus has none of | the 83.6% expression-borne share, the 13.6% nested-`require` share, and whether `js_scope` survives contact with app-style dynamic requires |

The TypeScript holdout worked only because it was chosen before anyone believed they were
finished. Recording the choice here is what makes that true rather than claimed.

---

## 1. Naming, placement, key chaining

`js_*` for project code, `lib_js_*` for everything outside it — the same provenance split as
`java_*`/`ts_*`, not a language distinction.

```
src/schema/javascript/JAVASCRIPT-FACT-SCHEMA.md   this document (the source of truth)
src/schema/javascript/gen_decls.py                 generator + --check
src/schema/javascript/decls_base_js.dl             GENERATED, never hand-edited
```

**Build order**, extending §1 of `BUILDING-A-PARSER.md` with the second pass JavaScript needs:

```
module → scope → type → type_heritage → method → method_parameter → field → variable
       → type_reference (JSDoc)
       → expression → call_site
       → import / export        ← SECOND PASS, minted from expression rows (§2.1)
```

Every module hash is minted from **paths alone** before any file is parsed, so a declaration in
file B can key itself under file A's scope without file A having been parsed.

### Key-chaining discipline

Child keys chain off the parent hash; they are never re-derived from a qualified name. In
JavaScript this is not a nicety — `module.exports = function () {}` gives a function whose only
name is the file's, and two such files in one directory would collide on any name-derived key.

**Node identity is the byte range**, `${kind}:${start}:${end}`, never the start offset: a call
and its callee share a start offset constantly.

---

## 2. The five things with no TypeScript or Python analogue

### 2.1 The module graph lives in the expression relation

83.6% of module edges are expression-borne and 13.6% of `require()` calls are not top-level.
No TypeScript relation expects this, because every TypeScript module edge is a declaration at
the top of a file.

**Ruling taken:** `js_import` and `js_export` are **minted in a second pass from
`js_expression` rows**, not by a statement-list walk. Both relations carry:

- `edgeBearer` — `DECLARATION` | `EXPRESSION`. A real partition: 2,300 files are wholly one,
  431 wholly the other, 0 mixed.
- `sourceExpressionLinkHash` — FK→`js_expression`, `""` for declaration-borne rows. This is
  the column that makes the second pass auditable: every expression-borne edge points back at
  the expression it was minted from, so the 1:1 is checkable rather than asserted.
- `isTopLevel` — false for the 13.6%.

**The consequence for the gate**: `js_import` row count must equal the count of `js_expression`
rows whose kind is a module-edge kind, and every such expression must be pointed at by exactly
one import/export row. That check is what stops the second pass from silently double-minting —
the failure mode §2 of `BUILDING-A-PARSER.md` calls *doubling, not colliding*.

### 2.2 Members declared by assignment

`Foo.prototype.bar = function () {}` is a **method declaration** written as an assignment.
So is `Foo.staticM = function`, `Foo.prototype = {…}`, `Object.assign(Foo.prototype, {…})` and
`Object.defineProperty`. `util.inherits(Child, Parent)` is an **`extends` edge expressed as a
call**.

**Ruling taken:** these mint real `js_method` / `js_field` / `js_type_heritage` rows, with
`declarationForm` saying how they were written:

| `declarationForm` | measured |
|---|---|
| `CLASS_MEMBER` | 6,586 methods, 614 fields |
| `PROTOTYPE_ASSIGNMENT` | 361 methods, 233 fields |
| `STATIC_ASSIGNMENT` | 521 |
| `PROTOTYPE_OBJECT_LITERAL` (`X.prototype = {…}`) | 15 |
| `OBJECT_DEFINE_PROPERTY` | 76 |
| `OBJECT_ASSIGN_PROTOTYPE` | 2 |
| `JSDOC_TYPEDEF` | 677 (types only) |

and `js_type_heritage.heritageForm` ∈ `EXTENDS_CLAUSE` | `UTIL_INHERITS` |
`OBJECT_CREATE_PROTOTYPE` | `PROTOTYPE_ASSIGNMENT`.

They are **also** expressions — the assignment really happens. The row is minted in both
relations and `js_method.sourceExpressionLinkHash` ties them, exactly as §2.1 does for module
edges. Emitting only the expression is the defect class the parser doc names; emitting only
the declaration loses the fact that it executes at a particular point.

**Do not size this work from `util.inherits = 2`.** a runtime standard library has been modernised; a 2015-era
corpus inverts these counts. The memo says so explicitly and `js-corpus` owns re-measuring it.

### 2.3 JSDoc is the type channel, and it declares types that have no syntax

0.165% of parameters carry a syntactic annotation and **36.4% carry a JSDoc one**. So:

- Every typed position carries **`declaredTypeSource`** ∈ `NONE` | `JSDOC` | `SYNTACTIC_FLOW`.
  `SYNTACTIC_FLOW` exists because all 64 syntactic annotations measured are **Flow**, which
  `ts.createSourceFile` parses into real `.type` nodes where it overlaps TypeScript and
  mis-parses silently where it does not. Recording it keeps a Flow annotation from being
  mistaken for a TypeScript one by a later reader.
- `@typedef` (677) and `@callback` (109) mint **`js_type` rows with `declarationForm =
  JSDOC_TYPEDEF`** and a `startLine` inside a comment. `js_type` therefore has rows whose only
  evidence is a comment, and the FK from a `js_variable` to such a type is a normal FK.
- JSDoc type expressions are a **tree**, not a string: `Array<Object<string, number>>` is
  three nodes. They live in `js_type_reference` (§3.14) with the same parent-FK shape as
  `ts_type_reference`, capped at depth 32.

**Type-only constructs must never reach the call graph.** A `@typedef` naming a function shape
is not a call target. `js_type_reference.isTypeOnly` is true for every row, and the gate
asserts no `js_call_site` resolves to one.

### 2.4 Call kinds, including the ones syntax cannot decide

Enumerated against the corpus before declaring the relation:

| `callKind` | measured | note |
|---|---|---|
| `METHOD_CALL` (`obj.m()`) | 46,726 | |
| `FUNCTION_CALL` (`fn()`) | 39,334 | |
| `CONSTRUCTOR_CALL` (`new F()`) | 7,964 | |
| `COMPUTED_CALL` (`obj[expr]()`) | 663 | name not fixed by syntax |
| `FUNCTION_CALL_CALL` (`.call()`) | 541 | **receiver is argument 0** |
| `SUPER_CALL` | 517 | |
| `FUNCTION_CALL_APPLY` (`.apply()`) | 318 | **receiver is argument 0** |
| `FUNCTION_CALL_BIND` (`.bind()`) | 189 | produces a function, does not invoke |
| `IIFE_CALL` | 113 | |
| `OPTIONAL_CALL` (`obj?.m()`) | 28 | differs in reachability, not target |
| `TAGGED_TEMPLATE_CALL` | 20 | |
| `DYNAMIC_CODE_CALL` (`eval`, `new Function`) | 2 | target is unknowable; emitted, never guessed |
| `DYNAMIC_IMPORT_CALL` (`import()`) | — | also a module edge |

`require()` is **not** a call kind. Q1 rules it a module edge, and counting it as an unresolved
call is what made the raw resolution figure look worse than it is.

**`receiverPosition`** ∈ `SYNTACTIC` | `FIRST_ARGUMENT` | `NONE` exists solely because
`.call`/`.apply`/`.bind` (1,048 sites) move the receiver into an argument. An engine reading
the syntactic receiver gets `Function.prototype.call` as the target and the real receiver not
at all.

**Reserved, with a zero-row assertion** — each is a fact about a value's runtime identity, not
its syntax, and `INDEX_CALL` is the precedent:

| reserved value | why it can never be read from syntax |
|---|---|
| `INDEX_CALL` | a fact about the receiver's *type* |
| `GETTER_INVOCATION` / `SETTER_INVOCATION` | a property *read* invokes a function only if the property is an accessor — a fact about the object, not the expression. 1,225 getters are declared; **0** invocations are emittable |
| `PROXY_TRAP_CALL` | any property access on a `Proxy` may invoke a trap |
| `GENERATOR_RESUME` | `.next()` on a generator resumes a suspended frame |

The enum-emission audit (§7.1) carries these on an explicit allowlist, each asserted to have
zero rows. The day one is switched on, it shows up as a named gate failure rather than as new
rows nobody noticed.

### 2.5 Two binding regimes and a temporal dead zone

`var` (3,705) is function-scoped and hoisted; `let`/`const` (41,353) are block-scoped with a
TDZ; function declarations (5,271) hoist entirely and function expressions (4,325) do not.
This is Python's problem, and `python-scope-builder.ts` is the model, not `ts-binder.ts`.

`js_scope` (§3.13) is a real relation with a parent FK, and every binding carries:

**`bindingRegime`** ∈ `VAR_FUNCTION_SCOPED_HOISTED` | `LET_BLOCK_TDZ` | `CONST_BLOCK_TDZ` |
`FUNCTION_DECLARATION_HOISTED` | `CLASS_TDZ` | `PARAMETER` | `CATCH_PARAMETER` |
`IMPORT_BINDING` | `GLOBAL_IMPLICIT`.

`GLOBAL_IMPLICIT` is the sloppy-mode assignment to an undeclared name. It is a binding with no
declaration, and it is why the scope tree cannot be derived from declarations alone.

### 2.5a JSX tag names are references, and the capitalisation rule is language, not convention

*(Ruled 2026-09-12, on 833 tag names emitting nothing.)*

JSX capitalisation is **decided by the language**, not by house style. "Capitalised or dotted"
is the folk version of the rule and it is wrong in **both** directions — `js-fixtures` has
counterexamples each way — so the rule is stated exactly:

> **A JSX tag emits a reference child iff it is a *simple identifier whose first character is
> not a lowercase letter*, or a *property access*. Everything else emits none.**

| tag | form | emits a reference? | why |
|---|---|---|---|
| `<div>`, `<foo-bar>` | simple identifier, lowercase first | **no** | intrinsic — the factory receives the *string* `"div"` |
| `<Foo>` | simple identifier, uppercase first | **yes** | value read from lexical scope |
| `<_Private>` | simple identifier, `_` first | **yes** | **`_` is not a lowercase letter.** `'_'.toLowerCase() === '_'.toUpperCase()`, so a test for "is lowercase" must require the character to *change* under `toUpperCase`, not merely to equal its own lowercase |
| `<$Money>` | simple identifier, `$` first | **yes** | same reason |
| `<widgets.panel>` | property access | **yes** | **lowercase and still a reference** — member expressions are exempt from the capitalisation rule entirely; `widgets` is a binding |
| `<X.y.z>`, `<this.Widget>` | property access | **yes** | root identifier recoverable from the subtree |
| `<svg:circle>` | `JsxNamespacedName` | **no** | there is no binding named `svg:circle` — it is not a valid identifier, so a reference row would name something nothing can satisfy. Same argument as `div` |

All eight verified against `ts.createSourceFile`. The rule is **syntactically decidable**, so
this is **IR, not resolution** — and 833 component references pointing at nothing is the same
shape as the unreferenced callables c32 was appended for.

**The ruling: no new column and no new relation.** The tag name is emitted as an **ordinary
child expression** of the JSX element, using columns that already exist:

- the JSX element is a `js_expression` row, `expressionKind` = `JSX_ELEMENT` (component) or
  `JSX_INTRINSIC_ELEMENT` (intrinsic) — two kinds, because they differ in *whether they
  reference anything at all*, which is structural rather than a variant in a field;
- for a component, the tag name is a **child expression** with `edgeRole = JSX_TAG_NAME`,
  carrying `referencedName`, `referenceKind = READ`, `bindingResolution` and
  `resolvedBindingLinkHash` — the same columns any other identifier read uses;
- a **dotted tag needs no special case**: it is already a property-access subtree, so
  `<X.Y.Z/>` yields the same shape as the expression `X.Y.Z` and the root identifier falls out;
- an **intrinsic tag emits no reference child.** It refers to nothing, and minting a reference
  row for `div` would put a name into the binding graph that no binding can ever satisfy.

All of `expressionKind`, `edgeRole` are enum vocabularies, so this costs **no column and no
freeze violation**.

**`JSX_COMPONENT_CALL` stays reserved** (§2.4), and the reason is worth stating because it
looks like the opposite decision. `<Foo/>` *does* invoke something at runtime — but it invokes
the **factory** (`a Flow-annotated UI framework.createElement`, `_jsx`, `a small UI library.h`, or whatever a pragma names), and
`Foo` is passed to it as an **argument**. Which factory, and whether `Foo` is then called or
constructed, are facts about the build configuration and about the value — not about the
syntax. So the **reference** is IR and is emitted; the **call** is a resolution outcome and is
reserved, exactly as `.call`/`.apply` put the receiver in an argument (§2.4) and exactly as
TypeScript reserves the same value.

### 2.6 Flow is out of scope — ruled, and it is a rejection, not an absence

*(Ruled 2026-09-12, after `js-corpus` falsified §0.0's Flow measurement by 59×.)*

**The falsification first, because it is the reason this section exists.** §0.0 recorded
syntactic type annotations at **64 parameters, 0.165%, one package**, and §0.0b already warned
the claim rested on a corpus I could not reproduce. `js-corpus` measured a corpus with 248
`@flow` files: **3,793 of 58,017 parameters, 6.5%** — which makes Flow the **second declared-type
channel** in JavaScript after JSDoc. My own §7.3c rule, applied to my own document: every
measured zero is a statement about a corpus.

#### Why the answer is "out of scope" and not "emit with a named residual"

The tempting option is to keep emitting and name the error term. **It is not available, because
the residual cannot be named.** `ts.ScriptKind.JS` does not reject Flow — it accepts the parts
that overlap TypeScript and mis-parses the rest, and the most common Flow idiom mis-parses
**silently**:

| Flow construct | `ScriptKind.JS` | what the fact base would record |
|---|---|---|
| `x: ?number` — nullable, the commonest Flow idiom | **0 diagnostics** | a `JSDocNullableType` node. Right by coincidence of two grammars, not by support |
| `x: mixed` | **0 diagnostics** | `TypeReference` named `mixed` — a type that does not exist in TypeScript |
| `declare function g(x: number): void;` | **0 diagnostics** | a `js_method` row with `bodyPresence = NO_BODY` — **a type-only declaration in the call graph** |
| `{| a: number |}` exact objects | 3 diagnostics, **0 ERROR nodes** | a recovered, plausible, wrong tree |
| `+a: number` variance | 3 diagnostics, 0 ERROR nodes | likewise |
| `opaque type`, `%checks`, `(x: T)` casts | 1–2 diagnostics | likewise |

> **A residual detectable only where the compiler happens to complain is a sample of one.**

And the silent rows are the dangerous ones: a correctly-positioned row carrying a type that
came from a language the parser does not implement is invisible to recall, to completeness and
to oracle adjudication alike — §4's defect class exactly.

It also breaks **two day-one gates at once**: `declare function` puts type-only declarations in
the call graph (gate §7.1), and `js-corpus` measures **121 duplicate primary keys** on Flow
files (gate §7.2). A day-one gate that is broken on a file class is not a gate.

#### The strongest case AGAINST this ruling, and why it fails

`js-corpus`'s stratum analysis looks, at first reading, like an argument for keeping Flow:

- the Flow stratum **resolves best of all five strata, at 75.5%**;
- it shows **no Flow-specific recall loss**.

On any measure of *resolution quality*, Flow-typed JavaScript is the best-behaved code in the
corpus, and a rule that throws away the best-typed stratum deserves suspicion.

**It fails because the two facts have one cause.** Flow resolves at 75.5% *because* its type
annotations overlap TypeScript's syntax, so tsc reads them and types the program. The same
overlap, one step further along, is what produces **3,793 parameters typed in a language the
parser does not implement**. Best-typed and worst-parsed are not a trade-off to be balanced —
they are the same mechanism observed from two ends.

So the high resolution number is not evidence the fact base is right. It is evidence that tsc
confidently understood something, and the question this schema has to answer is *what*. A row
recording `x: mixed` as a `TypeReference` with **zero diagnostics** is wrong in the direction
no check can see, and it is wrong *more* convincingly the better the stratum resolves.

**A resolution rate cannot detect a wrong-language parse.** That is why the ruling turns on the
silent column and not on the stratum's score.

#### The ruling

**A Flow file is not JavaScript, and the JavaScript front end does not emit facts for it.**

- **Detection:** an `@flow` pragma in a leading comment, or a `.js.flow` extension.
- **Emission:** exactly **one `js_module` row**, with `sourceProvenance = FLOW_REJECTED`,
  `hasFlowPragma = true`, and **no other row in any relation**.
- **Not a `SkippedFileReason`.** That enum is shared by five front ends and adding a
  JavaScript-specific value to it is a cross-language change to solve a local problem
  (worktree protocol §3). `sourceProvenance` is a column this schema owns, `BUNDLED`
  is the precedent, and the enum value is free.

`js-corpus` is right that **absence of support is not the same as rejection**, and this is the
rejection: the module row records that the file was seen, identified, and declined. It is
countable, it is greppable, and it keeps a Flow file from contributing a single row to any
denominator.

#### The detector leaks, the leak is bounded, and the measurement of it is circular

*(Recorded 2026-09-12.)* `js-corpus` measures **10 files** that carry Flow and no `@flow`
pragma and no `.js.flow` name, leaking **25 `SYNTACTIC_FLOW` rows** past the §2.6 detector.
They are unambiguously Flow — `mixed` has no TypeScript equivalent, `a Flow-annotated UI framework$ElementType` is
Flow's utility-type spelling — so the ruling's own justification applies and they should not
have been emitted. A token-level detector would catch 4 of the 10; the other 6 need
project-level evidence (`.flowconfig`, a build config) that a per-file parser does not have.

**The part that matters more than the leak is that the measurement of it is circular.**
`js-corpus` identified its Flow population **by pragma**. So a Flow file with no pragma whose
annotations sit somewhere the audit does not look — outside parameters — is invisible **both to
the detector and to the instrument measuring the detector**. The 6.5% figure, the 248-file
count and the 10-file leak are all lower bounds produced by a pragma-keyed instrument, and no
amount of re-running it can establish otherwise.

**the Flow holdout is the only instrument that can break the circle**, which is why its repurposing
(§0.4) turned out to matter more than it looked. It is Flow throughout, it is a **different
vendor's dialect** from the a Flow-annotated UI framework/a static-site framework population every current number comes from, and
crucially its Flow-ness is known *independently of any pragma scan* — from the project, not
from the file. Running the detector against it measures **detection**, not
detection-as-measured-by-detection. It is the most valuable unopened thing this front end
holds, and it should not be opened for anything less.

#### `SYNTACTIC_FLOW` stops being a channel and becomes a tripwire

`declaredTypeSource = SYNTACTIC_FLOW` stays in the vocabulary, with its meaning **changed**: it
no longer names a declared-type channel the parser supports. It names **a detection miss** — a
syntactic type annotation that survived into a file this schema emitted, which can only happen
if the file is Flow and carried no pragma.

Its expected count in emitted files is **0**, and unlike a reserved value that is not an
assertion of impossibility: it is a **named residual that `js-corpus` can size**. Each
occurrence identifies a file whose detection failed. That is the honest version of "emit with a
named residual" — applied to the detector rather than to the mis-parse.

#### What this costs, stated plainly

Flow-typed JavaScript is a real and non-trivial population, and this ruling emits nothing for
it. That is a deliberate loss, taken because the alternative is a fact base that is confidently
wrong in a way no count can see. If Flow support is later wanted it is **its own front end**
with its own parse layer — not a `ScriptKind` on this one, for exactly the reason §0 of
`BUILDING-JAVASCRIPT.md` gives about JavaScript and TypeScript.

---

## 3. The relations

16 pairs. `T` is the tier: **1** = emit now, **2** = emit now, value may be `""` until the
resolver fills it, **3** = declared, not staged by the parser.

Where a column mirrors a `ts_*` position it is held at that position so the engine's
projection ports as a rename; where JavaScript differs, it differs and the row says why.

---

### 3.1 `js_module` / `lib_js_module` — 28 columns ★

A `.js` / `.mjs` / `.cjs` / `.jsx` file. There is no ambient-module analogue: JavaScript has no
`declare module`, so unlike `ts_module` this relation is one row per file, always.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | file stem |
| 1 | `qualifiedName` | 2 | specifier by which this module is importable, extension-stripped, project-relative |
| 2 | `fileName` | 1 | `router.js` |
| 3 | `filePath` | 1 | repo-relative |
| 4 | `baseMservPath` | 1 | service root (Java convention) |
| 5 | `moduleKind` | 1 | `SOURCE_MODULE` \| `SCRIPT_GLOBAL` \| **`JSON_MODULE` — RESERVED, zero rows** (§7.1). A `.json` file is not JavaScript source and appears in this vocabulary only as an import *target*; the parser emits no row for a file it does not walk, and adding `.json` to the source extensions would mint a module row for every `package.json` in the tree |
| 6 | `scriptKind` | 1 | `JS` \| `JSX` — provenance only. **Never read from config**: 0 of 2,942 files parse differently between the two, because `ScriptKind.JS` already carries `languageVariant = JSX` |
| 7 | `moduleSystem` ★ | 1 | `COMMONJS` \| `ESM`. **In the PK** |
| 8 | `moduleSystemSource` ★ | 1 | **how it was decided**: `EXT_MJS` \| `EXT_CJS` \| `PKG_TYPE_MODULE` \| `PKG_TYPE_COMMONJS` \| `PKG_TYPE_ABSENT_DEFAULT` \| `NO_PACKAGE_JSON_DEFAULT`. 91.4% of files are defaulted, not declared — without this column a defaulted CommonJS is indistinguishable from a declared one |
| 9 | `governingPackageJsonPath` | 1 | the nearest-ancestor `package.json` that decided it; `""` when none was found (15.4%) |
| 10 | `contradictsGoverningConfig` ★ | 1 | file uses the module system its config does not name. **6.2% measured**, all ESM-under-CommonJS, all bundler input. Per the Q3 ruling this is a **flag, never a skip** |
| 11 | `contradictionKind` | 1 | `NONE` \| `ESM_SYNTAX_UNDER_COMMONJS` \| `REQUIRE_UNDER_ESM` \| `MIXED`. **`REQUIRE_UNDER_ESM` was reported as 0 and is not — `js-impl` measures 4 of 816 files** (§7.3c). The original count came from a 15-file scaffold |
| 12 | `packageName` | 2 | owning npm package for external files; `""` for project files |
| 13 | `isExternalModule` | 1 | has a top-level `import`/`export` — decides module scope vs global scope |
| 14 | `hasTopLevelAwait` | 1 | forces module semantics |
| 15 | `hasJsxContent` | 1 | recorded **after** parsing, not before (§0.0) |
| 16 | `hasFlowPragma` | 1 | `@flow`. 6 files measured; the reason `SYNTACTIC_FLOW` exists (§2.3) |
| 17 | `emissionRegime` ★ | 1 | coarse token, never a version string: `js-ts6-inproc`. **In the PK**, same reasoning as `ts_module` |
| 18 | `targetTsVersion` | 1 | exact compiler at emit — `6.0.3`. Provenance only, deliberately **not** in the PK |
| 19 | `startLine` | 1 | 1 |
| 20 | `endLine` | 1 | **the last line of the DECLARATOR, not of the name** — §3.7.1. `const x = {\n…\n}` spans; `const x = 1` does not |
| 21 | `moduleInitMethodLinkHash` ★ | 1 | FK→`js_method` — the synthetic `<module>` initializer owning top-level statements |
| 22 | `moduleScopeLinkHash` ★ | 1 | FK→`js_scope` — the module's own scope, root of the binder tree |
| 23 | `defaultExportLinkHash` | 2 | FK→`js_export`; `""` |
| 24 | `sourceProvenance` | 1 | `PROJECT` \| `BUNDLED` \| `GENERATED_MONOLITH` \| `FLOW_REJECTED` — **two different kinds of thing, §3.1.1.** Only `FLOW_REJECTED` withholds rows |
| 25 | `isExternal` | 1 | parity slot, always `false` on parser output |
| 26 | `serviceVersionLinkHash` | 1 | |
| 27 | `jsModuleUniqueHash` | — | **PK** |

**PK** `JS_MODULE_md5(filePath ‖ baseMservPath ‖ moduleSystem ‖ emissionRegime ‖ serviceVersionLinkHash)`
**FKs** 21→`js_method`, 22→`js_scope`, 23→`js_export` (back-patched; accumulate-then-export makes this free).

#### 3.1.1 `BUNDLED` labels; `FLOW_REJECTED` withholds — and the old names hid that

*(Renamed 2026-09-13, after rulings landed with `js-fixtures`.)* Both values used to end in
`_EXCLUDED`, and they are **not the same kind of thing**:

| value | rows emitted | what the value is |
|---|---|---|
| `PROJECT` | all | ordinary source |
| **`BUNDLED`** | **all** | a **label**. The parser emits correct facts for bundler output, and the provenance column is how a consumer filters — dropping them at emit time is the parser deciding what a consumer wants |
| `GENERATED_MONOLITH` | **all** | the same: a label on a concatenated build shipped beside its sources |
| **`FLOW_REJECTED`** | **one `js_module` row and nothing else** | a **rejection**. Flow is not JavaScript (§2.6), and the facts would be wrong rather than unwanted |

**The distinction is emission versus wanting.** A bundled file's facts are *right* and a consumer
may not want them; a Flow file's facts are *wrong*. `_EXCLUDED` on both said the parser had
declined twice, when it had declined once and labelled once — and a reader filtering on the
suffix would have thrown away correct rows.

**Consequently §7.3 rule 5 was wrong and is corrected.** It said non-`PROJECT` files
*"contribute zero rows"*, which is true only of `FLOW_REJECTED`. What was meant, and what the
rule now says, is that they are excluded from **coverage denominators** — you do not measure
recall against generated code. Emitting a row and counting it are different acts, and the old
wording conflated them.

#### 3.1.2 What may label a file `BUNDLED` — RULED 2026-09-13

*(`js-corpus` measured the length signal and found it had never earned a catch. `js-impl`
landed the conjunction the same day; this section ratifies the wording and records the
recall check, because a rule that removes a signal is only safe if what it stops catching
was measured.)*

**A single long line is not evidence of generation.** A 399-line hand-written CommonJS file
carrying one 7,286-character regular-expression literal — a Unicode-range whitelist — was
labelled `BUNDLED` by a 5,000-character threshold, and the threshold's own comment had said
that could not happen.

The direction of the error is what decides this. §0.3's asymmetry — *including a bundle
inflates a denominator **detectably**; removing real source leaves nothing behind* — applies to
the length signal exactly as to the name pattern, and it applies **harder** here, because
`BUNDLED` is what excludes a file from every coverage denominator (§7.3 rule 5). A false
`BUNDLED` is the un-findable error: the file is still in the fact base, still looks emitted,
and simply stops being counted.

So the rule is:

| signal | on its own | measured on the 4,529-file development tree |
|---|---|---|
| a `.min.`/`.bundle.` name | **sufficient** — a tool wrote that name | catches **17 of 17** real bundles |
| a bundler runtime preamble | sufficient for `GENERATED_MONOLITH`, not for `BUNDLED` | 0 in this tree |
| a line over the threshold | **never sufficient** | 1 catch, and it was the false positive |
| a long line **and** a `sourceMappingURL` footer or a preamble | sufficient | 0 unique catches here |

**Recall check, because removing a signal must be measured and not argued.** Re-classifying the
whole tree under both rules: **18 files `BUNDLED` before, 17 after, and the one that changed is
the false positive.** Every real bundle is caught by name — including the tree's shortest-lined
minified build, at 4,233 characters, which the length signal never caught anyway. No true
positive is lost. *(That file is identified only in the private corpus identity file, §0.3b, so
this particular row cannot be re-checked from the published document alone; the 18→17 totals
and the 622–4,233 range below can be, from the manifest.)*

**The conjunction is therefore inert on this tree, and it stays.** Per §7.3c that is a statement
about a corpus: a bundler-emitted `dist/index.js` with an ordinary name is a real shape, it is
simply absent here, and when it appears it carries a footer or a preamble. Retained as
`MERELY_UNOBSERVED`, not as a rule with evidence behind it — and the honest form of that is a
conjunction that cannot fire alone, rather than a threshold tuned until this corpus goes quiet.

**Why not lower the threshold instead.** The real minified files here wrap at 622–4,233
characters, *below* 5,000. Any threshold that caught them by length would sit under 622 and
label ordinary source in bulk. Length is not separating the two populations at all; it is not a
weak signal, it is the wrong axis.

#### Why `moduleSystem` is in the primary key

A file's identity must not change when a `package.json` it does not contain is edited — but its
*facts* genuinely do change, because `import` in a CommonJS-governed file is a different program
from `import` in an ESM one. Putting `moduleSystem` in the key means a repo analysed before and
after a `"type": "module"` edit produces two distinguishable fact sets rather than one silently
overwritten one. It is the same argument as `ts_module.emissionRegime`, applied to a property of
the *file's governing config* rather than of the analysis run — which is why both columns exist
and neither subsumes the other.

`governingPackageJsonPath` is **not** in the key, deliberately: it is the *evidence* for
`moduleSystem`, and evidence changing without the conclusion changing must not cascade.

---

### 3.2 `js_type` / `lib_js_type` — 26 columns

A type **declaration**: an ES class, a constructor function with prototype members, or a JSDoc
`@typedef`/`@callback`. Object literals are **not** here — they are values, and treating every
object literal as a type is how a JavaScript fact base acquires 50,000 meaningless types.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | `Router`; `""` for an anonymous class expression |
| 1 | `qualifiedName` | 2 | module-qualified |
| 2 | `fileName` | 1 | |
| 3 | `filePath` | 1 | |
| 4 | `baseMservPath` | 1 | |
| 5 | `startLine` | 1 | |
| 6 | `endLine` | 1 | |
| 7 | `startColumn` | 1 | in the PK — two class expressions can share a line |
| 8 | `typeCategory` | 1 | `CLASS` \| `CONSTRUCTOR_FUNCTION` \| `JSDOC_TYPEDEF` \| `JSDOC_CALLBACK` \| `ANONYMOUS_CLASS` |
| 9 | `declarationForm` ★ | 1 | `CLASS_DECLARATION` \| `CLASS_EXPRESSION` \| `PROTOTYPE_CONSTRUCTOR` \| `JSDOC_TYPEDEF` (§2.2) |
| 10 | `isAbstract` | 1 | parity slot, always `false` — JavaScript has no `abstract` |
| 11 | `modifiers` | 1 | `""` mostly; `static` blocks recorded |
| 12 | `evidenceKind` ★ | 1 | `SYNTAX` \| `COMMENT_ONLY`. **677 `@typedef` rows are `COMMENT_ONLY`** — a type whose only evidence is a comment (§2.3) |
| 13 | `isTypeOnly` | 1 | true for `JSDOC_TYPEDEF`/`JSDOC_CALLBACK`. **No call-graph rule may traverse these rows** |
| 14 | `declaredMemberCount` | 1 | |
| 15 | `hasPrototypeMembers` | 1 | true when members arrived by assignment (§2.2) |
| 16 | `constructorMethodLinkHash` | 2 | FK→`js_method` |
| 17 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 18 | `ownerScopeLinkHash` | 1 | FK→`js_scope` — a class is a binding, and it is in a TDZ |
| 19 | `enclosingMethodLinkHash` | 2 | FK→`js_method`; `""` at module level |
| 20 | `sourceExpressionLinkHash` ★ | 2 | FK→`js_expression` for assignment-declared types; `""` for `class` syntax |
| 21 | `jsdocCommentLinkHash` | 2 | FK→`js_comment`; the evidence for a `COMMENT_ONLY` row |
| 22 | `isExported` | 2 | |
| 23 | `isExternal` | 1 | parity slot |
| 24 | `serviceVersionLinkHash` | 1 | |
| 25 | `jsTypeUniqueHash` | — | **PK** |

**PK** `JS_TYPE_md5(ownerModuleLinkHash ‖ qualifiedName ‖ startLine ‖ startColumn)`

There is **no `declarationGroupKey`.** TypeScript needed one because declaration merging makes
`name → single entity` false. JavaScript has no declaration merging: a second `class Foo` is a
redeclaration error, and `Foo.prototype.x = …` after `class Foo` mutates the *same* entity,
which the FK from `js_method` already expresses. Adding a merge key here would be porting a
solution to a problem this language does not have.

---

### 3.3 `js_type_heritage` / `lib_js_type_heritage` — 16 columns ★

One inheritance edge. The relation exists separately from `js_type` because **in JavaScript an
`extends` edge can be a function call** (§2.2).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `ownerTypeLinkHash` | 1 | FK→`js_type` — the subtype |
| 1 | `position` | 1 | always 0; JavaScript is single-inheritance |
| 2 | `heritageForm` ★ | 1 | `EXTENDS_CLAUSE` \| `UTIL_INHERITS` \| `OBJECT_CREATE_PROTOTYPE` \| `PROTOTYPE_ASSIGNMENT` |
| 3 | `superTypeName` | 1 | **as written** — `EventEmitter`, `require('events').EventEmitter` |
| 4 | `superTypeExpressionText` | 1 | the full expression when the superclass is computed (`class X extends mixin(Y)`) |
| 5 | `isComputedSuperclass` | 1 | true when syntax does not fix the name |
| 6 | `inheritsMembers` | 1 | always `true` — JavaScript has no `implements`, so the TypeScript distinction collapses |
| 7 | `resolvedTypeLinkHash` | 3 | FK→`js_type`. **Declared, never staged by the parser** — this is the engine's job |
| 8 | `resolvedFilePath` | 2 | where the superclass name was imported from, when known |
| 9 | `importLinkHash` | 2 | FK→`js_import` — the hop the engine needs |
| 10 | `sourceExpressionLinkHash` ★ | 2 | FK→`js_expression` for `UTIL_INHERITS` / `OBJECT_CREATE_PROTOTYPE` |
| 11 | `startLine` | 1 | |
| 12 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 13 | `isExternal` | 1 | parity slot |
| 14 | `serviceVersionLinkHash` | 1 | |
| 15 | `jsTypeHeritageUniqueHash` | — | **PK** |

`resolvedTypeLinkHash` is **tier 3 and stays empty**, exactly as Java's
`referencedTypeRegistryLinkHash` is populated 0 times in 67,938 rows. The parser emits the name
as written plus the import hop; the engine resolves. Columns 3, 8 and 9 are the three things
§0 of `BUILDING-A-PARSER.md` says make a row complete.

---

### 3.4 `js_method` / `lib_js_method` — 36 columns

Every callable: function declaration, function expression, arrow, class method, accessor,
prototype-assigned method, and the synthetic `<module>` initializer.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | `""` for an anonymous function expression |
| 1 | `qualifiedName` | 2 | |
| 2 | `fileName` | 1 | |
| 3 | `filePath` | 1 | |
| 4 | `baseMservPath` | 1 | |
| 5 | `startLine` | 1 | |
| 6 | `endLine` | 1 | |
| 7 | `startColumn` | 1 | **in the PK** — 9,391 arrows, many sharing a line |
| 8 | `methodKind` | 1 | `FUNCTION_DECLARATION` \| `FUNCTION_EXPRESSION` \| `ARROW` \| `CLASS_METHOD` \| `CONSTRUCTOR` \| `GETTER` \| `SETTER` \| `MODULE_INITIALIZER` \| `STATIC_BLOCK` |
| 9 | `declarationForm` ★ | 1 | `SYNTACTIC` \| `PROTOTYPE_ASSIGNMENT` \| `STATIC_ASSIGNMENT` \| `PROTOTYPE_OBJECT_LITERAL` \| `OBJECT_DEFINE_PROPERTY` \| `OBJECT_ASSIGN_PROTOTYPE` (§2.2) |
| 10 | `hoisting` ★ | 1 | `HOISTED_FULLY` (function declaration, 5,271) \| `NOT_HOISTED` (function expression, 4,325) \| `TDZ` \| `NOT_APPLICABLE`. Same syntax category, different behaviour by position |
| 11 | `isAsync` | 1 | |
| 12 | `isGenerator` | 1 | 248 `yield` sites |
| 13 | `isStatic` | 1 | |
| 14 | `parameterCount` | 1 | |
| 15 | `hasRestParameter` | 1 | |
| 16 | `usesArguments` ★ | 1 | references `arguments`. A second parameter channel with no declaration — an engine modelling only named parameters loses it |
| 17 | `thisBinding` ★ | 1 | `LEXICAL` (arrow) \| `DYNAMIC` (function) \| `BOUND` (`.bind`) \| `NONE`. 33,189 `this` references; the call form decides what `this` is |
| 18 | `returnTypeName` | 2 | from JSDoc `@returns` (11,937); `""` otherwise |
| 19 | `declaredTypeSource` ★ | 1 | `NONE` \| `JSDOC` \| `SYNTACTIC_FLOW` (§2.3) |
| 20 | `returnTypeReferenceLinkHash` | 2 | FK→`js_type_reference` |
| 21 | `bodyPresence` | 1 | `HAS_BODY` \| `EXPRESSION_BODY` (concise arrow) \| `NO_BODY` |
| 22 | `ownerTypeLinkHash` | 2 | FK→`js_type`; `""` for a free function |
| 23 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 24 | `ownerScopeLinkHash` | 1 | FK→`js_scope` — the scope this method *is declared in* |
| 25 | `bodyScopeLinkHash` | 1 | FK→`js_scope` — the scope this method *opens* |
| 26 | `enclosingMethodLinkHash` | 2 | FK→`js_method`; closures nest |
| 27 | `sourceExpressionLinkHash` ★ | 2 | FK→`js_expression` for assignment-declared methods |
| 28 | `jsdocCommentLinkHash` | 2 | FK→`js_comment` |
| 29 | `isExported` | 2 | |
| 30 | `isEntryPoint` | 2 | |
| 31 | `methodReferenceKind` | 1 | parity slot with Java, always `""` — JavaScript has no `::` |
| 32 | `modifiers` | 1 | |
| 33 | `isExternal` | 1 | parity slot |
| 34 | `serviceVersionLinkHash` | 1 | |
| 35 | `jsMethodUniqueHash` | — | **PK** |

**PK** `JS_METHOD_md5(ownerModuleLinkHash ‖ qualifiedName ‖ startLine ‖ startColumn ‖ methodKind)`

`thisBinding` and `usesArguments` are the two columns with no analogue in any existing front
end, and both are load-bearing: `this` is rebound by call form (33,189 sites), and `arguments`
is a parameter list nobody declared.

---

### 3.5 `js_method_parameter` / `lib_js_method_parameter` — 22 columns

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | `""` for a destructuring pattern (6,909 patterns) |
| 1 | `position` | 1 | |
| 2 | `ownerMethodLinkHash` | 1 | FK→`js_method` |
| 3 | `declaredTypeName` | 2 | from JSDoc `@param {T}` — **36.4% of parameters**; `""` otherwise |
| 4 | `declaredTypeSource` ★ | 1 | `NONE` (63.6%) \| `JSDOC` (36.4%) \| `SYNTACTIC_FLOW` (0.165%) |
| 5 | `typeReferenceLinkHash` | 2 | FK→`js_type_reference` |
| 6 | `isOptional` | 1 | a code default, **or either** JSDoc optional marker: `@param {T} [x]` *and* `@param {T=} x` (§3.5a) |
| 7 | `hasDefault` | 1 | **the code's initializer, never the comment's** (§3.5b) |
| 8 | `defaultValueText` | 1 | likewise — `""` when the code has no default, whatever a comment claims |
| 9 | `isRest` | 1 | |
| 10 | `bindingForm` ★ | 1 | `IDENTIFIER` \| `OBJECT_PATTERN` \| `ARRAY_PATTERN` \| `ASSIGNMENT_PATTERN`. A destructured parameter binds N names and the engine must see all of them |
| 11 | `patternBindingCount` | 1 | how many names this parameter actually binds |
| 12 | `bindingRegime` | 1 | always `PARAMETER` (§2.5) |
| 13 | `scopeLinkHash` | 1 | FK→`js_scope` |
| 14 | `startLine` | 1 | |
| 15 | `startColumn` | 1 | |
| 16 | `isParameterProperty` | 1 | parity slot with TypeScript, always `false` |
| 17 | `jsdocCommentLinkHash` | 2 | FK→`js_comment` |
| 18 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 19 | `isExternal` | 1 | parity slot |
| 20 | `serviceVersionLinkHash` | 1 | |
| 21 | `jsMethodParameterUniqueHash` | — | **PK** |

**PK** `JS_METHOD_PARAMETER_md5(ownerMethodLinkHash ‖ position ‖ name)`

A destructured parameter is **one** parameter row with `patternBindingCount > 0`. Emitting N
parameter rows would break `position`.

**Correction, 2026-09-12.** This section previously said the bound names also mint N
`js_variable` rows with `bindingRegime = PARAMETER`. **They do not.** The emitter deliberately
skips every `PARAMETER`-regime binding when emitting variables, because a parameter's position
and default belong to `js_method_parameter` and minting it twice is the same construct on two
paths — §2's doubling hazard. The emitter is right and this text was wrong. The consequence is
that references to parameter names reach their declaration through
`js_expression.resolvedParameterLinkHash` (§3.10 c33), not through `resolvedBindingLinkHash`,
and that is uniform for simple and destructured parameters alike.

#### 3.5a `isOptional` has **two** JSDoc sources, and the second is 29% of them — RULED 2026-09-13

*(Raised by `js-impl` as a question about defaults; the measurement found a larger defect
next to it.)*

JSDoc marks an optional parameter two ways, and the compiler models them as different nodes:

| form | compiler | measured |
|---|---|---|
| `@param {T} [x]` | `JSDocParameterTag.isBracketed === true` | **647 parameters** |
| `@param {T=} x` | `typeExpression.type.kind === JSDocOptionalType` | **263 parameters** |
| both at once | | 1 |

Measured over the tree named at the end of this section: 36,052 parameters, of which 910 carry
a JSDoc optional marker. **An `isBracketed`-only rule reports 647 of 910 — it misses 28.9%.**

The two are not dialects to choose between. The checker treats them identically: on
`function f(a, b, c, d)` documented `@param {string} a @param {string=} b @param {string} [c]
@param {string} d`, `isOptionalDeclaration` answers **`false, true, true, false`** and
`getTypeAtLocation` gives `string | undefined` for `b` and `c` alike. So a fact base that
records one and not the other is not being conservative; it is contradicting itself, because
the modifier *is* already emitted — `typeNameAsWritten` strips it precisely so it can be a
`js_type_reference` row. `isOptional = false` on a parameter whose type-reference subtree says
`JSDocOptionalType` is the **populated-and-wrong** shape of §7.2.1, not a gap.

**Do not use `ts.isOptionalDeclaration` to fix it.** It is not in the public `.d.ts` — it is an
internal predicate reached through a cast — and on the pinned compiler it **throws** on ordinary
input: given `function f(a, b, c, e, g = 7, ...r)` with JSDoc naming only some of them, it dies
in `canHaveJSDoc` with `Cannot read properties of undefined`. An internal API that is wrong
about its own domain is worse than no API, because the crash arrives in a sweep and not in a
test. The two public tests above are three lines and cannot throw.

**`isRest` was checked for the same defect and does not have it.** `@param {...T}` parses to a
`JSDocVariadicType`, and a parameter carrying one *without* syntactic `...` occurs **0 times**
in the tree below. `isRest` therefore stays the syntax's alone. Per §7.3c that zero is a
statement about a corpus, not about the language, and it is a **`MERELY_UNOBSERVED`** zero: a
JSDoc-only variadic is writable, so if the count ever moves the rule needs revisiting.

#### 3.5b A documented default does not populate c7/c8 — RULED 2026-09-13, and nothing is appended

`js-impl` asked whether `@param {T} [x=fallback]` with no code default should fill `hasDefault`
and `defaultValueText`. **No, and no column is added for it either.** Three reasons, in the
order they decide it:

1. **It would make two columns of one row contradict each other.** `bindingForm` (c10) reads
   `ASSIGNMENT_PATTERN` exactly when the parameter has a code initializer. A comment-fed
   `hasDefault = true` sits next to `bindingForm = IDENTIFIER` with nothing saying which is
   authoritative — and a consumer reading c7 concludes the parameter is never `undefined`,
   which at runtime is false. c7/c8 are facts about what executes; a comment cannot change what
   executes.
2. **The comment is measurably wrong when it can be checked.** Of 39 parameters carrying *both*
   a documented and a code default, **3 disagree** (7.7%) — and two of the three disagree only
   by quoting (`div` against `'div'`, `label` against `'label'`), so the documented text is not
   even a valid expression. Merging a channel that is 7.7% wrong into one that is 0% wrong
   destroys the reliable one.
3. **The remaining population has no consumer.** 150 parameters carry a documented default with
   no code default. The *type* is already in c3, the *optionality* in c6. A documented default
   changes no binding, no call resolution and no type. It is documentation about a value, and
   §0.2's rule is that the parser emits what the program is, not what its comments say about it
   — the one exception, `declaredTypeName`, exists because JSDoc is the **only** type channel,
   and c7/c8 have a channel already.

**This is a NAMED ABSENCE, not an oversight** (§7.3c-0): the documented default is extractable
— re-scanning the bracketed tail with the compiler's own scanner recovers it with **0
extraction failures in 36,052 parameters**, including `[s="]"]` and `[a=[1,2]]` — and it is
deliberately not emitted. Recorded so the question is not re-opened as a gap.

One consequence worth stating, because it is the reason c6 could not simply be dropped: the
compiler reports `isBracketed === true` for **both** `[x]` and `[x=1]`. Optionality and
documented-default-ness are not distinguishable from that flag, which is why c6 is a fact and
c7/c8 are not.

**The tree these numbers come from.** 7,825 files under the local materialised corpus root,
36,052 parameters, `typescript@6.0.3`, syntax only — no `Program`. It is **not** the 58,017-
parameter tree of §2.6, and not the 2,738-file documented population of §0.3b; per that
section's `reproduces` block, no tree here is currently reproducible from the manifest. The
*ratios* above (647:263, 39:3, 150) are what the ruling rests on and are stable to the
denominator; the absolute counts are not transferable and are labelled so rather than quoted
bare.

---

---

### 3.6 `js_field` / `lib_js_field` — 23 columns

A class field, a prototype property, or a member installed by `Object.defineProperty`.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | |
| 1 | `qualifiedName` | 2 | |
| 2 | `ownerTypeLinkHash` | 1 | FK→`js_type` |
| 3 | `declarationForm` ★ | 1 | `CLASS_FIELD` (614) \| `PROTOTYPE_ASSIGNMENT` (233) \| `STATIC_ASSIGNMENT` \| `OBJECT_DEFINE_PROPERTY` (76) \| `CONSTRUCTOR_THIS_ASSIGNMENT` |
| 4 | `isStatic` | 1 | |
| 5 | `isPrivateName` | 1 | `#x` — a real access boundary, unlike `_x` |
| 6 | `isReadonly` | 2 | `writable: false` via `defineProperty` |
| 7 | `declaredTypeName` | 2 | JSDoc `@type` (18,674) |
| 8 | `declaredTypeSource` ★ | 1 | |
| 9 | `typeReferenceLinkHash` | 2 | FK→`js_type_reference` |
| 10 | `hasInitializer` | 1 | |
| 11 | `initializerExpressionLinkHash` | 2 | FK→`js_expression` |
| 12 | `accessorPairKind` ★ | 1 | `NONE` \| `GETTER_ONLY` \| `SETTER_ONLY` \| `GETTER_SETTER`. 1,225 getters / 137 setters: a *read* of this name invokes a method, which is why the invocation is reserved (§2.4) |
| 13 | `getterMethodLinkHash` | 2 | FK→`js_method` |
| 14 | `setterMethodLinkHash` | 2 | FK→`js_method` |
| 15 | `isComputedName` | 1 | 715 computed member names |
| 16 | `sourceExpressionLinkHash` ★ | 2 | FK→`js_expression` for assignment-declared fields |
| 17 | `startLine` | 1 | |
| 18 | `startColumn` | 1 | |
| 19 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 20 | `isExternal` | 1 | parity slot |
| 21 | `serviceVersionLinkHash` | 1 | |
| 22 | `jsFieldUniqueHash` | — | **PK** |

**PK** `JS_FIELD_md5(ownerTypeLinkHash ‖ name ‖ startLine ‖ startColumn ‖ declarationForm)`

`declarationForm` is in the key because `this.x = 1` in a constructor and
`Foo.prototype.x = 1` at module level are two declarations of one member, at different lines,
and both are real.

---

### 3.7 `js_variable` / `lib_js_variable` — 25 columns

Every binding that is not a parameter or a member: `var`/`let`/`const`, destructured names,
catch parameters, and implicit globals.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `name` | 1 | |
| 1 | `qualifiedName` | 2 | |
| 2 | `bindingRegime` ★ | 1 | `VAR_FUNCTION_SCOPED_HOISTED` (3,705) \| `LET_BLOCK_TDZ` (5,637) \| `CONST_BLOCK_TDZ` (35,716) \| `FUNCTION_DECLARATION_HOISTED` \| `CLASS_TDZ` \| `CATCH_PARAMETER` \| `IMPORT_BINDING` \| `GLOBAL_IMPLICIT` (§2.5) |
| 3 | `declarationScopeLinkHash` ★ | 1 | FK→`js_scope` — where the name is **visible from** (function scope for `var`, block for `let`) |
| 4 | `syntacticScopeLinkHash` ★ | 1 | FK→`js_scope` — the block the declaration is **written in**. Differs from c3 for every `var` in a block; that difference *is* hoisting, and an engine cannot re-derive it |
| 5 | `hasTemporalDeadZone` | 1 | true for `let`/`const`/`class` |
| 6 | `bindingForm` | 1 | `IDENTIFIER` \| `OBJECT_PATTERN` \| `ARRAY_PATTERN` |
| 7 | `patternRootVariableLinkHash` | 2 | FK→`js_variable`; for names bound by one destructuring, the root binds them together |
| 8 | `declaredTypeName` | 2 | JSDoc `@type` |
| 9 | `declaredTypeSource` ★ | 1 | |
| 10 | `typeReferenceLinkHash` | 2 | FK→`js_type_reference` |
| 11 | `hasInitializer` | 1 | |
| 12 | `initializerExpressionLinkHash` | 2 | FK→`js_expression` |
| 13 | `initializerKind` ★ | 1 | `NONE` \| `REQUIRE_CALL` \| `IMPORT_BINDING` \| `FUNCTION` \| `CLASS` \| `OBJECT_LITERAL` \| `OTHER`. `REQUIRE_CALL` is how a local name becomes a module alias, and it is the hop the engine walks for 83.6% of module edges |
| 14 | `importLinkHash` ★ | 2 | FK→`js_import` when c13 is `REQUIRE_CALL`/`IMPORT_BINDING` |
| 15 | `isReassigned` | 2 | |
| 16 | `ownerMethodLinkHash` | 2 | FK→`js_method`; `""` at module level |
| 17 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 18 | `startLine` | 1 | |
| 19 | `startColumn` | 1 | **in the PK** |
| 20 | `endLine` | 1 | |
| 21 | `isExported` | 2 | |
| 22 | `isExternal` | 1 | parity slot |
| 23 | `serviceVersionLinkHash` | 1 | |
| 24 | `jsVariableUniqueHash` | — | **PK** |

**PK** `JS_VARIABLE_md5(ownerModuleLinkHash ‖ declarationScopeLinkHash ‖ name ‖ startLine ‖ startColumn)`

#### 3.7.1 `endLine` was the name's line, and therefore always `startLine`

*(Ruled 2026-09-12, from `js-corpus`: `endLine == startLine` on **all 140,302 rows**, with an
empty description, while every other relation's `endLine` spans.)*

**Diagnosed, not guessed.** The binder records a binding's `declarationNode` as **`node.name`** —
the identifier — and the row's position is taken from it. An identifier is always on one line, so
the column is `startLine` **by construction** on every row that has ever been emitted. It is the
first horn of `js-corpus`'s dilemma: *the column means something it is not documenting.*

**Ruled: it is the DECLARATOR's extent, and the emitter changes to match.** `const x = 1` still
ends on its own line; `const x = {` … `}` now ends where the object literal does. That is real
IR — it bounds where the value is **constructed**, which is the one thing an engine cannot
re-derive from `startLine` and a name.

**Why redefining rather than removing, and the reason is structural rather than a preference.**
Column order is frozen, so **removal is not available**: dropping c20 would shift `isExported`,
`isExternal`, `serviceVersionLinkHash` and the primary key each down one, and every consumer
reading c24 as the variable hash would silently read something else. The real choice was
*redefine or leave dead*, and redefinition costs nothing precisely **because** the column is
constant today — no consumer can be depending on a value that has never varied.

**One limit, recorded because the fix does not fully close it.** `js_variable` carries
`startLine`, `startColumn` and `endLine` but **no `endColumn`** (unlike `js_expression`, which has
both and puts them in its key). So a declarator's *end* is locatable to a line and not to a
column. Adding `endColumn` would be an append after the PK — a third such column on a second
relation — and it is not worth it for a position nothing keys on. Stated so the asymmetry with
`js_expression` reads as a decision.

**Columns 3 and 4 are the whole hoisting model, and they are why this relation is not
`ts_variable` renamed.** For `let`, they are equal. For the 3,705 `var` bindings they differ
whenever the declaration sits inside a block, and the difference is not recoverable from
anything else in the fact base: the engine would have to re-implement JavaScript's scoping
rules to derive c3 from c4. Emitting one column and calling it "scope" is the §3 defect class —
the parts are present, the structure is absent.

---

### 3.8 `js_import` / `lib_js_import` — 23 columns ★

One module edge **in**. 83.6% of these rows are minted from expressions (§2.1).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `specifier` | 1 | `'./router'`, `'events'` — **as written** |
| 1 | `specifierKind` ★ | 1 | `STRING_LITERAL` \| `NON_LITERAL` (17 measured) \| `TEMPLATE`. A `NON_LITERAL` specifier is unresolvable **by construction**; the row says so rather than guessing |
| 2 | `edgeBearer` ★ | 1 | `DECLARATION` (`import …`) \| `EXPRESSION` (`require(…)`, `import(…)`) \| **`COMMENT`** (a JSDoc `import("./x").Y`, §3.8.1). **83.6% EXPRESSION — over RUNTIME edges only**, see §3.8.1 |
| 3 | `importForm` | 1 | `REQUIRE_CALL` \| `IMPORT_DECLARATION` \| `DYNAMIC_IMPORT` \| `CREATE_REQUIRE` \| `IMPORT_EQUALS` \| **`JSDOC_IMPORT_TYPE`** (§3.8.1) |
| 4 | `isTopLevel` ★ | 1 | **false for 13.6%** of `require()` calls (1,227: 1,048 in a function body, 179 in a block) |
| 5 | `isConditional` | 1 | inside an `if`/`try` — a module edge that may never execute |
| 6 | `bindingForm` | 1 | `NAMESPACE` \| `NAMED` \| `DEFAULT` \| `DESTRUCTURED` \| `SIDE_EFFECT_ONLY` \| **`NO_LOCAL_BINDING`** (§3.8.1) |
| 7 | `importedName` | 1 | the name in the exporting module; `""` for namespace/side-effect |
| 8 | `localName` | 1 | the name bound locally |
| 9 | `resolvedFilePath` ★ | 2 | **the hop the engine needs.** Resolved by `ts.resolveModuleName`, which needs no Program; `""` when unresolvable |
| 10 | `resolutionOutcome` ★ | 1 | `RESOLVED_PROJECT` \| `RESOLVED_EXTERNAL` \| `RESOLVED_BUILTIN` \| `UNRESOLVED_MISSING` \| `UNRESOLVED_NON_LITERAL`. **Environmental unresolution is 3.2%** — named, not hidden, and not counted as a parser gap |
| 11 | `resolvedModuleLinkHash` | 3 | FK→`js_module`. **Declared, never staged.** `resolvedFilePath` (c9) is a *path string the parser computed*; turning it into a link is cross-file following, which is the engine's (§0.2) |
| 12 | `isTypeOnly` | 1 | **NOT a parity slot** *(corrected 2026-09-12)*. `true` for a row minted from a JSDoc `import("./x").Y` — JavaScript's `import type`, written in a comment (§3.14.4) |
| 13 | `sourceExpressionLinkHash` ★ | 1 | FK→`js_expression`; `""` for declaration-borne. Makes the second pass auditable (§2.1) |
| 14 | `boundVariableLinkHash` | 2 | FK→`js_variable` |
| 15 | `ownerScopeLinkHash` | 1 | FK→`js_scope` — a nested `require` binds in a function scope, not the module's |
| 16 | `ownerMethodLinkHash` | 2 | FK→`js_method` for the 13.6% |
| 17 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 18 | `startLine` | 1 | |
| 19 | `startColumn` | 1 | |
| 20 | `isExternal` | 1 | parity slot |
| 21 | `serviceVersionLinkHash` | 1 | |
| 22 | `jsImportUniqueHash` | — | **PK** |

**PK** `JS_IMPORT_md5(ownerModuleLinkHash ‖ specifier ‖ localName ‖ startLine ‖ startColumn)`

`startColumn` is in the key because `const {a, b} = require('x')` produces two rows on one line
with one specifier, and without it they collide **by doubling, not by erroring**.

#### 3.8.1 The row a JSDoc `import("./x").Y` mints

*(Ruled 2026-09-12, on `js-impl`'s proposal. 3,718 occurrences carrying an empty
`importLinkHash` until now.)* §3.14.4 ruled that an import type mints a `js_import` row and said
nothing about three columns whose vocabularies had no honest value. `js-impl` held rather than
forcing one, citing §3.10.1. Ruled:

| column | value | |
|---|---|---|
| `importForm` | **`JSDOC_IMPORT_TYPE`** | accepted. An `ImportTypeNode` is none of the five — `DYNAMIC_IMPORT` is a *call expression*, and this is a type node |
| `edgeBearer` | **`COMMENT`** | accepted, **with the consequence below** |
| `bindingForm` | **`NO_LOCAL_BINDING`** | **corrected.** `js-impl` proposed `NAMED`/`NAMESPACE` and flagged it as a guess; the flag was right |
| `importedName` | the **qualifier** (`Y`), or `""` for a bare `import("./x")` | |
| `localName` | `""` | |
| `sourceExpressionLinkHash` | `""` | there is no expression |
| cardinality | **one row per occurrence** | accepted — the PK carries `startLine`/`startColumn` and each type reference links its own |

**Why `NO_LOCAL_BINDING` rather than `NAMED`.** `bindingForm` describes *how an import binds a
local name*, and **an import type binds nothing at all**. `NAMED` with `localName = ""` asserts a
binding that does not exist. `SIDE_EFFECT_ONLY` is the nearest existing value and is wrong for a
different reason — it asserts a **runtime effect**, and a type-only reference has none. So the
honest value is the one that says *no local binding*, and it is a new one. This is §3.10.1
applied a second time: a forced value reads as data.

> ##### The consequence `js-impl` surfaced, and it is not free
>
> `edgeBearer` is documented in §0.0 and §2.1 as a **partition** — *2,300 files wholly
> expression-borne, 431 wholly declaration-borne, 0 mixed* — and **a third value changes what that
> statistic means.** It is restated rather than quietly widened:
>
> **The 83.6% expression-borne share, the per-file bimodality and the 0-mixed count are over
> RUNTIME module edges — `DECLARATION` and `EXPRESSION` — and exclude `COMMENT`.** A
> comment-borne edge is type-only, carries no runtime behaviour, and belongs to a different
> population; counting it would mix a type graph into a measurement of the module graph. The
> finding that made JavaScript its own front end is unaffected, because it was always about
> where *runtime* module edges live.
>
> **And §7.3's module-edge gate is scoped to match.** Rule 1 asserts every `isModuleEdge`
> expression has ≥1 edge row and every edge row's source is flagged — which a `COMMENT` row
> cannot satisfy, having no expression. The gate therefore reads:
> **`DECLARATION`/`EXPRESSION` rows pair with an expression; `COMMENT` rows must instead be
> pointed at by at least one `js_type_reference.importLinkHash`.** That reverse link already
> exists (§3.14 c13) and is the auditable pairing for a comment-borne edge — the same
> "make the second pass checkable rather than asserted" discipline, through the other end.

---

### 3.9 `js_export` / `lib_js_export` — 22 columns ★

One module edge **out**. `module.exports = X` (2,102), `module.exports.x =` (380),
`exports.x =` (118), `Object.defineProperty(exports, …)`, plus ESM `export` declarations.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `exportedName` | 1 | `default` for `module.exports = X` |
| 1 | `localName` | 1 | the name being exported |
| 2 | `edgeBearer` ★ | 1 | `DECLARATION` \| `EXPRESSION` |
| 3 | `exportForm` ★ | 1 | `MODULE_EXPORTS_ASSIGNMENT` (2,102) \| `MODULE_EXPORTS_MEMBER` (380) \| `EXPORTS_MEMBER` (118) \| `OBJECT_DEFINE_PROPERTY` \| `EXPORT_DECLARATION` \| `EXPORT_DEFAULT` \| `EXPORT_ALL` |
| 4 | `exportedValueKind` ★ | 1 | `FUNCTION` (24) \| `CLASS` \| `OBJECT_LITERAL` (335) \| `REQUIRE_REEXPORT` (81) \| `IDENTIFIER` \| `OTHER`. What is on the right-hand side decides what an importer actually gets |
| 5 | `isReExport` | 1 | `module.exports = require('./y')` — **81 measured**; a module edge that is simultaneously an import and an export |
| 6 | `reExportSpecifier` | 1 | |
| 7 | `reExportImportLinkHash` | 2 | FK→`js_import` |
| 8 | `isTopLevel` | 1 | |
| 9 | `isConditional` | 1 | |
| 10 | `targetKind` | 1 | `METHOD` \| `TYPE` \| `VARIABLE` \| `FIELD` \| `EXPRESSION_VALUE` |
| 11 | `targetLinkHash` | 2 | FK→ the relation named by c10 |
| 12 | `sourceExpressionLinkHash` ★ | 1 | FK→`js_expression`; `""` for declaration-borne |
| 13 | `overwritesPreviousExport` ★ | 1 | `module.exports = {}` after `exports.x =` **discards** the earlier edge. Without this column the fact base asserts exports that do not exist at runtime |
| 14 | `ownerScopeLinkHash` | 1 | FK→`js_scope` |
| 15 | `ownerMethodLinkHash` | 2 | FK→`js_method` |
| 16 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 17 | `startLine` | 1 | |
| 18 | `startColumn` | 1 | |
| 19 | `isExternal` | 1 | parity slot |
| 20 | `serviceVersionLinkHash` | 1 | |
| 21 | `jsExportUniqueHash` | — | **PK** |

**PK** `JS_EXPORT_md5(ownerModuleLinkHash ‖ exportedName ‖ exportForm ‖ startLine ‖ startColumn)`

`overwritesPreviousExport` is the column I most expect to be argued with, so the reasoning is
explicit: `exports.a = 1; module.exports = {b};` exports **only `b`**. A fact base that records
both edges and no ordering tells the engine this module exports `a`, which is false. The
alternative — suppressing the earlier row — loses the fact that the assignment executed. The
flag keeps both and lets the engine decide.

---

### 3.10 `js_expression` / `lib_js_expression` — 35 columns ★spine

The spine. Every expression reached by an **allowlist of expression positions**, never a
generic tree walk — a generic walk puts JSDoc type names into the expression relation and
type-only constructs then reach the call graph.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `expressionKind` | 1 | see the vocabulary note below |
| 1 | `text` | 1 | source text, truncated at 512 |
| 2 | `name` | 1 | identifier or property name; `""` when computed |
| 3 | `isComputedName` | 1 | `obj[expr]` — syntax does not fix the name |
| 4 | `operatorString` ★ | 1 | `+=`, `??=`, `||=`, `?.`. **The operator is a column, not a kind** — one `ASSIGNMENT` kind covers every compound form, per Java's precedent |
| 5 | `depth` | 1 | 0 at the root of an expression statement |
| 6 | `parentExpressionLinkHash` | 1 | **FK→`js_expression`** (self-referential). `""` ⟺ `depth = 0` |
| 7 | `edgeRole` ★ | 1 | `ASSIGNMENT_TARGET` \| `ASSIGNMENT_VALUE` \| `CALLEE` \| `ARGUMENT` \| `RECEIVER` \| `CONDITION` \| `ELEMENT` \| `PROPERTY_VALUE` \| `SPREAD_OPERAND` \| `TEMPLATE_SUBSTITUTION` |
| 8 | `childIndex` | 1 | ordered within the parent |
| 9 | `rootContext` | 1 | the statement form this tree hangs under |
| 10 | `isModuleEdge` ★ | 1 | this expression **is** an import or export edge; §2.1's second pass reads exactly these rows |
| 11 | `moduleEdgeLinkHash` ★ | 2 | FK→`js_import` or `js_export` |
| 12 | `isDeclarationBearing` ★ | 1 | this assignment **declares** a member (§2.2) |
| 13 | `declarationLinkHash` ★ | 2 | FK→`js_method`/`js_field`/`js_type` when c12 |
| 14 | `callSiteLinkHash` | 2 | FK→`js_call_site`; 1:1 with call-like kinds |
| 15 | `referencedName` | 1 | the name as written, for an identifier reference |
| 16 | `referenceKind` | 1 | `READ` \| `WRITE` \| `READ_WRITE` \| `DELETE` \| `TYPEOF` |
| 17 | `resolvedBindingLinkHash` | 2 | FK→`js_variable` — **same-file, one-hop only**, per §0 |
| 18 | `bindingResolution` ★ | 1 | `LOCAL` \| `CLOSURE` \| `MODULE` \| `IMPORTED` \| `GLOBAL_BUILTIN` \| **`CLASS_PRIVATE`** \| `UNRESOLVED_FREE`. Which *scope* the name came from, which is the binder's output and the engine's input. `CLASS_PRIVATE` per §3.10.1 |
| 19 | `isTypeOnlyReachable` | 1 | must be `false` for every row (§7.1) |
| 20 | `literalKind` | 1 | `STRING` \| `NUMBER` \| `TEMPLATE` \| `REGEX` \| `NULL` \| `UNDEFINED` \| `BIGINT` \| `NONE` |
| 21 | `isTruncated` | 1 | depth cap 32 reached (max observed 67) |
| 22 | `ownerScopeLinkHash` | 1 | FK→`js_scope` |
| 23 | `ownerMethodLinkHash` | 1 | FK→`js_method` — the synthetic `<module>` initializer at top level |
| 24 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 25 | `startLine` | 1 | |
| 26 | `startColumn` | 1 | |
| 27 | `endLine` | 1 | |
| 28 | `endColumn` | 1 | **in the PK** — identity is the byte range, never the start offset |
| 29 | `isExternal` | 1 | parity slot |
| 30 | `serviceVersionLinkHash` | 1 | |
| 31 | `jsExpressionUniqueHash` | — | **PK** |
| 32 | `introducesDeclarationLinkHash` ★ | 1 | FK→`js_method`. **The callable this expression IS.** Set on every `ARROW` and `FUNCTION_EXPRESSION` row, and on a `CLASS_EXPRESSION` **only when the class declares a constructor**; `""` otherwise. **Appended after the PK on purpose** — see below |
| 33 | `resolvedParameterLinkHash` ★ | 2 | FK→**`js_method_parameter`**. The sibling of c17 for the case c17 cannot express: a reference that resolves to a **parameter**. Same-file one-hop, binder output. `""` otherwise. **Appended after the PK**, like c32 |
| 34 | `bindingPath` ★ | 1 | **the path within a destructuring pattern, as written** — `a` for `{a, b}`, `b.c` for `{b: {c}}`, `0` for `[x]`, `1.name` for `[, {name}]`. `""` when the binding is not destructured. Purely syntactic; the column c33 needed to be useful |

**PK** `JS_EXPRESSION_md5(ownerModuleLinkHash ‖ expressionKind ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)`

#### 3.10.1 `#x in obj` — a class-private name resolves, but not in any scope

*(Ruled 2026-09-12. 17 rows.)* The ergonomic brand check `#brand in o` puts a
**`PrivateIdentifier`** in a reference position. Verified: `isPrivateIdentifier` is true and
**no lexical scope resolves it** — a private name is a slot on a class, not a binding in a scope
chain.

Every existing `bindingResolution` value is dishonest for it. `LOCAL`, `CLOSURE`, `MODULE` and
`GLOBAL_BUILTIN` all name a lexical scope it does not live in; `UNRESOLVED_FREE` says the binder
*failed*, and the binder did not fail — it resolved the name correctly, to a class-private slot.

**So: `CLASS_PRIVATE`, added.** It is one value and it is the honest one.

**The alternative was a documented absence, and it was genuinely open** — 17 rows is small
enough that "JavaScript private names are not modelled, here is why" would have been a
legitimate answer. It is rejected because the construct is **decidable from syntax**, which puts
it on the IR side of §0.2: `#brand in o` is how modern code tests instance identity without
`instanceof`, and an engine that cannot see the check cannot see the branch.

**What was not available was forcing an existing value because the column dislikes being empty.**
A wrong value here is `UNRESOLVED_FREE` claiming a binder failure that did not happen — §4's
defect class, and invisible to every count. **A documented absence is a decision; silence is a
defect; a forced value is worse than both**, because it is a decision that reads as data.

#### `resolvedParameterLinkHash` — a reference to a parameter had nowhere to point

*(Appended 2026-09-12. The largest engine-facing gap in JavaScript at the time it was found.)*

`resolvedBindingLinkHash` (c17) is **FK→`js_variable`**. A parameter is a `js_method_parameter`
row. So the binder resolves a parameter reference **correctly** — `bindingResolution = LOCAL`,
or `CLOSURE` one scope up — and then has nowhere to put the answer.

**Measured:** 137,960 of 158,759 resolved-but-unlinked references name a parameter of their own
method; 15,382 more are `CLOSURE`; **58,483 parameter rows are unreachable from any reference.**
The engine needs *argument → parameter → uses* and gets hops one and three.

**Verified structurally, and the emitter is stricter than this document was.** `emitVariables()`
skips **every** binding whose regime is `PARAMETER`:

> *"A parameter's NAME is a variable row, but its position and default belong to
> `js_method_parameter`, which `emitParameter` already minted. Emitting it here too would be the
> same construct on two paths."*

That reasoning is right — two paths to one construct is §2's doubling hazard — and it means the
gap is **uniform**: no parameter produces a `js_variable` row, simple or destructured. §3.5 of
this document claimed destructured parameters mint `js_variable` rows for the names they bind.
**They do not, and the document was wrong**; corrected there.

**Why a sibling column and not a widened c17.** Widening c17 to point at either relation makes
it a **polymorphic FK**, which defeats the FK-integrity gate: a checker cannot know which
relation to look in, so it either skips the column or accepts a hash that exists in *either* —
and "exists somewhere" is not integrity. It is also exactly the objection `js-impl` raised when
c32 was appended rather than widening c12/c13, and the same answer applies: **a separate column
is one column; a redefined column is a silent break.**

**No discriminator column is needed.** `bindingResolution` (c18) already distinguishes `LOCAL`
from `CLOSURE`, and which of c17/c33 is non-empty says which relation the target is in.

**It is IR, not resolution.** Same file, one hop, purely syntactic — the binder computed it
already and c17 simply could not hold it.

#### `bindingPath` — c33's residual, closed

*(Ruled 2026-09-12, raised independently by `js-fixtures` in the same window.)* c33 identifies
the **parameter**; for a destructured one it cannot say **which bound name**. `function f({a, b})`
gives `a` and `b` the same c33, so the engine learns *argument → parameter → uses* and not which
property of the argument each use reads.

**c34 carries the path within the pattern, as written:**

| pattern | reference | `bindingPath` |
|---|---|---|
| `function f({a, b})` | `a` | `a` |
| `function f({b: {c}})` | `c` | `b.c` |
| `function f([x])` | `x` | `0` |
| `function f([, {name}])` | `name` | `1.name` |
| `function f(x)` | `x` | `""` — not destructured |

**It is genuinely missing IR, not a convenience.** Without it the engine must **re-parse the
parameter's source text** to learn which property a bound name came from — and a fact base that
requires its consumer to re-parse the source is precisely what emitting IR exists to prevent.
Purely syntactic, same file, no hop at all: it is read off the binding pattern the parser is
already walking.

**Not solved by minting `js_variable` rows for pattern names.** That is the reversal c33's own
justification forbids: `emitVariables()` skips every `PARAMETER`-regime binding because a
parameter reached on two paths is the doubling hazard, and closing this gap by undoing that
would trade a missing hop for a **doubling bug** — a strictly worse trade, since a duplicate
does not collide loudly, it doubles silently.

The column also applies to destructured `js_variable` bindings (`const {a, b} = obj`), which
have the same shape and the same gap.

#### `introducesDeclarationLinkHash` — why it exists, and why it is c32 and not c14

*(Appended 2026-09-11, post-freeze, on the only terms a frozen schema allows: at the end.)*

**The gap it closes.** `emitter.on('x', () => { … })` produces a call site, an argument
expression, and a `js_method` row for the arrow — and **nothing joins the third to the second.**
An engine can see the registration and it can see the callback's body, and it cannot tell that
the body is what the registration installs. Every call inside that body is orphaned from the
edge that reaches it.

Measured on this corpus, independently of `js-impl`'s 24,258 / 39.5%:

| | callables | |
|---|---|---|
| total (`js_method` rows) | 25,573 | |
| **in argument position — the orphan case** | **7,923** | **31.0%** |
| …of those, anonymous | 7,779 | **98.2%** |
| already reachable via a variable, field or assignment | 5,299 | 20.7% |

Argument index 1 is the most common position (4,291), which is the callback-after-name shape
(`on(event, fn)`, `then(res, rej)`) exactly.

**Why not widen c12/c13.** `isDeclarationBearing` / `declarationLinkHash` have a documented
meaning — *"this assignment **declares a member**"* (§2.2, `Foo.prototype.bar = function(){}`).
An arrow passed as an argument declares no member. Widening them would leave every existing
consumer reading the old meaning against a column that now also carries something else, and
getting wrong answers **silently** — which is the §4 defect class, a correctly-positioned row
with the wrong meaning, invisible to every count-based check. A separate column is one column;
a redefined column is a silent break.

**Why it sits after the PK.** Column order is frozen and new columns **append only**. Inserting
at c14 would shift `jsExpressionUniqueHash` from c31 to c32 and **every consumer reading c31 as
the expression hash would silently read something else**, misbinding every FK in the fact base.
Appending leaves 0–31 untouched.

The consequence to know about, and it is the same one `ts_module.strictBindCallApply` carries:
**`js_expression` is the one relation whose PK is not its last column.** Any check that finds a
primary key *positionally* is wrong here and must find it by name.

That was not hypothetical. `js-impl` found **seven** checks locating the primary key as the
last column. On `js_expression` the last column is now a **foreign key**, so those checks would
have asserted uniqueness of `introducesDeclarationLinkHash` — a column that is `""` on most
rows and deliberately repeats on the rest — and **reported the fact base sound**. The failure
mode is worse than a wrong answer: a `-1` from a silent lookup indexes `undefined`, and
`undefined === undefined`, so every row compares equal to every other and the check passes
while measuring nothing. All seven now resolve the key **by name and throw when there is
none**, and transposing c31/c32 on purpose produces five named errors across two gates.

**It is IR, not resolution.** Same file, one hop, purely syntactic: the parser already minted
the `js_method` row while walking this very node, so filling the column is a lookup it already
has, not a search. It crosses no module boundary and §0.2's rule is untouched — the gate
asserting no cross-file link is staged covers this column too.

**A class expression with no constructor links nothing.** *(Ruled 2026-09-11 after `js-impl`
measured 25,775 of 25,798 callables linked and asked about the remainder.)* The column is
declared `FK→js_method`; a constructor-less class has no `js_method` row, and pointing the
column at the `js_type` instead would make one column mean two relations depending on a value
in another. `""` is the correct and only answer, and the FK-integrity gate reads it as
"absent" rather than "dangling". Measured: **23 of 25,798**, all of them constructor-less class
expressions.

**A class field holding an arrow emits BOTH rows.** `#handleClick = () => { … }` is the
auto-bound-method pattern, and it is simultaneously a **data location** (one function object
per instance, not one shared on the prototype) and a **callable member**. It therefore mints a
`js_field` row *and* a `js_method` row with `methodKind = CLASS_METHOD`, `thisBinding =
LEXICAL`, and `ownerTypeLinkHash` pointing at the class. Emitting only the field loses the call
target and orphans every expression in the body — measured, they were being attributed to the
`<module>` initializer. Emitting only the method loses the data location. **No new
`declarationForm` value is warranted**: `thisBinding = LEXICAL` already carries the difference
from a prototype method, which is the whole reason the pattern is written, and the co-existing
`js_field` row carries the rest. A value duplicating information the row already has is
schema bloat.

**Wrapper nodes are mandatory.** `x += 1` emits **one** `ASSIGNMENT` row with the target and
value parented to it under `ASSIGNMENT_TARGET`/`ASSIGNMENT_VALUE`, and `+=` in `operatorString`.
Flat emission fails on `a += 1; b += 2` — the engine-side workaround pairs on
`(scope, line, rootContext)` and yields four pairs, two of them inventing value flow that does
not exist. That is worse than dropping the rows.

**Trees rooted at a non-emitting node must be unwrapped at the root**, once: parentheses and
JSX braces produce no row, and in TypeScript each cost thousands of call sites when a subtree
died before its children were enqueued.

**The worklist stops at function boundaries and must descend explicitly.** An arrow's body
belongs to the arrow's own method row.

---

### 3.11 `js_call_site` / `lib_js_call_site` — 25 columns ★spine

Exactly one row per call-like `js_expression` row. **`require()` is not here** — it is a module
edge (§2.4).

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `callKind` | 1 | the §2.4 vocabulary |
| 1 | `calleeText` | 1 | as written |
| 2 | `calleeName` | 1 | `""` when computed (663 sites) |
| 3 | `receiverText` | 1 | |
| 4 | `receiverPosition` ★ | 1 | `SYNTACTIC` \| `FIRST_ARGUMENT` (`.call`/`.apply`, 859 sites) \| `NONE`. Without this the engine reads `Function.prototype.call` as the target |
| 5 | `receiverExpressionLinkHash` | 1 | FK→`js_expression` — points at the **real** receiver, wherever it sits |
| 6 | `argumentCount` | 1 | |
| 7 | `hasSpreadArgument` | 1 | 1,301 spreads; the count is not the arity |
| 8 | `isOptionalCall` | 1 | 28 sites |
| 9 | `declaredReceiverTypeName` | 2 | JSDoc-declared receiver type; `""` — this is the 52.6% ceiling made explicit |
| 10 | `receiverTypeSource` ★ | 1 | `NONE` \| `JSDOC` \| `IMPORT_ALIAS` \| `LOCAL_CLASS` \| `NODE_BUILTIN`. **How much the engine has to work with**, stated per call site rather than inferred later |
| 11 | `importLinkHash` ★ | 2 | FK→`js_import` when the receiver is an imported name — one of the three things that make a row complete |
| 12 | `resolvedMethodLinkHash` | 3 | FK→`js_method`. **Declared, never staged.** Same-file one-hop only if ever |
| 13 | `resolutionOutcome` ★ | 1 | `SAME_FILE_RESOLVED` \| `IMPORT_HOP_AVAILABLE` \| `AMBIENT_BUILTIN_TARGET` \| `RECEIVER_UNTYPED` \| `COMPUTED_NAME` \| `DYNAMIC_CODE`. Mirrors the oracle's partition so a gate can compare like with like. `AMBIENT_BUILTIN_TARGET` is the §0.0a class — the receiver came from a Node builtin, so the target is in the `lib_*` population and **not** in this project. It is the JavaScript spelling of `ts_call_site.resolvedTargetKind = LIB_SIGNATURE`, which TypeScript measured at 42.3% |
| 14 | `isDynamicCode` | 1 | `eval`, `new Function` — 2 sites, target unknowable |
| 15 | `enclosingMethodLinkHash` | 1 | FK→`js_method` |
| 16 | `expressionLinkHash` | 1 | FK→`js_expression` — the 1:1 |
| 17 | `ownerScopeLinkHash` | 1 | FK→`js_scope` |
| 18 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 19 | `startLine` | 1 | |
| 20 | `startColumn` | 1 | |
| 21 | `isTypeOnlyTarget` | 1 | must be `false` for every row (§7.1) |
| 22 | `isExternal` | 1 | parity slot |
| 23 | `serviceVersionLinkHash` | 1 | |
| 24 | `jsCallSiteUniqueHash` | — | **PK** |

**PK** `JS_CALL_SITE_md5(expressionLinkHash)` — derived from the expression, which makes the
1:1 structural rather than asserted.

Columns 9–11 exist because of the 52.6% measurement. The parser will not name the target for
roughly half of all call sites, and pretending otherwise produces a confidently wrong fact
base. What it *can* always emit is the name as written, the receiver's declared type when JSDoc
supplies one, and the import hop — and those three are what let the engine finish the job.

---

### 3.12 `js_block` / `lib_js_block` — 17 columns

A lexical block. Distinct from `js_scope`: a block is **syntax**, a scope is **binding**. One
block may open no scope (a bare `{}` containing only `var`), and one scope may span several
blocks.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `blockKind` | 1 | `FUNCTION_BODY` \| `BLOCK` \| `IF` \| `ELSE` \| `FOR` \| `FOR_IN` \| `FOR_OF` \| `WHILE` \| `DO` \| `TRY` \| `CATCH` \| `FINALLY` \| `SWITCH` \| `SWITCH_CASE` \| `LABELED` \| `CLASS_BODY` \| `CLASS_STATIC_BLOCK` \| `MODULE_BODY` |
| 1 | `label` | 1 | `outer:` — TypeScript emitted the loop and **dropped the label**; this column is why that cannot happen here |
| 2 | `parentBlockLinkHash` | 1 | **FK→`js_block`** (self-referential) |
| 3 | `depth` | 1 | |
| 4 | `childIndex` | 1 | |
| 5 | `scopeLinkHash` | 1 | FK→`js_scope`; `""` when the block opens no scope |
| 6 | `opensScope` | 1 | |
| 7 | `conditionExpressionLinkHash` | 2 | FK→`js_expression` |
| 8 | `ownerMethodLinkHash` | 1 | FK→`js_method` |
| 9 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 10 | `startLine` | 1 | |
| 11 | `startColumn` | 1 | |
| 12 | `endLine` | 1 | |
| 13 | `endColumn` | 1 | |
| 14 | `isExternal` | 1 | parity slot |
| 15 | `serviceVersionLinkHash` | 1 | |
| 16 | `jsBlockUniqueHash` | — | **PK** |

**PK** `JS_BLOCK_md5(ownerModuleLinkHash ‖ blockKind ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)`

Every block form gets a row, including the ones that produce no other output. TypeScript's
enum audit found `NAMESPACE_BODY` and `MODULE_BODY` emitting **no block row at all**, on
separate early-return paths, and nothing else caught it because no row was misplaced — there
simply were none.

---

### 3.13 `js_scope` / `lib_js_scope` — 17 columns ★

The binder's output. **This relation is the reason JavaScript is a Python port and not a
TypeScript one**, and it has no `ts_*` analogue at all.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `scopeKind` | 1 | `MODULE` \| `FUNCTION` \| `ARROW` \| `BLOCK` \| `CATCH` \| `CLASS` \| `CLASS_STATIC_BLOCK` \| `WITH` \| `GLOBAL` |
| 1 | `parentScopeLinkHash` | 1 | **FK→`js_scope`** (self-referential). `""` only for `GLOBAL` |
| 2 | `depth` | 1 | |
| 3 | `isFunctionScope` ★ | 1 | true for `FUNCTION`/`ARROW`/`MODULE`. **`var` hoists to the nearest of these**; `let` stops at the nearest block |
| 4 | `bindsThis` ★ | 1 | false for `ARROW` — an arrow does not bind `this`, which is what makes lexical `this` work |
| 5 | `bindsArguments` | 1 | false for `ARROW` |
| 6 | `isStrictMode` ★ | 1 | ESM is always strict; CommonJS is sloppy unless `'use strict'`. **Decides whether an assignment to an undeclared name creates a global or throws** |
| 7 | `strictModeSource` | 1 | `ESM_IMPLICIT` \| `USE_STRICT_DIRECTIVE` \| `CLASS_BODY_IMPLICIT` \| `SLOPPY` |
| 8 | `declaredBindingCount` | 1 | |
| 9 | `hasWithStatement` ★ | 1 | `with` makes every name in its body **statically unresolvable**. Rare, and the honest answer is to mark the scope rather than emit confident bindings |
| 10 | `ownerMethodLinkHash` | 2 | FK→`js_method` |
| 11 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 12 | `startLine` | 1 | |
| 13 | `startColumn` | 1 | |
| 14 | `isExternal` | 1 | parity slot |
| 15 | `serviceVersionLinkHash` | 1 | |
| 16 | `jsScopeUniqueHash` | — | **PK** |

**PK** `JS_SCOPE_md5(ownerModuleLinkHash ‖ scopeKind ‖ startLine ‖ startColumn)`

#### `GLOBAL` is one row per module — confirmed, not reserved

*(Ruling, 2026-09-11.)* Every module emits **one `GLOBAL` row**, `parentScopeLinkHash = ""`,
with that module's `MODULE` scope as its only child. Cost: one row per file.

The alternative — `MODULE` as the root and `GLOBAL` reserved with a zero-row assertion — was
considered and rejected, because **two columns would have nothing real to point at**:
`js_variable.bindingRegime = GLOBAL_IMPLICIT` needs a `declarationScopeLinkHash`, and a
sloppy-mode `x = 1` creates a binding **visible to other files**. Parenting it at the module
scope would assert it is module-local, which is precisely the one thing it is not. A dangling
FK, or a deliberate lie, to save one row per file is a bad trade.

It is per-module rather than one shared row because every scope row carries
`ownerModuleLinkHash` and the parser is hermetic per file — minting a single shared `GLOBAL`
is cross-file work. The row means *"the global scope as observed from this module"*, and
establishing that the N rows denote one runtime scope is the engine's join, on
`scopeKind = GLOBAL`. That is the same division of labour as everywhere else in this schema.

`isStrictMode` is not bookkeeping. In sloppy mode `x = 1` with no declaration creates a global;
in strict mode it throws. The same source line is a binding in one file and an error in
another, decided by a directive or by the module system — which is precisely why
`js_module.moduleSystem` is in the module's primary key.

---

### 3.14 `js_type_reference` / `lib_js_type_reference` — 23 columns

A node in a **JSDoc type expression**. `Array<Object<string, number>>` is three rows.
This is the JavaScript type system in its entirety, and it lives in comments.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `typeName` | 1 | `Array`, `string`, `*` |
| 1 | `referenceKind` | 1 | `NAMED` \| `UNION` \| `INTERSECTION` \| `ARRAY` \| `GENERIC_APPLICATION` \| `FUNCTION_TYPE` \| `OBJECT_TYPE` \| `TYPE_LITERAL` \| `NULLABLE` \| `NON_NULLABLE` \| `OPTIONAL` \| `REST` \| `ANY` \| **`IMPORT_TYPE`** \| **`TUPLE`** \| **`INDEXED_ACCESS`** \| **`TYPE_QUERY`** \| **`TYPE_PREDICATE`** \| `UNKNOWN_SYNTAX` — §3.14.4 |
| 2 | `parentReferenceLinkHash` | 1 | **FK→`js_type_reference`** (self-referential). `""` ⟺ `depth = 0` |
| 3 | `depth` | 1 | cap **32**, `isTruncated` beyond |
| 4 | `childIndex` | 1 | |
| 5 | `childCount` | 1 | |
| 6 | `isTruncated` | 1 | |
| 7 | `contextKind` ★ | 1 | `PARAM` \| `RETURN` \| `VARIABLE` \| `FIELD` \| `TYPEDEF` \| `TEMPLATE` \| `THIS` \| `EXTENDS` \| `IMPLEMENTS` \| **`CAST`** \| **`THROWS`** — which JSDoc tag this tree hangs off, and *in what position* (§3.14.1) |
| 8 | `tagName` | 1 | `param`, `type`, `returns`, `typedef`, `callback`, `template` |
| 9 | `ownerKind` | 1 | `METHOD` \| `METHOD_PARAMETER` \| `FIELD` \| `VARIABLE` \| `TYPE` \| **`EXPRESSION`** — §3.14.2 |
| 10 | `ownerLinkHash` | 1 | FK→ the relation named by c9 |
| 11 | `resolvedTypeLinkHash` | 3 | FK→`js_type`. Declared, **not staged** |
| 12 | `resolvedFilePath` | 2 | when the name was imported |
| 13 | `importLinkHash` | 2 | FK→`js_import` |
| 14 | `isTypeOnly` ★ | 1 | **always `true`.** Every row here is type-only, and no call-graph rule may traverse this relation (§7.1) |
| 15 | `isBuiltinType` | 1 | `string`, `number`, `Object`, `Array` |
| 16 | `commentLinkHash` | 1 | FK→`js_comment` — the comment this type was read out of |
| 17 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 18 | `startLine` | 1 | line **within the comment** |
| 19 | `startColumn` | 1 | |
| 20 | `isExternal` | 1 | parity slot |
| 21 | `serviceVersionLinkHash` | 1 | |
| 22 | `jsTypeReferenceUniqueHash` | — | **PK** |

**PK** `JS_TYPE_REFERENCE_md5(ownerLinkHash ‖ contextKind ‖ depth ‖ childIndex ‖ startLine ‖ startColumn)`

#### 3.14.3 `@type` on a parameter node is `PARAM`, not `CAST`

*(Ruled 2026-09-12. 7 rows.)* `function g(/** @type {string} */ p)` — verified,
`ts.getJSDocType(p)` returns `string` and the compiler reads it as **the parameter's type**.

So it is `PARAM`, which already exists. **The `CAST` ruling (§3.14.1) correctly does not cover
it and does not need to**: `CAST` names a type applied to an *expression*, and this is a type
applied to a *declaration* that happens to be spelled with `@type` instead of `@param`. The tag
is not what decides the context kind — the **position** is.

Note the asymmetry that makes this checkable: `getJSDocParameterTags(p)` returns **0** for this
shape while `getJSDocType(p)` returns the type. A reader keying on the tag name would
mis-classify it; keying on the host node does not.

#### 3.14.1 `CAST` — the position the vocabulary had no slot for

*(Appended 2026-09-12. Enum values, so no column and no freeze implication.)*

An **inline JSDoc cast** — `/** @type {BannerFunction} */ (data => …)` — types an *expression*,
not a declaration. Every existing `contextKind` names a declaration position, so there was
literally nothing the extractor could emit for one, and `js-impl`'s completed AST-recall found
**1,942 of 3,766 type-reference misses** were exactly this.

Measured over the pinned corpus (§0.3), by the node each `@type` block actually attaches to:

| host node | count | share | maps to |
|---|---|---|---|
| `ExpressionStatement` (`/** @type {T} */ this.x = …`) | 1,404 | 35.2% | **`FIELD`** — declaration-by-assignment (§2.2), *not* a new value |
| **`ParenthesizedExpression`** (`/** @type {T} */ (expr)`) | **1,170** | **29.3%** | **`CAST`** ← the gap |
| `VariableStatement` | 1,103 | 27.7% | **`VARIABLE`** — *not* a new value |
| `PropertyAssignment` / `PropertyDeclaration` | 278 | 7.0% | `FIELD` |
| `VariableDeclaration` | 6 | 0.2% | `VARIABLE` |
| `@throws` / `@exception` | 10 | — | **`THROWS`** ← the second gap |

**`CAST` is a real missing position: 29.3% of all `@type` tags, against 0.2% on a variable
*declaration*.** In JSDoc-typed code the cast is how a callback gets a type at all, which is why
it outnumbers the declaration form by two orders of magnitude.

#### 3.14.4 `import("./x").Y` is not unknown syntax — and it falsifies a parity slot

*(Ruled 2026-09-12. 3,718 rows, plus ~180 across four smaller shapes.)*

3,718 rows of a construct with a **known syntactic shape** sitting under `UNKNOWN_SYNTAX` is a
classification defect by this document's own standard: a correctly-positioned row with the wrong
kind, invisible to every count-based check (§4 of `BUILDING-A-PARSER.md`). Row volume is not the
argument — the argument is that the shape is decidable and we were declining to decide it.

**Verified structurally, not assumed.** `ts.createSourceFile` parses a JSDoc
`import("./router").Router` into an `ImportTypeNode` with **both parts recoverable**:

```
  @typedef  ImportType   import("./router").Router     specifier="./router"   qualifier=Router
  @type     ImportType   import("<pkg>").Application   specifier="<pkg>"      qualifier=Application
```

Five values added, each a node kind the compiler already distinguishes: **`IMPORT_TYPE`**,
**`TUPLE`**, **`INDEXED_ACCESS`**, **`TYPE_QUERY`** (`typeof X`), **`TYPE_PREDICATE`**
(`x is string`, which arrives as a child of a `FUNCTION_TYPE`). Enum values, so no column and no
reorder.

> ##### The consequence the steer did not ask for: `js_import.isTypeOnly` was wrong
>
> §3.8 c13 records `isTypeOnly` as a **"parity slot, always `false` — JavaScript has no
> `import type`."** **That is false.** `/** @type {import("./x").Y} */` *is* a type-only module
> reference, written in the source, with a resolvable specifier — JavaScript's spelling of
> `import type`, in a comment.
>
> **So an import-type specifier mints a `js_import` row with `isTypeOnly = true`**, and c13 stops
> being a parity slot. The wiring already exists: `js_type_reference.importLinkHash` (c13 of
> §3.14) is declared `FK→js_import` for exactly this.
>
> **Why mint the row rather than leave the specifier in the type tree.** §0.2 requires three
> things for a complete row, and one of them is `import.resolvedFilePath`. A
> `@typedef {import("./x").Y}` whose file the engine cannot locate is precisely the incomplete
> row §0.2 forbids — the name is present and the hop is not. Type-only-ness is carried by the
> flag, and §7.1's assertion is untouched because an import is not a call.

#### 3.14.2 `EXPRESSION` — 396 type references with nowhere to be owned

*(Appended 2026-09-12. Enum value, therefore free; `CAST` does not close it.)*

`ownerKind` named five **declaration** relations. Two constructs that carry a JSDoc type are not
declarations in this schema and so had no owner at all:

| construct | count | why it has no declaration row |
|---|---|---|
| object-literal property — `/** @type {T} */ 'escape': reEscape` | 268 | §3.2 rules object literals **values, not types**, so an object-literal member mints no `js_field` |
| `exports.X = …` assignment | 128 | it mints a `js_export`, which is a module edge, not a declaration of the thing's type |

**396 rows.** Both *are* `js_expression` rows, so `ownerKind = EXPRESSION` with `ownerLinkHash`
into `js_expression` is the answer, and it is one value rather than two: `ownerKind` names the
**relation**, and the construct distinction is already carried by that expression's own
`expressionKind`.

#### 3.14.3 A multi-declarator `@type` describes the FIRST declarator — tsc's rule, measured

*(Ruled 2026-09-12 by asking the compiler, not by taste.)* `js-fixtures` found that
`/** @type {T} */ let a = 1, b = 2` produces one `VARIABLE` row for two bindings, with no
specification of which binding it describes. tsc has a behaviour, so the schema follows it:

```
/** @type {string} */ let firstOfTwo = 1, secondOfTwo = 2;
  firstOfTwo    checker type = string    getJSDocType(decl) = string
  secondOfTwo   checker type = number    getJSDocType(decl) = undefined

/** @type {string} */ var a1 = 1, a2 = 2, a3 = 3;
  a1 = string ;  a2 = number ;  a3 = number
```

The assignability error fires on the **first** declarator's initialiser and nowhere else.

**The rule: the type reference belongs to the first declarator. Subsequent declarators in the
same statement are uninfluenced and carry `declaredTypeSource = NONE`.** One `js_type_reference`
row, owned by the first declarator's `js_variable`, is therefore correct — and it is correct
*because tsc says so*, not because one row is convenient.

#### The decomposition that stood here was FALSIFIED — and how

*(Retracted 2026-09-12. `js-impl` re-derived it on tip and it does not hold.)*

This section previously claimed that `ExpressionStatement` (35.2%) and `VariableStatement`
(27.7%) were **an extractor walking one node short**, and that ~63% of `@type` tags were
therefore recoverable with no schema change. **That was wrong.** `js-impl`'s re-derivation, with
a *missed* column this document never had:

| host | total | missed | verdict |
|---|---|---|---|
| `ParenthesizedExpression` | 1,429 | **1,429** | `CAST` — the append was right |
| `VariableStatement` | 1,083 | **0** | **already reaches** |
| `ExpressionStatement` | 719 | 128 | `this.x` reaches; the misses are `exports.X =` |
| `PropertyDeclaration` | 463 | **0** | **already reaches** |
| `PropertyAssignment` | 268 | **268** | object-literal property |
| `GetAccessor` | 70 | 70 | fixed |

`getJSDocTypeTag` already performs the walk-one-node-down, and the tree path uses the same call.
**There was no ~2,500.** The population recoverable without a schema change was **70**.

**Three candidate causes, and only the third is the error.**

1. **Double-counting?** No. Verified: 3,987 `(node, block)` pairs against 3,987 *distinct* block
   objects — **1.00×**, and not one block reachable from more than one node. The attachment rule
   was sound.
2. **Corpus?** Partly, and it explains the *counts*. This document measured the **pinned corpus**
   — eight external packages at peeled SHAs — and `js-impl` measured **PROJECT files at tip**.
   Different populations, so `PropertyDeclaration` 26 against 463 is expected. It does **not**
   explain the claim.
3. **The error, which no corpus would have fixed: I measured where `@type` tags *are* and
   asserted what the extractor *misses*.** Those are different questions. A position census is a
   **denominator**; "the extractor walks one node short" is a claim about a **numerator** I never
   measured. `js-impl` measured missed-against-total and the claim evaporated.

**And a second failure inside the first, at a tenth the scale.** This table read
*"`PropertyAssignment` / `PropertyDeclaration` 278 — maps to `FIELD`, already exists."* Those are
**two constructs with opposite outcomes** — `PropertyDeclaration` reaches, `PropertyAssignment`
does not — merged under the outcome of one. That is precisely the residual-bucket failure
recorded two sections earlier about a 2,531-row "elsewhere", committed again in a bucket a tenth
the size, in the same document, by the same author, days apart.

> **The discipline that catches this is not suspicion of a number. It is being unable to name
> what is inside it.** A residual that absorbs the common case reads as an explanation, and a
> merged bucket reads as agreement. Neither survives being asked to enumerate its members.

**What the append is worth, restated honestly.** `CAST` is real and is 1,429 of 1,429 missed.
The half added unasked was the half that was wrong, and it was caught by measuring rather than
implementing.

`UNKNOWN_SYNTAX` is deliberate.`UNKNOWN_SYNTAX` is deliberate. JSDoc type syntax is not standardised and Closure, TypeScript
and jsdoc.app all differ. A type expression the parser cannot decompose gets one row with its
text preserved, rather than a guess or a dropped tag.

---

### 3.15 `js_comment` / `lib_js_comment` — 16 columns

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `commentKind` | 1 | `LINE` \| `BLOCK` \| `JSDOC` \| `DIRECTIVE` \| `SHEBANG` |
| 1 | `text` | 1 | truncated at 2,048 |
| 2 | `isJsdoc` | 1 | |
| 3 | `jsdocTagNames` | 1 | comma-joined, ordered: `param,param,returns` |
| 4 | `jsdocTagCount` | 1 | |
| 5 | `declaresType` ★ | 1 | carries `@typedef`/`@callback` — this comment **is** a declaration (§2.3) |
| 6 | `directiveKind` | 1 | `USE_STRICT` \| `FLOW_PRAGMA` \| `TS_CHECK` \| `TS_NOCHECK` \| `ESLINT` \| `SOURCE_MAP` \| `NONE` |
| 7 | `attachedToKind` | 1 | `METHOD` \| `TYPE` \| `FIELD` \| `VARIABLE` \| `MODULE` \| `NONE` |
| 8 | `attachedToLinkHash` | 2 | FK→ the relation named by c7 |
| 9 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 10 | `startLine` | 1 | |
| 11 | `startColumn` | 1 | |
| 12 | `endLine` | 1 | |
| 13 | `isExternal` | 1 | parity slot |
| 14 | `serviceVersionLinkHash` | 1 | |
| 15 | `jsCommentUniqueHash` | — | **PK** |

**PK** `JS_COMMENT_md5(ownerModuleLinkHash ‖ startLine ‖ startColumn ‖ endLine)`

`declaresType` is the column that makes §2.3 checkable: the gate asserts every `js_type` row
with `evidenceKind = COMMENT_ONLY` has a `jsdocCommentLinkHash` pointing at a comment with
`declaresType = true`.

---

### 3.16 `js_parse_gap` / `lib_js_parse_gap` — 11 columns ★

What the parser could not do, recorded as data rather than a log line.

| # | Column | T | Meaning |
|---|---|---|---|
| 0 | `gapKind` | 1 | `PARSE_ERROR` \| `DEPTH_CAP_REACHED` \| `NON_LITERAL_SPECIFIER` \| `UNKNOWN_JSDOC_SYNTAX` \| `WITH_STATEMENT_SCOPE` \| `DYNAMIC_CODE` \| `FLOW_SYNTAX` |
| 1 | `detail` | 1 | |
| 2 | `relatedRelation` | 1 | which relation would have had the row |
| 3 | `relatedLinkHash` | 2 | |
| 4 | `ownerModuleLinkHash` | 1 | FK→`js_module` |
| 5 | `startLine` | 1 | |
| 6 | `startColumn` | 1 | |
| 7 | `isRecoverable` | 1 | |
| 8 | `isExternal` | 1 | parity slot |
| 9 | `serviceVersionLinkHash` | 1 | |
| 10 | `jsParseGapUniqueHash` | — | **PK** |

**PK** `JS_PARSE_GAP_md5(ownerModuleLinkHash ‖ gapKind ‖ startLine ‖ startColumn ‖ relatedLinkHash ‖ detail)`

*(Widened 2026-09-12 — see §7.3b-2. The narrow key lost genuinely distinct gaps that share a
position, which is not the same problem as a diagnostic reported twice.)*

If the analyzer drops something for a structural reason, it must say so **in the fact base**.
On a large TypeScript framework a nested config silently excluded 1,270 of 1,821 files because nothing counted them.

---

## 4. What does not port from TypeScript, and why

Recorded so the absences read as decisions rather than oversights (§12, checklist item 9).

| `ts_*` construct | status in JavaScript | why |
|---|---|---|
| `declarationGroupKey` / declaration merging | **absent** | JavaScript has no declaration merging. A second `class Foo` is an error, not a merge (§3.2) |
| `ts_type_satisfies` (structural satisfaction) | **absent** | Nothing declares `implements`, and there are no static types to check assignability between. This is the engine's problem if it is anyone's |
| `ts_enum_member` | **absent** | JavaScript has no `enum` |
| `ts_decorator` / `ts_decorator_argument` | **deferred, not absent** | Stage-3 decorators exist but appear **0 times** in this corpus. Recorded with a trigger: the first corpus with a decorator raises it |
| `isTypeOnly` on imports | **parity slot, always `false`** | No `import type` in JavaScript |
| `isAbstract`, `isAmbient`, `typeParameterCount`, `isParameterProperty` | **parity slots** | Kept at TypeScript's positions so the projection ports as a rename; permanently empty |
| `methodReferenceKind` | **parity slot, always `""`** | Inherited from Java through TypeScript; no `::` in JavaScript |
| `resolverAgreement` (tsc vs Node) | **moved to the oracle, not a parser column** | tsc *models* Node resolution; Node *is* it, and the disagreement over `exports` maps and `#`-imports is worth recording — but recording it in `js_import` would mean the **parser** running two resolvers, which is resolution work and a runtime dependency. It belongs in `../parser-oracle/javascript/` |
| `ts_type_parameter` | **absent as a relation** | `@template` (1,013) is a JSDoc tag and lives in `js_type_reference` with `contextKind = TEMPLATE`. A separate relation for 1,013 comment-borne rows is not worth a table |

And two JavaScript constructs with no analogue **anywhere** in the repo, both already covered
above: `js_scope` (§3.13) and the `edgeBearer`/`sourceExpressionLinkHash` pair that lets
declarations be minted from expressions (§2.1, §2.2).

---

## 5. The resolution story, end to end

The parser resolves **nothing across files**. What it emits for
`const router = require('./router'); router.get('/x', h)`:

| row | column | value |
|---|---|---|
| `js_import` | `specifier` | `./router` |
| | `resolvedFilePath` | `lib/router.js` |
| | `resolutionOutcome` | `RESOLVED_PROJECT` |
| | `edgeBearer` | `EXPRESSION` |
| `js_variable` `router` | `initializerKind` | `REQUIRE_CALL` |
| | `importLinkHash` | → that import |
| `js_call_site` `router.get` | `calleeName` | `get` |
| | `receiverText` | `router` |
| | `receiverTypeSource` | `IMPORT_ALIAS` |
| | `importLinkHash` | → that import |
| | `resolvedMethodLinkHash` | `""` — **tier 3, never staged** |

Three hops, all present, none resolved: the name as written, the importing module, and
`resolvedFilePath`. That is IR completeness as §0 of `BUILDING-A-PARSER.md` defines it, and it
is why the 52.6% oracle ceiling does not cap the engine.

---

## 6. The spine — freeze first

Nine relations, **234 columns**, enough to build **the IR an engine builds a call graph from**:

`js_module`, `js_scope`, `js_type`, `js_method`, `js_method_parameter`, `js_variable`,
`js_import`, `js_expression`, `js_call_site`.

The remaining seven — `js_type_heritage`, `js_field`, `js_export`, `js_block`,
`js_type_reference`, `js_comment`, `js_parse_gap` — are proposed in full here, and I recommend
freezing them in the same pass unless something in §3 is contested, because a second freeze
event costs another golden-file regeneration.

**`js_scope` is in the spine and that is the substantive difference from TypeScript's.** The
TypeScript spine has no scope relation because declared types carry resolution. Here, 52.6%
oracle resolution means the binder *is* the resolution mechanism, and a spine without it is a
spine that cannot answer what a name refers to.

---

## 7. Day-one gates

Built after approval, before the fact base is too large to read by hand. Each has caught a real
defect in another language.

### 7.1 Enum-emission audit with a reserved-value allowlist

Every declared enum value is run against a corpus that exercises the construct. Three outcomes
that cannot be told apart without looking: a real gap, a deliberate reservation, an audit false
positive. So the audit is a **gate with an explicit allowlist**, not a report.

Reserved, each asserted to carry **zero rows**:
`INDEX_CALL`, `GETTER_INVOCATION`, `SETTER_INVOCATION`, `PROXY_TRAP_CALL`, `GENERATOR_RESUME`
(§2.4), and **`js_module.moduleKind = JSON_MODULE`** *(ruled 2026-09-11)* — a `.json` file is an
import target the JavaScript walk never visits, so the value is unreachable by construction
rather than unimplemented. The day one is switched on it fails by name.

Also asserted: `js_type_reference.isTypeOnly` is `true` in **every** row;
`js_call_site.isTypeOnlyTarget` and `js_expression.isTypeOnlyReachable` are `false` in every row.

On TypeScript this audit found four real defects no other check caught, because every one was a
**classification** error that lost no rows.

### 7.2 PK uniqueness and FK integrity

Relation list **derived from the output directory**, never a hand-maintained array — adding a
relation once made every FK to it read as dangling. Duplicates **double**, they do not collide.

#### 7.2.1 A foreign key can be populated, resolvable, and wrong

*(Added 2026-09-12, from a defect `js-impl` found and three instruments missed.)*

`scopeOfNode` and `scopeByNode` — **the scope a node is IN** versus **the scope a node OPENS** —
were read for each other in four places. Every `js_method.bodyScopeLinkHash` was the *enclosing*
scope, every `FUNCTION_BODY` block linked the wrong scope, and constructor-function types had
`ownerScopeLinkHash = GLOBAL`. On every row since the first commit.

**The FK-integrity gate passed throughout, and was right to.** Every value was a valid,
resolvable `js_scope` hash. The IR-sufficiency measure counted the column as carried, because it
asked only whether it was non-empty. `js-corpus`'s independent reconciliation agreed with both.
**Three instruments, one blind spot:**

> **A foreign key may be populated, resolvable and wrong, and no integrity check can see it.
> Every link column needs an assertion about what it MEANS, by kind, or it has only integrity
> and not correctness.**

**The hazard is structural and enumerable.** It arises wherever **one relation holds two or more
links into the same target relation**, because then a swap produces a hash that resolves. This
schema has **84 link columns** and **ten such pairs**:

| source → target | columns | what makes a swap visible |
|---|---|---|
| `js_method` → `js_scope` | c24 `ownerScope`, c25 `bodyScope` | **`js-impl`'s new gate**: c25's scope has `ownerMethodLinkHash` = this method; c24's does not |
| `js_variable` → `js_scope` | c3 `declarationScope`, c4 `syntacticScope` | §7.3 rule 3, **partially**: `VAR_*` ⟹ c3 `isFunctionScope`. For `let`/`const` c3 = c4, so a swap is undetectable *and harmless* |
| `js_call_site` → `js_expression` | c5 `receiverExpression`, c16 `expressionLinkHash` | **self-detecting** — c16 is the PK input, so a swap changes the key |
| `js_call_site` → `js_method` | c12 `resolvedMethod`, c15 `enclosingMethod` | **self-detecting** — c12 is tier 3 and asserted empty |
| `js_import` → `js_module` | c11 `resolvedModule`, c17 `ownerModule` | **self-detecting** — c11 is tier 3 and asserted empty |
| `js_type_heritage` → `js_type` | c0 `ownerType`, c7 `resolvedType` | **self-detecting** — c7 is tier 3 and asserted empty |
| `js_field` → `js_method` | c13 `getterMethod`, c14 `setterMethod` | **needs an assertion**: agreement with `accessorPairKind` (c12) |
| `js_field` → `js_expression` | c11 `initializerExpression`, c16 `sourceExpression` | **needs an assertion**: c16 non-empty **iff** `declarationForm` is assignment-borne |
| `js_expression` → `js_method` | c13 `declarationLink`, c23 `ownerMethod`, c32 `introducesDeclaration` | **needs an assertion**: c13 iff `isDeclarationBearing`; c32 iff the kind introduces a callable; c23 always populated |
| `js_type` → `js_method` | c16 `constructorMethod`, c19 `enclosingMethod` | **needs an assertion**: c16's method has `ownerTypeLinkHash` = this type |

Six are already caught — four because one side is **tier 3 and asserted empty**, one because the
column is a **PK input**, one by an existing gate. That is not foresight; it is those columns
having had a *different* reason to be constrained. **Four have only integrity today**, and they
are named above so the list is a worklist rather than an observation.

**The generalisable form.** Tier-3 columns and PK inputs are accidentally self-checking, so the
columns most at risk are the ones that are **merely correct** — two populated links, same target,
no predicate separating them.

#### Reconciled against `js-impl`'s independent enumeration, which disagreed — and was right

`js-impl` counts **88** link columns, **84 populated**. This document's derivation counted **84**.
Both are correct, and the difference is a **defect in this document**:

- **88 − 84 = the four self-referential parent links** — `js_expression.parentExpressionLinkHash`,
  `js_block.parentBlockLinkHash`, `js_scope.parentScopeLinkHash`,
  `js_type_reference.parentReferenceLinkHash`. Every one is a genuine foreign key and **none of
  their column tables said so**; they documented only the `""` ⟺ `depth = 0` invariant. My
  extraction keyed on the words "FK→" and therefore could not see them. **Corrected above.**
- **88 − 84 populated = the four tier-3 columns** that are declared and never staged.

**And the four undocumented ones are the highest-risk category in the table**, which is why the
disagreement was worth more than agreement. A self-referential link's source and target are the
*same relation*, so **every hash from that relation resolves** — the wrong-target-relation
failure mode cannot occur, and a mis-parented node produces a tree that is valid, traversable and
wrong. `depth = 0 ⟺ parent = ""` (Appendix B) constrains only the root; nothing constrains the
other edges.

Two derivations of one list disagreeing located a documentation gap that neither would have found
alone. That is the argument for running both.

#### The four parent links need meaning assertions FIRST — specified here

They are ahead of the rest of the worklist because they are **the scope defect's shape with no
possible integrity signal at all**: source and target are one relation, so every hash resolves,
and the tree that results is valid, traversable and wrong. `depth = 0 ⟺ parent = ""`
(Appendix B) constrains only the **root**; every other edge is unconstrained today.

Each assertion below is derivable from columns the relation already has — no new column:

| link | assertion | what it catches |
|---|---|---|
| `js_expression.parentExpressionLinkHash` | the parent's `[startLine, startColumn]–[endLine, endColumn]` **strictly contains** the child's, and `parent.depth = child.depth − 1` | any mis-parent, including to a sibling or to a node in another subtree — a wrong parent almost never contains the child |
| `js_block.parentBlockLinkHash` | same containment, `parent.depth = child.depth − 1`, same `ownerModuleLinkHash` | a block parented outside its own module or across a function boundary |
| `js_scope.parentScopeLinkHash` | `parent.depth = child.depth − 1`, same module, and **`MODULE`'s parent is `GLOBAL`** | the exact defect that occurred: an `IN` scope where an `OPENS` scope belonged, since the two differ in depth |
| `js_type_reference.parentReferenceLinkHash` | `parent.depth = child.depth − 1` and `childIndex < parent.childCount` | a child indexed past its parent's arity, which is what a swapped or duplicated subtree produces |

**Containment is the strong one and it is nearly free**, because every one of these relations
already carries start and end positions. A mis-parented node is almost never *spatially inside*
the node it was wrongly attached to, so the assertion fails on the first bad row rather than on a
statistical drift.

**One honest limit.** For a node whose parent is its immediate syntactic enclosure, containment
holds for the *correct* parent and for any *ancestor* of it. So these catch a wrong **branch**
and a wrong **depth**, and do not catch an off-by-one **up the same spine** except through the
depth clause — which is why the depth equality is stated separately rather than folded in.

**One question back to `js-impl`:** 27 + 27 + 19 = **73**, against **84 populated**. Either
eleven columns sit in none of the three categories, or the partition is over a different
denominator. Worth naming before the list is treated as complete — a partition that does not sum
is the §7.3c-0 shape.

### 7.2a IR completeness — the gate that replaces "resolution rate"

The headline gate, and the one the 52.6% ceiling sizes rather than caps. For every
`js_call_site`, **is every hop an engine would need present?** Not *did the parser resolve it*.

A call site is **complete** when one of these holds:

| shape | required columns, all non-`""` |
|---|---|
| receiver declared in **this file** | `calleeName`, and `resolvedBindingLinkHash` on the receiver expression |
| receiver reached through an **import** | `calleeName`, `receiverText`, `importLinkHash`, and that import's `resolvedFilePath` |
| receiver typed only by **JSDoc** | `calleeName`, `declaredReceiverTypeName`, and the `js_type_reference` it points at |
| **honestly unresolvable** | `callKind` ∈ {`COMPUTED_CALL`, `DYNAMIC_CODE_CALL`} — complete *because* it says so |

The gate reports completeness **per bucket**, never as one number, and an `ANY_SIGNATURE` from
the oracle is **not** an incompleteness — it is the oracle declining, and 52.0% of call sites
get one. A gate that conflates the two measures the oracle's weakness and calls it a parser
defect.

The failure this catches is the one that matters: a call site with a receiver from another file
and **no `importLinkHash`** is unreconstructable by any engine, and it is invisible to every
count-based check, because the row exists and is correctly positioned.

### 7.3 The JavaScript-specific ones

1. **Module-edge integrity.** *(Scoped for `COMMENT` 2026-09-12 — see §3.8.1.)* Clauses (a) and
   (b) below apply to `DECLARATION` and `EXPRESSION` rows. A `COMMENT`-borne row has no
   expression and is instead asserted to be referenced by **at least one**
   `js_type_reference.importLinkHash`. *(Corrected 2026-09-11 — the original wording said "exactly one"
   and contradicted `js_import`'s own primary key. `js-impl` caught it; the gate was wrong,
   not the key.)* One `require()` expression legitimately yields **one edge row per bound
   name**: measured, **1,249 of 9,055 require expressions (13.8%) bind more than one name, and
   the widest binds 107.** "Exactly one" would have failed on every one of them. The invariant
   is three parts:

   - **(a)** every `js_expression` with `isModuleEdge = true` has **at least one** edge row;
   - **(b)** every edge row's `sourceExpressionLinkHash` points at an expression flagged
     `isModuleEdge`;
   - **(c)** no `(sourceExpressionLinkHash, localName)` — or `exportedName` — pair appears
     **twice**.

   (c) is the part that carries the original intent. The failure this gate exists for is the
   second pass visiting one expression on two paths and minting the same edge twice, and §2 of
   `BUILDING-A-PARSER.md` is explicit that duplicates **double rather than collide**. A repeat
   binding is impossible in legal source — `const {a: x, b: x} = require('y')` is a
   redeclaration error — so (c) has no false positives and catches the doubling that (a) alone
   would miss.
2. **Call-site 1:1.** `js_call_site` count equals the count of call-like `js_expression` rows,
   **excluding `require()`**, which is a module edge.
3. **Scope coherence.** Every `js_variable` with `bindingRegime = VAR_*` has a
   `declarationScopeLinkHash` whose `isFunctionScope` is true. This is the hoisting model
   asserted rather than assumed, and it fails loudly if the binder regresses to one scope column.
4. **Module-system coherence.** No file emits both `require` and `import` module edges unless
   `contradictsGoverningConfig` is true.
5. **Non-`PROJECT` files are excluded from coverage DENOMINATORS, not from emission.**
   *(Corrected 2026-09-13 — §3.1.1.)* `BUNDLED` and `GENERATED_MONOLITH` emit **in full**; the
   provenance column is the filter. Only `FLOW_REJECTED` withholds rows, and it withholds all
   but the module row. The gate asserts both halves: that no coverage denominator counts a
   non-`PROJECT` file, **and** that a `BUNDLED` file emitted rows — a `BUNDLED` file with no
   rows is a silent drop wearing a label.
6. **No cross-file link is ever staged.** Every populated `resolved*LinkHash` resolves to a row
   whose `ownerModuleLinkHash` equals the source row's — asserted, not assumed. The tier-3
   columns are asserted **empty**. This is the §0.2 rule as a check, and it is the one that
   stops the schema drifting into a resolver one column at a time.
7. **Declaration-by-assignment round trip.** Every `js_method`/`js_field` row with a
   `declarationForm` other than `CLASS_MEMBER`/`SYNTACTIC` has a `sourceExpressionLinkHash`
   that resolves, and that expression has `isDeclarationBearing = true`.

### 7.3a-2 Flow detection, as a tripwire rather than an assertion

Per §2.6, a Flow file emits one `js_module` row and nothing else. The gate on that is **not**
"no Flow reaches the fact base" — that would be an assertion of a thing no detector can
guarantee. It is:

1. **Every file with `sourceProvenance = FLOW_REJECTED` contributes exactly one row**, its
   module row, and zero rows to every other relation.
2. **`declaredTypeSource = SYNTACTIC_FLOW` counts 0 in emitted files** — and where it does not,
   the gate **names the files**, because each one is a detection miss and not a parser defect.
   This is a *named residual*, deliberately not a zero-row assertion (§7.3c): the population it
   measures is the failure of the `@flow` detector, which is a corpus property.
3. **No `js_method` row with `bodyPresence = NO_BODY` survives in an emitted file.** In
   JavaScript proper there is no way to write one; `declare function` is Flow, so a `NO_BODY`
   row is the §7.1 type-only tripwire firing through the Flow path.

### 7.3b A grammar diagnostic is not a gap unless a row is missing

*(Ruling, 2026-09-11.)* `ts.createSourceFile` has **no sloppy mode**, so it reports legacy octal
literals (TS1121) and octal escapes (TS1487) as grammar errors in every file. `node --check`
accepts them, and in a sloppy CommonJS module they are legal and they run.

**No `js_parse_gap` row is minted for these.** Verified rather than assumed — on
`var mode = 0777; var esc = "\077";` the compiler reports both diagnostics and the AST is
**complete**: zero unbuilt nodes, both literals produce `js_expression` rows with the correct
`literalKind`, both bindings produce `js_variable` rows.

The rule, stated generally so the next case is decidable without another ruling:

> **`js_parse_gap` asserts that a row is missing. Where no row is missing, there is no gap** —
> whatever the compiler says.

A gap row here would report a defect that does not exist, which §7 of `BUILDING-A-PARSER.md`
says is exactly as wrong as hiding one, and it would destroy the property that makes the
relation useful: *an always-empty relation that suddenly has rows is a signal.* Suppressing the
strict-mode-only diagnostic codes in files whose module scope is sloppy is correct, and a
genuine syntax error still produces a row.

**No `gapKind` for oracle disagreement.** `js-impl` was right not to invent one. This is a
disagreement between tsc's grammar and the runtime, and it belongs in
`../parser-oracle/javascript/` alongside the V8 adjudicator — the same place
`resolverAgreement` went, and for the same reason: the parser records what it emitted, the
oracle records where two implementations differ.

### 7.3b-2 The `js_parse_gap` duplicate key — RULED, and the prepared fix was wrong

*(Opened 2026-09-11 on 121 duplicates; `js-corpus` isolated it 2026-09-12; ruled the same day.)*

**The prepared fix would not have worked, and the repro is what showed it.** I had `detail`
(c1) staged to join the key. `js-corpus` isolated the real instance — a Flow-annotated UI framework
`a large reconciler source file`, byte offset 43859, `parseDiagnostics[18]` and `[21]` — and the two
diagnostics **differ in nothing**: same `start`, `length`, `code`, `category`, `messageText`,
same `SourceFile`, distinct objects. **No key built from diagnostic content can separate them.**
Declining to rewrite the key against an unreproduced mechanism was right for a better reason
than the one I gave.

**Reproduced here, and the conditions are narrower than first stated.** From the 7-line case,
by ablation:

| condition | required? |
|---|---|
| a cast whose target is a **generic with exactly one type argument** (`S<any>`) | **yes** — bare `S` is clean, and `Map<K, V>` is clean because the comma stops it |
| the cast's expression is **compound** — `a[i]`, `f()`, `a.b` | **yes** — a bare identifier `x` is clean |
| **two or more** levels of enclosing braces | **yes**, and **collisions scale with depth**: 3 braces → 3 collisions |
| a *double* cast `((e: T1): T2)` | **no** — a single cast duplicates too |
| the element access spanning **multiple lines** | **no** — one line duplicates identically |

The cause is downstream of this schema's own §3 finding: under `ScriptKind.JS`
`languageVariant` is **already** `JSX`, so `<any>` opens a JSX element and the parser commits to
a parse it then abandons, re-reporting the tail. §3 concluded the script-kind question "does not
have to be made"; that conclusion stands, and this is its cost.

**The ruling, CORRECTED 2026-09-12: de-duplicate *and* widen the key. Both halves are needed,
and my first ruling — "the key does not change" — is withdrawn.**

I ruled on `js-corpus`'s data, in which every colliding position was field-identical, and
concluded that two *content-distinct* gaps at one position were `MERELY_UNOBSERVED`. **They had
been observed, by `js-impl`, and I did not check.** The case is a small UI library's:

```js
/** @type {…} */
const [{_instance}, forceUpdate] = useState(…);
```

One JSDoc position, **two bound names, two `js_type_reference` rows, two genuine gaps.** Under
the narrow key they collide and one is **lost** — that is data loss, not de-duplication. The
emission site makes it structural rather than incidental: `UNKNOWN_JSDOC_SYNTAX` is minted
**once per type-reference row**, at that row's position, so any JSDoc annotation over a
multi-name binding produces exactly this shape.

So the two halves answer two different problems and neither substitutes for the other:

| problem | fix | example |
|---|---|---|
| one diagnostic reported **twice** by a backtracking parser, field-identical | **de-duplicate** — lossless, since identical rows carry identical information | a Flow-annotated UI framework's 11 rows at one offset |
| two **distinct facts** that share a position | **widen the key** with `relatedLinkHash` and `detail` | a small UI library's two bound names under one `@type` |

**Why my objection to the ordinal does not apply to this widening, which is where I went
wrong.** I conflated "widen the key" with "put the ordinal in the key" and rejected both with
one argument. They are not the same: an ordinal is `parseDiagnostics` **index**, a property of
tsc's internal ordering that a patch bump can permute. `relatedLinkHash` and `detail` are
**content** — *which entity the gap is about* and *what it was* — properties of the source
program. The objection was to ordering-dependence, and the widening has none.

**Status: the widening is on `js-impl` and not yet on `js`.** There is nothing to revert. The
key on `js` today is still the narrow one, unchanged since the relation was created; `js-impl`
widened it in `aa0785f` with **both** `relatedLinkHash` and `detail` (not `relatedLinkHash`
alone — `detail` separates two `UNKNOWN_JSDOC_SYNTAX` gaps on different type names at one
position). Measured over 3,565,423 rows, the pair takes 121 duplicates to 0. **It lands with
sweep 4.**

##### A corollary the two lists needed

"Never observed" is not a property of the world; it is a property of **an instrument**. I wrote
`MERELY_UNOBSERVED` on the strength of one agent's corpus while another agent held a
counterexample. So a `MERELY_UNOBSERVED` entry must record **by whom and over what** it was not
observed, exactly as §0.3 requires of every headline number — and a second agent's "I have seen
this" outranks a first agent's "I have not".

##### The de-dup half survives Flow exclusion — a non-Flow reproducer exists

*(Ruled 2026-09-12.)* `js-fixtures` reported that the only reproducer of the *field-identical*
half is `flow/casts.js`, which `FLOW_REJECTED` retires, and concluded from eight plain-JavaScript
shapes and five malformed-JSX shapes that the `:` is what pushes the parser into the type
grammar — and only Flow has one. **That conclusion is falsified, and the de-dup does not ship
untested.**

The mechanism is not the colon. It is `<` **opening a JSX element the parser then abandons**,
and §3 of this schema establishes that `ScriptKind.JS` carries `languageVariant = JSX`
*always*. So plain JavaScript reaches it:

```js
const m = <Foo><Bar>;        // one line. no colon, no @flow, no braces.
```

→ **one field-identical duplicate.** Verified, and it scales the same way the Flow case does:

| shape | identical duplicates |
|---|---|
| 1 unterminated tag, no nesting | 0 |
| **2 unterminated tags, no nesting** | **1** ← smallest |
| 1 tag, 2 levels of nesting | 2 |
| 2 tags, 2 levels of nesting | 3 |
| 1 tag inside `function` + `if` | 2 |

So the condition is **two or more unterminated tags, *or* nesting depth ≥ 2** — and ordinary
control flow (`function` + `if`) supplies the nesting, not just bare blocks.

**Why `js-fixtures` missed it, and its measurement was not wrong.** Its five shapes put the
malformed element *inside a well-formed JSX tree*, where TypeScript's recovery is genuinely well
behaved — `jsx/unterminated-element.jsx` produces exactly **1** diagnostic and **0** collisions,
as documented. The reproducing shape is adjacent but different: an unterminated tag in
**expression position**, terminated by a semicolon, with nothing to recover into.

**The ruling: keep the de-dup, and it is testable end-to-end after the exclusion.** No
detection-bypassing path is needed, and it must not be declared unreachable. `js-fixtures`
should add the shape above as a non-Flow fixture; it is one line and carries no pragma, so
nothing retires it.

**`js-corpus` timed the isolation deliberately**, before the Flow exclusion landed: once `@flow`
files become one module row each, all 121 instances vanish from the sweep. The 7-line case
carries **no pragma**, so it survives §2.6 and keeps the gate able to fail. That is the
difference between fixing a defect and hiding it.

### 7.3c-0 The rule that catches a residual bucket

> **The discipline that catches this is not suspicion of a number. It is being unable to name
> what is inside it.**

A residual bucket absorbs whatever is common and then reads as an *explanation*; a merged bucket
absorbs two opposite outcomes and reads as *agreement*. Neither survives being asked to
enumerate its members, and neither is caught by looking at the number, because in both cases the
number is large and stable and looks like a finding.

Recorded because it has now failed **twice in this document, days apart, by the same author**: a
2,531-row `elsewhere` that did not exist (§3.14.1), and then
`PropertyAssignment / PropertyDeclaration 278 → FIELD` merging two constructs whose real
outcomes are opposite — one reaches, one does not. The second was committed *after* writing up
the first.

##### A role-substitution list must be checked against ordinary English

Beside the citation rule, because it is the same family and was learned the same way. The
de-identification replaced a package name that is **also an ordinary English verb** with a role,
so "the case c17 cannot express" became "the case c17 cannot *a CommonJS web framework*" in two
places. A second term on the list is also a verb; that one survived only because nothing used it
that way.

**A replacement that leaves a grammatical fragment is a different failure from one that leaves a
name: it passes the gate and fails the reader**, because the gate can only see names. The
complete check is to scan **every role phrase in a verb slot** across every artefact — which
found two real breaks and one false positive (`from X **to** Y`, a range, not a verb).

**And the rule did not prevent the error — it made the error findable.** Both times the author
had written the rule down, and both times committed the failure anyway; what the rule bought was
that the second one was recognised in minutes instead of shipping. A third instance occurred
while *de-identifying this document*: a survey regex matched a package name inside an ordinary English
word and reported 257 hits where 165 existed. That is the honest claim for a written-down rule — not
prevention, recognition.

**So any bucket an audit reports must be enumerable on demand**, and a bucket named `OTHER`,
`elsewhere` or a slash-joined pair is a finding about the audit until someone lists what is in
it.

### 7.3c Every "measured 0" in this document is a statement about a CORPUS

*(Ruling, 2026-09-11, with a correction attached.)* A zero-row assertion is only ever evidence
that **the corpus it ran over contained none** — never that the language cannot produce one.
Conflating the two turns a reserved value into a false invariant.

**The case that forced it.** `js_module.contradictionKind = REQUIRE_UNDER_ESM` — `require()` in
a `"type": "module"` file — was reported as **0**, and `DECISION-MEMO.md` used it as the
*falsifier* for the entire Q3 recommendation: *"the direction that is a real runtime crash
stays at zero."* `js-impl` measures **4 of 816 files emitting it.** The original audit ran over
a **15-file scaffold**.

The recommendation survives — 0.49%, and "emit normally with a column naming the contradiction"
is *validated* by that column having rows, not undermined by it. **The zero-row assertion does
not survive**, and it was by far the more confident of the two claims.

**So every reserved value now has to say WHY it is unreachable:**

| value | kind of claim |
|---|---|
| `INDEX_CALL`, `GETTER_INVOCATION`, `SETTER_INVOCATION`, `PROXY_TRAP_CALL`, `GENERATOR_RESUME` | **by construction** — a fact about a value's runtime identity that syntax cannot decide. Not a corpus claim; a row appearing is a real defect |
| `JSON_MODULE` | **by construction** — the JavaScript walk never visits a `.json` file |
| `REQUIRE_UNDER_ESM` | **corpus artefact — NOT reserved. Corrected: 4 of 816 files** |
| `relative_path_unresolved = 0` | **corpus artefact — corrected: 3.** Unlike the others these would be genuine broken edges |
| syntactic Flow annotations `= 64` | **corpus artefact in the other direction** — 0 in the replication corpus, since all 64 were in a static-site framework (§0.0b) |

##### Reservations are keyed by `(enum, value)`, not by the bare string

*(Corrected 2026-09-12, from `js-corpus`. The **first two rulings ever to reserve a shared
string** were the first two that could not land as written — mine.)*

Both allowlists were keyed by **bare value**, which was fine while every reserved string had one
owner. `FIELD` is declared by **four** enums and `JSDOC` by **four**. So `FIELD:` and `JSDOC:`
asserted zero rows on **six other `(enum, value)` pairs that are emitted thousands of times**,
and the audit reported six reserved-but-emitted violations against a copy where only two entries
had been added.

**This is the 35-shared-strings defect from the other side.** The audit had to become
column-scoped because whole-cell matching scored an enum on *another enum's* evidence; a
bare-string reservation is the same error inverted — it reserves in every enum that spells the
word. Same defect, same fix: **key by `(enum, value)`**, written `'JsExportTargetKind.FIELD'`.

A bare key stays legal for a string only one enum declares, and the audit now **reports a bare
key on a shared string as an AMBIGUOUS RESERVATION** rather than silently applying it
everywhere — which is the part that stops this recurring, because the next shared string will
be reserved by someone who does not know it is shared.

**The rule the enum audit enforces from here:** a reserved value must state whether it is
unreachable **by construction** or merely **unobserved in a corpus**. Only the first kind may
carry a zero-row assertion. The second gets a count and the name of the corpus it was counted
on, and `js-corpus` owns re-measuring it at scale.

##### A third disposition: the value is in the WRONG VOCABULARY — remove it

*(Added 2026-09-12, ruling `js-corpus`'s three remaining column-scoped gaps.)* Two lists are
not enough. A value can be unemittable for a reason that is neither construction nor corpus:
**it does not belong to that column's vocabulary at all.** Reserving such a value is worse than
removing it, because a reservation says *"this belongs here and is not currently produced"* and
invites the next person to close the gap by emitting something wrong.

| value | disposition | reason |
|---|---|---|
| `js_comment.directiveKind = USE_STRICT` | **REMOVE** | `'use strict'` is a **string-literal expression statement, not a comment**, so it can never produce a `js_comment` row. Every other member of that vocabulary (`SHEBANG`, `FLOW_PRAGMA`, `TS_CHECK`, `ESLINT`, `SOURCE_MAP`) genuinely is a comment. The fact is already carried, correctly, by `js_scope.strictModeSource = USE_STRICT_DIRECTIVE`. Reserving it would invite someone to mint a comment row for a string literal |
| `'JsExportTargetKind.FIELD'` | **RESERVE — by construction** | an export binds a **name at module level to a value**; a `js_field` is a **storage location on a type**. `exports.render = render` targets a METHOD and `module.exports.Widget = Widget` a TYPE; `exports.x = obj.count` targets the *value read from* a field, which is `EXPRESSION_VALUE`. No syntax makes a field itself the target of a module export |
| `'JsRootContext.JSDOC'` | **RESERVE — by construction** | the expression walk uses an **allowlist of expression positions** (§3.10) and JSDoc is deliberately not among them. A default inside `@param {number} [n=1]` is type-channel content, not program text, and walking it would put comment content into the expression relation — which is precisely what gate §7.1 forbids and what §6 of `BUILDING-A-PARSER.md` warns a generic walk does |

`USE_STRICT` is the instructive one, and `js-corpus` recorded how it was nearly missed: an audit
with a substring fallback matched `USE_STRICT` inside `USE_STRICT_DIRECTIVE` — **a value of a
different enum** — and reported it emitted. **A substring hit in free text is a diagnostic,
never an emission.** That is the same family as §4's `MODULE_EXPORTS` prefix false positive,
inverted.

With these three ruled, the column-scoped gap count reaches **0** and `GAP_BAR` reaches its
floor. Per §8 of `BUILDING-A-PARSER.md` the bar is then **deleted** and the invariant asserted
directly: every declared value is `OBSERVED`, or on one of the two reserved lists with a
written reason.

##### The asymmetry — a rule, not a remark

**A value moves from `MERELY_UNOBSERVED` to `OBSERVED` on one row. It does NOT move back.**

Concretely: when a value that has been observed drops to zero again — because a corpus changed,
a stratum was excluded, or a fixture was removed — it returns to **`MERELY_UNOBSERVED` with a
corpus note**. It does **not** earn a place on `UNREACHABLE_BY_CONSTRUCTION`, and it does not
regain a zero-row assertion. The only thing that earns that list is a **structural** argument:
the grammar cannot express it, or the walk never visits the construct that would produce it.

This asymmetry is the entire reason there are two lists, and it is the thing the next person
will collapse — because after Flow is excluded, `NO_BODY`, `IMPORT_EQUALS` and `SYNTACTIC_FLOW`
will all read as zero again and will look exactly like the five call kinds that genuinely
cannot occur. They are not the same, and the difference is not visible in the counts. It is
visible only in *why*:

| | why it is zero | may carry a zero-row assertion? |
|---|---|---|
| `INDEX_CALL`, `GETTER_INVOCATION`, … | syntax cannot decide it — a fact about a value's runtime identity | **yes** |
| `JSON_MODULE` | the walk never visits a `.json` file | **yes** |
| `NO_BODY`, `IMPORT_EQUALS`, `SYNTACTIC_FLOW` after §2.6 | **a file class was excluded from the corpus** | **no** |

`REQUIRE_UNDER_ESM` is the worked example of what the wrong answer costs: reserved with a
zero-row assertion on a 15-file scaffold, while 4 of 816 real files emitted it.

### 7.4 Two non-properties, asserted as such

- **No gate may assert JSDoc-density monotonicity.** Measured 24.1% → 39.5% → 61.8% → **59.6%**
  → 74.1%; the inversion is real and is not a regression.
- **No gate may treat `ANY_SIGNATURE` as a parser miss.** It is the oracle declining. A gate
  that counts it has a ceiling of 52.6% and reports a defect population that does not exist.

### 7.5 Determinism

Two runs, byte-identical.

### 7.6 The meta-rule

Every check above must be **made to fail on purpose** before a passing result from it is
trusted. Three of the most expensive errors in this repo were checks incapable of returning
anything but "clean" — and one of them occurred while measuring *this* memo's corpus (§8.2 of
`DECISION-MEMO.md`).

---

## 8. Open decisions

Nothing in this document is unanswered. Two items are deferred **with a recorded trigger**:

| # | item | state | trigger that raises it |
|---|---|---|---|
| OQ-1 | Stage-3 decorators | no relation proposed; 0 occurrences measured | the first corpus file containing a decorator; `js_parse_gap` with `gapKind = PARSE_ERROR` will surface it |
| ~~OQ-2~~ | **CLOSED — see §8.1.** The earlier ruling (reference `lib_ts_*`) is **reversed**: a pointer to a specific lib row is a resolved link, and tier 3 forbids it. No `lib_js_*` population and no `lib_ts_*` reference; the row carries the target name plus `AMBIENT_BUILTIN_TARGET` and the engine joins | closed — no trigger |

### 8.1 OQ-2, CLOSED — and the earlier ruling reversed

**Superseded 2026-09-11.** The ruling previously recorded here said `js_*` would **reference**
the existing `lib_ts_*` rows — a `js_call_site` whose target is a Node builtin pointing at a
`lib_ts_method` key. **That conflicted with the tier-3 rule in §0.2, and tier 3 wins.**

**A pointer to a specific `lib_ts_*` row is a resolved link.** It does not stop being one
because the target happens to live in the ambient population rather than in another project
file. §0.2 says `js_call_site.resolvedMethodLinkHash` is *declared and never staged*; the
earlier ruling would have staged it — for 24.4% of all declines, which is the worst possible
place to make an exception.

**The ruling, final:**

- **No `lib_js_*` population.** All 16 `lib_js_*` pairs stay declared for projection symmetry
  and are never staged.
- **No `lib_ts_*` reference either.** `resolvedMethodLinkHash` stays empty, always.
- The row records **the target name as written** — `calleeName`, `calleeText`, `receiverText`,
  all already present — plus **`resolutionOutcome = AMBIENT_BUILTIN_TARGET`**, which says
  *which population to look in*.
- **The engine joins.**

**Written down because the next person will reach for the reference too, and it is seductive
for good reasons:** unlike a cross-file project target, the lib row *already exists* when the
JavaScript is analysed, its key *is* computable, and the join *would* succeed. All three are
true and none is the point. **"The target exists and I can name its key" is what resolution
is.** A parser that fills the link because it happens to be able to has become a resolver for
one privileged case — and §0's argument is that there is no small exception here. TypeScript's
cross-file import following started as one and was deleted.

The practical cost is nil, because the engine does the same work either way: it must locate the
`lib_ts_*` rows regardless, and doing so from a name plus `AMBIENT_BUILTIN_TARGET` rather than
from a stored key changes nothing about the join. What it changes is whether the fact base
contains a claim the parser cannot stand behind.

**What the parser must therefore get right instead**, since this is the whole of its
contribution to an ambient call: the name as written, un-normalised; the receiver text; the
`js_variable.initializerKind = REQUIRE_CALL` and its `importLinkHash`, so the specifier
(`'fs'`) is reachable; and `resolutionOutcome`. Those four are what let the engine build the
chain. If any is missing the call is unreconstructable, and §7.2a's IR-completeness gate is
what checks it — that gate, not a resolution rate, is the measure that matters here.

The remaining item, OQ-1, is flagged rather than solved on purpose: it lands outside
`src/schema/javascript/`, and §11 of `BUILDING-A-PARSER.md` says to verify, quantify, hand over
and stop.

---

## Appendix A — `decls_base_js.dl` is generated

`gen_decls.py` parses the column tables in this document and emits
`src/schema/javascript/decls_base_js.dl`:

- positional `c0..cN`, all `symbol`
- both `js_*` and `lib_js_*` per entity, identical arity
- the last column is the entity's own unique hash **for every relation except
  `js_expression`**, which carries one appended column after it (§3.10)
- `gen_decls.py --check` in CI fails if the `.dl` and this document disagree on **arity or
  order** for any relation

Column names live only in this document; the `.dl` carries positions. A rename is therefore
free post-freeze and a reorder is not, and generating the `.dl` is what makes that asymmetry
safe.

## Appendix B — invariants the harness enforces

1. Every non-`""` FK column resolves to an existing PK in its target relation.
2. Every PK is unique within its relation.
3. `depth = 0` ⟺ `parentExpressionLinkHash = ""` (and the same for `js_type_reference`).
4. Every `js_type_reference` row with `childCount > 0` has exactly `childCount` children,
   unless `isTruncated`.
5. `js_call_site` count == call-like `js_expression` count, excluding `require()`.
6. Every `js_expression` with `isModuleEdge` is referenced by **at least one** import/export
   row, every edge row's source is so flagged, and no `(sourceExpression, boundName)` pair
   repeats. **Not "exactly one"** — a destructured `require` binds up to 107 names from one
   expression (§7.3.1).
7. Every `VAR_*` binding's declaration scope has `isFunctionScope = true`.
8. No `js_call_site.isTypeOnlyTarget`; no `js_expression.isTypeOnlyReachable`;
   every `js_type_reference.isTypeOnly`.
9. Reserved enum values carry zero rows.
10. The emitting compiler version is recorded in every golden file **and** in
    `js_module.targetTsVersion`; a mismatch fails the gate rather than being reconciled.
