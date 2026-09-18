# `proj-walk-gaps` — one file per expression-walk gap, each with a control

Found by `cs-corpus` in sweep 1, adjudicating 782,388 call sites against
Roslyn's `GetSymbolInfo` over 12,054 files in six strata. Filed in
`.agent-coordination/csharp/findings-corpus.jsonl`.

| file | finding | call sites lost corpus-wide | share of all misses |
|---|---|---|---|
| `ArrayAndCollectionElements.cs` | CS-CORPUS-2 | 15,188 | 24.0% |
| `NamedArgumentValues.cs` | CS-CORPUS-3 | 13,880 | 21.9% |
| `CallOnTheLeftOfAnAssignment.cs` | CS-CORPUS-7 | ~3,400 in the LINQ corpus alone | — |
| `PrimaryConstructorBaseInvocation.cs` | CS-CORPUS-6 | 2,207 | 3.5% |
| `CommentBeforeAPositionalChild.cs` | CS-CORPUS-5 | 1,362 expressions / 80 calls¹ | — |
| `TupleElements.cs` | CS-CORPUS-8 | 268 | 0.4% |
| `IsPatternAsALogicalOperand.cs` | CS-CORPUS-13 | 264 | 6.3%² |
| `TopLevelStatements.cs` | CS-CORPUS-1 | 241 | 0.4% (cover is in `proj-top-level/`) |

¹ measured on the 1,971 the BCL slice files that parse without a gap under
both the original source and a comment-blanked copy.

² share of what remained *unattributed* after sweep 2, not of all misses.

**Six of these eight are fixed** as of `cs-impl@c4ad2dd` — array and collection
elements, named-argument values, tuple elements, top-level statements, and the
comment-before-a-positional-child class. Their files stay as regression cover,
which is what this project is for. `PrimaryConstructorBaseInvocation.cs`,
`CallOnTheLeftOfAnAssignment.cs` and `IsPatternAsALogicalOperand.cs` still
fail.

## Every gap has a control on the same construct

That is the design, not decoration. "The walk is incomplete" and "the construct
does not parse" produce the same empty result, and only a control distinguishes
them. `ArrayAndCollectionElements.cs` is the clearest case: object, collection
and dictionary initialisers and the `= { … }` shorthand all walk **correctly**,
so the finding is not "initialisers are skipped" — it is specifically
`array_creation`, `implicit_array_creation` and `collection_expression`.

`CommentBeforeAPositionalChild.cs` goes further: every gap has its control
**immediately above it**, differing only by the comment. The pair is the
evidence.

`IsPatternAsALogicalOperand.cs` is where a control changed the finding. It was
written claiming that an `is` pattern anywhere in a `&&` swallows its sibling.
The control `if (P("x") && s is not null)` is **1 of 1 — correct** — so the
claim is narrower and sharper: the operand *after* the pattern is lost, which is
a right-hand child read by index. Corpus-wide the split is 259 after to 5
before. Without that one control this would have been filed as a bigger and
wronger thing.

## These files compile

They are not broken source — `proj-parse-gaps/` is where broken source lives.
The parser walks past constructs the compiler accepts, which is why the
`CsFixtureCompiles=true` on this project is load-bearing: if one of these ever
stops compiling, the fixture has drifted and stops proving anything.

## One finding this project produced by accident

`CallOnTheLeftOfAnAssignment.cs` carries `Accessors.ById(instance) += value;`
as a **control** — compound assignment through a ref-returning call, which the
parser handles correctly. Writing it produced a `cs_parse_gap` row, and the
grammar turned out to be the reason:

| source | `hasError` |
|---|---|
| `A.B(x) += v;` | **true** |
| `B(x) += v;` | **true** |
| `A.B(x) -= v;` | **true** |
| `A.B(x) = v;` | false |
| `a[0] += v;` | false |
| `f += v;` | false |
| `A.B(x)++;` | false |

A **compound** assignment whose target is a call is the only one that fails. It
is valid C# — a ref-returning method is a legal assignment target — and it
compiles. **One occurrence in 12,054 corpus files**, so it is not load-bearing,
but it is the same class as the `#pragma`-at-end-of-file defect in
`proj-parse-gaps/`: valid source the vendored grammar refuses, and worth filing
upstream rather than working around.

The control found it. That is the argument for controls in one line.

## What happens when a finding is fixed

The file stops being a demonstration and becomes regression cover. That is the
only reason it is checked in rather than left in a scratchpad.
