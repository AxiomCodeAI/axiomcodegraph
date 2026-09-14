/**
 * The modifiers that turn a constructor parameter into a field declaration.
 *
 * A comma-set, and non-empty exactly when `paramKind` is `PARAMETER_PROPERTY`.
 * The construct has no Java or Python analogue: one piece of syntax declares two
 * entities.
 *
 * ```ts
 * class Service {
 *     constructor(
 *         private readonly repo: Repository,  // PRIVATE,READONLY
 *         public name: string,                // PUBLIC
 *         protected id: number,               // PROTECTED
 *     ) { }
 * }
 * ```
 *
 * Each of those emits a `ts_method_parameter` row AND a `ts_field` row, linked
 * by `declaredFieldLinkHash` / `originParameterLinkHash` so the field is counted
 * once in the type's shape rather than twice.
 *
 * Schema §4.7 c18.
 */
export enum TsParameterPropertyModifier {
  /** `private` — erased at emit. */
  PRIVATE = 'PRIVATE',
  /** `protected` — erased at emit. */
  PROTECTED = 'PROTECTED',
  /** `public` — explicit, and the only form that is also the default. */
  PUBLIC = 'PUBLIC',
  /** `readonly` — assignable only in the constructor. */
  READONLY = 'READONLY',
}
