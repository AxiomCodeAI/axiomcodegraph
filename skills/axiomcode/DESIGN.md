# axiomcode query frontend — design

_Status: base set up 2026-09-14 on branch `skill/query-frontend` (umbrella #634; bench #639). Per-language sections are filled
in by the language stories (issues linked below). Nothing here is a contract until the dogfood
bench (`bench/dogfood`) has run against it._

## 1. The problem, measured

The graph is accurate; the agent's use of it is not. In the dogfood runs (r1-gated + r1-sql arms,
parser repo, 2026-09-14) an agent made **527** graph calls; **109 (21%)** returned nothing. Free-form
SQL was the worst surface (196 calls, 61 empty — 31%); `axiomcode-show`, a verb that resolves a name
forgivingly, was the best (149 calls, 2 empty). The Datalog surface (`axiomcode-dl`) was called 3
times in total and failed every time. The other agent's summary is right: _"the agent is doing two
jobs: solving the issue and being a DBA."_

Every empty result falls in one of five bins, none of which is a graph-accuracy problem:

| bin | what the agent typed | share of empties |
|---|---|---|
| **not a method or type** — a const, enum member, string literal, field | `find JS_DEFAULT_EXPORT_NAME`, `FOR_ITERABLE`, `list_splat`, `CATCH_PARAMETER` | ~35% |
| **qualified-name spelling** — agent writes `Class.method`, the bundle has `src/dir/file#Class.method` (TS) / `pkg.Class.method` (Java) / `pkg.mod.Class.method` (Py) / `src/dir/file.name` (JS) | `callers TsDeclarationExtractor.assignOverloadIdentities` → 0 rows; it exists | ~15% |
| **guessed names that do not exist**, and the tool says nothing instead of "nearest" | `visitSubscript`, `linkMeaningCheck`, `parameterScopeCheck` | ~25% |
| **invented schema** in free SQL | `FROM nodes`, `FROM entities`, `kind='function'` when the view had no such value | ~15% |
| **outside the graph** — a `.mjs` file in a TypeScript-language build; `axiomcode-dl blast_radius` without `DEPTH=` | | ~10% |

So the frontend has one job: **absorb the schema, the naming conventions, and the language
differences, so that a name typed the way it appears in an issue resolves on the first try, and a
miss says what is nearest.**

## 2. The interface

One executable, ten verbs. Every name argument goes through the same resolver (§3). Every verb
prints `file:line` for every row, carries the tier of every edge, and **never returns empty without
saying what it tried and what is nearest**.

```
axiomcode find    <name> [in=<path-substr>] [kind=fn|method|class|const|field|enum|type|any]
axiomcode uses    <name> [in=<path-substr>]         every reference, string literal and comment — the grep replacement
axiomcode show    <name | file:a-b | file:line> …   bodies, numbered; several per call
axiomcode callers <name> [depth=N]                  who calls it; depth>1 is transitive (recursive SQL, no Soufflé)
axiomcode callees <name> [depth=N]                  what it calls: resolved, library, and the sites the engine could not resolve
axiomcode path    from=<name> to=<name> [depth=N]   is there a resolved call path, and through what
axiomcode impact  <name> [depth=N]                  one call: blast radius, dispatch siblings, tests reaching, unresolved inside
axiomcode type    <T>                               members, ancestors, subtypes, code that operates on T
axiomcode at      <file>:<line>                     the method containing a location
axiomcode sql     "<SELECT>"                        over the STABLE views (§4.3) — the escape hatch
```

Conventions, the same in every verb:

- **selectors**: `bar` · `Foo.bar` · `Outer.Inner.bar` · `type=Foo method=bar` · `file#Foo.bar` ·
  `pkg.Foo.bar` · `path/file.ts:123` · `Foo(int,String)` (Java signature disambiguation).
- **`in=`** narrows by path substring; **`depth=`** defaults to 1 for callers/callees, 2 for impact,
  6 for path. Missing parameters never error — they default.
- **ambiguity**: ≤ 5 matches → the verb runs on all of them under a header naming each; > 5 → the
  list is printed with `in=` / `kind=` hints and nothing else runs.
