/**
 * What kind of function-shaped declaration a `ts_method` row describes.
 *
 * Wider than Java's `MethodKind` because TypeScript has more shapes that are
 * callable, and — the part that matters — because **every bodiless signature is a
 * row here**. 44.3% of resolved call targets in the measured corpus are
 * `MethodSignature`: an interface member with no body. A relation holding only
 * implementations would be missing nearly half the call graph's leaves.
 *
 * ## Examples
 *
 * ```ts
 * function f() { }                              // FUNCTION_DECLARATION
 * class C {
 *     m() { }                                   // METHOD_DECLARATION
 *     constructor() { }                         // CONSTRUCTOR
 *     get x() { return 1 }                      // GETTER
 *     set x(v: number) { }                      // SETTER
 *     static { }                                // CLASS_STATIC_BLOCK
 * }
 * const a = () => { };                          // ARROW_FUNCTION
 * const b = function () { };                    // FUNCTION_EXPRESSION
 * interface I {
 *     m(): void;                                // METHOD_SIGNATURE
 *     (x: number): string;                      // CALL_SIGNATURE
 *     new (x: number): I;                       // CONSTRUCT_SIGNATURE
 * }
 * type H = (e: Event) => void;                  // FUNCTION_TYPE_SIGNATURE
 * type K = new (x: number) => I;                // CONSTRUCTOR_TYPE_SIGNATURE
 * const o = { m() { } };                        // OBJECT_LITERAL_METHOD
 * ```
 *
 * ## Two members that exist for measured reasons
 *
 * **ARROW_FUNCTION.** 703 arrows in one corpus, 161 of them resolved call
 * targets. An arrow has no name a call site could match, so it is reached only
 * through the variable that binds it — which is why arrows are rows here rather
 * than expression detail, and why `ts_variable.boundFunctionLinkHash` exists.
 *
 * **FUNCTION_TYPE_SIGNATURE.** `const f: (s: S) => string = (s) => s.id` resolves
 * its calls to the ANNOTATION's signature, not to the arrow assigned to it. A
 * parser offering only the arrow disagrees with `getResolvedSignature` on every
 * such call, so a function type written in type position gets its own row.
 *
 * **MODULE_INITIALIZER** is synthetic: top-level executable statements need an
 * owner, and inventing one lazily would make a file with no top-level code
 * structurally different from one with it.
 *
 * Schema §4.6 c16.
 */
export enum TsMethodKind {
  /** `function f() { }`. */
  FUNCTION_DECLARATION = 'FUNCTION_DECLARATION',

  /** A method on a class. */
  METHOD_DECLARATION = 'METHOD_DECLARATION',

  /** `constructor(…)`. Named `<constructor>`. */
  CONSTRUCTOR = 'CONSTRUCTOR',

  /**
   * The constructor a class gets when it declares none and extends nothing.
   * Named `<constructor>`, no parameters, one per such class, at the class's
   * own position. Synthesised so `new C()` has a declaration to resolve to —
   * the same row Java's `DEFAULT_CONSTRUCTOR` provides. A class that EXTENDS
   * another gets no row of its own: `new Derived()` runs the nearest declared
   * base constructor, which is a real declaration, and a synthetic one on the
   * subclass would shadow it. A data-holder class is exactly the kind written
   * without a constructor, so without this row every construction of one was
   * a call to nothing while every method call on the instance resolved.
   */
  DEFAULT_CONSTRUCTOR = 'DEFAULT_CONSTRUCTOR',

  /** `get x() { }`. */
  GETTER = 'GETTER',

  /** `set x(v) { }`. */
  SETTER = 'SETTER',

  /** `() => …`. Named `<arrow>`; 161 measured call targets. */
  ARROW_FUNCTION = 'ARROW_FUNCTION',

  /** `function () { }` in an expression position. A NAMED one binds its own name inside its body. */
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',

  /** `m(): void;` on an INTERFACE. Bodiless by construction; owned by a `ts_type`. */
  METHOD_SIGNATURE = 'METHOD_SIGNATURE',

  /** `(x: number): string;` on an interface. Named `<call-signature>`. */
  CALL_SIGNATURE = 'CALL_SIGNATURE',

  /** `new (x: number): I;` on an interface. Named `<construct-signature>`. */
  CONSTRUCT_SIGNATURE = 'CONSTRUCT_SIGNATURE',

  /**
   * `m(): void` inside an ANONYMOUS type literal — `{ m(): void }`.
   *
   * Owner-qualified because `tsTypeLinkHash` points at a `ts_type_reference`
   * here: an anonymous shape has no declaration. 28 measured calls resolve to
   * one of these, and 1,352 property accesses land on a type-literal member —
   * the number that matters, because property-chain walking is how a receiver
   * gets typed.
   */
  TYPE_LITERAL_METHOD_SIGNATURE = 'TYPE_LITERAL_METHOD_SIGNATURE',

  /** `(x: T): R` inside an anonymous type literal. Owner is the shape. */
  TYPE_LITERAL_CALL_SIGNATURE = 'TYPE_LITERAL_CALL_SIGNATURE',

  /** `new (x: T): R` inside an anonymous type literal. Owner is the shape. */
  TYPE_LITERAL_CONSTRUCT_SIGNATURE = 'TYPE_LITERAL_CONSTRUCT_SIGNATURE',

  /**
   * `(e: Event) => void` written in TYPE position. A real call target.
   *
   * Needs no owner-qualified twin: a function type node is the ONLY thing that
   * can own one, so `tsTypeLinkHash` is always the node's own
   * `ts_type_reference` row.
   */
  FUNCTION_TYPE_SIGNATURE = 'FUNCTION_TYPE_SIGNATURE',

  /** `new (x: number) => I` written in TYPE position. Owned by its own type node. */
  CONSTRUCTOR_TYPE_SIGNATURE = 'CONSTRUCTOR_TYPE_SIGNATURE',

  /** `{ m() { } }` — callable, and reached through no other path. */
  OBJECT_LITERAL_METHOD = 'OBJECT_LITERAL_METHOD',

  /** `static { }` — runs once at class-definition time. Named `<static-block>`. */
  CLASS_STATIC_BLOCK = 'CLASS_STATIC_BLOCK',

  /** Synthetic owner of top-level executable statements. Named `<module>`. */
  MODULE_INITIALIZER = 'MODULE_INITIALIZER',
}
