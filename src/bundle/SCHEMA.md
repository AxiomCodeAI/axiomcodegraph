# The output bundle — schema

_Generated from `src/bundle/schema.ts` (schema version 1). Do not edit; run `npm run schema-doc`._

Every run, in every language, writes the same thing:

```
<out>/
  graph.sqlite      the contract — the tables below, the ext_* tables, and this document as tables
  graph/<table>.csv the core tables as headered, tab-delimited text (RFC 4180 quoting)
  raw/              the per-language Soufflé relations, verbatim. Engine-internal; not a contract.
```

The same schema in every language — a table a front end does not derive is **empty, not missing**, and a note below says so. Where the front ends differ (which values a column can hold, what an id may point at) the difference is written here **and** in the `schema_vocab` / `schema_notes` tables inside the database, so a query can read it without leaving SQLite:

```sql
SELECT value, meaning FROM schema_vocab WHERE table_name='call_edges' AND column_name='tier'
  AND language = (SELECT value FROM run WHERE key='language');
```

Identifiers are the parser's hashes and are opaque; join them to `methods` / `types` / `call_sites` for names and positions. NULL in SQLite is the empty field in CSV.

## Core tables

### `run`

What produced this bundle: one key/value row per fact about the run (language, engine commit, inputs, knobs, timestamps, schema version). Read `language` first — it selects which vocabulary rows apply.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `key` 🔑 | TEXT |  | Fact name — see the `run.key` vocabulary. |
| 1 | `value` | TEXT |  | Fact value, as text. |

**`run.key` values**

| value | languages | meaning |
|---|---|---|
| `schema_version` | all | Version of this contract (SCHEMA.md). |
| `language` | all | Front end: java \| typescript \| python. Selects the applicable vocabulary rows. |
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

### `methods`

Every callable the graph refers to: all client methods/functions from the IR, plus every LIBRARY method some edge reaches (library methods nothing reaches are not listed — a library IR is GB-scale). A module-level function is a method whose owner columns are NULL; top-level code is the module initializer method (kind MODULE_INITIALIZER in TypeScript and Python, absent in Java).

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `id` 🔑 | TEXT |  | The parser's unique hash for the method (METHOD_REGISTRY_… / TS_METHOD_… / PY_METHOD_…). The value every other table uses to refer to a method. |
| 1 | `name` | TEXT |  | Simple name as written (`render`, `__init__`, `<init>` for a Java constructor). |
| 2 | `qualified_name` | TEXT |  | Parser-qualified name — package/module path plus owner plus name. Unique only together with the signature. |
| 3 | `signature` | TEXT |  | Parameter-type signature as the parser prints it, e.g. `main(String[])`; language-native formatting. |
| 4 | `kind` | TEXT |  | The parser's methodKind — see vocabulary; the sets differ per language. |
| 5 | `owner_type_id` | TEXT | yes | FK → types.id of the declaring class/interface/enum; NULL for a free function or a module initializer. |
| 6 | `owner_qualified_name` | TEXT | yes | Qualified name of the owner, denormalised so a row prints without a join; NULL when owner_type_id is NULL. |
| 7 | `file_path` | TEXT |  | Source file, as the parser recorded it (relative to the project root it was given). |
| 8 | `start_line` | INTEGER |  | 1-based first line of the declaration. |
| 9 | `end_line` | INTEGER |  | 1-based last line of the declaration. |
| 10 | `provenance` | TEXT |  | `client` — from the analysed project; `lib` — from a staged library IR. |

**`methods.provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | all | Declared in the analysed project. |
| `lib` | all | Declared in a staged library IR; listed because an edge reaches it. |

**`methods.kind` values**

| value | languages | meaning |
|---|---|---|
| `INSTANCE_METHOD` | java | Non-static method. |
| `STATIC_METHOD` | java | Static method. |
| `ABSTRACT_METHOD` | java | Abstract or interface method without a body. |
| `DEFAULT_METHOD` | java | Interface default method. |
| `CONSTRUCTOR` | java, typescript | Constructor (Java `<init>`; TypeScript `constructor`). |
| `STATIC_INITIALIZER` | java | `static { … }` block. |
| `ENUM_CONSTANT_METHOD` | java | Method body declared on an enum constant. |
| `RECORD_ACCESSOR` | java | A record component accessor. |
| `COMPACT_CONSTRUCTOR` | java | A record's compact canonical constructor. |
| `DEFAULT_CONSTRUCTOR` | java | The implicit no-arg constructor the parser synthesises for a class that declares none. |
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

**Notes**

- **all** — Library rows are the subset an edge reaches. To see a library method nothing calls, query the library IR itself.

### `types`

Every class-like declaration the graph refers to: all client types, plus every library type that owns a listed library method or appears in type_ancestors.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `id` 🔑 | TEXT |  | The parser's unique hash (TYPE_REGISTRY_… / TS_TYPE_… / PY_TYPE_…). |
| 1 | `name` | TEXT |  | Simple name. |
| 2 | `qualified_name` | TEXT |  | Parser-qualified name. |
| 3 | `category` | TEXT |  | The parser's typeCategory — see vocabulary. |
| 4 | `file_path` | TEXT |  | Source file. |
| 5 | `start_line` | INTEGER |  | 1-based first line. |
| 6 | `end_line` | INTEGER |  | 1-based last line. |
| 7 | `provenance` | TEXT |  | `client` or `lib`. |

**`types.provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | all | Declared in the analysed project. |
| `lib` | all | Declared in a staged library IR. |

