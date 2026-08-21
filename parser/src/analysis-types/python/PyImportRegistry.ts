import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonImportKind, PythonImportTargetKind } from '@/enums/python/imports';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one imported name.
 *
 * Positions 0–8 mirror `java_import` 0–8. From-imports outnumber module-imports
 * 6:1 in the measured corpus and **38% of from-imports are relative**, so
 * `relativeLevel` and parser-side module resolution are mandatory.
 *
 * ## One row per BOUND NAME
 *
 * ```python
 * import a.b.c          # ONE row: simpleName=a, importedPath=a.b.c,
 *                       #          isModuleImport=true — the statement binds
 *                       #          only `a`, and `b`/`c` are reached by
 *                       #          attribute access afterwards
 * from m import x, y    # TWO rows, one per bound name
 * from .. import sib    # ONE row, relativeLevel=2
 * ```
 *
 * ## `isTypeCheckingOnly` produces findings
 *
 * An import under `if TYPE_CHECKING:` — 338 blocks measured — **does not exist
 * at runtime**. Calling one of those names outside an annotation is a bug, so
 * this is a fact worth carrying rather than a detail.
 *
 * ## `isExternalTarget` is an honest negative
 *
 * It means precisely "did not resolve to a `py_module` in this analysis" — not a
 * claim about the outside world. Deciding what is genuinely third-party is the
 * engine's job, which is why the parser has no site-packages walk to do.
 *
 * ## Column order (frozen — schema v6 §2.14, 24 columns)
 *
 * **PK** `PY_IMPORT_md5(pyModuleLinkHash ‖ lineNumber ‖ importKind ‖ importedPath ‖ simpleName)`
 */
export class PyImportRegistry implements EntityIdentifiable {
  private importKind: PythonImportKind;
  private importedPath: string;
  private packageOrTypeName: string;
  private simpleName: string;
  private filePath: string;
  private lineNumber: number;
  private isStatic: boolean;
  private isWildcard: boolean;
  private isModuleImport: boolean;
  private relativeLevel: number;
  private originalName: string;
  private aliasName: string;
  private resolvedModuleLinkHash: string;
  private resolvedTargetKind: PythonImportTargetKind;
  private resolvedTargetHash: string;
  private isExternalTarget: boolean;
  private distributionName: string;
  private isTypeCheckingOnly: boolean;
  private isConditional: boolean;
  private pyScopeLinkHash: string;
  private pyModuleLinkHash: string;
  private bindingLinkHash: string;
  private serviceVersionLinkHash: string;
  private pyImportUniqueHash: string = '';

