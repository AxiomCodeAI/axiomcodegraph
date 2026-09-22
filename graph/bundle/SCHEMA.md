# The output bundle — schema

_Generated from `graph/bundle/schema.ts` (schema version 1). Do not edit; run `npm run schema-doc`._

Every run, in every language, writes the same thing:

```
<out>/
  graph.sqlite      the contract — the tables below, the ext_* tables, and this document as tables
and only with --debug:
  csv/<table>.csv   the core tables as headered, tab-delimited text (RFC 4180 quoting)
  raw/              the per-language Soufflé relations, verbatim. Engine-internal; not a contract.
```

The same schema in every language — a table a front end does not derive is **empty, not missing**, and a note below says so. Where the front ends differ (which values a column can hold, what an id may point at) the difference is written here **and** in the `schema_vocab` / `schema_notes` tables inside the database, so a query can read it without leaving SQLite:

```sql
SELECT value, meaning FROM schema_vocab WHERE table_name='call_edges' AND column_name='tier'
  AND language = (SELECT value FROM run WHERE key='language');
```

Identifiers are the parser's hashes and are opaque; join them to `methods` / `types` / `call_sites` for names and positions. NULL in SQLite is the empty field in CSV.

## How to use it (`schema_guide`)

1. This is a call graph of one codebase, derived by a type-directed Datalog engine. Start with `SELECT value FROM run WHERE key='language'` — every language-specific fact below is keyed on it.
2. The graph is `call_edges`: one row per (call site, possible target). Rows join to `methods` (names, files, lines) on `caller_id` / `callee_method_id`, and to `call_sites` on `call_site_id` for where the call is written. Identifiers are opaque hashes — never parse them, always join.
3. Trust is explicit. `tier` says what kind of claim a row is: `known_edge` (one resolved target), `multi_inferred` (a sound set — every row of the set is a real possibility), `boundary_lib` (leaves the client; not expanded further), `ambiguous_*` (a declared unknown: callee is NULL). Pick the tiers your question tolerates and filter on them; never treat an `ambiguous_*` row as an edge.
4. For a FIELD rather than a callable, the graph is `field_access`: one row per (site, resolved field), joined to `fields` on `field_id` and to `methods` on `caller_id`, with `access` saying read / write / readwrite. It carries the same four tiers and the same promise as `call_edges`, so "who writes Foo.bar" is answered with a confidence, not with a name match. Java only so far; the table is present and empty elsewhere.
5. For a TYPE, the graph is `type_use`: one row per place the type is named, with the `context` it was written in (FIELD_TYPE, METHOD_PARAM, METHOD_RETURN, OBJECT_CREATION_TYPE, CAST_EXPRESSION, SUPER_TYPE and the rest) and the `depth` that separates the type as written from its type arguments. That is what makes "what breaks if I change T" specific per construct rather than a count of mentions. Java only so far.
6. `call_edges` is what the engine CONCLUDED; `dispatch_candidates` is what the hierarchy ADMITTED. Read the second when you need an upper bound rather than a best answer — a candidate whose owner is absent from `type_instantiated` is admitted by the hierarchy but never constructed in this run, which is how you narrow it yourself. `basis` separates a declared relationship from a shape match.
7. Before answering "nothing calls X" or "X cannot reach Y", check `unresolved_sites` for the methods on the path: a caller listed there has a call the engine could not resolve, so the answer is a lower bound and should say so.
8. Library targets (`callee_provenance = lib`) are named in `methods` with `provenance = lib` but their bodies were not analysed; a Python `builtin`/`external` target has no methods row and lives in `callee_label`.
9. `schema_vocab` lists every value a column can hold FOR THIS LANGUAGE with its meaning — filter on `language = (SELECT value FROM run WHERE key='language')`. `schema_notes` lists the caveats for this language (empty tables, what an id may point at). Read both before interpreting `kind`, `tier` or an empty table.
10. `schema_queries` holds tested SQL for the common questions (callers, callees, blast radius, entry reachability, the method at a file:line, the blind spots of a method, the dispatch envelope of a method). Bind the named parameters and run.
11. Tables named `ext_<relation>` are the language's raw engine relations with positional columns c0…cN; `schema_tables` carries each one's description lifted from its rule. Use them only when a core table does not hold what you need.
12. When you report a result, carry the tier and the unresolved count with it. A consumer who cannot see the confidence of an edge cannot use it.

## Canonical queries (`schema_queries`)

Each is verified to run against every language's bundle. Bind the named parameters.

**`skipped_files`** — Which files is this graph missing, and why? (Run this before reading any absence as an answer.) _((none))_

```sql
SELECT k.file_path, k.reason, k.construct, k.start_line, k.detail,
       (SELECT count(*) FROM methods m WHERE m.file_path = k.file_path) AS methods_in_graph
FROM skipped k
ORDER BY k.reason, k.file_path
```

**`callers_of`** — Who calls this method, from where, and how sure is each edge? _(:qualified_name)_

```sql
SELECT caller.qualified_name AS caller, caller.file_path, s.start_line, e.tier, e.kind
FROM call_edges e
JOIN methods callee ON callee.id = e.callee_method_id
JOIN methods caller ON caller.id = e.caller_id
LEFT JOIN call_sites s ON s.id = e.call_site_id
WHERE callee.qualified_name = :qualified_name
ORDER BY caller.file_path, s.start_line
```

**`callees_of`** — What does this method call — resolved targets, library boundaries, and the sites it could not resolve? _(:qualified_name)_

```sql
SELECT s.start_line, s.callee_name AS written, e.tier, e.callee_provenance,
       COALESCE(t.qualified_name, e.callee_label) AS target
FROM call_edges e
JOIN methods caller ON caller.id = e.caller_id
LEFT JOIN methods t ON t.id = e.callee_method_id
LEFT JOIN call_sites s ON s.id = e.call_site_id
WHERE caller.qualified_name = :qualified_name
ORDER BY s.start_line, target
```

**`blast_radius`** — If this method changes, which methods are transitively affected, up to :depth hops, through RESOLVED client edges only (a declared unknown is not traversed, and the count of them is returned alongside)? _(:qualified_name, :depth)_

```sql
WITH RECURSIVE up(id, depth) AS (
  SELECT id, 0 FROM methods WHERE qualified_name = :qualified_name
  UNION
  SELECT e.caller_id, up.depth + 1
  FROM call_edges e JOIN up ON e.callee_method_id = up.id
  WHERE e.tier IN ('known_edge', 'multi_inferred', 'ambient_terminal', 'intrinsic_terminal')
    AND up.depth < :depth
)
SELECT MIN(up.depth) AS depth, m.qualified_name, m.file_path, m.start_line,
       (SELECT count(*) FROM unresolved_sites u WHERE u.caller_id = m.id) AS unresolved_calls_inside
FROM up JOIN methods m ON m.id = up.id
WHERE up.depth > 0
GROUP BY m.id ORDER BY depth, m.qualified_name
```

**`reachable_from_entries`** — Is this method reachable from any entry point (a main, a test, an HTTP handler, an unimported module)? _(:qualified_name)_

```sql
SELECT m.qualified_name,
       EXISTS (SELECT 1 FROM entry_reachable r WHERE r.method_id = m.id) AS reachable,
       (SELECT count(*) FROM entry_points) AS entry_points_known
FROM methods m WHERE m.qualified_name = :qualified_name
```

**`method_at`** — Which method contains this file:line? _(:file_path, :line)_

```sql
SELECT qualified_name, kind, start_line, end_line
FROM methods
WHERE file_path = :file_path AND start_line <= :line AND end_line >= :line
ORDER BY (end_line - start_line) LIMIT 1
```

**`blind_spots_of`** — Which calls inside this method could the engine not resolve — the caveat to attach to any answer about it? _(:qualified_name)_

```sql
SELECT s.start_line, s.callee_name AS written, s.kind
FROM unresolved_sites u
JOIN methods m ON m.id = u.caller_id
LEFT JOIN call_sites s ON s.id = u.call_site_id
WHERE m.qualified_name = :qualified_name
ORDER BY s.start_line
```

**`dispatch_envelope_of`** — What else might actually run at a call that resolves to this method — the set the graph narrowed from, and whether each candidate is a declaration or a shape match? _(:qualified_name)_

```sql
SELECT cand.qualified_name AS candidate, cand.file_path, cand.start_line, d.basis,
       EXISTS (SELECT 1 FROM type_instantiated i WHERE i.type_id = cand.owner_type_id) AS owner_instantiated
FROM dispatch_candidates d
JOIN methods base ON base.id = d.base_method_id
JOIN methods cand ON cand.id = d.candidate_method_id
WHERE base.qualified_name = :qualified_name
ORDER BY d.basis, cand.qualified_name
```

**`subtypes_of`** — Which types extend or implement this type (transitively)? _(:qualified_name)_

```sql
SELECT sub.qualified_name, sub.category, sub.file_path
FROM type_ancestors a
JOIN types anc ON anc.id = a.ancestor_type_id
JOIN types sub ON sub.id = a.type_id
WHERE anc.qualified_name = :qualified_name
ORDER BY sub.qualified_name
```

**`values_of`** — What can this column hold in THIS bundle's language, and what does each value mean? _(:table_name, :column_name)_

```sql
SELECT value, meaning FROM schema_vocab
WHERE table_name = :table_name AND column_name = :column_name AND language = (SELECT value FROM run WHERE key='language')
ORDER BY value
```

**`field_impact`** — Who reads or writes this field — and which of those answers are certain? _(:owner_qualified_name, :field_name)_

```sql
SELECT m.qualified_name AS accessor, fa.access, fa.tier, fa.file_path, fa.start_line
FROM field_access fa
JOIN fields f ON f.id = fa.field_id
LEFT JOIN methods m ON m.id = fa.caller_id
WHERE f.owner_qualified_name = :owner_qualified_name AND f.name = :field_name
ORDER BY fa.tier, m.qualified_name, fa.start_line
```

**`field_blind_spots`** — Which field accesses could the engine not resolve — the caveat to attach to any answer about a field?

