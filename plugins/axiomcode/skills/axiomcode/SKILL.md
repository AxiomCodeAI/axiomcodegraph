---
name: axiomcode
description: Use when a question is about how code connects rather than what it says: who calls this function, what breaks if I change this declaration, where is this really used, which tests does this edit reach, how does A reach B, is this safe to delete. Java, TypeScript, Python, JavaScript. Answers come from a resolved call graph, so it finds callers that never spell the name — through an interface, an override, a callback, dependency injection or a config key — and labels how certain each one is. Prefer it over grep or Glob for callers, callees, references, change impact and test selection.
---

# axiomcode

One command, run from the repository root via Bash: `<this dir>/scripts/axiomcode <subcommand> …`

The same subcommands are MCP tools when this plugin is loaded (`mcp__plugin_axiomcode_axiomcode__axiomcode_path`, `…_impact`,
`…_index`, `…_graph`, from `plugins/axiomcode/.mcp.json` → `mcp/server.py`): typed parameters, the same verified output.
Prefer the MCP tool when it is in your tool list; the CLI is the same code.

When the plugin is loaded, a PostToolUse hook adds the graph's edges to your own Read, Grep, Glob and shell grep/sed/cat
results (`graph: …`) — callers and callees the text you read cannot show, overrides elsewhere, unresolved calls. SQLite
lookups only, ~0.1–0.5 s; nothing is added when the repo has no graph.

```
axiomcode index [<repo>] [--lang <l>] [--src <dir>] [--library <root>,…]   the pipeline: parser → engine → .axiomcode/out/graph.sqlite (+ index)
axiomcode graph [<repo>] [--out <folder | page.html>] [same flags]        the graph as one page; runs the pipeline only when there is no up-to-date graph
axiomcode path <from> <to> [<repo>] [--every|--paths N] [--in <path>]     the shortest chain of calls from A to B per target (--every: all routes) — or why there is none
axiomcode path '*' <X>  ·  path <X> '*'                                   everything that can reach X (with its entry points) · everything X reaches
axiomcode path <word> '*'                                                 no exact name yet? a bare word matches every declaration containing it
axiomcode impact <target>… [<repo>] [--tests] [--depth N] [--in <path>]  what a change to a method / field / type / parameter / type parameter / local reaches, and how sure
axiomcode changed [<repo>] [<file>…] [--range a..b | --staged] [--impact]  which declarations an edit changed and HOW (signature, field type, body …) — then impact on all of them
axiomcode test-impact [<repo>] [--range a..b | --staged] [--json] [--why]  which tests the edit in front of you reaches, and the command that runs them
axiomcode install [<repo>] [--remove]                                     write the preference into the repo's CLAUDE.md as one marked block (states it; blocks nothing)
```

`<repo>` defaults to the current directory.

## Start here

| the question in front of you | the call |
|---|---|
| **`.axiomcode/out/graph.sqlite` already exists** | **use it — do NOT run `index`** (see below) |
| no graph at all | `axiomcode index` |
| "who calls X" / "what breaks if X changes" | `axiomcode impact X` |
| "where is the decryption code" — a concept, no name yet | `axiomcode path decrypt '*'` |
| "how does A reach B" | `axiomcode path A B` |
| "everything that reaches X" | `axiomcode path '*' X` |
| "which tests do I run for this edit" | `axiomcode test-impact` |
| "what did my edit actually touch" | `axiomcode changed --impact` |
| "is it safe to delete X" | `axiomcode impact X --delete` |
| this repo should prefer the graph over grep, once | `axiomcode install` |

**Before anything else: if `.axiomcode/out/graph.sqlite` exists, the graph is built — query it.** Do not run
`index` to "make sure", and do not re-run it after your own edit. A build costs minutes on a large tree, and
`index` with flags that differ from the ones the graph was built with is a cache MISS, not a no-op: it rebuilds
from scratch and the graph you end up with is the one YOUR flags describe. Calling it bare on a repo indexed
with `--library` therefore spends the full build to arrive at a client-only graph — every call into a
dependency `ambiguous_unknown`, resolution understated — which is strictly worse than the graph you destroyed.
Run `index` only when there is no `graph.sqlite`, or when you intend to change what it covers and are passing
the flags to say so.

Four rules that decide whether the answer means anything:

- **Say the language and the tree** when the repo mixes them: `--lang typescript --src src`. Auto-detection counts
  files, so a TypeScript project with many `.js` scripts is otherwise taken for JavaScript.
- **Pass the dependencies.** `--library` (or `AXIOMCODE_LIBRARY`) names the roots the engine may resolve into
  (Java: the JDK and third-party sources/IR). Without them, calls into dependencies are `ambiguous_unknown`
  and the resolution rate is understated; a Java build without roots prints a warning — do not quote its rate.
- `index` prints resolved / unresolved counts; quote that line. An unresolved call is *unknown, not absent* —
  **never report it as "no callers"**.
- Every answer ends with `verified:` (every printed hop looked up again in `graph.sqlite`) and `bound:` (the
  unresolved calls inside the answer, so the set is a lower bound). A `✗` on the verified line means the answer is
  wrong — report it, do not use it.

## How certain is each row

Every row carries a rung. Read the rung before you act on the row; an answer's label is the **worst** rung on its route.

