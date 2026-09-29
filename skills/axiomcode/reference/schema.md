# schema — which table holds X, per language

Ask a verb first; open the graph only for a fact no verb prints. Every graph holds ONE language, and the same fact
lives in a different table per language. This page says where, for Python, Java and C#, and what is not recorded
at all, so you stop looking. Measured on a Django app, a Spring Boot app and an ASP.NET app, one fresh index each.

## Which graph

| | |
|---|---|
| the main language (most files) | `.axiomcode/out/graph.sqlite`, a symlink to `.axiomcode/out/<lang>/graph.sqlite` |
| every other language | `.axiomcode/lang/<lang>/out/graph.sqlite` |
| which one you opened | `sqlite3 -readonly <graph> "SELECT value FROM run WHERE key='language'"` |
| tested SQL, caveats, value meanings | the `schema_queries`, `schema_notes`, `schema_vocab` tables in the same file |

Ids are opaque (`PY_METHOD_…`, `METHOD_REGISTRY_…`, `CS_PROPERTY_…`): join on them, never parse them. `symbols`
holds every declaration of every kind with `file`, `line`, `owner`, `is_test`; `symbols.id` is the id the other
tables use, and `symbols.method_id` / `type_id` join it to `methods` / `types`.

## Fact by language

| fact | Python | Java | C# |
|---|---|---|---|
| decoration / annotation / attribute | `decorations`; owner is a method or type | `decorations`; owner is a method, type, field or a **parameter** (`METHOD_PARAMETER_…`, joins nothing) | `decorations`; owner is a method, type or property (`CS_PROPERTY_…`) |
| its name and text | `name` = last dotted segment (`@admin.register(X)` → `register`); `text` = as written, args included | `name` as written after `@`; `text` with args, string quotes tripled (`"""/articles"""`) | `name` as written; `text` = `@Name` **only**, even for `[Endpoint(Name = "x")]`: the arguments are in `literals` at the same file:line |
| base types, resolved | `type_ancestors` (transitive) | `type_ancestors`, library bases included as `types.provenance='external'` | `type_ancestors` (transitive) |
| base types, library / unresolved | **not** in `type_ancestors`: `type_refs` `context='BASE_CLASS'` (last segment only, `Model`) and `ext_type_base_unresolved` (c1 = type id, c3 = text, `models.Model`) | as above; also `type_use` `context='SUPER_TYPE'` with `owner_type_id` | **not** in `type_ancestors`: `type_refs` `context='BASE_LIST'` (name without type args); `ext_type_base_unresolved` c3 = name, but c1 is a declaration group, not a `types.id` |
| entry points | `entry_points(method_id, reason)`: `url`, `orm_hook` seen; rules also emit `http`, `task`, `signal_receiver`, `fixture`, `di_provider`, `grpc_service`. **No** `test` or `main` reason | `test`, `http`, `bean_ctor`, `factory`, `main` seen; also `cli`, `queue`, `scheduled`, `lifecycle`, `spring_factories`; config keys in `ext_config_entry_point` | `test`, `http`, `orm_hook`, `framework_hook`, `main` seen; also `queue`, `grpc_service` |
| field declarations | `symbols` `kind='field'` (`PY_FIELD_…`, `owner` `Form` or `Form.Meta`); `fields` is **empty** | `fields` | `fields` = true fields and consts only; a property is `symbols` `kind='field'` with a `CS_PROPERTY_…` id, and its accessors are `methods` `kind` `PROPERTY_GET` / `PROPERTY_SET` / `PROPERTY_INIT` (`get_X`, `set_X`). In `symbols` every field, const, property and enum member has `owner` = its declaring type (`Outer.Inner` when nested) and `qualified_name` `<Namespace>.<Type>.<Name>` |
| who writes / reads a field | **not recorded**: `field_access` is empty; `refs` `ATTRIBUTE_ACCESS` / `FIELD` is every mention by name and line, read and write alike, with no field id | `field_access` (`access` read / write, `tier`, `caller_id`) | property: `call_edges` `kind` `property_write` / `property_read` to the accessor. Field and const: **not recorded** (`field_access` empty; `refs` `MEMBER_ACCESS` and `NAME_REFERENCE` by name and line, with no field id) |
| call edges | `call_edges`; tiers `known_edge`, `multi_inferred`, `boundary_lib`, `ambiguous_unknown`; kinds `METHOD_CALL`, `SELF_CALL`, `DECORATOR_*`, `PROPERTY_READ`, … | tiers add `ambiguous_anon`; kinds `method`, `new`, `anon_new`, `ctor_delegate`, `ref` | tiers add `known_builtin_operator`, `known_implicit_ctor`; kinds add `property_read`/`_write`, `operator`, `conversion`, `indexer`, `delegate` |
| why a call is unresolved | `ext_call_site_unresolved` (c0 site, c1 caller, c2 reason, c3 call kind) | `unresolved_sites` only, no reason | `ext_site_unresolved_named` (c0 site, c1 receiver type or `<none>`, c2 name) |
| strings in source | `literals(value, file, line)` | `literals`; config keys: `ext_config_binding` (key, mechanism, target kind, target id, owner), `ext_config_class_ref` | `literals` |
| text outside the source (XML, YAML, SQL, …) | **not in the graph**: scanned per query, cached in `.axiomcode/out/dl/nonsource.sqlite` (`files(id, rel)`, `tok(tok, fid)`) | same | same |
| tests | `symbols.is_test` (by file path); no test entry point | `is_test` + `entry_points` `reason='test'` | `is_test` + `entry_points` `reason='test'` |
| test rungs (`[sound]`, `[fixture]`, `[at import]`, …) | **not stored**: computed per query | same | same |

