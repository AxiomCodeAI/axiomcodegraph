/**
 * What kind of formal parameter this is. In the primary key.
 *
 * In the key because `paramName` is `""` for a destructured parameter, so
 * `function f({ a }, [b])` has two nameless parameters at different positions
 * that differ only in kind.
 *
 * ## Examples
 *
 * ```ts
 * function f(
 *     this: Window,          // THIS  — position 0, and not a runtime argument
 *     a: string,             // REQUIRED
 *     b?: number,            // OPTIONAL
 *     { x }: Point,          // BINDING_OBJECT
 *     [y]: number[],         // BINDING_ARRAY
 *     ...rest: string[]      // REST
 * ) { }
 *
 * class C {
 *     constructor(private readonly repo: Repo) { }  // PARAMETER_PROPERTY
 * }
 * ```
 *
 * ## Two members that change what an engine may conclude
 *
 * **THIS** is a type annotation, not an argument. Counting it as one shifts
 * every subsequent argument by a position, which silently mismatches arguments
 * to parameters for the whole signature.
 *
 * **PARAMETER_PROPERTY** means one parameter also DECLARES A FIELD — no Java or
 * Python analogue. It is recorded as a cross-FK to the `ts_field` row rather
 * than a duplicated row, so the field is counted once in the owning type's shape.
 *
 * Schema §4.7 c12.
 */
export enum TsParamKind {
  /** An ordinary required parameter. */
  REQUIRED = 'REQUIRED',

  /** `b?: T`, or a parameter with a default. Changes ARITY MATCHING. */
  OPTIONAL = 'OPTIONAL',

  /** `...rest: T[]` — accepts any number of trailing arguments. */
  REST = 'REST',

  /** An explicit `this: T`. A type annotation occupying position 0, not an argument. */
  THIS = 'THIS',

  /** `{ a, b }: T` — binds several names and is itself nameless. */
  BINDING_OBJECT = 'BINDING_OBJECT',

  /** `[a, b]: T[]` — as above, positionally. */
  BINDING_ARRAY = 'BINDING_ARRAY',

  /** `constructor(private x: T)` — this parameter also declares a field. */
  PARAMETER_PROPERTY = 'PARAMETER_PROPERTY',
}
