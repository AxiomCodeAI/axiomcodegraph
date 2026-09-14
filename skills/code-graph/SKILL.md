---
name: code-graph
description: Build a trustworthy call graph of a Java, TypeScript or Python codebase and query it — who calls what, blast radius of a change, reachability from entry points, what the analysis could not resolve. Use when a question is about code structure, change impact, callers/callees, or "what do I need to read to change X".
---

# Code graph

One command turns a source tree into `graph.sqlite`, a SQLite database whose schema is
documented **inside it**. Query it instead of grepping: a grep cannot see a call that goes
through an interface, an inherited override, or a function value; the graph can, and it
tells you how sure it is about every edge.

## Build it

```bash
bin/axiom-graph --language python --src <project-dir> --out <out-dir>
#               --language java | typescript | python
#               --library <ir-root>[,…]   the platform/library IR, when available (better resolution)
#               --debug                   also writes csv/*.csv and keeps raw/ (not needed for querying)
```

Prints the path of `<out-dir>/graph.sqlite`. Needs Node ≥ 22.5 and a shell; no Soufflé or
compiler (the engine binary is in `binaries/` or is fetched). Rebuild after the code changes.

## Read the schema first — it is in the database

```sql
SELECT text FROM schema_guide ORDER BY step;          -- how to use it, in order (read once)
SELECT value FROM run WHERE key = 'language';         -- which vocabulary applies
SELECT name, description FROM schema_tables WHERE scope = 'core';
SELECT * FROM schema_columns WHERE table_name = 'call_edges';
SELECT value, meaning FROM schema_vocab               -- what a column can hold, for this language
 WHERE table_name = 'call_edges' AND column_name = 'tier'
   AND language = (SELECT value FROM run WHERE key = 'language');
SELECT table_name, note FROM schema_notes;            -- caveats for this language
```

## Ask the common questions with the tested queries

```sql
SELECT name, question, params FROM schema_queries;    -- the catalogue
SELECT sql FROM schema_queries WHERE name = 'callers_of';
```

Bind the named parameters and run — with the sqlite3 CLI:

```bash
sqlite3 graph.sqlite ".parameter set :qualified_name 'app.Widget.render'" \
        "$(sqlite3 graph.sqlite "SELECT sql FROM schema_queries WHERE name='callers_of'")"
sqlite3 graph.sqlite ".parameter set :qualified_name 'app.Widget.render'" ".parameter set :depth 2" \
        "$(sqlite3 graph.sqlite "SELECT sql FROM schema_queries WHERE name='blast_radius'")"
```

| query | answers |
|---|---|
| `callers_of` | who calls this method, from which file:line, with what confidence |
| `callees_of` | what this method calls — resolved targets, library boundaries, unresolved sites |
| `blast_radius` | methods transitively affected by a change, to `:depth`, through sound edges only |
| `reachable_from_entries` | is this method reachable from a main / test / handler |
| `method_at` | the method containing a file:line |
| `blind_spots_of` | the calls inside a method the engine could not resolve |
| `subtypes_of` | types that extend/implement a type, transitively |
| `values_of` | the meaning of a column's values in this language |
| `tier_summary` | how much of the graph is certain / inferred / boundary / unknown |

Find a method's `qualified_name` with `SELECT qualified_name, file_path FROM methods WHERE name = 'render';`.

## Rules for a correct answer

1. **Filter on `tier`.** `known_edge` and `multi_inferred` are claims about the client's code (every row of a `multi_inferred` set is a real possibility). `boundary_lib` leaves the client. `ambiguous_*` rows are *declared unknowns* with a NULL callee — never count them as edges.
2. **A negative answer is a lower bound.** Before saying "nothing calls X" or "X can't reach Y", run `blind_spots_of` on the methods involved: an unresolved call there means the engine could not see everything. Say so.
3. **Join, never parse.** Ids (`METHOD_REGISTRY_…`, `PY_METHOD_…`) are opaque hashes; names, files and lines come from `methods`, `types`, `call_sites`.
4. **Carry the confidence with the result.** Report the tier of each edge and the unresolved count of each affected method; a reader who cannot see confidence cannot use the answer.
5. **`ext_*` tables** are the language's raw engine relations (positional columns `c0…`); use them only when a core table lacks what you need, after reading their description in `schema_tables`.
