/**
 * How a file contradicts its governing config, when it does. Schema §3.1 c11.
 *
 * ## The Q3 ruling, as a vocabulary
 *
 * `BUILDING-JAVASCRIPT.md` §3 poses this as an open question: a file using
 * `import` under `"type": "commonjs"` cannot run, so is it a `SkippedFileReason`,
 * a flagged row, or a normal row? The ruling is **emit normally and flag it**,
 * and the measurement is why: 170 of 2,738 files — 6.2% — contradict their
 * config, and **all 170 are bundler input**, where `package.json` never governs
 * anything because a bundler reads the file before Node ever would.
 *
 * Skipping 6.2% of a real corpus to enforce a runtime rule that does not apply
 * to it would be the analyzer inventing a constraint.
 *
 * ## The asymmetry is the interesting part
 *
 * `ESM_SYNTAX_UNDER_COMMONJS` is 170 measured occurrences. `REQUIRE_UNDER_ESM`
 * is **0** — and that is the direction that really is a runtime crash, since
 * `require` is simply not defined in an ES module. The harmless direction is
 * common and the fatal one is absent, which is what a corpus of bundler-fed
 * source should look like. A future corpus where that inverts is telling you
 * something, and it can only be seen because the two have separate values.
 */
export enum JsContradictionKind {
  /** The file agrees with its governing config. */
  NONE = 'NONE',

  /**
   * Top-level `import`/`export` in a CommonJS-governed file. 170 measured.
   *
   * Cannot run under Node as-is; runs fine through any bundler.
   */
  ESM_SYNTAX_UNDER_COMMONJS = 'ESM_SYNTAX_UNDER_COMMONJS',

  /**
   * `require(...)` in an ESM-governed file. **0 measured.**
   *
   * The direction that genuinely throws at runtime. Kept separate precisely so
   * its absence is a reportable fact rather than a value nobody thought of.
   */
  REQUIRE_UNDER_ESM = 'REQUIRE_UNDER_ESM',

  /** Both, in one file. */
  MIXED = 'MIXED',
}
