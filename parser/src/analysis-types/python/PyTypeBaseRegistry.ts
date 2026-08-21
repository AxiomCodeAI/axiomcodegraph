import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonBaseKind } from '@/enums/python/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one entry in a class's base list.
 *
 * Deliberately **not** a type reference. Python bases differ from Java's
 * `extends`/`implements` in three ways that a type-reference row cannot carry:
 *
 * 1. **They are ordered, and C3 linearisation depends on the order.**
 *    `position` is therefore load-bearing, not decorative — 12.1% of classes
 *    have more than one base.
 * 2. **They can be arbitrary expressions.** `class D(mixin_factory())` is legal,
 *    and its MRO is not statically knowable.
 * 3. **`metaclass=` and `total=` are syntactically in the base list but are not
 *    bases.** They must be distinguishable, not silently counted as position 2.
 *
 * ## Examples
 *
 * ```python
 * class Repo(Base, Mixin, metaclass=Meta):
 * #          ^0    ^1     ^keyword row, position=''
 *
 * class Box(Generic[T]):        # SUBSCRIPT, baseSimpleName=Generic
 * class Impl(pkg.mod.Iface):    # DOTTED_NAME, baseDottedPath=pkg.mod.Iface
 * class Dyn(factory()):         # CALL, isDynamic=true
 * ```
 *
 * ## Column order (frozen — schema v6 §2.5, 16 columns)
 *
 * **PK** `PY_TYPE_BASE_md5(pyTypeLinkHash ‖ position ‖ keywordName ‖ baseText ‖ startLine)`
 */
export class PyTypeBaseRegistry implements EntityIdentifiable {
  private baseKind: PythonBaseKind;
  private position: string;
  private baseText: string;
  private baseSimpleName: string;
  private baseDottedPath: string;
  private keywordName: string;
  private pyTypeLinkHash: string;
  private pyModuleLinkHash: string;
  private pyExpressionLinkHash: string;
  private pyTypeReferenceLinkHash: string;
  private resolvedTypeLinkHash: string;
  private isResolvedLocally: boolean;
  private isDynamic: boolean;
  private startLine: number;
  private serviceVersionLinkHash: string;
  private pyTypeBaseUniqueHash: string = '';

  private constructor(builder: PyTypeBaseRegistryBuilder) {
    this.baseKind = builder.baseKind;
    this.position = builder.position;
    this.baseText = builder.baseText;
    this.baseSimpleName = builder.baseSimpleName;
    this.baseDottedPath = builder.baseDottedPath;
    this.keywordName = builder.keywordName;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.pyExpressionLinkHash = builder.pyExpressionLinkHash;
    this.pyTypeReferenceLinkHash = builder.pyTypeReferenceLinkHash;
    this.resolvedTypeLinkHash = builder.resolvedTypeLinkHash;
    this.isResolvedLocally = builder.isResolvedLocally;
    this.isDynamic = builder.isDynamic;
    this.startLine = builder.startLine;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    baseKind: PythonBaseKind,
    baseText: string,
    pyTypeLinkHash: string,
    pyModuleLinkHash: string,
    startLine: number,
    serviceVersionLinkHash: string
  ): PyTypeBaseRegistryBuilder {
    return new PyTypeBaseRegistryBuilder(
      baseKind,
      baseText,
      pyTypeLinkHash,
      pyModuleLinkHash,
      startLine,
      serviceVersionLinkHash
    );
  }

  getBaseKind(): PythonBaseKind {
    return this.baseKind;
  }

  /** 0-based MRO order among positional bases; `''` for keyword rows. */
  getPosition(): string {
    return this.position;
  }

  getBaseText(): string {
    return this.baseText;
  }

  getBaseSimpleName(): string {
    return this.baseSimpleName;
  }

  getKeywordName(): string {
    return this.keywordName;
  }

  getPyTypeLinkHash(): string {
    return this.pyTypeLinkHash;
  }

  getIsDynamic(): boolean {
    return this.isDynamic;
  }

  getBaseDottedPath(): string {
    return this.baseDottedPath;
  }

  getResolvedTypeLinkHash(): string {
    return this.resolvedTypeLinkHash;
  }

  getIsResolvedLocally(): boolean {
    return this.isResolvedLocally;
  }

