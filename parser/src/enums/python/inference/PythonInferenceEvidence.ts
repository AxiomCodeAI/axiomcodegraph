/**
 * WHY a type was inferred — the syntactic ground for the claim.
 *
 * This column is the tier boundary. The parser emits only evidence it can read
 * off one node: a literal is its own type, an f-string is `str`, a comprehension
 * is a `list`. Anything needing a second fact — that a name resolves to a class,
 * that a call reaches a constructor, that an `isinstance` guard narrows a branch
 * — is the ENGINE's inference, appended as derived rows and never stored here.
 *
 * Keeping the evidence explicit is what lets a consumer decide how much to trust
 * a row instead of trusting all rows equally.
 *
 * Schema v7 §2.15 c35.
 */
export enum PythonInferenceEvidence {
  /** A scalar literal — `3`, `"s"`, `True`. */
  LITERAL = 'LITERAL',
  /** A collection display — `[]`, `{}`, `()`, `{1}`. */
  COLLECTION_LITERAL = 'COLLECTION_LITERAL',
  /** An f-string, which is `str` regardless of what it interpolates. */
  FSTRING = 'FSTRING',
  /** A comprehension, whose type follows the bracket. */
  COMPREHENSION = 'COMPREHENSION',
  /** An annotation naming the type directly. */
  ANNOTATION = 'ANNOTATION',
  /** `typing.cast(Foo, v)` — the programmer asserting the type. */
  CAST = 'CAST',
  /** A parameter default, which types the parameter by construction. */
  DEFAULT_VALUE = 'DEFAULT_VALUE',
  /** No evidence; `inferredTypeName` is empty. */
  NONE = 'NONE',
}
