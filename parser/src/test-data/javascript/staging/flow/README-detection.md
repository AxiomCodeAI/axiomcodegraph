# `flow/` — detection coverage, not language coverage

Flow is **out of scope** as of schema §2.6 (ruled 2026-09-12). The JavaScript
front end does not emit facts for a Flow file; it emits **exactly one
`js_module` row** with `sourceProvenance = FLOW_EXCLUDED` and `hasFlowPragma =
true`, and nothing in any other relation.

So every fixture here tests the **detector**, not the language. The question each
one asks is "was this file seen, identified and declined?" — never "were its
types read correctly?"

## Why every fixture carries a distinctive payload

A detection fixture with an empty body proves nothing: zero rows is the expected
outcome, and an empty file produces zero rows whether the detector fired or not.
Every file below therefore contains at least one **uniquely-named** declaration,
so "did any relation other than `js_module` get a row from this file?" is
answerable by grepping for a name that appears nowhere else in the corpus.

## The three groups

| directory | what it proves |
|---|---|
| `detection/` | the detector **fires**. Each file is Flow and must reduce to one module row |
| `detection-miss/` | the detector **cannot fire** — Flow syntax with no pragma and an ordinary `.js` extension. `declaredTypeSource = SYNTACTIC_FLOW` is the tripwire, and this is the only fixture that can make it fire |
| `false-positive/` | the detector **must not fire**. Plain JavaScript that contains the characters `@flow`. Under the ruling a false positive silently deletes a real file from the fact base, which is the mirror-image error and just as invisible |

## The six files in the parent directory

Written before the ruling, when the assignment was Flow *language* coverage.
All six carry an `@flow` pragma, so all six are kept and repurposed as detection
cases — and they are the **strongest** ones in the set, because their payloads
are large and hostile. What they emitted before exclusion, measured:

| file | if exclusion leaks, this comes back |
|---|---|
| `declare-statements.js` | **13 `js_method` rows with `bodyPresence = NO_BODY`** — type-only declarations in the call graph, gate §7.1 |
| `casts.js` | **4 `js_parse_gap` rows sharing one primary key**, gate §7.2 |
| `recovery-mangling.js` | **63 top-level statements out of ~25 written** — 32 phantom `ExpressionStatement`s and 4 detached `Block`s |
| `silently-typed.js` | 32 annotated positions, **0 diagnostics** — the silent half |
| `flow-annotations.js` | inline annotations, the overlapping and non-overlapping halves |
| `flow-pragma.js` | comment-only Flow (`/*:: */`), which runs unmodified |

That makes them better exclusion tests than anything purpose-built: if the
detector misses one, the failure is loud and lands in a gated relation.