  private constructor(builder: PyImportRegistryBuilder) {
    this.importKind = builder.importKind;
    this.importedPath = builder.importedPath;
    this.packageOrTypeName = builder.packageOrTypeName;
    this.simpleName = builder.simpleName;
    this.filePath = builder.filePath;
    this.lineNumber = builder.lineNumber;
    this.isStatic = builder.isStatic;
    this.isWildcard = builder.isWildcard;
    this.isModuleImport = builder.isModuleImport;
    this.relativeLevel = builder.relativeLevel;
    this.originalName = builder.originalName;
    this.aliasName = builder.aliasName;
    this.resolvedModuleLinkHash = builder.resolvedModuleLinkHash;
    this.resolvedTargetKind = builder.resolvedTargetKind;
    this.resolvedTargetHash = builder.resolvedTargetHash;
    this.isExternalTarget = builder.isExternalTarget;
    this.distributionName = builder.distributionName;
    this.isTypeCheckingOnly = builder.isTypeCheckingOnly;
    this.isConditional = builder.isConditional;
    this.pyScopeLinkHash = builder.pyScopeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.bindingLinkHash = builder.bindingLinkHash;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    importKind: PythonImportKind,
    importedPath: string,
    simpleName: string,
    filePath: string,
    lineNumber: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyImportRegistryBuilder {
    return new PyImportRegistryBuilder(
      importKind,
      importedPath,
      simpleName,
      filePath,
      lineNumber,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getImportKind(): PythonImportKind {
    return this.importKind;
  }

  getImportedPath(): string {
    return this.importedPath;
  }

  /** The name actually bound in the importing namespace. */
  getSimpleName(): string {
    return this.simpleName;
  }

  getLineNumber(): number {
    return this.lineNumber;
  }

  getRelativeLevel(): number {
    return this.relativeLevel;
  }

  getIsWildcard(): boolean {
    return this.isWildcard;
  }

  getIsTypeCheckingOnly(): boolean {
    return this.isTypeCheckingOnly;
  }

  getPyModuleLinkHash(): string {
    return this.pyModuleLinkHash;
  }

  getPackageOrTypeName(): string {
    return this.packageOrTypeName;
  }

  /** The pre-alias name — what the target is called in the source module. */
  getOriginalName(): string {
    return this.originalName;
  }

  getAliasName(): string {
    return this.aliasName;
  }

  getBindingLinkHash(): string {
    return this.bindingLinkHash;
  }

  getResolvedModuleLinkHash(): string {
    return this.resolvedModuleLinkHash;
  }

  getIsModuleImport(): boolean {
    return this.isModuleImport;
  }

  getPyScopeLinkHash(): string {
    return this.pyScopeLinkHash;
  }

  getResolvedTargetKind(): PythonImportTargetKind {
    return this.resolvedTargetKind;
  }

  getResolvedTargetHash(): string {
    return this.resolvedTargetHash;
  }

  /** Back-patches the FK to the binding this import creates. */
  setBindingLinkHash(bindingLinkHash: string): void {
    this.bindingLinkHash = bindingLinkHash;
  }

  /** Records repo-local resolution. The engine decides true externality. */
  setResolution(
    resolvedModuleLinkHash: string,
    resolvedTargetKind: PythonImportTargetKind,
    resolvedTargetHash: string
  ): void {
    this.resolvedModuleLinkHash = resolvedModuleLinkHash;
    this.resolvedTargetKind = resolvedTargetKind;
    this.resolvedTargetHash = resolvedTargetHash;
    this.isExternalTarget = resolvedModuleLinkHash.length === 0;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyImportUniqueHash(): string {
    return this.pyImportUniqueHash;
  }

  getHash(): string {
    return this.pyImportUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyModuleLinkHash +
      '||' +
      this.lineNumber +
      '||' +
      this.importKind +
      '||' +
      this.importedPath +
      '||' +
      this.simpleName;

    this.pyImportUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_IMPORT,
      content
    );
  }

  getEntryCombined(): string {
    return `py_import[kind=${this.importKind}, path=${this.importedPath}, binds=${this.simpleName}, level=${this.relativeLevel}, line ${this.lineNumber}, hash=${this.pyImportUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.importKind,
      EntityUtils.escapeTsv(this.importedPath),
      EntityUtils.escapeTsv(this.packageOrTypeName),
      this.simpleName,
      this.filePath,
      this.lineNumber.toString(),
      this.isStatic.toString(),
      this.isWildcard.toString(),
      this.isModuleImport.toString(),
      this.relativeLevel.toString(),
      this.originalName,
      this.aliasName,
      this.resolvedModuleLinkHash,
      this.resolvedTargetKind,
      this.resolvedTargetHash,
      this.isExternalTarget.toString(),
      this.distributionName,
      this.isTypeCheckingOnly.toString(),
      this.isConditional.toString(),
      this.pyScopeLinkHash,
      this.pyModuleLinkHash,
      this.bindingLinkHash,
      this.serviceVersionLinkHash,
      this.pyImportUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'importKind',
      'importedPath',
      'packageOrTypeName',
      'simpleName',
      'filePath',
      'lineNumber',
      'isStatic',
      'isWildcard',
      'isModuleImport',
      'relativeLevel',
      'originalName',
      'aliasName',
      'resolvedModuleLinkHash',
      'resolvedTargetKind',
      'resolvedTargetHash',
      'isExternalTarget',
      'distributionName',
      'isTypeCheckingOnly',
      'isConditional',
      'pyScopeLinkHash',
      'pyModuleLinkHash',
      'bindingLinkHash',
      'serviceVersionLinkHash',
      'pyImportUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyImportRegistry. `isStatic` is a parity slot, always false. */
export class PyImportRegistryBuilder {
  importKind: PythonImportKind;
  importedPath: string;
  packageOrTypeName: string = '';
  simpleName: string;
  filePath: string;
  lineNumber: number;
  readonly isStatic: boolean = false;
  isWildcard: boolean = false;
  isModuleImport: boolean = false;
  relativeLevel: number = 0;
  originalName: string = '';
  aliasName: string = '';
  resolvedModuleLinkHash: string = '';
  resolvedTargetKind: PythonImportTargetKind = PythonImportTargetKind.UNRESOLVED;
  resolvedTargetHash: string = '';
  isExternalTarget: boolean = true;
  distributionName: string = '';
  isTypeCheckingOnly: boolean = false;
  isConditional: boolean = false;
  pyScopeLinkHash: string = '';
  pyModuleLinkHash: string;
  bindingLinkHash: string = '';
  serviceVersionLinkHash: string;

  constructor(
    importKind: PythonImportKind,
    importedPath: string,
    simpleName: string,
    filePath: string,
    lineNumber: number,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    if (!pyModuleLinkHash || pyModuleLinkHash.trim().length === 0) {
      throw new Error('pyModuleLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }
    if (lineNumber <= 0) {
      throw new Error('lineNumber must be > 0');
    }

    this.importKind = importKind;
    this.importedPath = importedPath;
    this.simpleName = simpleName;
    this.filePath = filePath;
    this.lineNumber = lineNumber;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
    this.originalName = simpleName;
  }

  withPackageOrTypeName(packageOrTypeName: string): this {
    this.packageOrTypeName = packageOrTypeName;
    return this;
  }

  withNames(originalName: string, aliasName: string): this {
    this.originalName = originalName;
    this.aliasName = aliasName;
    return this;
  }

  withRelativeLevel(relativeLevel: number): this {
    this.relativeLevel = relativeLevel;
    return this;
  }

  withFlags(flags: {
    isWildcard?: boolean;
    isModuleImport?: boolean;
    isTypeCheckingOnly?: boolean;
    isConditional?: boolean;
  }): this {
    this.isWildcard = flags.isWildcard ?? this.isWildcard;
    this.isModuleImport = flags.isModuleImport ?? this.isModuleImport;
    this.isTypeCheckingOnly = flags.isTypeCheckingOnly ?? this.isTypeCheckingOnly;
    this.isConditional = flags.isConditional ?? this.isConditional;
    return this;
  }

  withPyScopeLinkHash(pyScopeLinkHash: string): this {
    this.pyScopeLinkHash = pyScopeLinkHash;
    return this;
  }

  withBindingLinkHash(bindingLinkHash: string): this {
    this.bindingLinkHash = bindingLinkHash;
    return this;
  }

  build(): PyImportRegistry {
    return new (PyImportRegistry as unknown as {
      new (builder: PyImportRegistryBuilder): PyImportRegistry;
    })(this);
  }
}
