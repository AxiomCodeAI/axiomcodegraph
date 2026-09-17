/**
 * WHY a branch was taken or not — `cs_preproc_region.activationSource`.
 *
 * Without it, `isActive = false` has three unrelated causes that read the same:
 * the symbol was not defined, an earlier branch already won, or the parser
 * could not evaluate the condition at all. Only the third is a limitation, and
 * an auditor cannot separate it from the other two by looking at the rows.
 *
 * `UNEVALUATED` is the one that costs something, and naming it is what makes
 * the cost countable.
 */
export enum CsActivationSource {
  /** The condition held: every symbol it needs is in the active set. */
  CONDITION_TRUE = 'CONDITION_TRUE',
  /** The condition did not hold. */
  CONDITION_FALSE = 'CONDITION_FALSE',
  /** `#else`, reached because no earlier branch was taken. */
  ELSE_FALLBACK = 'ELSE_FALLBACK',
  /** The condition held, but an EARLIER branch already won. */
  EARLIER_BRANCH_TAKEN = 'EARLIER_BRANCH_TAKEN',
  /** The parser could not evaluate it. The one value that is a limitation. */
  UNEVALUATED = 'UNEVALUATED',
}