**`types.category` values**

| value | languages | meaning |
|---|---|---|
| `CLASS_TYPE` | all | A class. |
| `INTERFACE_TYPE` | java, typescript | An interface. |
| `ENUM_TYPE` | java, typescript | An enum. |
| `RECORD_TYPE` | java | A record. |
| `ANNOTATION_TYPE` | java | An annotation interface. |
| `ANNOTATION_INTERFACE_TYPE` | java | An annotation interface (`@interface`), as the parser categorises it in newer output. |
| `CONST_ENUM_TYPE` | typescript | `const enum`. |
| `TYPE_ALIAS_TYPE` | typescript | `type X = …`. |
| `NAMESPACE_TYPE` | typescript | `namespace X {}`. |
| `CLASS_EXPRESSION_TYPE` | typescript | A class expression value. |
| `EXCEPTION_CLASS_TYPE` | python | A class deriving from BaseException. |
| `ENUM_CLASS_TYPE` | python | An `Enum` subclass. |
| `PROTOCOL_TYPE` | python | A `typing.Protocol`. |
| `ABC_TYPE` | python | An abstract base class. |
| `NAMEDTUPLE_TYPE` | python | A NamedTuple class. |
| `TYPEDDICT_TYPE` | python | A TypedDict class. |
| `DATACLASS_TYPE` | python | A `@dataclass`. |
| `METACLASS_TYPE` | python | A metaclass (derives from `type`). |
| `GENERIC_TYPE` | python | A `Generic[…]` class. |

### `call_sites`

