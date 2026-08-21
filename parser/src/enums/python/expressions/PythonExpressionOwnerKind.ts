/**
 * Discriminator for `py_expression.expressionOwnerHash`, which is polymorphic.
 *
 * Schema v6 §2.15 c3.
 */
export enum PythonExpressionOwnerKind {
  MODULE = 'MODULE',
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  LAMBDA = 'LAMBDA',
  BLOCK = 'BLOCK',
  FIELD = 'FIELD',
  BINDING = 'BINDING',
  METHOD_PARAMETER = 'METHOD_PARAMETER',
  DECORATOR = 'DECORATOR',
  IMPORT = 'IMPORT',
  COMPREHENSION_SCOPE = 'COMPREHENSION_SCOPE',
}
