# diff: what changed between two graphs of one tree

```sh
axiomcode diff <graphA> <graphB> [--file <path fragment>] [--lang <lang>] [--limit N] [--json]
```

Each side is a `graph.sqlite`, or a directory holding one: an indexed repository (every language graph under its
`.axiomcode` is compared, paired by language) or an `out` directory. Neither graph is rebuilt or refreshed.

## The before/after recipe

```sh
rsync -a --exclude .axiomcode <tree>/ /tmp/before/ ; rsync -a --exclude .axiomcode <tree>/ /tmp/after/
AXIOMCODE_ENGINE=<old engine> axiomcode index /tmp/before --lang python
AXIOMCODE_ENGINE=<new engine> axiomcode index /tmp/after  --lang python
cp /tmp/before/.axiomcode/out/graph.sqlite /tmp/before.sqlite   # a later query may refresh a graph with another engine
cp /tmp/after/.axiomcode/out/graph.sqlite  /tmp/after.sqlite
axiomcode diff /tmp/before.sqlite /tmp/after.sqlite
```

Copy each graph out right after its index: a query on a graph built by another engine starts a background rebuild
with the installed one, which overwrites the graph under test. The diff itself never does.

## How rows are matched

By what stays the same when one tree is indexed at another path, never by id: an id hashes the index directory, so
two indexes of one tree share none, and a join on ids says everything changed.

| kind | matched on |
|---|---|
| call edge | the site (file, line, column, caller's qualified name) and the callee (qualified name and file:line, or the label a library callee carries, `external:…`, `builtin:…`) |
| entry point | the method (qualified name, file:line) and the reason |
| reachable | the method |
| remote edge | transport, destination, sender, handler, confidence |
| framework edge (Python) | mechanism, name, from, to, certainty |
| config binding (Java) | key, mechanism, target kind, target (a parameter is named by its owner type) |
| symbol | kind, qualified name, file, line; the same declaration with another signature is a `~` row (a parameter added, a type changed) |

Absolute paths (Java's `methods`, `call_sites`) are made relative to the tree each graph was built from, so the same
tree indexed at two paths, by the same engine, diffs to nothing. An edit that moves lines moves every row below it:
compare graphs of one tree, not of two commits.

## Reading the answer

```
python: A /tmp/before/.axiomcode/out/python/graph.sqlite (engine 637532ae)
        B /tmp/after/.axiomcode/out/python/graph.sqlite (engine 37466bd6)
summary: call edges +0 -0 ~0 >18 · entry points +0 -0 · reachable from an entry point +5 -0 · … · symbols +0 -0 ~0
call edges per tier: ambiguous_unknown 10152 -> 10134 (-18) · known_edge 2504 -> 2522 (+18) · boundary_lib 4721 (=) · …

call edges (…):
  + file:line:col  Caller -> Callee  [tier, kind]          a site that had no edge, or a new callee at a new site
  - file:line:col  Caller -> Callee  [tier, kind]          the reverse
  ~ file:line:col  Caller -> Callee  a/kind => b/kind      the same callee at another tier or call kind
  > file:line:col  Caller                                  a site whose callees changed: the old set, then the new
      - Callee  [tier, kind]
      + Callee  [tier, kind]
```

The summary counts are of the whole diff; `--limit N` caps the rows per section (default 40, 0 for all).
`--file` keeps the rows with a file containing the fragment (the site's, the caller's, the callee's or the
declaration's) and counts only those. `--json` prints every row with the same counts, under
`languages.<lang>.{counts, tiers, calls, entry_points, reachable, remote, framework, config, symbols}`.

## Not compared

`refs`, `literals`, `type_use`, `field_access` and the `ext_*` diagnostics other than the four above: open both
graphs with `reference/schema.md` for those. A language in only one of the two is named and skipped.
