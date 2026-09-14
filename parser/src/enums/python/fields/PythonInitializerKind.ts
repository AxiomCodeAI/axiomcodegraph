/**
 * The shape of an attribute's first initialiser.
 *
 * Coarse on purpose: it says what KIND of thing the attribute was first set to,
 * which is a syntactic fact, and stops short of claiming a type — that is
 * `py_type_inference`'s job and carries a confidence level.
 *
 * Schema v6 §2.9 c23.
 */
export enum PythonInitializerKind {
  /** No initialiser — an annotation with no value. */
  NONE = 'NONE',
  /** A literal. */
  LITERAL = 'LITERAL',
  /** A call — often a constructor, which is why it is worth distinguishing. */
  CALL = 'CALL',
  /** A bare name. */
  NAME = 'NAME',
  /** An attribute access. */
  ATTRIBUTE = 'ATTRIBUTE',
  /** A lambda. */
  LAMBDA = 'LAMBDA',
  /** A comprehension. */
  COMPREHENSION = 'COMPREHENSION',
  /** Anything else. */
  UNKNOWN = 'UNKNOWN',
}
