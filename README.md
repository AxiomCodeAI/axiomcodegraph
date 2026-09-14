<h1 align="center">AxiomCode Code Graph</h1>

<p align="center">
  <strong>Know exactly which code calls which — through interfaces, inheritance and callbacks — so you and your coding agents change software with the blast radius in view.</strong>
</p>

<p align="center">
  <a href="#what-it-does">What it does</a> ·
  <a href="#language-support">Language support</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#accuracy">Accuracy</a> ·
  <a href="#repository-layout">Layout</a> ·
  <a href="#status">Status</a> ·
  <a href="#development">Development</a>
</p>

---

## What it does

Point it at a repository and it builds a **call graph**: a map of which function calls which, across the whole codebase. Unlike a text search, it knows about types — so when `shape.area()` could run `Circle.area` or `Square.area`, the graph says *both*, and when a call goes through an interface, an inherited override, or a function stored in a variable, the graph still finds the target. From that map it answers the questions that matter when code changes: **what does this change affect, who can reach this, and what do I need to read** — with a confidence label on every answer.

**Why coding agents need it.** An AI agent working on a real codebase has to decide what to read. Text search returns too much (thousands of unrelated methods that happen to share a name) and misses what matters (the caller that never mentions the name because it dispatches through an interface). Both cost tokens and both cause wrong answers. With the graph, an agent asks *"what does this change affect?"* and gets the causally connected methods — measured on a large project: **95 of 43,793 methods, with 100 % of the true direct callers included** — instead of reading the repository.

**Why you can trust it.** Three properties, each checked rather than promised:

- **Exact and repeatable.** The graph is computed by a fixed set of logical rules, not a model or a heuristic score. The same code produces the *identical* graph every time, and every edge can be traced back to the rule and the facts that produced it.
- **Validated against the compiler.** Results are scored against ground truth from the language's own toolchain — the JDK's class-file parser over compiled bytecode, the TypeScript compiler, CPython's bytecode and tracing — never against another third-party analyzer. On hand-crafted constructs: precision 1.000, recall 1.000.
- **Honest about what it doesn't know.** Every edge carries a confidence tier, and a call the engine cannot resolve is kept as a row that says so — never silently dropped. A test asserts the number of silently missing call sites is zero.

## Language support

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/java/java-original.svg" width="46" height="46" alt="Java" title="Java — stable"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg" width="46" height="46" alt="TypeScript" title="TypeScript — stable"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg" width="46" height="46" alt="Python" title="Python — stable"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/javascript/javascript-original.svg" width="46" height="46" alt="JavaScript" title="JavaScript — engine in progress"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/csharp/csharp-original.svg" width="46" height="46" alt="C#" title="C# — planned"/>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/xml/xml-original.svg" width="34" height="34" alt="XML" title="XML — Spring beans, web.xml, pom.xml"/>
  &nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/yaml/yaml-original.svg" width="34" height="34" alt="YAML" title="YAML — application configuration"/>
  &nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/gradle/gradle-original.svg" width="34" height="34" alt="Gradle" title="Gradle — build graph and dependencies"/>
</p>

Two stages, two columns: the **parser** turns source into the relational IR; the **engine** turns the IR into the graph. A language is usable end to end when both are there.

| language | parser | engine | maturity | validated against |
|---|---|---|---|---|
| **Java** | stable | stable | **stable** — first front end; hand-crafted constructs (P/R 1.000) and five real commits of a large open-source project scored against bytecode; Spring/DI configuration wiring resolved | the JDK's own class-file parser over compiled artifacts; runtime tracing |
| **TypeScript** | stable | stable | **stable** — 53 regression cases and real projects; structural typing, overload sets, module graph, `.d.ts` libraries | the TypeScript compiler's own resolution |
| **Python** | stable | stable | **stable** — MRO, decorators, protocols, dynamic-attribute detection; 600-site torture suite | CPython bytecode and `sys.settrace` |
| **JavaScript** | stable | in progress | **in progress** — the parser (binder, JSDoc as the type channel, CommonJS + ESM) is complete; the engine is under review | — |
| **C#** | planned | planned | **planned** | — |

