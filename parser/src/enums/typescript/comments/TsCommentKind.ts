/**
 * What kind of comment this is.
 *
 * Positions 0–9 of `ts_comment` mirror `java_comment`, so this starts from Java's
 * `CommentKind` — but TypeScript adds two members that are not commentary at
 * all. A `/// <reference />` is a MODULE EDGE and a `@ts-ignore` SUPPRESSES A
 * DIAGNOSTIC, so both change what the program means. Treating them as prose
 * loses a dependency and a suppression respectively.
 *
 * ```ts
 * // a note                          LINE
 * /* a note *\/                       BLOCK
 * /** @deprecated use b *\/           JSDOC       — jsDocTags = deprecated
 * /// <reference types="node" />      TRIPLE_SLASH_DIRECTIVE — a module edge
 * // @ts-expect-error                 TS_DIRECTIVE — suppresses the next line
 * ```
 *
 * Schema §4.17 c0.
 */
export enum TsCommentKind {
  /** `// …`. */
  LINE = 'LINE',
  /** A block comment that is not JSDoc. */
  BLOCK = 'BLOCK',
  /** A block comment opening with two asterisks. Carries `jsDocTags`. */
  JSDOC = 'JSDOC',
  /** `/// <reference … />` — a real module edge that also feeds `ts_import`. */
  TRIPLE_SLASH_DIRECTIVE = 'TRIPLE_SLASH_DIRECTIVE',
  /** `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` — suppresses diagnostics. */
  TS_DIRECTIVE = 'TS_DIRECTIVE',
}
