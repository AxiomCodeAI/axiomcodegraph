/**
 * What an attribute argument's value IS — `cs_attribute_argument.valueKind`.
 *
 * An attribute argument must be a compile-time constant, so most of these are
 * literals and the vocabulary is small and closed. The two that matter to an
 * engine are the ones that name something:
 *
 * - `TYPEOF` — `[JsonConverter(typeof(MyConverter))]` names a TYPE, and the
 *   reference is emitted so the edge exists. A rule asking which converters a
 *   model uses reads exactly this and nothing else does.
 * - `NAMEOF` — `[CallerArgumentExpression(nameof(x))]` names a PARAMETER.
 *
 * `EXPRESSION` is the honest terminal for anything the syntax does not put in
 * one of the closed buckets — a constant folded from several parts, say. The
 * text is still carried in `argumentValue`, so nothing is lost; only the
 * classification is withheld, which is §5.
 */
export enum CsAttributeArgumentValueKind {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  CHARACTER = 'CHARACTER',
  NULL = 'NULL',
  /** `typeof(T)` — a TYPE REFERENCE inside metadata. */
  TYPEOF = 'TYPEOF',
  /** `nameof(x)` — a name the compiler resolves and then stringifies. */
  NAMEOF = 'NAMEOF',
  /** A dotted name: an enum member, a const field, or a static property. */
  MEMBER_ACCESS = 'MEMBER_ACCESS',
  /** A bare identifier — an enum member in an unqualified position, usually. */
  IDENTIFIER = 'IDENTIFIER',
  ARRAY = 'ARRAY',
  /** Anything else. The TEXT is still carried; only the bucket is withheld. */
  EXPRESSION = 'EXPRESSION',
}
