import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonBindingKind,
  PythonBindingOrigin,
  PythonBindingTargetKind,
} from '@/enums/python/bindings';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one **(scope, name)** pair — exactly `symtable.Symbol`.
 *
 * This is Python's `local_variable` table *and* its global/nonlocal/free/import/
 * parameter table, unified into one relation. It is the highest-value mechanism
 * in the whole schema: 50.7% of attribute calls have a **bare name** as the
 * receiver, and those become resolvable only through this table.
 *
 * ## Examples
 *
 * ```python
 * counter = 0                  # module scope: LOCAL and GLOBAL simultaneously —
 *                              # CPython reports both for module-level bindings
 * def make_counter():
 *     count = 0                # CELL — bound here, captured below
 *     def bump():
 *         nonlocal count       # FREE — resolves to make_counter's binding
 *         count += 1           # is_assigned, and NOT is_referenced
 *     return bump
 *
 * [y for y in xs if (last := y)]
 * # listcomp scope: last -> assigned, free, nonlocal
 * # enclosing scope: last -> assigned, local, referenced
 * ```
 *
 * ## Columns 4–14 are the complete `symtable.Symbol` predicate set
 *
 * All eleven predicates, in symtable's own declaration order: `is_parameter`,
 * `is_local`, `is_global`, `is_nonlocal`, `is_free`, `is_imported`,
 * `is_assigned`, `is_referenced`, `is_declared_global`, `is_annotated`,
 * `is_namespace`. There are no others — `is_cell` is not public — and all eleven
 * exist on every supported target, so the harness compares the full set
 * unconditionally with no feature detection. Column-for-column comparison
 * against CPython is the harness's core assertion, which is why the order here
 * is not negotiable.
 *
 * ## Column order (frozen — schema v6 §2.3, 29 columns)
 *
 * **PK** `PY_BINDING_md5(pyScopeLinkHash ‖ name)` — one row per symbol per
 * scope, by construction. Collisions are impossible, which is what makes the
 * PK-collision check a real assertion rather than a formality.
 */
export class PyBindingRegistry implements EntityIdentifiable {
  private name: string;
  private pyScopeLinkHash: string;
  private bindingKind: PythonBindingKind;
  private bindingOrigin: PythonBindingOrigin;
  private isParameter: boolean;
  private isLocal: boolean;
  private isGlobal: boolean;
  private isNonlocal: boolean;
  private isFree: boolean;
  private isImported: boolean;
  private isAssigned: boolean;
  private isReferenced: boolean;
  private isDeclaredGlobal: boolean;
  private isAnnotated: boolean;
  private isNamespace: boolean;
  private bindingCount: number;
  private firstBindingLine: number;
  private lastBindingLine: number;
  private declaredTypeName: string;
  private declaredBaseType: string;
  private potentialQualifiedName: string;
  private isAmbiguous: boolean;
  private targetEntityKind: PythonBindingTargetKind;
  private targetEntityHash: string;
  private pyModuleLinkHash: string;
  private pyMethodLinkHash: string;
  private filePath: string;
  private serviceVersionLinkHash: string;
  private pyBindingUniqueHash: string = '';

