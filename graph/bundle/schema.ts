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

export type Language = 'java' | 'typescript' | 'python' | 'javascript';
export const LANGUAGES: readonly Language[] = ['java', 'typescript', 'python', 'javascript'];

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
      { name: 'file_path', type: 'TEXT', nullable: true, indexed: true, description: 'Source file; NULL for an external type (no declaration was staged).' },
      { name: 'start_line', type: 'INTEGER', nullable: true, description: '1-based first line; NULL for an external type.' },
      { name: 'end_line', type: 'INTEGER', nullable: true, description: '1-based last line; NULL for an external type.' },
      { name: 'provenance', type: 'TEXT', description: '`client`, `lib`, or `external` (Java: an unstaged ancestor, see vocabulary).' },
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
    name: 'dispatch_candidates',
    description: 'THE DISPATCH ENVELOPE: (base method, method that may run instead) for every call that statically resolves to the base. This is the set `call_edges` narrowed FROM — the difference between "these are the targets" and "these are the targets, out of these possibilities". Populated in every language; `basis` says what admitted the pair, because the three front ends admit by different means.',
    columns: [
      { name: 'base_method_id', type: 'TEXT', key: true, indexed: true, description: 'FK → methods.id — the method a call resolves to statically.' },
      { name: 'candidate_method_id', type: 'TEXT', key: true, indexed: true, description: 'FK → methods.id — a method that may run instead at such a call.' },
      { name: 'basis', type: 'TEXT', key: true, description: 'What admitted the pair — see vocabulary. Filter on it to trust only declarations.' },
    ],
  },
  {
    name: 'overrides',
    description: 'Virtual-dispatch pairs: (base method, overriding method) wherever a call to the base may run the override. Java only, and kept for compatibility — it is exactly `dispatch_candidates` filtered to `basis = nominal`. Prefer `dispatch_candidates`, which is populated in every language.',
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
    name: 'fields',
    description: 'Every field-like storage location the graph refers to: all client fields and enum constants from the IR, plus every LIBRARY field some field_access edge reaches. A field is not a callable, so it has no row in `methods`; this is where `field_access.field_id` resolves to a name, an owner and a position.',
    columns: [
      { name: 'id', type: 'TEXT', key: true, description: 'The parser\'s unique hash for the field or enum constant (FIELD_REGISTRY_… / ENUM_CONSTANT_…). The value field_access.field_id refers to.' },
      { name: 'name', type: 'TEXT', indexed: true, description: 'Simple name as written (`count`, `RED`).' },
      { name: 'kind', type: 'TEXT', description: '`field` or `enum_constant` — see vocabulary. An enum constant is a static final field of its enum and is recorded here so `Colour.RED` resolves like any other read.' },
      { name: 'owner_type_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → types.id of the declaring class/interface/enum/record.' },
      { name: 'owner_qualified_name', type: 'TEXT', nullable: true, description: 'Qualified name of the owner, denormalised so a row prints without a join.' },
      { name: 'type_name', type: 'TEXT', nullable: true, description: 'The declared type as the parser wrote it; NULL for an enum constant, whose type is its own enum.' },
      { name: 'modifiers', type: 'TEXT', nullable: true, description: 'The parser\'s comma-separated modifier set (`STATIC,FINAL`); NULL where the IR records none.' },
      { name: 'file_path', type: 'TEXT', nullable: true, indexed: true, description: 'Source file.' },
      { name: 'start_line', type: 'INTEGER', nullable: true, description: '1-based first line of the declaration.' },
      { name: 'end_line', type: 'INTEGER', nullable: true, description: '1-based last line.' },
      { name: 'provenance', type: 'TEXT', description: '`client` — from the analysed project; `lib` — from a staged library IR.' },
    ],
  },
  {
    name: 'field_access',
    description: 'THE DATA GRAPH. One row per (site, resolved field), and the answer to "who reads or writes this field" — the question call_edges cannot answer, because a field access is not a call. A site with N possible fields has N rows carrying the same tier; a site the engine could not resolve has exactly one row with a NULL field and tier `ambiguous_unknown`, so every field access written in the client appears at least once and the table alone shows where the resolution stopped. A field is NOT virtually dispatched: a `known_edge` row names the storage location, not a best estimate of one.',
    columns: [
      { name: 'site_id', type: 'TEXT', indexed: true, description: 'The expression where the access is written. Not a call_sites id: a field access is not a call site. The location columns on this row are the site\'s own.' },
      { name: 'caller_id', type: 'TEXT', indexed: true, description: 'The method whose body contains the access (FK → methods.id) — or, for an access written in a field initializer or an initializer block, the enclosing TYPE, exactly as call_sites.caller_id does. Never NULL.' },
      { name: 'field_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → fields.id of the resolved field or enum constant. NULL when the site is unresolved.' },
      { name: 'field_provenance', type: 'TEXT', nullable: true, description: 'Where the field is declared — `client` or `lib`. NULL for an unresolved site.' },
      { name: 'access', type: 'TEXT', indexed: true, description: 'Which way the data moves — see vocabulary. Present on an unresolved row too: the direction is decided by how the access is WRITTEN, which does not need the receiver to resolve.' },
      { name: 'tier', type: 'TEXT', indexed: true, description: 'Confidence class of this edge — see vocabulary. Same four values and same promises as call_edges.tier.' },
      { name: 'file_path', type: 'TEXT', nullable: true, indexed: true, description: 'Source file of the site.' },
      { name: 'start_line', type: 'INTEGER', nullable: true, description: '1-based line of the site.' },
      { name: 'start_column', type: 'INTEGER', nullable: true, description: 'Column, as the parser counts it.' },
      { name: 'end_line', type: 'INTEGER', nullable: true, description: '1-based last line.' },
      { name: 'end_column', type: 'INTEGER', nullable: true, description: 'End column.' },
    ],
  },
  {
    name: 'type_use',
    description: 'THE OTHER HALF OF CHANGE IMPACT: one row per place a type is NAMED, with the context it was written in. `call_edges` says who calls a method and `field_access` who touches a field; this says what breaks if the TYPE changes — every signature, field, local, `new`, cast, `instanceof`, throws clause and generic argument that mentions it. A name that resolved to nothing is one row with a NULL type and tier `ambiguous_unknown`, so an unstaged third party is a declared unknown rather than an absence.',
    columns: [
      { name: 'reference_id', type: 'TEXT', indexed: true, description: 'The type-reference node. Not an expression id: a type reference is its own IR entity.' },
      { name: 'type_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → types.id of the type the name denotes. NULL when it resolved to nothing.' },
      { name: 'context', type: 'TEXT', indexed: true, description: 'Where the reference is written — see vocabulary. This is the column that makes an impact answer specific: `seventeen METHOD_PARAM and four FIELD_TYPE`, not `twenty-one mentions`.' },
      { name: 'depth', type: 'INTEGER', description: '0 for the type as written, 1 or more for a type argument of the one above it. A field of type `Map<String, Widget>` yields Map at depth 0 and String and Widget at depth 1; all three are uses of the type named.' },
      { name: 'owner_kind', type: 'TEXT', description: 'What kind of declaration carries the reference — see vocabulary. It says what `owner_id` points at.' },
      { name: 'owner_id', type: 'TEXT', description: 'The declaration that carries the reference. FK → methods.id when owner_kind is METHOD, → types.id for TYPE, → fields.id for FIELD; for METHOD_PARAM, LOCAL_VARIABLE, EXPRESSION and the annotation kinds it is the parser hash of an entity the bundle does not table, so join on owner_method_id / owner_type_id instead.' },
      { name: 'owner_method_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → methods.id of the method whose declaration or body contains the reference; NULL where there is none (a field type, a supertype clause).' },
      { name: 'owner_type_id', type: 'TEXT', nullable: true, indexed: true, description: 'FK → types.id of the type whose source contains the reference. Set for every reference written inside a type declaration.' },
      { name: 'type_provenance', type: 'TEXT', nullable: true, description: 'Where the referenced type is declared — `client` or `lib`. NULL when unresolved.' },
      { name: 'tier', type: 'TEXT', indexed: true, description: 'Confidence class — see vocabulary. Same four values and same promises as call_edges.tier.' },
    ],
  },
  {
    name: 'type_instantiated',
    description: 'Types this run creates an instance of — the rapid-type-analysis set that bounds virtual dispatch. (A subtype nothing instantiates cannot receive a dispatched call.) Deliberately an over-approximation: narrowing it on evidence the run does not have would lose real edges. Populated in every language.',
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
const S: readonly Language[] = ['javascript'];

export const VOCAB: readonly VocabSpec[] = [
  // run.key
  { table: 'run', column: 'key', value: 'schema_version', languages: 'all', meaning: 'Version of this contract (SCHEMA.md).' },
  { table: 'run', column: 'key', value: 'language', languages: 'all', meaning: 'Front end: java | typescript | python | javascript. Selects the applicable vocabulary rows.' },
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
  { table: 'types', column: 'provenance', value: 'external', languages: J, meaning: 'Named by the client as an ancestor (`extends`/`implements`) but declared in no staged IR: id `external:<qualified name>`, category EXTERNAL_TYPE, no file, no members. Kept so the subtype edge survives; stage the library to replace it with the real declaration.' },

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
  { table: 'methods', column: 'kind', value: 'DEFAULT_CONSTRUCTOR', languages: ['java', 'typescript'], meaning: 'The implicit no-arg constructor the parser synthesises for a class that declares none (TypeScript: and extends nothing; a subclass runs the nearest declared base constructor).' },
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

  // methods.kind — JavaScript (the parser's JsMethodKind)
  { table: 'methods', column: 'kind', value: 'FUNCTION_DECLARATION', languages: S, meaning: '`function f() {}` — hoisted.' },
  { table: 'methods', column: 'kind', value: 'FUNCTION_EXPRESSION', languages: S, meaning: '`function () {}` value, including an object literal\'s `m() {}`.' },
  { table: 'methods', column: 'kind', value: 'ARROW', languages: S, meaning: 'Arrow function value; `this` is lexical.' },
  { table: 'methods', column: 'kind', value: 'CLASS_METHOD', languages: S, meaning: 'A class member, syntactic or declared by assignment (`F.prototype.m = …`, `F.s = …`).' },
  { table: 'methods', column: 'kind', value: 'CONSTRUCTOR', languages: S, meaning: '`constructor()` of a class, or a constructor function.' },
  { table: 'methods', column: 'kind', value: 'GETTER', languages: S, meaning: '`get x()`.' },
  { table: 'methods', column: 'kind', value: 'SETTER', languages: S, meaning: '`set x(v)`.' },
  { table: 'methods', column: 'kind', value: 'STATIC_BLOCK', languages: S, meaning: '`static {}` block of a class.' },
  { table: 'methods', column: 'kind', value: 'MODULE_INITIALIZER', languages: S, meaning: 'Synthetic method holding a module\'s top-level code. Every module has one; top-level call sites belong to it.' },
  // types.category — the parser's typeCategory
  { table: 'types', column: 'category', value: 'CLASS_TYPE', languages: 'all', meaning: 'A class.' },
  { table: 'types', column: 'category', value: 'EXTERNAL_TYPE', languages: J, meaning: 'An unstaged ancestor named by the client — see provenance `external`. Class or interface is not known.' },
  { table: 'types', column: 'category', value: 'INTERFACE_TYPE', languages: ['java', 'typescript'], meaning: 'An interface.' },
  { table: 'types', column: 'category', value: 'ENUM_TYPE', languages: ['java', 'typescript'], meaning: 'An enum.' },
  { table: 'types', column: 'category', value: 'RECORD_TYPE', languages: J, meaning: 'A record.' },
  { table: 'types', column: 'category', value: 'ANNOTATION_TYPE', languages: J, meaning: 'An annotation interface.' },
  { table: 'types', column: 'category', value: 'ANNOTATION_INTERFACE_TYPE', languages: J, meaning: 'An annotation interface (`@interface`), as the parser categorises it in newer output.' },
  { table: 'types', column: 'category', value: 'CONST_ENUM_TYPE', languages: T, meaning: '`const enum`.' },
  { table: 'types', column: 'category', value: 'TYPE_ALIAS_TYPE', languages: T, meaning: '`type X = …`.' },
  { table: 'types', column: 'category', value: 'NAMESPACE_TYPE', languages: T, meaning: '`namespace X {}`.' },
  { table: 'types', column: 'category', value: 'CLASS_EXPRESSION_TYPE', languages: T, meaning: 'A class expression value.' },
  { table: 'types', column: 'category', value: 'CLASS', languages: S, meaning: 'An ES class declaration.' },
  { table: 'types', column: 'category', value: 'ANONYMOUS_CLASS', languages: S, meaning: 'A class expression.' },
  { table: 'types', column: 'category', value: 'CONSTRUCTOR_FUNCTION', languages: S, meaning: 'A function with prototype members — a pre-ES6 class.' },
  { table: 'types', column: 'category', value: 'JSDOC_TYPEDEF', languages: S, meaning: 'A `@typedef` — comment-only, never constructed or dispatched into.' },
  { table: 'types', column: 'category', value: 'JSDOC_CALLBACK', languages: S, meaning: 'A `@callback` — comment-only.' },
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
  { table: 'call_edges', column: 'tier', value: 'multi_inferred', languages: 'all', meaning: 'A sound SET of possible targets; each member is one row. The set over-approximates — every member is a real possibility, but not every member runs. HOW WIDE the set is differs by language: see the per-language notes on this table for whether the fan is narrowed by the instantiation set.' },
  { table: 'call_edges', column: 'tier', value: 'boundary_lib', languages: 'all', meaning: 'The target is outside the client (library, builtin, or unstaged external). The chain is not expanded past it here.' },
  { table: 'call_edges', column: 'tier', value: 'ambiguous_unknown', languages: 'all', meaning: 'Declared blind spot: the engine could not resolve the site (unresolved receiver, missing type, reflection…). callee is NULL. Never dropped.' },
  { table: 'call_edges', column: 'tier', value: 'ambiguous_anon', languages: J, meaning: 'Known structural gap: an anonymous-class creation has no candidate rule yet. callee is NULL.' },
  { table: 'call_edges', column: 'tier', value: 'ambient_terminal', languages: T, meaning: 'The target is an ambient declaration (a `.d.ts` signature with no body anywhere) — resolved, but there is nothing to expand into.' },
  { table: 'call_edges', column: 'tier', value: 'ambient_terminal', languages: S, meaning: 'The callee or receiver VALUE is the platform (`console.log`, `path.join`, `arr.forEach`) — a correct end, not a blind spot; callee is NULL. Beside a project edge it is the platform ALTERNATIVE of a `multi_inferred` site.' },
  { table: 'call_edges', column: 'tier', value: 'implicit_constructor', languages: S, meaning: '`new C()` / `super()` where no constructor exists up the chain: the synthesized default runs. A correct end; callee is NULL.' },
  { table: 'call_edges', column: 'tier', value: 'dynamic_terminal', languages: S, meaning: '`obj[expr]()`, `eval`, `import()`: no static target by construction; callee is NULL.' },
  { table: 'call_edges', column: 'tier', value: 'fan_capped', languages: ['javascript', 'java'], meaning: 'More targets than --dispatch-cap: the set was refused rather than emitted. JavaScript: callee is NULL. Java: callee is the declared base method the fan would have started from; dispatch-capped-sites.csv carries the refused count.' },
  { table: 'call_edges', column: 'tier', value: 'callback_registered', languages: S, meaning: 'The site HANDS the callee this function (`xs.forEach(f)`, `p.then(f)`, `emitter.on(\'x\', h)`, `setTimeout(f)`), which may invoke it. Not the site\'s own callee; a reachability edge, labelled so it is never read as a resolved call.' },
  { table: 'call_edges', column: 'tier', value: 'event_dispatch', languages: S, meaning: '`x.emit(\'name\')` reaching a handler registered by `x.on(\'name\', h)` on a value x may hold — name-sensitive for literal names, every handler on that value for a computed one.' },
  { table: 'call_edges', column: 'tier', value: 'intrinsic_terminal', languages: T, meaning: 'The site is a JSX intrinsic element or a dynamic `import()` — a runtime intrinsic, not a function the graph can name.' },

  // fields.kind / field_access.access / field_access.tier  (#663)
  { table: 'fields', column: 'kind', value: 'field', languages: ['java', 'typescript'], meaning: 'An ordinary field declaration.' },
  { table: 'fields', column: 'kind', value: 'enum_constant', languages: J, meaning: 'An enum constant. It is a static final field of its enum, and is listed here so `Colour.RED` resolves like any other read; the parser gives it its own table and its own hash prefix.' },
  { table: 'fields', column: 'provenance', value: 'client', languages: ['java', 'typescript'], meaning: 'Declared in the analysed project.' },
  { table: 'fields', column: 'provenance', value: 'lib', languages: ['java', 'typescript'], meaning: 'Declared in a staged library IR.' },
  { table: 'field_access', column: 'access', value: 'read', languages: ['java', 'typescript'], meaning: 'The value is used and not replaced.' },
  { table: 'field_access', column: 'access', value: 'write', languages: ['java', 'typescript'], meaning: 'The value is replaced without being read: a plain assignment `f = v`.' },
  { table: 'field_access', column: 'access', value: 'readwrite', languages: ['java', 'typescript'], meaning: 'The value is read and replaced at the one site: a compound assignment `f += v`, or `f++` / `--f`. One row, not two — a consumer asking "who writes f" and one asking "who reads f" must both match it.' },
  { table: 'field_access', column: 'tier', value: 'known_edge', languages: ['java', 'typescript'], meaning: 'Exactly one field resolved. Stronger than the call_edges tier of the same name: a field is not virtually dispatched, so this IS the storage location the access binds to.' },
  { table: 'field_access', column: 'tier', value: 'multi_inferred', languages: ['java', 'typescript'], meaning: 'A sound SET: the receiver has more than one possible type, or two unrelated ancestors declare the name (which Java itself treats as ambiguous). Each member is one row.' },
  { table: 'field_access', column: 'tier', value: 'boundary_lib', languages: ['java', 'typescript'], meaning: 'The field is declared in a staged library type. field_id is set and resolves in `fields` with provenance lib.' },
  { table: 'field_access', column: 'tier', value: 'ambiguous_unknown', languages: ['java', 'typescript'], meaning: 'Declared blind spot: the receiver could not be typed, or the name is not a member of the type it was typed to. field_id is NULL. Never dropped, and never replaced by a match on simple name.' },
  { table: 'field_access', column: 'field_provenance', value: 'client', languages: ['java', 'typescript'], meaning: 'The field is declared in the analysed project.' },
  { table: 'field_access', column: 'field_provenance', value: 'lib', languages: ['java', 'typescript'], meaning: 'The field is declared in a staged library IR.' },

  // type_use.*  (#663)
  { table: 'type_use', column: 'tier', value: 'known_edge', languages: ['java', 'typescript'], meaning: 'Exactly one type. A type reference is not dispatched, so this IS the declaration the name denotes.' },
  { table: 'type_use', column: 'tier', value: 'multi_inferred', languages: ['java', 'typescript'], meaning: 'A sound SET: two resolution paths both answer a simple name. Each member is one row.' },
  { table: 'type_use', column: 'tier', value: 'boundary_lib', languages: ['java', 'typescript'], meaning: 'The type is declared in a staged library IR. type_id resolves in `types` with provenance lib.' },
  { table: 'type_use', column: 'tier', value: 'ambiguous_unknown', languages: ['java', 'typescript'], meaning: 'Declared blind spot: the name resolved to nothing — an unstaged third party, or a type variable with no bound in view. type_id is NULL. Never dropped.' },
  { table: 'type_use', column: 'type_provenance', value: 'client', languages: ['java', 'typescript'], meaning: 'The referenced type is declared in the analysed project.' },
  { table: 'type_use', column: 'type_provenance', value: 'lib', languages: ['java', 'typescript'], meaning: 'The referenced type is declared in a staged library IR.' },
  { table: 'type_use', column: 'owner_kind', value: 'TYPE', languages: ['java', 'typescript'], meaning: 'The reference is on the type declaration itself: an extends or implements clause, or a type parameter bound. owner_id is a types.id.' },
  { table: 'type_use', column: 'owner_kind', value: 'METHOD', languages: ['java', 'typescript'], meaning: 'A return type, a throws clause, or a method type-parameter bound. owner_id is a methods.id.' },
  { table: 'type_use', column: 'owner_kind', value: 'METHOD_PARAM', languages: ['java', 'typescript'], meaning: 'A formal parameter\'s declared type. owner_id is the parameter\'s parser hash; join on owner_method_id.' },
  { table: 'type_use', column: 'owner_kind', value: 'FIELD', languages: ['java', 'typescript'], meaning: 'A field\'s declared type. owner_id is a fields.id.' },
  { table: 'type_use', column: 'owner_kind', value: 'LOCAL_VARIABLE', languages: J, meaning: 'A local, a catch parameter or a resource\'s declared type. owner_id is the local\'s parser hash; join on owner_method_id.' },
  { table: 'type_use', column: 'owner_kind', value: 'EXPRESSION', languages: ['java', 'typescript'], meaning: 'A type written inside an expression: `new T()`, a cast, an `instanceof`, a pattern, a method-reference qualifier. owner_id is the expression hash; join on owner_method_id.' },
  { table: 'type_use', column: 'owner_kind', value: 'ANNOTATION', languages: J, meaning: 'The annotation type itself, on whatever it annotates.' },
  { table: 'type_use', column: 'owner_kind', value: 'ANNOTATION_ARGUMENT', languages: J, meaning: 'A type named as an annotation argument, e.g. a `Class<?>` value.' },
  { table: 'type_use', column: 'context', value: 'FIELD_TYPE', languages: ['java', 'typescript'], meaning: 'The declared type of a field.' },
  { table: 'type_use', column: 'context', value: 'METHOD_PARAM', languages: ['java', 'typescript'], meaning: 'The declared type of a formal parameter.' },
  { table: 'type_use', column: 'context', value: 'METHOD_RETURN', languages: ['java', 'typescript'], meaning: 'The declared return type.' },
  { table: 'type_use', column: 'context', value: 'LOCAL_VARIABLE', languages: J, meaning: 'The declared type of a local, a catch parameter or a try-with-resources resource.' },
  { table: 'type_use', column: 'context', value: 'OBJECT_CREATION_TYPE', languages: ['java', 'typescript'], meaning: 'The type of a `new T(...)`.' },
  { table: 'type_use', column: 'context', value: 'ARRAY_CREATION_TYPE', languages: J, meaning: 'The element type of a `new T[n]`.' },
  { table: 'type_use', column: 'context', value: 'CAST_EXPRESSION', languages: J, meaning: 'The type of a `(T) x`.' },
  { table: 'type_use', column: 'context', value: 'INSTANCEOF_TYPE', languages: ['java', 'typescript'], meaning: 'The type tested by an `x instanceof T`.' },
  { table: 'type_use', column: 'context', value: 'SUPER_TYPE', languages: ['java', 'typescript'], meaning: 'An `extends` clause.' },
  { table: 'type_use', column: 'context', value: 'IMPLEMENTS_INTERFACE', languages: ['java', 'typescript'], meaning: 'An `implements` clause.' },
  { table: 'type_use', column: 'context', value: 'THROWS_CLAUSE', languages: J, meaning: 'A declared thrown type.' },
  { table: 'type_use', column: 'context', value: 'ANNOTATION_TYPE', languages: J, meaning: 'The annotation type applied to a declaration.' },
  { table: 'type_use', column: 'context', value: 'ANNOTATION_PARAM', languages: J, meaning: 'A type named as an annotation argument.' },
  { table: 'type_use', column: 'context', value: 'TYPE_PARAM_BOUND', languages: ['java', 'typescript'], meaning: 'The bound of a type parameter declared on a TYPE.' },
  { table: 'type_use', column: 'context', value: 'METHOD_TYPE_PARAM_BOUND', languages: ['java', 'typescript'], meaning: 'The bound of a type parameter declared on a METHOD.' },
  { table: 'type_use', column: 'context', value: 'METHOD_TYPE_ARGUMENT', languages: ['java', 'typescript'], meaning: 'An explicit type argument at a call site, `x.<T>m()`.' },
  { table: 'type_use', column: 'context', value: 'METHOD_REFERENCE_QUALIFIER', languages: J, meaning: 'The qualifier of a method reference, `T::m`.' },
  { table: 'type_use', column: 'context', value: 'PATTERN_BINDING_TYPE', languages: J, meaning: 'The type of a record-pattern component.' },
  { table: 'type_use', column: 'context', value: 'SWITCH_TYPE_PATTERN', languages: J, meaning: 'The type of a switch type pattern, `case T t ->`.' },
  { table: 'type_use', column: 'context', value: 'RECORD_PATTERN_TYPE', languages: J, meaning: 'The record type a deconstruction pattern matches.' },

  // type_use — the owner kinds and contexts TypeScript has and Java does not  (#663)
  { table: 'type_use', column: 'owner_kind', value: 'VARIABLE', languages: T, meaning: 'A `const` / `let` declaration\'s written type. A module-scope variable is a first-class declaration in TypeScript, so this covers what Java splits between FIELD and LOCAL_VARIABLE.' },
  { table: 'type_use', column: 'owner_kind', value: 'HERITAGE', languages: T, meaning: 'An extends or implements clause, which the parser gives its own entity rather than hanging off the type.' },
  { table: 'type_use', column: 'owner_kind', value: 'TYPE_PARAMETER', languages: T, meaning: 'A type parameter\'s bound or default.' },
  { table: 'type_use', column: 'owner_kind', value: 'TYPE_REFERENCE', languages: T, meaning: 'Another type reference: the row is a type ARGUMENT or an element of the reference named in owner_id. depth says how deep.' },
  { table: 'type_use', column: 'owner_kind', value: 'DECORATOR', languages: T, meaning: 'A decorator application.' },
  { table: 'type_use', column: 'owner_kind', value: 'ENUM_MEMBER', languages: T, meaning: 'An enum member\'s written type.' },
  { table: 'type_use', column: 'owner_kind', value: 'EXPORT', languages: T, meaning: 'An `export type` clause.' },
  { table: 'type_use', column: 'owner_kind', value: 'MODULE', languages: T, meaning: 'A module-level position with no finer owner.' },
  { table: 'type_use', column: 'context', value: 'VARIABLE_TYPE', languages: T, meaning: 'The written type of a `const` / `let` / `var`.' },
  { table: 'type_use', column: 'context', value: 'TYPE_ELEMENT', languages: T, meaning: 'A member\'s type inside an interface or a type literal.' },
  { table: 'type_use', column: 'context', value: 'HERITAGE_TWIN', languages: T, meaning: 'The second half of a heritage clause a declaration-merged type carries.' },
  { table: 'type_use', column: 'context', value: 'AS_TARGET', languages: T, meaning: 'The target of an `x as T`.' },
  { table: 'type_use', column: 'context', value: 'SATISFIES_TARGET', languages: T, meaning: 'The target of an `x satisfies T`.' },
  { table: 'type_use', column: 'context', value: 'TYPE_ASSERTION', languages: T, meaning: 'The target of a `<T>x` assertion.' },
  { table: 'type_use', column: 'context', value: 'TYPE_ARGUMENT', languages: T, meaning: 'A type argument of the reference in owner_id — `Widget` in `Map<string, Widget>`.' },
  { table: 'type_use', column: 'context', value: 'TYPE_PARAM_DEFAULT', languages: T, meaning: 'A type parameter\'s default, the `= T` in `<K = string>`.' },
  { table: 'type_use', column: 'context', value: 'TYPE_ALIAS_RHS', languages: T, meaning: 'The right-hand side of a `type X = …`.' },
  { table: 'type_use', column: 'context', value: 'INDEX_SIGNATURE_KEY', languages: T, meaning: 'The key type of an index signature.' },
  { table: 'type_use', column: 'context', value: 'INDEX_SIGNATURE_VALUE', languages: T, meaning: 'The value type of an index signature.' },
  { table: 'type_use', column: 'context', value: 'MAPPED_CONSTRAINT', languages: T, meaning: 'The constraint of a mapped type.' },
  { table: 'type_use', column: 'context', value: 'MAPPED_TEMPLATE', languages: T, meaning: 'The template of a mapped type.' },
  { table: 'type_use', column: 'context', value: 'CONDITIONAL_*', languages: T, meaning: 'A prefix: the check, extends, true and false branches of a conditional type.' },
  { table: 'type_use', column: 'context', value: 'TEMPLATE_SPAN', languages: T, meaning: 'A span of a template-literal type.' },
  { table: 'type_use', column: 'context', value: 'IMPORT_TYPE_QUALIFIER', languages: T, meaning: 'The qualifier of an `import("m").T`.' },
  { table: 'type_use', column: 'context', value: 'TYPE_PREDICATE_TARGET', languages: T, meaning: 'The target of an `x is T` predicate.' },
  { table: 'type_use', column: 'context', value: 'ENUM_MEMBER_TYPE', languages: T, meaning: 'An enum member\'s written type.' },
  { table: 'type_use', column: 'context', value: 'DECORATOR_TYPE', languages: T, meaning: 'The decorator itself.' },
  { table: 'type_use', column: 'context', value: 'DECORATOR_ARGUMENT_TYPE', languages: T, meaning: 'A type named in a decorator argument.' },

  // call_edges.callee_provenance
  { table: 'call_edges', column: 'callee_provenance', value: 'client', languages: 'all', meaning: 'Target is a client method (callee_method_id set).' },
  { table: 'call_edges', column: 'callee_provenance', value: 'lib', languages: 'all', meaning: 'Target is a method of a staged library IR (callee_method_id set, methods.provenance = lib).' },
  { table: 'call_edges', column: 'callee_provenance', value: 'builtin', languages: P, meaning: 'Target is a CPython builtin with no Python source (callee_label = `builtin:NAME`).' },
  { table: 'call_edges', column: 'callee_provenance', value: 'external', languages: ['python', 'java'], meaning: 'Target is outside every staged IR and has no methods row. Python: an import path (callee_label = the written path). Java: a method of an unstaged ancestor type (callee_label = `external:<type>.<name>`), reached through a receiver declared as that type or inherited by a client subclass; see types.provenance external.' },

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
  { table: 'call_edges', column: 'kind', value: 'PROPERTY_READ', languages: T, meaning: 'Reading `obj.x` where `x` is a `get` accessor runs the getter (engine-authored). No written call; the site is the property-access expression. A compound assignment or `++` reads before it writes, so it carries this and PROPERTY_WRITE.' },
  { table: 'call_edges', column: 'kind', value: 'PROPERTY_WRITE', languages: T, meaning: 'Assigning `obj.x = v` where `x` is a `set` accessor runs the setter (engine-authored). No written call; the site is the property-access expression on the left.' },
  // — JavaScript (the parser's JsCallKind)
  { table: 'call_edges', column: 'kind', value: 'FUNCTION_CALL', languages: S, meaning: '`f(…)` — a bare callee, resolved by the binder.' },
  { table: 'call_edges', column: 'kind', value: 'METHOD_CALL', languages: S, meaning: '`obj.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'CONSTRUCTOR_CALL', languages: S, meaning: '`new X(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'SUPER_CALL', languages: S, meaning: '`super(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'COMPUTED_CALL', languages: S, meaning: '`obj[expr](…)` — the name is not fixed by syntax.' },
  { table: 'call_edges', column: 'kind', value: 'FUNCTION_CALL_CALL', languages: S, meaning: '`f.call(o, …)` — the target is f; the receiver moved into argument position.' },
  { table: 'call_edges', column: 'kind', value: 'FUNCTION_CALL_APPLY', languages: S, meaning: '`f.apply(o, args)` — the target is f.' },
  { table: 'call_edges', column: 'kind', value: 'FUNCTION_CALL_BIND', languages: S, meaning: '`f.bind(o)` — produces a function that runs f; the edge names f.' },
  { table: 'call_edges', column: 'kind', value: 'IIFE_CALL', languages: S, meaning: '`(function () {…})()`.' },
  { table: 'call_edges', column: 'kind', value: 'OPTIONAL_CALL', languages: S, meaning: '`obj?.m(…)`.' },
  { table: 'call_edges', column: 'kind', value: 'TAGGED_TEMPLATE_CALL', languages: S, meaning: 'tag`…`.' },
  { table: 'call_edges', column: 'kind', value: 'DYNAMIC_CODE_CALL', languages: S, meaning: '`eval(…)` / `new Function(…)` — unknowable by construction.' },
  { table: 'call_edges', column: 'kind', value: 'DYNAMIC_IMPORT_CALL', languages: S, meaning: '`import(…)` — a module load that is also a site.' },
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
  { table: 'call_edges', column: 'kind', value: 'METACLASS_CREATION', languages: P, meaning: 'A class statement invokes its metaclass\'s `__new__` / `__init__` at import time, whether the metaclass is written on the statement (`class X(metaclass=M)`) or inherited from a base, and the nearest base\'s `__init_subclass__`. No written call; the site is the class\'s type hash.' },
  { table: 'call_edges', column: 'kind', value: 'PROPERTY_READ', languages: P, meaning: 'Reading `obj.attr` where `attr` is a `@property` runs the getter; reading `Cls.attr` where the METACLASS defines `attr` as a property runs that getter. No written call; the site is the attribute-access expression.' },
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
  { table: 'entry_points', column: 'reason', value: 'unimported_module', languages: ['typescript', 'javascript'], meaning: 'The initializer of a module nothing imports — a script or a bundle root.' },

  // dispatch_candidates.basis
  { table: 'dispatch_candidates', column: 'basis', value: 'nominal', languages: ['java', 'typescript'], meaning: 'A written extends/implements reaches the candidate\'s owner from the base\'s owner. The strongest evidence there is: the author declared the relationship.' },
  { table: 'dispatch_candidates', column: 'basis', value: 'structural', languages: T, meaning: 'No declaration; the candidate\'s owner satisfies the base\'s owner by SHAPE. Emitted only for supertypes with no nominal implementor at all, so it never competes with a declared answer — but it is a heuristic, and a consumer that wants declarations only filters it out.' },
  { table: 'dispatch_candidates', column: 'basis', value: 'mro', languages: P, meaning: 'The subtype\'s C3 linearisation picks the candidate for that attribute name. Not merely "the subtype declares this name" — a name a sibling base wins is attributed to that sibling.' },

  // type_instantiated.how
  { table: 'type_instantiated', column: 'how', value: 'new', languages: 'all', meaning: 'A constructor call — `new C()` / `C()`.' },
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
  { language: 'javascript', table: 'methods', note: 'signature is empty and owner_qualified_name is NULL: JavaScript declares neither. owner_type_id is set for class members, including members declared by assignment.' },
  { language: 'javascript', table: 'methods', note: 'A library row\'s qualified_name and file_path are prefixed with the package: its path under the client when installed there (`node_modules/<pkg>/…`, nested versions included), else its package name (`<pkg>/…`; a second root with the same name gets `#2`). The parser records both relative to the package root, where two packages with an index.js are indistinguishable. Same for types.' },
  { language: 'javascript', table: 'call_sites', note: 'caller_id is the parser\'s enclosing method, or the module initializer for top-level code. end_line / end_column come from the expression row. `require()` is a module edge, not a call site.' },
  { language: 'javascript', table: 'call_edges', note: 'Targets are VALUES the receiver may hold, not declared types: a `multi_inferred` set is the union of what flowed into the receiver. An untyped receiver is `ambiguous_unknown`, never a name match.' },
  { language: 'typescript', table: 'overrides', note: 'EMPTY — this table is Java-shaped. The TypeScript dispatch envelope is in dispatch_candidates, with basis `nominal` or `structural`.' },
  { language: 'typescript', table: 'type_instantiated', note: 'Every row has how = `new`. Not restricted to client provenance: a type the library constructs is still a type that exists at run time, and dropping it would narrow the envelope unsoundly.' },
  { language: 'typescript', table: 'call_sites', note: 'PROPERTY_READ and PROPERTY_WRITE rows are accessor invocations with no written call: the site is the property-access expression that runs the getter or setter, positioned from the expressions table, and callee_name is NULL because nothing was written; the accessor\'s name is on the callee\'s methods row. Filter them out with kind NOT IN (…) when counting calls.' },
  { language: 'python', table: 'call_sites', note: 'PROPERTY_READ, CONTEXT_MANAGER and ITERATION_PROTOCOL rows are protocol edges with no written call: their site is the expression that triggers the protocol, and callee_name is NULL because nothing was written. Filter them out with kind NOT IN (…) when counting calls.' },
  { language: 'python', table: 'call_sites', note: 'The id is an EXPRESSION hash for a written call; a DECORATOR hash (PY_DECORATOR_…) for DECORATOR_APPLICATION and DECORATOR_* sites, positioned at the decorator line; and the class\'s TYPE hash for METACLASS_CREATION, positioned at the class declaration.' },
  { language: 'python', table: 'call_edges', note: 'A `boundary_lib` edge may point at a builtin (callee_provenance builtin, callee_label `builtin:NAME`) or at an unstaged import path (callee_provenance external) — neither has a methods row.' },
  { language: 'java', table: 'call_edges', note: 'A `boundary_lib` edge with callee_provenance external names a method of an ancestor type no staged IR declares (callee_label `external:<type>.<name>`, no methods row). A site whose receiver is declared as such a type is multi_inferred even with one client override: the platform method itself, and the platform\'s own subclasses, are the other possible targets. Stage the library to replace the label with the real method.' },
  { language: 'python', table: 'call_edges', note: 'The reason a site is ambiguous_unknown is exported per site in ext_call_site_unresolved (site, caller, reason, detail).' },
  { language: 'python', table: 'entry_points', note: 'EMPTY. The Python rule set does not derive entry points; entry_reachable is therefore empty too.' },
  { language: 'python', table: 'overrides', note: 'EMPTY — this table is Java-shaped. The Python dispatch envelope is in dispatch_candidates with basis `mro`; the raw linearisation is in ext_mro_position.' },
  { language: 'python', table: 'type_instantiated', note: 'Every row has how = `new`: the rule set records that some client call constructs the class, not which form.' },
  { language: 'all', table: 'call_edges', note: 'THE TRUST LINE, and it is not the same set of tiers in every language. RESOLVED (callee_method_id is set): known_edge, multi_inferred, boundary_lib, and in TypeScript ALSO ambient_terminal and intrinsic_terminal. BLIND SPOT (callee is NULL): ambiguous_unknown, and in Java ALSO ambiguous_anon. A filter written as `tier IN (known_edge, multi_inferred)` therefore drops resolved edges in TypeScript and nowhere else — derive the set from this note or from unresolved_sites, never from a hardcoded list.' },
  { language: 'java', table: 'call_edges', note: 'A multi_inferred fan is CHA-wide: it is every override the hierarchy admits, bounded only by the dispatch cap. type_instantiated is computed and exported but NOT read by any rule, so the fan is not narrowed to types the program constructs. Narrow it yourself by joining dispatch_candidates to type_instantiated — see the dispatch_envelope_of query. A receiver is ALSO typed by what flows into it (a local\'s initializer, the arguments callers pass to a parameter, the receivers callers invoke a method on for its `this`), and each flow-in type resolves its member directly, outside the fan: that is why a `fan_capped` site still carries edges, and why they are the types the program was seen to hand over, not the whole hierarchy.' },
  { language: 'typescript', table: 'call_edges', note: 'A multi_inferred fan is CHA-wide, as in Java: type_instantiated is computed and exported but NOT read by any rule. The fan also has sources that are not virtual dispatch at all — an overload set or a union-typed receiver produces one too.' },
  { language: 'python', table: 'call_edges', note: 'A multi_inferred fan IS narrowed by the instantiation set: type_instantiated_reachable (the constructed classes and their bases) bounds dispatch in resolution/dispatch.dl. Python is the only front end where that narrowing is applied, so a fan here is tighter than the same shape would be in Java or TypeScript.' },
  { language: 'all', table: 'type_use', note: 'JAVA AND TYPESCRIPT. Declared in every bundle and EMPTY for Python and JavaScript, so the schema does not churn as the remaining front ends land (#663).' },
  { language: 'typescript', table: 'type_use', note: 'The context set is TypeScript\'s own and is wider than Java\'s: AS_TARGET, SATISFIES_TARGET, TYPE_ALIAS_RHS, the CONDITIONAL_* family, MAPPED_*, INDEX_SIGNATURE_* and TEMPLATE_SPAN have no Java counterpart. A use inside a conditional type IS a use of that type and is recorded as one.' },
  { language: 'typescript', table: 'type_use', note: 'Only a reference whose KIND can name a declaration is a row: TYPE_REFERENCE and IMPORT_TYPE. ARRAY, UNION, TUPLE and PARENTHESIZED are structure whose CHILDREN are the named references; PRIMITIVE, LITERAL, TYPE_VARIABLE, MAPPED, CONDITIONAL, INDEXED_ACCESS and INTRINSIC name nothing declared.' },
  { language: 'java', table: 'type_use', note: 'EVERY DEPTH is here, unlike the receiver-typing relations the engine uses internally, which filter to depth 0. A field of type `Map<String, Widget>` produces three rows. Filter on `depth = 0` when you want the type an expression has rather than every type its declaration mentions.' },
  { language: 'java', table: 'type_use', note: 'A TYPE_VARIABLE reference (`T`, `E`) is not a row: it names the declaration\'s own parameter, not a type. Where the parameter has a written bound the USE resolves to that bound and IS a row, so `<T extends Node> void f(T t)` records a use of Node.' },
  { language: 'java', table: 'type_use', note: 'The reference rows carry no line in the Java IR (every all-type-references row has an empty startLine), so this table has no position columns. Use owner_method_id, or owner_type_id plus the types row, to locate a use.' },
  { language: 'all', table: 'field_access', note: 'JAVA AND TYPESCRIPT. The table is declared in every bundle and is EMPTY for Python and JavaScript, so the schema does not churn as the remaining front ends land (#663). Check `SELECT count(*) FROM field_access` before reading an empty result as "nothing reads this field".' },
  { language: 'all', table: 'fields', note: 'JAVA AND TYPESCRIPT, for the same reason as field_access: declared everywhere, populated by those two front ends.' },
  { language: 'typescript', table: 'field_access', note: 'AN ACCESSOR IS NOT HERE. `get url()` read as `c.url` is a CALL, and call_edges already carries it with kind PROPERTY_READ or PROPERTY_WRITE (#703). The two tables are disjoint by construction: this one holds properties, call_edges holds accessors. Ask both when you want every read of a member.' },
  { language: 'typescript', table: 'field_access', note: 'AN ELEMENT ACCESS IS NOT HERE either: `obj["x"]` with a literal key is a different node kind and is not yet a site. A known gap, not a silent one.' },
  { language: 'typescript', table: 'field_access', note: 'A METHOD IS NOT A SITE. The callee of `obj.m()` is a PROPERTY_ACCESS node (37% of them, measured on immer), and `const f = obj.m` reads a method as a value; neither is a data edge, and admitting them would fill the ambiguous_unknown tier with sites the engine HAS resolved elsewhere. Both are excluded and counted in ext_field_site_excluded with reasons method_callee and method_value.' },
  { language: 'typescript', table: 'fields', note: 'An enum member is absent: the parser gives it its own table with no declared type, and the property-access relation resolves through the field table. `Colour.Red` is therefore an unresolved field access, unlike Java where an enum constant is a fields row.' },
  { language: 'java', table: 'field_access', note: 'A field access written in a SWITCH CASE LABEL is deliberately absent. An enum constant in a case label is recorded TYPE for some arms and FIELD for others (#760), and javac compiles the switch through a $SwitchMap array rather than through a read of the constant, so there is no field access in the bytecode either.' },
  { language: 'java', table: 'field_access', note: 'A field read that PRECEDES a same-named local declared later in the same method is missing: the parser classifies such a name LOCAL_VARIABLE against the whole body rather than against the scope at the use site (#725), so the site never reaches the engine and is absent rather than ambiguous. Rare (1 in 5,647 local references measured) but it is an absence, not a declared unknown.' },
  { language: 'java', table: 'field_access', note: 'ARRAY ELEMENTS are not tracked: `a[i] = v` where `a` is a field is recorded as a READ of `a` (the array reference is read; the element write is not a field write). This matches the bytecode, where the instruction is `getfield a` followed by `aastore`.' },
  { language: 'java', table: 'fields', note: 'A library field is listed only when some field_access edge reaches it, exactly as methods lists only the library methods an edge reaches.' },
  { language: 'all', table: 'call_edges', note: 'The raw relation has a seventh column, ToExpr, that is always `-` (reserved). It is dropped here.' },
  { language: 'all', table: 'call_edges', note: 'An unresolved site (tier ambiguous_*) has NULL callee_method_id, callee_label and callee_provenance. The raw relation writes `-` in those slots.' },
];

// ── the guide: how to use this database, in reading order ───────────────────

export const GUIDE: readonly string[] = [
  'This is a call graph of one codebase, derived by a type-directed Datalog engine. Start with `SELECT value FROM run WHERE key=\'language\'` — every language-specific fact below is keyed on it.',
  'The graph is `call_edges`: one row per (call site, possible target). Rows join to `methods` (names, files, lines) on `caller_id` / `callee_method_id`, and to `call_sites` on `call_site_id` for where the call is written. Identifiers are opaque hashes — never parse them, always join.',
  'Trust is explicit. `tier` says what kind of claim a row is: `known_edge` (one resolved target), `multi_inferred` (a sound set — every row of the set is a real possibility), `boundary_lib` (leaves the client; not expanded further), `ambiguous_*` (a declared unknown: callee is NULL). Pick the tiers your question tolerates and filter on them; never treat an `ambiguous_*` row as an edge.',
  'For a FIELD rather than a callable, the graph is `field_access`: one row per (site, resolved field), joined to `fields` on `field_id` and to `methods` on `caller_id`, with `access` saying read / write / readwrite. It carries the same four tiers and the same promise as `call_edges`, so "who writes Foo.bar" is answered with a confidence, not with a name match. Java only so far; the table is present and empty elsewhere.',
  'For a TYPE, the graph is `type_use`: one row per place the type is named, with the `context` it was written in (FIELD_TYPE, METHOD_PARAM, METHOD_RETURN, OBJECT_CREATION_TYPE, CAST_EXPRESSION, SUPER_TYPE and the rest) and the `depth` that separates the type as written from its type arguments. That is what makes "what breaks if I change T" specific per construct rather than a count of mentions. Java only so far.',
  '`call_edges` is what the engine CONCLUDED; `dispatch_candidates` is what the hierarchy ADMITTED. Read the second when you need an upper bound rather than a best answer — a candidate whose owner is absent from `type_instantiated` is admitted by the hierarchy but never constructed in this run, which is how you narrow it yourself. `basis` separates a declared relationship from a shape match.',
  'Before answering "nothing calls X" or "X cannot reach Y", check `unresolved_sites` for the methods on the path: a caller listed there has a call the engine could not resolve, so the answer is a lower bound and should say so.',
  'Library targets (`callee_provenance = lib`) are named in `methods` with `provenance = lib` but their bodies were not analysed; a Python `builtin`/`external` target has no methods row and lives in `callee_label`.',
  '`schema_vocab` lists every value a column can hold FOR THIS LANGUAGE with its meaning — filter on `language = (SELECT value FROM run WHERE key=\'language\')`. `schema_notes` lists the caveats for this language (empty tables, what an id may point at). Read both before interpreting `kind`, `tier` or an empty table.',
  '`schema_queries` holds tested SQL for the common questions (callers, callees, blast radius, entry reachability, the method at a file:line, the blind spots of a method, the dispatch envelope of a method). Bind the named parameters and run.',
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
    question: 'If this method changes, which methods are transitively affected, up to :depth hops, through RESOLVED client edges only (a declared unknown is not traversed, and the count of them is returned alongside)?',
    params: ':qualified_name, :depth',
    sql: `WITH RECURSIVE up(id, depth) AS (
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
    name: 'dispatch_envelope_of',
    question: 'What else might actually run at a call that resolves to this method — the set the graph narrowed from, and whether each candidate is a declaration or a shape match?',
    params: ':qualified_name',
    sql: `SELECT cand.qualified_name AS candidate, cand.file_path, cand.start_line, d.basis,
       EXISTS (SELECT 1 FROM type_instantiated i WHERE i.type_id = cand.owner_type_id) AS owner_instantiated
FROM dispatch_candidates d
JOIN methods base ON base.id = d.base_method_id
JOIN methods cand ON cand.id = d.candidate_method_id
WHERE base.qualified_name = :qualified_name
ORDER BY d.basis, cand.qualified_name`,
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
    name: 'field_impact',
    question: 'Who reads or writes this field — and which of those answers are certain?',
    params: ':owner_qualified_name, :field_name',
    sql: `SELECT m.qualified_name AS accessor, fa.access, fa.tier, fa.file_path, fa.start_line
FROM field_access fa
JOIN fields f ON f.id = fa.field_id
LEFT JOIN methods m ON m.id = fa.caller_id
WHERE f.owner_qualified_name = :owner_qualified_name AND f.name = :field_name
ORDER BY fa.tier, m.qualified_name, fa.start_line`,
  },
  {
    name: 'field_blind_spots',
    question: 'Which field accesses could the engine not resolve — the caveat to attach to any answer about a field?',
    params: '',
    sql: `SELECT m.qualified_name AS accessor, fa.access, fa.file_path, fa.start_line
FROM field_access fa
LEFT JOIN methods m ON m.id = fa.caller_id
WHERE fa.tier = 'ambiguous_unknown'
ORDER BY fa.file_path, fa.start_line`,
  },
  {
    name: 'type_impact',
    question: 'Where is this type used, and in what construct — the answer to "what breaks if I change it"?',
    params: ':qualified_name',
    sql: `SELECT u.context, u.depth, u.tier,
       coalesce(m.qualified_name, ot.qualified_name) AS used_in,
       coalesce(m.file_path, ot.file_path) AS file_path
FROM type_use u
JOIN types t ON t.id = u.type_id
LEFT JOIN methods m ON m.id = u.owner_method_id
LEFT JOIN types ot ON ot.id = u.owner_type_id
WHERE t.qualified_name = :qualified_name
ORDER BY u.context, used_in`,
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
