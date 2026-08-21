/**
 * Safe column access for spine rows.
 *
 * `noUncheckedIndexedAccess` is on, and that is a feature here: a row shorter
 * than its declared arity is exactly what invariant #6 exists to catch, so the
 * harness must never paper over a missing column with a cast. `col()` makes the
 * absent case explicit and total — an out-of-range column reads as "", which is
 * also the schema's legal absent value.
 */
export function col(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

/** Non-empty test, used for FK presence checks. */
export function has(row: readonly string[], index: number): boolean {
  return col(row, index) !== '';
}
