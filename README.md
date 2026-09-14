# AxiomCode code graph

**A knowledge graph of what code actually does, derived formally rather than guessed.**

`axiom-code-graph` builds a *type-directed call graph*: for every call site in a codebase it resolves
which function (or set of functions) can actually run, by reasoning over the type system — receiver
types, type hierarchy, overload applicability, generics, closure and function-reference targets —
with the platform library and third-party dependencies linked in as typed signatures.

The engine is language-independent: it solves over a relational IR, so support for a language is a
matter of emitting that IR. The first front end is JVM-based, and the validation below uses it
because the platform ships its own class-file parser — which lets ground truth be read from compiled
artifacts with no third-party analyzer in the loop. Additional front ends follow the same contract.

The output is a queryable graph of program structure with provenance on every edge, designed to answer
questions like *"if I change this method, what breaks?"*, *"who can reach this sink?"*, *"what is the
minimum code an agent needs to read to reason about this change?"* — and to be **auditable** when it
answers them.

---

## Why it exists

An AI agent working on a real codebase has to decide what to read. Today that decision is made by
text: grep, fuzzy search, embeddings. Text-similarity retrieval has two failure modes and both are
expensive:

* **It returns too much.** On a 3,200-file project, a grep-style expansion from a changed method
  returns tens of thousands of methods. That is a context window filled with code that has no causal
  relationship to the change — tokens paid for noise, and a model whose attention is diluted.
* **It misses the one that matters.** The method that breaks is often the one that never mentions your
  method's name — it dispatches through an interface, a lambda stored in a field, an inherited
  override. Name matching cannot see those edges. Neither can embeddings.

A call graph fixes both, *if* you can trust it. An untrustworthy call graph is worse than none: a
missing edge is a silent wrong answer, and an over-fanned edge floods the context you were trying to
shrink. So the design goal here is not "produce a graph" — it is **produce a graph whose errors are
known, bounded, and labelled.**

## What it is designed to do

| capability | what it means in practice |
|---|---|
| **Change impact** | From the methods a commit touched, return the transitive callers — the blast radius. Depth-bounded, so you can ask for "definitely affected" or "possibly affected" separately. |
| **Context selection for agents** | Turn "here is the repo" into "here are the 95 methods causally connected to this change". Measured: 95 of 43,793 methods at depth 1 — **99.78% of the codebase eliminated** while still containing **100%** of the true direct callers. |
| **Reachability & security** | Traverse from entry points or toward sinks (path traversal, deserialization, SSRF, …) to decide whether a vulnerable API is actually reachable from untrusted input, instead of flagging every import of a library. |
| **Confidence-tiered answers** | Every edge is labelled: `known_edge` (one resolved target), `multi_inferred` (a sound dispatch set), `boundary_lib` (client → library), `ambiguous_unknown` (an honestly declared blind spot). A consumer picks its own risk tolerance instead of trusting a flat list. |

## What "formal" means here — and what it does not

Being precise about this matters more than the marketing value of the word.

**It is formal in these senses:**

* The graph is the **least fixpoint of a declarative rule set** — ~44 Datalog (Soufflé) rule files over
  a relational IR of the source. There is no model, no heuristic scoring, no sampling. The same input
  yields the same graph, and every edge is traceable to the rules and facts that derived it.
* **Over-approximation is explicit, not accidental.** Where dispatch is genuinely ambiguous the engine
  emits the *sound set* of possible targets (`multi_inferred`) rather than a guess, so downstream
  reasoning can be sound too.
* **Unknowns are declared.** A call site the engine cannot resolve is emitted as `ambiguous_unknown` —
  never dropped. A CI guard asserts that the count of *silently missing* call sites is zero, so
  coverage gaps cannot hide.

**It is not** a proof of program correctness, a termination/safety verifier, or a model checker. It is
formal *reasoning about program structure*, whose conclusions are then **empirically validated against
an independent implementation** — which is the part most call-graph tools skip.

## How it is validated

