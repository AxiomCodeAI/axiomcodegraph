/**
 * WHY the parser believes a target — the syntax it used.
 *
 * The parser fills the resolution columns only where syntax decides them, so a
 * wrong link is traceable to the RULE that produced it rather than to "the
 * parser". That matters because the costs are asymmetric: a filled target that
 * disagrees with `getResolvedSignature` is a hard failure, while an unfilled one
 * is a measurement the engine completes.
 *
 * ## What each value means the parser did
 *
 * ```ts
 * const r: Repo = …; r.find()   // DECLARED_RECEIVER_TYPE — read `r`'s annotation
 * import { f } from "m"; f()    // IMPORT_BINDING         — the callee is an import
 * function g() { } g()          // LOCAL_BINDING          — same file, one lookup
 * this.m()                      // THIS_MEMBER            — the enclosing type
 * super.m()                     // SUPER_MEMBER           — an inheritsMembers row
 * Namespace.f()                 // NAMESPACE_QUALIFIED    — the namespace's table
 * handler[name]()               // INDEX_SIGNATURE        — through an index signature
 * console.log()                 // AMBIENT_GLOBAL         — a curated global
 * g().m()                       // NONE                   — needs an inferred type
 * ```
 *
 * `NONE` with a non-zero `overloadCandidateCount` is a distinct and useful state:
 * a real overload set was found and arity could not narrow it to one. That is not
 * "nothing found" — choosing between same-arity overloads needs argument TYPES,
 * and picking the first would be wrong on 77.6% of real overloaded calls.
 *
 * Schema §4.15 c18.
 */
export enum TsResolutionEvidence {
  /** The receiver's annotation at its declaration site. The primary mechanism. */
  DECLARED_RECEIVER_TYPE = 'DECLARED_RECEIVER_TYPE',
  /** The callee or receiver is a name bound by an import. */
  IMPORT_BINDING = 'IMPORT_BINDING',
  /** A declaration in the same file, reachable in one lookup. */
  LOCAL_BINDING = 'LOCAL_BINDING',
  /** `this` plus the enclosing type's members. */
  THIS_MEMBER = 'THIS_MEMBER',
  /** `super` plus an `inheritsMembers` heritage row. */
  SUPER_MEMBER = 'SUPER_MEMBER',
  /** A namespace-qualified name, resolved in the namespace's own table. */
  NAMESPACE_QUALIFIED = 'NAMESPACE_QUALIFIED',
  /** An index signature on the receiver's type. */
  INDEX_SIGNATURE = 'INDEX_SIGNATURE',
  /** A curated ambient global. A terminal, not a link. */
  AMBIENT_GLOBAL = 'AMBIENT_GLOBAL',
  /** No syntactic evidence. With candidates > 1, a set was seen and not chosen from. */
  NONE = 'NONE',
}
