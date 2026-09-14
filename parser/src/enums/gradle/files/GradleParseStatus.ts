/**
 * How completely a Gradle script was parsed.
 *
 * Recorded per script so a consumer can tell an empty result from an
 * unanalysed one. A build file that produced no dependency rows because it
 * declares none, and one that produced none because the parse collapsed at
 * line 3, are different facts and must not read the same downstream.
 */
export enum GradleParseStatus {
  /** Parsed with no ERROR/MISSING node anywhere in the tree. */
  OK = 'OK',

  /** Parsed, but at least one region is recorded in the parse-gap relation. */
  PARTIAL = 'PARTIAL',

  /** The parser threw. No blocks or declarations were emitted for this file. */
  FAILED = 'FAILED',
}
