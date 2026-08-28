/**
 * Whether a declaration carries a body, and if not, WHY.
 *
 * ## The single most expensive mistake this column prevents
 *
 * **44.3% of resolved call targets are bodiless**, and 99.6% of the bodiless
 * interface targets are ambient. Attributing a call *implementation* to a `.d.ts`
 * line means attributing behaviour to a file that contains none — and nothing
 * downstream can detect the error once made, because the row looks exactly like
 * a real target.
 *
 * A bodiless row is still a legitimate call TARGET. The two facts are not in
 * tension: `resolvedSignatureLinkHash` may point here, and
 * `isAmbientTarget` says the code that runs is elsewhere.
 *
 * ## Why the reasons are distinguished rather than collapsed to a boolean
 *
 * ```ts
 * interface I { m(): void }              // NO_BODY_INTERFACE — can NEVER have a body
 * abstract class A { abstract m(): void } // NO_BODY_ABSTRACT — a subclass supplies one
 * declare function f(): void;             // NO_BODY_AMBIENT   — the body is outside this analysis
 * function g(x: number): void;            // NO_BODY_OVERLOAD  — the body is the next declaration
 * function g(x: unknown): void { }        // HAS_BODY
 * ```
 *
 * Each reason implies a different place to look for the implementation, and only
 * one of them means "nowhere in this fact base".
 *
 * Schema §4.6 c27.
 */
export enum TsBodyPresence {
  /** The declaration carries a body: this is code that runs. */
  HAS_BODY = 'HAS_BODY',

  /** An overload signature; the implementation is a sibling declaration. */
  NO_BODY_OVERLOAD = 'NO_BODY_OVERLOAD',

  /** `declare`, or inside a `.d.ts`: the body is outside this analysis. */
  NO_BODY_AMBIENT = 'NO_BODY_AMBIENT',

  /** An interface, type-literal or function-type member. Can never have a body. */
  NO_BODY_INTERFACE = 'NO_BODY_INTERFACE',

  /** `abstract`: a subclass supplies the body. */
  NO_BODY_ABSTRACT = 'NO_BODY_ABSTRACT',
}