- **output budget**: 60 rows / 4 000 characters per call, with a trailing `… N more (narrow with in=)`.
- **every path printed is repo-relative** and every printed path is logged (`_log_query.py`), which
  is what unlocks Read/Edit under the gate hook. This contract does not change.
- **language-neutral display names** (§3.2): the agent sees `Outer.Inner.method` in every language and
  never a hash, a `#`, or an absolute path.

## 3. The resolver

### 3.1 Resolution order

Given a selector and the current language, candidates are collected in this order and the first
non-empty tier wins (a later tier is only consulted when every earlier one is empty):

1. exact `qualified_name` (any language's native spelling)
2. exact **display name** (§3.2) — `Outer.Inner.method`
3. `Owner.name` suffix match on the display name (`Foo.bar` matches `a.b.Foo.bar`)
4. exact simple `name` — and for TypeScript/JavaScript the **bound name** of an anonymous function
   (`const foo = () => …` is a method named `<arrow>`; `foo` lives in `variables.boundFunctionLinkHash`)
5. case-insensitive simple name
6. prefix (`name LIKE 'foo%'`)
7. substring (`name LIKE '%foo%'`, name ≥ 3 chars)
8. camelCase / snake_case token overlap (`link meaning check` → `checkLinkMeaning`), ranked by tokens hit

`kind=` and `in=` filter every tier. Non-test declarations rank above test ones at equal tier.
A `find` that reaches tier 8 with nothing prints _"nothing declared or mentioned as `X`; nearest: …"_
and then runs `uses` for the same name (a literal or a comment often is the only evidence).

### 3.2 Display names — the one thing that differs per language

The bundle's `qualified_name` is the parser's, and the parsers do not agree. The index (§4)
computes one **display name** per symbol, of the form `[Outer.]Inner.member` (no package, no path,
no `#`), plus the repo-relative path, and stores both. What each language needs to get there:

| language | method `qualified_name` | type `qualified_name` | nesting | `file_path` |
|---|---|---|---|---|
| **java** | `pkg.Class.m` (+ `signature` column: `m(int,String):void`) | `pkg.Class`; anonymous `Outer$anon:Iface` | **outer dropped**: `class A { class B }` → `pkg.B`. 259/259 nested types in rocketmq; 85 groups of colliding names. Recovered by line containment (§5.1) | **absolute** |
| **typescript** | `src/dir/file#Class.m`, `src/dir/file#fn`; **`#<arrow>`** for every arrow (2 154 in the parser repo; the name is in `variables`) | `src/dir/file#Ns.Type` | correct (`#Types.Geometry.Shape`) | relative |
| **python** | `pkg.mod.Class.m`; locals `f.<locals>.X` | `pkg.mod.Class` | correct | relative to `--src` |
| **javascript** | `src/dir/file.name`, `<arrow>` | `src/dir/file.Class` | to verify | relative |

The resolver never asks the agent to know this table.

## 4. The index — `axiomcode-index`

`axiomcode-build` runs the engine (`bin/axiomcode all`) and then `axiomcode-index`, which reads the
language's IR through an **adapter table** (same shape as `graph/bundle/languages.ts`: header
names, never positions) and adds tables and views to `graph.sqlite`. Idempotent. When the IR is
absent (`.intermediate/ir/<lang>` not kept) the index degrades: `symbols` is built from
`methods`/`types` alone, `refs`/`literals`/`comments` are empty, and `uses` says so.

### 4.1 Tables added

```
symbols (name, display, kind, qualified_name, file, line, end_line, owner, is_test, method_id, type_id)
        every declaration: kind ∈ function | method | constructor | class | interface | enum | enum_member
                                  | type | namespace | const | variable | field | module
refs    (name, file, line, kind, entity_kind)      every place an identifier or member is USED
literals(value, file, line)                        string literals (≤ 200 chars)
comments(text, file, line, kind)                   comments and docstrings (≤ 400 chars)
nesting (type_id, outer_type_id)                   recovered by line containment — the Java fix
```

