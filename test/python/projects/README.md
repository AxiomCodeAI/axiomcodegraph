# Whole-project validation

The 12 fixture cases in `test/python/cases` each isolate ONE construct. These are the
opposite: realistic projects big enough that mechanisms interact, scored against live
CPython ground truth (no frozen lock — the oracle is rebuilt each run).

```bash
node ../../../../Parser/dist/index.js two-service-fastapi/ p false /tmp/ir
bash ../../../src/pipeline/run-souffle.sh --language python \
  --client-ir /tmp/ir --library ~/Documents/AxiomCode/python/v3.10.4 \
  --intermediate /tmp/int --output /tmp/out
```

## `two-service-fastapi` — 19 files, ~750 lines

Two FastAPI services that talk to each other, on a shared library. Built to stress the
things a single-construct fixture cannot:

* **A C3 diamond under everything.** `Record(Timestamped, Auditable)` over `Entity`, and
  every domain type in both services inherits it. `super().describe()` written in
  `Timestamped` reaches `Auditable.describe` when self is a `Record` — a class that is not
  a base of Timestamped and appears nowhere in its bases. A DFS linearisation answers
  `Entity.describe` and is wrong. The runtime output `REC|TS(...)|BY(SYSTEM)|ORDER:O1`
  is the diamond being walked.
* **Generics that are actually instantiated.** `Repository(Generic[T], ABC)` with
  `ItemStore(Repository[Item])` and `OrderStore(Repository[Order])`. One inherited
  `get_all(...) -> List[T]` has to return Items for one receiver and Orders for the other,
  and `AuditedItemStore(ItemStore)` must inherit the binding without restating it.
  `Serializer(Generic[T])` is the control: `ItemSerializer(Serializer)` never says what T
  is, so `obj: T` stays untyped — correctly.
* **Polymorphism with a real dispatch set.** `unit_price` overridden three times and
  called through the base type; `Transport.send` with three implementations, all
  constructed, one exercised; two clients with the same interface, both constructed and
  both exercised.
* **The cross-service seam, three ways.** Through the Transport hierarchy
  (Recording → InProcess → a registry), straight at the far service's handler object, and
  over HTTP with a fake session. The registry path is the deep one: a dict of BOUND
  METHODS, returned from a method, passed to a constructor, stored on an attribute, and
  indexed by a parameter whose literal arrives two frames up.
* **Decorators of four kinds.** Target-replacing (`@retry(times=2)`), identity
  (`@audited`), a class decorator that registers (`@serializer("item")`), and FastAPI's
  own (`@router.get`) — which is external, so it must come out a declared unknown.
* **Boundaries that must be named, not shrugged at.** `requests`, `fastapi`,
  `functools.wraps`, `list.append`, `dict.get`, `str.upper`.

### Result

| | |
|---|---:|
| call sites + decorator applications | **227** |
| `known_edge` | 123 |
| `multi_inferred` | 23 |
| `boundary_lib` | 76 |
| `ambiguous_unknown` | **5** |

Scored against CPython (`dis` + `symtable` + a live `sys.setprofile` trace of `main.py`):

* **conservation 227/227, 0 silently dropped**
* **recall 1.000 in every scored group** — plain_call, construction, method_self, super,
  duck_dispatch, closure_local, callable_object, decorator_application
* **0 fabricated edges**
* precision 1.000 in five groups; 0.889 super, 0.646 duck_dispatch, 0.593 method_self.
  Every shortfall is inside the oracle's SOUND ENVELOPE — RTA and declared-type widening
  answering for code `main.py` never runs (tier-4 covers 185 of 270 sites).
* all 20 client base classes resolved by the engine's own rules, **0** falling back to the
  parser's `resolvedTypeLinkHash`

The 5 remaining declared unknowns are the four FastAPI route decorators and
`@functools.wraps` — applications whose applied callable is library-internal. That is the
correct answer, and it is what `decorator_factory_result_untyped` says.

### What this project caught that the fixtures did not

* **Annotation typing did not exist.** 107 of 193 parameters here are annotated and every
  cross-service seam is; 27 of the original 68 unknowns were receivers whose type was
  written one line above. `resolution/annotations.dl`.
* **A field written from a constructor parameter was untyped** — the dependency-injection
  shape, 15 more unknowns. `resolution/field-flow.dl`.
* **Iteration had no element type**, so a generator over a `List[LineItem]` attribute lost
  the whole order-total chain. `resolution/iteration.dl`.
* **Generic arguments were never bound to parameters.** `resolution/generics.dl`.
* **Builtin and external receivers read as blind spots** rather than named boundaries.
  `resolution/builtin-types.dl`.
* **A value-callee rule keyed on `receiverKind="NONE"`** missed `TABLE["k"](x)`, which
  reports `receiverKind=SUBSCRIPT` while still putting its callee under `edgeRole=CALLEE`.
  The 08-callables golden caught that one the moment the parser reclassified the site.
* **One live parser defect** (PD-11): a from-import whose member name equals its module's
  last segment resolves to the module.

### Reading the precision numbers honestly

`method_self` 0.593 and `duck_dispatch` 0.646 are not errors. Both are RTA plus
declared-type widening: `self` in a method of `Item` may be any constructed subclass, and
`transport: Transport` may be any constructed implementation. The oracle confirms every
one of those extras is inside its sound envelope. They score as imprecision because
precision is measured against EXECUTED edges and `main.py` exercises 185 of 270 sites —
the FastAPI route handlers and `seed()` are never called. A number that improved by
narrowing those sets would be measuring the fixture, not the engine.