Configuration and build files are part of the graph too — a change to a bean definition, a property key or a dependency version has a blast radius into methods, and the Java engine resolves it:

| format | parser | engine (Java wiring) | what it contributes |
|---|---|---|---|
| **XML** — Spring beans, `web.xml`, `pom.xml` | stable | stable | bean definitions and injection points → `di_edge`, `bean_def`; entry points from servlet/handler declarations |
| **`.properties`** | stable | stable | keys and typed value segments → `config_binding`, `config_affects_method` |
| **YAML** — application configuration | beta | stable | the same bindings from YAML documents, anchors and aliases followed |
| **Gradle** — Groovy and Kotlin DSL | beta | — | project graph, dependency coordinates and version catalogs, resolved; used for library discovery, not yet for edges |
| **`META-INF/services`** | stable | stable | provider-configuration files → service entry points |

See [`parser/README.md`](parser/README.md) for every relation each format produces.

A repository with several languages is one command: the parser emits every language it finds, and each gets its own graph. Graphs are per language — a Java→TypeScript call is not an edge in either.

## Quick start

```bash
git clone https://github.com/AxiomCodeAI/axiom-code-graph.git && cd axiom-code-graph
npm install                                   # builds the parser and the engine

bin/axiomcode <your-project> ./out            # source tree in → ./out/<lang>/graph.sqlite per language found
```

Then ask questions:

```sql
-- who calls this method, from where, and how sure are we?
sqlite3 out/java/graph.sqlite ".parameter set :qualified_name 'app.Widget.render'" \
  "$(sqlite3 out/java/graph.sqlite "SELECT sql FROM schema_queries WHERE name='callers_of'")"
```

```
caller                    file_path                     start_line  tier        kind
InheritanceOverride.main  src/InheritanceOverride.java  40          known_edge  method
```

