# Java torture

Ten families of construct, in one project, graded against the client's own compiled bytecode.

The cases in `../cases` each pin **one** rule, which is what makes a regression legible. This asks
the other question: given a project that uses everything the language offers at once, how much of
it does the graph actually contain — and **which construct** is the gap. A single percentage cannot
answer the second half, so every file is one family and the score is per family.

```bash
AXIOM_PARSER=/path/to/parser/dist/index.js harness/run.sh
AXIOM_PARSER=... harness/run.sh --bless      # regenerate the goldens, and READ the diff
```

## What it grades against

Ground truth is `tools/ClassFileOracle.java` over the client's compiled classes — the invoke
instructions *are* the answer. The client is compiled **against** the stub library rather than
together with it, so `dep.*` is genuinely external and the client→library hand-off is a boundary.

The platform IR is staged as well as the stub. Staging the stub alone is not a smaller version of
a real run, it is a different question: half these families call `java.util` types, and with the
platform absent those receivers cannot be typed by any rule — every one would score as an engine
gap. That is the fault #163 found in the corpus harness, and it manufactures the same fake backlog.
When no platform IR is available the run says so instead of absorbing it.

## The verdicts

| | meaning |
|---|---|
| `exact` | the oracle's edge is in the graph |
| `precise` | the engine named a **subtype** of the bytecode owner — the method that actually runs. Bytecode records the receiver's *static* type, so `Base b = new Unit(); b.area()` is recorded as `Base#area` while the engine, having flow-typed the variable, answers `Unit#area`. Folding this into `missed` would report the engine as losing an edge at the moment it got sharper. |
| `ancestor` | the engine named a **supertype** — where the method is declared. Also not an error. |
| `MISSED` | nothing of that signature anywhere in the receiver's hierarchy. Bytecode's declared targets are facts, so this is a defect. |
| `wide` | an edge the engine emits and the oracle does not. Where dispatch is genuinely ambiguous the engine emits the sound set, so a superset is expected — reported, never failed, and pinned so it cannot grow unnoticed. |

`f05` is scored on the **config** relations rather than on invoke instructions, because an
annotation is not a call: what it decides is which method is an entry point and which bean
satisfies which injection point, and none of that appears in bytecode.

## The invariant

Staging a library must never **remove** an answer. The same client is solved twice, once with an
empty library, and `tools/compare_runs.py` fails the run if any site lost its last answer. Nothing
else here can catch that, because every other assertion fixes the library input.

## The families

| family | what it puts under load |
|---|---|
| `F01` | deep hierarchy, covariant return (bridge), a diamond of interface defaults, an overload set arity cannot separate |
| `F02` | type-variable substitution through a subclass, a recursive bound, a generic method, a library generic the client parameterises |
| `F03` | `var` from a constructor, a factory, a chain, a collection element, a for-each, a ternary, a cast, a lambda parameter, a resource |
| `F04` | listener list, listener field, a map of lambdas keyed at runtime, a library bus that does the dispatching, a client implementation of a library callback |
| `F05` | custom annotations, a meta-annotation, a repeatable one, a class-valued argument, and an annotation-driven entry point nothing calls |
| `F06` | all four method-reference forms, a lambda in a field, a local, a map and a list, and a call written inside a lambda body |
| `F07` | records and their generated accessors, a sealed hierarchy, pattern switch, record deconstruction, enum constant bodies |
| `F08` | inner, static nested, local and anonymous classes, and unqualified calls resolving outward through two levels |
| `F09` | reflection, `Class.forName`, a dynamic proxy and `ServiceLoader` — out of scope by construction, and asserted to be DECLARED unknown rather than silently dropped |
| `F10` | reassignment, ternary, switch expression, cast, array element, twice-written field, parameter, return value |
