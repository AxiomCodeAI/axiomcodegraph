# Testing the C# engine

Three instruments. They answer different questions and the differences matter more
than the numbers.

| | what it is | what it proves | cost |
|---|---|---|---|
| `run-tests.sh` | 11 cases, scored against Roslyn | a construct resolves, and its control does not over-resolve | seconds |
| `corpus/run-corpus.sh` | 10 real projects, dev and holdout | the rules generalise beyond what they were written against | ~30 min |
| `runtime-oracle/` | the subject's own test suite, traced | an edge was actually taken, and which taken edge was missed | ~5 min per subject |

## The cases

```
run-tests.sh <work-dir> [--only NN-slug] [--verbose N]
```

| case | what it pins |
|---|---|
| `01-dispatch-and-hiding` | virtual through an abstract base, an inherited-not-overridden target, `new`-hiding, `base.M()`, a sealed receiver, a freshly constructed receiver, a default interface implementation |
| `02-extension-methods` | a `this string` receiver matched by name, a nominal receiver, a generic `this T`, and the control that a `this IEnumerable<T>` parameter is NOT a generic receiver |
| `03-target-typed-new` | `new()` in a field, property, local, return and assignment, with an explicit `new T()` control |
| `04-accessors-and-indexers` | property read and write, qualified and with no receiver at all; a virtual property's fan; the forms that read AND write (`+=`, `++`, `--`) on a property and on an indexer; an event subscription; and the controls that a plain field access, a local, an array index and a unary `-` are not accessor calls |
| `05-partial-and-records` | a positional record's primary constructor, a primary constructor's base invocation written in the heritage clause, and a private member of another part of a partial type |
| `06-explicit-interface-impl` | an explicit interface implementation reached through the interface and not through the class-typed receiver, and the two-interface shape that makes the key collision real |
| `07-dynamic-boundary` | a call and a property read through `dynamic`, from a parameter, a local, a field and a property, with the same member names on a static receiver, a real unstaged framework receiver and a `dynamic` value never called through as controls |
| `08-operators-and-conversions` | `a + b`, `a == b`, `-a` and `(Money)d` on a type that declares them, with built-in operators on the same tokens, the `operator -(Money)` / `operator -(Money, Money)` arity pair, the non-overloadable `&&`/`||`/`??`, and `as` as controls |
| `09-injected-and-inherited-receivers` | a primary constructor's parameter as a receiver and captured by a lambda, a property and a field inherited from a base, a positional record's property, `this object` and an external `this` type reached from a lambda parameter, and a user-defined operator declared on a base -- each with the control that pins what already resolved: a field receiver, a shadowing local, the property on its own class, the extension gate, and a built-in `==` |
| `10-generic-substitution` | a member declared `T` read through `IWrap<Settings>`, through a field, through a local, and through a generic base both passed through (`Repo<T> : Base<T>`) and closed at the declaration (`OrderRepo : Base<Order>`), with the controls that pin what a by-position substitution can get wrong: a two-parameter generic whose arguments must not cross, a `List<T>` member that is not a `T`, a base closed with a DIFFERENT type, a renamed parameter, and a non-generic wrapper that resolved before |
| `11-delegate-fields` | a call through a field holding a delegate -- bare, `this.`, on a receiver, `.Invoke` and `?.Invoke` -- with the function stored by an initializer, `=`, `??=` and `+=` through `?:`, `??` and parentheses. The site's target stays the compiler's (Invoke); what the field holds goes to `dispatch_candidates` with basis `value`, which `tools/delegate-field-value-test.sh` asserts exactly, with the controls: a second field of the same type, a local and a parameter of delegate type, and a field holding a call's RESULT |

### The acceptance bar's own self-test

```
corpus/aggregate-selftest.py [-v]
```

Runs from `run-tests.sh` beside the scorer's, and needs no corpus: its cases are
synthetic `score.json` trees.

`aggregate.py` is the acceptance bar applied mechanically, and it exists because a
human reviewer reliably forgets to ask whether a change fitted the dev set. Six
cases, and **three of them exist only to fail**: a real regression on a fixed
population, a population that grew while agreement fell, and newly visible sites
that are mostly wrong. A bar that stops failing is indistinguishable from one that
passes on everything.

**A fallen agreement RATE is not always a regression.** `in_source_sites` is exactly
`declared_agree + declared_differs + declared_none`, so it counts the in-source sites
the engine SAW. A change that makes a construct visible for the first time enlarges
the denominator, and the rate can fall while every previously scored site keeps its
verdict. That is reported as a WARN with the counts and an instruction to re-score
both runs with the construct excluded from `HELD`, which is the only comparison that
puts the two runs on one population. It is still a WARN, and a WARN still has to be
read.

### The invariants the score cannot see

```
engine-invariants.py <engine-raw> <engine-ir> [--label NAME]
```

Runs per case, from inside `run-tests.sh`.

