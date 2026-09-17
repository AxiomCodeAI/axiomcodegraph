/**
 * A place the parser could not read — `cs_parse_gap.gapKind`.
 *
 * ## Why a relation and not a log line
 *
 * 3.01% of files in the measured corpus carry a parse error. Without rows, that
 * population is anecdotal: nobody can ask which files, which constructs, or how
 * much of each file was lost, and a regression from 3.01% to 5% would show up as
 * slightly fewer rows everywhere and nothing else.
 *
 * ## Three shapes, and only one of them is an `ERROR` node
 *
 * This was cs-impl's finding and it changed the vocabulary: `MISSING_NODE` was
 * renamed and `SELF_REPORTING_NODE` added, because the old set named a detector
 * that could not reach the thing it described. See the two values below.
 *
 * ## The buckets are VALIDATED, not chosen and hoped for
 *
 * The thresholds are on the fraction of a file's bytes inside a maximal `ERROR`
 * node, and cs-oracle checked the proxy against Roslyn's declaration counts on
 * files without `#if` — which are the only comparable ones, since tree-sitter
 * parses both branches and Roslyn parses one:
 *
 * | bucket | files | declarations recovered vs Roslyn |
 * |---|---|---|
 * | `ERROR_LOCAL` (<5%) | 120 | **98.0%** |
 * | `ERROR_PARTIAL` (5–50%) | 62 | 50.6% |
 * | `ERROR_TRUNCATING` (>50%) | 83 | **22.7%** |
 *
 * Cleanly monotonic, so the buckets mean what they say. The cut points are still
 * authored — tier 3 — and that is written down rather than implied.
 */
export enum CsParseGapKind {
  /** Under 5% of the file inside an ERROR. 98.0% of declarations still recovered. */
  ERROR_LOCAL = 'ERROR_LOCAL',

  /** 5–50%. Half the declarations are gone. */
  ERROR_PARTIAL = 'ERROR_PARTIAL',

  /** Over 50%. Only 22.7% of declarations recovered — the file is effectively lost. */
  ERROR_TRUNCATING = 'ERROR_TRUNCATING',

  /**
   * A node the parser INSERTED to recover: a brace, a semicolon, an identifier
   * that was not there. Distinct from an ERROR because the surrounding tree is
   * usable. 172 in the corpus.
   *
   * ## Renamed from `MISSING_NODE`, because that name implied a detector that
   * could not reach the thing it named
   *
   * Two traps, both measured:
   *
   * - **`isMissing` is unreliable.** On `System.Private.CoreLib/src/System/Math.cs`
   *   the whole defect is a zero-width `identifier` with `isMissing` **false**.
   *   A zero-width NAMED node is the detector that works, and no real C# token
   *   has zero width.
   * - **The inserted node is usually ANONYMOUS** — a `;` or a `}` — so a
   *   named-only walk cannot reach one at all, and the value was structurally
   *   impossible to emit.
   */
  INSERTED_NODE = 'INSERTED_NODE',

  /**
   * A node that **is** the error and is neither an `ERROR` nor inserted.
   *
   * In one test file of multitarget-B (reproduced byte-for-byte by `GapUnlocatable.cs`) the entire defect is
   * a `preproc_pragma` reporting `hasError` on ITSELF, with no ERROR anywhere in
   * the tree and no zero-width child. **26 files — 9.3% of every file with a
   * parse error.** Without this the relation is silent about a tenth of the
   * gaps it exists to describe.
   *
   * The node TYPE is the diagnosis even though the span is approximate.
   */
  SELF_REPORTING_NODE = 'SELF_REPORTING_NODE',

  /**
   * A `#if` region whose content is not independently parseable — it splits a
   * base list, an `else` chain, an accessor list or a parameter list.
   *
   * **16.9% of regions.** This is the honest terminal for the construct: no
   * both-branches parser can represent it, and silence would hide it. It is
   * 1.60% of the corpus's 3.01% error rate and is irreducible.
   */
  PREPROC_FRAGMENT = 'PREPROC_FRAGMENT',
}
