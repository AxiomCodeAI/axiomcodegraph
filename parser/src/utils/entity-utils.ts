import * as crypto from 'crypto';

import { HASH_ALGO } from '@/constants/consts';

/** Anything that forces the escaping path: a control character, a tab, or a quote. */
const ENTITY_TSV_NEEDS_ESCAPE = /[\u0000-\u001F\u007F\u0085\u2028\u2029"]/;

/**
 * Control characters that are not \n, \r or \t, escaped to a `\uXXXX` form.
 *
 * NUL is the one that matters most and the reason the range was widened from a
 * curated list. It does not split a row, so every byte-level check passes: the
 * line has the right tab count, is valid UTF-8, and carries no line break. But
 * `awk`, Souffle and anything else using C string semantics stop reading at the
 * first NUL, so they see a fraction of the fields and call the row malformed.
 * The disagreement between a byte-safe reader and a C-string reader is the only
 * symptom, which is why counting separators finds nothing wrong.
 *
 * It reaches the output from real sources. Rollup and rolldown prefix virtual
 * module ids with a NUL, so `"\0rolldown/runtime.js"` appears verbatim in
 * published type definitions. In Python it arrives by a different route: a
 * source file holding a literal NUL is rejected by CPython outright, but it
 * still parses here, and the recorded parse gap quotes the offending text --
 * so the relation that exists to record unreadable input was itself unreadable.
 *
 * The whole C0 range plus DEL is escaped rather than NUL alone. None of these
 * is meaningful in an identifier, a path or a literal, several are treated
 * specially by one consumer or another, and enumerating the survivors after
 * each new report is how the curated list kept coming up short.
 */
const ENTITY_TSV_OTHER_BREAKS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0085\u2028\u2029]/g;

export class EntityUtils {
  static generateEntityHash(prefix: string, content: string): string {
    const hash = this.generateHash(content);
    return `${prefix}_${hash}`;
  }

  /**
   * Normalize whitespace in a string by collapsing all whitespace sequences
   * (newlines, tabs, multiple spaces) into a single space.
   * Used for tree-sitter node text that may span multiple lines.
   */
  static normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  /**
   * Escape a string value for safe TSV output.
   *
   * Escapes every character a consumer may treat as a LINE BREAK, not only the
   * ones JavaScript does. `\n`, `\r` and `\t` were covered; U+000B, U+000C,
   * U+001C-U+001E, U+0085, U+2028 and U+2029 were not -- and Python's
   * `str.splitlines()` breaks on all of them, as do several CSV readers.
   *
   * A value carrying one of those produced a file that is well formed to
   * `split('\n')` and torn to the reader: the row splits mid-value, and only
   * the field count against the header reveals it. A string literal containing
   * U+2028 is the realistic case -- it is legal in JavaScript source and
   * survives into `literalValue`.
   *
   * They are escaped to a `\uXXXX` form rather than to `\n`, because they are
   * not newlines and flattening them to one would destroy the distinction on
   * the way back out.
   */
  static escapeTsv(value: string): string {
    // Fast path: the overwhelming majority of cells contain none of these, and
    // the replaces below each allocate.
    if (!ENTITY_TSV_NEEDS_ESCAPE.test(value)) {
      return value;
    }
    let escaped = value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
    escaped = escaped.replace(/\t/g, '\\t');
    escaped = escaped.replace(
      ENTITY_TSV_OTHER_BREAKS,
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    );
    if (escaped.includes('"')) {
      return '"' + escaped.replace(/"/g, '""') + '"';
    }
    return escaped;
  }

  private static generateHash(input: string): string {
    const hash = crypto.createHash(HASH_ALGO);
    hash.update(input, 'utf8');
    return hash.digest('hex');
  }
}