  /**
   * Records that this base was resolved to a type in the same analysis.
   *
   * MRO resolution depends on this: `super().m()` can only find the parent's `m`
   * once the base has an actual `py_type` to walk into.
   */
  setResolution(resolvedTypeLinkHash: string, isResolvedLocally: boolean): void {
    this.resolvedTypeLinkHash = resolvedTypeLinkHash;
    this.isResolvedLocally = isResolvedLocally;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyTypeBaseUniqueHash(): string {
    return this.pyTypeBaseUniqueHash;
  }

  getHash(): string {
    return this.pyTypeBaseUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyTypeLinkHash +
      '||' +
      this.position +
      '||' +
      this.keywordName +
      '||' +
      this.baseText +
      '||' +
      this.startLine;

    this.pyTypeBaseUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_TYPE_BASE,
      content
    );
  }

  getEntryCombined(): string {
    return `py_type_base[kind=${this.baseKind}, position=${this.position || '-'}, text=${this.baseText}, keyword=${this.keywordName || '-'}, hash=${this.pyTypeBaseUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.baseKind,
      this.position,
      EntityUtils.escapeTsv(this.baseText),
      this.baseSimpleName,
      this.baseDottedPath,
      this.keywordName,
      this.pyTypeLinkHash,
      this.pyModuleLinkHash,
      this.pyExpressionLinkHash,
      this.pyTypeReferenceLinkHash,
      this.resolvedTypeLinkHash,
      this.isResolvedLocally.toString(),
      this.isDynamic.toString(),
      this.startLine.toString(),
      this.serviceVersionLinkHash,
      this.pyTypeBaseUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'baseKind',
      'position',
      'baseText',
      'baseSimpleName',
      'baseDottedPath',
      'keywordName',
      'pyTypeLinkHash',
      'pyModuleLinkHash',
      'pyExpressionLinkHash',
      'pyTypeReferenceLinkHash',
      'resolvedTypeLinkHash',
      'isResolvedLocally',
      'isDynamic',
      'startLine',
      'serviceVersionLinkHash',
      'pyTypeBaseUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyTypeBaseRegistry. */
export class PyTypeBaseRegistryBuilder {
  baseKind: PythonBaseKind;
  position: string = '';
  baseText: string;
  baseSimpleName: string = '';
  baseDottedPath: string = '';
  keywordName: string = '';
  pyTypeLinkHash: string;
  pyModuleLinkHash: string;
  pyExpressionLinkHash: string = '';
  pyTypeReferenceLinkHash: string = '';
  resolvedTypeLinkHash: string = '';
  isResolvedLocally: boolean = false;
  isDynamic: boolean = false;
  startLine: number;
  serviceVersionLinkHash: string;

  constructor(
    baseKind: PythonBaseKind,
    baseText: string,
    pyTypeLinkHash: string,
    pyModuleLinkHash: string,
    startLine: number,
    serviceVersionLinkHash: string
  ) {
    if (!pyTypeLinkHash || pyTypeLinkHash.trim().length === 0) {
      throw new Error('pyTypeLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.baseKind = baseKind;
    this.baseText = baseText;
    this.pyTypeLinkHash = pyTypeLinkHash;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.startLine = startLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  /** Positional bases carry a 0-based MRO index; keyword rows leave it empty. */
  withPosition(position: number): this {
    this.position = position.toString();
    return this;
  }

  withNameParts(baseSimpleName: string, baseDottedPath: string): this {
    this.baseSimpleName = baseSimpleName;
    this.baseDottedPath = baseDottedPath;
    return this;
  }

  withKeywordName(keywordName: string): this {
    this.keywordName = keywordName;
    return this;
  }

  withIsDynamic(isDynamic: boolean): this {
    this.isDynamic = isDynamic;
    return this;
  }

  withResolution(resolvedTypeLinkHash: string, isResolvedLocally: boolean): this {
    this.resolvedTypeLinkHash = resolvedTypeLinkHash;
    this.isResolvedLocally = isResolvedLocally;
    return this;
  }

  build(): PyTypeBaseRegistry {
    return new (PyTypeBaseRegistry as unknown as {
      new (builder: PyTypeBaseRegistryBuilder): PyTypeBaseRegistry;
    })(this);
  }
}
