import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonScopeKind, PythonScopeOwnerKind } from '@/enums/python/scopes';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a Python scope — a direct mirror of `symtable.SymbolTable`.
 *
 * No Java analogue. This relation exists so the oracle can assert **set
 * equality** with CPython rather than eyeballing structure; it is the reason
 * precision and recall are well-defined for this schema at all. Java resolves
 * names by file; Python resolves them by walking a scope chain, so this is the
 * spine the whole resolution layer hangs from.
 *
 * ## Examples
 *
 * ```python
 * def outer():                       # FUNCTION  outer
 *     def inner(): ...               # FUNCTION  outer.<locals>.inner
 *     squares = [x for x in xs]      # COMPREHENSION_LIST  outer.<locals>.listcomp
 *     f = lambda: 1                  # LAMBDA    outer.<locals>.lambda
 *
 * class K:                           # CLASS     K
 *     def m(self): ...               # FUNCTION  K.m       (no <locals>)
 * ```
 *
 * ## Why `startColumn` is in the primary key
 *
 * `(module, parent, kind, name, startLine)` is **not unique**, and this is a
 * measured collision rather than a theoretical one — 37 colliding scopes out of
 * 6,129 scope-introducing nodes (0.60%) across ~4,000 site-packages files:
 *
 * ```python
 * g = (lambda: 1, lambda: 2)          # two scopes, both named `lambda`, one line
 * h = [x for x in a] + [y for y in b] # two `listcomp` scopes, one line
 * ```
 *
 * The blast radius is not contained to this relation. `py_binding` is keyed on
 * `(pyScopeLinkHash, name)`, so one collision silently **merges two scopes'
 * entire binding sets** — and in the listcomp case above those sets genuinely
 * differ (`x` versus `y`). `scopeOrdinal` is deliberately *not* in the key: it
 * is unique but shifts when a sibling is inserted, which would churn every
 * descendant hash.
 *
 * ## Column order (frozen — schema v6 §2.2, 25 columns)
 *
 * `scopeKind, name, qualifiedName, nestingDepth, parentScopeLinkHash,
 * pyModuleLinkHash, ownerKind, ownerHash, isNested, isOptimized, hasChildren,
 * symtableId, usesWildcardImport, isGenerator, isCoroutine, declaresGlobal,
 * declaresNonlocal, filePath, startLine, startColumn, endLine, endColumn,
 * scopeOrdinal, serviceVersionLinkHash, pyScopeUniqueHash`
 *
 * **PK** `PY_SCOPE_md5(pyModuleLinkHash ‖ parentScopeLinkHash ‖ scopeKind ‖ name ‖ startLine ‖ startColumn)`
 */
export class PyScopeRegistry implements EntityIdentifiable {
  private scopeKind: PythonScopeKind;
  private name: string;
  private qualifiedName: string;
  private nestingDepth: number;
  private parentScopeLinkHash: string;
  private pyModuleLinkHash: string;
  private ownerKind: PythonScopeOwnerKind;
  private ownerHash: string;
  private isNested: boolean;
  private isOptimized: boolean;
  private hasChildren: boolean;
  private symtableId: number;
  private usesWildcardImport: boolean;
  private isGenerator: boolean;
  private isCoroutine: boolean;
  private declaresGlobal: boolean;
  private declaresNonlocal: boolean;
  private filePath: string;
  private startLine: number;
  private startColumn: number;
  private endLine: number;
  private endColumn: number;
  private scopeOrdinal: number;
  private serviceVersionLinkHash: string;
  private pyScopeUniqueHash: string = '';