| rung | what it claims |
|---|---|
| `[sound]` / `[resolved]` | an edge the engine resolved — a single-target call chain, an override, a subtype, a constructor |
| `[one of a set]` | one of a sound set of targets (virtual dispatch over instantiated subtypes) |
| `[dispatch]` | an instantiated override reached through its base |
| `[defines]` | a closure reached from the callable that defines it |
| `[at import]` | the module raised while being imported, so the test was never collected |
| `[protocol]` | a protocol / dunder method the interpreter calls |
| `[decorator by name]` | a decorator rebound the name, so callers run the wrapper (engine resolution, not a name match) |
| `[by key]` | both ends joined through a registration **string** — a route, a signal, a CLI command. Not an edge |
| `[fixture]` | a framework injects it before the test body runs |
| `[in scope]` | a reference by that name inside the owner type, a subtype or a nested type |
| `[by name]` | a reference by that name elsewhere — may be a same-named other thing |
| `[text]` | the name found in source where the parser records no line; comments and strings stripped |

`[sound]` and `[one of a set]` are the best rungs on every subject measured. **Below those the printed order is a
tie-break on what kind of evidence a hop is, not a measured ranking** — `[by key]` is the best rung on one subject and
the worst on another. Per-subject hit rates: `reference/impact.md`.

`[sound]` never means the test exercises the change, only that the edges connect. Reaching is not failing.

## impact — what a change to a declaration reaches

```
axiomcode impact Owner.method            # a method
axiomcode impact Owner.field             # a field: its accessors' callers too
axiomcode impact Type                    # a class / interface / enum
axiomcode impact server.error.path       # a configuration key: what the container binds it into
axiomcode impact Owner.method --delete   # + a safe-to-delete verdict
axiomcode impact A.m B.m --tests         # several targets as ONE change set, with the tests
```

Targets are written **as they appear in the code**, and the kind is read from the index, never guessed:
`Owner.method` · `method` · `file.java:123` (a method) · `Owner.field` · `CONSTANT` · `Enum.MEMBER` (a field) ·
`Type` · `Owner.method(param)` (one parameter) · `Type<T>` (a type parameter) · `Owner.method:name` (a local) ·
`Type.<init>` / `Type.<clinit>`. A name declared as more than one kind stops and asks for `--kind`.

The answer is the same shape for every kind and language: **must change with it** (overrides, subtypes) · **produces or
writes it** · **reads or uses it**, grouped by why and by rung · **reaches those** transitively, with entry points ·
`--tests` the tests among them · `verified:` · `bound:`.

Three things nothing else finds, because no call site carries them: a **configuration key** bound by `@Value` /
`@ConfigurationProperties` / a `.yml` key; a **bean the container injects**; and a **handler registered as a value**
(`app.get('/orders/:id', getOrder)`) which has no call site anywhere. A key the engine never saw stops with that
sentence — its impact is unknown, not empty.

Full rules, every target kind, the framework hops and the measured numbers: **`reference/impact.md`**.

## changed · test-impact — from an edit

```
axiomcode changed --impact          # working tree vs the commit the graph was built from
axiomcode changed --staged          # the index
axiomcode changed --range a..b      # two commits
axiomcode test-impact --why         # the tests this edit reaches + the command that runs exactly those
```

`changed` says *how* each declaration changed — `signature` (`zip: String → Integer`), `body`, `field`, `type`,
`removed`, `added` — and each line ends with the target `impact` takes for it. `test-impact` is `changed` +
`impact --tests`, shaped for a pipeline.

`test-impact` is a **lower bound**, and the two questions it could answer want opposite things: for "what must be
looked at again" a wide answer is safe; for "what can CI skip" a wide answer is worthless. The rungs are reported
separately and `--json` carries `certainty` per test so a pipeline can price them. **Skipping what it does not name is
a risk decision this tool cannot make for you** — a test reached only through reflection or a service loader does not
appear.

Detail, the edit hooks, and the numbers: **`reference/changed-and-tests.md`**.

## path — asking the graph

```
axiomcode path decrypt '*'               # a concept word, no exact name yet — START HERE in an unfamiliar repo
axiomcode path Parser.parse Lexer.emit
axiomcode path '*' Owner.method          # everything that reaches it, with entry points
axiomcode path '*' 'new File'            # a library call is an endpoint
axiomcode path '@GetMapping' '*'         # a decoration is an endpoint
```

Endpoints are names **as written in the code**: `Owner.method`, `method`, `Type`, `file.ts:123`, `file.py`,
`Outer$Inner.m`, a library call as written, a decoration. A name that does not exist stops with the exact names that
are close — use one of those. There is no separate search verb and none is needed.

By default the answer is **one shortest chain per reached target**; `--every` adds all routes. "No chain" is an answer
with a bound: it is followed by whether unresolved sites *would* connect the two, and at which `file:line`.

The full endpoint grammar, `--every`, `--selftest` and what it cannot find: **`reference/path.md`**.

## What it cannot see, by construction — say so instead of guessing

Reflection, string dispatch, event buses; a call whose receiver the engine could not type (DI-injected, unbound
generic, a parameter in a dynamic language); callbacks handed to a library, reached from their definer but never from
the library that invokes them; what a decoration *turns on* (the proxy, the transaction, the cache) as opposed to the
code that names it; code outside `--src` or in another language. Each of these is counted in `bound:`, never guessed.

A chain says control can reach B from A through these calls — nothing about the values that travel it.

## Reference

`reference/impact.md` · `reference/changed-and-tests.md` · `reference/path.md` — the per-verb rules, the framework
hops, and every measured number behind the rungs. Read the one for the verb you are using when a row's rung or a
missing row needs explaining; they are not needed to make a call.

`scripts/` holds `axiomcode` (the entry) and what it dispatches to: `axiomcode-build` (the pipeline), `axiomcode-index`,
`axiomcode-graph` + `viewer.html`, `axiomcode-path` with `dl/path.dl`, `axiomcode-impact` with `dl/impact.dl`,
`axiomcode-changed`, `axiomcode-test-impact`, `axiomcode-context`.
