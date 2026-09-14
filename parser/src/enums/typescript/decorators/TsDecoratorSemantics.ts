/**
 * Whether a decorator REPLACES the entity it decorates, or only observes it.
 *
 * No Java annotation can do the first, which is why this column exists at all:
 * a decorator that returns a value substitutes the class, method or accessor,
 * and every later reference sees the substitute.
 *
 * ## UNKNOWN is the honest answer from a use site, and usually the only one
 *
 * Whether a decorator replaces its target depends on whether its IMPLEMENTATION
 * returns a value. That is a property of the decorator FUNCTION, not of this
 * application — and the function is usually in another package. Inferring it
 * from the use site would be a fact about code the parser has not read.
 *
 * `resolvedDecoratorMethodLinkHash` is the FK that would let an engine decide it
 * once the decorator's own declaration is in the fact base.
 *
 * Schema §4.18 c14.
 */
export enum TsDecoratorSemantics {
  /** The decorator returns a substitute; later references see it, not the original. */
  REPLACES_TARGET = 'REPLACES_TARGET',
  /** The decorator returns nothing; the target is unchanged. */
  OBSERVES_TARGET = 'OBSERVES_TARGET',
  /** Not decidable from the use site. The usual answer, and an honest one. */
  UNKNOWN = 'UNKNOWN',
}
