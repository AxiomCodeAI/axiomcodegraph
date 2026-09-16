---
name: axiomcode
description: Build AxiomCode's type-resolved call graph of a Java, TypeScript, Python or JavaScript repository and draw it as one interactive page. One entry point, `scripts/axiomcode`, with subcommands; every future capability is a subcommand of it.
---

# axiomcode

One command, run from the repository root via Bash: `<this dir>/scripts/axiomcode <subcommand> …`

```
axiomcode index [<repo>] [--lang <l>] [--src <dir>] [--library <root>,…]   the pipeline: parser → engine → .axiomcode/out/graph.sqlite (+ index)
axiomcode graph [<repo>] [--out <page.html>] [same flags]                  the graph as one page (runs index first if there is no graph yet)
axiomcode graph export [<repo>] [--out <page.html>]                        the page from an existing graph.sqlite (no pipeline run, ~1 s)
```

`<repo>` defaults to the current directory. The page goes to `<repo>/.axiomcode/graph/graph.html` unless `--out` names a path.

- **Say the language and the tree** when the repo mixes them: `--lang typescript --src src`. Auto-detection counts
  files, so a TypeScript project with many `.js` scripts is otherwise taken for JavaScript.
- **Pass the dependencies.** `--library` (or `AXIOMCODE_LIBRARY`) names the roots the engine may resolve into
  (Java: the JDK and third-party sources/IR). Without them, calls into dependencies are `ambiguous_unknown`
  and the resolution rate is understated; a Java build without roots prints a warning — do not quote its rate.
- `index` prints resolved / unresolved counts; quote that line. An unresolved call is *unknown, not absent* —
  never report it as "no callers".
- The page: directories at the centre, files, types and methods in rings under their parent; edges are the
  engine's resolved calls with their tier (one target grey, sound set cyan, library orange, extends violet).
  Search by name; click a node for `file:line`, callers/callees with tiers, **impact ↑** (everything that can
  reach it, a lower bound when it has unresolved sites) and **chain ⇢**. `graph.html#n=Owner.method&impact=1`
  links to a node. Tell the user to `open .axiomcode/graph/graph.html`.

`scripts/` holds `axiomcode` (the entry) and what it dispatches to: `axiomcode-build` (the pipeline), `axiomcode-index`, `axiomcode-graph`, `viewer.html`.
