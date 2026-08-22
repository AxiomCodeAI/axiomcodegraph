import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonBlockKind } from '@/enums/python/blocks';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One block of statements — an `if` body, a `for` body, an `except` handler.
 *
 * Positions 0–16 mirror `java_block`, so a control-flow rule ports by relation
 * rename. Containment is by SPAN rather than by a link on each expression, which
 * is also how Java does it: an expression is inside a block when its span is,
 * and putting a block FK on every expression row would cost a column on the
 * largest relation to encode what the spans already say.
 *
 * The column that earns this relation its place is `conditionExpressionLinkHash`.
 * A narrowing guard is the single most valuable control-flow fact for
 * resolution:
 *
 * ```python
 * if isinstance(x, Foo):
 *     x.method()          # x is a Foo HERE, and only here
 * ```
 *
 * There are 2,123 `isinstance` sites in the measured corpus, each capable of
 * narrowing a receiver from a wide candidate fan to one. The FK points at the
 * already-parsed test, so an engine reads its operands from the expression tree
 * instead of re-parsing `conditionText`.
 *
 * `isTypeCheckingGuard` is the other one worth naming: 338 `if TYPE_CHECKING:`
 * blocks contain imports that exist for a type checker and never execute, so a
 * rule that treats them as runtime imports is wrong about every one.
 *
 * ## Column order (frozen — schema v7 §2.18, 27 columns)
 *
 * **PK** `PY_BLOCK_md5(filePath ‖ pyTypeLinkHash ‖ methodOwnerHash ‖ kind ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)`
 */
export class PyBlockRegistry implements EntityIdentifiable {
  private kind: PythonBlockKind;
  private order: number;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private nestingDepth: number;
  private pyTypeLinkHash: string;
  private methodOwnerHash: string;
  private parentContainerHash: string;
  private tryStatementHash: string;
  private resourceCount: string;
  private caughtExceptionTypes: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private ownerMethodName: string;
  private pyScopeLinkHash: string;
  private pyModuleLinkHash: string;
  private conditionExpressionLinkHash: string;
  private conditionText: string;
  private exceptTargetName: string;
  private hasElseClause: boolean;
  private isModuleLevel: boolean;
  private isTypeCheckingGuard: boolean;
  private serviceVersionLinkHash: string;
  private pyBlockUniqueHash: string = '';

