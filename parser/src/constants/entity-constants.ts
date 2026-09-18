export const ENTITY_IDENTIFIERS = {
  TYPE_REGISTRY: 'TYPE_REGISTRY',
  SERVICE_VERSION: 'SERVICE_VERSION',
  TYPE_PARAMETER: 'TYPE_PARAMETER',
  TYPE_REFERENCE: 'TYPE_REFERENCE',
  TYPE_ANNOTATION: 'TYPE_ANNOTATION',
  ANNOTATION_ARGUMENT_REFERENCE: 'ANNOTATION_ARGUMENT_REFERENCE',
  METHOD_REGISTRY: 'METHOD_REGISTRY',
  METHOD_PARAMETER: 'METHOD_PARAMETER',
  METHOD_TYPE_PARAMETER: 'METHOD_TYPE_PARAMETER',
  IMPORT_REGISTRY: 'IMPORT_REGISTRY',
  MODULE_REGISTRY: 'MODULE_REGISTRY',
  MODULE_DIRECTIVE: 'MODULE_DIRECTIVE',
  ENUM_CONSTANT: 'ENUM_CONSTANT',
  ENUM_CONSTANT_ARGUMENT_REFERENCE: 'ENUM_CONSTANT_ARGUMENT_REFERENCE',
  FIELD_REGISTRY: 'FIELD_REGISTRY',
  EXPRESSION_REFERENCE: 'EXPRESSION_REFERENCE',
  LOCAL_VARIABLE_REGISTRY: 'LOCAL_VARIABLE_REGISTRY',
  BLOCK_REGISTRY: 'BLOCK_REGISTRY',
  COMMENT_REGISTRY: 'COMMENT_REGISTRY',
  PROPERTY_KEY: 'PROPERTY_KEY',
  PROPERTY_VALUE_SEGMENT: 'PROPERTY_VALUE_SEGMENT',
  SKIPPED_FILE: 'SKIPPED_FILE',
  XML_ELEMENT: 'XML_ELEMENT',
  XML_ATTRIBUTE: 'XML_ATTRIBUTE',
  XML_VALUE_REFERENCE: 'XML_VALUE_REFERENCE',
  YAML_PROPERTY: 'YAML_PROPERTY',
  YAML_VALUE_SEGMENT: 'YAML_VALUE_SEGMENT',

  // ------------------------------------------------- META-INF/services (Java)
  // SERVICE_DESCRIPTOR is the root: it is keyed on the FILE, because the same
  // service interface is configured by a separate file in every module that
  // ships providers for it, and a key derived from the service name would
  // collapse those into one row. SERVICE_PROVIDER chains off it — a provider
  // class name alone does not say which service it provides.
  SERVICE_DESCRIPTOR: 'SERVICE_DESCRIPTOR',
  SERVICE_PROVIDER: 'SERVICE_PROVIDER',

  // ---------------------------------------------------------------- Gradle
  // GRADLE_SCRIPT is the root of the chain. Every other Gradle key mixes in
  // its parent's hash rather than re-deriving one from a qualified name,
  // because a Gradle name collides constantly: every subproject has a
  // `dependencies` block, every one of those has an `implementation`, and two
  // `mavenCentral()` calls differ only by which repositories block they sit in.
  GRADLE_SCRIPT: 'GRADLE_SCRIPT',
  GRADLE_BLOCK: 'GRADLE_BLOCK',
  GRADLE_DECLARATION: 'GRADLE_DECLARATION',
  GRADLE_VALUE_REFERENCE: 'GRADLE_VALUE_REFERENCE',
  /** A 1:1 chain off GRADLE_DECLARATION — a coordinate IS a parsed dependency. */
  GRADLE_DEPENDENCY_COORDINATE: 'GRADLE_DEPENDENCY_COORDINATE',
  GRADLE_CATALOG_ENTRY: 'GRADLE_CATALOG_ENTRY',
  GRADLE_COMMENT: 'GRADLE_COMMENT',
  GRADLE_PARSE_GAP: 'GRADLE_PARSE_GAP',

  // ---------------------------------------------------------------- Python
  // One prefix per PK. Every child key chains off its parent's hash, so these
  // prefixes also document the FK chain: PY_MODULE is the root, PY_SCOPE is
  // recursive through itself, and PY_CALL_SITE is a pure 1:1 chain off
  // PY_EXPRESSION. Schema v6 section 1.
  PY_MODULE: 'PY_MODULE',
  PY_SCOPE: 'PY_SCOPE',
  PY_BINDING: 'PY_BINDING',
  PY_TYPE: 'PY_TYPE',
  PY_TYPE_BASE: 'PY_TYPE_BASE',
  PY_TYPE_REFERENCE: 'PY_TYPE_REFERENCE',
  PY_METHOD: 'PY_METHOD',
  PY_METHOD_PARAMETER: 'PY_METHOD_PARAMETER',
  PY_FIELD: 'PY_FIELD',
  PY_FIELD_WRITE: 'PY_FIELD_WRITE',
  PY_DECORATOR: 'PY_DECORATOR',
  PY_DECORATOR_ARGUMENT: 'PY_DECORATOR_ARGUMENT',
  PY_IMPORT: 'PY_IMPORT',
  PY_EXPRESSION: 'PY_EXPRESSION',
  PY_CALL_SITE: 'PY_CALL_SITE',
  PY_TYPE_INFERENCE: 'PY_TYPE_INFERENCE',
  PY_COMMENT: 'PY_COMMENT',
  PY_BLOCK: 'PY_BLOCK',
  PY_PARSE_GAP: 'PY_PARSE_GAP',
  PY_TYPE_PARAMETER: 'PY_TYPE_PARAMETER',

  // ------------------------------------------------------------ TypeScript
  // One prefix per PK, and the list doubles as the FK chain: TS_MODULE is the
  // root and every child key chains off its parent's hash (schema section 1),
  // never off a re-derived qualified name. That discipline is not stylistic
  // here — with declaration merging a qualified name collides BY DESIGN
  // (1,986 multi-declaration symbols measured, max 43 for one name).
  TS_MODULE: 'TS_MODULE',
  TS_TYPE: 'TS_TYPE',
  TS_TYPE_HERITAGE: 'TS_TYPE_HERITAGE',
  TS_TYPE_PARAMETER: 'TS_TYPE_PARAMETER',
  TS_TYPE_REFERENCE: 'TS_TYPE_REFERENCE',
  TS_METHOD: 'TS_METHOD',
  TS_METHOD_PARAMETER: 'TS_METHOD_PARAMETER',
  TS_FIELD: 'TS_FIELD',
  TS_FIELD_POSITION: 'TS_FIELD_POSITION',
  TS_ENUM_MEMBER: 'TS_ENUM_MEMBER',
  TS_VARIABLE: 'TS_VARIABLE',
  TS_IMPORT: 'TS_IMPORT',
  TS_EXPORT: 'TS_EXPORT',
  TS_EXPRESSION: 'TS_EXPRESSION',
  /** A pure 1:1 chain off TS_EXPRESSION — a call site IS an expression. */
  TS_CALL_SITE: 'TS_CALL_SITE',
  TS_BLOCK: 'TS_BLOCK',
  TS_COMMENT: 'TS_COMMENT',
  TS_DECORATOR: 'TS_DECORATOR',
  TS_DECORATOR_ARGUMENT: 'TS_DECORATOR_ARGUMENT',
  TS_PARSE_GAP: 'TS_PARSE_GAP',
  TS_TYPE_SATISFIES: 'TS_TYPE_SATISFIES',
  /**
   * Not a fact-relation prefix: the group key is deliberately NOT UNIQUE, so it
   * is never a PK. It gets its own prefix so a group key can never be mistaken
   * for an entity hash in a join.
   */
  TS_DECLARATION_GROUP: 'TS_DECLARATION_GROUP',

  // ------------------------------------------------------------ JavaScript
  // JavaScript is its own front end (schema Q1), so it gets its own prefixes
  // rather than sharing TypeScript's. The two languages share `ts.createSourceFile`
  // and nothing else: 83.6% of JavaScript module edges are expression-borne and
  // 0.165% of its parameters carry a syntactic type annotation, so the relations
  // are shaped by a binder rather than by declared types.
  //
  // JS_MODULE is the root of every FK chain and every child key chains off its
  // parent's hash, never off a re-derived qualified name — `module.exports =
  // function () {}` gives a callable whose only name is its file's, and two such
  // files in one directory would collide on any name-derived key.
  JS_MODULE: 'JS_MODULE',
  JS_SCOPE: 'JS_SCOPE',
  JS_TYPE: 'JS_TYPE',
  JS_TYPE_HERITAGE: 'JS_TYPE_HERITAGE',
  JS_TYPE_REFERENCE: 'JS_TYPE_REFERENCE',
  JS_METHOD: 'JS_METHOD',
  JS_METHOD_PARAMETER: 'JS_METHOD_PARAMETER',
  JS_FIELD: 'JS_FIELD',
  JS_VARIABLE: 'JS_VARIABLE',
  JS_IMPORT: 'JS_IMPORT',
  JS_EXPORT: 'JS_EXPORT',
  JS_EXPRESSION: 'JS_EXPRESSION',
  /** A pure 1:1 chain off JS_EXPRESSION — a call site IS an expression. */
  JS_CALL_SITE: 'JS_CALL_SITE',
  JS_BLOCK: 'JS_BLOCK',
  JS_COMMENT: 'JS_COMMENT',
  JS_PARSE_GAP: 'JS_PARSE_GAP',
  JS_PACKAGE_ENTRY: 'JS_PACKAGE_ENTRY',

  // ------------------------------------------------------------------- C#
  // One prefix per PK, and the list doubles as the FK chain: CS_MODULE is the
  // root and every child key chains off its parent's hash, never off a dotted
  // name and never off a MERGED type — under `partial` a re-derived qualified
  // name collides BY DESIGN (1,662 partial declarations over 897 identities
  // measured, max 88 parts). CS_DECLARATION_GROUP is deliberately NOT unique:
  // it is the merged entity, and its own prefix keeps a group key from ever
  // being mistaken for an entity hash in a join.
  CS_MODULE: 'CS_MODULE',
  CS_TYPE: 'CS_TYPE',
  CS_TYPE_HERITAGE: 'CS_TYPE_HERITAGE',
  CS_TYPE_PARAMETER: 'CS_TYPE_PARAMETER',
  CS_TYPE_REFERENCE: 'CS_TYPE_REFERENCE',
  CS_METHOD: 'CS_METHOD',
  CS_METHOD_PARAMETER: 'CS_METHOD_PARAMETER',
  CS_PROPERTY: 'CS_PROPERTY',
  CS_EVENT: 'CS_EVENT',
  CS_FIELD: 'CS_FIELD',
  CS_ENUM_MEMBER: 'CS_ENUM_MEMBER',
  CS_VARIABLE: 'CS_VARIABLE',
  CS_USING: 'CS_USING',
  CS_ATTRIBUTE: 'CS_ATTRIBUTE',
  CS_ATTRIBUTE_ARGUMENT: 'CS_ATTRIBUTE_ARGUMENT',
  CS_EXPRESSION: 'CS_EXPRESSION',
  CS_CALL_SITE: 'CS_CALL_SITE',
  CS_QUERY_CLAUSE: 'CS_QUERY_CLAUSE',
  CS_BLOCK: 'CS_BLOCK',
  CS_COMMENT: 'CS_COMMENT',
  CS_PARSE_GAP: 'CS_PARSE_GAP',
  CS_PREPROC_REGION: 'CS_PREPROC_REGION',
  CS_DECLARATION_GROUP: 'CS_DECLARATION_GROUP',
} as const;