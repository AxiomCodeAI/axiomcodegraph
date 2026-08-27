/**
 * The shape of a decorator argument value.
 *
 * Positions 0–10 of `ts_decorator_argument` mirror `java_annotation_argument`,
 * so this enum starts from Java's `ArgumentValueType`. This is where framework
 * routes and DI tokens live — `@Get("/users/:id")`, `@Inject(UserRepository)`,
 * `@Column({ type: "varchar" })` — the direct analogue of the Java relation that
 * CWE detection already keys on for `@RequestMapping`.
 *
 * ## CLASS_REFERENCE is separated from IDENTIFIER on purpose
 *
 * ```ts
 * @Inject(UserRepository)   // CLASS_REFERENCE — a DI token
 * @Cache(defaultTtl)        // IDENTIFIER      — a value
 * ```
 *
 * The DI pattern is the one this relation exists to surface, and folding it into
 * `IDENTIFIER` would make it unqueryable. The distinction is a heuristic on the
 * name's case, and it stays labelled as one: the CLAIM is carried by
 * `referencedTypeHash`, which is filled only when the name actually resolves to
 * a type.
 *
 * ## An options object becomes N NAMED rows
 *
 * `@Column({ type: "varchar", nullable: true })` emits one row per property with
 * `argumentName` set, not one opaque blob a rule would have to re-parse.
 *
 * Schema §4.19 c2.
 */
export enum TsDecoratorArgumentValueType {
  /** `"users"`. */
  STRING = 'STRING',
  /** `300`, `1_000n`. */
  NUMBER = 'NUMBER',
  /** `true`, `false`. */
  BOOLEAN = 'BOOLEAN',
  /** `null`. */
  NULL = 'NULL',
  /** `undefined`. */
  UNDEFINED = 'UNDEFINED',
  /** A lowercase-initial name — a value rather than a token. */
  IDENTIFIER = 'IDENTIFIER',
  /** `{ … }` — emitted as one NAMED row per property. */
  OBJECT = 'OBJECT',
  /** `[ … ]`. */
  ARRAY = 'ARRAY',
  /** `() => …` — a lazy token, common in circular-dependency workarounds. */
  ARROW = 'ARROW',
  /** `f()` or `new C()`. */
  CALL = 'CALL',
  /** A capitalised bare name — the DI-token pattern. Claim carried by `referencedTypeHash`. */
  CLASS_REFERENCE = 'CLASS_REFERENCE',
  /** A template literal. */
  TEMPLATE = 'TEMPLATE',
  /** Anything else. Recorded rather than guessed at. */
  UNKNOWN = 'UNKNOWN',
}
