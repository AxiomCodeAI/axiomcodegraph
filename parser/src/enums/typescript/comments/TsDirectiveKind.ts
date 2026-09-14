/**
 * Which compiler directive a comment carries.
 *
 * Non-empty only for `TS_DIRECTIVE` and `TRIPLE_SLASH_DIRECTIVE` comments, and
 * every member changes program meaning rather than describing it.
 *
 * ## The suppressions
 *
 * `TS_IGNORE` and `TS_EXPECT_ERROR` are not interchangeable: the first silences
 * an error if there is one, the second REQUIRES one and errors if the line is
 * clean. A codebase migrating from the first to the second is measurably
 * tightening, and a fact base that folds them cannot see it. `TS_NOCHECK`
 * disables checking for a whole file.
 *
 * ## The module edges
 *
 * `REFERENCE_PATH`, `REFERENCE_TYPES` and `REFERENCE_LIB` are dependencies
 * written as comments. In ambient code they are frequently the only edge a file
 * has, so they also feed `ts_import` — a fact base built from import statements
 * alone loses them entirely.
 *
 * Schema §4.17 c11.
 */
export enum TsDirectiveKind {
  /** `@ts-ignore` — silences an error on the next line if there is one. */
  TS_IGNORE = 'TS_IGNORE',
  /** `@ts-expect-error` — REQUIRES an error on the next line. */
  TS_EXPECT_ERROR = 'TS_EXPECT_ERROR',
  /** `@ts-nocheck` — disables checking for the whole file. */
  TS_NOCHECK = 'TS_NOCHECK',
  /** `/// <reference path="…" />` — a file dependency. */
  REFERENCE_PATH = 'REFERENCE_PATH',
  /** `/// <reference types="…" />` — a package's type dependency. */
  REFERENCE_TYPES = 'REFERENCE_TYPES',
  /** `/// <reference lib="…" />` — a built-in lib dependency. */
  REFERENCE_LIB = 'REFERENCE_LIB',
}