Claims about a call graph mean nothing without ground truth built by a *different* toolchain. Every
number below comes from one:

| oracle | role |
|---|---|
| the language platform's **own** compiled-artifact parser (for the JVM front end: `java.lang.classfile`, JEP 484) | reference edges read from **compiled artifacts**, not from source. No third-party analyzer. |
| the same parser over application classes, dependency archives and the platform image | independent type hierarchy — used to re-point each edge to its declaring type and to build the dispatch envelope |
| runtime instrumentation | **actually-executed** edges; an executed edge the graph lacks is the strongest possible bug signal |

Scored against two reference sets, because a call graph has two kinds of truth: **must-have** (the
compiled artifact's declared targets) and the **sound envelope** (plus class-hierarchy dispatch). An edge inside the
envelope is a real possibility; only an edge outside it is a defect. Normalization is symmetric and
documented — anonymous types keyed by supertype, closure bodies folded to their enclosing function,
and bridges / `access$N` / enum `values` / string-concat lowering / autoboxing / invokedynamic /
enhanced-for desugaring / synthesized constructors excluded on **both** sides.

### Results

Hand-crafted constructs with known edges — inheritance and virtual dispatch, anonymous types and
single-method interfaces, overload disambiguation with implicit conversion, receiverless calls:

> **precision 1.000 · recall 1.000** on application-internal edges, 0 silently dropped call sites

Change impact on a large open-source database engine (JVM front end — the first one implemented;
other front ends are scored with the same harness): **five consecutive real commits**, 69 changed
methods, seeded at each commit's parent revision; universe 13,398 files / 181,355 methods. Two
bounds, because a call graph has two kinds of truth — **certain** callers (statically resolved
declared targets; a miss is undeniable) and **possible** callers (plus hierarchy dispatch; a result
outside it is a demonstrable false positive).

| depth | approach | precision | recall vs certain | recall vs possible | F1 | MCC |
|---|---|---|---|---|---|---|
| d1 | **axiom-code-graph** | **0.980** | **0.912** | **0.729** | **0.836** | **0.845** |
| d1 | tree-sitter name matching | 0.397 | 0.922 | 0.707 | 0.508 | 0.529 |
| d1 | conservative resolver | 0.772 | 0.863 | 0.662 | 0.713 | 0.714 |
| d2 | **axiom-code-graph** | **0.989** | **0.911** | **0.438** | **0.607** | **0.658** |
| d2 | conservative resolver | 0.646 | 0.693 | 0.308 | 0.418 | 0.446 |
| d2 | tree-sitter name matching | 0.390 | 0.799 | 0.356 | 0.372 | 0.371 |

Two properties matter more than the averages:

- **It never over-estimates.** Seeded one changed method at a time (59 seeds with callers), at any
  depth, on any seed. Exact affected-count on 45/59 seeds at d1, 30/59 at d3 — against 33 and 5 for
  name matching. When it is wrong it is conservative.
- **Its errors are few enough to inspect.** At d2: **2 false positives** against 68 and 224.

Context per change at d1: **9.8 files / 56 K tokens** — 99.3% less than reading the repository, and
1/26 the token spend of an unindexed agent answering the same question.

Raw *accuracy* is meaningless at this class imbalance — returning **nothing** scores 0.998, since
~99.8% of a codebase is unaffected by any given change. Read recall against each bound instead.

**The gap:** at d1, 36 of 133 possible callers are missed — small delegating types that dispatch
through a dependency-declared interface, statics qualified by a type name, and callbacks whose
receiver is a lambda parameter. Restricted to files of 1,000 lines or more, d1 recall is 1.000.

## Run

```bash
npm install && npm run build

# 1. extract a relational IR from source (separate parser package)
node <parser>/dist/index.js <src-dir> <slug> false <IR-dir>

# 2. solve
bash src/pipeline/run-souffle.sh \
     --language java \                        # java | typescript | python
     --client-ir <IR-dir> \
     --library <platform-ir>[,<lib-ir>...] \  # platform library + the project's real dependencies
     --intermediate <scratch> --output <out>
```

**Outputs — the same in every language** ([`src/bundle/SCHEMA.md`](src/bundle/SCHEMA.md))

```
<out>/
  graph.sqlite      the contract: core tables, the language's ext_* relations, and the schema as tables
and only with --debug:
  graph/<table>.csv the core tables as headered, tab-delimited text
  raw/              the per-language Soufflé relations, verbatim — engine-internal, not a contract
```

An agent that opens `graph.sqlite` needs nothing else: `schema_guide` says how to use it in
reading order, `schema_queries` holds tested SQL for the common questions, `schema_vocab` and
`schema_notes` carry the per-language meaning of every value and every caveat.

The core tables are `methods`, `types`, `call_sites`, `call_edges`, `type_ancestors`, `overrides`,
`entry_points`, `entry_reachable`, `unresolved_sites`, `type_instantiated` and `run` — with names,
files and lines already joined in, so a consumer needs nothing but the one file:

```sql
-- who calls Widget.render, and where?
SELECT caller.qualified_name, s.file_path, s.start_line, e.tier
FROM call_edges e JOIN methods callee ON callee.id = e.callee_method_id
                  JOIN methods caller ON caller.id = e.caller_id
                  JOIN call_sites s   ON s.id = e.call_site_id
WHERE callee.qualified_name = 'app.Widget.render';

-- what can `tier` be in THIS bundle's language, and what does each value mean?
SELECT value, meaning FROM schema_vocab
WHERE table_name = 'call_edges' AND column_name = 'tier'
  AND language = (SELECT value FROM run WHERE key = 'language');
```

Where the front ends differ — which values a column can hold, what an id may point at, which
tables a language leaves empty — the difference is recorded in `schema_vocab` and `schema_notes`
inside the database, and in `SCHEMA.md`, generated from the same source (`npm run schema-doc`).
`graph.sqlite` needs Node ≥ 22.5 (`node:sqlite`); on an older Node the CSVs are still written and
the omission is reported.

**Knobs**

* `--library a,b,c` — the platform library plus every real dependency. Libraries are a *type oracle* even
  when you only want first-party edges; omitting them is the single largest source of unresolved
  receivers.
* `--dispatch-cap N|off` (default 20) — how many implementations one virtual call site may fan to.
  **Turn it off for unbounded reachability** (taint / sink traversal), where a target behind a wide
  dispatch would otherwise be dropped.
* `--jdk-depth` (platform-hop cap), `--lib-depth`, `--taint`.

## Layout

```
src/engine/projections/           IR → typed relations
src/engine/containment/           ownership, type nesting
src/engine/resolution/            type resolution, hierarchy, generics, virtual dispatch
src/engine/expression-resolution/ call sites, callee resolution, overloads, lambdas
src/engine/call-edge-generation/  call classes, chain edges, lambda dispatch
src/souffle/                      relation declarations + export manifest
src/pipeline/run-souffle.sh       fact staging, compile cache, stage↔solve loop, then the bundle stage
src/bundle/                       the output contract: schema as data, per-language adapters, CSV + SQLite writers
```

## Known limits

Stated because a graph you can't trust the boundaries of isn't useful:

* **Unstaged dependencies dominate the residual recall gap** — 79.8% of unresolved receivers point at
  libraries that weren't linked in (Guava 44%, slf4j 12%, …). Pass them via `--library`.
* **Generic substitution through library-written type arguments** is incomplete, so a lambda parameter
  typed only through a library generic chain (`map.values().forEach(x -> x.m())`) stays unresolved.
* **Nested types are flattened** by the IR (`pkg.Outer.Inner` → `pkg.Inner`); on cassandra 623 types
  collide, which costs precision on `multi_inferred`.
* **Function values in parameters or collections** are not tracked (fields and locals are).
* **Reflection** is out of scope by construction, and is reported as `ambiguous_unknown` rather than
  silently omitted.
