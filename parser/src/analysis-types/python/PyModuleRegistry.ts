import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonDialect,
  PythonEmissionRegime,
  PythonGrammarUsed,
  PythonModuleKind,
} from '@/enums/python/modules';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a Python module — one `.py` or `.pyi` file.
 *
 * There is no Java analogue. Java's package is implicit in a type's qualified
 * name, but Python's module is a first-class runtime namespace object, is the
 * unit of import resolution, and **executes top to bottom**. It is the root of
 * every FK chain in the Python fact base.
 *
 * ## Examples
 *
 * ```
 * app/web/views.py     -> name=views,    qualifiedName=app.web.views,  MODULE
 * app/web/__init__.py  -> name=web,      qualifiedName=app.web,        PACKAGE_INIT
 * stubs/views.pyi      -> name=views,    isStub=true,                  STUB
 * ```
 *
 * ## Why `emissionRegime` is a column *and* part of the key
 *
 * A 3.10 run and a 3.12 run over identical source produce structurally
 * different fact sets — roughly 1,383 comprehension scopes present versus
 * absent in the measured corpus — while both would be stamped
 * `pythonDialect=PY3`. Recording the regime in the PK propagates it through
 * every child key, so 3.10 facts and 3.12 facts for the same file can never
 * collide even if both databases are loaded at once.
 *
 * `pythonDialect` and `emissionRegime` answer different questions and are
 * deliberately separate: the dialect is a property of the *file* and is now a
 * detection/rejection signal, while the regime is a property of the *analysis
 * run*. A rejected file has no regime at all.
 *
 * ## Column order (frozen — schema v6 §2.1, 24 columns)
 *
 * `name, qualifiedName, fileName, filePath, baseMservPath, moduleKind,
 * packageQualifiedName, isPackage, isStub, pythonDialect, targetVersion,
 * emissionRegime, grammarUsed, futureImports, encodingDeclared,
 * hasModuleDocstring, hasDunderAll, dunderAllIsStatic, dunderAllNames,
 * moduleInitMethodLinkHash, moduleScopeLinkHash, isExternal,
 * serviceVersionLinkHash, pyModuleUniqueHash`
 *
 * **PK** `PY_MODULE_md5(filePath ‖ baseMservPath ‖ qualifiedName ‖ emissionRegime ‖ serviceVersionLinkHash)`
 */
export class PyModuleRegistry implements EntityIdentifiable {
  private name: string;
  private qualifiedName: string;
  private fileName: string;
  private filePath: string;
  private baseMservPath: string;
  private moduleKind: PythonModuleKind;
  private packageQualifiedName: string;
  private isPackage: boolean;
  private isStub: boolean;
  private pythonDialect: PythonDialect;
  private targetVersion: string;
  private emissionRegime: PythonEmissionRegime;
  private grammarUsed: PythonGrammarUsed;
  private futureImports: Set<string>;
  private encodingDeclared: string;
  private hasModuleDocstring: boolean;
  private hasDunderAll: boolean;
  private dunderAllIsStatic: boolean;
  private dunderAllNames: string[];
  private moduleInitMethodLinkHash: string;
  private moduleScopeLinkHash: string;
  private isExternal: boolean;
  private serviceVersionLinkHash: string;
  private pyModuleUniqueHash: string = '';

