/**
 * WHERE an expression tree is rooted — `cs_expression.rootContext`.
 *
 * Carried on every node of the tree, not just the root, so a rule can ask "does
 * anything in a field initializer call this" without walking to the top. That is
 * the same choice `cs_type_reference` makes for its context, and for the same
 * reason: re-deriving it costs a join per node.
 *
 * ## Five values DELETED, one by ruling and four by its test
 *
 * `ARGUMENT_LIST` was deleted by ruling (schema v1.3): an argument is already a
 * CHILD of the `INVOCATION` wrapper with `edgeRole = ARGUMENT` and a position,
 * and the triple `(parent, edgeRole, position)` carries strictly more than a
 * root context could — it survives two calls on one line, which a shared
 * context would not. §4.0 test 3: information already carried by an existing
 * column, so delete.
 *
 * `AWAIT_OPERAND`, `QUERY_CLAUSE`, `INTERPOLATION` and `COLLECTION_ELEMENT`
 * fail the same test for the same reason and are deleted on the same grounds:
 * each names a position that is a CHILD EDGE — `AWAIT_OPERAND`,
 * `QUERY_CLAUSE`, `INTERPOLATION_CONTENT`, `COLLECTION_ELEMENT` on
 * `CsEdgeRole` — and never a root. A root context that can only ever be
 * reached as a child is a value nothing can emit, and a value nothing can emit
 * is a gap that never closes. Routed to cs-oracle as the ruling's own test
 * applied to its neighbours, so it can be overturned if the analogy is wrong.
 */
export enum CsRootContext {
  EXPRESSION_STATEMENT = 'EXPRESSION_STATEMENT',
  VARIABLE_INITIALIZER = 'VARIABLE_INITIALIZER',
  FIELD_INITIALIZER = 'FIELD_INITIALIZER',
  PROPERTY_INITIALIZER = 'PROPERTY_INITIALIZER',
  RETURN_VALUE = 'RETURN_VALUE',
  CONDITION = 'CONDITION',
  THROW_VALUE = 'THROW_VALUE',
  SWITCH_SUBJECT = 'SWITCH_SUBJECT',
  CASE_LABEL = 'CASE_LABEL',
  LOOP_HEADER = 'LOOP_HEADER',
  PARAMETER_DEFAULT = 'PARAMETER_DEFAULT',
  /** An attribute's argument. C# attributes are INERT — this never runs. */
  ATTRIBUTE_ARGUMENT = 'ATTRIBUTE_ARGUMENT',
  ENUM_MEMBER_VALUE = 'ENUM_MEMBER_VALUE',
  /** `: base(a)` / `: this(a)` — a constructor initializer. */
  CONSTRUCTOR_INITIALIZER = 'CONSTRUCTOR_INITIALIZER',
  /** `class C(int a) : Base(a)` — the primary constructor's base invocation. */
  PRIMARY_CONSTRUCTOR_BASE = 'PRIMARY_CONSTRUCTOR_BASE',
  EXPRESSION_BODY = 'EXPRESSION_BODY',
  LAMBDA_BODY = 'LAMBDA_BODY',
  /** `yield return x`. The value crosses a state-machine boundary. */
  YIELD_VALUE = 'YIELD_VALUE',
  USING_RESOURCE = 'USING_RESOURCE',
  LOCK_SUBJECT = 'LOCK_SUBJECT',
  UNKNOWN_CONTEXT = 'UNKNOWN_CONTEXT',
}
