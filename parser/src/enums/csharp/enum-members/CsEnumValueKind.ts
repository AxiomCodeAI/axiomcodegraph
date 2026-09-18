/**
 * How an enum member's value is determined — `cs_enum_member.valueKind`.
 *
 * ## Why `COMPUTED` does not carry a value
 *
 * `C = A | B` has a value the compiler folds, and folding it is **evaluation,
 * not parsing**. The parser emits the expression and lets the engine decide;
 * putting a computed number in `constantValue` would be the parser doing the
 * compiler's arithmetic and being wrong the first time an expression referenced
 * a constant from another file.
 *
 * So `constantValue` is filled ONLY for a literal. A `COMPUTED` member carries
 * `csExpressionLinkHash` and an empty `constantValue`, and the absence is a
 * statement rather than a gap.
 */
export enum CsEnumValueKind {
  /** No initializer: the value is the previous member's plus one, or 0. */
  IMPLICIT = 'IMPLICIT',

  /** `B = 5` — a literal, so `constantValue` is filled. */
  LITERAL = 'LITERAL',

  /** `C = A | B` or `D = 1 << 3` — an expression the ENGINE evaluates. */
  COMPUTED = 'COMPUTED',
}
