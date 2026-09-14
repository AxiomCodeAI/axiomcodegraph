/**
 * THE OUTPUT CONTRACT — one schema for every front end, written as data.
 *
 * Everything a consumer may rely on is declared here and nowhere else: the core tables and
 * their columns, every enumerated value a column may hold — PER LANGUAGE, because that is
 * where the front ends differ — and the caveats that are not a vocabulary. The same data
 * is written into the bundle as the `schema_*` tables (so an agent can read it at query
 * time, from the database it is querying) and rendered to SCHEMA.md (so a human can read
 * it without a database). Neither can drift from the other because neither is authored.
 *
 * Values here are the ones the RULES emit (`grep`-able as string literals in graph/<lang>/
 * engine) or the parser's own enums (its fact-schema documents). Do not add a value you
 * cannot point at.
 */

export const SCHEMA_VERSION = '1';

export type Language = 'java' | 'typescript' | 'python';
export const LANGUAGES: readonly Language[] = ['java', 'typescript', 'python'];

export interface ColumnSpec {
  name: string;
  type: 'TEXT' | 'INTEGER';
  description: string;
  /** part of the table's primary key */
  key?: boolean;
  /** index this column for lookups */
  indexed?: boolean;
  /** may be NULL (empty in CSV) */
  nullable?: boolean;
}

export interface TableSpec {
  name: string;
  description: string;
  columns: ColumnSpec[];
}

/** An enumerated value of a column, with the languages that emit it. `all` = every front end. */
export interface VocabSpec {
  table: string;
  column: string;
  value: string;
  languages: readonly Language[] | 'all';
  meaning: string;
}

/** A per-language caveat about a table that is not expressible as a vocabulary. */
export interface NoteSpec {
  language: Language | 'all';
  table: string;
  note: string;
}

// ── core tables ─────────────────────────────────────────────────────────────

