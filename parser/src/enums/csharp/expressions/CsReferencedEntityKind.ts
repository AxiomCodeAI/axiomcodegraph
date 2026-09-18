/**
 * What a name in an expression refers to, WHERE SYNTAX DECIDES IT —
 * `cs_expression.referencedEntityKind`.
 *
 * `UNKNOWN` is the honest majority and not a failure. Deciding whether a bare
 * `Foo` is a local, a field, a property or a type is name resolution, and the
 * parser emits IR while the engine resolves. What syntax DOES decide is the
 * handful below — `this`, `base`, a parameter of the enclosing method, a local
 * declared in an enclosing block — and those are filled because they cost
 * nothing and are certain.
 */
export enum CsReferencedEntityKind {
  UNKNOWN = 'UNKNOWN',
  /** Bound by the enclosing method's parameter list. Syntactic and certain. */
  PARAMETER = 'PARAMETER',
  /** Declared by a `var`/type declaration in an enclosing block. */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',
  /** Bound by an enclosing type's or method's type-parameter list. */
  TYPE_PARAMETER = 'TYPE_PARAMETER',
  /** A lambda's own parameter. */
  LAMBDA_PARAMETER = 'LAMBDA_PARAMETER',
  /** `x is Foo f` and `case Foo f:` introduce `f`. */
  PATTERN_BINDING = 'PATTERN_BINDING',
  /** The range variable of a LINQ `from` clause. */
  QUERY_RANGE_VARIABLE = 'QUERY_RANGE_VARIABLE',
  THIS = 'THIS',
  BASE = 'BASE',
  /** Written with a `using` alias prefix, so the alias is named in the syntax. */
  USING_ALIAS = 'USING_ALIAS',

  /**
   * A BARE name that the enclosing type declares as a field, property or
   * event IN THIS FILE, after every nearer binding — local, parameter, lambda
   * parameter, pattern binding, range variable — has been ruled out in the
   * language's own order. Ruling v1.8: the same fact class as METHOD_GROUP,
   * one lookup in one file; C# forbids one type declaring two members of one
   * name across these three relations (CS0102), so the lookup returns one
   * kind or none. NOT `x.Foo` or `this.Foo` (the receiver's type decides), not
   * an inherited member, not a member declared on another file's partial
   * part — those stay UNKNOWN, which under-approximates in the safe direction.
   */
  FIELD = 'FIELD',
  PROPERTY = 'PROPERTY',
  EVENT = 'EVENT',
}
