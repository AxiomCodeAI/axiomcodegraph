/**
 * Which relation `cs_expression.expressionOwnerHash` points into.
 *
 * The hash prefixes do not overlap, but a join still has to know which table to
 * read, and a rule that guessed from `rootContext` would break the moment one
 * context became reachable from two owners.
 *
 * ## The owner is the enclosing EXECUTABLE SCOPE — `VARIABLE` and `BLOCK` deleted
 *
 * `VARIABLE` was deleted by ruling (schema v1.3), and not merely as redundant:
 * it was ruled ACTIVELY HARMFUL. An expression's owner is what
 * `cs_call_site.callerMethodLinkHash` derives from, so in
 * `void M() { var x = Foo(); }` the call must report `M` as its caller. Owning
 * the initializer by the variable would make every call inside one report no
 * caller, and the engine would have to re-derive it by walking variable →
 * method. The attachment to the variable is already carried, in the right
 * direction, by `cs_variable.initializerExpressionLinkHash`.
 *
 * `BLOCK` fails the same test for the same reason and is deleted on the same
 * grounds: a block is not an executable scope either, and a call inside one
 * belongs to the method that runs it. `cs_block` is reached from the method,
 * not the other way round. Confirmed by ruling (schema v1.6 §4.0.2).
 *
 * `MODULE_INIT` — this parser's own name for "the file owns its top-level
 * statements" — is deleted on the same test once §4.0.3 answered the
 * tempting case: the statements are owned by `Program.<Main>$`, a METHOD row
 * with a real DeclaringSyntaxReference, so a call in a top-level statement
 * has a caller and the file was never an executable scope. The value was
 * never in the schema; it existed only while the question was open.
 */
export enum CsExpressionOwnerKind {
  METHOD = 'METHOD',
  FIELD = 'FIELD',
  PROPERTY = 'PROPERTY',
  EVENT = 'EVENT',
  TYPE = 'TYPE',
  ENUM_MEMBER = 'ENUM_MEMBER',
  ATTRIBUTE = 'ATTRIBUTE',
  METHOD_PARAMETER = 'METHOD_PARAMETER',
}
