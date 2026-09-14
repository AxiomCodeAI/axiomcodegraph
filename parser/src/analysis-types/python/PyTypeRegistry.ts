import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonMroKind,
  PythonTypeAccess,
  PythonTypeCategory,
  PythonTypeModifier,
  PythonTypePlacement,
} from '@/enums/python/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a Python `class` statement.
 *
 * Positions 0–11 mirror `java_type` 0–11 exactly, so the type-hierarchy
 * projections port as a literal relation rename.
 *
 * ## Examples
 *
 * ```python
 * class UserService:                       # CLASS_TYPE, IMPLICIT_OBJECT MRO
 *     ...
 *
 * @dataclass(frozen=True)
 * class Point(Base, Mixin):                # DATACLASS_TYPE, FROZEN,
 *     x: int                               # C3_LINEARIZABLE (2 bases)
 *
 * class Registry(dict, metaclass=Meta):    # metaclassName=Meta
 *     ...
 *
 * def factory():
 *     class Local: ...                     # LOCAL_PLACEMENT, enclosingMethod set
 * ```
 *
 * ## Why `enclosingTypeLinkHash` is explicit
 *
 * Java's parser recovers nesting from line ranges. Here the enclosing type and
 * enclosing method are explicit FKs, so no `type_lines` range trick is needed —
 * and 60 classes in the measured corpus are defined inside a *function*, which a
 * line-range heuristic attributes to the wrong owner.
 *
 * ## Column order (frozen — schema v6 §2.4, 25 columns)
 *
 * **PK** `PY_TYPE_md5(pyModuleLinkHash ‖ qualifiedName ‖ name ‖ startLine ‖ endLine)`
 */
export class PyTypeRegistry implements EntityIdentifiable {
  private name: string;
  private qualifiedName: string;
  private fileName: string;
  private typeCategory: PythonTypeCategory;
  private typeAccess: PythonTypeAccess;
  private modifiers: Set<PythonTypeModifier>;
  private typePlacement: PythonTypePlacement;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private isExternal: boolean;
  private pyModuleLinkHash: string;
  private enclosingTypeLinkHash: string;
  private enclosingMethodLinkHash: string;
  private scopeLinkHash: string;
  private classInitMethodLinkHash: string;
  private declaringBindingLinkHash: string;
  private metaclassName: string;
  private baseCount: number;
  private hasDynamicBase: boolean;
  private mroKind: PythonMroKind;
  private docstring: string;
  private serviceVersionLinkHash: string;
  private pyTypeUniqueHash: string = '';