  private constructor(builder: PyScopeRegistryBuilder) {
    this.scopeKind = builder.scopeKind;
    this.name = builder.name;
    this.qualifiedName = builder.qualifiedName;
    this.nestingDepth = builder.nestingDepth;
    this.parentScopeLinkHash = builder.parentScopeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.ownerKind = builder.ownerKind;
    this.ownerHash = builder.ownerHash;
    this.isNested = builder.isNested;
    this.isOptimized = builder.isOptimized;
    this.hasChildren = builder.hasChildren;
    this.symtableId = builder.symtableId;
    this.usesWildcardImport = builder.usesWildcardImport;
    this.isGenerator = builder.isGenerator;
    this.isCoroutine = builder.isCoroutine;
    this.declaresGlobal = builder.declaresGlobal;
    this.declaresNonlocal = builder.declaresNonlocal;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.startColumn = builder.startColumn;
    this.endLine = builder.endLine;
    this.endColumn = builder.endColumn;
    this.scopeOrdinal = builder.scopeOrdinal;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    scopeKind: PythonScopeKind,
    name: string,
    qualifiedName: string,
    pyModuleLinkHash: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    serviceVersionLinkHash: string
  ): PyScopeRegistryBuilder {
    return new PyScopeRegistryBuilder(
      scopeKind,
      name,
      qualifiedName,
      pyModuleLinkHash,
      filePath,
      startLine,
      startColumn,
      serviceVersionLinkHash
    );
  }

  getScopeKind(): PythonScopeKind {
    return this.scopeKind;
  }

  getName(): string {
    return this.name;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
  }

  getNestingDepth(): number {
    return this.nestingDepth;
  }

  getParentScopeLinkHash(): string {
    return this.parentScopeLinkHash;
  }

  getPyModuleLinkHash(): string {
    return this.pyModuleLinkHash;
  }

  getOwnerKind(): PythonScopeOwnerKind {
    return this.ownerKind;
  }

  getOwnerHash(): string {
    return this.ownerHash;
  }