There are true things about the output the oracle has no opinion about. A call
through `dynamic` is the clearest: Roslyn cannot bind it either, so it writes no
ground-truth row, and coverage, agreement and fan are all blind to whether the engine
answered `ambiguous_dynamic`, `ambiguous_unknown` or `boundary_lib` there. All three
score identically and only one is true.

This is not a blessed golden either. Nothing in it is generated from a run: each
invariant is a written claim with its reasoning, and changing it means arguing with
the reasoning.

| | claim |
|---|---|
| 1 | no external label names something that is not a type (`external:dynamic.M` asserts a type called `dynamic`, and `boundary_lib` is the tier a consumer follows into a staged dependency) |
| 2 | every tier is in the vocabulary `call_chain.dl` declares |
| 3 | a call whose receiver is declared `dynamic` is `ambiguous_dynamic`, not `ambiguous_unknown` (which is where the engine's own blind spots are counted) and not `boundary_lib` (which asserts a target) |
| 4 | no call site reached the output with no row |

`known_builtin_operator` is in the vocabulary because the parser emits a site for
every written operator and explicit cast: whether one is user-defined needs the
operand's type, which is the engine's question and not syntax's. Where no
user-defined operator is found the site ran no user code -- `System.Int32` declares
no `op_Addition`, it is an IL instruction -- so it is counted in its own bucket, on
the same footing as a compiler-synthesised default constructor. Folding it into
`ambiguous_unknown` would put thousands of correct answers into the one number the
engine is judged on.

That bucket gives up the distinction between "built-in operator" and "a declared
operator the engine failed to find". The distinction needs the compiler, and the
harness HAS the compiler: the oracle emits a ground-truth row for every user-defined
operator site, so a failure to resolve one is a missed site or a disagreement in the
score. It is kept in the instrument that can make it.

Invariant 3 is taken from the DECLARATIONS rather than from the parser's call kind:
`DYNAMIC_CALL` is reserved with zero rows, so a check keyed on it would pass
vacuously on a file full of `dynamic`.

### The oracle's own self-test

```
ground-truth/oracle-selftest.py [--oracle <path>] [-v]
```

Runs first of all, from inside `run-tests.sh`, on real C# read by the real oracle.

The scorer's self-test below covers the JOIN, from synthetic ground-truth rows.
Nothing covered the rows themselves, and a shape the oracle emits NO row for is the
one failure everything else here is blind to: it cannot be scored as agreement, it is
not counted as engine-only either, so a correct engine edge and a missing one read
the same. The claim above -- that scoring against the compiler makes "a rule wrong in
the same way as the golden passes forever" impossible -- only holds where the ground
truth asks the question.

It did not, for two whole classes of accessor call (#1170). A compound assignment
yielded its SETTER alone and `++` its GETTER alone, so `b.Computed = 1` and
`b.Computed += 1` held identical ground truth and `04-accessors-and-indexers` scored
100% whichever way the engine answered; a property access written without a receiver
yielded nothing at all. No case could have caught either, because a case is scored
against the very rows that were missing.

**Each case carries its control**: the compound form is asserted beside the simple
one, so a rule that emitted both accessors everywhere would fail; and the shapes that
bind to a property while calling nothing -- `nameof(V)`, a named argument's label, a
property pattern -- are asserted to stay silent.

### The scorer's own self-test

```
ground-truth/score-selftest.py [-v]
```

Runs first, from inside `run-tests.sh`, and needs python3 and nothing else.

Every number in this directory is read through `score.py`, so a defect in its JOIN
moves all of them at once and is indistinguishable from an engine change. Two of its
verdicts are worse than a number: a dropped site and a wrongly resolved external
target each FAIL the run and the corpus aggregate, and a gate that fires on a name
collision cannot guard a real regression.

The cases are synthetic IR and synthetic oracle rows rather than C# source, because
the shapes that break the join are shapes the engine cannot currently produce -- so a
case under `cases/` would go red for the engine's reason and prove nothing about the
scorer. The column headers are the real ones, copied from a real run, so a fixture
cannot drift into a shape the parser never writes.

**Each case carries its control**, same as the cases do: a test that only shows the
bad pairing gone would pass equally well if the join stopped pairing anything, so
every one of them also asserts the legitimate pairing at that position still scores.

**An indexer row never pairs with a property named `Item`.** `get_Item` is the
compiler's name for both an indexer accessor and the getter of a property called
`Item`, and `items[i].Item` anchors both at one column. Name equality alone paired
them and reported the engine as having resolved an external target to an in-source
method, which is a gate rather than a number. The join tests the engine's own
accessor edge kind (`indexer` / `property_read` / `property_write`, column 4 of
`accessor-edges.csv`) rather than the expression kind, because a property read on an
implicit `this` is a NAME_REFERENCE and an expression-kind rule would refuse every
bare property read.

**A file the oracle could not PARSE is not scored.** The oracle is pinned to one
compiler package and one `LanguageVersion` on purpose, and a subject on a newer
language version does not fail against that pin -- Roslyn recovers, and recovery
invents structure. A member-declaration form the pin cannot read closes its
containing class early and the rest of the file is re-read as top-level statements,
whose synthesised container is `Program`, a type the subject does not declare. The
oracle lists those files as `recoveredFile` in its manifest (Roslyn's own parse/bind
split) and `score.py` drops their rows and reports the count. A file that merely did
not BIND is a different population and is still scored: compiling against reference
assemblies only produces unresolved-type errors by design, and the rows it still
produces are sound -- that is what the external bucket is for.

**The golden is the compiler.** Each case is scored against the Roslyn oracle
exactly as a corpus project is, and the bar is 100% on coverage, agreement and fan
soundness with zero dropped and zero wrongly resolved. A blessed `.expected` file
records what the engine did on the day it was blessed, so a rule that is wrong in
the same way as the golden passes forever; this cannot do that, and a case needs no
re-blessing when an unrelated relation changes shape.

**Every case carries its controls in the same file.** A construct that must fan out
sits beside one that must not. That is what makes the suite able to fail an
over-eager rule, which otherwise reads as a recall win.

## The corpus

```
corpus/fetch.sh                                   # clone at pinned commits
corpus/run-corpus.sh <work> --set dev|holdout|all
corpus/aggregate.py <before> <after>              # the diff, with a verdict
```

Ten projects, five and five, defined in a manifest OUTSIDE this repository (see
`corpus/manifest.sh` and `corpus/corpus.tsv.template`) with the split and the
pins in the tree. The holdout set deliberately contains two dominant idioms the dev
set does not have -- one member's operators and conversions, another's expression
trees and `dynamic` -- because a held-out set that only repeats the dev set's shapes
measures nothing.

**The two sets are never summed.** A combined number cannot answer the question a
rule change raises: did it generalise, or did it fit the five projects it was
written against. `aggregate.py` applies that mechanically and FAILS a diff where dev
improves while holdout regresses, WARNS where dev improves and holdout does not
move, and fails outright on a dropped site, a wrongly resolved external target, or a
fan that lost a target it had before.

**Reading a held-out project's failures is how the split is lost.** `run-corpus.sh`
suppresses the per-site listing for holdout unless `AXIOM_CS_HOLDOUT_INSPECT=1` is
set, and prints in the run header when it is. When a held-out project surfaces a
defect class, reproduce the shape SYNTHETICALLY under `cases/` and design the rule
from that.

## The runtime oracle

```
runtime-oracle/trace-subject.sh <corpus-name> <work>
runtime-oracle/join.py <work> <engine-raw> <engine-ir> [--facts out.facts]
```

Mirrors the project, instruments the mirror's library subtree, and runs the
project's **own** test suite. A trace from a workload written while looking at the
engine's output would measure the author.

Only method ENTRY is probed. There is no comma operator in C#, so a per-call-site
marker cannot be put in front of an arbitrary expression without rewriting it, and
rewriting a call whose arguments include `ref`, `out`, a lambda or an
overload-sensitive argument risks changing which overload the compiler selects. An
instrumenter that changes the program is not measuring the program. The caller comes
off a per-thread shadow stack pushed on entry and popped in a `finally`.

The instrumenter RE-PARSES every rewrite before writing it and leaves any file that
does not survive uninstrumented and counted -- two bad rewrites got through before
that check existed, and both surfaced as "no trace produced", which reads as a
harness failure rather than a bad rewrite.

**What a trace is and is not.** It is a lower bound: everything in it happened.
Nothing absent from it is thereby shown not to happen. `NOT_EXECUTED` is labelled NO
INFORMATION and is never scored as an engine error, and `--facts` feeds the engine
edges that may only ADD.

### Which subjects can be traced

The static oracle is pinned to the 8.0 SDK so a parser figure and an engine figure
from this repository stay comparable. Several of these repositories' TEST projects
target net10.0 only, and those cannot be traced on that SDK: `trace-subject.sh`
reports them and skips rather than failing. At the pinned commits, the test projects
that build on net8.0 are three of the ten -- one
holdout among them, which is what makes the runtime numbers more than a dev-set
anecdote.

## Preflight

```
brew install souffle                      # 2.5, pinned in graph/pipeline/engine.conf
npm install && npm run build              # the parser (no lock file is committed)
dotnet build -c Release graph/test/csharp/ground-truth/AxiomCsOracle
dotnet build -c Release graph/test/csharp/runtime-oracle/AxiomCsInstrument
```

`node` must be 18 or newer, and the SAME version across a baseline and a fix run: a
number measured on one version and compared against another is not a measurement.
Every script exits 77 when a tool it needs is missing, so a machine without the
toolchain skips rather than reporting a false failure.