```sql
SELECT m.qualified_name AS accessor, fa.access, fa.file_path, fa.start_line
FROM field_access fa
LEFT JOIN methods m ON m.id = fa.caller_id
WHERE fa.tier = 'ambiguous_unknown'
ORDER BY fa.file_path, fa.start_line
```

**`type_impact`** — Where is this type used, and in what construct — the answer to "what breaks if I change it"? _(:qualified_name)_

```sql
SELECT u.context, u.depth, u.tier,
       coalesce(m.qualified_name, ot.qualified_name) AS used_in,
       coalesce(m.file_path, ot.file_path) AS file_path
FROM type_use u
JOIN types t ON t.id = u.type_id
LEFT JOIN methods m ON m.id = u.owner_method_id
LEFT JOIN types ot ON ot.id = u.owner_type_id
WHERE t.qualified_name = :qualified_name
ORDER BY u.context, used_in
```

**`tier_summary`** — How much of this graph is certain, inferred, at a library boundary, or unknown?

```sql
SELECT tier, count(*) AS edges, count(DISTINCT call_site_id) AS sites
FROM call_edges GROUP BY tier ORDER BY edges DESC
```

## Core tables

### `run`

What produced this bundle: one key/value row per fact about the run (language, engine commit, inputs, knobs, timestamps, schema version). Read `language` first — it selects which vocabulary rows apply.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `key` | TEXT | yes |  |  | Fact name — see the `run.key` vocabulary. |
| 1 | `value` | TEXT |  |  |  | Fact value, as text. |

**`run.key` values**

| value | languages | meaning |
|---|---|---|
| `schema_version` | all | Version of this contract (SCHEMA.md). |
| `language` | all | Front end: java \| typescript \| python \| javascript \| csharp. Selects the applicable vocabulary rows. |
| `engine_commit` | all | Git commit of the rule set that produced the graph, when known. |
| `client_ir` | all | Path of the client IR directory the engine read. |
| `library_roots` | all | Comma-separated library IR roots staged as the type oracle; empty for a client-only run. |
| `dispatch_cap` | all | Fan-width cap on virtual dispatch in effect; `off` when uncapped. |
| `jdk_depth` | all | Platform-library hop cap (engine-ii). |
| `lib_depth` | all | External-library hop cap; `uncapped` when unset. |
| `engine_ii` | all | `on` when the library-frontier forward chain (engine-ii) was included; `off` for a client-only solve. |
| `solve_iterations` | all | Stage↔solve rounds until the library frontier converged. |
| `solve_seconds` | all | Wall-clock seconds of staging + solving, before the bundle stage. |
| `created_at` | all | ISO-8601 timestamp of the bundle. |
| `raw_dir` | all | Where the per-language Soufflé relations were read from (`raw/` next to the bundle). |
| `source_version` | all | The version the IR was stamped with (bin/axiomcode): the git commit of the analysed source, or v1.0.0 when it was not a checkout. Present when the run went through bin/axiomcode all. |
| `source_dir` | all | The source directory that was parsed. Present when the run went through bin/axiomcode all. |

### `methods`

Every callable the graph refers to: all client methods/functions from the IR, plus every LIBRARY method some edge reaches (library methods nothing reaches are not listed — a library IR is GB-scale). A module-level function is a method whose owner columns are NULL; top-level code is the module initializer method (kind MODULE_INITIALIZER in TypeScript and Python, absent in Java).

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `id` | TEXT | yes |  |  | The parser's unique hash for the method (METHOD_REGISTRY_… / TS_METHOD_… / PY_METHOD_…). The value every other table uses to refer to a method. |
| 1 | `name` | TEXT |  |  | yes | Simple name as written (`render`, `__init__`, `<init>` for a Java constructor). |
| 2 | `qualified_name` | TEXT |  |  | yes | Parser-qualified name — package/module path plus owner plus name. Unique only together with the signature. |
| 3 | `signature` | TEXT |  |  |  | Parameter-type signature as the parser prints it, e.g. `main(String[])`; language-native formatting. |
| 4 | `kind` | TEXT |  |  |  | The parser's methodKind — see vocabulary; the sets differ per language. |
| 5 | `owner_type_id` | TEXT |  | yes | yes | FK → types.id of the declaring class/interface/enum; NULL for a free function or a module initializer. |
| 6 | `owner_qualified_name` | TEXT |  | yes |  | Qualified name of the owner, denormalised so a row prints without a join; NULL when owner_type_id is NULL. |
| 7 | `file_path` | TEXT |  |  | yes | Source file, as the parser recorded it (relative to the project root it was given). |
| 8 | `start_line` | INTEGER |  |  |  | 1-based first line of the declaration. |
| 9 | `end_line` | INTEGER |  |  |  | 1-based last line of the declaration. |
| 10 | `provenance` | TEXT |  |  |  | `client` — from the analysed project; `lib` — from a staged library IR; `generated` — declared by an annotation processor and synthesised here (Java). See vocabulary. |
| 11 | `visibility` | TEXT |  | yes | yes | Declared access as the parser recorded it, normalised (PUBLIC / PROTECTED / PACKAGE / PRIVATE). NULL where the language has no access modifiers. A public or protected declaration with no dependent in this graph is exported surface, not dead code. |

**`methods.kind` values**

| value | languages | meaning |
|---|---|---|
| `METHOD` | csharp | An ordinary method. |
| `CONSTRUCTOR` | csharp | A constructor, written as one. The parser names it `<constructor>`, while a `new Foo(...)` site carries `Foo`. |
| `PRIMARY_CONSTRUCTOR` | csharp | A constructor declared in the type header: `class Svc(IDep d)`, and every positional record. It is the only constructor such a type has. |
| `STATIC_CONSTRUCTOR` | csharp | The type initializer. Static field initializers run in it; the compiler emits one only where it is needed, so it is often absent. |
| `DESTRUCTOR` | csharp | A finalizer. Called by the garbage collector, so it has no caller in the graph. |
| `OPERATOR` | csharp | A user-defined operator. `a + b` on such a type is a static call to it, with no call syntax at the site. |
| `CONVERSION_OPERATOR` | csharp | A user-defined conversion. An implicit one runs with no syntax at the call site at all. |
| `LOCAL_FUNCTION` | csharp | A function declared inside a method body. Visible only there, and it may capture the enclosing locals. |
| `LAMBDA` | csharp | A lambda body, which is its own method. Calls written in it are attributed to it, not to the method containing the lambda: the runtime reaches it through a delegate. |
| `ANONYMOUS_METHOD` | csharp | A `delegate { ... }` body. Same shape as LAMBDA. |
| `TOP_LEVEL_ENTRY_POINT` | csharp | The synthetic method holding a file of C# 9 top-level statements. An entry point, and the caller every top-level call site is attributed to. |
| `PROPERTY_GET` | csharp | A property getter. `x.Name` is a call to it. An auto-property getter has no body, which is the correct answer rather than a gap. |
| `PROPERTY_SET` | csharp | A property setter. `x.Name = v` is a call to it. |
| `PROPERTY_INIT` | csharp | An `init` accessor: settable only in an object initializer or a constructor. |
| `INDEXER_GET` | csharp | An indexer getter. `a[i]` on the read side is a call to it. |
| `INDEXER_SET` | csharp | An indexer setter. `a[i] = v`. |
| `INDEXER_INIT` | csharp | An indexer `init` accessor. |
| `EVENT_ADD` | csharp | An event `add` accessor. `e += h` is a call to it. |
| `EVENT_REMOVE` | csharp | An event `remove` accessor. `e -= h`. |
| `INSTANCE_METHOD` | java | Non-static method. |
| `STATIC_METHOD` | java | Static method. |
| `ABSTRACT_METHOD` | java | Abstract or interface method without a body. |
| `DEFAULT_METHOD` | java | Interface default method. |
| `CONSTRUCTOR` | java, typescript | Constructor (Java `<init>`; TypeScript `constructor`). |
| `STATIC_INITIALIZER` | java | `static { … }` block. |
| `GENERATED_METHOD` | java | Synthesised for a member an annotation processor declares, which is in no IR and so has no real methodKind. Always paired with provenance `generated`. |
| `ENUM_CONSTANT_METHOD` | java | Method body declared on an enum constant. |
| `RECORD_ACCESSOR` | java | A record component accessor. |
| `COMPACT_CONSTRUCTOR` | java | A record's compact canonical constructor. |
| `DEFAULT_CONSTRUCTOR` | java, typescript | The implicit no-arg constructor the parser synthesises for a class that declares none (TypeScript: and extends nothing; a subclass runs the nearest declared base constructor). |
| `INSTANCE_INITIALIZER` | java | `{ … }` instance initializer block. |
| `ANNOTATION_ELEMENT` | java | An element of an annotation interface. |
| `RECORD_EQUALS` | java | A record's implicit equals. |
| `RECORD_HASH_CODE` | java | A record's implicit hashCode. |
| `RECORD_TO_STRING` | java | A record's implicit toString. |
| `ENUM_VALUES` | java | An enum's implicit values(). |
| `ENUM_VALUE_OF` | java | An enum's implicit valueOf(String). |
| `FUNCTION_DECLARATION` | typescript | `function f() {}`. |
| `METHOD_DECLARATION` | typescript | Class or interface method. |
| `GETTER` | typescript | `get x()`. |
| `SETTER` | typescript | `set x(v)`. |
| `ARROW_FUNCTION` | typescript | Arrow function value. |
| `FUNCTION_EXPRESSION` | typescript | `function () {}` value. |
| `METHOD_SIGNATURE` | typescript | Bodiless method in an interface/type. |
| `CALL_SIGNATURE` | typescript | Interface call signature `(x): y`. |
| `CONSTRUCT_SIGNATURE` | typescript | Interface construct signature `new (x): y`. |
| `TYPE_LITERAL_METHOD_SIGNATURE` | typescript | Method signature inside a type literal. |
| `TYPE_LITERAL_CALL_SIGNATURE` | typescript | Call signature inside a type literal. |
| `TYPE_LITERAL_CONSTRUCT_SIGNATURE` | typescript | Construct signature inside a type literal. |
| `FUNCTION_TYPE_SIGNATURE` | typescript | A function type `(x) => y`. |
| `CONSTRUCTOR_TYPE_SIGNATURE` | typescript | A constructor type `new (x) => y`. |
| `OBJECT_LITERAL_METHOD` | typescript | Method in an object literal. |
| `CLASS_STATIC_BLOCK` | typescript | `static { … }` in a class. |
| `MODULE_INITIALIZER` | typescript, python | Synthetic method holding a module's top-level code. Every module has one; top-level call sites belong to it. |
| `FUNCTION` | python | Module-level `def`. |
| `INSTANCE_METHOD` | python | Method taking `self`. |
| `STATIC_METHOD` | python | `@staticmethod`. |
| `CLASS_METHOD` | python | `@classmethod`. |
| `PROPERTY_GETTER` | python | `@property`. |
| `PROPERTY_SETTER` | python | `@x.setter`. |
| `PROPERTY_DELETER` | python | `@x.deleter`. |
| `CONSTRUCTOR` | python | `__init__`. |
| `ALLOCATOR` | python | `__new__`. |
| `DUNDER_METHOD` | python | Other `__x__` method. |
| `ABSTRACT_METHOD` | python | `@abstractmethod`. |
| `OVERLOAD_STUB` | python | `@overload` signature. |
| `LAMBDA` | python | A lambda expression. |
| `NESTED_FUNCTION` | python | `def` inside a function. |
| `GENERATOR` | python | Function with `yield`. |
| `ASYNC_FUNCTION` | python | `async def`. |
| `ASYNC_GENERATOR` | python | `async def` with `yield`. |
| `CLASS_INITIALIZER` | python | Synthetic method holding a class body's top-level code. |
| `FUNCTION_DECLARATION` | javascript | `function f() {}` — hoisted. |
| `FUNCTION_EXPRESSION` | javascript | `function () {}` value, including an object literal's `m() {}`. |
| `ARROW` | javascript | Arrow function value; `this` is lexical. |
| `CLASS_METHOD` | javascript | A class member, syntactic or declared by assignment (`F.prototype.m = …`, `F.s = …`). |
| `CONSTRUCTOR` | javascript | `constructor()` of a class, or a constructor function. |
| `GETTER` | javascript | `get x()`. |
| `SETTER` | javascript | `set x(v)`. |
| `STATIC_BLOCK` | javascript | `static {}` block of a class. |
| `MODULE_INITIALIZER` | javascript | Synthetic method holding a module's top-level code. Every module has one; top-level call sites belong to it. |

