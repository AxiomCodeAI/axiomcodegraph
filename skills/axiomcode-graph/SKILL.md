---
name: axiomcode-graph
description: Show the call chains of a Java, TypeScript, Python or JavaScript codebase as a page — built from AxiomCode's type-resolved engine, one chain per entry point or root, each hop with file:line and each arrow with the engine's tier; click a chain to read it end to end, expand any hop to go deeper. Use when someone wants to see how the code flows, not to ask the graph a question.
---

# axiomcode-graph — the call chains of a codebase, as a page

`skills/axiomcode` answers questions over the engine's graph. This skill draws the graph as the thing
people actually read: call chains. Nothing on the page is inferred beyond what the engine derived — every
arrow is a call whose receiver type was resolved, with its tier on it; a call the engine could not resolve
is a `?N` count on the hop, never a drawn edge.

All tools live in `scripts/` next to this file; run them via Bash from the repository root.

```
axiomcode-graph build  [<repo>] [--out <page.html>]   run the engine (through skills/axiomcode's axiomcode-build), write the page
axiomcode-graph export [<repo>] [--out <page.html>]   write the page from an existing graph.sqlite (no engine run, ~1 s)
```

Default page: `<repo>/.axiomcode/graph/graph.html` — one file, works from `file://`, no network.

## The procedure

1. `axiomcode-graph build .` — quote the line it prints (methods, resolved edges, unresolved sites, chains).
2. Tell the user to open the page (`open .axiomcode/graph/graph.html` on macOS), or pass `--out ~/some/dir/name.html`
   when they want it somewhere else.
3. To point them at a specific flow, give a link: `graph.html#from=Owner.method` opens the chain from that
   method; `&open=Owner.method` expands that hop's other callees.

## What the page shows

- **Left: the chains.** One per root — entry points that are not tests first (`main`, handlers, lifecycle),
  then methods nothing calls, then tests. A chain follows the heaviest resolved callee at each hop until a
  leaf, a repeat, or 10 hops; it is ranked by how much of the code it reaches. Filter by any name; a name that
  is not a root offers "start a chain at" it.
- **Right: the selected chain, end to end.** One box per hop — name, `file:line–line`, signature, `entry`,
  `test`, `? N unresolved` (call sites in that body the engine could not resolve: each MAY be a call the page
  is not showing), `→ library ×N`. Arrows: solid = one resolved target · dashed blue = a sound set of
  targets · dotted grey = declared ambiguous. Dashed box = test, thick box = entry point.
- **Deeper on demand.** `+ N more callees` under a hop lists its other callees below the chain, each with its
  own `+`; `↑ N callers` does the same upward; `chain ⇢` restarts the chain from that hop. Nothing is drawn
  until asked for.

## Rules

- For "who calls X" / "what does changing X touch" in a conversation, use `skills/axiomcode` (`search`,
  `impact`); this skill is for showing flow to a person.
- Never present `? N unresolved` as "no callers". It is *unknown, not absent*.
- The chain shown is the heaviest path, not the only one — the `+` under every hop is where the others are.
