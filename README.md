<h1 align="center">AxiomCode Code Graph</h1>

<p align="center">
  <strong>A god's-eye view of your codebase for AI agents. Stop grepping; know exactly what every change touches, with nothing hallucinated.</strong>
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/javascript/javascript-original.svg" width="46" height="46" alt="JavaScript" title="JavaScript: engine in beta"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg" width="46" height="46" alt="Python" title="Python: stable"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg" width="46" height="46" alt="TypeScript" title="TypeScript: stable"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/java/java-original.svg" width="46" height="46" alt="Java" title="Java: stable"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/csharp/csharp-original.svg" width="46" height="46" alt="C#" title="C#: engine in beta"/>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/xml/xml-original.svg" width="34" height="34" alt="XML" title="XML: Spring beans, web.xml, pom.xml"/>
  &nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/yaml/yaml-original.svg" width="34" height="34" alt="YAML" title="YAML: application configuration"/>
  &nbsp;&nbsp;
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/gradle/gradle-original.svg" width="34" height="34" alt="Gradle" title="Gradle: build graph and dependencies"/>
</p>

<p align="center">
  <a href="#what-it-does">What it does</a> ·
  <a href="#language-support">Language support</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#accuracy">Accuracy</a> ·
  <a href="#repository-layout">Layout</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://github.com/AxiomCodeAI/axiomcodegraph/actions/workflows/ci.yml"><img alt="Build" src="https://github.com/AxiomCodeAI/axiomcodegraph/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/AxiomCodeAI/axiomcodegraph/pull/478"><img alt="Engines: not yet published" src="https://img.shields.io/badge/engines-not%20yet%20published-lightgrey"></a>
  <a href="https://github.com/AxiomCodeAI/axiomcodegraph/pull/418"><img alt="Nightly: not yet enabled" src="https://img.shields.io/badge/nightly-not%20yet%20enabled-lightgrey"></a>
  <a href="LICENSE.md"><img alt="License: FSL-1.1-Apache-2.0" src="https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue"></a>
  <img alt="Node ≥ 22.5" src="https://img.shields.io/badge/node-%E2%89%A5%2022.5-brightgreen">
</p>

---

## What it does

Give it a repository. It works out, for every function, exactly who calls it and what it calls. Then you or your AI coding agent can ask **"what breaks if I change this?"** and get the real list, not a guess.

Text search cannot do this. It finds names, not calls: it returns thousands of unrelated matches and misses the caller that never says the name because it goes through an interface, a subclass, or a callback. This finds those. Measured on a large project: an agent asked about one change had to read **95 methods out of 43,793**, and every true caller was in that list.

**Why you can trust it**

- **Exact and repeatable.** The graph comes from a fixed set of logical rules, not a model that guesses. The same code gives the identical graph every time, and every edge can be traced back to the rule and the facts that produced it.
- **Checked against the compiler.** Results are scored against ground truth from the language's own tools (the JDK's class-file parser over compiled bytecode, the TypeScript compiler, CPython's bytecode and tracing), never against another third-party analyzer. On hand-crafted test constructs: precision 1.000, recall 1.000.
- **Honest about what it does not know.** Every edge carries a confidence label. A call the engine cannot resolve stays in the graph as a row that says so; it is never silently dropped, and a test asserts that the count of silently missing calls is zero.

## Language support

Two stages, two columns: the **parser** turns source into the relational IR; the **engine** turns the IR into the graph. A language is usable end to end when both are there.

| language | parser | engine | maturity |
|---|---|---|---|
| **JavaScript** | stable | beta | **beta**. The parser (binder, JSDoc as the type channel, CommonJS + ESM) is complete; the engine is merged and being scored against the TypeScript compiler over `allowJs`/`checkJs` |
| **Python** | stable | stable | **stable**. MRO, decorators, protocols, dynamic-attribute detection; 600-site torture suite |
| **TypeScript** | stable | stable | **stable**. 53 regression cases and real projects; structural typing, overload sets, module graph, `.d.ts` libraries |
| **Java** | stable | stable | **stable**. First front end; hand-crafted constructs (P/R 1.000) and five real commits of a large open-source project scored against bytecode; Spring/DI configuration wiring resolved |
| **C#** | stable | beta | **beta**. The parser is complete and the engine is merged, with 10 regression cases, ground truth and a runtime oracle under `graph/test/csharp`; not yet built into the published engine packages |

Configuration and build files are part of the graph too: a change to a property key, a wiring
declaration or a dependency version has a blast radius into methods.

