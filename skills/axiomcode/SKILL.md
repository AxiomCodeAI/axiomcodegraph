---
name: axiomcode
description: Find code and reason about change impact in a Java, TypeScript, Python or JavaScript codebase with AxiomCode's type-resolved call graph instead of grep — where a name is declared or used, who calls what, what a change affects, which tests reach it, where the engine could not resolve a call. Two verbs — search and impact — names written the way they appear in the issue, no schema to learn. In a gated run, reading and editing unlock only after the graph has named the file.
---

# axiomcode — ask the graph in the words of the question

The graph is derived by a type-directed Datalog engine: every edge is a call whose receiver type was
inferred and whose target was looked up in that type's hierarchy — not a name match. Where the engine
could not resolve a call it says so, and every verb below carries that with the answer.

All tools live in `scripts/` next to this file; run them via Bash from the repository root.

```
axiomcode-build .                             build or refresh .axiomcode/out/graph.sqlite (+ index). Always first.

axiomcode search <anything> [in=<path>]       a name (bar · Foo.bar · Outer.Inner.bar · file.ts:bar · m(int,String)),
                                              words from the issue, an error message in quotes, or file:line.
                                              → the matching nodes, each with one hop in every direction: who calls it,
                                                what it calls (resolved · library · UNRESOLVED), dispatch, tests reaching it.
                                              A constant / flag / message → where it is declared and every mention.
                                              A miss → the nearest names. Never empty. The next call is
                                              `search <a name from the output>`: that is how you walk the graph.
axiomcode impact <name> [to=<name>]           everything changing it can touch, in FULL: every method that reaches it, by hop, the files
                                              they live in, every test file that reaches it, the dispatch envelope,
                                              the unresolved sites that bound the claim, entry reachability,
                                              and with to= whether a resolved path connects the two and through what.
axiomcode-brief .axiomcode <issue-file>       an issue → ranked starting set with real edges
```

Two verbs on purpose. Everything else an agent used to do with the graph — find, uses, callers, callees, path, type,
at — is a mode of one of these, chosen by the shape of the input, so there is no schema and no verb to pick.

**Names are written as they appear in the code or the issue**, in every language: `bar`, `Foo.bar`,
`Outer.Inner.bar`, `type=Foo method=bar`, `pkg.Foo.bar`, `m(int,String)`. You never need the parser's
qualified-name spelling, a hash, or a table name. A name that is inherited (`Nominal.__call__` when
`Scale` declares it), bound to an arrow function, or a constant / enum member / field resolves too.
A miss never comes back empty: it says what was tried, lists the nearest names, and searches
references, literals and comments for the same word.

## The procedure

1. `axiomcode-build .` — quote the resolved / unresolved counts it prints.
2. **Anchor** with `axiomcode search`: the issue title as words, then each identifier, message or
   `file:line` it quotes — two or three calls, in one turn. Each result is a node with its neighbourhood.
3. **Traverse**, not read: `search <a name from the last output>` is one hop; walk node to node.
   `impact <name>` for the transitive question, `impact <a> to=<b>` for "what connects A to B".
4. **Bound the claim**: `search` and `impact` list the unresolved sites. An unresolved site is
   *unknown, not absent* — a "nothing else is affected" claim is a lower bound when any are present.
5. **Read only what the graph pointed at**: `axiomcode show <name>` for bodies (several per call),
   Read for the exact `file:line` ranges it returned.
6. **Report**: the involved functions and how they connect (with tiers), the impact set and the tests
   that reach it, and the blind spots — each with `file:line`.

## Rules

- `axiomcode search` before grep for any name; its mentions mode is grep over what the parser saw.
- Never call a name match an edge. Tiers: `known_edge` one target · `multi_inferred` a sound set ·
  `boundary_lib` leaves the client · `ambiguous_*` a declared unknown — say which.
- Transitive claims ("nothing reaches X", "X cannot affect Y") come from `impact`, never from
  reading, and are lower bounds when unresolved sites are reported.
- If a question cannot be asked with these two verbs, that is a bug in the skill — note it in the
  report rather than working around it.

## What the environment enforces (in a gated run)

- Nothing is readable or editable until `axiomcode-brief .axiomcode .axiomcode/issue.md` has run.
- A source file can be read or edited only after a graph verb has printed its path. Creating a new
  file is always allowed. grep is denied; it is not how you find out what a change affects.