Requirements: **Node ≥ 22.5** and a POSIX shell (Git Bash on Windows). Until the prebuilt engine packages are published ([#478](https://github.com/AxiomCodeAI/axiom-code-graph/pull/478)), the first solve per language also needs [Soufflé](https://souffle-lang.github.io) 2.5 and a C++ compiler to compile the engine once; after that, `npm install` fetches it prebuilt and neither is needed.

<details>
<summary>All options</summary>

```
bin/axiomcode <src-dir> <out-dir> [options]
  --library <path>[,…]   the platform library and real dependencies — source trees (parsed for you) or IR roots.
                         Libraries are the type oracle: without them, calls into dependencies are declared unknown.
  --language L           restrict to one language (java | typescript | python)
  --version V            stamp the IR with a version (default: the source's git commit, else v1.0.0)
  --exclude-tests        leave test code out (default: included)
  --debug                also write csv/*.csv and keep raw/ next to each graph.sqlite
  --dispatch-cap N|off   fan-width cap on virtual dispatch (default 20; off for unbounded reachability)

bin/axiomcode parser <src-dir> <ir-dir>                                # the stages separately
bin/axiomcode engine --language L --client-ir <ir-dir>/<lang> --out <dir>
bin/axiomcode test [java|typescript|python|parser|all]
```
</details>

## What you get

One SQLite database per language, **same schema for every language**, with names, files and lines already joined — no IR, no source, no rule files needed to read it:

| table | holds |
|---|---|
| `call_edges` | the graph: one row per (call site, possible target) with `tier`, provenance and call kind |
| `methods` · `types` · `call_sites` | every callable, type and call site with qualified name, file and line |
| `type_ancestors` · `overrides` | hierarchy and virtual-dispatch pairs |
| `entry_points` · `entry_reachable` | what the runtime invokes, and what it reaches |
| `unresolved_sites` | the declared blind spots, attributed to the method that contains them |
| `schema_guide` · `schema_queries` · `schema_vocab` · `schema_notes` | **the documentation, inside the database**: how to use it, tested canonical queries, every enum value per language with its meaning, per-language caveats |

Every edge has a tier, so a consumer picks its own risk tolerance:

| tier | meaning |
|---|---|
| `known_edge` | exactly one resolved target |
| `multi_inferred` | a *sound set* of possible targets (virtual dispatch over instantiated subtypes) |
| `boundary_lib` | the target is in a library — named, not expanded |
| `ambiguous_unknown` | the engine could not resolve the site; kept as a row with a NULL target |

Full schema: [`graph/bundle/SCHEMA.md`](graph/bundle/SCHEMA.md).

## How it works

```
 source tree ──▶  parser  ──▶  relational IR  ──▶  engine (Datalog, per language)  ──▶  graph.sqlite
                 parser/         csv tables         graph/<lang>/engine/*.dl              + schema inside
                                                    compiled once per platform, shipped prebuilt
```

1. **Parse.** The parser extracts a relational IR — types, methods, expressions, call sites, imports — for every language present, in one pass.
2. **Solve.** Each language's rule set (~40 Soufflé Datalog files) applies the rules until nothing new can be derived: type resolution, hierarchy, generics, overload applicability, virtual dispatch, closure and function-value flow. No model, no scoring, no sampling — the same input yields the same graph.
3. **Bundle.** The raw relations are joined to the IR and written as `graph.sqlite`, with the schema, vocabularies and canonical queries as tables.

The rules compile to one self-contained executable per language and platform. CI builds them (Linux x64/arm64, macOS arm64, Windows x64) and publishes them on npm as `@axiomcode/engine-<os>-<cpu>`, which `npm install` selects by platform ([#478](https://github.com/AxiomCodeAI/axiom-code-graph/pull/478)). With Soufflé installed, the engine compiles locally instead; a checkout whose rules differ from the published engine never runs a stale binary.

### What "formal" means here

- The graph is the least fixpoint of a declarative rule set over a relational IR — deterministic and auditable.
- **Over-approximation is explicit.** Genuinely ambiguous dispatch yields the sound set (`multi_inferred`), not a guess.
- **Unknowns are declared.** An unresolvable call site is emitted as `ambiguous_unknown`; a CI guard asserts that the count of silently missing call sites is zero.

It is *not* a proof of program correctness or a model checker. It is formal reasoning about program structure whose conclusions are then **validated against an independent implementation** — the part most call-graph tools skip.

## Accuracy

Every number below is scored against ground truth built by a **different toolchain** — the language platform's own compiled-artifact parser and runtime instrumentation, never a third-party analyzer.

**Hand-crafted constructs** (inheritance and virtual dispatch, anonymous types and single-method interfaces, overload disambiguation with implicit conversion, receiverless calls): **precision 1.000 · recall 1.000** on application-internal edges, 0 silently dropped call sites.

**Change impact on a large open-source database engine** (JVM front end): five consecutive real commits, 69 changed methods, universe of 13,398 files / 181,355 methods. Two bounds, because a call graph has two kinds of truth — *certain* callers (statically resolved declared targets) and *possible* callers (plus hierarchy dispatch):

| depth | approach | precision | recall vs certain | recall vs possible | F1 | MCC |
|---|---|---|---|---|---|---|
| d1 | **AxiomCode** | **0.980** | **0.912** | **0.729** | **0.836** | **0.845** |
| d1 | tree-sitter name matching | 0.397 | 0.922 | 0.707 | 0.508 | 0.529 |
| d1 | conservative resolver | 0.772 | 0.863 | 0.662 | 0.713 | 0.714 |
| d2 | **AxiomCode** | **0.989** | **0.911** | **0.438** | **0.607** | **0.658** |
| d2 | conservative resolver | 0.646 | 0.693 | 0.308 | 0.418 | 0.446 |
| d2 | tree-sitter name matching | 0.390 | 0.799 | 0.356 | 0.372 | 0.371 |

- **It never over-estimates.** Seeded one changed method at a time (59 seeds), exact affected-count on 45/59 seeds at d1 and 30/59 at d3 — against 33 and 5 for name matching. When it is wrong it is conservative.
- **Its errors are few enough to inspect.** At d2: **2 false positives**, against 68 and 224.
- **Context per change at d1: 9.8 files / 56 K tokens** — 99.3 % less than reading the repository, and 1/26 the token spend of an unindexed agent answering the same question. At d1, 95 of 43,793 methods: **99.78 % of the codebase eliminated while retaining 100 % of true direct callers.**

Raw accuracy is meaningless at this class imbalance (returning nothing scores 0.998); read recall against each bound. The residual d1 gap — 36 of 133 possible callers — is small delegating types dispatching through a dependency-declared interface, statics qualified by a type name, and callbacks whose receiver is a lambda parameter; restricted to files of 1,000+ lines, d1 recall is 1.000.

## Repository layout

```
bin/axiomcode                 the command: parser | engine | all | test
parser/                       the IR extractor (Java, TypeScript, Python, JavaScript)
graph/
  <lang>/engine/              the rules: projections → containment → resolution → expression resolution → call edges
  <lang>/souffle/             relation declarations and the export manifest
  pipeline/run-souffle.sh     fact staging, engine resolution (npm package / local compile), stage↔solve loop, bundle stage
  bundle/                     the output contract: schema as data, SCHEMA.md, per-language adapters, writers
  test/<lang>/                regression suites, torture harnesses, oracles
packaging/                    the @axiomcode/engine-<os>-<cpu> package template CI publishes
.github/workflows/            engine builds and the npm publish
```

## Status

<p>
  <a href="https://github.com/AxiomCodeAI/axiom-code-graph/actions/workflows/ci.yml"><img alt="Build" src="https://github.com/AxiomCodeAI/axiom-code-graph/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/AxiomCodeAI/axiom-code-graph/actions/workflows/publish-npm.yml"><img alt="Engines" src="https://github.com/AxiomCodeAI/axiom-code-graph/actions/workflows/publish-npm.yml/badge.svg"></a>
  <a href="LICENSE.md"><img alt="License: FSL-1.1-Apache-2.0" src="https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue"></a>
  <img alt="Node ≥ 22.5" src="https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen">
</p>

Build: the three regression suites and the parser's suites, on every merge to `main`. Engines: the last run of the engine build and npm publish. (Workflow badges render once the repository is public; GitHub serves README images anonymously.)

## Development

```bash
npm install && npm run build            # parser + engine
bin/axiomcode test java                 # regression suite; --oracle scores against javac/javap ground truth
bin/axiomcode test typescript           # --oracle scores against the TypeScript compiler
bin/axiomcode test python               # --oracle scores against CPython bytecode and tracing
bin/axiomcode test parser               # the parser's own suites
bin/axiomcode test                      # everything
```

Each suite parses its fixture cases with the parser in this repository, solves them, guards that no call site was dropped, and diffs the normalised edges against a golden. `--keep` retains per-case work directories (`graph/test/<lang>/.work/<case>/out/graph.sqlite` is a real bundle to poke at); `--bless` regenerates goldens — review the diff. Torture harnesses under `graph/test/<lang>/torture/` score real projects against their oracles.

Editing rules requires [Soufflé](https://souffle-lang.github.io) 2.5 locally (`brew install souffle`; the pinned version is in `graph/pipeline/engine.conf`); the engine recompiles on the first solve after a rule change. Publishing engines: *Actions → publish-npm → Run workflow* (dry run by default) or push a `v*` tag.

## Known limits

- **Unlinked dependencies dominate the residual recall gap** — most unresolved receivers point at libraries that were not passed via `--library`.
- Generic substitution through library-written type arguments is incomplete, so a lambda parameter typed only through a library generic chain stays unresolved.
- Nested types are flattened by the IR (`pkg.Outer.Inner` → `pkg.Inner`), which costs precision on `multi_inferred` where names collide.
- Function values in parameters or collections are not tracked (fields and locals are).
- Reflection is out of scope by construction and is reported as `ambiguous_unknown`, never silently omitted.

## License

[Functional Source License 1.1, Apache 2.0 Future License](LICENSE.md) (FSL-1.1-Apache-2.0) — Copyright 2026, AxiomCode Inc.
