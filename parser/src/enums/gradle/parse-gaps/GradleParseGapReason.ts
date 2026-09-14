/**
 * Why a region of a Gradle script is not fully represented in the emitted rows.
 *
 * The Gradle front end is the one place in this parser where the tree comes
 * from a grammar that does not match the language: tree-sitter-groovy parses
 * Groovy, and it is asked to parse Kotlin DSL as well as Groovy constructs it
 * has no rule for. The extractor rewrites the source before parsing to get a
 * usable tree, and some of those rewrites delete tokens.
 *
 * Every such region gets a row here. That is the whole point: a downstream
 * query can then distinguish "this build declares no dependency in that block"
 * from "that block was rewritten and the parser could not see it". Without this
 * relation the two are the same empty result, and the second one is a lie.
 *
 * ERROR_NODE and MISSING_NODE come from tree-sitter itself. Everything else is
 * a rewrite this extractor performed, recorded against the ORIGINAL source
 * offsets so a consumer can go look at the real text.
 */
export enum GradleParseGapReason {
  /** tree-sitter produced an ERROR node: the region did not parse. */
  ERROR_NODE = 'ERROR_NODE',

  /** tree-sitter inserted a MISSING node to recover: a token was absent. */
  MISSING_NODE = 'MISSING_NODE',

  /** `{ dep -> ... }` → `{ ... }`. The closure's parameter names are gone. */
  DROPPED_CLOSURE_PARAMETERS = 'DROPPED_CLOSURE_PARAMETERS',

  /** `x as String?` → `x`. The cast target type is gone. */
  DROPPED_TYPE_CAST = 'DROPPED_TYPE_CAST',

  /** `Foo::class.java` → `Foo`. The class-literal form is gone. */
  DROPPED_CLASS_REFERENCE = 'DROPPED_CLASS_REFERENCE',

  /** `register<Copy>("x")` → `register("x")`. The type argument is gone. */
  DROPPED_TYPE_ARGUMENTS = 'DROPPED_TYPE_ARGUMENTS',

  /** `a ?: b` → `a || b`. Parsed as a boolean OR, which it is not. */
  REWRITTEN_ELVIS = 'REWRITTEN_ELVIS',

  /** A non-ASCII character was replaced with `_` so the grammar would accept it. */
  REPLACED_NON_ASCII = 'REPLACED_NON_ASCII',

  /** The file exceeded the line threshold and was never parsed. */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  /** The parser threw on this file; nothing downstream of this point was seen. */
  PARSE_FAILED = 'PARSE_FAILED',
}
