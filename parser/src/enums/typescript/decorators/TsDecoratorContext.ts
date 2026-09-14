/**
 * What a decorator is applied to.
 *
 * ```ts
 * @Entity()                              // CLASS_DECLARATION
 * class User {
 *     @Column() name: string;            // FIELD_DECLARATION
 *     @observable accessor count = 0;     // AUTO_ACCESSOR
 *     @Log() save() { }                   // METHOD_DECLARATION
 *     @Memo() get full() { return "" }    // ACCESSOR_DECLARATION
 *     constructor(@Inject(Repo) r: Repo) { }  // PARAMETER_DECLARATION
 * }
 * ```
 *
 * ## PARAMETER_DECLARATION exists in only one dialect
 *
 * Parameter decorators are legal ONLY under `experimentalDecorators` — the
 * standard system has no such thing. So a row with this context and
 * `decoratorSystem = STANDARD_TC39` is impossible, and the gate asserts it: the
 * combination proves the system was read from somewhere other than the governing
 * tsconfig.
 *
 * They are also where taint SOURCES are declared in real TypeScript backends —
 * A DI framework's `@Body()`, `@Query()`, `@Param()` — the direct analogue of Spring's
 * `@RequestParam`, which Java CWE detection already keys on.
 *
 * Schema §4.18 c2.
 */
export enum TsDecoratorContext {
  /** On a class or class expression. */
  CLASS_DECLARATION = 'CLASS_DECLARATION',
  /** On a method. */
  METHOD_DECLARATION = 'METHOD_DECLARATION',
  /** On a property. */
  FIELD_DECLARATION = 'FIELD_DECLARATION',
  /** On a getter or setter. */
  ACCESSOR_DECLARATION = 'ACCESSOR_DECLARATION',
  /** On a parameter. LEGAL ONLY under `experimentalDecorators`. */
  PARAMETER_DECLARATION = 'PARAMETER_DECLARATION',
  /** On an `accessor` field — a getter/setter pair with backing storage. */
  AUTO_ACCESSOR = 'AUTO_ACCESSOR',
}