  private constructor(builder: PyBindingRegistryBuilder) {
    this.name = builder.name;
    this.pyScopeLinkHash = builder.pyScopeLinkHash;
    this.bindingKind = builder.bindingKind;
    this.bindingOrigin = builder.bindingOrigin;
    this.isParameter = builder.isParameter;
    this.isLocal = builder.isLocal;
    this.isGlobal = builder.isGlobal;
    this.isNonlocal = builder.isNonlocal;
    this.isFree = builder.isFree;
    this.isImported = builder.isImported;
    this.isAssigned = builder.isAssigned;
    this.isReferenced = builder.isReferenced;
    this.isDeclaredGlobal = builder.isDeclaredGlobal;
    this.isAnnotated = builder.isAnnotated;
    this.isNamespace = builder.isNamespace;
    this.bindingCount = builder.bindingCount;
    this.firstBindingLine = builder.firstBindingLine;
    this.lastBindingLine = builder.lastBindingLine;
    this.declaredTypeName = builder.declaredTypeName;
    this.declaredBaseType = builder.declaredBaseType;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.targetEntityKind = builder.targetEntityKind;
    this.targetEntityHash = builder.targetEntityHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.pyMethodLinkHash = builder.pyMethodLinkHash;
    this.filePath = builder.filePath;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    pyScopeLinkHash: string,
    pyModuleLinkHash: string,
    filePath: string,
    serviceVersionLinkHash: string
  ): PyBindingRegistryBuilder {
    return new PyBindingRegistryBuilder(
      name,
      pyScopeLinkHash,
      pyModuleLinkHash,
      filePath,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  getPyScopeLinkHash(): string {
    return this.pyScopeLinkHash;
  }

  getBindingKind(): PythonBindingKind {
    return this.bindingKind;
  }

  getBindingOrigin(): PythonBindingOrigin {
    return this.bindingOrigin;
  }

  getIsParameter(): boolean {
    return this.isParameter;
  }

  getIsLocal(): boolean {
    return this.isLocal;
  }

  getIsGlobal(): boolean {
    return this.isGlobal;
  }

  getIsNonlocal(): boolean {
    return this.isNonlocal;
  }

  getIsFree(): boolean {
    return this.isFree;
  }

  getIsNamespace(): boolean {
    return this.isNamespace;
  }

  getIsAssigned(): boolean {
    return this.isAssigned;
  }

  getIsImported(): boolean {
    return this.isImported;
  }

  /**
   * Whether this row represents a name genuinely BOUND in its scope, as opposed
   * to merely referenced there.
   *
   * symtable emits a Symbol for any name a scope mentions, including one it only
   * reads — a `GLOBAL_IMPLICIT` reference. Treating such a row as a binding makes
   * a scope look like it shadows an outer definition when it does not, which
   * silently halts any outward name lookup at the first mention.
   */
  isBound(): boolean {
    return this.isAssigned || this.isImported || this.isParameter;
  }

  getDeclaredTypeName(): string {
    return this.declaredTypeName;
  }

  /** Records the annotation's base type and the parser's resolution of it. */
  setResolvedAnnotation(
    declaredBaseType: string,
    potentialQualifiedName: string,
    isAmbiguous: boolean
  ): void {
    this.declaredBaseType = declaredBaseType;
    this.potentialQualifiedName = potentialQualifiedName;
    this.isAmbiguous = isAmbiguous;
  }

  /**
   * Sets the enclosing-method FK.
   *
   * This is the `java_local_variable` column-13 analogue, which is what lets
   * `local-flow.dl` port directly. Empty at module and class scope.
   */
  setPyMethodLinkHash(pyMethodLinkHash: string): void {
    this.pyMethodLinkHash = pyMethodLinkHash;
  }

  /** Sets the polymorphic target FK, back-patched once declarations exist. */
  /** `Symbol.is_free()` — the name is bound in an enclosing function scope. */
  isFreeVariable(): boolean {
    return this.isFree;
  }

  getTargetEntityKind(): PythonBindingTargetKind {
    return this.targetEntityKind;
  }

  getTargetEntityHash(): string {
    return this.targetEntityHash;
  }

  setTargetEntity(targetEntityKind: PythonBindingTargetKind, targetEntityHash: string): void {
    this.targetEntityKind = targetEntityKind;
    this.targetEntityHash = targetEntityHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyBindingUniqueHash(): string {
    return this.pyBindingUniqueHash;
  }

  getHash(): string {
    return this.pyBindingUniqueHash;
  }

  generateHash(): void {
    const content = this.pyScopeLinkHash + '||' + this.name;

    this.pyBindingUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_BINDING,
      content
    );
  }

  getEntryCombined(): string {
    return `py_binding[name=${this.name}, kind=${this.bindingKind}, origin=${this.bindingOrigin}, scope=${this.pyScopeLinkHash}, hash=${this.pyBindingUniqueHash}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      this.pyScopeLinkHash,
      this.bindingKind,
      this.bindingOrigin,
      this.isParameter.toString(),
      this.isLocal.toString(),
      this.isGlobal.toString(),
      this.isNonlocal.toString(),
      this.isFree.toString(),
      this.isImported.toString(),
      this.isAssigned.toString(),
      this.isReferenced.toString(),
      this.isDeclaredGlobal.toString(),
      this.isAnnotated.toString(),
      this.isNamespace.toString(),
      this.bindingCount.toString(),
      this.firstBindingLine.toString(),
      this.lastBindingLine.toString(),
      EntityUtils.escapeTsv(this.declaredTypeName),
      EntityUtils.escapeTsv(this.declaredBaseType),
      EntityUtils.escapeTsv(this.potentialQualifiedName),
      this.isAmbiguous.toString(),
      this.targetEntityKind,
      this.targetEntityHash,
      this.pyModuleLinkHash,
      this.pyMethodLinkHash,
      EntityUtils.escapeTsv(this.filePath),
      this.serviceVersionLinkHash,
      this.pyBindingUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'pyScopeLinkHash',
      'bindingKind',
      'bindingOrigin',
      'isParameter',
      'isLocal',
      'isGlobal',
      'isNonlocal',
      'isFree',
      'isImported',
      'isAssigned',
      'isReferenced',
      'isDeclaredGlobal',
      'isAnnotated',
      'isNamespace',
      'bindingCount',
      'firstBindingLine',
      'lastBindingLine',
      'declaredTypeName',
      'declaredBaseType',
      'potentialQualifiedName',
      'isAmbiguous',
      'targetEntityKind',
      'targetEntityHash',
      'pyModuleLinkHash',
      'pyMethodLinkHash',
      'filePath',
      'serviceVersionLinkHash',
      'pyBindingUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyBindingRegistry. */
export class PyBindingRegistryBuilder {
  name: string;
  pyScopeLinkHash: string;
  bindingKind: PythonBindingKind = PythonBindingKind.UNKNOWN;
  bindingOrigin: PythonBindingOrigin = PythonBindingOrigin.ASSIGNMENT;
  isParameter: boolean = false;
  isLocal: boolean = false;
  isGlobal: boolean = false;
  isNonlocal: boolean = false;
  isFree: boolean = false;
  isImported: boolean = false;
  isAssigned: boolean = false;
  isReferenced: boolean = false;
  isDeclaredGlobal: boolean = false;
  isAnnotated: boolean = false;
  isNamespace: boolean = false;
  bindingCount: number = 0;
  firstBindingLine: number = 0;
  lastBindingLine: number = 0;
  declaredTypeName: string = '';
  declaredBaseType: string = '';
  potentialQualifiedName: string = '';
  isAmbiguous: boolean = false;
  targetEntityKind: PythonBindingTargetKind = PythonBindingTargetKind.NONE;
  targetEntityHash: string = '';
  pyModuleLinkHash: string;
  pyMethodLinkHash: string = '';
  filePath: string;
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    pyScopeLinkHash: string,
    pyModuleLinkHash: string,
    filePath: string,
    serviceVersionLinkHash: string
  ) {
    if (!name || name.length === 0) {
      throw new Error('name is required');
    }
    if (!pyScopeLinkHash || pyScopeLinkHash.trim().length === 0) {
      throw new Error('pyScopeLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.name = name;
    this.pyScopeLinkHash = pyScopeLinkHash;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.filePath = filePath;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withKindAndOrigin(bindingKind: PythonBindingKind, bindingOrigin: PythonBindingOrigin): this {
    this.bindingKind = bindingKind;
    this.bindingOrigin = bindingOrigin;
    return this;
  }

  /**
   * Sets all eleven `symtable.Symbol` predicates at once, in symtable's own
   * order.
   *
   * One setter rather than eleven, deliberately: the predicates are a *set* that
   * CPython computes together, and setting them individually invites a caller to
   * set ten of them and leave the eleventh silently false.
   */
  withSymbolPredicates(predicates: {
    isParameter: boolean;
    isLocal: boolean;
    isGlobal: boolean;
    isNonlocal: boolean;
    isFree: boolean;
    isImported: boolean;
    isAssigned: boolean;
    isReferenced: boolean;
    isDeclaredGlobal: boolean;
    isAnnotated: boolean;
    isNamespace: boolean;
  }): this {
    this.isParameter = predicates.isParameter;
    this.isLocal = predicates.isLocal;
    this.isGlobal = predicates.isGlobal;
    this.isNonlocal = predicates.isNonlocal;
    this.isFree = predicates.isFree;
    this.isImported = predicates.isImported;
    this.isAssigned = predicates.isAssigned;
    this.isReferenced = predicates.isReferenced;
    this.isDeclaredGlobal = predicates.isDeclaredGlobal;
    this.isAnnotated = predicates.isAnnotated;
    this.isNamespace = predicates.isNamespace;
    return this;
  }

  withBindingSites(bindingCount: number, firstBindingLine: number, lastBindingLine: number): this {
    this.bindingCount = bindingCount;
    this.firstBindingLine = firstBindingLine;
    this.lastBindingLine = lastBindingLine;
    return this;
  }

  withDeclaredType(
    declaredTypeName: string,
    declaredBaseType: string,
    potentialQualifiedName: string,
    isAmbiguous: boolean
  ): this {
    this.declaredTypeName = declaredTypeName;
    this.declaredBaseType = declaredBaseType;
    this.potentialQualifiedName = potentialQualifiedName;
    this.isAmbiguous = isAmbiguous;
    return this;
  }

  withTargetEntity(
    targetEntityKind: PythonBindingTargetKind,
    targetEntityHash: string
  ): this {
    this.targetEntityKind = targetEntityKind;
    this.targetEntityHash = targetEntityHash;
    return this;
  }

  withPyMethodLinkHash(pyMethodLinkHash: string): this {
    this.pyMethodLinkHash = pyMethodLinkHash;
    return this;
  }

  build(): PyBindingRegistry {
    return new (PyBindingRegistry as unknown as {
      new (builder: PyBindingRegistryBuilder): PyBindingRegistry;
    })(this);
  }
}