export const CORE_TABLES: readonly TableSpec[] = [
  {
    name: 'run',
    description: 'What produced this bundle: one key/value row per fact about the run (language, engine commit, inputs, knobs, timestamps, schema version). Read `language` first — it selects which vocabulary rows apply.',
    columns: [
      { name: 'key', type: 'TEXT', key: true, description: 'Fact name — see the `run.key` vocabulary.' },
      { name: 'value', type: 'TEXT', description: 'Fact value, as text.' },
    ],
  },
  {
    name: 'methods',
    description: 'Every callable the graph refers to: all client methods/functions from the IR, plus every LIBRARY method some edge reaches (library methods nothing reaches are not listed — a library IR is GB-scale). A module-level function is a method whose owner columns are NULL; top-level code is the module initializer method (kind MODULE_INITIALIZER in TypeScript and Python, absent in Java).',
    columns: [
      { name: 'id', type: 'TEXT', key: true, description: 'The parser\'s unique hash for the method (METHOD_REGISTRY_… / TS_METHOD_… / PY_METHOD_…). The value every other table uses to refer to a method.' },
      { name: 'name', type: 'TEXT', indexed: true, description: 'Simple name as written (`render`, `__init__`, `<init>` for a Java constructor).' },
      { name: 'qualified_name', type: 'TEXT', indexed: true, description: 'Parser-qualified name — package/module path plus owner plus name. Unique only together with the signature.' },
      { name: 'signature', type: 'TEXT', description: 'Parameter-type signature as the parser prints it, e.g. `main(String[])`; language-native formatting.' },
      { name: 'kind', type: 'TEXT', description: 'The parser\'s methodKind — see vocabulary; the sets differ per language.' },
      { name: 'owner_type_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → types.id of the declaring class/interface/enum; NULL for a free function or a module initializer.' },
      { name: 'owner_qualified_name', type: 'TEXT', nullable: true, description: 'Qualified name of the owner, denormalised so a row prints without a join; NULL when owner_type_id is NULL.' },
      { name: 'file_path', type: 'TEXT', indexed: true, description: 'Source file, as the parser recorded it (relative to the project root it was given).' },
      { name: 'start_line', type: 'INTEGER', description: '1-based first line of the declaration.' },
      { name: 'end_line', type: 'INTEGER', description: '1-based last line of the declaration.' },
      { name: 'provenance', type: 'TEXT', description: '`client` — from the analysed project; `lib` — from a staged library IR.' },
    ],
  },
  {
    name: 'types',
    description: 'Every class-like declaration the graph refers to: all client types, plus every library type that owns a listed library method or appears in type_ancestors.',
    columns: [
      { name: 'id', type: 'TEXT', key: true, description: 'The parser\'s unique hash (TYPE_REGISTRY_… / TS_TYPE_… / PY_TYPE_…).' },
      { name: 'name', type: 'TEXT', indexed: true, description: 'Simple name.' },
      { name: 'qualified_name', type: 'TEXT', indexed: true, description: 'Parser-qualified name.' },
      { name: 'category', type: 'TEXT', description: 'The parser\'s typeCategory — see vocabulary.' },
      { name: 'file_path', type: 'TEXT', indexed: true, description: 'Source file.' },
      { name: 'start_line', type: 'INTEGER', description: '1-based first line.' },
      { name: 'end_line', type: 'INTEGER', description: '1-based last line.' },
      { name: 'provenance', type: 'TEXT', description: '`client` or `lib`.' },
    ],
  },
  {
    name: 'call_sites',
    description: 'One row per place a call is written (or, for a synthesised edge, the construct that implies the call). Every call_edges.call_site_id is here. Location columns come from the IR; they are NULL when the site is a construct the IR does not position (see notes).',
    columns: [
      { name: 'id', type: 'TEXT', key: true, description: 'Site identifier — an expression hash in every language; in Python it may also be a decorator hash or, for METACLASS_CREATION, the class\'s type hash (see notes).' },
      { name: 'caller_id', type: 'TEXT', indexed: true, description: 'The method whose body contains the site (FK → methods.id) — or, for code that runs outside any method, the enclosing TYPE (Java: TYPE_REGISTRY_… = the type\'s static/instance initializer) or MODULE (TypeScript: TS_MODULE_… as a fallback marker). Never NULL. See notes.' },
      { name: 'kind', type: 'TEXT', description: 'What syntactic form the call takes — the same value as call_edges.kind for this site; see vocabulary (language-specific sets).' },
      { name: 'callee_name', type: 'TEXT', nullable: true, description: 'The name written at the site (`render` in `w.render()`, the class name in `new Widget()`); NULL when the form has no written name (a constructor delegation, a record deconstruction).' },
      { name: 'file_path', type: 'TEXT', nullable: true, indexed: true, description: 'Source file.' },
      { name: 'start_line', type: 'INTEGER', nullable: true, description: '1-based line.' },
      { name: 'start_column', type: 'INTEGER', nullable: true, description: 'Column, as the parser counts it.' },
      { name: 'end_line', type: 'INTEGER', nullable: true, description: '1-based last line; NULL where the IR records only the start.' },
      { name: 'end_column', type: 'INTEGER', nullable: true, description: 'End column; NULL where the IR records only the start.' },
    ],
  },
  {
    name: 'call_edges',
    description: 'THE GRAPH. One row per (site, resolved target). A site with N possible targets has N rows, each carrying the same tier; a site the engine could not resolve has exactly one row with a NULL callee and an `ambiguous_*` tier — so every call site written in the client appears at least once, and the table alone shows where every chain ends and why. Filter on `tier` to choose your risk tolerance.',
    columns: [
      { name: 'call_site_id', type: 'TEXT', indexed: true, description: 'FK → call_sites.id.' },
      { name: 'caller_id', type: 'TEXT', indexed: true, description: 'Same value as call_sites.caller_id for this site: the containing method, or the enclosing type/module id when there is none (see call_sites).' },
      { name: 'callee_method_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → methods.id of the resolved target, when the target is a method the bundle knows (callee_provenance client or lib). NULL otherwise.' },
      { name: 'callee_label', type: 'TEXT', nullable: true, description: 'The target when it is NOT a method row: a builtin (`builtin:len`) or an import path outside every staged IR (`requests.get`) — Python only today. NULL when callee_method_id is set or the site is unresolved.' },
      { name: 'callee_provenance', type: 'TEXT', nullable: true, description: 'Where the target lives — see vocabulary. NULL for an unresolved site.' },
      { name: 'tier', type: 'TEXT', indexed: true, description: 'Confidence class of this edge — see vocabulary. `known_edge` and `multi_inferred` are assertions about client code; `boundary_lib` leaves the client; the `ambiguous_*` tiers are declared blind spots, not edges.' },
      { name: 'kind', type: 'TEXT', description: 'Syntactic form of the site — see vocabulary; language-specific sets, kept native.' },
    ],
  },
  {
    name: 'type_ancestors',
    description: 'Transitive supertype closure: (type, ancestor) for every ancestor reachable through extends/implements/bases, client and library alike. Not a member-inheritance claim — in TypeScript an `implements` edge inherits nothing (the rule set keeps two closures; this is the conformance one).',
    columns: [
      { name: 'type_id', type: 'TEXT', key: true, indexed: true, description: 'FK → types.id.' },
      { name: 'ancestor_type_id', type: 'TEXT', key: true, indexed: true, description: 'FK → types.id.' },
    ],
  },
  {
    name: 'overrides',
    description: 'Virtual-dispatch pairs: (base method, overriding method) wherever a call to the base may run the override. Java only today — see notes for what the other front ends offer instead.',
    columns: [
      { name: 'method_id', type: 'TEXT', key: true, indexed: true, description: 'FK → methods.id — the base (declared) method.' },
      { name: 'overriding_method_id', type: 'TEXT', key: true, indexed: true, description: 'FK → methods.id — the override in a subtype.' },
    ],
  },
  {
    name: 'entry_points',
    description: 'Methods the runtime invokes without a client call site — process roots, test methods, HTTP handlers, framework hooks. The seeds of entry_reachable.',
    columns: [
      { name: 'method_id', type: 'TEXT', key: true, indexed: true, description: 'FK → methods.id.' },
      { name: 'reason', type: 'TEXT', key: true, description: 'Why it is an entry — see vocabulary.' },
    ],
  },
  {
    name: 'entry_reachable',
    description: 'Methods reachable from some entry point through call_edges (client edges only). A method absent here is dead from every known entry — or reachable only through a declared unknown.',
    columns: [
      { name: 'method_id', type: 'TEXT', key: true, description: 'FK → methods.id.' },
    ],
  },
  {
    name: 'unresolved_sites',
    description: 'The blind spots, attributed to the code that contains them: (caller, site) for every call site whose tier is `ambiguous_*` — a declared unknown, not an edge. A change-impact answer computed from a caller listed here is a lower bound. Derived from call_edges, so it is present in every language.',
    columns: [
      { name: 'caller_id', type: 'TEXT', key: true, indexed: true, description: 'Same domain as call_sites.caller_id: usually FK → methods.id.' },
      { name: 'call_site_id', type: 'TEXT', key: true, description: 'FK → call_sites.id.' },
    ],
  },
  {
    name: 'type_instantiated',
    description: 'Types the client actually creates an instance of — the rapid-type-analysis set that bounds virtual dispatch. (A subtype nothing instantiates cannot receive a dispatched call.)',
    columns: [
      { name: 'type_id', type: 'TEXT', key: true, indexed: true, description: 'FK → types.id.' },
      { name: 'how', type: 'TEXT', key: true, description: 'What creates the instance — see vocabulary.' },
    ],
  },
];

// ── the catalog tables themselves ───────────────────────────────────────────

