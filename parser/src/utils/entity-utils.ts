import * as crypto from 'crypto';

import { HASH_ALGO } from '@/constants/consts';

/** Anything that forces the escaping path: a break, a tab, or a quote. */
const ENTITY_TSV_NEEDS_ESCAPE =
  /[\u0009\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029"]/;

/** Line breaks that are NOT \n, \r or \t, and that a reader may still split on. */
const ENTITY_TSV_OTHER_BREAKS = /[\u000B\u000C\u001C\u001D\u001E\u0085\u2028\u2029]/g;

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
