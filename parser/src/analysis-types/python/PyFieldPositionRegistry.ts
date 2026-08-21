/**
 * An attribute's declaration position within its class body.
 *
 * Exact `java_field_position` shape, but it earns its place beyond parity:
 * `@dataclass` and `NamedTuple` generate `__init__` **in field-declaration
 * order**, so positional argument flow into a dataclass constructor is undefined
 * without this row.
 *
 * ```python
 * @dataclass
 * class Point:
 *     x: int      # position 0
 *     y: int      # position 1
 *
 * Point(3, 4)     # 3 -> x, 4 -> y, knowable only from position
 * ```
 *
 * Only class-body declarations get a position. A `self.x` recovered from a
 * method body has no declaration order to report, and inventing one from line
 * number would be a guess that a generated `__init__` does not honour.
 *
 * ## Column order (frozen — schema v6 §2.11, 3 columns)
 *
 * No PK: the row IS its key, exactly as in Java.
 */
export class PyFieldPositionRegistry {
  private pyTypeLinkHash: string;
  private pyFieldLinkHash: string;
  private position: number;

  constructor(pyTypeLinkHash: string, pyFieldLinkHash: string, position: number) {
    this.pyTypeLinkHash = pyTypeLinkHash;
    this.pyFieldLinkHash = pyFieldLinkHash;
    this.position = position;
  }

  getPyTypeLinkHash(): string {
    return this.pyTypeLinkHash;
  }

  getPyFieldLinkHash(): string {
    return this.pyFieldLinkHash;
  }

  getPosition(): number {
    return this.position;
  }

  getEntryCombined(): string {
    return `py_field_position[field=${this.pyFieldLinkHash}, position=${this.position}]`;
  }

  toCsv(): string {
    return [this.pyTypeLinkHash, this.pyFieldLinkHash, this.position].join('\t');
  }

  getCsvHeader(): string {
    return ['pyTypeLinkHash', 'pyFieldLinkHash', 'position'].join('\t');
  }
}
