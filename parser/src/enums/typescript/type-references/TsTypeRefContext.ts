/**
 * WHERE a type reference appears in TypeScript source.
 *
 * Mirrors Java's `TypeRefContext` member for member wherever the languages agree,
 * so the shared name-to-type projection ports as a rename. Members are added
 * only where TypeScript has a construct Java lacks, and Java members are dropped
 * only where TypeScript has no such construct (`PERMITS`, `THROWS_CLAUSE`,
 * `ARRAY_CREATION_TYPE`, `RECORD_PATTERN_TYPE`, `SWITCH_TYPE_PATTERN`,
 * `METHOD_REFERENCE_QUALIFIER` — none of which exists here).
 *
 * ## This column is what makes the type graph queryable by ROLE
 *
 * "Every type used as a method return", "every type in an `instanceof` guard",
 * "every bound on a method type parameter". Without it, a `List<string>` in a
 * return position and one in a cast are indistinguishable rows.
 *
 * ## Comprehensive example
 *
 * ```ts
 * @Injectable()                                       // DECORATOR_TYPE: Injectable
 * export class UserService<T extends BaseEntity & Auditable>  // TYPE_PARAM_BOUND: BaseEntity, Auditable
 *        extends AbstractService<T>                   // SUPER_TYPE: AbstractService, TYPE_ARGUMENT: T
 *        implements CrudService<T, string> {          // IMPLEMENTS_INTERFACE: CrudService (asserts only)
 *
 *     private repository: Repository<T>;              // FIELD_TYPE: Repository, TYPE_ARGUMENT: T
 *     [key: string]: unknown;                         // INDEX_SIGNATURE_KEY: string
 *                                                     // INDEX_SIGNATURE_VALUE: unknown
 *
 *     findById<K extends string>(                     // METHOD_TYPE_PARAM_BOUND: string
 *         id: K,                                      // METHOD_PARAM: K
 *     ): Optional<T> {                                // METHOD_RETURN: Optional, TYPE_ARGUMENT: T
 *         const cached = cache.get(id) as T;          // AS_TARGET: T
 *         const legacy = <T>cache.get(id);            // TYPE_ASSERTION: T
 *         const checked = cfg satisfies Config;       // SATISFIES_TARGET: Config
 *         if (cached instanceof Widget) { }           // INSTANCEOF_TYPE: Widget
 *         const made = new Repository<T>();           // OBJECT_CREATION_TYPE: Repository
 *                                                     // TYPE_ARGUMENT: T
 *         const empty = makeList<string>();           // METHOD_TYPE_ARGUMENT: string
 *         let local: Map<string, T>;                  // VARIABLE_TYPE: Map, TYPE_ARGUMENT: string, T
 *         return none();
 *     }
 *
 *     isWidget(x: unknown): x is Widget { }           // TYPE_PREDICATE_TARGET: Widget
 * }
 *
 * type Handler = (e: Event) => void;                  // TYPE_ALIAS_RHS: the function type
 *                                                     // METHOD_PARAM: Event, METHOD_RETURN: void
 * type Keys<T> = { [K in keyof T]: T[K] };            // MAPPED_CONSTRAINT: keyof T
 * type Elem<T> = T extends (infer U)[] ? U : never;   // CONDITIONAL_CHECK: T
 *                                                     // CONDITIONAL_EXTENDS: (infer U)[]
 *                                                     // CONDITIONAL_TRUE: U
 *                                                     // CONDITIONAL_FALSE: never
 * type Route = `/${string}`;                          // TEMPLATE_SPAN: string
 * type Lib = import("pkg").Thing;                     // IMPORT_TYPE_QUALIFIER: Thing
 * ```
 *
 * ## Contexts that appear only in VALUE positions
 *
 * `OBJECT_CREATION_TYPE`, `INSTANCEOF_TYPE`, `METHOD_TYPE_ARGUMENT`,
 * `DECORATOR_TYPE` and `DECORATOR_ARGUMENT_TYPE` name types written inside
 * expressions. They are the only contexts for which `isTypeOnlyPosition` is
 * `false`: the name is evaluated at runtime, so it is a real value reference as
 * well as a type reference. Every other context is type-only, which is the
 * structural half of the guarantee that type-level constructs never reach the
 * call graph.
 *
 * Schema §4.5 c1.
 */
export enum TsTypeRefContext {
  // -- declaration positions -------------------------------------------------

  /** A bound on a CLASS, INTERFACE or TYPE ALIAS type parameter: `class Box<T extends Number>`. */
  TYPE_PARAM_BOUND = 'TYPE_PARAM_BOUND',

  /** A bound on a METHOD or FUNCTION type parameter: `function f<T extends Shape>(x: T)`. */
  METHOD_TYPE_PARAM_BOUND = 'METHOD_TYPE_PARAM_BOUND',

