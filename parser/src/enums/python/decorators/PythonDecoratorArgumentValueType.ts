/**
 * The shape of one decorator argument's value.
 *
 * Kept syntactic. `@app.route("/admin/<id>", methods=["POST"])` yields a
 * `STRING_LITERAL` and a `LIST`, and a security rule reads the route from the
 * first and the verb from the second — neither needs a type inferred.
 *
 * Schema v7 §2.13 c2.
 */
export enum PythonDecoratorArgumentValueType {
  STRING_LITERAL = 'STRING_LITERAL',
  NUMBER_LITERAL = 'NUMBER_LITERAL',
  BOOLEAN_LITERAL = 'BOOLEAN_LITERAL',
  NONE_LITERAL = 'NONE_LITERAL',
  LIST = 'LIST',
  DICT = 'DICT',
  TUPLE = 'TUPLE',
  SET = 'SET',
  NAME_REFERENCE = 'NAME_REFERENCE',
  ATTRIBUTE_REFERENCE = 'ATTRIBUTE_REFERENCE',
  CALL = 'CALL',
  LAMBDA = 'LAMBDA',
  FSTRING = 'FSTRING',
  UNKNOWN = 'UNKNOWN',
}