`field_access`, `type_use` and `type_instantiated` are empty in some languages (`type_use` in Python and C#,
`type_instantiated` in C#): run `SELECT count(*)` before reading an empty answer as "nothing". `overrides` is empty
in Python: its dispatch set is `dispatch_candidates` (basis `mro`).

## The verb for each fact

| fact | verb |
|---|---|
| methods carrying a decoration | `path '@login_required' '*'` (or `'@GetMapping'`): the decorated methods and what they reach |
| subtypes of a type | `impact <Type>`: "must change with it" |
| who writes a Java field | `impact <Type>.<field>`: "produces or writes it" |
| who writes a C# property | `impact <Type>.<Prop>` (or `<file>:<line of the property>`): readers and writers `[resolved]` through its accessors |
| who reads a C# field or const | `impact <Type>.<field>`: readers `[in scope]` inside the type, `[by name]` elsewhere, since no C# field access is resolved; `<file>:<line>` of a field answers nothing (no callable spans it), so ask by name |
| a Python field | `impact <Type>.<field>` lists readers `[in scope]` / `[by name]` only; there is no writer section, because no writer relation exists |
| text files naming a declaration | `impact X`: "bound from outside the source"; `context "<task>"`: "text files that name these" |
| a config key or a quoted string | `impact app.cache.ttl` · `impact '"some-string"'` |
| test rungs and routes | `impact X --tests-only --why` · `test-impact --why` |
| entry points by reason | no verb: SQL below |

## Queries

```sh
G=.axiomcode/out/graph.sqlite
# [all] decorations, with the owner whatever its kind (a Java parameter's owner comes back NULL)
sqlite3 -readonly $G "SELECT d.text, s.kind, s.qualified_name, d.file, d.line FROM decorations d
  LEFT JOIN symbols s ON s.id = d.owner_id WHERE d.name = 'GetMapping'"
# [all] entry points by reason, then one reason's methods
sqlite3 -readonly $G "SELECT reason, count(*) FROM entry_points GROUP BY 1"
sqlite3 -readonly $G "SELECT m.qualified_name, m.file_path, m.start_line FROM entry_points e
  JOIN methods m ON m.id = e.method_id WHERE e.reason = 'http'"
# [all] resolved ancestors (Java: library ones too, provenance 'external')
sqlite3 -readonly $G "SELECT a.qualified_name, a.provenance FROM type_ancestors x JOIN types t ON t.id = x.type_id
  JOIN types a ON a.id = x.ancestor_type_id WHERE t.name = '<Type>'"
# [python] library bases, full text as written
sqlite3 -readonly $G "SELECT t.qualified_name, u.c3 FROM ext_type_base_unresolved u JOIN types t ON t.id = u.c1"
# [csharp] library bases: the owner is the innermost type whose span holds the base-list line
sqlite3 -readonly $G "SELECT r.name, (SELECT t.qualified_name FROM types t WHERE t.file_path = r.file
  AND r.line BETWEEN t.start_line AND t.end_line ORDER BY t.start_line DESC LIMIT 1) AS owner
  FROM type_refs r WHERE r.context = 'BASE_LIST'"
# [java] field writers
sqlite3 -readonly $G "SELECT m.qualified_name, a.file_path, a.start_line, a.tier FROM field_access a
  JOIN fields f ON f.id = a.field_id JOIN methods m ON m.id = a.caller_id
  WHERE f.owner_qualified_name LIKE '%.<Type>' AND f.name = '<field>' AND a.access = 'write'"
# [csharp] property writers (property_read for readers)
sqlite3 -readonly $G "SELECT c.qualified_name, s.file_path, s.start_line FROM call_edges e
  JOIN methods t ON t.id = e.callee_method_id JOIN methods c ON c.id = e.caller_id
  JOIN call_sites s ON s.id = e.call_site_id WHERE e.kind = 'property_write' AND t.name = 'set_<Property>'"
# [all] tiers in this graph; [python] what the unresolved sites are waiting on
sqlite3 -readonly $G "SELECT tier, count(*) FROM call_edges GROUP BY 1"
sqlite3 -readonly $G "SELECT c2, count(*) FROM ext_call_site_unresolved GROUP BY 1 ORDER BY 2 DESC"
```

## Traps

- **Paths.** Java `methods`, `types`, `fields`, `call_sites` and `field_access` hold ABSOLUTE paths; its `symbols`,
  `decorations` and `type_refs` hold repo-relative ones, as every Python and C# table does. Match Java with
  `LIKE '%/rel/path.java'`.
- **Lines.** Java `type_refs` rows carry `line = 0` in every context but the two annotation ones: locate a Java
  base through `type_use` or the type. A C# `BASE_LIST` line is where the base list is written, which is below
  `types.start_line` when attributes or a line break come first: join by span, not by equal line. In a graph built
  before the field-line fix, every Python field line is one early (0-based): a nested class's first field sits on
  its `class Meta:` line.
- **Names.** Python `type_refs` and `decorations` keep only the last dotted segment; the full text is in
  `ext_type_base_unresolved.c3` and `decorations.text`. String cells are CSV-escaped: match with `LIKE '%x%'`.
  JavaScript `symbols`: a field (`this.x = …` in a constructor or constructor function, a class field) has its class as
  `owner` (`Store.items`); a member with a computed key is named by the key as written (`Tagged.[Symbol.hasInstance]`);
  an anonymous class expression takes the name it is bound to (`static Inner = class {…}` → `Outer.Inner`).
- **`ext_*` tables** have positional columns `c0…cN`; `SELECT description FROM schema_tables WHERE name = '<t>'`
  names them.
