---
name: axiomcode
description: Build AxiomCode's type-resolved call graph of a Java, TypeScript, Python or JavaScript repository, draw it as one page, and answer "is there a chain of calls from A to B, and through what?" and "what has to be looked at again if this declaration changes?" in Datalog over it, every printed hop verified. One entry point, `scripts/axiomcode`, with subcommands; every future capability is a subcommand of it.
---

# axiomcode

One command, run from the repository root via Bash: `<this dir>/scripts/axiomcode <subcommand> …`

The same subcommands are MCP tools when this plugin is loaded (`mcp__plugin_axiomcode_axiomcode__axiomcode_path`, `…_impact`,
`…_index`, `…_graph`, from `plugins/axiomcode/.mcp.json` → `mcp/server.py`): typed parameters, the same verified output.
Prefer the MCP tool when it is in your tool list; the CLI is the same code.

When the plugin is loaded, a PostToolUse hook adds the graph's edges to your own Read and Grep results (`graph: …` — who
calls each callable in the lines you read, what it calls, how many calls in it are unresolved; a grep for an identifier
gets its declarations with the same). Nothing is added when the repo has no graph.

```
axiomcode index [<repo>] [--lang <l>] [--src <dir>] [--library <root>,…]   the pipeline: parser → engine → .axiomcode/out/graph.sqlite (+ index)
axiomcode graph [<repo>] [--out <folder | page.html>] [same flags]        the graph as one page; runs the pipeline only when there is no up-to-date graph
axiomcode path <from> <to> [<repo>] [--every|--paths N] [--in <path>]     the shortest chain of calls from A to B per target (--every: all routes) — or why there is none
axiomcode path '*' <X>  ·  path <X> '*'                                   everything that can reach X (with its entry points) · everything X reaches
axiomcode impact <target>… [<repo>] [--tests] [--depth N] [--in <path>]  what a change to a method / field / type / parameter / type parameter / local reaches, and how sure
```

`<repo>` defaults to the current directory. The page goes to `<repo>/.axiomcode/graph/graph.html`; `--out <folder>`
puts it at `<folder>/<repo>.html`, `--out x.html` at that path. With an up-to-date graph, `graph` takes ~1 s.

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
  reach it, a lower bound when it has unresolved sites) and **chain ⇢**. Clicking a method opens its source on
  the left (the page embeds the sources; up to 40 MB) with every call in the body a link coloured by what the
  engine resolved it to — grey one target, cyan a sound set (a chooser when several), orange a library black
  box, amber unresolved; click opens the callee in a window stacked below, ⌘/Ctrl-click goes there; *whole
  file* and an *editor ↗* (`vscode://`) link per window. The left panel hides or shows each node kind — tests included — narrows
  to unresolved / entry points / tests, toggles each edge kind, and limits the view to 1–3 hops.
  `graph.html#n=Owner.method&impact=1` links to a node. Tell the user to `open .axiomcode/graph/graph.html`.

## path — asking the graph

