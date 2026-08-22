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
  /**
   * A bare name that does NOT resolve to a class — a constant, a function, a
   * variable. Kept distinct from {@link CLASS_REFERENCE} so a consumer can tell
   * "we looked and it is not a class" from "we did not look".
   */
  NAME_REFERENCE = 'NAME_REFERENCE',
  ATTRIBUTE_REFERENCE = 'ATTRIBUTE_REFERENCE',
  /**
   * A name that RESOLVES to a class, mirroring Java's `CLASS_REFERENCE`.
   *
   * `@register(HandlerClass)` and `@field(default_factory=OrderedDict)` name a
   * type, and `referencedTypeHash` carries the FK. Without the distinction a
   * consumer cannot tell a class argument from any other identifier without
   * re-resolving the name itself, which is the work this relation exists to
   * have already done.
   */
  CLASS_REFERENCE = 'CLASS_REFERENCE',
  /**
   * A dotted name whose base resolves to a class — `Color.RED`, `Mode.STRICT`.
   *
   * Java's `ENUM_CONSTANT`. Python has no separate enum syntax, so this is any
   * attribute access on a resolved class, which is what an enum member is.
   */
  ENUM_CONSTANT = 'ENUM_CONSTANT',
  CALL = 'CALL',
  LAMBDA = 'LAMBDA',
  FSTRING = 'FSTRING',
  UNKNOWN = 'UNKNOWN',
}
