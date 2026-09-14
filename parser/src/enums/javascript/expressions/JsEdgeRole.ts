/**
 * What role a child expression plays in its parent. Schema §3.10 c7.
 *
 * ## The column that makes a wrapper node useful
 *
 * A wrapper with unlabelled children is only half the fix. `x += 1` needs its
 * target distinguishable from its value, or an engine cannot tell
 * `a = b` from `b = a` — and the flat-emission workaround that pairs on
 * `(scope, line)` gets it wrong in the direction that **invents** value flow.
 *
 * `RECEIVER` is the JavaScript-specific one worth noting: for
 * `f.call(obj, a)` it labels `obj`, which sits in **argument** position. The
 * call site's `receiverPosition = FIRST_ARGUMENT` says so, and this role is how
 * the expression tree agrees with it.
 */
export enum JsEdgeRole {
  /** The left side of an assignment. */
  ASSIGNMENT_TARGET = 'ASSIGNMENT_TARGET',

  /** The right side of an assignment, or a declaration's initializer. */
  ASSIGNMENT_VALUE = 'ASSIGNMENT_VALUE',

  /** The thing being called: `f` in `f(x)`, `obj.m` in `obj.m(x)`. */
  CALLEE = 'CALLEE',

  /** A positional argument. */
  ARGUMENT = 'ARGUMENT',

  /**
   * The receiver, wherever it sits.
   *
   * `obj` in `obj.m()` and `obj` in `f.call(obj, …)` both get this role, which
   * is the point — a consumer reads the role rather than re-deriving the
   * position from the call kind.
   */
  RECEIVER = 'RECEIVER',

  /** An `if`, `while`, ternary or `&&`/`||` condition. */
  CONDITION = 'CONDITION',

  /** An array element, or a sequence operand. */
  ELEMENT = 'ELEMENT',

  /** An object-literal property's value. */
  PROPERTY_VALUE = 'PROPERTY_VALUE',

  /** An object-literal property's key, emitted as its own row. */
  PROPERTY_KEY = 'PROPERTY_KEY',

  /**
   * A JSX element nested inside another element's markup.
   *
   * ## Its own role, because a JSX child is not an array element
   *
   * `ELEMENT` means an array element or a sequence operand, and reusing it here
   * would tell a consumer that `<Header/>` inside `<div>` is positional data
   * rather than composition. It is the composition: the set of JSX_CHILD edges
   * out of a component's markup IS the component graph, which is the single
   * question anyone asks of a component codebase.
   *
   * The edge was missing entirely. Nested elements were descended THROUGH — so
   * their attributes and the calls inside those attributes were emitted — and
   * never emitted themselves, and their children were attached to the OUTERMOST
   * element's row. So `<div><Header/><section><Item/></section></div>` produced
   * one row for the `div`, none for the other three, and a flat attribute list
   * that made the nesting unrecoverable. 4,944 elements over the corpus.
   */
  JSX_CHILD = 'JSX_CHILD',

  /**
   * The tag of a JSX COMPONENT element — `Foo` in `<Foo/>`, `widgets.panel`
   * in `<widgets.panel/>`.
   *
   * Schema §2.5a: an ordinary child expression reading a binding, with
   * `referencedName`, `bindingResolution` and `resolvedBindingLinkHash` as any
   * identifier read has, so the 833 component references that pointed at
   * nothing point at their declarations. A dotted tag is a property-access
   * subtree and needs no special case. Emitted ONCE, from the opening tag —
   * the closing `</Foo>` repeats the same reference and is not a second one.
   * An intrinsic element has no edge of this role.
   */
  JSX_TAG_NAME = 'JSX_TAG_NAME',

  /** The operand of `...`. */
  SPREAD_OPERAND = 'SPREAD_OPERAND',

  /** A `${…}` inside a template literal. */
  TEMPLATE_SUBSTITUTION = 'TEMPLATE_SUBSTITUTION',

  /** A unary or binary operand that is none of the above. */
  OPERAND = 'OPERAND',

  /** The object of a member access: `obj` in `obj.prop` used as a value. */
  ACCESS_TARGET = 'ACCESS_TARGET',

  /** The computed key of `obj[expr]`. */
  COMPUTED_KEY = 'COMPUTED_KEY',
}
