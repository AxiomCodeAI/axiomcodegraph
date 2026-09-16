---
name: axiomcode-graph
description: Show the call chains of a Java, TypeScript, Python or JavaScript codebase as a page — a graph of only the chain nodes, built from AxiomCode's type-resolved engine, roots left and hops flowing right, each arrow with the engine's tier; click a chain to select it end to end, expand any hop to grow the graph deeper. Use when someone wants to see how the code flows, not to ask the graph a question.
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

- **The canvas: the chain graph.** A circle per method that is on a chain, a line per chain edge, roots on the
  left and hops flowing right by depth — so the whole view is call chains and nothing else. Size = how
  connected the method is, colour = the directory it lives in (legend bottom-left), triangle = entry point,
  dashed = test, orange dot = has unresolved call sites. Line style is the tier: solid = one resolved target,
  dashed blue = a sound set. It opens with the chains from entry points and roots (~400 nodes); a checkbox
  adds the chains from tests.
- **Left: the chain list.** One per root, ranked by reach, with a preview; filter by any name, or type a
  method that is not a root to start a chain at it. Click a chain (or its root circle) and its path is
  selected end to end — everything else dims.
- **Right: the selected chain as a list** (hop, `file:line`, `?N` unresolved) and the selected node with
  `+ callees` / `↑ callers` / `chain from here`. Expanding draws the new methods as circles next to the node
  (outlined orange until the next action), each expandable again — deeper on demand. Double-click a circle
  is `+ callees`.
- `#from=Owner.method` opens that chain; `&open=Owner.method` also expands that hop.

## Rules

- For "who calls X" / "what does changing X touch" in a conversation, use `skills/axiomcode` (`search`,
  `impact`); this skill is for showing flow to a person.
- Never present `? N unresolved` as "no callers". It is *unknown, not absent*.
- The chain shown is the heaviest path, not the only one — the `+` under every hop is where the others are.
