# Whole-project validation

The 12 fixture cases in `test/python/cases` each isolate ONE construct. These are the
opposite: realistic projects big enough that mechanisms interact, scored against live
CPython ground truth (no frozen lock — the oracle is rebuilt each run).

```bash
node ../../../parser/dist/index.js two-service-fastapi/ p false /tmp/ir
bash ../../../graph/pipeline/run-souffle.sh --language python \
  --client-ir /tmp/ir --library ~/Documents/AxiomCode/python/v3.10.4 \
  --intermediate /tmp/int --output /tmp/out
```

**WHICH NUMBERS BELOW ARE CHECKED.** `run-tests.sh` now runs both projects and diffs a tier
and reason census per project, so the site counts, the tier mix and the unresolved reasons are
guarded. The precision and recall figures come from the CPython oracle, which reads frozen
locks from outside the repository and is skipped when that checkout is absent — they are
recorded measurements, not assertions the suite makes. Anything in this file with a
precision or recall in it should be read that way.

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

Generated and checked, not transcribed: `expected/project-two-service-fastapi.tiers`, diffed
by `run-tests.sh` on every run. It was transcribed once and had drifted — the three corrected
rows are marked, and the numbers are the engine's own per-tier site counts from
`call_chain_summary`.

| | | |
|---|---:|---|
| call sites + decorator applications | **227** | |
| `known_edge` | 124 | *was 123* |
| `multi_inferred` | 23 | |
| `boundary_lib` | 70 | *was 76* |
| `ambiguous_unknown` | **10** | *was 5 — see below* |

Reading the tier table off `call-chain-edges.csv` gives larger figures for one row and it is
not a discrepancy: that file holds one row per TARGET, so the 23 `multi_inferred` sites are 61
rows. The artifact prints both and reconciles them.

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

The declared unknowns are **10**, in two groups of five, and this section previously named
only the first group:

* **5 `decorator_factory_result_untyped`** — the four FastAPI route decorators and
  `@functools.wraps`, applications whose applied callable is library-internal. That is the
  correct answer, and it is what the reason says.
* **5 `unmodelled_decorator`** — bare `@abstractmethod` on `shared/models.py:24`,
  `shared/protocols.py:30` and `:34`, `shared/serialization.py:26`, `shared/transport.py:20`.
  Also correct: `abstractmethod` is a library callable, so the decorator application has no
  target in any staged IR. It was simply never counted here.

Both groups are now in the pinned artifact, so the split cannot go back to being prose.

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

---

## `name-collision` — 10 files, ~290 lines

One method name, **18 definitions**, four unrelated hierarchies. Built to answer a single
question: does the engine link by NAME, or by type?

```
geometry/shapes.py    Shape, Planar, Spatial, Hybrid(Planar, Spatial), Flat   -- a DIAMOND
transit/modes.py      Bus, Train, Ferry, Bike, Walk        -- five, no shared base at all
metrics/distance.py   Metric, Euclidean, Manhattan, Chebyshev, Scaled,
                      RegisteredEuclidean                  -- a base + a two-arg signature
legacy/routes.py      OldRoute, LegacyLeg                  -- present only to widen the fan
journey.py            Movable(Protocol)                    -- structural, declares nothing
```

`get_distance` is spelled at **25 call sites**, each with its receiver typed a different
way: construction, annotation, a field from a constructor parameter, a comprehension over
`List[Planar]`, `self` inside a template method, `super()` at three points in the diamond,
a class pulled out of a registry, and two deliberate controls with no static type at all.

### The number

| | |
|---|---:|
| definitions of `get_distance` (with a real body) | 16 |
| naive name-based candidates, summed over 25 sites | **400** |
| candidates the engine emitted | **43** |
| **reduction** | **89.2%** |
| sites where CPython executed a target the engine did not emit | **0** |

`expected/project-name-collision.tiers` pins 91 sites, and `run-tests.sh` diffs it.

Scored against live CPython: conservation **91/91**, recall **1.000 in every group**,
**0 fabricated edges**, and precision **1.000** for `super`, `method_self`, `construction`,
`plain_call` and `decorator_application`. `duck_dispatch` is 0.811 — 7 over-approximations,
all inside the oracle's sound envelope.

### The site that matters most

```python
class Planar(Shape):
    def get_distance(self):
        return 2.0 + super().get_distance()     # geometry/shapes.py:27
```

MRO(Hybrid) is `Hybrid, Planar, Spatial, Shape`, so this one line reaches
**`Spatial.get_distance` when self is a Hybrid** and `Shape.get_distance` when self is a
plain Planar. Both execute. The engine emits exactly those two, as `multi_inferred`.

A "super() means my base class" rule answers `Shape` alone and misses `Spatial` — a class
that is not a base of Planar and appears nowhere in its bases. A name-based rule answers
all 16. The engine answers 2, and both are real.

### The controls

```python
def untyped(x):        return x.get_distance()   # no annotation, no flow at the def
def via_protocol(m: Movable): return m.get_distance()
```

`untyped` resolves to **{Ferry, Train}** — not 16, and not "unknown" either: those are
exactly the two argument types any caller passes, which is argument→parameter flow doing
the narrowing. `via_protocol` resolves to `Bus` the same way; the Protocol itself
contributes nothing, because a structural type has no hierarchy to search and its own
`get_distance` is a `...` stub that can never be a call target.

### Reproducing the fan number

```bash
AXIOM_PY_ORACLE=~/Documents/AxiomCode/callchain-oracle/python \
  python3.10 test/python/tools/fan_report.py \
    test/python/projects/name-collision /tmp/ir /tmp/out/raw get_distance
```
