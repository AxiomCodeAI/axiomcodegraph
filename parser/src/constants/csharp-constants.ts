/**
 * C#-specific parser constants.
 *
 * Everything here that appears in a PRIMARY KEY is deliberately coarse. A patch
 * bump must not rewrite every hash in the fact base — `cs_module`'s hash chains
 * into every child key, so a version string in the key would make an unrelated
 * grammar release look like a total rewrite of the corpus.
 */

/**
 * tree-sitter's hard ceiling on a single parse buffer: **32,767 characters**
 * (2^15 - 1), not "about 30KB".
 *
 * Measured for C# by cs-oracle: the largest direct parse that succeeded was
 * 32,712 characters and the first failure was at 32,783. It **throws**; it does
 * not silently truncate.
 *
 * Two properties are easy to get wrong and both matter:
 *
 * 1. **It counts characters, not bytes.** A file of CJK identifiers and comments
 *    is far larger in UTF-8 than in characters, and a byte guard is wrong in
 *    both directions.
 * 2. **The callback's returned chunk carries the same ceiling.** Streaming does
 *    not lift the limit, it only keeps each buffer under it.
 */
export const TREE_SITTER_MAX_PARSE_CHARS = 32_767;

/**
 * Character count above which {@link CSharpParser} switches to callback parsing.
 *
 * Below the ceiling rather than equal to it, mirroring `java-parser.ts` and
 * `python-parser.ts`. C# source runs long — 3,158 of the 9,568-file corpus are
 * over this — so the callback path is the common path, not an edge case.
 */
export const CSHARP_CALLBACK_PARSE_THRESHOLD = 30_000;

/** Chunk size returned by the streaming parse callback. Identical to Java's. */
export const CSHARP_PARSE_CHUNK_SIZE = 8_192;

/**
 * The regime token stamped into `cs_module`'s PRIMARY KEY.
 *
 * Names the parse MECHANISM, coarsely: which grammar family and which patches
 * are in it. `0.23.5` → `0.23.6` upstream would change this only if it changed
 * what we can parse. See KNOWN_GRAMMAR_LIMITATIONS in grammar-gate.ts.
 */
// Was a fork lineage (`fork6`..`fork23`) while the grammar was vendored. The
// fork is gone; the regime now names the published version and the blanking
// pass, and it moves whenever either does.

export const CSHARP_GRAMMAR_REGIME = 'ts-cs-0.23.1-npm-blank2';

/**
 * The emission regime, in `cs_module`'s primary key beside the grammar regime.
 *
 * `roslyn4-oop` records that adjudication is against Roslyn **out of process**
 * — the parser itself runs no .NET. Distinguishable from inside the fact table
 * from a future regime that changed what a row means.
 */
export const CSHARP_EMISSION_REGIME = 'roslyn4-oop';

/**
 * The default target framework when no `.csproj` governs a file.
 *
 * `targetFramework` is in `cs_module`'s key because a multi-targeting project
 * has more than one answer for the same file (schema §2.2, option 3). A file
 * reached with no project context still needs one value, and it must be named
 * rather than empty so a consumer can tell "not multi-targeted" from "unknown".
 */
export const CSHARP_DEFAULT_TARGET_FRAMEWORK = 'unspecified';

/**
 * `defineConstantsKey` when no preprocessor symbols are active.
 *
 * The md5 of the empty sorted set, computed once rather than at every module.
 */
export const CSHARP_EMPTY_DEFINE_CONSTANTS = '';

/**
 * Maximum type-node nesting depth recorded in `cs_type_reference`.
 *
 * 32, matching TypeScript rather than Java's and Python's 5. C# generics are
 * reified, so `Dictionary<string, List<Func<T, Task<IReadOnlyList<U>>>>>` is a
 * distinct runtime type at every level and truncating the tree loses type
 * identity, not just detail.
 */
export const CSHARP_TYPE_REFERENCE_MAX_DEPTH = 32;

/**
 * Maximum expression-tree depth recorded in `cs_expression`.
 *
 * 256, NOT TypeScript's 32. A fluent chain nests one level per segment — each
 * call is the receiver of the next — and the walk drops everything below the
 * cap SILENTLY: at 32, a 37-segment DI registration chain
 * (`new EntityFrameworkRelationalServicesBuilder(sc).TryAdd<…>()…`, three such
 * chains in one stratum) lost its innermost five calls AND the creation at its
 * root, whose CONSTRUCTOR_CALL is the one edge that names the builder. The
 * walk is a worklist, not a recursion, so the cap protects no stack; it
 * bounds the `depth` column against pathological generated code and nothing
 * else, and 256 is above every chain in 12,054 corpus files by a factor of
 * seven.
 */
export const CSHARP_EXPRESSION_MAX_DEPTH = 256;

/** Synthetic method minted per module so top-level statements have an owner. */
export const CSHARP_MODULE_INITIALIZER_NAME = '<module>';

/**
 * `cs_type.name` for the synthetic type that owns a file's top-level statements.
 *
 * C# 9 top-level statements compile to `Program.<Main>$`, and the file has no
 * type and no method in its syntax. A module row alone is not enough: the
 * statements need an owner, and every `cs_expression` needs an owning method.
 */
export const CSHARP_TOP_LEVEL_TYPE_NAME = '<top-level>';

/** `cs_method.name` for the unnamed member-shaped declarations. */
/**
 * The type the compiler synthesises to hold a file's top-level statements.
 * Roslyn: `Program`, class, internal, global namespace, one
 * DeclaringSyntaxReference at the compilation unit (ruling v1.6 §4.0.3).
 */
export const CSHARP_SYNTHESIZED_PROGRAM_TYPE_NAME = 'Program';

export const CSHARP_ANONYMOUS_METHOD_NAMES = {
  CONSTRUCTOR: '<constructor>',
  STATIC_CONSTRUCTOR: '<static-constructor>',
  PRIMARY_CONSTRUCTOR: '<primary-constructor>',
  DESTRUCTOR: '<destructor>',
  LAMBDA: '<lambda>',
  ANONYMOUS_METHOD: '<anonymous-method>',
  // Roslyn's metadata name for the top-level-statements entry point, exactly.
  TOP_LEVEL_MAIN: '<Main>$',
} as const;

/**
 * The separator between a generic type's name and its arity in a group key.
 *
 * Backtick, as the CLR itself writes it: `List\`1`. 167 same-name-different-arity
 * collisions in the corpus are resolved by arity alone, so it is in the identity
 * rather than beside it.
 */
export const CSHARP_ARITY_SEPARATOR = '`';