  private constructor(builder: PyModuleRegistryBuilder) {
    this.name = builder.name;
    this.qualifiedName = builder.qualifiedName;
    this.fileName = builder.fileName;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.moduleKind = builder.moduleKind;
    this.packageQualifiedName = builder.packageQualifiedName;
    this.isPackage = builder.isPackage;
    this.isStub = builder.isStub;
    this.pythonDialect = builder.pythonDialect;
    this.targetVersion = builder.targetVersion;
    this.emissionRegime = builder.emissionRegime;
    this.grammarUsed = builder.grammarUsed;
    this.futureImports = builder.futureImports;
    this.encodingDeclared = builder.encodingDeclared;
    this.hasModuleDocstring = builder.hasModuleDocstring;
    this.hasDunderAll = builder.hasDunderAll;
    this.dunderAllIsStatic = builder.dunderAllIsStatic;
    this.dunderAllNames = builder.dunderAllNames;
    this.moduleInitMethodLinkHash = builder.moduleInitMethodLinkHash;
    this.moduleScopeLinkHash = builder.moduleScopeLinkHash;
    this.isExternal = builder.isExternal;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    qualifiedName: string,
    fileName: string,
    filePath: string,
    baseMservPath: string,
    moduleKind: PythonModuleKind,
    emissionRegime: PythonEmissionRegime,
    targetVersion: string,
    serviceVersionLinkHash: string
  ): PyModuleRegistryBuilder {
    return new PyModuleRegistryBuilder(
      name,
      qualifiedName,
      fileName,
      filePath,
      baseMservPath,
      moduleKind,
      emissionRegime,
      targetVersion,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getModuleKind(): PythonModuleKind {
    return this.moduleKind;
  }

  getPythonDialect(): PythonDialect {
    return this.pythonDialect;
  }

  getEmissionRegime(): PythonEmissionRegime {
    return this.emissionRegime;
  }

  getGrammarUsed(): PythonGrammarUsed {
    return this.grammarUsed;
  }

  getFutureImports(): Set<string> {
    return this.futureImports;
  }

  /** Comma-set of `__future__` imports for CSV output; `''` when none. */
  getFutureImportsValue(): string {
    return Array.from(this.futureImports).sort().join(',');
  }

  /** Comma-set of `__all__` names; `''` when absent **or** not static. */
  getDunderAllNamesValue(): string {
    if (!this.hasDunderAll || !this.dunderAllIsStatic) {
      return '';
    }
    return this.dunderAllNames.join(',');
  }

  getModuleScopeLinkHash(): string {
    return this.moduleScopeLinkHash;
  }

  /**
   * Back-patches the module scope FK.
   *
   * The module row is minted before its scope exists, so this FK is filled in
   * afterwards. Accumulate-then-export makes that free — nothing has been
   * written when the patch happens — and it does **not** disturb the PK, which
   * is derived only from path, name, regime and service version.
   */
  setModuleScopeLinkHash(moduleScopeLinkHash: string): void {
    this.moduleScopeLinkHash = moduleScopeLinkHash;
  }

  getModuleInitMethodLinkHash(): string {
    return this.moduleInitMethodLinkHash;
  }

  /** Back-patches the synthetic `<module>` initializer FK. See above. */
  setModuleInitMethodLinkHash(moduleInitMethodLinkHash: string): void {
    this.moduleInitMethodLinkHash = moduleInitMethodLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyModuleUniqueHash(): string {
    return this.pyModuleUniqueHash;
  }

  getHash(): string {
    return this.pyModuleUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.baseMservPath +
      '||' +
      this.qualifiedName +
      '||' +
      this.emissionRegime +
      '||' +
      this.serviceVersionLinkHash;

    this.pyModuleUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_MODULE,
      content
    );
  }

  getEntryCombined(): string {
    return `py_module[name=${this.name}, qname=${this.qualifiedName}, kind=${this.moduleKind}, dialect=${this.pythonDialect}, regime=${this.emissionRegime}, hash=${this.pyModuleUniqueHash}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.qualifiedName),
      EntityUtils.escapeTsv(this.fileName),
      EntityUtils.escapeTsv(this.filePath),
      EntityUtils.escapeTsv(this.baseMservPath),
      this.moduleKind,
      EntityUtils.escapeTsv(this.packageQualifiedName),
      this.isPackage.toString(),
      this.isStub.toString(),
      this.pythonDialect,
      this.targetVersion,
      this.emissionRegime,
      this.grammarUsed,
      EntityUtils.escapeTsv(this.getFutureImportsValue()),
      EntityUtils.escapeTsv(this.encodingDeclared),
      this.hasModuleDocstring.toString(),
      this.hasDunderAll.toString(),
      this.dunderAllIsStatic.toString(),
      EntityUtils.escapeTsv(this.getDunderAllNamesValue()),
      this.moduleInitMethodLinkHash,
      this.moduleScopeLinkHash,
      this.isExternal.toString(),
      this.serviceVersionLinkHash,
      this.pyModuleUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'qualifiedName',
      'fileName',
      'filePath',
      'baseMservPath',
      'moduleKind',
      'packageQualifiedName',
      'isPackage',
      'isStub',
      'pythonDialect',
      'targetVersion',
      'emissionRegime',
      'grammarUsed',
      'futureImports',
      'encodingDeclared',
      'hasModuleDocstring',
      'hasDunderAll',
      'dunderAllIsStatic',
      'dunderAllNames',
      'moduleInitMethodLinkHash',
      'moduleScopeLinkHash',
      'isExternal',
      'serviceVersionLinkHash',
      'pyModuleUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for PyModuleRegistry.
 *
 * `isExternal` has no setter: it is a parity slot that is **always false** on
 * parser output, so that when the engine stages `lib_py_module` the layout is
 * byte-identical. Deciding what is external is the engine's job, not the
 * parser's.
 */
export class PyModuleRegistryBuilder {
  name: string;
  qualifiedName: string;
  fileName: string;
  filePath: string;
  baseMservPath: string;
  moduleKind: PythonModuleKind;
  packageQualifiedName: string = '';
  isPackage: boolean = false;
  isStub: boolean = false;
  pythonDialect: PythonDialect = PythonDialect.PY3;
  targetVersion: string;
  emissionRegime: PythonEmissionRegime;
  grammarUsed: PythonGrammarUsed = PythonGrammarUsed.TS_PYTHON3;
  futureImports: Set<string> = new Set();
  encodingDeclared: string = '';
  hasModuleDocstring: boolean = false;
  hasDunderAll: boolean = false;
  dunderAllIsStatic: boolean = false;
  dunderAllNames: string[] = [];
  moduleInitMethodLinkHash: string = '';
  moduleScopeLinkHash: string = '';
  readonly isExternal: boolean = false;
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    qualifiedName: string,
    fileName: string,
    filePath: string,
    baseMservPath: string,
    moduleKind: PythonModuleKind,
    emissionRegime: PythonEmissionRegime,
    targetVersion: string,
    serviceVersionLinkHash: string
  ) {
    if (!qualifiedName || qualifiedName.trim().length === 0) {
      throw new Error('qualifiedName is required');
    }
    if (!filePath || filePath.trim().length === 0) {
      throw new Error('filePath is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.name = name;
    this.qualifiedName = qualifiedName;
    this.fileName = fileName;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.moduleKind = moduleKind;
    this.emissionRegime = emissionRegime;
    this.targetVersion = targetVersion;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withPackage(packageQualifiedName: string, isPackage: boolean): this {
    this.packageQualifiedName = packageQualifiedName;
    this.isPackage = isPackage;
    return this;
  }

  withIsStub(isStub: boolean): this {
    this.isStub = isStub;
    return this;
  }

  withDialect(pythonDialect: PythonDialect): this {
    this.pythonDialect = pythonDialect;
    return this;
  }

  withGrammarUsed(grammarUsed: PythonGrammarUsed): this {
    this.grammarUsed = grammarUsed;
    return this;
  }

  withFutureImports(futureImports: string[]): this {
    futureImports.forEach(f => this.futureImports.add(f));
    return this;
  }

  withEncodingDeclared(encodingDeclared: string): this {
    this.encodingDeclared = encodingDeclared;
    return this;
  }

  withHasModuleDocstring(hasModuleDocstring: boolean): this {
    this.hasModuleDocstring = hasModuleDocstring;
    return this;
  }

  /**
   * Records `__all__`.
   *
   * `dunderAllIsStatic` is separate because `__all__` is not always a literal:
   * `__all__ = __all__ + _d` and `__all__.extend(...)` both occur in real code.
   * Treating a dynamically built `__all__` as complete is silently wrong in
   * exactly the direction that hides public API, so the flag marks it rather
   * than the parser guessing.
   */
  withDunderAll(hasDunderAll: boolean, isStatic: boolean, names: string[]): this {
    this.hasDunderAll = hasDunderAll;
    this.dunderAllIsStatic = isStatic;
    this.dunderAllNames = names;
    return this;
  }

  build(): PyModuleRegistry {
    return new (PyModuleRegistry as unknown as {
      new (builder: PyModuleRegistryBuilder): PyModuleRegistry;
    })(this);
  }
}
