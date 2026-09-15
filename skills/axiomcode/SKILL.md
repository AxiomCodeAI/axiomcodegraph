---
name: axiomcode
description: Find code and reason about change impact in a Java, TypeScript, Python or JavaScript codebase with AxiomCode's type-resolved call graph instead of grep — where a name is declared or used, who calls what, what a change affects, which tests reach it, where the engine could not resolve a call. Ten verbs, names written the way they appear in the issue, no schema to learn. In a gated run, reading and editing unlock only after the graph has named the file.
---

# axiomcode — ask the graph in the words of the question

The graph is derived by a type-directed Datalog engine: every edge is a call whose receiver type was
inferred and whose target was looked up in that type's hierarchy — not a name match. Where the engine
could not resolve a call it says so, and every verb below carries that with the answer.

All tools live in `scripts/` next to this file; run them via Bash from the repository root.

```
axiomcode-build .                       build or refresh .axiomcode/out/graph.sqlite (+ index). Always first.

axiomcode find    <name> [in=<path>] [kind=fn|method|class|const|field|enum|type]   where it is declared
axiomcode uses    <name> [in=<path>]          every reference, string literal and comment — your grep
axiomcode show    <name | file:a-b> …         the body, numbered; several per call
axiomcode callers <name> [depth=N]            who calls it, with the tier of every edge; depth>1 is transitive
axiomcode callees <name> [depth=N]            what it calls: resolved · library · UNRESOLVED (the blind spots)
axiomcode path    from=<name> to=<name>       a resolved call path between two functions
axiomcode impact  <name> [depth=N]            blast radius + dispatch siblings + tests reaching + unresolved inside
axiomcode type    <T>                         members, ancestors, subtypes, code that calls methods of T
axiomcode at      <file>:<line>               the method containing a location (a diff hunk, a stack frame)
axiomcode sql     "<SELECT>"                  over the views symbols · callers · callees · source
axiomcode-brief   .axiomcode <issue-file>     an issue → ranked starting set with real edges
```

**Names are written as they appear in the code or the issue**, in every language: `bar`, `Foo.bar`,
`Outer.Inner.bar`, `type=Foo method=bar`, `pkg.Foo.bar`, `m(int,String)`. You never need the parser's
qualified-name spelling, a hash, or a table name. A name that is inherited (`Nominal.__call__` when
`Scale` declares it), bound to an arrow function, or a constant / enum member / field resolves too.
A miss never comes back empty: it says what was tried, lists the nearest names, and searches
references, literals and comments for the same word.

## The procedure

1. `axiomcode-build .` — quote the resolved / unresolved counts it prints.
2. **Anchor** every identifier, type, error message or `file#Lnn` in the question:
   `axiomcode find <name>` (a declaration), `axiomcode uses <string>` (a message or a flag),
   `axiomcode at <file>:<line>` (a hunk or a frame). Two or three names per issue; run them in one turn.
3. **Expand along edges**, not by reading files: `callers` / `callees` for one hop, `callers … depth=3`,
   `path from= to=`, `impact` for anything further. Ask the graph "what connects A to B" instead of
   scrolling for it.
4. **Bound the claim**: `impact` and `callees` list the unresolved sites. An unresolved site is
   *unknown, not absent* — a "nothing else is affected" claim is a lower bound when any are present.
5. **Read only what the graph pointed at**: `axiomcode show <name>` for bodies (several per call),
   Read for the exact `file:line` ranges it returned.
6. **Report**: the involved functions and how they connect (with tiers), the impact set and the tests
   that reach it, and the blind spots — each with `file:line`.

## Rules

- `axiomcode find` / `uses` before grep for any name; `uses` is grep over what the parser saw.
- Never call a name match an edge. Tiers: `known_edge` one target · `multi_inferred` a sound set ·
  `boundary_lib` leaves the client · `ambiguous_*` a declared unknown — say which.
- Transitive claims ("nothing reaches X", "X cannot affect Y") come from `callers depth=`, `path`
  or `impact`, never from reading, and are lower bounds when unresolved sites are reported.
- `sql` is the escape hatch, only over the documented views; if a question needs it, the verb that
  should have answered it is a bug — note it.

## What the environment enforces (in a gated run)

- Nothing is readable or editable until `axiomcode-brief .axiomcode .axiomcode/issue.md` has run.
- A source file can be read or edited only after a graph verb has printed its path. Creating a new
  file is always allowed. grep is denied; it is not how you find out what a change affects.
