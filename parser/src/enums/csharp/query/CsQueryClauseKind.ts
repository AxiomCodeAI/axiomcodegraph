/**
 * A LINQ query clause — `cs_query_clause.clauseKind`, schema §3.18.
 *
 * ## The parser emits STRUCTURE. The engine desugars.
 *
 * `from x in xs where p select f` becomes `xs.Where(p).Select(f)`, and there is
 * **no call syntax in the source** for two to five calls in the semantics. Call
 * synthesis was proposed and **withdrawn by ruling**, and the reason is the
 * dividing line this whole front end is built on:
 *
 * - `from`/`where`/`select` is **structure the parser can see**.
 * - `Where()`/`Select()` is **which overload, on which receiver type, through
 *   which extension method, in which `using` scope** — every part of that a
 *   resolution outcome.
 *
 * A parser that synthesized the calls would be guessing at four resolutions at
 * once and recording the guesses as facts. So the clauses are emitted with their
 * identifiers, their source expressions and their bodies, and an engine that
 * knows the receiver's type does the rewrite.
 *
 * Silence was the third option and is the one that is definitely wrong: it
 * produces a fact base where LINQ-heavy code appears to call nothing. 1,462
 * query expressions and 5,096 clauses were measured.
 */
export enum CsQueryClauseKind {
  /** `from x in xs` — introduces a RANGE VARIABLE. 2,051 measured. */
  FROM = 'FROM',
  /** `let y = expr` — introduces another. 72 measured. */
  LET = 'LET',
  /** `where p` — 708 measured. */
  WHERE = 'WHERE',
  /** `join z in zs on a equals b` — 437 measured. */
  JOIN = 'JOIN',
  /** `join … into g` — a GROUP join, which is a different operator entirely. */
  JOIN_INTO = 'JOIN_INTO',
  /** `orderby a, b descending` — the clause. 309 measured. */
  ORDER_BY = 'ORDER_BY',
  /** One key within an `orderby`. `isDescending` is per-ORDERING, not per-clause. */
  ORDER_BY_ORDERING = 'ORDER_BY_ORDERING',
  /** `select f` — 1,461 measured. */
  SELECT = 'SELECT',
  /** `group x by k` — 58 measured. */
  GROUP = 'GROUP',
  /**
   * `… into h` — a CONTINUATION.
   *
   * Everything after it is a new query over the previous one's result, so an
   * engine desugaring the chain has to break it here. Without this clause the
   * two halves look like one flat sequence and the rewrite is wrong.
   */
  INTO = 'INTO',
}
