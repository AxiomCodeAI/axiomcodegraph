/**
 * What kind of expression node this is.
 *
 * Positions 0–24 of `ts_expression` are byte-for-byte `java_expression` 0–24, so
 * `expr_kind`, `expr_child` and `expr_owner` port as renames and this enum
 * starts from Java's `ExpressionKind`.
 *
 * ## Members with no Java analogue, and why each is a separate kind
 *
 * ```ts
 * x as T           // AS_EXPRESSION       — a cast that WIDENS or NARROWS
 * x satisfies T    // SATISFIES_EXPRESSION — checks WITHOUT changing the type
 * <T>x             // TYPE_ASSERTION      — the older cast form; JSX in .tsx
 * x!               // NON_NULL_EXPRESSION — asserts non-null, changes nothing else
 * ...args          // SPREAD_ELEMENT      — argument positions become unknowable
 * import("m")      // DYNAMIC_IMPORT      — a module edge inside an expression
 * ```
 *
 * `AS_EXPRESSION` and `SATISFIES_EXPRESSION` are not interchangeable:
 * `as` changes the type the checker believes, `satisfies` asserts and leaves the
 * inferred type alone. A rule that treats them alike is wrong about which type
 * flows onward.
 *
 * ## PARENTHESIZED is deliberately ABSENT
 *
 * A parenthesised expression is punctuation, not a fact. Emitting a row for it
 * would put a node between a call and its receiver that no resolution rule
 * expects, so parentheses are transparent and the operand takes their place.
 * `(a).b()` therefore has exactly the shape of `a.b()`.
 *
 * ## The JSX members are RESERVED and carry ZERO rows
 *
 * TSX is out of the first freeze. The representation is decided — a JSX element
 * IS a call to its component, with the whole props object as argument 0 — and
 * nothing emits it. The gate asserts the emptiness, so the day TSX is switched
 * on it appears as a named gate failure rather than as new rows nobody noticed.
 *
 * Schema §4.14 c0, §4.15.1.
 */
export enum TsExpressionKind {
  /** `f(x)`. 1:1 with a `ts_call_site` row. */
  CALL_EXPRESSION = 'CALL_EXPRESSION',
  /** `new C(x)`. Also 1:1 with a call site. */
  NEW_EXPRESSION = 'NEW_EXPRESSION',
  /** `a.b`. Children: RECEIVER and PROPERTY_NAME. */
  PROPERTY_ACCESS = 'PROPERTY_ACCESS',
  /** `a[i]`. Children: RECEIVER and INDEX_ARGUMENT. */
  ELEMENT_ACCESS = 'ELEMENT_ACCESS',
  /** A bare name. Carries `referencedEntityHash` when the parser could resolve it. */
  IDENTIFIER_REFERENCE = 'IDENTIFIER_REFERENCE',
  /** `this`. Resolves through the enclosing method's owning type. */
  THIS_REFERENCE = 'THIS_REFERENCE',
  /** `super`. Resolves through an `inheritsMembers` heritage row. */
  SUPER_REFERENCE = 'SUPER_REFERENCE',
  /** A string, number, bigint, boolean, `null` or regex literal. */
  LITERAL = 'LITERAL',
  /** `` `a${b}` `` — has TEMPLATE_SPAN children. */
  TEMPLATE_EXPRESSION = 'TEMPLATE_EXPRESSION',
  /** `` tag`a${b}` `` — a CALL to `tag`, so it gets a call site. */
  TAGGED_TEMPLATE = 'TAGGED_TEMPLATE',
  /** `() => …`. Also a `ts_method` row: 161 measured call targets. */
  ARROW_FUNCTION = 'ARROW_FUNCTION',
  /** `function () { }`. Also a `ts_method` row. */
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',
  /** `class { }`. Also a `ts_type` row, linked by `anonymousTypeHash`. */
  CLASS_EXPRESSION = 'CLASS_EXPRESSION',
  /** `{ a: 1 }`. */
  OBJECT_LITERAL = 'OBJECT_LITERAL',
  /** `[1, 2]`. */
  ARRAY_LITERAL = 'ARRAY_LITERAL',
  /** `a + b`, `a && b`, `a ?? b`. */
  BINARY_EXPRESSION = 'BINARY_EXPRESSION',
  /** `-a`, `!a`, `a++`. `unaryFixity` says which side the operator was on. */
  UNARY_EXPRESSION = 'UNARY_EXPRESSION',
  /** `a ? b : c`. */
  TERNARY_EXPRESSION = 'TERNARY_EXPRESSION',
  /** `a = b`. */
  ASSIGNMENT_EXPRESSION = 'ASSIGNMENT_EXPRESSION',
  /** `a += b`, `a ??= b` — reads and writes in one node. */
  COMPOUND_ASSIGNMENT = 'COMPOUND_ASSIGNMENT',
  /** `x as T` — changes the type the checker believes. */
  AS_EXPRESSION = 'AS_EXPRESSION',
  /** `x satisfies T` — asserts without changing the inferred type. */
  SATISFIES_EXPRESSION = 'SATISFIES_EXPRESSION',
  /** `<T>x` — the older cast form. Illegal in `.tsx`, where `<` opens JSX. */
  TYPE_ASSERTION = 'TYPE_ASSERTION',
  /** `x!` — asserts non-null and changes nothing else. */
  NON_NULL_EXPRESSION = 'NON_NULL_EXPRESSION',
  /** `await x`. */
  AWAIT_EXPRESSION = 'AWAIT_EXPRESSION',
  /** `yield x`. */
  YIELD_EXPRESSION = 'YIELD_EXPRESSION',
  /** `...x` — marks where positional argument flow becomes unknowable. */
  SPREAD_ELEMENT = 'SPREAD_ELEMENT',
  /** `import("m")` — a module edge, and a call site of kind DYNAMIC_IMPORT_CALL. */
  DYNAMIC_IMPORT = 'DYNAMIC_IMPORT',
  /** RESERVED for TSX. Carries zero rows in freeze 1. */
  JSX_ELEMENT = 'JSX_ELEMENT',
  /** RESERVED for TSX. Carries zero rows in freeze 1. */
  JSX_SELF_CLOSING = 'JSX_SELF_CLOSING',
  /** `delete a`, `typeof a`, `void a` — `operatorString` says which. */
  DELETE_TYPEOF_VOID = 'DELETE_TYPEOF_VOID',
  /** `a, b` — the comma operator. */
  SEQUENCE_EXPRESSION = 'SEQUENCE_EXPRESSION',
}