**`methods.visibility` values**

| value | languages | meaning |
|---|---|---|
| `PUBLIC` | java | Callable from anywhere; exported surface. No in-repo caller does not mean unused. |
| `PROTECTED` | java | Callable by subclasses outside the package; exported surface for extension. |
| `PACKAGE` | java | Default access; callable only within the declaring package. |
| `PRIVATE` | java | Callable only within the declaring type. |

**`methods.provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | all | Declared in the analysed project. |
| `lib` | all | Declared in a staged library IR; listed because an edge reaches it. |
| `generated` | java | Declared by a compile-time annotation processor: present in the compiled artefact and in every caller's source, and in no IR, so the bundle synthesises it to give the edge a target. id `generated:<owner qualified name>#<name>/<arity>`, no file and no line numbers. |

**Notes**

- **all** — Library rows are the subset an edge reaches. To see a library method nothing calls, query the library IR itself.
- **javascript** — signature is empty and owner_qualified_name is NULL: JavaScript declares neither. owner_type_id is set for class members, including members declared by assignment.
- **javascript** — A library row's qualified_name and file_path are prefixed with the package: its path under the client when installed there (`node_modules/<pkg>/…`, nested versions included), else its package name (`<pkg>/…`; a second root with the same name gets `#2`). The parser records both relative to the package root, where two packages with an index.js are indistinguishable. Same for types.

### `types`

Every class-like declaration the graph refers to: all client types, plus every library type that owns a listed library method or appears in type_ancestors.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `id` | TEXT | yes |  |  | The parser's unique hash (TYPE_REGISTRY_… / TS_TYPE_… / PY_TYPE_…). |
| 1 | `name` | TEXT |  |  | yes | Simple name. |
| 2 | `qualified_name` | TEXT |  |  | yes | Parser-qualified name. |
| 3 | `category` | TEXT |  |  |  | The parser's typeCategory — see vocabulary. |
| 4 | `file_path` | TEXT |  | yes | yes | Source file; NULL for an external type (no declaration was staged). |
| 5 | `start_line` | INTEGER |  | yes |  | 1-based first line; NULL for an external type. |
| 6 | `end_line` | INTEGER |  | yes |  | 1-based last line; NULL for an external type. |
| 7 | `provenance` | TEXT |  |  |  | `client`, `lib`, or `external` (Java: an unstaged ancestor, see vocabulary). |
| 8 | `visibility` | TEXT |  | yes | yes | Declared access as the parser recorded it, normalised (PUBLIC / PROTECTED / PACKAGE / PRIVATE). NULL where the language has no access modifiers. |

**`types.category` values**

