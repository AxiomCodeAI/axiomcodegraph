/**
 * What a destructured name binds to.
 *
 * `const { a: renamed } = o` declares `renamed`, and the fact that it reads
 * property `a` lives only in the pattern. Without it a consumer sees a variable
 * whose origin cannot be recovered from its name -- and the shorthand form
 * `{ a }` hides the problem, because there the name and the property coincide.
 *
 * An enum rather than a bare string because a rest element binds neither a
 * single property nor a single index. `""` alone could not tell "this is a rest
 * element" from "this is not a destructuring at all", and those are opposite
 * facts.
 */
export enum TsBindingSourceKind {
  /** Not a destructured name. Every ordinary declaration carries this. */
  NONE = 'NONE',

  /** `const { a } = o` and `const { a: renamed } = o` — binds property `a`. */
  PROPERTY = 'PROPERTY',

  /** `const [first, second] = xs` — binds by position. */
  INDEX = 'INDEX',

  /** `const { a, ...rest } = o` — binds every property not named above it. */
  OBJECT_REST = 'OBJECT_REST',

  /** `const [a, ...tail] = xs` — binds every element from its index onward. */
  ARRAY_REST = 'ARRAY_REST',
}
