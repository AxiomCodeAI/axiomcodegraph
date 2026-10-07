/**
 * Offset → (line, column) for one text, 1-based on both axes, matching every other
 * front end's convention. Built once per file: the HTML parser asks for hundreds of
 * positions per page and a `slice().split('\n')` per ask is quadratic.
 */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) {
        this.starts.push(i + 1);
      }
    }
  }

  /** 1-based line and column of a 0-based offset. An offset past the end lands on the last line. */
  positionOf(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= clamped) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo + 1, column: clamped - this.starts[lo]! + 1 };
  }

  /** The number of lines, counting a final line without a newline and not counting a trailing one. */
  get lineCount(): number {
    if (this.text.length === 0) {
      return 0;
    }
    return this.text.endsWith('\n') ? this.starts.length - 1 : this.starts.length;
  }

  /** The longest line, in characters. */
  get longestLine(): number {
    let longest = 0;
    for (let i = 0; i < this.starts.length; i += 1) {
      const end = i + 1 < this.starts.length ? this.starts[i + 1]! - 1 : this.text.length;
      longest = Math.max(longest, end - this.starts[i]!);
    }
    return longest;
  }
}

/**
 * A position inside EMBEDDED text (a `<style>` body, a `style` attribute), mapped to the
 * host file: the embedded text's line 1 is the host's `line`, and only on that first line
 * does the host's column offset apply.
 */
export function mapEmbeddedPosition(
  host: { line: number; column: number },
  inner: { line: number; column: number }
): { line: number; column: number } {
  return inner.line === 1
    ? { line: host.line, column: host.column + inner.column - 1 }
    : { line: host.line + inner.line - 1, column: inner.column };
}
