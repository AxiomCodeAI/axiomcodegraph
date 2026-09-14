/**
 * Converts tree-sitter positions to CPython's column convention.
 *
 * ## Why this exists
 *
 * `ast` reports `col_offset` as a **UTF-8 byte offset** within the line.
 * tree-sitter reports `startPosition.column` in **characters**. On pure-ASCII
 * lines the two are identical, which is why the difference hides for a long
 * time — but they diverge the moment any non-ASCII character appears earlier on
 * the same line:
 *
 * ```python
 * mem = f'memory Δ {get_readable_size(n)}'
 * #                 ^ ast says 34, tree-sitter says 33
 * ```
 *
 * `Δ` is one character and two UTF-8 bytes, so every column after it is shifted
 * by one. This is not cosmetic: `startColumn` is in the primary key of
 * `py_scope`, `py_method` and `py_expression`, so the two conventions produce
 * **different hashes for the same entity**, and the schema states that
 * `startColumn` is ast-derived. CPython is therefore the contract, and this
 * class converts.
 *
 * ## Cost
 *
 * A per-line ASCII flag is computed once per file. The overwhelming majority of
 * lines are pure ASCII and take a direct return, so the conversion is only paid
 * where it is actually needed.
 */
export class PythonSourcePositions {
  private lines: string[];
  private lineIsAscii: boolean[];

  constructor(sourceCode: string) {
    this.lines = sourceCode.split('\n');
    // eslint-disable-next-line no-control-regex
    const asciiOnly = /^[\x00-\x7F]*$/;
    this.lineIsAscii = this.lines.map(line => asciiOnly.test(line));
  }

  /**
   * Converts a tree-sitter (row, character-column) to CPython's UTF-8 byte
   * column.
   *
   * @param row 0-based row, as tree-sitter reports it
   * @param characterColumn 0-based column in characters
   * @returns 0-based column in UTF-8 bytes, matching `ast.col_offset`
   */
  byteColumn(row: number, characterColumn: number): number {
    if (row < 0 || row >= this.lines.length) {
      return characterColumn;
    }
    if (this.lineIsAscii[row]) {
      return characterColumn;
    }
    const line = this.lines[row] ?? '';
    return Buffer.byteLength(line.slice(0, characterColumn), 'utf8');
  }

  /** Total number of lines, for the module scope's end position. */
  lineCount(): number {
    return this.lines.length;
  }

  /** UTF-8 byte length of the last line, for the module scope's end column. */
  lastLineByteLength(): number {
    const last = this.lines[this.lines.length - 1] ?? '';
    return Buffer.byteLength(last, 'utf8');
  }
}