- **Endpoints are names as written in the code**, never guesses: `Owner.method`, `Outer.Inner.method`, `method` (a free
  function, or that name under any owner), `Type` (every method it declares), `file.ts:123` (the callable at that
  line, top-level code included), `file.py` (every method in the file). `Outer$Inner.m`, `Outer.Inner#m`, `m(int,String)`
  and package-qualified `pkg.Outer.Inner.m` are the same name; a Java nested type is found whether or not the outer is
  written (the parser drops it, #667). A name that does not exist stops with the exact names that are close — use one
  of those, or a `file:line` from the issue or a stack trace. Built and self-tested for Java, TypeScript and Python;
  JavaScript works but the engine's JavaScript output is still moving.
- **By default the answer is ONE SHORTEST chain per reached target** — it says so on its last line. Other routes exist
  and are not listed. `--every` adds all of them: first the complete set of methods and calls that lie on *any* chain
  from a source to a target (from Datalog, polynomial — `301 methods and 935 calls` for `Jsoup.parse → Tokeniser.emit`),
  by file, then the simple paths through it, shortest first, up to `--paths N` (default 20; the count is exponential,
  so the set is the complete answer and the list is a sample of it). Each hop is marked: unmarked = a resolved call, `[multi_inferred]` =
  one of a sound target set, `[dispatch]` = an instantiated override reached through its base, `[defines]` = a closure
  under the callable that defines it. The `verified:` line means every hop was looked up again in graph.sqlite and a
  plain BFS found the same length; a `✗` means the answer is wrong — report it, do not use it.
- **No chain is an answer with a bound.** "no chain of resolved calls" is followed by whether unresolved sites *would*
  connect the two by name, and at which `file:line` — that is the site to read, not a path to claim. The `bound:` line
  counts unresolved calls on the chain shown: other chains may exist that the graph cannot see.
- **A call into a library is an endpoint too — with or without `--library`.** `path '*' 'new ArrayList'`,
  `path '*' Files.readAllBytes`, `path '*' readAllBytes`, `path '*' 'Collections.*'`, `path '*' open`: the name as the parser
  wrote it at the call site (kind `new` or method, and the receiver written before it), matched at every unresolved site,
  in any language. With `--library` staged the same call is a resolved library method and matches by qualified name. A
  client declaration always wins over both. The node has in-edges only — nothing is inferred about the library body — and
  the answer says how many sites were matched and where.
- **A type the code uses but does not declare is an endpoint**: `path Foo.run File` — every place `File` is touched,
  as one target: `new File` at unresolved sites, the library methods of `java.io.File` when staged,
  and the methods whose body references the name where the parser gives a line. The answer says which of those it
  matched (Java type references carry no line, so there it is the constructor calls and identifier uses).
- **A decoration is an endpoint**: `path '@GetMapping' 'new File'`, `path '@*Mapping' Files.readAllBytes`, `path '@Test' X` —
  every method carrying it (from the index's decorations table), so "from any method with this decoration to X" is one call.
- **End to end, any shape:** `path Type1 method4` asks whether *any* method of Type1 reaches *any* declaration named
  method4 — a type on either end is all its methods, a bare name is every declaration under any owner (a free function
  in Python/TS/JS has its file as owner). The same rule in every language; nothing is forced to be typed.
- **A name under many owners** (`close`, `run`, `toString`): the closure is computed once from the sources, so a
  thousand targets cost nothing; the answer is which owners' declarations are reached and how far, nearest first,
  then the nearest chains. Narrow with `Owner.close`, `--in <path fragment>` (both endpoints restricted to files
  containing it), `--limit N`, or `--all` for every chain.
- `Outer$Inner.m` and `Outer$1.m` are looked up through the nesting table, not by string: Inner at any depth inside
  Outer; `$N` the N-th anonymous class in source order (javac's numbering — checked against `javap` on jsoup's
  TraversorTest, 10/10) or, for an enum, the N-th constant with a body. A miss says which part is wrong: no such
  outer / no nested type X (lists them) / only k anonymous classes (with lines) / no method m (lists the methods).
- **One endpoint = a closure, not a chain.** `path '*' X` is everything that can reach X — by hop, by file, and the
  *entry points* among them, nearest first. An entry point is decided by one language-neutral fact — nothing resolved
  calls it (the caller is outside the graph: a framework, a runner, reflection) or it is a test; a decoration on it is
  shown as information, never used to decide. `path X '*'` is everything X reaches, and the library calls X makes itself
  (the platform methods where the client graph ends), listed but never traversed. `--in src/main` keeps only the part
  under that path; `--depth N` bounds the hops. Each closure is cross-checked against a plain BFS (the `verified:` line)
  and bounded by the unresolved calls inside it.
- **What it cannot find, by construction** — say so instead of guessing: a call whose receiver the engine could not type
  (DI-injected, unbound generic, a parameter in a dynamic language) stops the chain and is counted in `bound:`; callbacks
  handed to a library (`executor.submit(task)`, `list.forEach(fn)`) are reached from their definer (`[defines]`) but never
  from the library that invokes them; calls the framework makes (HTTP dispatch, JUnit, `main`) have no edge — the callee
  is an entry point; reflection / string dispatch / event buses / config-wired beans are invisible; overloads sharing a
  name are all resolved together (a signature in the query is stripped); a method overriding a library method is called
  by the library, so its upstream ends there; code outside `--src` or in another language is not in the graph; a
  by-name or written match can be a same-named other thing. A chain says control can reach B from A through these
  calls — nothing about the values that travel it.
- Both directions are tried; the reverse is labelled.
- `axiomcode path --selftest <lang>` replays the engine's own expected edges through the tool and separates engine gaps
  from tool losses; run it after touching `dl/path.dl` or the exporter. Needs `souffle` on PATH.

`scripts/` holds `axiomcode` (the entry) and what it dispatches to: `axiomcode-build` (the pipeline), `axiomcode-index`, `axiomcode-graph`, `viewer.html`, `axiomcode-path` with `dl/path.dl`, `axiomcode-impact` (imports the path tool's resolver, facts and Datalog).
