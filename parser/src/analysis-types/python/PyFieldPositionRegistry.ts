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
 * EVERY field gets a position, and getting this wrong once is instructive. My
 * first version gave positions only to class-body declarations, reasoning that a
 * `self.x` recovered from a method body has no declaration order to report. That
 * inverted the relation's purpose: Python's constructor-assigned fields are
 * almost all `SELF_ASSIGN`, so the rows being skipped were exactly the ones a
 * rule matching constructor arguments to fields needs. It emitted 2 rows for 11
 * fields where Java is strictly 1:1.
 *
 * Order is therefore defined for both, in the order the class actually
 * establishes its attributes: class-body declarations first, in declaration
 * order, then attributes recovered from methods, in FIRST-WRITE order. For a
 * `@dataclass` this is exactly the generated `__init__` signature. For a
 * hand-written `__init__` it is the order the attributes come into existence,
 * which is the closest true statement available — and unlike a line number it
 * stays stable when the class is reformatted.
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
