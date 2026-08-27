/**
 * What kind of call this is.
 *
 * ## Examples
 *
 * ```ts
 * f(x)                  // FUNCTION_CALL
 * a.b(x)                // METHOD_CALL
 * ops[name](x)          // METHOD_CALL  — a computed member is still a member
 * new C(x)              // CONSTRUCTOR_CALL
 * super(x)              // SUPER_CALL
 * super.m(x)            // METHOD_CALL  with receiverKind SUPER
 * tag`a${b}`            // TAGGED_TEMPLATE_CALL
 * a?.b(x)               // OPTIONAL_CALL
 * import("m")           // DYNAMIC_IMPORT_CALL
 * @Component({ … })     // DECORATOR_CALL
 * ```
 *
 * ## OPTIONAL_CALL is a kind, not a flag
 *
 * `a?.b()` and `a.b()` have the SAME target and different reachability. A rule
 * that treats them alike is right about the target and wrong about whether the
 * call happens, so the distinction is in the kind where a rule cannot miss it.
 *
 * ## INDEX_CALL is a resolution outcome, never read from syntax
 *
 * A computed callee is `METHOD_CALL`: `ops[name](a, b)` calls a member and the
 * brackets only mean the name is computed. `INDEX_CALL` is reserved for a call
 * that resolved THROUGH AN INDEX SIGNATURE, which is a fact about the receiver's
 * TYPE. Syntax cannot tell the two apart, so syntax does not try.
 *
 * ## JSX_COMPONENT_CALL is RESERVED and carries ZERO rows
 *
 * TSX is out of the first freeze. The representation is settled — a JSX element
 * IS a call to its component, with the whole props object as argument 0 and
 * children folded into a reserved `children` prop, because a component has
 * exactly one parameter and mapping attributes positionally would be wrong. The
 * gate asserts the emptiness, so switching TSX on appears as a named failure.
 *
 * Schema §4.15 c0, §4.15.1.
 */
export enum TsCallKind {
  /** An unqualified call: `f(x)`. */
  FUNCTION_CALL = 'FUNCTION_CALL',
  /** A call on a receiver: `a.b(x)`, `ops[name](x)`. */
  METHOD_CALL = 'METHOD_CALL',
  /** `new C(x)`. */
  CONSTRUCTOR_CALL = 'CONSTRUCTOR_CALL',
  /** `super(x)` — the base constructor. */
  SUPER_CALL = 'SUPER_CALL',
  /** `` tag`…` `` — the tag is called with the strings and the substitutions. */
  TAGGED_TEMPLATE_CALL = 'TAGGED_TEMPLATE_CALL',
  /** Resolved THROUGH an index signature. A resolution outcome, not a syntactic kind. */
  INDEX_CALL = 'INDEX_CALL',
  /** `import("m")` — the target is a module, not a function. */
  DYNAMIC_IMPORT_CALL = 'DYNAMIC_IMPORT_CALL',
  /** A decorator application — it runs at class-definition time. */
  DECORATOR_CALL = 'DECORATOR_CALL',
  /** `a?.b()` — same target as `a.b()`, different reachability. */
  OPTIONAL_CALL = 'OPTIONAL_CALL',
  /** RESERVED for TSX. Must carry zero rows in freeze 1; the gate asserts it. */
  JSX_COMPONENT_CALL = 'JSX_COMPONENT_CALL',
}
