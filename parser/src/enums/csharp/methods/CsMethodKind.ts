/**
 * What kind of callable a `cs_method` row describes — schema §3.6.
 *
 * ## Accessors are `cs_method` rows, and that is a 68% inflation
 *
 * A property is not a field and not a method: it is a data location with up to
 * two call targets. So `cs_property` carries the location and each accessor ALSO
 * gets a `cs_method` row, because IL has them as methods and an engine
 * resolving `x.P` needs a declared callable to resolve it TO. The parser emits
 * the declaration; the engine builds the edge.
 *
 * The scale is why `isAccessor` exists as a column. Measured: **60,783 declared
 * accessors** (33,694 `get`, 26,320 `set`, 635 `init`, 67 `add`, 67 `remove`)
 * plus 5,666 expression-bodied properties with an implicit getter, contributing
 * **66,449 `cs_method` rows** against **97,113 method declarations**. Any count
 * of methods that does not filter `isAccessor` is wrong by two thirds and says
 * nothing about it.
 *
 * Auto-accessors — 55,449 of 60,783, with no body at all — still get rows. They
 * have no statements and they are still call targets.
 *
 * ## Why a cast can be a call
 *
 * `CONVERSION_OPERATOR` is the one that surprises people. `(int)myObject` looks
 * like a type reference and runs user code. An engine that models conversions as
 * type facts loses the edge entirely — 582 conversion operators measured, plus
 * 760 ordinary operator overloads.
 */
export enum CsMethodKind {
  /** An ordinary method. */
  METHOD = 'METHOD',

  /** An instance constructor. */
  CONSTRUCTOR = 'CONSTRUCTOR',

  /** `static C() { }` — runs once, on first use, on a thread the caller does not choose. */
  STATIC_CONSTRUCTOR = 'STATIC_CONSTRUCTOR',

  /**
   * `class C(int a)` — C# 12. 2,816 measured.
   *
   * Its parameters are in scope throughout the type body, so they behave like
   * fields without being fields, and on a positional record they also
   * synthesize one property each.
   */
  PRIMARY_CONSTRUCTOR = 'PRIMARY_CONSTRUCTOR',

  /** `~C() { }` — finalizer. Runs on the finalizer thread, never called directly. */
  DESTRUCTOR = 'DESTRUCTOR',

  /** `public static C operator +(C a, C b)`. 760 measured. */
  OPERATOR = 'OPERATOR',

  /** `implicit`/`explicit operator T` — a CAST that invokes user code. 582 measured. */
  CONVERSION_OPERATOR = 'CONVERSION_OPERATOR',

  /** A function declared inside a method body. Captures locals; is not a member. */
  LOCAL_FUNCTION = 'LOCAL_FUNCTION',

  PROPERTY_GET = 'PROPERTY_GET',
  PROPERTY_SET = 'PROPERTY_SET',

  /** `init` — settable only in an object initializer. 635 measured. */
  PROPERTY_INIT = 'PROPERTY_INIT',

  INDEXER_GET = 'INDEXER_GET',
  INDEXER_SET = 'INDEXER_SET',
  /**
   * `this[int i] { init { … } }` — assignable only during object
   * initialization, where `set` is assignable always. It was emitted as
   * INDEXER_SET with the name `init_this[]`: the parts were right and the
   * structure absent (CS-ORACLE-4, §3's class), and a consumer switching on
   * kind read a write-once indexer as freely writable.
   */
  INDEXER_INIT = 'INDEXER_INIT',

  /**
   * `add` — the subscription half of an event. 67 measured.
   *
   * `button.Click += Handler` CALLS this. It is not an assignment.
   */
  EVENT_ADD = 'EVENT_ADD',

  /** `remove` — the unsubscription half. 67 measured. */
  EVENT_REMOVE = 'EVENT_REMOVE',

  /** `x => x + 1` and `(a, b) => …`. */
  LAMBDA = 'LAMBDA',

  /** `delegate (int x) { … }` — the C# 2 form, still present in old code. */
  ANONYMOUS_METHOD = 'ANONYMOUS_METHOD',

  /**
   * `<Main>$` — the entry point the compiler synthesises for a file of
   * top-level statements. Ruled by Roslyn (v1.6 §4.0.3): every global statement's
   * enclosing symbol is this method, a top-level local function is contained by
   * it, and it carries one DeclaringSyntaxReference — the compilation unit — so
   * it has a position and a caller hash like any other method.
   */
  TOP_LEVEL_ENTRY_POINT = 'TOP_LEVEL_ENTRY_POINT',
}

/** The accessor kinds, as a set, so `isAccessor` and `methodKind` cannot disagree. */
export const CS_ACCESSOR_METHOD_KINDS: ReadonlySet<CsMethodKind> = new Set([
  CsMethodKind.PROPERTY_GET,
  CsMethodKind.PROPERTY_SET,
  CsMethodKind.PROPERTY_INIT,
  CsMethodKind.INDEXER_GET,
  CsMethodKind.INDEXER_SET,
  CsMethodKind.EVENT_ADD,
  CsMethodKind.EVENT_REMOVE,
]);
