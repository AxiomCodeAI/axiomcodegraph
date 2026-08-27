/**
 * What a call site's target IS, once resolution has run.
 *
 * ## Measured distribution
 *
 * 45.7% project, 42.3% `lib.*.d.ts`, 9.7% `node_modules`, 2.3% synthesized. So
 * **more than half of all call targets are declared outside the project** — a
 * closed-world model that treats external targets as failures fails by
 * construction.
 *
 * ## The three members that are TERMINALS, not failures
 *
 * `LIB_SIGNATURE`, `AMBIENT_SIGNATURE` and `SYNTHESIZED_NO_DECLARATION` all mean
 * "the target exists and is not a row in this fact base". The closed-world gate
 * counts them as CLOSED. `UNRESOLVED` means the parser does not know, and is the
 * only member that counts against it.
 *
 * `SYNTHESIZED_NO_DECLARATION` deserves its own member: **225 of 9,627 measured
 * call sites** resolve to a signature with NO declaration node anywhere — an
 * implicit constructor, a synthesized member. Leaving those empty would make
 * them indistinguishable from a resolution failure.
 *
 * ## PROJECT_IMPLEMENTATION versus PROJECT_SIGNATURE
 *
 * ```ts
 * function f(x: number): void;      // a call resolves HERE → PROJECT_SIGNATURE
 * function f(x: unknown): void { }  // the code that runs is HERE
 * ```
 *
 * 44.3% of resolved targets are bodiless. Reading one as the code that runs
 * attributes behaviour to a declaration that has none, which is why the two are
 * separate members and why `isAmbientTarget` repeats the fact as a boolean.
 *
 * Schema §4.15 c14.
 */
export enum TsResolvedTargetKind {
  /** A project declaration WITH a body: the code that actually runs. */
  PROJECT_IMPLEMENTATION = 'PROJECT_IMPLEMENTATION',
  /** A project declaration with no body: an overload signature, an abstract member. */
  PROJECT_SIGNATURE = 'PROJECT_SIGNATURE',
  /** `declare`d in project source — bodiless by construction. A closed terminal. */
  AMBIENT_SIGNATURE = 'AMBIENT_SIGNATURE',
  /** Declared in `lib.*.d.ts` or `node_modules`. The engine closes it from `lib_ts_*`. */
  LIB_SIGNATURE = 'LIB_SIGNATURE',
  /** No declaration node exists: an implicit constructor. 2.3% measured. */
  SYNTHESIZED_NO_DECLARATION = 'SYNTHESIZED_NO_DECLARATION',
  /** Resolved through an index signature. */
  INDEX_SIGNATURE = 'INDEX_SIGNATURE',
  /** The parser does not know. The only member the closed-world gate counts against. */
  UNRESOLVED = 'UNRESOLVED',
}
