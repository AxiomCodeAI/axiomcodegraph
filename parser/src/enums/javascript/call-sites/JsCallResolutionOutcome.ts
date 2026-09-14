/**
 * What the engine will have to do with this call site. Schema §3.11 c13.
 *
 * ## Mirrors the oracle's partition so a gate can compare like with like
 *
 * The oracle emits a three-way partition — `RESOLVED`, `SYNTHESIZED`,
 * `ANY_SIGNATURE` — and only the first two may authorise an expectation. This
 * column is the parser's side of that comparison. Without it a gate would be
 * comparing "the parser emitted a row" against "tsc resolved a signature",
 * which are different questions, and the difference would read as a defect
 * population that does not exist.
 *
 * ## The one value that is not about this project at all
 *
 * `AMBIENT_BUILTIN_TARGET` says the target is in the `lib_*` population and
 * therefore **not in this project**. 15.3-24.4% of oracle declines are this, and the
 * schema's own correction is worth repeating: an earlier draft said JavaScript
 * has no large environmental class, on the strength of `node_modules` mattering
 * only 1.5%. That measurement was right and the conclusion was too broad. Node
 * builtins with no ambient declarations are a second, larger class — and no
 * amount of installing dependencies in the analysed repo fixes it.
 */
export enum JsCallResolutionOutcome {
  /**
   * The receiver's declaration is in this file and the parser named it.
   *
   * The only outcome where a same-file one-hop link is legitimately populated.
   */
  SAME_FILE_RESOLVED = 'SAME_FILE_RESOLVED',

  /**
   * The receiver came through an import, and the import row carries
   * `resolvedFilePath`.
   *
   * **Complete, not resolved.** The three things §0 of `BUILDING-A-PARSER.md`
   * says an engine needs — the name as written, the importing module, and the
   * resolved path — are all present, and the parser stops there on purpose.
   */
  IMPORT_HOP_AVAILABLE = 'IMPORT_HOP_AVAILABLE',

  /**
   * The target is an ambient or platform declaration: `lib.*.d.ts`, a Node
   * builtin.
   *
   * Not in this project and not stageable from it.
   *
   * ## A RANGE, because it is not a language constant
   *
   * The schema measured 24.4% of oracle declines as this class; js-corpus
   * re-derived the partition on a different corpus and got 15.3%. Neither is
   * wrong. The figure tracks **how much CommonJS a corpus holds** — the schema's
   * was three CommonJS-heavy packages at 84.3% CommonJS, js-corpus's is 55% and includes
   * three ESM packages that never require anything.
   *
   * Recorded as a range because a single number here reads as a property of
   * JavaScript, and the next person to quote it will be quoting a property of
   * somebody's package selection. The three-class partition itself DOES
   * reproduce, and that is the durable finding: environmental-and-fixable,
   * environmental-but-unfixable, and language-intrinsic are real and distinct.
   */
  AMBIENT_BUILTIN_TARGET = 'AMBIENT_BUILTIN_TARGET',

  /**
   * The receiver has no type from any channel.
   *
   * Language-intrinsic rather than environmental — the file is there and carries
   * no types. 8.5% of declines are the narrower version of this where the module
   * resolved and turned out to be untyped JavaScript.
   */
  RECEIVER_UNTYPED = 'RECEIVER_UNTYPED',

  /** `obj[expr]()` — the name is not fixed by syntax. Complete *because* it says so. */
  COMPUTED_NAME = 'COMPUTED_NAME',

  /** `eval`, `new Function` — the target is unknowable. Also complete by saying so. */
  DYNAMIC_CODE = 'DYNAMIC_CODE',
}