  private constructor(builder: PyBlockRegistryBuilder) {
    this.kind = builder.kind;
    this.order = builder.order;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startColumn = builder.startColumn;
    this.endColumn = builder.endColumn;
    this.nestingDepth = builder.nestingDepth;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.methodOwnerHash = builder.methodOwnerHash;
    this.parentContainerHash = builder.parentContainerHash;
    this.tryStatementHash = builder.tryStatementHash;
    this.resourceCount = builder.resourceCount;
    this.caughtExceptionTypes = builder.caughtExceptionTypes;
    this.ownerTypeName = builder.ownerTypeName;
    this.ownerQualifiedName = builder.ownerQualifiedName;
    this.ownerMethodName = builder.ownerMethodName;
    this.pyScopeLinkHash = builder.pyScopeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.conditionExpressionLinkHash = builder.conditionExpressionLinkHash;
    this.conditionText = builder.conditionText;
    this.exceptTargetName = builder.exceptTargetName;
    this.hasElseClause = builder.hasElseClause;
    this.isModuleLevel = builder.isModuleLevel;
    this.isTypeCheckingGuard = builder.isTypeCheckingGuard;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    kind: PythonBlockKind,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    methodOwnerHash: string,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyBlockRegistryBuilder {
    return new PyBlockRegistryBuilder(
      kind,
      filePath,
      startLine,
      startColumn,
      endLine,
      endColumn,
      methodOwnerHash,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getKind(): PythonBlockKind {
    return this.kind;
  }

  getNestingDepth(): number {
    return this.nestingDepth;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getMethodOwnerHash(): string {
    return this.methodOwnerHash;
  }

  getParentContainerHash(): string {
    return this.parentContainerHash;
  }

  getTryStatementHash(): string {
    return this.tryStatementHash;
  }

  getConditionText(): string {
    return this.conditionText;
  }

  getIsTypeCheckingGuard(): boolean {
    return this.isTypeCheckingGuard;
  }

  getCaughtExceptionTypes(): string {
    return this.caughtExceptionTypes;
  }

  getConditionExpressionLinkHash(): string {
    return this.conditionExpressionLinkHash;
  }

  /** FK→`py_expression` — the `if`/`while` test, set once expressions exist. */
  setConditionExpressionLinkHash(conditionExpressionLinkHash: string): void {
    this.conditionExpressionLinkHash = conditionExpressionLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getHash(): string {
    return this.pyBlockUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.pyTypeLinkHash +
      '||' +
      this.methodOwnerHash +
      '||' +
      this.kind +
      '||' +
      this.startLine +
      '||' +
      this.startColumn +
      '||' +
      this.endLine +
      '||' +
      this.endColumn;

    this.pyBlockUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_BLOCK,
      content
    );
  }

  getEntryCombined(): string {
    return `py_block[kind=${this.kind}, depth=${this.nestingDepth}, lines=${this.startLine}-${this.endLine}, hash=${this.pyBlockUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      this.order,
      this.filePath,
      this.startLine,
      this.endLine,
      this.startColumn,
      this.endColumn,
      this.nestingDepth,
      this.pyTypeLinkHash,
      this.methodOwnerHash,
      this.parentContainerHash,
      this.tryStatementHash,
      this.resourceCount,
      this.caughtExceptionTypes,
      this.ownerTypeName,
      this.ownerQualifiedName,
      this.ownerMethodName,
      this.pyScopeLinkHash,
      this.pyModuleLinkHash,
      this.conditionExpressionLinkHash,
      EntityUtils.escapeTsv(this.conditionText),
      this.exceptTargetName,
      this.hasElseClause,
      this.isModuleLevel,
      this.isTypeCheckingGuard,
      this.serviceVersionLinkHash,
      this.pyBlockUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'kind',
      'order',
      'filePath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'nestingDepth',
      'pyTypeLinkHash',
      'methodOwnerHash',
      'parentContainerHash',
      'tryStatementHash',
      'resourceCount',
      'caughtExceptionTypes',
      'ownerTypeName',
      'ownerQualifiedName',
      'ownerMethodName',
      'pyScopeLinkHash',
      'pyModuleLinkHash',
      'conditionExpressionLinkHash',
      'conditionText',
      'exceptTargetName',
      'hasElseClause',
      'isModuleLevel',
      'isTypeCheckingGuard',
      'serviceVersionLinkHash',
      'pyBlockUniqueHash',
    ].join('\t');
  }
}

export class PyBlockRegistryBuilder {
  kind: PythonBlockKind;
  order: number = 0;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  nestingDepth: number = 0;
  pyTypeLinkHash: string = '';
  methodOwnerHash: string;
  parentContainerHash: string = '';
  tryStatementHash: string = '';
  resourceCount: string = '';
  caughtExceptionTypes: string = '';
  ownerTypeName: string = '';
  ownerQualifiedName: string = '';
  ownerMethodName: string = '';
  pyScopeLinkHash: string = '';
  pyModuleLinkHash: string;
  conditionExpressionLinkHash: string = '';
  conditionText: string = '';
  exceptTargetName: string = '';
  hasElseClause: boolean = false;
  isModuleLevel: boolean = false;
  isTypeCheckingGuard: boolean = false;
  serviceVersionLinkHash: string;

  constructor(
    kind: PythonBlockKind,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    methodOwnerHash: string,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    this.kind = kind;
    this.filePath = filePath;
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    this.methodOwnerHash = methodOwnerHash;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withOrder(order: number, nestingDepth: number): this {
    this.order = order;
    this.nestingDepth = nestingDepth;
    return this;
  }

  withOwner(
    pyTypeLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    ownerMethodName: string
  ): this {
    this.pyTypeLinkHash = pyTypeLinkHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.ownerMethodName = ownerMethodName;
    return this;
  }

  withContainer(parentContainerHash: string, pyScopeLinkHash: string): this {
    this.parentContainerHash = parentContainerHash;
    this.pyScopeLinkHash = pyScopeLinkHash;
    return this;
  }

  withTryStatement(tryStatementHash: string): this {
    this.tryStatementHash = tryStatementHash;
    return this;
  }

  withCondition(conditionText: string, isTypeCheckingGuard: boolean): this {
    this.conditionText = conditionText;
    this.isTypeCheckingGuard = isTypeCheckingGuard;
    return this;
  }

  withHandler(caughtExceptionTypes: string, exceptTargetName: string): this {
    this.caughtExceptionTypes = caughtExceptionTypes;
    this.exceptTargetName = exceptTargetName;
    return this;
  }

  withResourceCount(resourceCount: number): this {
    this.resourceCount = String(resourceCount);
    return this;
  }

  withFlags(hasElseClause: boolean, isModuleLevel: boolean): this {
    this.hasElseClause = hasElseClause;
    this.isModuleLevel = isModuleLevel;
    return this;
  }

  build(): PyBlockRegistry {
    return new (PyBlockRegistry as unknown as {
      new (builder: PyBlockRegistryBuilder): PyBlockRegistry;
    })(this);
  }
}
