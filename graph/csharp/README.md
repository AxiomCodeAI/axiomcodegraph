# The C# engine

A type-directed call graph for C#, in the same shape every other front end in this
repository produces: `call_chain_edge(FromExpr, FromMethod, ToExpr, ToMethod, Prov,
EdgeStatus, Kind)`, bundled into `graph.sqlite`.

```
bin/axiomcode all <src-dir> <out-dir> --language csharp
```

## What makes C# different from Java, and where each difference lives

The engine follows the Java engine's layering -- projections, containment,
resolution, expression-resolution, call-edge-generation -- and five language
differences decide most of the rules. Each is worth knowing before reading any
file, because in every case the Java-shaped answer is not merely less precise, it
is wrong.

**Dispatch is opt-in.** A C# method is non-virtual unless it says `virtual`,
`abstract` or `override`, or is an interface member. Java's every-instance-method-
is-virtual assumption, ported, reports `multi_inferred` over most of a C# codebase.
So `known_edge` is the common tier here and a fan has to be justified by a
modifier. `resolution/virtual-dispatch.dl`

**A heritage clause does not say what it is.** `class C : B, I1, I2` -- nothing in
the syntax distinguishes the base class from the interfaces, and `heritageKind` is
`BASE_OR_INTERFACE` for every entry by construction. The split is recovered by
resolving each name and reading the resolved type's own category. Treat a base class
as an interface and every inherited member stops being findable; treat an interface
as a base class and single inheritance is violated, which makes "the nearest base
declaration" that `base.M()` resolves to ill-defined.
`resolution/type-hierarchy.dl`

**Most member access is a call.** `x.Name` invokes `get_Name`, `a[i]` an indexer
accessor, `e += h` an add accessor. The static oracle reports 3,943
property-accessor sites on one corpus member against 3,203 ordinary in-source invocation
sites -- so an engine that reads them as field accesses loses more call sites than it
finds. `resolution/properties.dl`

**An extension method looks like an instance method and is not one.** It is
considered only where instance lookup found nothing applicable, which is the
language's own rule and not an optimisation: a type with its own `Select` must bind
to its own. `resolution/extensions.dl`

**A type is not one row.** `partial class Foo` in three files is one type and three
`cs_type` rows; generics are reified, so `Foo` and `Foo<T>` are two types that share
a name. Member lookup goes through `type_group`, and arity is part of every name
key. `projections/types.dl`

## Two strata, and why

Type inference and dispatch are mutually recursive in C#: a receiver's type may come
from a call's return type, and that call's target depends on its own receiver's type.
The recursion is fine while it stays positive. The exactness test is not -- "fan out
unless the receiver is exact" is a negation -- so the engine is split:

| relation | what it is | who reads it |
|---|---|---|
| `expr_target_any` | positive, recursive: the declared member AND its whole fan | expression typing |
| `expr_resolves_to_method` | narrowed, later stratum: exactness and the cap applied | the edge layer |

The price is stated where it is paid: a receiver typed through a call is typed from
the fan's return types, which can only widen a type set and never narrow it. The
alternative is a program soufflé refuses to stratify.

## The invariant

Every invocation site in the IR appears in the output at least once. A site that
resolved appears with its target; a site that did not appears with `ToMethod = "-"`
and a status saying so. There is no third outcome, and it is enforced structurally:
the unresolved clause keys on whether an edge was **derived**, not on how the site
was classified, so the next filter that removes every target from a site produces a
visible unknown instead of deleting the site. `call_site_dropped` must be zero and
is exported so that it is checked rather than believed.

An UNSTAGED TYPE IS A NAMED BOUNDARY, not a blind spot. On a client-only run the
unresolved column is otherwise dominated by the BCL: before external labelling,
1,562 of one corpus member's 2,235 external sites were counted as engine blind spots.
External targets carry a label (`external:Console.WriteLine`) so the blind-spot
count stays readable.

## Measuring it

Three instruments, in increasing cost:

```
graph/test/csharp/run-tests.sh <work>              # 5 cases, golden = the compiler
graph/test/csharp/corpus/fetch.sh                  # 10 projects at pinned commits
graph/test/csharp/corpus/run-corpus.sh <work> --set all
graph/test/csharp/runtime-oracle/trace-subject.sh <name> <work>
graph/test/csharp/runtime-oracle/join.py <work> <raw> <ir>
```

**The static oracle** (`ground-truth/AxiomCsOracle`) emits a ground-truth call graph from
Roslyn's semantic model, compiled the way the engine runs: the subject's own source
against reference assemblies and nothing else. Every site is labelled `in_source` or
`external` and the two are scored as different questions -- an in-source target must
be RESOLVED, an external one must be LABELLED. An oracle holding the full dependency
closure would resolve calls into packages the engine was never given and report them
as engine misses, which measures the harness.

**The corpus** is ten projects, five designed against and five design-blind, pinned
by commit in `corpus/corpus.tsv`. The two sets are always reported separately: a
combined number cannot answer the only question that matters about a rule change,
which is whether it generalised or fitted the five projects it was written against.
`aggregate.py` applies that bar mechanically and fails a diff where dev improves and
holdout does not.

**The runtime oracle** instruments a mirror and runs the subject's own test suite.
Its buckets refuse to overclaim: `CONFIRMED`, `MISSED` (a recall gap with a
witness), `NARROWABLE`, and `NOT_EXECUTED` -- which is labelled NO INFORMATION and
never scored as an engine error. Reading "709 named, 352 taken" as 50% precision is
the mistake the file is written to prevent.

`resolution/runtime-observed.dl` feeds a trace back into construction under one
rule: **a trace may add an edge, it may never remove one.** A workload is a lower
bound. An engine that narrowed a fan to "what the tests took" would be wrong for
every path the tests miss and would score better on every precision metric while
doing it.

## What it does not do, deliberately

- **A call through `dynamic`** is dispatched at runtime by the DLR. The engine
  resolves it to nothing and labels the site `ambiguous_dynamic`, separately from
  `ambiguous_unknown`, so a known-undecidable site is never counted as a failure.
- **A generic constraint** is not checked when matching an extension method's
  receiver. Filtering on it needs the inferred type argument at the call site, and
  getting it wrong REMOVES a correct edge. Over-approximating a set is the error
  this engine accepts; deleting a true edge is not.
- **An argument-position `new()`** stays unresolved. Its target type is the
  parameter's, and the overload is chosen partly by the argument's type, so the two
  are circular. `implicit_new_untargeted` counts what is left.
- **`type_instantiated` does not filter the fan.** A type is also constructed by
  reflection, by a DI container, by a deserializer and by a source generator, so
  narrowing by observed instantiation is unsound on most real applications. The
  relation is exported for a consumer that wants to take that risk knowingly.
- **The foreach iteration protocol** (`GetEnumerator`/`MoveNext`/`Current`) is not
  emitted, matching the Java engine's treatment of the same triple.
