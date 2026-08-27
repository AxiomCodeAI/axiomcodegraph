/** `ts_variable` enums — schema §4.11. */

/** `ts_variable` c8. */
export enum TsVariableScopeKind {
  MODULE_SCOPE = 'MODULE_SCOPE',
  GLOBAL_SCOPE = 'GLOBAL_SCOPE',
  FUNCTION_BODY = 'FUNCTION_BODY',
  ARROW_BODY = 'ARROW_BODY',
  BLOCK_SCOPE = 'BLOCK_SCOPE',
  FOR_BINDING = 'FOR_BINDING',
  CATCH_BINDING = 'CATCH_BINDING',
  NAMESPACE_SCOPE = 'NAMESPACE_SCOPE',
  AMBIENT_SCOPE = 'AMBIENT_SCOPE',
}

/** `ts_variable` c16. */
export enum TsVariableDeclarationKind {
  CONST = 'CONST',
  LET = 'LET',
  VAR = 'VAR',
  USING = 'USING',
  AWAIT_USING = 'AWAIT_USING',
  CATCH = 'CATCH',
  FOR_OF = 'FOR_OF',
  FOR_IN = 'FOR_IN',
  FOR_INIT = 'FOR_INIT',
}

/**
 * `ts_variable` c18.
 *
 * `ARROW` and `FUNCTION_EXPRESSION` are the load-bearing members: they are what
 * `boundFunctionLinkHash` keys off, and 161 measured call targets are arrow
 * functions reached only through the variable that binds them.
 */
export enum TsVariableInitializerKind {
  ARROW = 'ARROW',
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',
  NEW = 'NEW',
  CALL = 'CALL',
  OBJECT_LITERAL = 'OBJECT_LITERAL',
  ARRAY_LITERAL = 'ARRAY_LITERAL',
  LITERAL = 'LITERAL',
  IDENTIFIER = 'IDENTIFIER',
  AS_EXPRESSION = 'AS_EXPRESSION',
  SATISFIES = 'SATISFIES',
  AWAIT = 'AWAIT',
  TEMPLATE = 'TEMPLATE',
  CLASS_EXPRESSION = 'CLASS_EXPRESSION',
  NONE = 'NONE',
  UNKNOWN = 'UNKNOWN',
}