export const CATALOG_TABLES: readonly TableSpec[] = [
  {
    name: 'schema_tables',
    description: 'Every table in this bundle with its scope and what it holds.',
    columns: [
      { name: 'name', type: 'TEXT', key: true, description: 'Table name.' },
      { name: 'scope', type: 'TEXT', description: '`core` — same schema in every language; `ext` — a language-specific relation, columns c0…cN; `catalog` — this documentation.' },
      { name: 'language', type: 'TEXT', nullable: true, description: 'For `ext`: the front end that defines it. NULL for core and catalog.' },
      { name: 'description', type: 'TEXT', description: 'What a row means. For `ext` this is the comment lifted from the rule that derives the relation, verbatim.' },
    ],
  },
  {
    name: 'schema_columns',
    description: 'Every column of every core and catalog table. (ext tables are positional: c0…cN, arity in schema_tables.description.)',
    columns: [
      { name: 'table_name', type: 'TEXT', key: true, description: 'FK → schema_tables.name.' },
      { name: 'ordinal', type: 'INTEGER', key: true, description: '0-based position.' },
      { name: 'name', type: 'TEXT', description: 'Column name.' },
      { name: 'type', type: 'TEXT', description: 'TEXT or INTEGER.' },
      { name: 'nullable', type: 'INTEGER', description: '1 if the column may be NULL (empty in CSV).' },
      { name: 'description', type: 'TEXT', description: 'Meaning.' },
    ],
  },
  {
    name: 'schema_vocab',
    description: 'Every enumerated value a core column may hold, and WHICH LANGUAGES emit it. Filter on the language in `run` to see the values that can occur in this bundle. A value observed in this run but not in the authored list is inserted with meaning `undocumented — observed in this run`, so the table is complete for the data it sits next to.',
    columns: [
      { name: 'table_name', type: 'TEXT', key: true, description: 'Core table.' },
      { name: 'column_name', type: 'TEXT', key: true, description: 'Column.' },
      { name: 'language', type: 'TEXT', key: true, description: '`java`, `typescript`, `python` — the front end that emits this value (one row per language; a value shared by all has three rows).' },
      { name: 'value', type: 'TEXT', key: true, description: 'The value as it appears in the column. A trailing `*` marks a prefix (e.g. `DECORATOR_*`).' },
      { name: 'meaning', type: 'TEXT', description: 'What it means.' },
    ],
  },
  {
    name: 'schema_guide',
    description: 'READ THIS FIRST. An ordered walkthrough of how to use this database: which tables answer which questions, what to check before trusting an answer, and where the language-specific details are.',
    columns: [
      { name: 'step', type: 'INTEGER', key: true, description: 'Reading order.' },
      { name: 'text', type: 'TEXT', description: 'The instruction.' },
    ],
  },
  {
    name: 'schema_queries',
    description: 'Canonical questions and the SQL that answers each, parameterised with named `:params`. Every query is verified to run against every language\'s bundle. Copy, bind, run.',
    columns: [
      { name: 'name', type: 'TEXT', key: true, description: 'Short identifier.' },
      { name: 'question', type: 'TEXT', description: 'The question in words.' },
      { name: 'params', type: 'TEXT', description: 'Comma-separated named parameters the SQL expects, e.g. `:qualified_name, :depth`.' },
      { name: 'sql', type: 'TEXT', description: 'The SQL.' },
    ],
  },
  {
    name: 'schema_notes',
    description: 'Per-language caveats that are not a vocabulary: what a table lacks in one front end, where an id may point, what a NULL means here.',
    columns: [
      { name: 'language', type: 'TEXT', description: '`java`, `typescript`, `python`, or `all`.' },
      { name: 'table_name', type: 'TEXT', description: 'The table the note is about.' },
      { name: 'note', type: 'TEXT', description: 'The caveat.' },
    ],
  },
];

// ── vocabularies ────────────────────────────────────────────────────────────

const J: readonly Language[] = ['java'];
const T: readonly Language[] = ['typescript'];
const P: readonly Language[] = ['python'];