  /**
   * Sets the polymorphic owner FK.
   *
   * A scope is minted before the `py_type` or `py_method` that owns it, so this
   * is back-patched. It is not part of the PK, so patching it is safe.
   */
  setOwner(ownerKind: PythonScopeOwnerKind, ownerHash: string): void {
    this.ownerKind = ownerKind;
    this.ownerHash = ownerHash;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getStartColumn(): number {
    return this.startColumn;
  }

  getScopeOrdinal(): number {
    return this.scopeOrdinal;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getPyScopeUniqueHash(): string {
    return this.pyScopeUniqueHash;
  }

  getHash(): string {
    return this.pyScopeUniqueHash;
  }

  generateHash(): void {
    const content =
      this.pyModuleLinkHash +
      '||' +
      this.parentScopeLinkHash +
      '||' +
      this.scopeKind +
      '||' +
      this.name +
      '||' +
      this.startLine +
      '||' +
      this.startColumn;

    this.pyScopeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_SCOPE,
      content
    );
  }

  getEntryCombined(): string {
    return `py_scope[kind=${this.scopeKind}, qname=${this.qualifiedName}, line ${this.startLine}:${this.startColumn}, ordinal=${this.scopeOrdinal}, hash=${this.pyScopeUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.scopeKind,
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.qualifiedName),
      this.nestingDepth.toString(),
      this.parentScopeLinkHash,
      this.pyModuleLinkHash,
      this.ownerKind,
      this.ownerHash,
      this.isNested.toString(),
      this.isOptimized.toString(),
      this.hasChildren.toString(),
      this.symtableId.toString(),
      this.usesWildcardImport.toString(),
      this.isGenerator.toString(),
      this.isCoroutine.toString(),
      this.declaresGlobal.toString(),
      this.declaresNonlocal.toString(),
      EntityUtils.escapeTsv(this.filePath),
      this.startLine.toString(),
      this.startColumn.toString(),
      this.endLine.toString(),
      this.endColumn.toString(),
      this.scopeOrdinal.toString(),
      this.serviceVersionLinkHash,
      this.pyScopeUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'scopeKind',
      'name',
      'qualifiedName',
      'nestingDepth',
      'parentScopeLinkHash',
      'pyModuleLinkHash',
      'ownerKind',
      'ownerHash',
      'isNested',
      'isOptimized',
      'hasChildren',
      'symtableId',
      'usesWildcardImport',
      'isGenerator',
      'isCoroutine',
      'declaresGlobal',
      'declaresNonlocal',
      'filePath',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
      'scopeOrdinal',
      'serviceVersionLinkHash',
      'pyScopeUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for PyScopeRegistry.
 *
 * `symtableId` is a canonical pre-order ordinal, **not** `SymbolTable.get_id()`.
 * CPython's `get_id()` returns `id()` of the underlying object, which is stable
 * within a process but varies across them, so emitting it would make every
 * golden file differ run-to-run and break the byte-identical-output invariant.
 * The column's documented purpose is "oracle cross-check handle only; never
 * joined on", which an ordinal serves exactly and reproducibly.
 */
export class PyScopeRegistryBuilder {
  scopeKind: PythonScopeKind;
  name: string;
  qualifiedName: string;
  nestingDepth: number = 0;
  parentScopeLinkHash: string = '';
  pyModuleLinkHash: string;
  ownerKind: PythonScopeOwnerKind = PythonScopeOwnerKind.MODULE;
  ownerHash: string = '';
  isNested: boolean = false;
  isOptimized: boolean = false;
  hasChildren: boolean = false;
  symtableId: number = 0;
  usesWildcardImport: boolean = false;
  isGenerator: boolean = false;
  isCoroutine: boolean = false;
  declaresGlobal: boolean = false;
  declaresNonlocal: boolean = false;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number = 0;
  endColumn: number = 0;
  scopeOrdinal: number = 0;
  serviceVersionLinkHash: string;

  constructor(
    scopeKind: PythonScopeKind,
    name: string,
    qualifiedName: string,
    pyModuleLinkHash: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    serviceVersionLinkHash: string
  ) {
    if (!pyModuleLinkHash || pyModuleLinkHash.trim().length === 0) {
      throw new Error('pyModuleLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }
    if (startLine < 0) {
      throw new Error('startLine must be >= 0');
    }
    if (startColumn < 0) {
      throw new Error('startColumn must be >= 0');
    }

    this.scopeKind = scopeKind;
    this.name = name;
    this.qualifiedName = qualifiedName;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.filePath = filePath;
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withParent(parentScopeLinkHash: string, nestingDepth: number): this {
    this.parentScopeLinkHash = parentScopeLinkHash;
    this.nestingDepth = nestingDepth;
    return this;
  }

  withOwner(ownerKind: PythonScopeOwnerKind, ownerHash: string): this {
    this.ownerKind = ownerKind;
    this.ownerHash = ownerHash;
    return this;
  }

  /** The three verbatim `SymbolTable` predicates, in symtable's own order. */
  withSymtablePredicates(isNested: boolean, isOptimized: boolean, hasChildren: boolean): this {
    this.isNested = isNested;
    this.isOptimized = isOptimized;
    this.hasChildren = hasChildren;
    return this;
  }

  withSymtableId(symtableId: number): this {
    this.symtableId = symtableId;
    return this;
  }

  withFlags(flags: {
    usesWildcardImport?: boolean;
    isGenerator?: boolean;
    isCoroutine?: boolean;
    declaresGlobal?: boolean;
    declaresNonlocal?: boolean;
  }): this {
    this.usesWildcardImport = flags.usesWildcardImport ?? this.usesWildcardImport;
    this.isGenerator = flags.isGenerator ?? this.isGenerator;
    this.isCoroutine = flags.isCoroutine ?? this.isCoroutine;
    this.declaresGlobal = flags.declaresGlobal ?? this.declaresGlobal;
    this.declaresNonlocal = flags.declaresNonlocal ?? this.declaresNonlocal;
    return this;
  }

  withEndPosition(endLine: number, endColumn: number): this {
    this.endLine = endLine;
    this.endColumn = endColumn;
    return this;
  }

  withScopeOrdinal(scopeOrdinal: number): this {
    this.scopeOrdinal = scopeOrdinal;
    return this;
  }

  build(): PyScopeRegistry {
    return new (PyScopeRegistry as unknown as {
      new (builder: PyScopeRegistryBuilder): PyScopeRegistry;
    })(this);
  }
}