| format | parser | engine |
|---|---|---|
| **XML** | stable | stable |
| **YAML** | beta | stable |
| **`.properties`** | stable | stable |
| **Gradle**: Groovy and Kotlin DSL | beta | not yet |
| **`META-INF/services`** | stable | stable |

Reading a configuration *file* is wired into the Java engine today; the other front ends resolve
configuration written in code (a decorator, a marker in a parameter default) rather than in a file.

See [`parser/README.md`](parser/README.md) for every relation each format produces.

A repository with several languages is one command: the parser emits every language it finds, and each gets its own graph. Graphs are per language: a Java to TypeScript call is not an edge in either.

## Quick start

```bash
npm i -g @axiomcode/code-graph
cd <your-project>
axiomcode path main Store.put          # no setup: the graph is built on first use, then reused
```

```
main → Store.put: 1 of 1 target(s) reached through resolved calls; nearest at 2 hop(s)
  2 call(s):
    main   src/app.py:17
      → [known_edge · call @ src/app.py:19] Service.add   src/app.py:12
      → [known_edge · call @ src/app.py:13] Store.put     src/app.py:4
  verified: every printed hop is an edge in graph.sqlite and a plain BFS finds the same length
  what the hops are:
    [known_edge] resolved to one declaration
```

Each hop carries **the line the call is written on**, **how certain the edge is**, and **what kind of
call it is** — an invocation, a construction, a constructor chain, a `super` call, a decorator, a
property access, a method reference — in one vocabulary that means the same thing in Java, TypeScript,
Python, JavaScript and C#. A hop that is not a call is marked and is not counted as one. Every printed
hop is looked up again in the graph before you see it, and the chain length is re-derived by a second,
independent traversal; the `verified:` line is that check reporting.

### The verbs

| | |
|---|---|
| `axiomcode path <A> <B>` | the chain of calls from A to B, and through what. `'*'` as one end gives the whole closure |
| `axiomcode impact <target>` | what has to be looked at again when a declaration changes — methods, fields, constants, enum members, types, parameters, locals — each labelled with how certain it is |
| `axiomcode test-impact` | which tests actually have to run for this edit, with the chain, so the selection can be checked rather than trusted |
| `axiomcode changed` | which declarations an edit changed, and how (signature, type, body, added, removed) |
| `axiomcode context "<task>"` | where a task's words land, when you have a problem statement and not yet a name |
| `axiomcode graph` | the whole graph as one self-contained HTML page |
| `axiomcode index` | build or rebuild the graph explicitly |

`axiomcode help` lists them; `axiomcode help <verb>` prints one verb's own usage. `--json` gives a
machine-readable answer. None of them need a graph to exist first — the first one you run builds it.

### The pipeline on its own

```bash
axiomcode <your-project> ./out            # source tree in → ./out/<lang>/graph.sqlite per language found
```

`graph.sqlite` is an ordinary SQLite database with its schema documented inside it, so anything that
speaks SQL can read it:

```sql
-- who calls this method, from where, and how sure are we?
sqlite3 out/java/graph.sqlite ".parameter set :qualified_name 'app.Widget.render'" \
  "$(sqlite3 out/java/graph.sqlite "SELECT sql FROM schema_queries WHERE name='callers_of'")"
```

```
caller                    file_path                     start_line  tier        kind
InheritanceOverride.main  src/InheritanceOverride.java  40          known_edge  method
```

From a clone rather than npm:

```bash
git clone https://github.com/AxiomCodeAI/axiomcodegraph.git && cd axiomcodegraph
npm install                                   # builds the parser and the engine
bin/axiomcode path main Store.put <your-project>
```

