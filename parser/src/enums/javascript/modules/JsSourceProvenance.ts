/**
 * Where this file's bytes came from, for the purpose of counting. Schema §3.1 c24.
 *
 * ## Bundled output is classified, never counted
 *
 * A bundler's output is real, valid JavaScript. It is also a single generated
 * artefact that can carry more expressions than the entire source tree it was
 * built from, and every one of them teaches nothing about the language: the
 * identifiers are mangled, the module structure is a numeric map, and the
 * inheritance is whatever the transpiler emitted. 43 such files appeared in a
 * 2,738-file corpus and were excluded by rule.
 *
 * The rule has to be a *column*, not a silent skip. Gate 7.3.5 asserts that a
 * file whose provenance is not `PROJECT` contributes zero rows to any coverage
 * denominator — which is only checkable if the file is in the fact base saying
 * what it is. §9 of `BUILDING-A-PARSER.md` is the precedent: when the analyzer
 * drops something for a structural reason it must say so, because on one large framework checkout a
 * nested config silently excluded 1,270 of 1,821 files and nothing counted them.
 */
export enum JsSourceProvenance {
  /** Hand-written source. The only value that contributes to a denominator. */
  PROJECT = 'PROJECT',

  /**
   * Detected bundler or minifier output: a `.min.js`-shaped name, or a line
   * past the length threshold no hand-written source reaches.
   *
   * A LABEL, not a rejection (§3.1.1): the file emits in full, and the column
   * is how a consumer filters. Its facts are right — just not project source —
   * and dropping them at emit time would be the parser deciding what a
   * consumer wants. Only `FLOW_REJECTED` withholds rows. The old name,
   * `BUNDLED_EXCLUDED`, read as if both did the same thing.
   */
  BUNDLED = 'BUNDLED',

  /**
   * A generated single-file artefact that is not minified — a concatenated
   * build, a compiled template set. Readable, still not source.
   */
  GENERATED_MONOLITH = 'GENERATED_MONOLITH',

  /**
   * A file carrying Flow syntax. **Out of scope, as a recorded rejection rather
   * than an absence.**
   *
   * ## Why this is a provenance and not a skip
   *
   * Flow is not JavaScript. `ts.createSourceFile` under `ScriptKind.JS` accepts
   * Flow's grammar where it overlaps TypeScript's and mis-parses it where it
   * diverges — silently, producing a tree that looks complete. One cause, and it
   * surfaced as three separate-looking defects:
   *
   * - 3,793 parameters carried `declaredTypeSource = SYNTACTIC_FLOW`, 6.5% of
   *   all shipped-source parameters, indistinguishable in the fact base from
   *   TypeScript annotations;
   * - `declare function flushSync<R>(fn: () => R): R;` minted a `js_method` with
   *   `bodyPresence = NO_BODY` for a TYPE-ONLY overload declaration, putting
   *   three method rows where JavaScript has one function and breaking gate 4;
   * - error recovery over a Flow cast emitted the same diagnostic repeatedly.
   *
   * And of 248 `@flow` files, **zero parsed cleanly** — every one carried at
   * least one parse gap, averaging 24, accounting for 5,962 of the corpus's
   * 5,964 `PARSE_ERROR` gaps.
   *
   * ## The rejection is RECORDED, which is the whole design
   *
   * Exactly one `js_module` row is emitted, with this provenance and
   * `hasFlowPragma = true`, and nothing anywhere else. A silent skip would be
   * §9's nested-config failure — 1,270 of 1,821 files excluded with nothing counting
   * them. A consumer can ask how much of a tree was declined and get a number.
   *
   * It rides on `sourceProvenance` rather than `SkippedFileReason` deliberately:
   * that enum is shared by five front ends and Flow is a JavaScript-local
   * problem. Unlike `BUNDLED`, which labels a file whose facts are correct,
   * this WITHHOLDS: the facts would be wrong rather than unwanted (§3.1.1).
   */
  FLOW_REJECTED = 'FLOW_REJECTED',
}
