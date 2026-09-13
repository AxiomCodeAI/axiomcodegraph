# `verified/` — reproductions, each with its own control

Every file here reproduces a disagreement between the parser and the compiler
oracle (`typescript@6.0.3`, `allowJs`/`checkJs`), **on a pushed commit**, named in
the file's header.

## The header is derived, not written

Every file here carries `// fixture: <path>` and `// nature: type-only|runtime-bearing`,
because js-impl's nature gate requires both and files entering through this
directory bypass js-fixtures' header pass — twenty-one of mine were failing it on
`js` before anyone told me. The label is never typed: `src/test/javascript-gates/fixture-headers.mjs`
computes it with the gate's own predicate (`statements.length === 0`) and inserts
it, and `--check` exits non-zero if any file under `categories/` or `verified/` is
missing one or declares one the predicate disagrees with. A wrong label is
reported and never rewritten silently.

## Three rules, and the third is the one that took the work

1. **Source only.** No file here states an expected fact. Authoring an expectation
   makes it the spec and locks in whatever it got wrong; the oracle is the only
   thing entitled to say what a row should contain.

2. **A repro that cannot fail is worthless.** Each file carries the working
   controls for its own construct, in the same file, so a run that shows the gap
   is showing the construct and not the file. `computed-call-index.js` is five
   controls and two gaps. `constructor-forms.js` is five working constructor
   spellings and seven broken ones that differ from them by one token.

3. **The measurement is part of the finding.** Two of these four were first
   measured wrong, and the header says so:
   `nested-destructured-require.js` was reported as 2,229 missing rows when 2,226
   of them existed and the probe was keyed on the wrong column, and the recall
   sweep that found `object-literal-members.js` first attributed 6,364 misses to
   a monorepo's `.ts` files the parser had never claimed.

## What is here, and what it costs

| directory | construct | corpus scale |
|---|---|---|
| `prototype-constructor-forms/` | constructor as a function EXPRESSION bound to a name | 164 prototype members, 8 `util.inherits`; a 2010-era logging library loses 56 of 57 |
| `object-literal-members/` | object-literal method / accessor members | 3,210 of 3,264 call-site recall misses |
| `computed-call-index/` | `obj[expr](args)` — the index expression | 54 sites, each one an arity discriminator |
| `nested-destructured-require/` | `const { a: { b } } = require('m')` | 72 of 13,190 require edges |
| `destructuring-assignment-default/` | `({ x = f() } = src)` — the shorthand default | was the last 2 recall misses; fixed in 527770c |
| `parenthesised-heritage/` | `class X extends (A.B) {}` | 43 of 1,988 heritage edges flagged computed |
| `trailing-comment-in-brackets/` | `[ 1, // note ]` — trailing comment inside brackets | 2,211 of 64,157 comment ranges |
| `export-star-as/` | `export * as X from 'm'` | 7; a re-export module records zero exports — fixed in df58770 |
| `jsdoc-on-assigned-function/` | `@param` on `x = function(){}` / `const f = () => {}` | regression at df58770: 2,068 rows lost |
| `import-binding-shadowed/` | two `require` bindings with one local name | import<->variable links keyed by name, cross-scope both ways |
| `duplicate-parse-gap-key/` | two `js_parse_gap` rows under one primary key | 121 extra rows, 74 keys |

## Status after sweep 3

Four of the six are FIXED and stay here as regression cover: the object-literal
members, the assignment-bound constructor, the computed-call index and the nested
destructured `require` all reproduce nothing now. `duplicate-parse-gap-key/` is
fixed too and is kept as the negative case below.
As of sweep 4 (js-impl@527770c) the corpus has ZERO call-site recall misses.
`parenthesised-heritage/` is the one still open, and it was not found by the
sweep at all — see below.

A fixture whose bug is fixed is not deleted. It is the only thing that would
notice the fix coming undone.

## One of these was found by a route this corpus does not have

`parenthesised-heritage/` came from auditing the residue of js-impl's own
`javascript-gates/ast-recall.ts`, not from the sweep. The sweep adjudicates CALL SITES
against the compiler; it is blind to `js_type_heritage`, and it was equally blind
to the 4,944 nested JSX elements that emitted no row — every call in those
subtrees was emitted at the right position with the right kind, so recall, kind,
optionality and the 1:1 call-site/expression gate were all green while the
component graph was flat.

Read "0 recall misses over 195,781 calls" narrowly: it means zero CALL-SITE recall
misses. It is not a statement about `js_expression`, `js_block`, `js_variable` or
`js_type_heritage`.

## One of these was found by the held-back corpus, and it is a NEW CLASS

`jsdoc-import-type-rehosted/` is the first fixture from the holdout (opened
2026-09-13 against `js@5095da4`). One `@type {import('x').T}` comment over a
variable whose initializer contains a nested FUNCTION DECLARATION is minted once
per nested declaration — three identical `js_import` rows with one primary key.
No development tree had produced a duplicate key in 3.59M rows, and no question
had been asked about a comment being re-hosted DOWNWARD into a declaration it
does not document; every prior question about JSDoc hosts was about rows that
were missing. It fails gate 1, PK uniqueness, which is why it is a class and not
an instance. The control beside it — the same comment over an initializer with
only a function EXPRESSION — mints one row.

## What the holdout did NOT test, written down so it is not absorbed

The Flow-detector holdout was chosen because its Flow-ness was supposed to be a
property of the project rather than the file, in a vendor's dialect the detector
had never seen. Measured, it was neither: one spelling, `/* @flow */` on line 1
of all 161 Flow files, and a `.flowconfig` that checks nothing without a pragma.
So `SYNTACTIC_FLOW`'s detection-miss column has still never met a real file that
is Flow without saying so. That holdout is spent; the pragma-less class is an
OPEN EXPOSURE recorded in `CORPUS-MANIFEST.json` (`heldBack.opened.openExposure`),
and every Flow-detector number in this tree is a statement about pragma-bearing
files only.

## One of these is a NEGATIVE case on purpose

`duplicate-parse-gap-key/` was written to make the PK-uniqueness gate **fail**,
and as of js-impl@24774d7 it no longer does — the key was widened and identical
diagnostics deduped, and both files now produce 16 gap rows and 0 duplicate keys.

It stays, for two reasons. It is the only thing that would notice the fix coming
undone. And `minimal-seven-lines.js` carries no Flow pragma, so it survives the
Flow out-of-scope ruling — which matters, because the ruling removes all 121
corpus instances and would otherwise have hidden the mechanism rather than fixing
it. The header on that file also records a trap it fell into itself: its first
version spelled the pragma in prose and was classified `FLOW_REJECTED` (then spelled `FLOW_EXCLUDED`), so the
repro silently stopped reproducing.

## Not here

The five enum-emission gaps found by the column-scoped audit live in
`categories/` rather than here, because each one is a construct the corpus should
reach as a matter of course rather than a shape contrived to expose a bug. See
`categories/COVERAGE.md`.

## Reproducing

```
npx tsx src/test/javascript-tests.ts --corpus src/test-data/javascript/verified
```

The parser must analyse 21 files with 0 extraction errors. What it emits for them
is the finding; see `.agent-coordination/javascript/findings-corpus.jsonl`.
