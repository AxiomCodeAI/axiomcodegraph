/**
 * What a comment IS, beyond being text a human wrote.
 *
 * Most of these are not commentary at all — they are directives the toolchain
 * acts on, and a consumer that treats them as prose loses the instruction:
 *
 * - `ENCODING_COOKIE` decides how the bytes are decoded (PEP 263).
 * - `TYPE_COMMENT` carries a real annotation; `ast.parse(type_comments=True)`
 *   parses it, and 163 files in the corpus depend on it.
 * - `NOQA` suppresses a diagnostic, so a rule that reports the suppressed thing
 *   is arguing with an explicit decision.
 * - `DOCSTRING_*` is a string EXPRESSION that also appears in `py_expression`.
 *   The duplication is intentional (§2.17) and a recall check must whitelist it.
 *
 * Schema v7 §2.17 c0.
 */
export enum PythonCommentKind {
  LINE_COMMENT = 'LINE_COMMENT',
  /** `#!/usr/bin/env python3` — first line only. */
  SHEBANG = 'SHEBANG',
  /** PEP 263 `# -*- coding: utf-8 -*-`, first two lines only. */
  ENCODING_COOKIE = 'ENCODING_COOKIE',
  /** PEP 484 `# type: List[int]` — a real annotation in a comment. */
  TYPE_COMMENT = 'TYPE_COMMENT',
  /** `# noqa`, `# type: ignore`, `# pylint: disable=...`. */
  NOQA = 'NOQA',
  /** `# pragma: no cover` and similar tool directives. */
  PRAGMA = 'PRAGMA',
  DOCSTRING_MODULE = 'DOCSTRING_MODULE',
  DOCSTRING_CLASS = 'DOCSTRING_CLASS',
  DOCSTRING_FUNCTION = 'DOCSTRING_FUNCTION',
  /** A string literal directly after an attribute assignment, by convention. */
  DOCSTRING_ATTRIBUTE = 'DOCSTRING_ATTRIBUTE',
  /** Consecutive line comments merged into one run. */
  BLOCK_COMMENT_RUN = 'BLOCK_COMMENT_RUN',
}
