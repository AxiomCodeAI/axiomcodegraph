/**
 * Where a local LIVES — `cs_variable.scopeKind`.
 *
 * Paired with `scopeDepth`, which is what lets an engine ask whether two names
 * can be the same binding without re-walking the tree. Shadowing is legal in
 * C# only across non-overlapping scopes, so depth is the discriminator.
 */
export enum CsVariableScopeKind {
  METHOD_BODY = 'METHOD_BODY',
  BLOCK = 'BLOCK',
  /** A `for`/`foreach`/`while` header — visible in the body, not outside it. */
  LOOP_HEADER = 'LOOP_HEADER',
  /** `catch (Exception e)` — visible only in the catch block. */
  CATCH_CLAUSE = 'CATCH_CLAUSE',
  /** `using (var f = …)` — visible only in the using body. */
  USING_STATEMENT = 'USING_STATEMENT',
  /** A switch section. C# scopes the WHOLE switch body, not each section. */
  SWITCH_SECTION = 'SWITCH_SECTION',
  /**
   * An expression. `out var n` and `x is Foo f` leak into the ENCLOSING scope,
   * not into a nested one — which is why they are usable after the call.
   */
  EXPRESSION = 'EXPRESSION',
  LAMBDA_BODY = 'LAMBDA_BODY',
  QUERY = 'QUERY',
}