  private constructor(builder: PyTypeRegistryBuilder) {
    this.name = builder.name;
    this.qualifiedName = builder.qualifiedName;
    this.fileName = builder.fileName;
    this.typeCategory = builder.typeCategory;
    this.typeAccess = builder.typeAccess;
    this.modifiers = builder.modifiers;
    this.typePlacement = builder.typePlacement;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.isExternal = builder.isExternal;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.enclosingTypeLinkHash = builder.enclosingTypeLinkHash;
    this.enclosingMethodLinkHash = builder.enclosingMethodLinkHash;
    this.scopeLinkHash = builder.scopeLinkHash;
    this.classInitMethodLinkHash = builder.classInitMethodLinkHash;
    this.declaringBindingLinkHash = builder.declaringBindingLinkHash;
    this.metaclassName = builder.metaclassName;
    this.baseCount = builder.baseCount;
    this.hasDynamicBase = builder.hasDynamicBase;
    this.mroKind = builder.mroKind;
    this.docstring = builder.docstring;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    qualifiedName: string,
    fileName: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyTypeRegistryBuilder {
    return new PyTypeRegistryBuilder(
      name,
      qualifiedName,
      fileName,
      filePath,
      baseMservPath,
      startLine,
      endLine,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
  }

  getTypeCategory(): PythonTypeCategory {
    return this.typeCategory;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getPyModuleLinkHash(): string {
    return this.pyModuleLinkHash;
  }

  getScopeLinkHash(): string {
    return this.scopeLinkHash;
  }

  getModifiers(): Set<PythonTypeModifier> {
    return this.modifiers;
  }

  /** Comma-separated modifiers for CSV output; `''` when none. */
  getTypeModifier(): string {
    if (this.modifiers.size === 0) {
      return '';
    }
    return Array.from(this.modifiers).join(',');
  }

  getMroKind(): PythonMroKind {
    return this.mroKind;
  }

  getDeclaringBindingLinkHash(): string {
    return this.declaringBindingLinkHash;
  }

  getEnclosingTypeLinkHash(): string {
    return this.enclosingTypeLinkHash;
  }

  getEnclosingMethodLinkHash(): string {
    return this.enclosingMethodLinkHash;
  }

  /**
   * Refines the category after same-module base resolution.
   *
   * Safe to patch: `typeCategory` is not part of the primary key, which is
   * derived from module, qualified name, name and line span.
   */
  setTypeCategory(typeCategory: PythonTypeCategory): void {
    this.typeCategory = typeCategory;
  }

  /** Back-patches the synthetic `<classbody>` initializer FK. */
  setClassInitMethodLinkHash(classInitMethodLinkHash: string): void {
    this.classInitMethodLinkHash = classInitMethodLinkHash;
  }

  /** Back-patches the FK to the binding this class name creates in its parent scope. */
  setDeclaringBindingLinkHash(declaringBindingLinkHash: string): void {
    this.declaringBindingLinkHash = declaringBindingLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyTypeUniqueHash(): string {
    return this.pyTypeUniqueHash;
  }

  getHash(): string {
    return this.pyTypeUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyModuleLinkHash +
      '||' +
      this.qualifiedName +
      '||' +
      this.name +
      '||' +
      this.startLine +
      '||' +
      this.endLine;

    this.pyTypeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_TYPE,
      content
    );
  }

  getEntryCombined(): string {
    return `py_type[name=${this.name}, qname=${this.qualifiedName}, category=${this.typeCategory}, mro=${this.mroKind}, line ${this.startLine}, hash=${this.pyTypeUniqueHash}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.qualifiedName),
      EntityUtils.escapeTsv(this.fileName),
      this.typeCategory,
      this.typeAccess,
      this.getTypeModifier(),
      this.typePlacement,
      EntityUtils.escapeTsv(this.filePath),
      EntityUtils.escapeTsv(this.baseMservPath),
      this.startLine.toString(),
      this.endLine.toString(),
      this.isExternal.toString(),
      this.pyModuleLinkHash,
      this.enclosingTypeLinkHash,
      this.enclosingMethodLinkHash,
      this.scopeLinkHash,
      this.classInitMethodLinkHash,
      this.declaringBindingLinkHash,
      EntityUtils.escapeTsv(this.metaclassName),
      this.baseCount.toString(),
      this.hasDynamicBase.toString(),
      this.mroKind,
      EntityUtils.escapeTsv(this.docstring),
      this.serviceVersionLinkHash,
      this.pyTypeUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'qualifiedName',
      'fileName',
      'typeCategory',
      'typeAccess',
      'typeModifier',
      'typePlacement',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'isExternal',
      'pyModuleLinkHash',
      'enclosingTypeLinkHash',
      'enclosingMethodLinkHash',
      'scopeLinkHash',
      'classInitMethodLinkHash',
      'declaringBindingLinkHash',
      'metaclassName',
      'baseCount',
      'hasDynamicBase',
      'mroKind',
      'docstring',
      'serviceVersionLinkHash',
      'pyTypeUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyTypeRegistry. `isExternal` is a parity slot, always false. */
export class PyTypeRegistryBuilder {
  name: string;
  qualifiedName: string;
  fileName: string;
  typeCategory: PythonTypeCategory = PythonTypeCategory.CLASS_TYPE;
  typeAccess: PythonTypeAccess = PythonTypeAccess.PUBLIC_ACCESS;
  modifiers: Set<PythonTypeModifier> = new Set();
  typePlacement: PythonTypePlacement = PythonTypePlacement.TOP_LEVEL_PLACEMENT;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  readonly isExternal: boolean = false;
  pyModuleLinkHash: string;
  enclosingTypeLinkHash: string = '';
  enclosingMethodLinkHash: string = '';
  scopeLinkHash: string = '';
  classInitMethodLinkHash: string = '';
  declaringBindingLinkHash: string = '';
  metaclassName: string = '';
  baseCount: number = 0;
  hasDynamicBase: boolean = false;
  mroKind: PythonMroKind = PythonMroKind.IMPLICIT_OBJECT;
  docstring: string = '';
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    qualifiedName: string,
    fileName: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (!pyModuleLinkHash || pyModuleLinkHash.trim().length === 0) {
      throw new Error('pyModuleLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }
    if (startLine <= 0) {
      throw new Error('startLine must be > 0');
    }
    if (endLine < startLine) {
      throw new Error('endLine must be >= startLine');
    }

    this.name = name;
    this.qualifiedName = qualifiedName;
    this.fileName = fileName;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withCategoryAndAccess(
    typeCategory: PythonTypeCategory,
    typeAccess: PythonTypeAccess
  ): this {
    this.typeCategory = typeCategory;
    this.typeAccess = typeAccess;
    return this;
  }

  withModifiers(modifiers: PythonTypeModifier[]): this {
    modifiers.forEach(m => this.modifiers.add(m));
    return this;
  }

  withPlacement(typePlacement: PythonTypePlacement): this {
    this.typePlacement = typePlacement;
    return this;
  }

  withEnclosing(enclosingTypeLinkHash: string, enclosingMethodLinkHash: string): this {
    this.enclosingTypeLinkHash = enclosingTypeLinkHash;
    this.enclosingMethodLinkHash = enclosingMethodLinkHash;
    return this;
  }

  withScopeLinkHash(scopeLinkHash: string): this {
    this.scopeLinkHash = scopeLinkHash;
    return this;
  }

  /**
   * Records the base list summary.
   *
   * `mroKind` is carried rather than re-derived because 19.5% of classes have no
   * explicit base and 12.1% have more than one, so the engine must distinguish a
   * trivial MRO from a real C3 linearisation from an unlinearisable dynamic base
   * without walking `py_type_base` on every query.
   */
  withBases(
    baseCount: number,
    hasDynamicBase: boolean,
    mroKind: PythonMroKind,
    metaclassName: string
  ): this {
    this.baseCount = baseCount;
    this.hasDynamicBase = hasDynamicBase;
    this.mroKind = mroKind;
    this.metaclassName = metaclassName;
    return this;
  }

  withDocstring(docstring: string): this {
    this.docstring = docstring;
    return this;
  }

  build(): PyTypeRegistry {
    return new (PyTypeRegistry as unknown as {
      new (builder: PyTypeRegistryBuilder): PyTypeRegistry;
    })(this);
  }
}
