---
name: axiomcode-graph
description: Draw a Java, TypeScript, Python or JavaScript codebase as one interactive page from AxiomCode's type-resolved engine — a disc with directories in the centre, files, types and every method placed under their parent, and the engine's call edges across it with their tiers; hover for a node's calls, click for its detail, impact (everything that can reach it) or the chain from it. Use when someone wants to see a repository's graph, not to ask it a question.
---

# axiomcode-graph — the codebase as a disc

`skills/axiomcode` answers questions over the engine's graph. This skill draws the graph, in the shape
readers of GitNexus-style tools expect — but every edge is a call whose receiver type the engine resolved,
carrying its tier; a call the engine could not resolve is a count on the caller, never a drawn line.

All tools live in `scripts/` next to this file; run them via Bash from the repository root.

```
axiomcode-graph build  [<repo>] [--out <page.html>]   run the engine (through skills/axiomcode's axiomcode-build), write the page
axiomcode-graph export [<repo>] [--out <page.html>]   write the page from an existing graph.sqlite (no engine run, ~1 s)
```

Default page: `<repo>/.axiomcode/graph/graph.html` — one file, works from `file://`, no network, no library.

## The procedure

1. `axiomcode-graph build .` — quote the line it prints (counts, call edges, % of sites resolved).
2. Tell the user to open the page (`open .axiomcode/graph/graph.html` on macOS), or pass `--out ~/dir/name.html`.
3. To point at something: `graph.html#n=Owner.method` selects and zooms to it; `&impact=1` lights everything
   that can reach it; `&chain=1` the heaviest path from it.

## What the page shows

- **The disc.** Directories in the centre (named around the rim at their angle), their files on the next
  ring, the types in each file on the next, and every method in the band outside — each placed in an arc
  under its parent, so a package is a wedge and a class is a fan of methods. Colour is what a thing is:
  directory · file · class · interface · enum · method · function. Dotted = test, white ring = entry point
  (`main`, a handler, lifecycle — not tests), amber dot = has unresolved call sites.
- **Edges.** Faint grey spokes are the structure tree. Curves across the disc are calls: grey = one resolved
  target, blue = a sound set of targets; violet dashes = extends/implements. Checkboxes hide either family
  or the tests.
- **Hover** a node: its callers, callees, parent and children stay lit, the rest dims. **Click** to pin it:
  the panel gives `file:line`, signature, flags, callers and callees with tiers, what it contains, what it
  is in; **impact ↑** colours every method that can reach it through resolved calls rose and counts them
  (and says when unresolved sites in its body make that a lower bound); **chain ⇢** highlights the heaviest
  resolved path from it in amber. Double-click zooms to a node; search finds anything by name or path.

## Rules

- For "who calls X" / "what does changing X touch" in a conversation, use `skills/axiomcode` (`search`,
  `impact`); this page is for showing.
- Never present an unresolved count as "no callers". It is *unknown, not absent*.