| value | languages | meaning |
|---|---|---|
| `CLASS` | csharp | A class. |
| `INTERFACE` | csharp | An interface. Its members may have bodies (C# 8 default implementations), so an interface method is not always an abstract stub. |
| `STRUCT` | csharp | A struct. It cannot be derived from, so a receiver of this type is exact and needs no dispatch fan. |
| `ENUM` | csharp | An enum. Cannot be derived from. |
| `DELEGATE` | csharp | A delegate type. It names a signature; a call through a value of it is resolved by value flow rather than by member lookup. |
| `RECORD` | csharp | A record declared with the `record` keyword. Also a CLASS or STRUCT underneath; the row says which via its modifiers. |
| `CLASS_TYPE` | all | A class. |
| `EXTERNAL_TYPE` | java | An unstaged ancestor named by the client — see provenance `external`. Class or interface is not known. |
| `INTERFACE_TYPE` | java, typescript | An interface. |
| `ENUM_TYPE` | java, typescript | An enum. |
| `RECORD_TYPE` | java | A record. |
| `ANNOTATION_TYPE` | java | An annotation interface. |
| `ANNOTATION_INTERFACE_TYPE` | java | An annotation interface (`@interface`), as the parser categorises it in newer output. |
| `CONST_ENUM_TYPE` | typescript | `const enum`. |
| `TYPE_ALIAS_TYPE` | typescript | `type X = …`. |
| `NAMESPACE_TYPE` | typescript | `namespace X {}`. |
| `CLASS_EXPRESSION_TYPE` | typescript | A class expression value. |
| `CLASS` | javascript | An ES class declaration. |
| `ANONYMOUS_CLASS` | javascript | A class expression. |
| `CONSTRUCTOR_FUNCTION` | javascript | A function with prototype members — a pre-ES6 class. |
| `JSDOC_TYPEDEF` | javascript | A `@typedef` — comment-only, never constructed or dispatched into. |
| `JSDOC_CALLBACK` | javascript | A `@callback` — comment-only. |
| `EXCEPTION_CLASS_TYPE` | python | A class deriving from BaseException. |
| `ENUM_CLASS_TYPE` | python | An `Enum` subclass. |
| `PROTOCOL_TYPE` | python | A `typing.Protocol`. |
| `ABC_TYPE` | python | An abstract base class. |
| `NAMEDTUPLE_TYPE` | python | A NamedTuple class. |
| `TYPEDDICT_TYPE` | python | A TypedDict class. |
| `DATACLASS_TYPE` | python | A `@dataclass`. |
| `METACLASS_TYPE` | python | A metaclass (derives from `type`). |
| `GENERIC_TYPE` | python | A `Generic[…]` class. |

**`types.provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | all | Declared in the analysed project. |
| `lib` | all | Declared in a staged library IR. |
| `external` | java | Named by the client as an ancestor (`extends`/`implements`) but declared in no staged IR: id `external:<qualified name>`, category EXTERNAL_TYPE, no file, no members. Kept so the subtype edge survives; stage the library to replace it with the real declaration. |

### `call_sites`

One row per place a call is written (or, for a synthesised edge, the construct that implies the call). Every call_edges.call_site_id is here. Location columns come from the IR; they are NULL when the site is a construct the IR does not position (see notes).

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `id` | TEXT | yes |  |  | Site identifier — an expression hash in every language; in Python it may also be a decorator hash or, for METACLASS_CREATION, the class's type hash (see notes). |
| 1 | `caller_id` | TEXT |  |  | yes | The method whose body contains the site (FK → methods.id) — or, for code that runs outside any method, the enclosing TYPE (Java: TYPE_REGISTRY_… = the type's static/instance initializer) or MODULE (TypeScript: TS_MODULE_… as a fallback marker). Never NULL. See notes. |
| 2 | `kind` | TEXT |  |  |  | What syntactic form the call takes — the same value as call_edges.kind for this site; see vocabulary (language-specific sets). |
| 3 | `callee_name` | TEXT |  | yes | yes | The name written at the site (`render` in `w.render()`, the class name in `new Widget()`); NULL when the form has no written name (a constructor delegation, a record deconstruction). |
| 4 | `file_path` | TEXT |  | yes | yes | Source file. |
| 5 | `start_line` | INTEGER |  | yes |  | 1-based line. |
| 6 | `start_column` | INTEGER |  | yes |  | Column, as the parser counts it. |
| 7 | `end_line` | INTEGER |  | yes |  | 1-based last line; NULL where the IR records only the start. |
| 8 | `end_column` | INTEGER |  | yes |  | End column; NULL where the IR records only the start. |

**Notes**

- **java** — caller_id is a TYPE_REGISTRY_ id (a types row, not a methods row) for a call written in a field initializer or a static/instance initializer block: the parser gives such code no enclosing method, and the rule set attributes it to the type — read it as "runs in this type's <clinit>/<init>".
- **typescript** — caller_id is normally the parser's caller method, or the module initializer for top-level code; when neither exists it is the TS_MODULE_ hash itself, kept as a greppable marker rather than a blank.
- **java** — callee_name for `new X()` and for `new X() { … }` (anon_new) is the class name written at the site; NULL for ctor_delegate (`this(…)`/`super(…)`) and record_accessor, which write no name. A by-name lookup must therefore exclude kind IN (new, anon_new) to avoid counting a construction as a call to a same-named method.
- **java** — A record_accessor site is the RECORD_PATTERN expression, positioned where the pattern is written.
- **python** — A DECORATOR_APPLICATION edge targets the callable the decorator factory RETURNS, not the name written at the `@` — `@deco(X)` applies the inner callable that `deco` returned. The written name is carried by the separate DECORATOR_CALL row, so a by-name lookup must exclude DECORATOR_APPLICATION or it will read the wrapper as a mismatch.
- **typescript** — end_line / end_column come from the expression row; the call-site row itself records only the start.
- **javascript** — caller_id is the parser's enclosing method, or the module initializer for top-level code. end_line / end_column come from the expression row. `require()` is a module edge, not a call site.
- **typescript** — PROPERTY_READ and PROPERTY_WRITE rows are accessor invocations with no written call: the site is the property-access expression that runs the getter or setter, positioned from the expressions table, and callee_name is NULL because nothing was written; the accessor's name is on the callee's methods row. Filter them out with kind NOT IN (…) when counting calls.
- **python** — PROPERTY_READ, CONTEXT_MANAGER, ITERATION_PROTOCOL, METACLASS_CREATION and DYNAMIC_CALL rows are protocol or indirect edges with no written call: their site is the expression that triggers them, and callee_name is always NULL because nothing was written. SUBSCRIPT_CALL is NULL only when the subscript is not a written name (measured 206 of 337 rows on a Python subject). Filter them out with kind NOT IN (…) when counting calls.
- **python** — The id is an EXPRESSION hash for a written call; a DECORATOR hash (PY_DECORATOR_…) for DECORATOR_APPLICATION and DECORATOR_* sites, positioned at the decorator line; and the class's TYPE hash for METACLASS_CREATION, positioned at the class declaration.

### `call_edges`

THE GRAPH. One row per (site, resolved target). A site with N possible targets has N rows, each carrying the same tier; a site the engine could not resolve has exactly one row with a NULL callee and an `ambiguous_*` tier — so every call site written in the client appears at least once, and the table alone shows where every chain ends and why. Filter on `tier` to choose your risk tolerance.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `call_site_id` | TEXT |  |  | yes | FK → call_sites.id. |
| 1 | `caller_id` | TEXT |  |  | yes | Same value as call_sites.caller_id for this site: the containing method, or the enclosing type/module id when there is none (see call_sites). |
| 2 | `callee_method_id` | TEXT |  | yes | yes | FK → methods.id of the resolved target, when the target is a method the bundle knows (callee_provenance client or lib). NULL otherwise. |
| 3 | `callee_label` | TEXT |  | yes |  | The target when it is NOT a method row: a builtin (`builtin:len`) or an import path outside every staged IR (`requests.get`) — Python only today. NULL when callee_method_id is set or the site is unresolved. |
| 4 | `callee_provenance` | TEXT |  | yes |  | Where the target lives — see vocabulary. NULL for an unresolved site. |
| 5 | `tier` | TEXT |  |  | yes | Confidence class of this edge — see vocabulary. `known_edge` and `multi_inferred` are assertions about client code; `boundary_lib` leaves the client; the `ambiguous_*` tiers are declared blind spots, not edges. |
| 6 | `kind` | TEXT |  |  |  | Syntactic form of the site — see vocabulary; language-specific sets, kept native. |

**`call_edges.kind` values**

| value | languages | meaning |
|---|---|---|
| `method` | csharp | A call written with or without a receiver: `a.M()`, `M()`, `a?.M()`. |
| `new` | csharp | An object creation. The target is the constructed type's constructor, and it is never dispatched. |
| `ctor_delegate` | csharp | `: this(...)` or `: base(...)`. No name is written, so the target is structural. |
| `primary_ctor_base` | csharp | SYNTHESISED. A primary constructor's base invocation, written in the heritage clause: `class D(int a) : B(a)`. There is no call syntax anywhere in the body. FromExpr is the heritage type reference. |
| `delegate` | csharp | A call through a delegate value: `handler(x)` or `handler.Invoke(x)`. |
| `operator` | csharp | A user-defined operator invoked by operator syntax. |
| `conversion` | csharp | A user-defined conversion. An implicit one has no syntax at the call site. |
| `indexer` | csharp | A user-defined indexer accessor, invoked by `a[i]`. |
| `dynamic` | csharp | A call through a `dynamic` value. Dispatched at runtime by the DLR, so the target is undecidable from source; the tier is ambiguous_dynamic and that is final, not a gap. |
| `other` | csharp | A call kind this engine has no rule for. Present so a kind added to the schema later is unresolved rather than invisible. |
| `method` | java | `obj.m()`, `Class.m()`, `super.m()`, or an unqualified `m()`. |
| `new` | java | `new X(…)`. |
| `ref` | java | A method reference `X::m`, `obj::m`, `X::new`. |
| `lambda_body` | java | An edge from the method that INVOKES a lambda to something the lambda body calls. The body is not a method of its own, so its calls are attributed to the invoker rather than lost (call-edge-generation/lambda_dispatch.dl). |
| `ctor_delegate` | java | `this(…)` / `super(…)` inside a constructor. |
| `anon_new` | java | `new X() { … }` — an anonymous class creation. |
| `record_accessor` | java | Synthesised: a record pattern `case Pair(var l, var r)` calls each accessor. Not a written call; the site is the pattern expression. |
| `FUNCTION_CALL` | typescript | `f(…)` — a bare callee. |
| `METHOD_CALL` | typescript | `obj.m(…)`. |
| `CONSTRUCTOR_CALL` | typescript | `new X(…)`. |
| `SUPER_CALL` | typescript | `super(…)` or `super.m(…)`. |
| `TAGGED_TEMPLATE_CALL` | typescript | tag`…`. |
| `INDEX_CALL` | typescript | `obj[k](…)` through an index signature. |
| `DYNAMIC_IMPORT_CALL` | typescript | `import(…)`. |
| `DECORATOR_CALL` | typescript | A decorator application `@d` / `@d(…)`. |
| `OPTIONAL_CALL` | typescript | `f?.(…)`. |
| `JSX_COMPONENT_CALL` | typescript | `<Component …/>` (reserved by the parser; emitted by nothing yet). |
| `PROPERTY_READ` | typescript | Reading `obj.x` where `x` is a `get` accessor runs the getter (engine-authored). No written call; the site is the property-access expression. A compound assignment or `++` reads before it writes, so it carries this and PROPERTY_WRITE. |
| `PROPERTY_WRITE` | typescript | Assigning `obj.x = v` where `x` is a `set` accessor runs the setter (engine-authored). No written call; the site is the property-access expression on the left. |
| `FUNCTION_CALL` | javascript | `f(…)` — a bare callee, resolved by the binder. |
| `METHOD_CALL` | javascript | `obj.m(…)`. |
| `CONSTRUCTOR_CALL` | javascript | `new X(…)`. |
| `SUPER_CALL` | javascript | `super(…)`. |
| `COMPUTED_CALL` | javascript | `obj[expr](…)` — the name is not fixed by syntax. |
| `FUNCTION_CALL_CALL` | javascript | `f.call(o, …)` — the target is f; the receiver moved into argument position. |
| `FUNCTION_CALL_APPLY` | javascript | `f.apply(o, args)` — the target is f. |
| `FUNCTION_CALL_BIND` | javascript | `f.bind(o)` — produces a function that runs f; the edge names f. |
| `IIFE_CALL` | javascript | `(function () {…})()`. |
| `OPTIONAL_CALL` | javascript | `obj?.m(…)`. |
| `TAGGED_TEMPLATE_CALL` | javascript | tag`…`. |
| `DYNAMIC_CODE_CALL` | javascript | `eval(…)` / `new Function(…)` — unknowable by construction. |
| `DYNAMIC_IMPORT_CALL` | javascript | `import(…)` — a module load that is also a site. |
| `SIMPLE_CALL` | python | `f(…)` — a bare name. |
| `METHOD_CALL` | python | `obj.m(…)`. |
| `CHAINED_CALL` | python | `a.b().c(…)` — the receiver is itself a call. |
| `SUPER_CALL` | python | `super().m(…)`. |
| `SELF_CALL` | python | `self.m(…)`. |
| `CLS_CALL` | python | `cls.m(…)`. |
| `MODULE_CALL` | python | `module.f(…)` on an imported module. |
| `SUBSCRIPT_CALL` | python | `d[k](…)`. |
| `DYNAMIC_CALL` | python | Callee computed at runtime (`getattr(...)()` and the like). |
| `DECORATOR_CALL` | python | The factory call of a parenthesised decorator `@d(…)`. |
| `INSTANCE_CALL` | python | Calling an instance — dispatches to `__call__`. |
| `BUILTIN_CALL` | python | The parser recognised a builtin (`len`, `print`, …). |
| `UNKNOWN_CALLEE_CALL` | python | The parser could not classify the callee. |
| `DECORATOR_APPLICATION` | python | Applying a parenthesised decorator's RESULT to the decorated definition. The site is the decorator hash. |
| `DECORATOR_*` | python | Applying an unparenthesised decorator; the suffix is the parser's decorator kind: BARE, ATTRIBUTE, SUBSCRIPT, EXPRESSION (and CALL/ATTRIBUTE_CALL when the factory expression is not itself a call site). The site is the decorator hash. |
| `METACLASS_CREATION` | python | A class statement invokes its metaclass's `__new__` / `__init__` at import time, whether the metaclass is written on the statement (`class X(metaclass=M)`) or inherited from a base, and the nearest base's `__init_subclass__`. No written call; the site is the class's type hash. |
| `PROPERTY_READ` | python | Reading `obj.attr` where `attr` is a `@property` runs the getter; reading `Cls.attr` where the METACLASS defines `attr` as a property runs that getter. No written call; the site is the attribute-access expression. |
| `CONTEXT_MANAGER` | python | `with expr:` runs `__enter__` / `__exit__` (or the async pair). No written call; the site is the context-manager expression. |
| `ITERATION_PROTOCOL` | python | `for x in expr:` (and comprehensions) runs `__iter__` / `__next__` (or the async pair). No written call; the site is the iterated expression. |

**`call_edges.tier` values**

| value | languages | meaning |
|---|---|---|
| `ambiguous_dynamic` | csharp | A call through `dynamic`. Unresolvable BY DESIGN rather than by omission, and separated from ambiguous_unknown so a known-undecidable site is not counted as an engine failure. |
| `known_implicit_ctor` | csharp | `new Foo()` where Foo declares no constructor. The compiler supplies a parameterless one, so there is no user code to call and nothing resolving is the right answer. |
| `known_edge` | all | Exactly one target resolved. The strongest claim. |
| `multi_inferred` | all | A sound SET of possible targets; each member is one row. The set over-approximates — every member is a real possibility, but not every member runs. HOW WIDE the set is differs by language: see the per-language notes on this table for whether the fan is narrowed by the instantiation set. |
| `boundary_lib` | all | The target is outside the client (library, builtin, or unstaged external). The chain is not expanded past it here. |
| `ambiguous_unknown` | all | Declared blind spot: the engine could not resolve the site (unresolved receiver, missing type, reflection…). callee is NULL. Never dropped. |
| `ambiguous_anon` | java | Known structural gap: an anonymous-class creation has no candidate rule yet. callee is NULL. |
| `ambient_terminal` | typescript | The target is an ambient declaration (a `.d.ts` signature with no body anywhere) — resolved, but there is nothing to expand into. |
| `ambient_terminal` | javascript | The callee or receiver VALUE is the platform (`console.log`, `path.join`, `arr.forEach`) — a correct end, not a blind spot; callee is NULL. Beside a project edge it is the platform ALTERNATIVE of a `multi_inferred` site. |
| `implicit_constructor` | javascript | `new C()` / `super()` where no constructor exists up the chain: the synthesized default runs. A correct end; callee is NULL. |
| `dynamic_terminal` | javascript | `obj[expr]()`, `eval`, `import()`: no static target by construction; callee is NULL. |
| `fan_capped` | javascript, java | More targets than --dispatch-cap: the set was refused rather than emitted. JavaScript: callee is NULL. Java: callee is the declared base method the fan would have started from; dispatch-capped-sites.csv carries the refused count. |
| `callback_registered` | javascript | The site HANDS the callee this function (`xs.forEach(f)`, `p.then(f)`, `emitter.on('x', h)`, `setTimeout(f)`), which may invoke it. Not the site's own callee; a reachability edge, labelled so it is never read as a resolved call. |
| `event_dispatch` | javascript | `x.emit('name')` reaching a handler registered by `x.on('name', h)` on a value x may hold — name-sensitive for literal names, every handler on that value for a computed one. |
| `intrinsic_terminal` | typescript | The site is a JSX intrinsic element or a dynamic `import()` — a runtime intrinsic, not a function the graph can name. |

**`call_edges.callee_provenance` values**

| value | languages | meaning |
|---|---|---|
| `external` | all | The target is outside every staged IR. callee_method_id is NULL and callee_label names it, as `external:<Type>.<Member>`. A client-only run of a C# project reaches the BCL this way for most of its calls. |
| `client` | all | Target is a client method (callee_method_id set). |
| `lib` | all | Target is a method of a staged library IR (callee_method_id set, methods.provenance = lib). |
| `builtin` | python | Target is a CPython builtin with no Python source (callee_label = `builtin:NAME`). |
| `external` | python, java | Target is outside every staged IR and has no methods row. Python: an import path (callee_label = the written path). Java: a method of an unstaged ancestor type (callee_label = `external:<type>.<name>`), reached through a receiver declared as that type or inherited by a client subclass; see types.provenance external. |

**Notes**

- **javascript** — Targets are VALUES the receiver may hold, not declared types: a `multi_inferred` set is the union of what flowed into the receiver. An untyped receiver is `ambiguous_unknown`, never a name match.
- **python** — A `boundary_lib` edge may point at a builtin (callee_provenance builtin, callee_label `builtin:NAME`) or at an unstaged import path (callee_provenance external) — neither has a methods row.
- **java** — A `boundary_lib` edge with callee_provenance external names a method of an ancestor type no staged IR declares (callee_label `external:<type>.<name>`, no methods row). A site whose receiver is declared as such a type is multi_inferred even with one client override: the platform method itself, and the platform's own subclasses, are the other possible targets. Stage the library to replace the label with the real method.
- **python** — The reason a site is ambiguous_unknown is exported per site in ext_call_site_unresolved (site, caller, reason, detail).
- **all** — THE TRUST LINE, and it is not the same set of tiers in every language. RESOLVED (callee_method_id is set): known_edge, multi_inferred, boundary_lib, and in TypeScript ALSO ambient_terminal and intrinsic_terminal. BLIND SPOT (callee is NULL): ambiguous_unknown, and in Java ALSO ambiguous_anon. A filter written as `tier IN (known_edge, multi_inferred)` therefore drops resolved edges in TypeScript and nowhere else — derive the set from this note or from unresolved_sites, never from a hardcoded list.
- **java** — A multi_inferred fan is CHA-wide: it is every override the hierarchy admits, bounded only by the dispatch cap. type_instantiated is computed and exported but NOT read by any rule, so the fan is not narrowed to types the program constructs. Narrow it yourself by joining dispatch_candidates to type_instantiated — see the dispatch_envelope_of query. A receiver is ALSO typed by what flows into it (a local's initializer, the arguments callers pass to a parameter, the receivers callers invoke a method on for its `this`), and each flow-in type resolves its member directly, outside the fan: that is why a `fan_capped` site still carries edges, and why they are the types the program was seen to hand over, not the whole hierarchy.
- **typescript** — A multi_inferred fan is CHA-wide, as in Java: type_instantiated is computed and exported but NOT read by any rule. The fan also has sources that are not virtual dispatch at all — an overload set or a union-typed receiver produces one too.
- **python** — A multi_inferred fan IS narrowed by the instantiation set: type_instantiated_reachable (the constructed classes and their bases) bounds dispatch in resolution/dispatch.dl. Python is the only front end where that narrowing is applied, so a fan here is tighter than the same shape would be in Java or TypeScript.
- **all** — The raw relation has a seventh column, ToExpr, that is always `-` (reserved). It is dropped here.
- **all** — An unresolved site (tier ambiguous_*) has NULL callee_method_id, callee_label and callee_provenance. The raw relation writes `-` in those slots.

### `type_ancestors`

Transitive supertype closure: (type, ancestor) for every ancestor reachable through extends/implements/bases, client and library alike. Not a member-inheritance claim — in TypeScript an `implements` edge inherits nothing (the rule set keeps two closures; this is the conformance one).

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `type_id` | TEXT | yes |  | yes | FK → types.id. |
| 1 | `ancestor_type_id` | TEXT | yes |  | yes | FK → types.id. |

### `dispatch_candidates`

THE DISPATCH ENVELOPE: (base method, method that may run instead) for every call that statically resolves to the base. This is the set `call_edges` narrowed FROM — the difference between "these are the targets" and "these are the targets, out of these possibilities". Populated in every language; `basis` says what admitted the pair, because the three front ends admit by different means.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `base_method_id` | TEXT | yes |  | yes | FK → methods.id — the method a call resolves to statically. |
| 1 | `candidate_method_id` | TEXT | yes |  | yes | FK → methods.id — a method that may run instead at such a call. |
| 2 | `basis` | TEXT | yes |  |  | What admitted the pair — see vocabulary. Filter on it to trust only declarations. |

**`dispatch_candidates.basis` values**

| value | languages | meaning |
|---|---|---|
| `nominal` | java, typescript | A written extends/implements reaches the candidate's owner from the base's owner. The strongest evidence there is: the author declared the relationship. |
| `structural` | typescript | No declaration; the candidate's owner satisfies the base's owner by SHAPE. Emitted only for supertypes with no nominal implementor at all, so it never competes with a declared answer — but it is a heuristic, and a consumer that wants declarations only filters it out. |
| `mro` | python | The subtype's C3 linearisation picks the candidate for that attribute name. Not merely "the subtype declares this name" — a name a sibling base wins is attributed to that sibling. |

### `overrides`

Virtual-dispatch pairs: (base method, overriding method) wherever a call to the base may run the override. Java only, and kept for compatibility — it is exactly `dispatch_candidates` filtered to `basis = nominal`. Prefer `dispatch_candidates`, which is populated in every language.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `method_id` | TEXT | yes |  | yes | FK → methods.id — the base (declared) method. |
| 1 | `overriding_method_id` | TEXT | yes |  | yes | FK → methods.id — the override in a subtype. |

**Notes**

- **typescript** — EMPTY — this table is Java-shaped. The TypeScript dispatch envelope is in dispatch_candidates, with basis `nominal` or `structural`.
- **python** — EMPTY — this table is Java-shaped. The Python dispatch envelope is in dispatch_candidates with basis `mro`; the raw linearisation is in ext_mro_position.

### `entry_points`

Methods the runtime invokes without a client call site — process roots, test methods, HTTP handlers, framework hooks. The seeds of entry_reachable.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `method_id` | TEXT | yes |  | yes | FK → methods.id. |
| 1 | `reason` | TEXT | yes |  |  | Why it is an entry — see vocabulary. |

**`entry_points.reason` values**

| value | languages | meaning |
|---|---|---|
| `main` | java | A static `main`. |
| `test` | java, typescript | Java: a JUnit test or lifecycle method. TypeScript: a function body handed to a test registrar (`it`, `describe`), inline or named, which the runner invokes. |
| `http` | java, python, typescript | A route handler a web framework invokes on a request. Java: a JAX-RS / Spring MVC handler. Python: a function registered with a decorator naming an HTTP verb and a URL path. TypeScript: a handler passed to a route registration (`app.get('/x', h)`), inline or named, or a method carrying a route decorator inside a container-owned class (`@Controller` + `@Get`). |
| `cli` | java | A CLI command method (picocli etc.). |
| `bean_ctor` | java, typescript | Constructor of a container-managed class. TypeScript: the class carries a framework decorator (`@Injectable`, `@Component`, `@Module`), so the container constructs it and nothing in the repository does. |
| `factory` | java | A `@Bean` factory method. |
| `lifecycle` | java, typescript | Java: `@PostConstruct` / `@PreDestroy` and similar hooks. TypeScript: a hook the container calls by name on a decorated class (`ngOnInit`, `onModuleInit`), which has no call site anywhere. |
| `queue` | java | A message-listener method. |
| `scheduled` | java | A `@Scheduled` method. |
| `grpc_service` | java, python | A gRPC service implementation the server invokes on a request, with no call site reaching it: a generated `ImplBase` override (Java); a class deriving from a generated `*Servicer` base in a `_pb2_grpc` module, overriding a method that base declares (Python). |
| `unimported_module` | typescript, javascript | The initializer of a module nothing imports — a script or a bundle root. |
| `task` | python | A function registered as a queue task. A worker process runs the body; the producer only enqueues, so nothing in the client calls it. |
| `fixture` | python | A declared fixture that some collected test requests by parameter name. The runner calls it to build the argument. |
| `url` | python | A view named as a value in a module-level route table. The framework calls it on a request. |
| `signal_receiver` | python | A handler attached to a signal, by decorator or by connect(). It runs when the signal fires, whether or not this tree contains the send. |
| `di_provider` | python | A provider named in a dependency-injection marker in a parameter default. The framework calls it and passes the result in. |
| `orm_hook` | python | A lifecycle or validation hook registered by decoration. The data layer calls it; nothing in the client does. |

**Notes**

- **python** — EMPTY. The Python rule set does not derive entry points; entry_reachable is therefore empty too.

### `entry_reachable`

Methods reachable from some entry point through call_edges (client edges only). A method absent here is dead from every known entry — or reachable only through a declared unknown.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `method_id` | TEXT | yes |  |  | FK → methods.id. |

### `unresolved_sites`

The blind spots, attributed to the code that contains them: (caller, site) for every call site whose tier is `ambiguous_*` — a declared unknown, not an edge. A change-impact answer computed from a caller listed here is a lower bound. Derived from call_edges, so it is present in every language.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `caller_id` | TEXT | yes |  | yes | Same domain as call_sites.caller_id: usually FK → methods.id. |
| 1 | `call_site_id` | TEXT | yes |  |  | FK → call_sites.id. |

### `fields`

Every field-like storage location the graph refers to: all client fields and enum constants from the IR, plus every LIBRARY field some field_access edge reaches OR some config_binding row names. A field is not a callable, so it has no row in `methods`; this is where `field_access.field_id` resolves to a name, an owner and a position.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `id` | TEXT | yes |  |  | The parser's unique hash for the field or enum constant (FIELD_REGISTRY_… / ENUM_CONSTANT_…). The value field_access.field_id refers to. |
| 1 | `name` | TEXT |  |  | yes | Simple name as written (`count`, `RED`). |
| 2 | `kind` | TEXT |  |  |  | `field` or `enum_constant` — see vocabulary. An enum constant is a static final field of its enum and is recorded here so `Colour.RED` resolves like any other read. |
| 3 | `owner_type_id` | TEXT |  | yes | yes | FK → types.id of the declaring class/interface/enum/record. |
| 4 | `owner_qualified_name` | TEXT |  | yes |  | Qualified name of the owner, denormalised so a row prints without a join. |
| 5 | `type_name` | TEXT |  | yes |  | The declared type as the parser wrote it; NULL for an enum constant, whose type is its own enum. |
| 6 | `modifiers` | TEXT |  | yes |  | The parser's comma-separated modifier set (`STATIC,FINAL`); NULL where the IR records none. |
| 7 | `file_path` | TEXT |  | yes | yes | Source file. |
| 8 | `start_line` | INTEGER |  | yes |  | 1-based first line of the declaration. |
| 9 | `end_line` | INTEGER |  | yes |  | 1-based last line. |
| 10 | `provenance` | TEXT |  |  |  | `client` — from the analysed project; `lib` — from a staged library IR; `generated` — declared by an annotation processor and synthesised here (Java). See vocabulary. |

**`fields.kind` values**

| value | languages | meaning |
|---|---|---|
| `field` | csharp | A field declaration, including a `const`. |
| `field` | java, typescript | An ordinary field declaration. |
| `enum_constant` | java | An enum constant. It is a static final field of its enum, and is listed here so `Colour.RED` resolves like any other read; the parser gives it its own table and its own hash prefix. |

**`fields.provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | csharp | Declared in the analysed project. |
| `lib` | csharp | Declared in a staged library IR. |
| `client` | java, typescript | Declared in the analysed project. |
| `lib` | java, typescript | Declared in a staged library IR. |
| `generated` | java | Declared by a compile-time annotation processor and synthesised by the bundle, same shape and same reason as methods.provenance `generated`. |

**Notes**

- **all** — JAVA AND TYPESCRIPT, for the same reason as field_access: declared everywhere, populated by those two front ends.
- **typescript** — An enum member is absent: the parser gives it its own table with no declared type, and the property-access relation resolves through the field table. `Colour.Red` is therefore an unresolved field access, unlike Java where an enum constant is a fields row.
- **java** — A library field is listed when some field_access edge reaches it, exactly as methods lists only the library methods an edge reaches, OR when a config_binding row names it as the field a configuration key binds to. The second was added in #890: a @Value field on a library type that nothing reads has no access edge, so config_binding named a field the table did not list and the join lost the row silently.

### `field_access`

THE DATA GRAPH. One row per (site, resolved field), and the answer to "who reads or writes this field" — the question call_edges cannot answer, because a field access is not a call. A site with N possible fields has N rows carrying the same tier; a site the engine could not resolve has exactly one row with a NULL field and tier `ambiguous_unknown`, so every field access written in the client appears at least once and the table alone shows where the resolution stopped. A field is NOT virtually dispatched: a `known_edge` row names the storage location, not a best estimate of one.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `site_id` | TEXT |  |  | yes | The expression where the access is written. Not a call_sites id: a field access is not a call site. The location columns on this row are the site's own. |
| 1 | `caller_id` | TEXT |  |  | yes | The method whose body contains the access (FK → methods.id) — or, for an access written in a field initializer or an initializer block, the enclosing TYPE, exactly as call_sites.caller_id does. Never NULL. |
| 2 | `field_id` | TEXT |  | yes | yes | FK → fields.id of the resolved field or enum constant. NULL when the site is unresolved. |
| 3 | `field_provenance` | TEXT |  | yes |  | Where the field is declared — `client` or `lib`. NULL for an unresolved site. |
| 4 | `access` | TEXT |  |  | yes | Which way the data moves — see vocabulary. Present on an unresolved row too: the direction is decided by how the access is WRITTEN, which does not need the receiver to resolve. |
| 5 | `tier` | TEXT |  |  | yes | Confidence class of this edge — see vocabulary. Same four values and same promises as call_edges.tier. |
| 6 | `file_path` | TEXT |  | yes | yes | Source file of the site. |
| 7 | `start_line` | INTEGER |  | yes |  | 1-based line of the site. |
| 8 | `start_column` | INTEGER |  | yes |  | Column, as the parser counts it. |
| 9 | `end_line` | INTEGER |  | yes |  | 1-based last line. |
| 10 | `end_column` | INTEGER |  | yes |  | End column. |

**`field_access.access` values**

| value | languages | meaning |
|---|---|---|
| `read` | java, typescript | The value is used and not replaced. |
| `write` | java, typescript | The value is replaced without being read: a plain assignment `f = v`. |
| `readwrite` | java, typescript | The value is read and replaced at the one site: a compound assignment `f += v`, or `f++` / `--f`. One row, not two — a consumer asking "who writes f" and one asking "who reads f" must both match it. |

**`field_access.tier` values**

| value | languages | meaning |
|---|---|---|
| `known_edge` | java, typescript | Exactly one field resolved. Stronger than the call_edges tier of the same name: a field is not virtually dispatched, so this IS the storage location the access binds to. |
| `multi_inferred` | java, typescript | A sound SET: the receiver has more than one possible type, or two unrelated ancestors declare the name (which Java itself treats as ambiguous). Each member is one row. |
| `boundary_lib` | java, typescript | The field is declared in a staged library type. field_id is set and resolves in `fields` with provenance lib. |
| `ambiguous_unknown` | java, typescript | Declared blind spot: the receiver could not be typed, or the name is not a member of the type it was typed to. field_id is NULL. Never dropped, and never replaced by a match on simple name. |

**`field_access.field_provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | java, typescript | The field is declared in the analysed project. |
| `lib` | java, typescript | The field is declared in a staged library IR. |

**Notes**

- **all** — JAVA AND TYPESCRIPT. The table is declared in every bundle and is EMPTY for Python and JavaScript, so the schema does not churn as the remaining front ends land (#663). Check `SELECT count(*) FROM field_access` before reading an empty result as "nothing reads this field".
- **typescript** — AN ACCESSOR IS NOT HERE. `get url()` read as `c.url` is a CALL, and call_edges already carries it with kind PROPERTY_READ or PROPERTY_WRITE (#703). The two tables are disjoint by construction: this one holds properties, call_edges holds accessors. Ask both when you want every read of a member.
- **typescript** — AN ELEMENT ACCESS IS NOT HERE either: `obj["x"]` with a literal key is a different node kind and is not yet a site. A known gap, not a silent one.
- **typescript** — A METHOD IS NOT A SITE. The callee of `obj.m()` is a PROPERTY_ACCESS node (37% of them, measured on immer), and `const f = obj.m` reads a method as a value; neither is a data edge, and admitting them would fill the ambiguous_unknown tier with sites the engine HAS resolved elsewhere. Both are excluded and counted in ext_field_site_excluded with reasons method_callee and method_value.
- **java** — A field access written in a SWITCH CASE LABEL is deliberately absent. An enum constant in a case label is recorded TYPE for some arms and FIELD for others (#760), and javac compiles the switch through a $SwitchMap array rather than through a read of the constant, so there is no field access in the bytecode either.
- **java** — A field read that PRECEDES a same-named local declared later in the same method is missing: the parser classifies such a name LOCAL_VARIABLE against the whole body rather than against the scope at the use site (#725), so the site never reaches the engine and is absent rather than ambiguous. Rare (1 in 5,647 local references measured) but it is an absence, not a declared unknown.
- **java** — ARRAY ELEMENTS are not tracked: `a[i] = v` where `a` is a field is recorded as a READ of `a` (the array reference is read; the element write is not a field write). This matches the bytecode, where the instruction is `getfield a` followed by `aastore`.

### `type_use`

THE OTHER HALF OF CHANGE IMPACT: one row per place a type is NAMED, with the context it was written in. `call_edges` says who calls a method and `field_access` who touches a field; this says what breaks if the TYPE changes — every signature, field, local, `new`, cast, `instanceof`, throws clause and generic argument that mentions it. A name that resolved to nothing is one row with a NULL type and tier `ambiguous_unknown`, so an unstaged third party is a declared unknown rather than an absence.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `reference_id` | TEXT |  |  | yes | The type-reference node. Not an expression id: a type reference is its own IR entity. |
| 1 | `type_id` | TEXT |  | yes | yes | FK → types.id of the type the name denotes. NULL when it resolved to nothing. |
| 2 | `context` | TEXT |  |  | yes | Where the reference is written — see vocabulary. This is the column that makes an impact answer specific: `seventeen METHOD_PARAM and four FIELD_TYPE`, not `twenty-one mentions`. |
| 3 | `depth` | INTEGER |  |  |  | 0 for the type as written, 1 or more for a type argument of the one above it. A field of type `Map<String, Widget>` yields Map at depth 0 and String and Widget at depth 1; all three are uses of the type named. |
| 4 | `owner_kind` | TEXT |  |  |  | What kind of declaration carries the reference — see vocabulary. It says what `owner_id` points at. |
| 5 | `owner_id` | TEXT |  |  |  | The declaration that carries the reference. FK → methods.id when owner_kind is METHOD, → types.id for TYPE, → fields.id for FIELD; for METHOD_PARAM, LOCAL_VARIABLE, EXPRESSION and the annotation kinds it is the parser hash of an entity the bundle does not table, so join on owner_method_id / owner_type_id instead. |
| 6 | `owner_method_id` | TEXT |  | yes | yes | FK → methods.id of the method whose declaration or body contains the reference; NULL where there is none (a field type, a supertype clause). |
| 7 | `owner_type_id` | TEXT |  | yes | yes | FK → types.id of the type whose source contains the reference. Set for every reference written inside a type declaration. |
| 8 | `type_provenance` | TEXT |  | yes |  | Where the referenced type is declared — `client` or `lib`. NULL when unresolved. |
| 9 | `tier` | TEXT |  |  | yes | Confidence class — see vocabulary. Same four values and same promises as call_edges.tier. |

**`type_use.tier` values**

| value | languages | meaning |
|---|---|---|
| `known_edge` | java, typescript | Exactly one type. A type reference is not dispatched, so this IS the declaration the name denotes. |
| `multi_inferred` | java, typescript | A sound SET: two resolution paths both answer a simple name. Each member is one row. |
| `boundary_lib` | java, typescript | The type is declared in a staged library IR. type_id resolves in `types` with provenance lib. |
| `ambiguous_unknown` | java, typescript | Declared blind spot: the name resolved to nothing — an unstaged third party, or a type variable with no bound in view. type_id is NULL. Never dropped. |

**`type_use.type_provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | java, typescript | The referenced type is declared in the analysed project. |
| `lib` | java, typescript | The referenced type is declared in a staged library IR. |

**`type_use.owner_kind` values**

| value | languages | meaning |
|---|---|---|
| `TYPE` | java, typescript | The reference is on the type declaration itself: an extends or implements clause, or a type parameter bound. owner_id is a types.id. |
| `METHOD` | java, typescript | A return type, a throws clause, or a method type-parameter bound. owner_id is a methods.id. |
| `METHOD_PARAM` | java, typescript | A formal parameter's declared type. owner_id is the parameter's parser hash; join on owner_method_id. |
| `FIELD` | java, typescript | A field's declared type. owner_id is a fields.id. |
| `LOCAL_VARIABLE` | java | A local, a catch parameter or a resource's declared type. owner_id is the local's parser hash; join on owner_method_id. |
| `EXPRESSION` | java, typescript | A type written inside an expression: `new T()`, a cast, an `instanceof`, a pattern, a method-reference qualifier. owner_id is the expression hash; join on owner_method_id. |
| `ANNOTATION` | java | The annotation type itself, on whatever it annotates. |
| `ANNOTATION_ARGUMENT` | java | A type named as an annotation argument, e.g. a `Class<?>` value. |
| `VARIABLE` | typescript | A `const` / `let` declaration's written type. A module-scope variable is a first-class declaration in TypeScript, so this covers what Java splits between FIELD and LOCAL_VARIABLE. |
| `HERITAGE` | typescript | An extends or implements clause, which the parser gives its own entity rather than hanging off the type. |
| `TYPE_PARAMETER` | typescript | A type parameter's bound or default. |
| `TYPE_REFERENCE` | typescript | Another type reference: the row is a type ARGUMENT or an element of the reference named in owner_id. depth says how deep. |
| `DECORATOR` | typescript | A decorator application. |
| `ENUM_MEMBER` | typescript | An enum member's written type. |
| `EXPORT` | typescript | An `export type` clause. |
| `MODULE` | typescript | A module-level position with no finer owner. |

**`type_use.context` values**

| value | languages | meaning |
|---|---|---|
| `FIELD_TYPE` | java, typescript | The declared type of a field. |
| `METHOD_PARAM` | java, typescript | The declared type of a formal parameter. |
| `METHOD_RETURN` | java, typescript | The declared return type. |
| `LAMBDA_PARAMETER_TYPE` | java | The declared type of an explicitly typed lambda parameter, `(Foo f) -> f.bar()`. It is a receiver-typing source, so it is what types `f` at the call inside the body. |
| `LOCAL_VARIABLE` | java | The declared type of a local, a catch parameter or a try-with-resources resource. |
| `OBJECT_CREATION_TYPE` | java, typescript | The type of a `new T(...)`. |
| `ARRAY_CREATION_TYPE` | java | The element type of a `new T[n]`. |
| `CAST_EXPRESSION` | java | The type of a `(T) x`. |
| `INSTANCEOF_TYPE` | java, typescript | The type tested by an `x instanceof T`. |
| `SUPER_TYPE` | java, typescript | An `extends` clause. |
| `IMPLEMENTS_INTERFACE` | java, typescript | An `implements` clause. |
| `THROWS_CLAUSE` | java | A declared thrown type. |
| `ANNOTATION_TYPE` | java | The annotation type applied to a declaration. |
| `ANNOTATION_PARAM` | java | A type named as an annotation argument. |
| `TYPE_PARAM_BOUND` | java, typescript | The bound of a type parameter declared on a TYPE. |
| `METHOD_TYPE_PARAM_BOUND` | java, typescript | The bound of a type parameter declared on a METHOD. |
| `METHOD_TYPE_ARGUMENT` | java, typescript | An explicit type argument at a call site, `x.<T>m()`. |
| `METHOD_REFERENCE_QUALIFIER` | java | The qualifier of a method reference, `T::m`. |
| `PATTERN_BINDING_TYPE` | java | The type of a record-pattern component. |
| `SWITCH_TYPE_PATTERN` | java | The type of a switch type pattern, `case T t ->`. |
| `RECORD_PATTERN_TYPE` | java | The record type a deconstruction pattern matches. |
| `VARIABLE_TYPE` | typescript | The written type of a `const` / `let` / `var`. |
| `TYPE_ELEMENT` | typescript | A member's type inside an interface or a type literal. |
| `HERITAGE_TWIN` | typescript | The second half of a heritage clause a declaration-merged type carries. |
| `AS_TARGET` | typescript | The target of an `x as T`. |
| `SATISFIES_TARGET` | typescript | The target of an `x satisfies T`. |
| `TYPE_ASSERTION` | typescript | The target of a `<T>x` assertion. |
| `TYPE_ARGUMENT` | typescript | A type argument of the reference in owner_id — `Widget` in `Map<string, Widget>`. |
| `TYPE_PARAM_DEFAULT` | typescript | A type parameter's default, the `= T` in `<K = string>`. |
| `TYPE_ALIAS_RHS` | typescript | The right-hand side of a `type X = …`. |
| `INDEX_SIGNATURE_KEY` | typescript | The key type of an index signature. |
| `INDEX_SIGNATURE_VALUE` | typescript | The value type of an index signature. |
| `MAPPED_CONSTRAINT` | typescript | The constraint of a mapped type. |
| `MAPPED_TEMPLATE` | typescript | The template of a mapped type. |
| `CONDITIONAL_*` | typescript | A prefix: the check, extends, true and false branches of a conditional type. |
| `TEMPLATE_SPAN` | typescript | A span of a template-literal type. |
| `IMPORT_TYPE_QUALIFIER` | typescript | The qualifier of an `import("m").T`. |
| `TYPE_PREDICATE_TARGET` | typescript | The target of an `x is T` predicate. |
| `ENUM_MEMBER_TYPE` | typescript | An enum member's written type. |
| `DECORATOR_TYPE` | typescript | The decorator itself. |
| `DECORATOR_ARGUMENT_TYPE` | typescript | A type named in a decorator argument. |

**Notes**

- **all** — JAVA AND TYPESCRIPT. Declared in every bundle and EMPTY for Python and JavaScript, so the schema does not churn as the remaining front ends land (#663).
- **typescript** — The context set is TypeScript's own and is wider than Java's: AS_TARGET, SATISFIES_TARGET, TYPE_ALIAS_RHS, the CONDITIONAL_* family, MAPPED_*, INDEX_SIGNATURE_* and TEMPLATE_SPAN have no Java counterpart. A use inside a conditional type IS a use of that type and is recorded as one.
- **typescript** — Only a reference whose KIND can name a declaration is a row: TYPE_REFERENCE and IMPORT_TYPE. ARRAY, UNION, TUPLE and PARENTHESIZED are structure whose CHILDREN are the named references; PRIMITIVE, LITERAL, TYPE_VARIABLE, MAPPED, CONDITIONAL, INDEXED_ACCESS and INTRINSIC name nothing declared.
- **java** — EVERY DEPTH is here, unlike the receiver-typing relations the engine uses internally, which filter to depth 0. A field of type `Map<String, Widget>` produces three rows. Filter on `depth = 0` when you want the type an expression has rather than every type its declaration mentions.
- **java** — A TYPE_VARIABLE reference (`T`, `E`) is not a row: it names the declaration's own parameter, not a type. Where the parameter has a written bound the USE resolves to that bound and IS a row, so `<T extends Node> void f(T t)` records a use of Node.
- **java** — The reference rows carry no line in the Java IR (every all-type-references row has an empty startLine), so this table has no position columns. Use owner_method_id, or owner_type_id plus the types row, to locate a use.

### `skipped`

WHAT THE PARSER DID NOT READ — one row per source file it declined, with the reason. Every other table describes code that WAS read, so without this one a file the parser skipped is indistinguishable from a file with nothing in it: its declarations are absent, and every call that targets them reads as an engine miss rather than as a target that was never indexed. Join `file_path` against the other tables' `file_path` to separate the two. Empty is the normal case and means the parser read everything it was given.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `file_path` | TEXT |  |  | yes | The file that was not read, as the parser recorded it — the same spelling the other tables' file_path uses, so the two join. For a DIRECTORY_EXCLUDED row it is a DIRECTORY, not a file (see notes). |
| 1 | `reason` | TEXT |  |  | yes | Why it was declined — see vocabulary. The sets differ per language because the front ends decline for different things. |
| 2 | `construct` | TEXT |  | yes |  | The syntactic form that caused the rejection (`except_clause_comma_target`), where the front end names one. Python only; NULL everywhere else. |
| 3 | `start_line` | INTEGER |  | yes |  | 1-based line the offending construct is written at; NULL where the reason is a property of the whole file rather than of one place in it. |
| 4 | `start_column` | INTEGER |  | yes |  | Column, as the parser counts it; NULL with start_line. |
| 5 | `detail` | TEXT |  | yes |  | Free text from the front end: the error message for a READ_ERROR or EXTRACTION_ERROR, the count of files behind a DIRECTORY_EXCLUDED row. Not a vocabulary — do not match on it. |

**`skipped.reason` values**

| value | languages | meaning |
|---|---|---|
| `READ_ERROR` | java, typescript, python, javascript | The file could not be read — an I/O or encoding failure. The ENVIRONMENT failed, which is nobody's bug; contrast EXTRACTION_ERROR. |
| `EMPTY_CONTENT` | java | The file is empty or is only whitespace. Nothing was lost. |
| `FILE_TOO_LARGE` | java | The file is longer than the parser's line threshold and was declined whole. Everything it declares is missing from every other table. |
| `EXTRACTION_ERROR` | typescript, python, javascript | The file read and parsed, and the extractor then threw. The PARSER failed, which is always a bug — `detail` carries the message. |
| `PY2_CONSTRUCT_DETECTED` | python | Python 2 source, rejected whole rather than misread under Python 3 scoping (tree-sitter parses `print "x"` without erroring). `construct`, `start_line` and `start_column` name the form that gave it away. |
| `NO_PROGRAM_CLAIMS_FILE` | typescript | A file under a root that declares programs (a tsconfig) which no program claims and no claimed file imports. It is out of every program, not unparseable. |
| `DIRECTORY_EXCLUDED` | javascript | A directory the walker pruned by name (`node_modules`, `dist`, …). ONE row per DIRECTORY, with the file count in `detail` — the files were never enumerated, and naming them individually would invent paths. |

**Notes**

- **all** — THE ONLY TABLE ABOUT CODE THAT IS NOT IN THE GRAPH. Read it before reading any absence as an engine result: a call into a skipped file is unresolved because the target was never indexed, not because the rules could not resolve it. Rows describe the CLIENT only — a library file the parser skipped is not reported here.
- **csharp** — EMPTY — the C# front end writes no skipped-files report. It takes the opposite line: a construct its grammar does not cover fails the run rather than skipping the file, so there is no per-file decision to record. An empty table here is not evidence that every file was read.
- **javascript** — A DIRECTORY_EXCLUDED row's file_path is a PRUNED DIRECTORY, not a file, and `detail` carries how many files are behind it; those files have no rows of their own. So `SELECT count(*) FROM skipped` is not the number of files missing, and a join on file_path will not match them. Filter the reason out when you want per-file rows.
- **python** — The only front end that positions a skip: a PY2_CONSTRUCT_DETECTED row carries the construct and its line and column, so the file can be triaged without re-running the parser.

### `type_instantiated`

Types this run creates an instance of — the rapid-type-analysis set that bounds virtual dispatch. (A subtype nothing instantiates cannot receive a dispatched call.) Deliberately an over-approximation: narrowing it on evidence the run does not have would lose real edges. Populated in every language.

| # | column | type | key | null | idx | meaning |
|---|---|---|---|---|---|---|
| 0 | `type_id` | TEXT | yes |  | yes | FK → types.id. |
| 1 | `how` | TEXT | yes |  |  | What creates the instance — see vocabulary. |

**`type_instantiated.how` values**

| value | languages | meaning |
|---|---|---|
| `new` | all | A constructor call — `new C()` / `C()`. |
| `anonymous` | java | An anonymous class exists only by being instantiated. |
| `enum_constant` | java | An enum's constants are its instances. |

**Notes**

- **typescript** — Every row has how = `new`. Not restricted to client provenance: a type the library constructs is still a type that exists at run time, and dropping it would narrow the envelope unsoundly.
- **python** — Every row has how = `new`: the rule set records that some client call constructs the class, not which form.

## Extended tables — `ext_<relation>`

Every relation in the language's `graph/<lang>/souffle/export_manifest.tsv`, loaded as `ext_<relation>` with positional columns `c0…cN` (the raw relation is declared positionally; nothing here invents a name). `schema_tables` lists each one with its arity and the comment lifted from the rule that derives it — read that before querying. They are language-specific by construction: a bundle holds only the ext tables of its own language.

## Catalog tables

### `schema_tables`

Every table in this bundle with its scope and what it holds.

| # | column | type | meaning |
|---|---|---|---|
| 0 | `name` | TEXT | Table name. |
| 1 | `scope` | TEXT | `core` — same schema in every language; `ext` — a language-specific relation, columns c0…cN; `catalog` — this documentation. |
| 2 | `language` | TEXT | For `ext`: the front end that defines it. NULL for core and catalog. |
| 3 | `description` | TEXT | What a row means. For `ext` this is the comment lifted from the rule that derives the relation, verbatim. |

### `schema_columns`

Every column of every core and catalog table. (ext tables are positional: c0…cN, arity in schema_tables.description.)

| # | column | type | meaning |
|---|---|---|---|
| 0 | `table_name` | TEXT | FK → schema_tables.name. |
| 1 | `ordinal` | INTEGER | 0-based position. |
| 2 | `name` | TEXT | Column name. |
| 3 | `type` | TEXT | TEXT or INTEGER. |
| 4 | `nullable` | INTEGER | 1 if the column may be NULL (empty in CSV). |
| 5 | `description` | TEXT | Meaning. |

### `schema_vocab`

Every enumerated value a core column may hold, and WHICH LANGUAGES emit it. Filter on the language in `run` to see the values that can occur in this bundle. A value observed in this run but not in the authored list is inserted with meaning `undocumented — observed in this run`, so the table is complete for the data it sits next to.

| # | column | type | meaning |
|---|---|---|---|
| 0 | `table_name` | TEXT | Core table. |
| 1 | `column_name` | TEXT | Column. |
| 2 | `language` | TEXT | `java`, `typescript`, `python` — the front end that emits this value (one row per language; a value shared by all has three rows). |
| 3 | `value` | TEXT | The value as it appears in the column. A trailing `*` marks a prefix (e.g. `DECORATOR_*`). |
| 4 | `meaning` | TEXT | What it means. |

### `schema_guide`

READ THIS FIRST. An ordered walkthrough of how to use this database: which tables answer which questions, what to check before trusting an answer, and where the language-specific details are.

| # | column | type | meaning |
|---|---|---|---|
| 0 | `step` | INTEGER | Reading order. |
| 1 | `text` | TEXT | The instruction. |

### `schema_queries`

Canonical questions and the SQL that answers each, parameterised with named `:params`. Every query is verified to run against every language's bundle. Copy, bind, run.

| # | column | type | meaning |
|---|---|---|---|
| 0 | `name` | TEXT | Short identifier. |
| 1 | `question` | TEXT | The question in words. |
| 2 | `params` | TEXT | Comma-separated named parameters the SQL expects, e.g. `:qualified_name, :depth`. |
| 3 | `sql` | TEXT | The SQL. |

### `schema_notes`

Per-language caveats that are not a vocabulary: what a table lacks in one front end, where an id may point, what a NULL means here.

| # | column | type | meaning |
|---|---|---|---|
| 0 | `language` | TEXT | `java`, `typescript`, `python`, or `all`. |
| 1 | `table_name` | TEXT | The table the note is about. |
| 2 | `note` | TEXT | The caveat. |

