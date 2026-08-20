import * as crypto from 'crypto';

import { HASH_ALGO } from '@/constants/consts';

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
   * Replaces newlines and tabs with their escaped representations.
   */
  static escapeTsv(value: string): string {
    let escaped = value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
    escaped = escaped.replace(/\t/g, '\\t');
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
