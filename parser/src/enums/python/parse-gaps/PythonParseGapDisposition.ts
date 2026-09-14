/**
 * How the gap presented itself — and the reason this column exists at all.
 *
 * `MISPARSED_SILENTLY` is the dangerous one and the one the whole relation is
 * built around. An `ERROR_NODE` announces itself; a backtick expression parses
 * into a plausible-but-wrong node and produces confident facts about code that
 * does not mean what the tree says. A consumer must be able to tell "the parser
 * knew it was lost" from "the parser did not notice".
 *
 * Schema v7 §2.19 c2.
 */
export enum PythonParseGapDisposition {
  /** The grammar flagged it; nothing downstream trusts the region. */
  ERROR_NODE = 'ERROR_NODE',
  /** The grammar produced a plausible but WRONG node — no error was raised. */
  MISPARSED_SILENTLY = 'MISPARSED_SILENTLY',
  /** The construct was recognised and deliberately not emitted. */
  SKIPPED = 'SKIPPED',
}
