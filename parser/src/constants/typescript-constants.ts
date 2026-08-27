/**
 * TypeScript-specific parser constants.
 *
 * The parse layer is `ts.createSourceFile` (OQ-1), so the 32,767-character
 * tree-sitter buffer limit that shaped `python-constants.ts` and
 * `java-parser.ts` does **not** apply here and there is deliberately no
 * chunking threshold in this file. That was the deciding argument: 4.7% of real
 * TypeScript files exceed the tree-sitter ceiling, `lib.dom.d.ts` is 2.3 MB, and
 * those are exactly the `.d.ts` files carrying 52% of the call graph's leaves.
 */

/**
 * The exact compiler this analysis parses with. Recorded in every `ts_module`
 * row as `targetTsVersion` and paired with invariant #9.
 *
 * Deliberately NOT in any primary key — see {@link TS_EMISSION_REGIME}.
 */
export const TS_TARGET_VERSION = '6.0.3';

/**
 * The regime token stamped into `ts_module`'s PRIMARY KEY.
 *
 * Coarse by ruling (OQ-4): `6.0.3` in a key would invalidate every hash in the
 * fact base on a patch bump, because the module hash chains into every child
 * key. What has to be distinguishable from inside the fact table is the regime
 * — a 6.x in-process parse versus a future 7.x out-of-process one — not the
 * patch level.
 */
export const TS_EMISSION_REGIME = 'ts6-inproc';

/**
 * Maximum type-node nesting depth recorded in `ts_type_reference`.
 *
 * **32, not 20 and not 5.** Java and Python cap at 5, which truncates real
 * `.d.ts`: the measured maximum over 1,113 declaration files is 19. A cap of 20
 * admits everything observed and sits one node from truncating on the next
 * `type-fest` release, so the ruling took 32. The extra headroom costs nothing —
 * no node in 25.9 MB of TypeScript reaches depth 20, so no extra row is emitted
 * — and `isTruncated` stays, because a cap that can never fire is a cap nobody
 * maintains.
 */
export const TS_TYPE_REFERENCE_MAX_DEPTH = 32;

/**
 * Maximum expression-tree depth recorded in `ts_expression`.
 *
 * Same cap, same reasoning. Deeper nodes are dropped with the parent marked, so
 * a lost subtree is visible rather than silent.
 */
export const TS_EXPRESSION_MAX_DEPTH = 32;

/** Synthetic method minted per module so top-level executable code always has an owner. */
export const TS_MODULE_INITIALIZER_NAME = '<module>';

/** `ts_method.name` for the unnamed function-shaped declarations. */
export const TS_ANONYMOUS_METHOD_NAMES = {
  CONSTRUCTOR: '<constructor>',
  ARROW: '<arrow>',
  FUNCTION_EXPRESSION: '<function-expression>',
  CALL_SIGNATURE: '<call-signature>',
  CONSTRUCT_SIGNATURE: '<construct-signature>',
  STATIC_BLOCK: '<static-block>',
  INDEX_SIGNATURE: '<index-signature>',
} as const;

/**
 * The binder's own name for a default export, in both `escapedName` and `name`.
 * This is TypeScript's `InternalSymbolName.Default`, not an invention.
 */
export const TS_DEFAULT_EXPORT_NAME = 'default';

/** File extensions the analyzer treats as TypeScript source. */
export const TS_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

/** Directories that contain TypeScript but are never the project under analysis. */
export const TS_SKIP_DIRECTORIES = [
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.turbo', '.cache', '.yarn', 'bower_components',
] as const;

/** CSV file names for the TypeScript fact tables. */
export const TYPESCRIPT_CSV_FILES = {
  MODULES: 'all-typescript-modules.csv',
  TYPES: 'all-typescript-types.csv',
  TYPE_HERITAGES: 'all-typescript-type-heritages.csv',
  TYPE_REFERENCES: 'all-typescript-type-references.csv',
  METHODS: 'all-typescript-methods.csv',
  METHOD_PARAMETERS: 'all-typescript-method-parameters.csv',
  FIELDS: 'all-typescript-fields.csv',
  VARIABLES: 'all-typescript-variables.csv',
  IMPORTS: 'all-typescript-imports.csv',
  EXPRESSIONS: 'all-typescript-expressions.csv',
  CALL_SITES: 'all-typescript-call-sites.csv',
  BLOCKS: 'all-typescript-blocks.csv',
  DECORATORS: 'all-typescript-decorators.csv',
  DECORATOR_ARGUMENTS: 'all-typescript-decorator-arguments.csv',
  SKIPPED_FILES: 'skipped-typescript-files.csv',
} as const;

/** Chunk size for CSV writes, matching the Java and Python analyzers. */
export const TS_CSV_CHUNK_SIZE = 50_000;