  /** The default of a type parameter: `class Box<T = string>`. */
  TYPE_PARAM_DEFAULT = 'TYPE_PARAM_DEFAULT',

  /** A supertype in an `extends` clause. Inherits members. */
  SUPER_TYPE = 'SUPER_TYPE',

  /**
   * A name written in an `implements` clause.
   *
   * Records that someone wrote it down, and NOTHING about subtyping — 60.4% of
   * classes satisfy their interfaces with no such clause. Java's member of the
   * same name is authoritative; this one is not.
   */
  IMPLEMENTS_INTERFACE = 'IMPLEMENTS_INTERFACE',

  /** The declared type of a class property or interface property signature. */
  FIELD_TYPE = 'FIELD_TYPE',

  /** The declared return type of a function-shaped declaration. */
  METHOD_RETURN = 'METHOD_RETURN',

  /** The declared type of a formal parameter, including an arrow's. */
  METHOD_PARAM = 'METHOD_PARAM',

  /** The declared type of a variable. */
  VARIABLE_TYPE = 'VARIABLE_TYPE',

  /** The right-hand side of a type alias. */
  TYPE_ALIAS_RHS = 'TYPE_ALIAS_RHS',

  /** The key type of an index signature: `string` in `[k: string]: T`. */
  INDEX_SIGNATURE_KEY = 'INDEX_SIGNATURE_KEY',

  /** The value type of an index signature. */
  INDEX_SIGNATURE_VALUE = 'INDEX_SIGNATURE_VALUE',

  /** The declared type of an enum member. */
  ENUM_MEMBER_TYPE = 'ENUM_MEMBER_TYPE',

  /** The twin reference minted for every `ts_type_heritage` row. */
  HERITAGE_TWIN = 'HERITAGE_TWIN',

  // -- expression positions: evaluated at runtime ---------------------------

  /** The target of `x as T`. */
  AS_TARGET = 'AS_TARGET',

  /** The target of `x satisfies T` — checks without widening. */
  SATISFIES_TARGET = 'SATISFIES_TARGET',

  /** The target of the older cast form `<T>x`. Java's `CAST_EXPRESSION`. */
  TYPE_ASSERTION = 'TYPE_ASSERTION',

  /** The type named by `new Foo()`. Java's `OBJECT_CREATION_TYPE`. */
  OBJECT_CREATION_TYPE = 'OBJECT_CREATION_TYPE',

  /** The right operand of `x instanceof Foo` — the main narrowing lever. */
  INSTANCEOF_TYPE = 'INSTANCEOF_TYPE',

  /** An explicit type argument at a CALL or NEW site: `makeList<string>()`. */
  METHOD_TYPE_ARGUMENT = 'METHOD_TYPE_ARGUMENT',

  /** The type a decorator names: `Injectable` in `@Injectable()`. */
  DECORATOR_TYPE = 'DECORATOR_TYPE',

  /** A type named inside a decorator argument — where DI tokens live. */
  DECORATOR_ARGUMENT_TYPE = 'DECORATOR_ARGUMENT_TYPE',

  // -- type-level constructs, which exist in no other relation --------------

  /** The asserted type of a type predicate: `Widget` in `x is Widget`. */
  TYPE_PREDICATE_TARGET = 'TYPE_PREDICATE_TARGET',

  /** A type argument in a TYPE position: `string` in `Map<string, T>`. */
  TYPE_ARGUMENT = 'TYPE_ARGUMENT',

  /** The constraint of a mapped type: `keyof T` in `{ [K in keyof T]: … }`. */
  MAPPED_CONSTRAINT = 'MAPPED_CONSTRAINT',

  /** The `as` clause of a mapped type — key remapping. */
  MAPPED_TEMPLATE = 'MAPPED_TEMPLATE',

  /** The checked type of a conditional: `T` in `T extends U ? A : B`. */
  CONDITIONAL_CHECK = 'CONDITIONAL_CHECK',

  /** The compared type of a conditional. */
  CONDITIONAL_EXTENDS = 'CONDITIONAL_EXTENDS',

  /** The true branch of a conditional. */
  CONDITIONAL_TRUE = 'CONDITIONAL_TRUE',

  /** The false branch of a conditional. */
  CONDITIONAL_FALSE = 'CONDITIONAL_FALSE',

  /** An interpolated type in a template literal type. */
  TEMPLATE_SPAN = 'TEMPLATE_SPAN',

  /** The qualifier of an import type: `Thing` in `import("pkg").Thing`. */
  IMPORT_TYPE_QUALIFIER = 'IMPORT_TYPE_QUALIFIER',

  /**
   * A member of a composite type node.
   *
   * A union or intersection member, an array element, a tuple element, an
   * indexed-access operand, a `keyof` operand, a type-literal member. Composite
   * nodes are N ROWS with a parent FK, never one row with a list — the maximum
   * union arity measured is 208.
   */
  TYPE_ELEMENT = 'TYPE_ELEMENT',
}
