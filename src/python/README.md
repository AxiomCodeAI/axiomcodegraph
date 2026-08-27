# Python rule set — layer order and the decisions that shape it

Run it:

```bash
bash src/pipeline/run-souffle.sh --language python \
  --client-ir <ir> --library ~/Documents/AxiomCode/python/v3.10.4 \
  --intermediate <scratch> --output <out>
```

Regression suite: `test/python/run-tests.sh` (12 cases, CPython-built ground truth).
Fast local guard before a compile: `python3 test/python/tools/check_arity.py`.

## Layers, in dependency order

| directory | role |
|---|---|
| `engine/projections/` | IR → named column views. **No joins, no closures.** One raw base relation per rule body, leading provenance tag `"client"` / `"lib"`. |
| `engine/containment/` | ownership (expression → method → type), the LEXICAL SCOPE CHAIN, closure nesting |
| `engine/resolution/` | name resolution, type hierarchy, **C3/MRO**, attribute lookup, value flow, decorators, dispatch, builtins, library linking |
| `engine/expression-resolution/` | call-site decomposition, expression typing, callee resolution per receiver shape |
| `engine/call-edge-generation/` | the four tiers, conservation, the export |
| `engine/export/` | **documentation only, never compiled.** `souffle/export_manifest.tsv` is the sole source of `.output`. |

`souffle/decls_base.dl` is **GENERATED** by `Parser/src/schema/python/gen_decls.py` from the
frozen fact schema. Never hand-write a `py_*` decl. Derived relations go in
`souffle/decls_all.dl`.

## The five decisions worth knowing before reading any rule

**1. `resolvedCalleeHash` is run-local, so the engine derives its own answer.**
The parser pre-resolves 39 of 49 sites on `linkage-sample`, and every one of those hashes
resolves only inside that parse — the library IR was parsed separately, so its hashes cannot
match by construction. The engine therefore composes four *structural* links instead
(`declaringBindingLinkHash` on a def and on a class, `bindingLinkHash` on an import and on an
expression) plus an explicit LEGB walk. The parser's answers are projected as
`call_pre_resolved` / `binding_pre_target` and **compared** rather than consumed, so
agreement is a measured number: 0 disagreements, 2 sites the engine resolves that the parser
could not, 0 the other way.

**2. MRO is ordered, and C3 is computed as a partial order rather than a merge.**
The textbook merge needs negation inside a recursive SCC, which soufflé cannot stratify. So
`resolution/mro.dl` derives the partial order C3 *linearises* — inheritance plus local
precedence from `py_type_base.position`, transitively closed, global by C3's own monotonicity
property — and takes the prec-**minimal** definer. Sound (C3 is always a linear extension), and
exact wherever the minimal definer is unique. `mro_tie` counts where it is not; that is the
only place this engine is less precise than real C3, and it is 0 on every fixture.

**3. `multi_inferred` has exactly three sources, each with a stated argument.**
Self-dispatch over *constructed* subclasses (a language guarantee plus RTA); a multi-write
attribute's write union; two incomparable MRO definers. Nothing else widens a site. An
untyped receiver produces **nothing** — fanning to every same-named method is 24.63 candidates
per site on the measured corpus and has no soundness argument. `ambiguous_unknown` carries a
reason string instead.

**4. Argument→parameter flow is the primary mechanism, not declared types.**
68.2% of Python parameters carry no annotation. `resolution/value-flow.dl` therefore tracks
two kinds of value with equal weight — instances and **callables** — because a `def`
returning a `def` is what a decorator is, a function on an attribute is not a bound method,
and closures are first-class. The closed-world assumption this rests on is recorded per
parameter (`param_flow_assumes_closed_world`), not left implicit.

**5. Some edges are not sites, and some sites are not edges.**
A property read and a metaclass class-creation are real method→method edges that CPython's
compiler emits no `CALL` for, so they enter the graph and **not** the conserved site
universe. Conversely a parenthesised decorator is **two** calls — the factory and the
application of its result — so it contributes two sites. Getting that wrong is what
`test/python/tools/coverage_guard.py` and `ci-conservation.sh` exist to catch.

## Deviations from the Java rule set that are deliberate

* **`overload.dl` is not ported.** Python has no overloading; one name per class body wins.
  The only overload-shaped thing is `@overload`, whose stubs carry `bodyIsStub=true` and are
  gated out of every lookup.
* **There is no `OBJECT_CREATION` expression kind.** Construction is a conclusion the engine
  reaches by resolving a callee to a `py_type`, not a column it can read.
* **`super()` is an MRO slice, not virtual dispatch.** The anchor is a position in an order,
  which a reachable-ancestor set cannot express.
* **Java's lib-boundary shadowing gate is not ported.** MRO prec-minimality already selects
  the single winner, upstream, and on an order rather than a subtype test.
* **Closures and nested functions are call targets**, and `method_top_level` exists because
  `pyTypeLinkHash` is `""` for a nested def too — so "module-level function" needs the second
  half of the test.

## Parser defects

`PARSER-DEFECTS.md` — 10 filed, each with a construct, a minimal repro, the insufficient
column and the edge it costs. Four of them (empty `pyExpressionLinkHash` on `py_field` and on
both `py_type_base` and `py_type_reference`, and the absent `ASSIGNMENT` node) are the reason
several rules derive structurally what a documented FK was supposed to hand over.
