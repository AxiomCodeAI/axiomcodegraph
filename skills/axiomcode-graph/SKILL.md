---
name: axiomcode-graph
description: Build the graph of a Java, TypeScript, Python or JavaScript codebase from AxiomCode's type-resolved engine and hand it to the user as a page they can open — a community overview, a class-diagram map per community, and a callers/callees view per node, every call edge carrying its tier. Also writes graph.json, communities.json and GRAPH_REPORT.md, and answers query / explain / path over them. Use when someone wants to see the graph of a repository, not ask it a question.
---

# axiomcode-graph — the graph of a codebase, as a page

`skills/axiomcode` answers questions over the engine's graph. This skill hands over the graph itself:
one `build` and the user opens `.axiomcode/graph/graph.html`. Nothing in it is inferred beyond what the
engine derived — every arrow is a call whose receiver type was resolved, with its tier on it; a call
the engine could not resolve is a count on the caller, never a guessed edge.

All tools live in `scripts/` next to this file; run them via Bash from the repository root.

```
axiomcode-graph build [<repo>]          run the engine (through skills/axiomcode's axiomcode-build) and write
                                        <repo>/.axiomcode/graph/{graph.html, graph.json, communities.json, GRAPH_REPORT.md}
axiomcode-graph export [<repo>]         rewrite those from an existing graph.sqlite (no engine run; ~1 s on 10k nodes)
axiomcode-graph stats  [<repo>]         what is in the artifact

axiomcode-graph query  "<words>"        the nodes whose labels carry the words, each with one hop out, budgeted (--budget N tokens)
axiomcode-graph explain <name>          one node: location, community, every edge by relation with its tier, unresolved sites
axiomcode-graph path   <A> <B>          shortest resolved call path (overrides = a dispatch hop), else the undirected connection
```

## The procedure

1. `axiomcode-graph build .` — quote the line it prints (nodes, links, communities, resolution).
2. Tell the user to open `.axiomcode/graph/graph.html` (`open .axiomcode/graph/graph.html` on macOS). It is
   one file, works from `file://`, needs no network.
3. If they want a written summary, `GRAPH_REPORT.md` has it: resolution by tier, the communities and their
   hubs, god nodes, entry points, blind spots. Read it rather than re-deriving any of it.
4. `--no-html` skips the page; `--top N` changes how many of the most connected methods the page embeds
   (default 3000; every type is always embedded).

## What the page shows

- **Overview** — the call graph itself: a circle per method, a line per call. Size = how connected, colour =
  community (Louvain over calls, overrides, extends and containment — a colour is a region), triangle = entry
  point, dashed = test, line style = tier. It opens on the 400 most connected non-test methods with the hubs
  labelled; a slider widens it to 1 500 and a checkbox adds tests. Hover a node to isolate its calls, click it
  for the node view. The side panel lists the communities — click one for its class map.
- **Community** — a class-diagram map: each type is a box listing its methods; free functions are boxed by
  file; arrows between boxes are aggregated with a count and coloured by the best tier among them
  (solid = one resolved target, dashed blue = a sound set, dotted = declared ambiguous; purple = overrides /
  extends). Pills at the foot of a box are its calls into other communities — click to follow.
  Shapes: class = rounded rect · interface = diamond · enum = hexagon · method = circle · constructor = circle
  with a core · entry point = triangle · test = dashed · library = grey square. `?N` on a row is unresolved
  call sites in that body.
- **Node** — the node centred, callers on the left, callees on the right, overrides / extends above and
  below, each with `file:line` and tier; click any neighbour to re-centre. The side panel lists everything,
  with the names written at the unresolved sites.
- `#c=<id>` / `#n=<id>` in the URL open a view directly — a link to a community or a node can be shared.

## Rules

- The page is derived from `graph.sqlite`; it does not replace it. For "who calls X" in a conversation use
  `skills/axiomcode` (`axiomcode search` / `impact`); use this skill's verbs only when working from the
  artifact (e.g. a bench arm that consumes `graph.json`).
- Never present a count of unresolved sites as "no callers". It is *unknown, not absent*.
- `graph.json` follows the `{nodes, links}` shape other graph tools emit (`id`, `label`, `source_file`,
  `source_location`, `relation`, `confidence`), so their consumers read it unchanged; `tier` is extra.
- Under the gate hook, `query` / `explain` / `path` log every printed path like the other skill's verbs do.
