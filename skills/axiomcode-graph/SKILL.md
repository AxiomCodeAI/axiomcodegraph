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
axiomcode-graph build  [<repo>] [--library <root>[,<root>…]] [--out <page.html>]   engine (via skills/axiomcode's axiomcode-build) + page
axiomcode-graph export [<repo>] [--out <page.html>]                                 page from an existing graph.sqlite (no engine run, ~1 s)
```

Default page: `<repo>/.axiomcode/graph/graph.html` — one file, works from `file://`, no network, no library.

**Pass the dependencies.** `--library` (or `AXIOMCODE_LIBRARY`) names the roots the engine may resolve into —
for Java the JDK and the third-party sources or IR (`~/Documents/AxiomCode/jdk,~/Documents/AxiomCode/other-lib`
on this machine). With them, a call into a dependency resolves to a **black box** — one node per library
type, drawn outside the disc in its own colour, with the calls counted separately. Without them those calls
are `ambiguous_unknown` and the rate is understated: a Java corpus member went from 65% to 84% of all sites
resolved with the JDK supplied, and what remained was JUnit's `assertEquals`, which was not in the roots.
The rate the page reports is over calls into **client** code; external calls are excluded from it and
shown as their own number.

## The procedure

1. `axiomcode-graph build . --library <roots>` — quote the line it prints: client-call resolution, unresolved
   count, external calls and black boxes. A Java build without roots prints a warning — do not report its
   rate as the engine's.
2. Tell the user to open the page (`open .axiomcode/graph/graph.html` on macOS), or pass `--out ~/dir/name.html`.
3. To point at something: `graph.html#n=Owner.method` selects and zooms to it; `&impact=1` lights everything
   that can reach it; `&chain=1` the heaviest path from it.

## What the page shows

- **The disc.** Directories in the centre (named around the rim), their files on the next ring, the types in
  each file on the next, every method in the band outside — each in an arc under its parent, so a package is
  a wedge and a class a fan. Tiny dots, faint edges; only what matters gets a label chip: the hovered node,
  the selection and its neighbours, search matches, and the big things as you zoom in.
- **Black boxes.** Library types the engine did not analyse — `java.util.ArrayList`, `java.lang.String` — as
  white-bordered black squares on a ring outside the methods, each near its callers; the orange dotted lines are
  calls into them. A black box's panel lists the methods called on it and every caller; a method's panel lists
  its external calls apart from its client calls. Calls end there: nothing is inferred about library bodies.
- **Left panel — what is drawn.** *Node types* (directory / file / class / interface / enum / method /
  function / external black box, with counts) hide or show a kind. *Only* narrows to methods with unresolved calls, entry points
  (`main`, handlers — not tests), or tests. *Edges* hide or show calls with one resolved target (grey), calls
  with a sound set of targets (cyan), calls into a library (orange dots), extends (violet dashes), and the structure spokes. *Focus depth* keeps
  only what is within 1–3 hops of the selection or the search.
- **Right panel — search and detail.** Type a name: Enter shows **only** the matching nodes and the edges
  between them (a row shows only that one); everything else is cleared, and a small result set is laid out on
  its own. `clear ✕` restores the disc. Click a node for `file:line`, signature, flags, callers and callees
  with tiers, contains / in; **impact ↑** colours every method that can reach it through resolved calls rose
  and counts them (a lower bound when its body has unresolved sites); **chain ⇢** the heaviest resolved path.
- Links: `graph.html#q=Tokeniser.emit` opens that search; `#n=Owner.method[&impact=1|&chain=1]` a node.

## Rules

- For "who calls X" / "what does changing X touch" in a conversation, use `skills/axiomcode` (`search`,
  `impact`); this page is for showing.
- Never present an unresolved count as "no callers". It is *unknown, not absent*.