Requirements: **Node ≥ 22.5** and a POSIX shell (Git Bash on Windows). Until the prebuilt engine packages are published ([#478](https://github.com/AxiomCodeAI/axiomcodegraph/pull/478)), the first solve per language also needs [Soufflé](https://souffle-lang.github.io) 2.5 and a C++ compiler to compile the engine once; after that, `npm install` fetches it prebuilt and neither is needed.

## Using it from Claude Code (the plugin)

The plugin is the query frontend: a skill, an MCP server and hooks. It needs an engine to build graphs
with, and it cannot find one by itself once installed, so the order matters.

```bash
# 1. install the engine, which the plugin then resolves on its own
npm i -g @axiomcode/code-graph
#    ... or from a checkout. parser/dist is NOT in git, so a clone has no parser until the build runs --
#    "parser not built" from bin/axiomcode means this step was skipped.
git clone https://github.com/AxiomCodeAI/axiomcodegraph.git
cd axiomcodegraph && npm install && npm run build
npm i -g .                                    # then nothing else is needed
export AXIOMCODE_ENGINE="$PWD"                # ... or this, per shell

# 2. install the plugin
claude plugin marketplace add AxiomCodeAI/axiomcodegraph
claude plugin install axiomcode@axiomcode
```

Start a new Claude Code session afterwards: plugins are loaded at startup, so a session that was already
running will not see it.

The MCP tools need only `python3`. If the Python MCP SDK is installed (`pip install mcp`), or `uv` is on
PATH to fetch it, the server uses it; otherwise it serves with a built-in implementation of the part of the
protocol it uses, and says so on stderr.

## Using it from other agents

`plugins/axiomcode/` installs into each of these agents from this repository. Every agent in the table gets the
seven MCP tools and the skill. The hooks run in Claude Code, Codex, Gemini CLI and Cursor, each in its own
event and output format. Building a graph needs the engine, as
above: `npm i -g @axiomcode/code-graph`.

| Agent | Install | Reads | Checked |
|---|---|---|---|
| Codex CLI and desktop app | `codex plugin marketplace add AxiomCodeAI/axiomcodegraph` then `codex plugin add axiomcode@axiomcode` | `.codex-plugin/`: skill, server, hooks | installed; server, skill and hook context reached the model |
| Copilot CLI | `copilot plugin marketplace add AxiomCodeAI/axiomcodegraph` then `copilot plugin install axiomcode@axiomcode` | `.claude-plugin/`, `.mcp.json` | installed, server and skill loaded |
| VS Code (Copilot agent mode) | add `"chat.plugins.marketplaces": ["AxiomCodeAI/axiomcodegraph"]` to settings, or install with Copilot CLI, whose plugins VS Code also loads | `.claude-plugin/`, `.mcp.json` | from VS Code's docs |
| Cursor | `cursor-agent plugin marketplace add https://github.com/AxiomCodeAI/axiomcodegraph`, or a team marketplace imported from this repository | `.cursor-plugin/`, `rules/`, hooks | from Cursor's loader |
| Windsurf, Devin CLI | `devin plugins install AxiomCodeAI/axiomcodegraph#plugins/axiomcode` | `.claude-plugin/`, `.mcp.json`, hooks | from Devin's loader |
| Gemini CLI | `gemini extensions install https://github.com/AxiomCodeAI/axiomcodegraph` | `gemini-extension.json`, `skills/`, `hooks/` | installed; server, skill and hook context reached the model |

Codex reads `.codex-plugin/plugin.json`, which names the skill, the server and `hooks/hooks.json`. Codex runs the
hooks with `CLAUDE_PLUGIN_ROOT` set, so the same file serves it; it asks the user to trust them under `/hooks`
first. The plugin has no portable Agent Plugins `plugin.json` on purpose: Codex prefers one to
`.codex-plugin/` and then loads no plugin hooks, as of Codex 0.156.1.

Cursor reads its own `.cursor-plugin/` manifest, which names the server with `${CURSOR_PLUGIN_ROOT}` (it
does not expand `${PLUGIN_ROOT}`), and loads `rules/axiomcode.mdc`, `AGENTS.md` as an always-applied rule. It
converts `hooks/hooks.json` to its own events, except `Glob`, which it has no tool for, and the hooks answer
in Cursor's own output shape. Context after a tool call and with a prompt reaches the model; the directive
before a tool call does not, because Cursor's `preToolUse` carries no context. `python3 tests/hosts.py`
fires each hook as each host and compares what the model receives.

Gemini installs the repository root and reads skills and hooks only there. `hooks/hooks.json` at the root runs
the plugin's hook scripts under Gemini's event and tool names (`BeforeAgent`, `AfterTool`, `read_file`, …), and
`skills/axiomcode/` is a copy of the skill's text. After editing the skill or `AGENTS.md`, run `python3 packaging/copies.py`;
`python3 tests/manifests.py` fails while a copy is stale, and checks that every manifest points at files
that exist. The Codex IDE extension does not load plugins; use the MCP config below there.

Agents with no plugin install take the server from their MCP config (next section) and the skill from a
skills directory:

- **OpenCode:** in `opencode.json`, `"mcp": {"axiomcode": {"type": "local", "command": ["axiomcode", "mcp"]}}`.
  It reads skills from `~/.agents/skills/` and `~/.claude/skills/`.
- **Amp:** `amp mcp add axiomcode -- axiomcode mcp`, and
  `amp skill add --global AxiomCodeAI/axiomcodegraph/plugins/axiomcode/skills/axiomcode` for the skill.
- **Cline, Antigravity:** the JSON below, in Cline's MCP settings or Antigravity's `mcp_config.json`.

### Any MCP client

The package serves the same seven tools the plugin does, so any agent that speaks MCP can use them
with one entry in its MCP config and no plugin install:

```json
{
  "mcpServers": {
    "axiomcode": { "command": "npx", "args": ["-y", "@axiomcode/code-graph", "mcp"] }
  }
}
```

After `npm i -g @axiomcode/code-graph` the command is `axiomcode` with `["mcp"]`, which also skips npx's
start-up on every session. From a checkout, point `command` at `<checkout>/bin/axiomcode`.
`python3 tests/mcp.py` checks the server answers from each of these.

Querying an existing graph needs no engine at all; only `axiomcode index` does.

<details>
<summary>All options</summary>

```
bin/axiomcode <src-dir> <out-dir> [options]
  --library <path>[,…]   the platform library and real dependencies: source trees (parsed for you) or IR roots.
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

One SQLite database per language, **same schema for every language**, with names, files and lines already joined. No IR, no source and no rule files are needed to read it:

| table | holds |
|---|---|
| `call_edges` | the graph: one row per (call site, possible target) with `tier`, provenance and call kind |
| `methods` · `types` · `call_sites` | every callable, type and call site with qualified name, file and line |
| `field_access` · `fields` | who reads or writes each field: one row per (access site, resolved field) with `access` (read / write / readwrite) and the same `tier`. Java and TypeScript; declared and empty elsewhere |
| `type_use` | every place a type is NAMED, with the `context` it was written in (FIELD_TYPE, METHOD_PARAM, OBJECT_CREATION_TYPE, SUPER_TYPE …) and the `depth` that separates a type from its type arguments. Java and TypeScript |
| `type_ancestors` · `overrides` | hierarchy and virtual-dispatch pairs |
| `entry_points` · `entry_reachable` | what the runtime invokes, and what it reaches |
| `unresolved_sites` | the declared blind spots, attributed to the method that contains them |
| `schema_guide` · `schema_queries` · `schema_vocab` · `schema_notes` | **the documentation, inside the database**: how to use it, tested canonical queries, every enum value per language with its meaning, per-language caveats |

Every edge has a tier, so a consumer picks its own risk tolerance:

| tier | meaning |
|---|---|
| `known_edge` | exactly one resolved target |
| `multi_inferred` | a *sound set* of possible targets (virtual dispatch over instantiated subtypes) |
| `boundary_lib` | the target is in a library: named, not expanded |
| `ambiguous_unknown` | the engine could not resolve the site; kept as a row with a NULL target |

Full schema: [`graph/bundle/SCHEMA.md`](graph/bundle/SCHEMA.md).

## How it works

```
 source tree ──▶  parser  ──▶  relational IR  ──▶  engine (Datalog, per language)  ──▶  graph.sqlite
                 parser/         csv tables         graph/<lang>/engine/*.dl              + schema inside
                                                    compiled once per platform, shipped prebuilt
```

1. **Parse.** The parser extracts a relational IR (types, methods, expressions, call sites, imports) for every language present, in one pass.
2. **Solve.** Each language's rule set (~40 Soufflé Datalog files) applies the rules until nothing new can be derived: type resolution, hierarchy, generics, overload applicability, virtual dispatch, closure and function-value flow. No model, no scoring, no sampling: the same input yields the same graph.
3. **Bundle.** The raw relations are joined to the IR and written as `graph.sqlite`, with the schema, vocabularies and canonical queries as tables.

The rules compile to one self-contained executable per language and platform. CI builds them (Linux x64/arm64, macOS arm64, Windows x64) and publishes them on npm as `@axiomcode/engine-<os>-<cpu>`, which `npm install` selects by platform ([#478](https://github.com/AxiomCodeAI/axiomcodegraph/pull/478)). With Soufflé installed, the engine compiles locally instead; a checkout whose rules differ from the published engine never runs a stale binary.

### What "formal" means here

- The graph is the least fixpoint of a declarative rule set over a relational IR: deterministic and auditable.
- **Over-approximation is explicit.** Genuinely ambiguous dispatch yields the sound set (`multi_inferred`), not a guess.
- **Unknowns are declared.** An unresolvable call site is emitted as `ambiguous_unknown`; a CI guard asserts that the count of silently missing call sites is zero.

It is *not* a proof of program correctness or a model checker. It is formal reasoning about program structure whose conclusions are then **validated against an independent implementation**, the part most call-graph tools skip.

## Accuracy

Every number below is scored against ground truth built by a **different toolchain**: the language platform's own compiled-artifact parser and runtime instrumentation, never a third-party analyzer.

**Hand-crafted constructs** (inheritance and virtual dispatch, anonymous types and single-method interfaces, overload disambiguation with implicit conversion, receiverless calls): **precision 1.000 · recall 1.000** on application-internal edges, 0 silently dropped call sites.

**Change impact on a large open-source database engine** (JVM front end): five consecutive real commits, 69 changed methods, universe of 13,398 files / 181,355 methods. Two bounds, because a call graph has two kinds of truth: *certain* callers (statically resolved declared targets) and *possible* callers (plus hierarchy dispatch):

| depth | approach | precision | recall vs certain | recall vs possible | F1 | MCC |
|---|---|---|---|---|---|---|
| d1 | **AxiomCode** | **0.980** | **0.912** | **0.729** | **0.836** | **0.845** |
| d1 | tree-sitter name matching | 0.397 | 0.922 | 0.707 | 0.508 | 0.529 |
| d1 | conservative resolver | 0.772 | 0.863 | 0.662 | 0.713 | 0.714 |
| d2 | **AxiomCode** | **0.989** | **0.911** | **0.438** | **0.607** | **0.658** |
| d2 | conservative resolver | 0.646 | 0.693 | 0.308 | 0.418 | 0.446 |
| d2 | tree-sitter name matching | 0.390 | 0.799 | 0.356 | 0.372 | 0.371 |

- **It never over-estimates.** Seeded one changed method at a time (59 seeds), exact affected-count on 45/59 seeds at d1 and 30/59 at d3, against 33 and 5 for name matching. When it is wrong it is conservative.
- **Its errors are few enough to inspect.** At d2: **2 false positives**, against 68 and 224.
- **Context per change at d1: 9.8 files / 56 K tokens**, 99.3 % less than reading the repository, and 1/26 the token spend of an unindexed agent answering the same question. At d1, 95 of 43,793 methods: **99.78 % of the codebase eliminated while retaining 100 % of true direct callers.**

Raw accuracy is meaningless at this class imbalance (returning nothing scores 0.998); read recall against each bound. The residual d1 gap, 36 of 133 possible callers, is small delegating types dispatching through a dependency-declared interface, statics qualified by a type name, and callbacks whose receiver is a lambda parameter; restricted to files of 1,000+ lines, d1 recall is 1.000.

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

## Development

```bash
npm install && npm run build            # parser + engine
bin/axiomcode test java                 # regression suite; --oracle scores against javac/javap ground truth
bin/axiomcode test typescript           # --oracle scores against the TypeScript compiler
bin/axiomcode test python               # --oracle scores against CPython bytecode and tracing
bin/axiomcode test parser               # the parser's own suites
bin/axiomcode test                      # everything
```

Each suite parses its fixture cases with the parser in this repository, solves them, guards that no call site was dropped, and diffs the normalised edges against a golden. `--keep` retains per-case work directories (`graph/test/<lang>/.work/<case>/out/graph.sqlite` is a real bundle to poke at); `--bless` regenerates goldens; review the diff. Torture harnesses under `graph/test/<lang>/torture/` score real projects against their oracles.

Editing rules requires [Soufflé](https://souffle-lang.github.io) 2.5 locally (`brew install souffle`; the pinned version is in `graph/pipeline/engine.conf`); the engine recompiles on the first solve after a rule change. Publishing engines: the CI workflows are not in the tree yet, so the packages are assembled with `packaging/assemble-engine-package.sh` and published by hand for now.

## Known limits

- **Unlinked dependencies dominate the residual recall gap**: most unresolved receivers point at libraries that were not passed via `--library`.
- Generic substitution through library-written type arguments is incomplete, so a lambda parameter typed only through a library generic chain stays unresolved.
- Nested types are flattened by the IR (`pkg.Outer.Inner` → `pkg.Inner`), which costs precision on `multi_inferred` where names collide.
- Function values in parameters or collections are not tracked (fields and locals are).
- Reflection is out of scope by construction and is reported as `ambiguous_unknown`, never silently omitted.

## License

[Functional Source License 1.1, Apache 2.0 Future License](LICENSE.md) (FSL-1.1-Apache-2.0). Copyright 2026, AxiomCode Inc.
