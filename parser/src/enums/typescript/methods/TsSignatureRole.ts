/**
 * Overload identity — a first-class column, not a flag.
 *
 * ## The measurement that makes this necessary
 *
 * 11,599 overload signatures in one ecosystem corpus, and **77.6% of calls to a
 * multi-declaration symbol resolve to a NON-FIRST declaration.** So a call site
 * that points at a NAME is wrong four times in five, and picking the first
 * declaration is worse than picking nothing. `ts_call_site` must be able to name
 * ONE signature, which is why the primary key is per signature and why this
 * column exists to say which of the set a row is.
 *
 * ## Worked example
 *
 * ```ts
 * function connect(port: number): Socket;              // OVERLOAD_SIGNATURE  index 0
 * function connect(host: string, port: number): Socket; // OVERLOAD_SIGNATURE  index 1
 * function connect(a: unknown, b?: unknown): Socket {   // IMPLEMENTATION      index 2
 *     return open(a, b);
 * }
 *
 * declare function ambient(x: number): void;            // AMBIENT
 * declare function ambient(x: string): void;            // AMBIENT
 *
 * function sole() { }                                   // SOLE
 * interface I { m(): void }                             // SOLE — no set to be one of
 * ```
 *
 * The IMPLEMENTATION is the only member of the set that is callable at runtime,
 * and it is NOT the signature a call resolves to — tsc resolves to one of the
 * overload signatures. An engine needs both facts, which is why the role and
 * `bodyPresence` are separate columns.
 *
 * Schema §4.6 c25.
 */
export enum TsSignatureRole {
  /** The only declaration of its name in its table. */
  SOLE = 'SOLE',

  /** One of N bodiless declarations preceding an implementation. */
  OVERLOAD_SIGNATURE = 'OVERLOAD_SIGNATURE',

  /** The declaration carrying the body for an overload set. */
  IMPLEMENTATION = 'IMPLEMENTATION',

  /** Bodiless with no implementation anywhere in source — `declare function`. */
  AMBIENT = 'AMBIENT',
}
