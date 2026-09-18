# Testing the C# engine

Three instruments. They answer different questions and the differences matter more
than the numbers.

| | what it is | what it proves | cost |
|---|---|---|---|
| `run-cases.sh` | 5 cases, scored against Roslyn | a construct resolves, and its control does not over-resolve | seconds |
| `corpus/run-corpus.sh` | 10 real projects, dev and holdout | the rules generalise beyond what they were written against | ~30 min |
| `runtime-oracle/` | the subject's own test suite, traced | an edge was actually taken, and which taken edge was missed | ~5 min per subject |

## The cases

```
run-cases.sh <work-dir> [--only NN-slug] [--verbose N]
```

| case | what it pins |
|---|---|
| `01-dispatch-and-hiding` | virtual through an abstract base, an inherited-not-overridden target, `new`-hiding, `base.M()`, a sealed receiver, a freshly constructed receiver, a default interface implementation |
| `02-extension-methods` | a `this string` receiver matched by name, a nominal receiver, a generic `this T`, and the control that a `this IEnumerable<T>` parameter is NOT a generic receiver |
| `03-target-typed-new` | `new()` in a field, property, local, return and assignment, with an explicit `new T()` control |
| `04-accessors-and-indexers` | property read and write, a virtual property's fan, a compound assignment that is both, an indexer, an event subscription, and the control that a plain field access is not a call |
| `05-partial-and-records` | a positional record's primary constructor, a primary constructor's base invocation written in the heritage clause, and a private member of another part of a partial type |

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

Ten projects, five and five, defined in `corpus/corpus.tsv` with the split and the
pins in the tree. The holdout set deliberately contains two dominant idioms the dev
set does not have — NodaTime's operators and conversions, CsvHelper's expression
trees and `dynamic` — because a held-out set that only repeats the dev set's shapes
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
does not survive uninstrumented and counted — two bad rewrites got through before
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
that build on net8.0 are `dapper`, `fluentvalidation` and `csvhelper` — one
holdout among them, which is what makes the runtime numbers more than a dev-set
anecdote.

## Preflight

```
brew install souffle                      # 2.5, pinned in graph/pipeline/engine.conf
npm ci && npm run build                   # the parser
dotnet build -c Release graph/test/csharp/ground-truth/AxiomCsOracle
dotnet build -c Release graph/test/csharp/runtime-oracle/AxiomCsInstrument
```

`node` must be 18 or newer, and the SAME version across a baseline and a fix run: a
number measured on one version and compared against another is not a measurement.
Every script exits 77 when a tool it needs is missing, so a machine without the
toolchain skips rather than reporting a false failure.