export const VOCAB: readonly VocabSpec[] = [
  // run.key
  { table: 'run', column: 'key', value: 'schema_version', languages: 'all', meaning: 'Version of this contract (SCHEMA.md).' },
  { table: 'run', column: 'key', value: 'language', languages: 'all', meaning: 'Front end: java | typescript | python. Selects the applicable vocabulary rows.' },
  { table: 'run', column: 'key', value: 'engine_commit', languages: 'all', meaning: 'Git commit of the rule set that produced the graph, when known.' },
  { table: 'run', column: 'key', value: 'client_ir', languages: 'all', meaning: 'Path of the client IR directory the engine read.' },
  { table: 'run', column: 'key', value: 'library_roots', languages: 'all', meaning: 'Comma-separated library IR roots staged as the type oracle; empty for a client-only run.' },
  { table: 'run', column: 'key', value: 'dispatch_cap', languages: 'all', meaning: 'Fan-width cap on virtual dispatch in effect; `off` when uncapped.' },
  { table: 'run', column: 'key', value: 'jdk_depth', languages: 'all', meaning: 'Platform-library hop cap (engine-ii).' },
  { table: 'run', column: 'key', value: 'lib_depth', languages: 'all', meaning: 'External-library hop cap; `uncapped` when unset.' },
  { table: 'run', column: 'key', value: 'engine_ii', languages: 'all', meaning: '`on` when the library-frontier forward chain (engine-ii) was included; `off` for a client-only solve.' },
  { table: 'run', column: 'key', value: 'solve_iterations', languages: 'all', meaning: 'Stage↔solve rounds until the library frontier converged.' },
  { table: 'run', column: 'key', value: 'solve_seconds', languages: 'all', meaning: 'Wall-clock seconds of staging + solving, before the bundle stage.' },
  { table: 'run', column: 'key', value: 'created_at', languages: 'all', meaning: 'ISO-8601 timestamp of the bundle.' },
  { table: 'run', column: 'key', value: 'raw_dir', languages: 'all', meaning: 'Where the per-language Soufflé relations were read from (`raw/` next to the bundle).' },
  { table: 'run', column: 'key', value: 'source_version', languages: 'all', meaning: 'The version the IR was stamped with (bin/axiomcode): the git commit of the analysed source, or v1.0.0 when it was not a checkout. Present when the run went through bin/axiomcode all.' },
  { table: 'run', column: 'key', value: 'source_dir', languages: 'all', meaning: 'The source directory that was parsed. Present when the run went through bin/axiomcode all.' },

  // provenance (methods, types)
  { table: 'methods', column: 'provenance', value: 'client', languages: 'all', meaning: 'Declared in the analysed project.' },
  { table: 'methods', column: 'provenance', value: 'lib', languages: 'all', meaning: 'Declared in a staged library IR; listed because an edge reaches it.' },
  { table: 'types', column: 'provenance', value: 'client', languages: 'all', meaning: 'Declared in the analysed project.' },
  { table: 'types', column: 'provenance', value: 'lib', languages: 'all', meaning: 'Declared in a staged library IR.' },

  // methods.kind — the parser's methodKind
  { table: 'methods', column: 'kind', value: 'INSTANCE_METHOD', languages: J, meaning: 'Non-static method.' },
  { table: 'methods', column: 'kind', value: 'STATIC_METHOD', languages: J, meaning: 'Static method.' },
  { table: 'methods', column: 'kind', value: 'ABSTRACT_METHOD', languages: J, meaning: 'Abstract or interface method without a body.' },
  { table: 'methods', column: 'kind', value: 'DEFAULT_METHOD', languages: J, meaning: 'Interface default method.' },
  { table: 'methods', column: 'kind', value: 'CONSTRUCTOR', languages: ['java', 'typescript'], meaning: 'Constructor (Java `<init>`; TypeScript `constructor`).' },
  { table: 'methods', column: 'kind', value: 'STATIC_INITIALIZER', languages: J, meaning: '`static { … }` block.' },
  { table: 'methods', column: 'kind', value: 'ENUM_CONSTANT_METHOD', languages: J, meaning: 'Method body declared on an enum constant.' },
  { table: 'methods', column: 'kind', value: 'RECORD_ACCESSOR', languages: J, meaning: 'A record component accessor.' },
  { table: 'methods', column: 'kind', value: 'COMPACT_CONSTRUCTOR', languages: J, meaning: 'A record\'s compact canonical constructor.' },
  { table: 'methods', column: 'kind', value: 'DEFAULT_CONSTRUCTOR', languages: J, meaning: 'The implicit no-arg constructor the parser synthesises for a class that declares none.' },
  { table: 'methods', column: 'kind', value: 'INSTANCE_INITIALIZER', languages: J, meaning: '`{ … }` instance initializer block.' },
  { table: 'methods', column: 'kind', value: 'ANNOTATION_ELEMENT', languages: J, meaning: 'An element of an annotation interface.' },
  { table: 'methods', column: 'kind', value: 'RECORD_EQUALS', languages: J, meaning: 'A record\'s implicit equals.' },
  { table: 'methods', column: 'kind', value: 'RECORD_HASH_CODE', languages: J, meaning: 'A record\'s implicit hashCode.' },
  { table: 'methods', column: 'kind', value: 'RECORD_TO_STRING', languages: J, meaning: 'A record\'s implicit toString.' },
  { table: 'methods', column: 'kind', value: 'ENUM_VALUES', languages: J, meaning: 'An enum\'s implicit values().' },
  { table: 'methods', column: 'kind', value: 'ENUM_VALUE_OF', languages: J, meaning: 'An enum\'s implicit valueOf(String).' },
  { table: 'methods', column: 'kind', value: 'FUNCTION_DECLARATION', languages: T, meaning: '`function f() {}`.' },
  { table: 'methods', column: 'kind', value: 'METHOD_DECLARATION', languages: T, meaning: 'Class or interface method.' },
  { table: 'methods', column: 'kind', value: 'GETTER', languages: T, meaning: '`get x()`.' },
  { table: 'methods', column: 'kind', value: 'SETTER', languages: T, meaning: '`set x(v)`.' },
  { table: 'methods', column: 'kind', value: 'ARROW_FUNCTION', languages: T, meaning: 'Arrow function value.' },
  { table: 'methods', column: 'kind', value: 'FUNCTION_EXPRESSION', languages: T, meaning: '`function () {}` value.' },
  { table: 'methods', column: 'kind', value: 'METHOD_SIGNATURE', languages: T, meaning: 'Bodiless method in an interface/type.' },
  { table: 'methods', column: 'kind', value: 'CALL_SIGNATURE', languages: T, meaning: 'Interface call signature `(x): y`.' },
  { table: 'methods', column: 'kind', value: 'CONSTRUCT_SIGNATURE', languages: T, meaning: 'Interface construct signature `new (x): y`.' },
  { table: 'methods', column: 'kind', value: 'TYPE_LITERAL_METHOD_SIGNATURE', languages: T, meaning: 'Method signature inside a type literal.' },
  { table: 'methods', column: 'kind', value: 'TYPE_LITERAL_CALL_SIGNATURE', languages: T, meaning: 'Call signature inside a type literal.' },
  { table: 'methods', column: 'kind', value: 'TYPE_LITERAL_CONSTRUCT_SIGNATURE', languages: T, meaning: 'Construct signature inside a type literal.' },
  { table: 'methods', column: 'kind', value: 'FUNCTION_TYPE_SIGNATURE', languages: T, meaning: 'A function type `(x) => y`.' },
  { table: 'methods', column: 'kind', value: 'CONSTRUCTOR_TYPE_SIGNATURE', languages: T, meaning: 'A constructor type `new (x) => y`.' },
  { table: 'methods', column: 'kind', value: 'OBJECT_LITERAL_METHOD', languages: T, meaning: 'Method in an object literal.' },
  { table: 'methods', column: 'kind', value: 'CLASS_STATIC_BLOCK', languages: T, meaning: '`static { … }` in a class.' },
  { table: 'methods', column: 'kind', value: 'MODULE_INITIALIZER', languages: ['typescript', 'python'], meaning: 'Synthetic method holding a module\'s top-level code. Every module has one; top-level call sites belong to it.' },
  { table: 'methods', column: 'kind', value: 'FUNCTION', languages: P, meaning: 'Module-level `def`.' },
  { table: 'methods', column: 'kind', value: 'INSTANCE_METHOD', languages: P, meaning: 'Method taking `self`.' },
  { table: 'methods', column: 'kind', value: 'STATIC_METHOD', languages: P, meaning: '`@staticmethod`.' },
  { table: 'methods', column: 'kind', value: 'CLASS_METHOD', languages: P, meaning: '`@classmethod`.' },
  { table: 'methods', column: 'kind', value: 'PROPERTY_GETTER', languages: P, meaning: '`@property`.' },
  { table: 'methods', column: 'kind', value: 'PROPERTY_SETTER', languages: P, meaning: '`@x.setter`.' },
  { table: 'methods', column: 'kind', value: 'PROPERTY_DELETER', languages: P, meaning: '`@x.deleter`.' },
  { table: 'methods', column: 'kind', value: 'CONSTRUCTOR', languages: P, meaning: '`__init__`.' },
  { table: 'methods', column: 'kind', value: 'ALLOCATOR', languages: P, meaning: '`__new__`.' },
  { table: 'methods', column: 'kind', value: 'DUNDER_METHOD', languages: P, meaning: 'Other `__x__` method.' },
  { table: 'methods', column: 'kind', value: 'ABSTRACT_METHOD', languages: P, meaning: '`@abstractmethod`.' },
  { table: 'methods', column: 'kind', value: 'OVERLOAD_STUB', languages: P, meaning: '`@overload` signature.' },
  { table: 'methods', column: 'kind', value: 'LAMBDA', languages: P, meaning: 'A lambda expression.' },
  { table: 'methods', column: 'kind', value: 'NESTED_FUNCTION', languages: P, meaning: '`def` inside a function.' },
  { table: 'methods', column: 'kind', value: 'GENERATOR', languages: P, meaning: 'Function with `yield`.' },
  { table: 'methods', column: 'kind', value: 'ASYNC_FUNCTION', languages: P, meaning: '`async def`.' },
  { table: 'methods', column: 'kind', value: 'ASYNC_GENERATOR', languages: P, meaning: '`async def` with `yield`.' },
  { table: 'methods', column: 'kind', value: 'CLASS_INITIALIZER', languages: P, meaning: 'Synthetic method holding a class body\'s top-level code.' },

  // types.category — the parser's typeCategory
  { table: 'types', column: 'category', value: 'CLASS_TYPE', languages: 'all', meaning: 'A class.' },
  { table: 'types', column: 'category', value: 'INTERFACE_TYPE', languages: ['java', 'typescript'], meaning: 'An interface.' },
  { table: 'types', column: 'category', value: 'ENUM_TYPE', languages: ['java', 'typescript'], meaning: 'An enum.' },
  { table: 'types', column: 'category', value: 'RECORD_TYPE', languages: J, meaning: 'A record.' },
  { table: 'types', column: 'category', value: 'ANNOTATION_TYPE', languages: J, meaning: 'An annotation interface.' },
  { table: 'types', column: 'category', value: 'ANNOTATION_INTERFACE_TYPE', languages: J, meaning: 'An annotation interface (`@interface`), as the parser categorises it in newer output.' },
  { table: 'types', column: 'category', value: 'CONST_ENUM_TYPE', languages: T, meaning: '`const enum`.' },
  { table: 'types', column: 'category', value: 'TYPE_ALIAS_TYPE', languages: T, meaning: '`type X = …`.' },
  { table: 'types', column: 'category', value: 'NAMESPACE_TYPE', languages: T, meaning: '`namespace X {}`.' },
  { table: 'types', column: 'category', value: 'CLASS_EXPRESSION_TYPE', languages: T, meaning: 'A class expression value.' },
  { table: 'types', column: 'category', value: 'EXCEPTION_CLASS_TYPE', languages: P, meaning: 'A class deriving from BaseException.' },
  { table: 'types', column: 'category', value: 'ENUM_CLASS_TYPE', languages: P, meaning: 'An `Enum` subclass.' },
  { table: 'types', column: 'category', value: 'PROTOCOL_TYPE', languages: P, meaning: 'A `typing.Protocol`.' },
  { table: 'types', column: 'category', value: 'ABC_TYPE', languages: P, meaning: 'An abstract base class.' },
  { table: 'types', column: 'category', value: 'NAMEDTUPLE_TYPE', languages: P, meaning: 'A NamedTuple class.' },
  { table: 'types', column: 'category', value: 'TYPEDDICT_TYPE', languages: P, meaning: 'A TypedDict class.' },
  { table: 'types', column: 'category', value: 'DATACLASS_TYPE', languages: P, meaning: 'A `@dataclass`.' },
  { table: 'types', column: 'category', value: 'METACLASS_TYPE', languages: P, meaning: 'A metaclass (derives from `type`).' },
  { table: 'types', column: 'category', value: 'GENERIC_TYPE', languages: P, meaning: 'A `Generic[…]` class.' },

  // call_edges.tier
  { table: 'call_edges', column: 'tier', value: 'known_edge', languages: 'all', meaning: 'Exactly one target resolved. The strongest claim.' },
  { table: 'call_edges', column: 'tier', value: 'multi_inferred', languages: 'all', meaning: 'A sound SET of possible targets (virtual dispatch over instantiated subtypes); each member is one row. The set over-approximates; no member is a guess.' },
  { table: 'call_edges', column: 'tier', value: 'boundary_lib', languages: 'all', meaning: 'The target is outside the client (library, builtin, or unstaged external). The chain is not expanded past it here.' },
  { table: 'call_edges', column: 'tier', value: 'ambiguous_unknown', languages: 'all', meaning: 'Declared blind spot: the engine could not resolve the site (unresolved receiver, missing type, reflection…). callee is NULL. Never dropped.' },
  { table: 'call_edges', column: 'tier', value: 'ambiguous_anon', languages: J, meaning: 'Known structural gap: an anonymous-class creation has no candidate rule yet. callee is NULL.' },
  { table: 'call_edges', column: 'tier', value: 'ambient_terminal', languages: T, meaning: 'The target is an ambient declaration (a `.d.ts` signature with no body anywhere) — resolved, but there is nothing to expand into.' },
  { table: 'call_edges', column: 'tier', value: 'intrinsic_terminal', languages: T, meaning: 'The site is a JSX intrinsic element or a dynamic `import()` — a runtime intrinsic, not a function the graph can name.' },

  // call_edges.callee_provenance
  { table: 'call_edges', column: 'callee_provenance', value: 'client', languages: 'all', meaning: 'Target is a client method (callee_method_id set).' },
  { table: 'call_edges', column: 'callee_provenance', value: 'lib', languages: 'all', meaning: 'Target is a method of a staged library IR (callee_method_id set, methods.provenance = lib).' },
  { table: 'call_edges', column: 'callee_provenance', value: 'builtin', languages: P, meaning: 'Target is a CPython builtin with no Python source (callee_label = `builtin:NAME`).' },
  { table: 'call_edges', column: 'callee_provenance', value: 'external', languages: P, meaning: 'Target is named by an import path outside every staged IR (callee_label = the written path).' },

  // call_edges.kind / call_sites.kind — Java (engine-authored)
  { table: 'call_edges', column: 'kind', value: 'method', languages: J, meaning: '`obj.m()`, `Class.m()`, `super.m()`, or an unqualified `m()`.' },
  { table: 'call_edges', column: 'kind', value: 'new', languages: J, meaning: '`new X(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'ref', languages: J, meaning: 'A method reference `X::m`, `obj::m`, `X::new`.' },
  { table: 'call_edges', column: 'kind', value: 'ctor_delegate', languages: J, meaning: '`this(…)` / `super(…)` inside a constructor.' },
  { table: 'call_edges', column: 'kind', value: 'anon_new', languages: J, meaning: '`new X() { … }` — an anonymous class creation.' },
  { table: 'call_edges', column: 'kind', value: 'record_accessor', languages: J, meaning: 'Synthesised: a record pattern `case Pair(var l, var r)` calls each accessor. Not a written call; the site is the pattern expression.' },
  // — TypeScript (the parser's callKind)
  { table: 'call_edges', column: 'kind', value: 'FUNCTION_CALL', languages: T, meaning: '`f(…)` — a bare callee.' },
  { table: 'call_edges', column: 'kind', value: 'METHOD_CALL', languages: T, meaning: '`obj.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'CONSTRUCTOR_CALL', languages: T, meaning: '`new X(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'SUPER_CALL', languages: T, meaning: '`super(…)` or `super.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'TAGGED_TEMPLATE_CALL', languages: T, meaning: 'tag`…`.' },
  { table: 'call_edges', column: 'kind', value: 'INDEX_CALL', languages: T, meaning: '`obj[k](…)` through an index signature.' },
  { table: 'call_edges', column: 'kind', value: 'DYNAMIC_IMPORT_CALL', languages: T, meaning: '`import(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'DECORATOR_CALL', languages: T, meaning: 'A decorator application `@d` / `@d(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'OPTIONAL_CALL', languages: T, meaning: '`f?.(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'JSX_COMPONENT_CALL', languages: T, meaning: '`<Component …/>` (reserved by the parser; emitted by nothing yet).' },
  // — Python (the parser's callKind, plus engine-authored decorator/metaclass forms)
  { table: 'call_edges', column: 'kind', value: 'SIMPLE_CALL', languages: P, meaning: '`f(…)` — a bare name.' },
  { table: 'call_edges', column: 'kind', value: 'METHOD_CALL', languages: P, meaning: '`obj.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'CHAINED_CALL', languages: P, meaning: '`a.b().c(…)` — the receiver is itself a call.' },
  { table: 'call_edges', column: 'kind', value: 'SUPER_CALL', languages: P, meaning: '`super().m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'SELF_CALL', languages: P, meaning: '`self.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'CLS_CALL', languages: P, meaning: '`cls.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'MODULE_CALL', languages: P, meaning: '`module.f(…)` on an imported module.' },
  { table: 'call_edges', column: 'kind', value: 'SUBSCRIPT_CALL', languages: P, meaning: '`d[k](…)`.' },
  { table: 'call_edges', column: 'kind', value: 'DYNAMIC_CALL', languages: P, meaning: 'Callee computed at runtime (`getattr(...)()` and the like).' },
  { table: 'call_edges', column: 'kind', value: 'DECORATOR_CALL', languages: P, meaning: 'The factory call of a parenthesised decorator `@d(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'INSTANCE_CALL', languages: P, meaning: 'Calling an instance — dispatches to `__call__`.' },
  { table: 'call_edges', column: 'kind', value: 'BUILTIN_CALL', languages: P, meaning: 'The parser recognised a builtin (`len`, `print`, …).' },
  { table: 'call_edges', column: 'kind', value: 'UNKNOWN_CALLEE_CALL', languages: P, meaning: 'The parser could not classify the callee.' },
  { table: 'call_edges', column: 'kind', value: 'DECORATOR_APPLICATION', languages: P, meaning: 'Applying a parenthesised decorator\'s RESULT to the decorated definition. The site is the decorator hash.' },
  { table: 'call_edges', column: 'kind', value: 'DECORATOR_*', languages: P, meaning: 'Applying an unparenthesised decorator; the suffix is the parser\'s decorator kind: BARE, ATTRIBUTE, SUBSCRIPT, EXPRESSION (and CALL/ATTRIBUTE_CALL when the factory expression is not itself a call site). The site is the decorator hash.' },
  { table: 'call_edges', column: 'kind', value: 'METACLASS_CREATION', languages: P, meaning: '`class X(metaclass=M)` invokes `M.__new__` / `M.__init__` at import time. No written call; the site is the class\'s type hash.' },
  { table: 'call_edges', column: 'kind', value: 'PROPERTY_READ', languages: P, meaning: 'Reading `obj.attr` where `attr` is a `@property` runs the getter. No written call; the site is the attribute-access expression.' },
  { table: 'call_edges', column: 'kind', value: 'CONTEXT_MANAGER', languages: P, meaning: '`with expr:` runs `__enter__` / `__exit__` (or the async pair). No written call; the site is the context-manager expression.' },
  { table: 'call_edges', column: 'kind', value: 'ITERATION_PROTOCOL', languages: P, meaning: '`for x in expr:` (and comprehensions) runs `__iter__` / `__next__` (or the async pair). No written call; the site is the iterated expression.' },

  // entry_points.reason
  { table: 'entry_points', column: 'reason', value: 'main', languages: J, meaning: 'A static `main`.' },
  { table: 'entry_points', column: 'reason', value: 'test', languages: J, meaning: 'A JUnit test or lifecycle method.' },
  { table: 'entry_points', column: 'reason', value: 'http', languages: J, meaning: 'A JAX-RS / Spring MVC handler.' },
  { table: 'entry_points', column: 'reason', value: 'cli', languages: J, meaning: 'A CLI command method (picocli etc.).' },
  { table: 'entry_points', column: 'reason', value: 'bean_ctor', languages: J, meaning: 'Constructor of a container-managed bean.' },
  { table: 'entry_points', column: 'reason', value: 'factory', languages: J, meaning: 'A `@Bean` factory method.' },
  { table: 'entry_points', column: 'reason', value: 'lifecycle', languages: J, meaning: '`@PostConstruct` / `@PreDestroy` and similar hooks.' },
  { table: 'entry_points', column: 'reason', value: 'queue', languages: J, meaning: 'A message-listener method.' },
  { table: 'entry_points', column: 'reason', value: 'scheduled', languages: J, meaning: 'A `@Scheduled` method.' },
  { table: 'entry_points', column: 'reason', value: 'unimported_module', languages: T, meaning: 'The initializer of a module nothing imports — a script or a bundle root.' },

  // type_instantiated.how
  { table: 'type_instantiated', column: 'how', value: 'new', languages: ['java', 'python'], meaning: 'A constructor call in the client.' },
  { table: 'type_instantiated', column: 'how', value: 'anonymous', languages: J, meaning: 'An anonymous class exists only by being instantiated.' },
  { table: 'type_instantiated', column: 'how', value: 'enum_constant', languages: J, meaning: 'An enum\'s constants are its instances.' },
];

// ── notes ───────────────────────────────────────────────────────────────────

export const NOTES: readonly NoteSpec[] = [
  { language: 'all', table: 'methods', note: 'Library rows are the subset an edge reaches. To see a library method nothing calls, query the library IR itself.' },
  { language: 'java', table: 'call_sites', note: 'caller_id is a TYPE_REGISTRY_ id (a types row, not a methods row) for a call written in a field initializer or a static/instance initializer block: the parser gives such code no enclosing method, and the rule set attributes it to the type — read it as "runs in this type\'s <clinit>/<init>".' },
  { language: 'typescript', table: 'call_sites', note: 'caller_id is normally the parser\'s caller method, or the module initializer for top-level code; when neither exists it is the TS_MODULE_ hash itself, kept as a greppable marker rather than a blank.' },
  { language: 'java', table: 'call_sites', note: 'callee_name for `new X()` is the class name written at the site; NULL for ctor_delegate (`this(…)`/`super(…)`), anon_new, and record_accessor.' },
  { language: 'java', table: 'call_sites', note: 'A record_accessor site is the RECORD_PATTERN expression, positioned where the pattern is written.' },
  { language: 'typescript', table: 'call_sites', note: 'end_line / end_column come from the expression row; the call-site row itself records only the start.' },
  { language: 'typescript', table: 'overrides', note: 'EMPTY. TypeScript dispatch is captured directly as multi_inferred edges; the structural and nominal implementor sets are in ext_implementors, ext_structural_implementor and ext_type_satisfies.' },
  { language: 'typescript', table: 'type_instantiated', note: 'EMPTY. The TypeScript rule set does not export an instantiation set.' },
  { language: 'python', table: 'call_sites', note: 'PROPERTY_READ, CONTEXT_MANAGER and ITERATION_PROTOCOL rows are protocol edges with no written call: their site is the expression that triggers the protocol, and callee_name is NULL because nothing was written. Filter them out with kind NOT IN (…) when counting calls.' },
  { language: 'python', table: 'call_sites', note: 'The id is an EXPRESSION hash for a written call; a DECORATOR hash (PY_DECORATOR_…) for DECORATOR_APPLICATION and DECORATOR_* sites, positioned at the decorator line; and the class\'s TYPE hash for METACLASS_CREATION, positioned at the class declaration.' },
  { language: 'python', table: 'call_edges', note: 'A `boundary_lib` edge may point at a builtin (callee_provenance builtin, callee_label `builtin:NAME`) or at an unstaged import path (callee_provenance external) — neither has a methods row.' },
  { language: 'python', table: 'call_edges', note: 'The reason a site is ambiguous_unknown is exported per site in ext_call_site_unresolved (site, caller, reason, detail).' },
  { language: 'python', table: 'entry_points', note: 'EMPTY. The Python rule set does not derive entry points; entry_reachable is therefore empty too.' },
  { language: 'python', table: 'overrides', note: 'EMPTY. Python method lookup is by MRO, exported positionally in ext_mro_position (type, ancestor, …, position).' },
  { language: 'python', table: 'type_instantiated', note: 'Every row has how = `new`: the rule set records that some client call constructs the class, not which form.' },
  { language: 'all', table: 'call_edges', note: 'The raw relation has a seventh column, ToExpr, that is always `-` (reserved). It is dropped here.' },
  { language: 'all', table: 'call_edges', note: 'An unresolved site (tier ambiguous_*) has NULL callee_method_id, callee_label and callee_provenance. The raw relation writes `-` in those slots.' },
];

// ── the guide: how to use this database, in reading order ───────────────────

export const GUIDE: readonly string[] = [
  'This is a call graph of one codebase, derived by a type-directed Datalog engine. Start with `SELECT value FROM run WHERE key=\'language\'` — every language-specific fact below is keyed on it.',
  'The graph is `call_edges`: one row per (call site, possible target). Rows join to `methods` (names, files, lines) on `caller_id` / `callee_method_id`, and to `call_sites` on `call_site_id` for where the call is written. Identifiers are opaque hashes — never parse them, always join.',
  'Trust is explicit. `tier` says what kind of claim a row is: `known_edge` (one resolved target), `multi_inferred` (a sound set — every row of the set is a real possibility), `boundary_lib` (leaves the client; not expanded further), `ambiguous_*` (a declared unknown: callee is NULL). Pick the tiers your question tolerates and filter on them; never treat an `ambiguous_*` row as an edge.',
  'Before answering "nothing calls X" or "X cannot reach Y", check `unresolved_sites` for the methods on the path: a caller listed there has a call the engine could not resolve, so the answer is a lower bound and should say so.',
  'Library targets (`callee_provenance = lib`) are named in `methods` with `provenance = lib` but their bodies were not analysed; a Python `builtin`/`external` target has no methods row and lives in `callee_label`.',
  '`schema_vocab` lists every value a column can hold FOR THIS LANGUAGE with its meaning — filter on `language = (SELECT value FROM run WHERE key=\'language\')`. `schema_notes` lists the caveats for this language (empty tables, what an id may point at). Read both before interpreting `kind`, `tier` or an empty table.',
  '`schema_queries` holds tested SQL for the common questions (callers, callees, blast radius, entry reachability, the method at a file:line, the blind spots of a method). Bind the named parameters and run.',
  'Tables named `ext_<relation>` are the language\'s raw engine relations with positional columns c0…cN; `schema_tables` carries each one\'s description lifted from its rule. Use them only when a core table does not hold what you need.',
  'When you report a result, carry the tier and the unresolved count with it. A consumer who cannot see the confidence of an edge cannot use it.',
];

export interface QuerySpec { name: string; question: string; params: string; sql: string }

const LANG_SQL = "(SELECT value FROM run WHERE key='language')";
export const QUERIES: readonly QuerySpec[] = [
  {
    name: 'callers_of',
    question: 'Who calls this method, from where, and how sure is each edge?',
    params: ':qualified_name',
    sql: `SELECT caller.qualified_name AS caller, caller.file_path, s.start_line, e.tier, e.kind
FROM call_edges e
JOIN methods callee ON callee.id = e.callee_method_id
JOIN methods caller ON caller.id = e.caller_id
LEFT JOIN call_sites s ON s.id = e.call_site_id
WHERE callee.qualified_name = :qualified_name
ORDER BY caller.file_path, s.start_line`,
  },
  {
    name: 'callees_of',
    question: 'What does this method call — resolved targets, library boundaries, and the sites it could not resolve?',
    params: ':qualified_name',
    sql: `SELECT s.start_line, s.callee_name AS written, e.tier, e.callee_provenance,
       COALESCE(t.qualified_name, e.callee_label) AS target
FROM call_edges e
JOIN methods caller ON caller.id = e.caller_id
LEFT JOIN methods t ON t.id = e.callee_method_id
LEFT JOIN call_sites s ON s.id = e.call_site_id
WHERE caller.qualified_name = :qualified_name
ORDER BY s.start_line, target`,
  },
  {
    name: 'blast_radius',
    question: 'If this method changes, which methods are transitively affected, up to :depth hops, through sound edges only (known_edge and multi_inferred)?',
    params: ':qualified_name, :depth',
    sql: `WITH RECURSIVE up(id, depth) AS (
  SELECT id, 0 FROM methods WHERE qualified_name = :qualified_name
  UNION
  SELECT e.caller_id, up.depth + 1
  FROM call_edges e JOIN up ON e.callee_method_id = up.id
  WHERE e.tier IN ('known_edge', 'multi_inferred') AND up.depth < :depth
)
SELECT MIN(up.depth) AS depth, m.qualified_name, m.file_path, m.start_line,
       (SELECT count(*) FROM unresolved_sites u WHERE u.caller_id = m.id) AS unresolved_calls_inside
FROM up JOIN methods m ON m.id = up.id
WHERE up.depth > 0
GROUP BY m.id ORDER BY depth, m.qualified_name`,
  },
  {
    name: 'reachable_from_entries',
    question: 'Is this method reachable from any entry point (a main, a test, an HTTP handler, an unimported module)?',
    params: ':qualified_name',
    sql: `SELECT m.qualified_name,
       EXISTS (SELECT 1 FROM entry_reachable r WHERE r.method_id = m.id) AS reachable,
       (SELECT count(*) FROM entry_points) AS entry_points_known
FROM methods m WHERE m.qualified_name = :qualified_name`,
  },
  {
    name: 'method_at',
    question: 'Which method contains this file:line?',
    params: ':file_path, :line',
    sql: `SELECT qualified_name, kind, start_line, end_line
FROM methods
WHERE file_path = :file_path AND start_line <= :line AND end_line >= :line
ORDER BY (end_line - start_line) LIMIT 1`,
  },
  {
    name: 'blind_spots_of',
    question: 'Which calls inside this method could the engine not resolve — the caveat to attach to any answer about it?',
    params: ':qualified_name',
    sql: `SELECT s.start_line, s.callee_name AS written, s.kind
FROM unresolved_sites u
JOIN methods m ON m.id = u.caller_id
LEFT JOIN call_sites s ON s.id = u.call_site_id
WHERE m.qualified_name = :qualified_name
ORDER BY s.start_line`,
  },
  {
    name: 'subtypes_of',
    question: 'Which types extend or implement this type (transitively)?',
    params: ':qualified_name',
    sql: `SELECT sub.qualified_name, sub.category, sub.file_path
FROM type_ancestors a
JOIN types anc ON anc.id = a.ancestor_type_id
JOIN types sub ON sub.id = a.type_id
WHERE anc.qualified_name = :qualified_name
ORDER BY sub.qualified_name`,
  },
  {
    name: 'values_of',
    question: 'What can this column hold in THIS bundle\'s language, and what does each value mean?',
    params: ':table_name, :column_name',
    sql: `SELECT value, meaning FROM schema_vocab
WHERE table_name = :table_name AND column_name = :column_name AND language = ${LANG_SQL}
ORDER BY value`,
  },
  {
    name: 'tier_summary',
    question: 'How much of this graph is certain, inferred, at a library boundary, or unknown?',
    params: '',
    sql: `SELECT tier, count(*) AS edges, count(DISTINCT call_site_id) AS sites
FROM call_edges GROUP BY tier ORDER BY edges DESC`,
  },
];

// ── SCHEMA.md ───────────────────────────────────────────────────────────────

function mdEscape(s: string): string { return s.replace(/\|/g, '\\|'); }

export function renderSchemaMarkdown(): string {
  const out: string[] = [];
  out.push('# The output bundle — schema');
  out.push('');
  out.push(`_Generated from \`graph/bundle/schema.ts\` (schema version ${SCHEMA_VERSION}). Do not edit; run \`npm run schema-doc\`._`);
  out.push('');
  out.push('Every run, in every language, writes the same thing:');
  out.push('');
  out.push('```');
  out.push('<out>/');
  out.push('  graph.sqlite      the contract — the tables below, the ext_* tables, and this document as tables');
  out.push('and only with --debug:');
  out.push('  csv/<table>.csv   the core tables as headered, tab-delimited text (RFC 4180 quoting)');
  out.push('  raw/              the per-language Soufflé relations, verbatim. Engine-internal; not a contract.');
  out.push('```');
  out.push('');
  out.push('The same schema in every language — a table a front end does not derive is **empty, not missing**, and a note below says so. Where the front ends differ (which values a column can hold, what an id may point at) the difference is written here **and** in the `schema_vocab` / `schema_notes` tables inside the database, so a query can read it without leaving SQLite:');
  out.push('');
  out.push('```sql');
  out.push("SELECT value, meaning FROM schema_vocab WHERE table_name='call_edges' AND column_name='tier'");
  out.push("  AND language = (SELECT value FROM run WHERE key='language');");
  out.push('```');
  out.push('');
  out.push('Identifiers are the parser\'s hashes and are opaque; join them to `methods` / `types` / `call_sites` for names and positions. NULL in SQLite is the empty field in CSV.');
  out.push('');
  out.push('## How to use it (`schema_guide`)');
  out.push('');
  GUIDE.forEach((g, i) => out.push(`${i + 1}. ${g}`));
  out.push('');
  out.push('## Canonical queries (`schema_queries`)');
  out.push('');
  out.push('Each is verified to run against every language\'s bundle. Bind the named parameters.');
  out.push('');
  for (const q of QUERIES) {
    out.push(`**\`${q.name}\`** — ${q.question}${q.params ? ` _(${q.params})_` : ''}`);
    out.push('');
    out.push('```sql');
    out.push(q.sql);
    out.push('```');
    out.push('');
  }
  out.push('## Core tables');
  out.push('');
  for (const t of CORE_TABLES) {
    out.push(`### \`${t.name}\``);
    out.push('');
    out.push(t.description);
    out.push('');
    out.push('| # | column | type | null | meaning |');
    out.push('|---|---|---|---|---|');
    t.columns.forEach((c, i) => {
      out.push(`| ${i} | \`${c.name}\`${c.key ? ' 🔑' : ''} | ${c.type} | ${c.nullable ? 'yes' : ''} | ${mdEscape(c.description)} |`);
    });
    out.push('');
    const vocab = VOCAB.filter((v) => v.table === t.name);
    const cols = [...new Set(vocab.map((v) => v.column))];
    for (const col of cols) {
      out.push(`**\`${t.name}.${col}\` values**`);
      out.push('');
      out.push('| value | languages | meaning |');
      out.push('|---|---|---|');
      for (const v of vocab.filter((x) => x.column === col)) {
        const langs = v.languages === 'all' ? 'all' : v.languages.join(', ');
        out.push(`| \`${v.value}\` | ${langs} | ${mdEscape(v.meaning)} |`);
      }
      out.push('');
    }
    const notes = NOTES.filter((n) => n.table === t.name);
    if (notes.length > 0) {
      out.push('**Notes**');
      out.push('');
      for (const n of notes) out.push(`- **${n.language}** — ${n.note}`);
      out.push('');
    }
  }
  out.push('## Extended tables — `ext_<relation>`');
  out.push('');
  out.push('Every relation in the language\'s `graph/<lang>/souffle/export_manifest.tsv`, loaded as `ext_<relation>` with positional columns `c0…cN` (the raw relation is declared positionally; nothing here invents a name). `schema_tables` lists each one with its arity and the comment lifted from the rule that derives it — read that before querying. They are language-specific by construction: a bundle holds only the ext tables of its own language.');
  out.push('');
  out.push('## Catalog tables');
  out.push('');
  for (const t of CATALOG_TABLES) {
    out.push(`### \`${t.name}\``);
    out.push('');
    out.push(t.description);
    out.push('');
    out.push('| # | column | type | meaning |');
    out.push('|---|---|---|---|');
    t.columns.forEach((c, i) => out.push(`| ${i} | \`${c.name}\` | ${c.type} | ${mdEscape(c.description)} |`));
    out.push('');
  }
  return out.join('\n');
}