`symbols.kind` is a fixed vocabulary, the same in every language; the parser's `methodKind` /
`typeCategory` is mapped to it in the adapter (§5). `kind='function'` means a callable with no
owner type; an arrow bound to a module-scope const is `function` with `name` = the const's name.

### 4.2 What each language's IR provides (verified 2026-09-14 on `bench/dogfood/work/_probe`)

| need | java | typescript | python | javascript |
|---|---|---|---|---|
| references | `all-expressions.csv` kind `IDENTIFIER_REFERENCE` / `FIELD_ACCESS`, name in `literalValue`, file via `typeRegistryLinkHash` → types | `all-typescript-expressions.csv` kind `IDENTIFIER_REFERENCE` / `PROPERTY_ACCESS`, name = last segment of `potentialQualifiedName`, file via `tsModuleLinkHash` | `all-python-expressions.csv` kind `NAME_REFERENCE` (`literalValue`) / `ATTRIBUTE_ACCESS` (last segment of `dottedPath`), file via `pyModuleLinkHash` | `all-javascript-expressions.csv` `expressionKind` `IDENTIFIER` / `PROPERTY_ACCESS`, name in `name`, file via `ownerModuleLinkHash` |
| string literals | kind `LITERAL`, `literalType=STRING`, `literalValue` | same | same | kind `LITERAL`, `literalKind=STRING`, `text` (quoted) |
| comments | `all-comments.csv` `commentText`, `filePath` (absolute) | `all-typescript-comments.csv` | `all-python-comments.csv` `text`, `isDocstring` | `all-javascript-comments.csv` `text`, file via module |
| fields | `all-fields.csv` | `all-typescript-fields.csv` | `all-python-fields.csv` (empty in the probe — verify on a class-heavy repo) | `all-javascript-fields.csv` |
| consts / module variables | `all-local-variables.csv` has only method-scope rows; class constants are `all-fields.csv` (`static final`) | `all-typescript-variables.csv` `scopeKind=MODULE_SCOPE`, `isConst`, `boundFunctionLinkHash` | `all-python-bindings.csv` `bindingKind=MODULE_LEVEL` | `all-javascript-variables.csv` `ownerMethodLinkHash=''` (module scope), `bindingRegime` |
| enum members | `all-enum-constants.csv` | `all-typescript-enum-members.csv` | (an `Enum` subclass's class-level bindings) | none (no enums) |
| modules → path | `all-modules.csv` (one row; Java files come from types) | `all-typescript-modules.csv` | `all-python-modules.csv` | `all-javascript-modules.csv` |

### 4.3 Views — the only thing `sql` is documented against

```
symbols                                  (the table above)
callers (callee, caller, file, line, tier, kind)
callees (caller, callee, written, file, line, tier, provenance)      callee NULL when unresolved
source  (display, qualified_name, name, file, line, end_line, lines)
```

Everything else (`call_edges`, `ext_*`, hashes) stays reachable but is not documented to the agent.
A hand-written join that can return a plausible empty set is the failure mode; a view cannot.

## 5. Per-language sections — filled by the language stories

Each story verifies its column of §4.2 on a real repository, corrects its entry in the adapter table
(`A[<lang>]` in `scripts/axiomcode-index` — header names, filters and kind mapping; data, not code),
adds the resolver rules it needs in `scripts/axiomcode`, and records here what was wrong.
Acceptance for each: `find`, `uses`, `callers`, `impact` answer the 20 names in the story's
probe list on the first try; the display name for a nested member is `Outer.Inner.member`.

### 5.1 Java — issue #635
- Nested types: outer dropped in `qualified_name`. Recover with `nesting` from line containment
  (`inner.start_line > outer.start_line AND inner.end_line <= outer.end_line`, same file); display
  = `Outer.Inner`. Anonymous classes `Outer$anon:Iface` are kept as `Outer.<anon Iface>`.
- Paths are absolute; the index stores them relative to the repo root (`run.source_dir`).
- Overloads: `qualified_name` is not unique (871 groups in rocketmq); the resolver shows the
  `signature` when a selector matches more than one overload and accepts `m(int,String)`.
- Expressions carry no file: join through `typeRegistryLinkHash` → `types.file_path`.
- Base (2026-09-14): nesting recovered (707 nested types on rocketmq → `DLedgerController.RoleChangeHandler`), paths
  relative, overloads shown with signatures, `static final` → `const`, type-callers kept in the `callers` view.
- _TODO (story): the probe list; anon-class ranking; `m(int,String)` selector on real overload sets._

### 5.2 TypeScript — issue #636
- Arrow/function-expression methods are named `<arrow>` / `<function-expression>`; the bound name
  is in `variables.boundFunctionLinkHash` (238 in the parser repo, 236 of them anonymous). Class
  property arrows: check `fields.initializerExpressionLinkHash`.
- `symbols.kind` for a callable with `owner_type_id IS NULL` is `function`; the r1-sql view had
  every callable as `method`, which is one of the empties in §1.
- A TypeScript build does not index `.mjs`/`.js` files (one language per run). `find` on a name
  whose only declaration is in a `.mjs` must say _"not in the typescript graph; the file exists"_
  rather than nothing — the index records `skipped-typescript-files.csv`.
- Base (2026-09-14): the `augment.py` tables are in the adapter; arrow-bound names, `kind='function'`, and the
  `.mjs` note are implemented; the ten r1 empties in §1 all answer on the first try on `bench/dogfood/work/_probe`.
- _TODO (story): verify on `../Parser` at a task's base commit; fill the probe list._

### 5.3 Python — issue #637
- `qualified_name` is `pkg.mod.Class.m` and file paths are relative to `--src`, so a repo-relative
  path from a diff may not match; the index stores repo-relative paths.
- Module-level constants come from `all-python-bindings.csv` (`MODULE_LEVEL`), not from a fields
  file; `all-python-fields.csv` was empty on the probe — verify on a class-heavy repo (seaborn).
- Entry points are not derived for Python (`entry_points` empty) — `impact` must say so.
- Base (2026-09-14): indexes from the old `.axiom/ir` layout too; `at` with a repo path works; inherited members
  resolve (`Nominal.__call__` → `Scale.__call__`); `<classbody>` ranks below real methods in `at`.
- _TODO (story): the probe list; verify `all-python-fields.csv` on a class-heavy repo; protocol-edge labels in `callees`._

### 5.4 JavaScript — issue #638
- `qualified_name` is `src/dir/file.name` (dotted path, no `#`); `<arrow>` for arrows; no
  `signature`, no `owner_qualified_name` (the bundle notes say so).
- Library rows are prefixed with the package (`node_modules/<pkg>/…`); the resolver must never
  prefer one over a client row.
- Extra tiers (`callback_registered`, `event_dispatch`, `implicit_constructor`, `dynamic_terminal`,
  `fan_capped`) — `callers`/`callees` print them; `impact` treats only the resolved set as edges
  and reports the rest as caveats.
- _TODO (story): verify on `graph/test/javascript/realapp`; fill the probe list._

## 6. Acceptance — the bench, not a demo

The frontend replaces the `r1-sql` tool set in `bench/dogfood` (`tools/axiomcode-search`, `-sql`,
`-show`) and the skill's `axiomcode`/`axiomcode-dl`. It is accepted when, on the same tasks:

- empty graph calls fall from 21% to under 5%;
- graph calls per task fall (r1-sql median was ~17), with `first_edit_turn` and
  `ctx_before_first_edit` not worse than r1-sql;
- no gated run dies at the gate because a name could not be resolved.

`summarize.py` already computes every one of these from the transcript.

## 7. Out of scope, on purpose

- Changing the parsers' `qualified_name` (the Java nesting bug is real and is filed against the
  parser separately; the index recovers it meanwhile so the skill does not wait).
- Multi-language repositories (one language per engine run today).
- C# (a separate effort; the adapter table is where it would plug in).
- Soufflé on the agent path. The `.dl` library stays under `dl/` for engine work.