One row per place a call is written (or, for a synthesised edge, the construct that implies the call). Every call_edges.call_site_id is here. Location columns come from the IR; they are NULL when the site is a construct the IR does not position (see notes).

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `id` 🔑 | TEXT |  | Site identifier — an expression hash in every language; in Python it may also be a decorator hash or, for METACLASS_CREATION, the class's type hash (see notes). |
| 1 | `caller_id` | TEXT |  | The method whose body contains the site (FK → methods.id) — or, for code that runs outside any method, the enclosing TYPE (Java: TYPE_REGISTRY_… = the type's static/instance initializer) or MODULE (TypeScript: TS_MODULE_… as a fallback marker). Never NULL. See notes. |
| 2 | `kind` | TEXT |  | What syntactic form the call takes — the same value as call_edges.kind for this site; see vocabulary (language-specific sets). |
| 3 | `callee_name` | TEXT | yes | The name written at the site (`render` in `w.render()`, the class name in `new Widget()`); NULL when the form has no written name (a constructor delegation, a record deconstruction). |
| 4 | `file_path` | TEXT | yes | Source file. |
| 5 | `start_line` | INTEGER | yes | 1-based line. |
| 6 | `start_column` | INTEGER | yes | Column, as the parser counts it. |
| 7 | `end_line` | INTEGER | yes | 1-based last line; NULL where the IR records only the start. |
| 8 | `end_column` | INTEGER | yes | End column; NULL where the IR records only the start. |

**Notes**

- **java** — caller_id is a TYPE_REGISTRY_ id (a types row, not a methods row) for a call written in a field initializer or a static/instance initializer block: the parser gives such code no enclosing method, and the rule set attributes it to the type — read it as "runs in this type's <clinit>/<init>".
- **typescript** — caller_id is normally the parser's caller method, or the module initializer for top-level code; when neither exists it is the TS_MODULE_ hash itself, kept as a greppable marker rather than a blank.
- **java** — callee_name for `new X()` is the class name written at the site; NULL for ctor_delegate (`this(…)`/`super(…)`), anon_new, and record_accessor.
- **java** — A record_accessor site is the RECORD_PATTERN expression, positioned where the pattern is written.
- **typescript** — end_line / end_column come from the expression row; the call-site row itself records only the start.
- **python** — PROPERTY_READ, CONTEXT_MANAGER and ITERATION_PROTOCOL rows are protocol edges with no written call: their site is the expression that triggers the protocol, and callee_name is NULL because nothing was written. Filter them out with kind NOT IN (…) when counting calls.
- **python** — The id is an EXPRESSION hash for a written call; a DECORATOR hash (PY_DECORATOR_…) for DECORATOR_APPLICATION and DECORATOR_* sites, positioned at the decorator line; and the class's TYPE hash for METACLASS_CREATION, positioned at the class declaration.

### `call_edges`

THE GRAPH. One row per (site, resolved target). A site with N possible targets has N rows, each carrying the same tier; a site the engine could not resolve has exactly one row with a NULL callee and an `ambiguous_*` tier — so every call site written in the client appears at least once, and the table alone shows where every chain ends and why. Filter on `tier` to choose your risk tolerance.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `call_site_id` | TEXT |  | FK → call_sites.id. |
| 1 | `caller_id` | TEXT |  | Same value as call_sites.caller_id for this site: the containing method, or the enclosing type/module id when there is none (see call_sites). |
| 2 | `callee_method_id` | TEXT | yes | FK → methods.id of the resolved target, when the target is a method the bundle knows (callee_provenance client or lib). NULL otherwise. |
| 3 | `callee_label` | TEXT | yes | The target when it is NOT a method row: a builtin (`builtin:len`) or an import path outside every staged IR (`requests.get`) — Python only today. NULL when callee_method_id is set or the site is unresolved. |
| 4 | `callee_provenance` | TEXT | yes | Where the target lives — see vocabulary. NULL for an unresolved site. |
| 5 | `tier` | TEXT |  | Confidence class of this edge — see vocabulary. `known_edge` and `multi_inferred` are assertions about client code; `boundary_lib` leaves the client; the `ambiguous_*` tiers are declared blind spots, not edges. |
| 6 | `kind` | TEXT |  | Syntactic form of the site — see vocabulary; language-specific sets, kept native. |

**`call_edges.tier` values**

| value | languages | meaning |
|---|---|---|
| `known_edge` | all | Exactly one target resolved. The strongest claim. |
| `multi_inferred` | all | A sound SET of possible targets (virtual dispatch over instantiated subtypes); each member is one row. The set over-approximates; no member is a guess. |
| `boundary_lib` | all | The target is outside the client (library, builtin, or unstaged external). The chain is not expanded past it here. |
| `ambiguous_unknown` | all | Declared blind spot: the engine could not resolve the site (unresolved receiver, missing type, reflection…). callee is NULL. Never dropped. |
| `ambiguous_anon` | java | Known structural gap: an anonymous-class creation has no candidate rule yet. callee is NULL. |
| `ambient_terminal` | typescript | The target is an ambient declaration (a `.d.ts` signature with no body anywhere) — resolved, but there is nothing to expand into. |
| `intrinsic_terminal` | typescript | The site is a JSX intrinsic element or a dynamic `import()` — a runtime intrinsic, not a function the graph can name. |

**`call_edges.callee_provenance` values**

| value | languages | meaning |
|---|---|---|
| `client` | all | Target is a client method (callee_method_id set). |
| `lib` | all | Target is a method of a staged library IR (callee_method_id set, methods.provenance = lib). |
| `builtin` | python | Target is a CPython builtin with no Python source (callee_label = `builtin:NAME`). |
| `external` | python | Target is named by an import path outside every staged IR (callee_label = the written path). |

**`call_edges.kind` values**

| value | languages | meaning |
|---|---|---|
| `method` | java | `obj.m()`, `Class.m()`, `super.m()`, or an unqualified `m()`. |
| `new` | java | `new X(…)`. |
| `ref` | java | A method reference `X::m`, `obj::m`, `X::new`. |
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
| `METACLASS_CREATION` | python | `class X(metaclass=M)` invokes `M.__new__` / `M.__init__` at import time. No written call; the site is the class's type hash. |
| `PROPERTY_READ` | python | Reading `obj.attr` where `attr` is a `@property` runs the getter. No written call; the site is the attribute-access expression. |
| `CONTEXT_MANAGER` | python | `with expr:` runs `__enter__` / `__exit__` (or the async pair). No written call; the site is the context-manager expression. |
| `ITERATION_PROTOCOL` | python | `for x in expr:` (and comprehensions) runs `__iter__` / `__next__` (or the async pair). No written call; the site is the iterated expression. |

**Notes**

- **python** — A `boundary_lib` edge may point at a builtin (callee_provenance builtin, callee_label `builtin:NAME`) or at an unstaged import path (callee_provenance external) — neither has a methods row.
- **python** — The reason a site is ambiguous_unknown is exported per site in ext_call_site_unresolved (site, caller, reason, detail).
- **all** — The raw relation has a seventh column, ToExpr, that is always `-` (reserved). It is dropped here.
- **all** — An unresolved site (tier ambiguous_*) has NULL callee_method_id, callee_label and callee_provenance. The raw relation writes `-` in those slots.

### `type_ancestors`

Transitive supertype closure: (type, ancestor) for every ancestor reachable through extends/implements/bases, client and library alike. Not a member-inheritance claim — in TypeScript an `implements` edge inherits nothing (the rule set keeps two closures; this is the conformance one).

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `type_id` 🔑 | TEXT |  | FK → types.id. |
| 1 | `ancestor_type_id` 🔑 | TEXT |  | FK → types.id. |

### `overrides`

Virtual-dispatch pairs: (base method, overriding method) wherever a call to the base may run the override. Java only today — see notes for what the other front ends offer instead.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `method_id` 🔑 | TEXT |  | FK → methods.id — the base (declared) method. |
| 1 | `overriding_method_id` 🔑 | TEXT |  | FK → methods.id — the override in a subtype. |

**Notes**

- **typescript** — EMPTY. TypeScript dispatch is captured directly as multi_inferred edges; the structural and nominal implementor sets are in ext_implementors, ext_structural_implementor and ext_type_satisfies.
- **python** — EMPTY. Python method lookup is by MRO, exported positionally in ext_mro_position (type, ancestor, …, position).

### `entry_points`

Methods the runtime invokes without a client call site — process roots, test methods, HTTP handlers, framework hooks. The seeds of entry_reachable.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `method_id` 🔑 | TEXT |  | FK → methods.id. |
| 1 | `reason` 🔑 | TEXT |  | Why it is an entry — see vocabulary. |

**`entry_points.reason` values**

| value | languages | meaning |
|---|---|---|
| `main` | java | A static `main`. |
| `test` | java | A JUnit test or lifecycle method. |
| `http` | java | A JAX-RS / Spring MVC handler. |
| `cli` | java | A CLI command method (picocli etc.). |
| `bean_ctor` | java | Constructor of a container-managed bean. |
| `factory` | java | A `@Bean` factory method. |
| `lifecycle` | java | `@PostConstruct` / `@PreDestroy` and similar hooks. |
| `queue` | java | A message-listener method. |
| `scheduled` | java | A `@Scheduled` method. |
| `unimported_module` | typescript | The initializer of a module nothing imports — a script or a bundle root. |

**Notes**

- **python** — EMPTY. The Python rule set does not derive entry points; entry_reachable is therefore empty too.

### `entry_reachable`

Methods reachable from some entry point through call_edges (client edges only). A method absent here is dead from every known entry — or reachable only through a declared unknown.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `method_id` 🔑 | TEXT |  | FK → methods.id. |

### `unresolved_sites`

The blind spots, attributed to the code that contains them: (caller, site) for every call site whose tier is `ambiguous_*` — a declared unknown, not an edge. A change-impact answer computed from a caller listed here is a lower bound. Derived from call_edges, so it is present in every language.

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `caller_id` 🔑 | TEXT |  | Same domain as call_sites.caller_id: usually FK → methods.id. |
| 1 | `call_site_id` 🔑 | TEXT |  | FK → call_sites.id. |

### `type_instantiated`

Types the client actually creates an instance of — the rapid-type-analysis set that bounds virtual dispatch. (A subtype nothing instantiates cannot receive a dispatched call.)

| # | column | type | null | meaning |
|---|---|---|---|---|
| 0 | `type_id` 🔑 | TEXT |  | FK → types.id. |
| 1 | `how` 🔑 | TEXT |  | What creates the instance — see vocabulary. |

**`type_instantiated.how` values**

| value | languages | meaning |
|---|---|---|
| `new` | java, python | A constructor call in the client. |
| `anonymous` | java | An anonymous class exists only by being instantiated. |
| `enum_constant` | java | An enum's constants are its instances. |

**Notes**

- **typescript** — EMPTY. The TypeScript rule set does not export an instantiation set.
- **python** — Every row has how = `new`: the rule set records that some client call constructs the class, not which form.

## Extended tables — `ext_<relation>`

Every relation in the language's `src/<lang>/souffle/export_manifest.tsv`, loaded as `ext_<relation>` with positional columns `c0…cN` (the raw relation is declared positionally; nothing here invents a name). `schema_tables` lists each one with its arity and the comment lifted from the rule that derives it — read that before querying. They are language-specific by construction: a bundle holds only the ext tables of its own language.

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

### `schema_notes`

Per-language caveats that are not a vocabulary: what a table lacks in one front end, where an id may point, what a NULL means here.

| # | column | type | meaning |
|---|---|---|---|
| 0 | `language` | TEXT | `java`, `typescript`, `python`, or `all`. |
| 1 | `table_name` | TEXT | The table the note is about. |
| 2 | `note` | TEXT | The caveat. |

