import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  PythonComprehensionKind,
  PythonEdgeRole,
  PythonExpressionKind,
  PythonExpressionOwnerKind,
  PythonLiteralType,
  PythonNameContext,
  PythonReferencedEntityKind,
  PythonRootContext,
  PythonUnaryFixity,
} from '@/enums/python/expressions';
import {
  PythonInferenceConfidence,
  PythonInferenceEvidence,
  PythonInferredTypeKind,
} from '@/enums/python/inference';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents one node in a Python expression tree.
 *
 * **Positions 0–23 mirror `java_expression` 0–23**, so `expressions.dl` ports by
 * moving the hash index and adding placeholders.
 *
 * ## The one column that matters most: `pyScopeLinkHash`
 *
 * Java resolves a name by file. Python resolves it by walking a **scope chain**,
 * so an expression without its scope is unresolvable. This column is what
 * connects a bare-name receiver — 50.7% of attribute calls — to the binding that
 * tells you what it holds. `bindingLinkHash` then carries the resolution itself.
 *
 * ## `argumentKeywordName` exists because positional linking loses 12,000 args
 *
 * With 68.2% of parameters unannotated, argument→parameter flow is the primary
 * typing mechanism, and 12,000 measured arguments are passed by keyword. Linking
 * only by position silently drops every one of them.
 *
 * ## Examples
 *
 * ```python
 * self.repo.get_user(uid, force=True)
 * # CALL                     edgeRole=ROOT
 * #   ATTRIBUTE_ACCESS       edgeRole=RECEIVER, dottedPath="self.repo.get_user"
 * #     ATTRIBUTE_ACCESS     edgeRole=ATTRIBUTE_OBJECT
 * #       NAME_REFERENCE     literalValue="self", kind SELF_REFERENCE
 * #   NAME_REFERENCE         edgeRole=ARGUMENT, position=0
 * #   LITERAL                edgeRole=KEYWORD_ARGUMENT, argumentKeywordName="force"
 * ```
 *
 * ## Column order (frozen — schema v6 §2.15, 35 columns)
 *
 * **PK** `PY_EXPRESSION_md5(pyScopeLinkHash ‖ expressionOwnerHash ‖
 * expressionOwnerKind ‖ rootContext ‖ kind ‖ edgeRole ‖ parentExpressionHash ‖
 * position ‖ depth ‖ literalValue ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)`
 *
 * The full span is in the key, not just the start offset. `startIndex` alone
 * collides for nested calls such as `super().f()` and for repeated targets in
 * one statement, so node identity is the **byte range**.
 */
export class PyExpressionRegistry implements EntityIdentifiable {
  private kind: PythonExpressionKind;
  private edgeRole: PythonEdgeRole;
  private rootContext: PythonRootContext;
  private expressionOwnerKind: PythonExpressionOwnerKind;
  private pyTypeLinkHash: string;
  private expressionOwnerHash: string;
  private parentExpressionHash: string;
  private position: number;
  private depth: number;
  private literalType: string;
  private literalValue: string;
  private comprehensionKind: PythonComprehensionKind;
  private unaryFixity: PythonUnaryFixity;
  private operatorString: string;
  private referencedEntityKind: PythonReferencedEntityKind;
  private referencedEntityHash: string;
  private lambdaScopeHash: string;
  private potentialQualifiedName: string;
  private isAmbiguous: boolean;
  private returnStatementIndex: string;
  private startLine: number;
  private startColumn: number;
  private endLine: number;
  private endColumn: number;
  private pyScopeLinkHash: string;
  private pyModuleLinkHash: string;
  private bindingLinkHash: string;
  private nameContext: PythonNameContext;
  private isWrite: boolean;
  private argumentKeywordName: string;
  private isAwaited: boolean;
  private isStarred: boolean;
  private dottedPath: string;
  private inferredTypeName: string;
  private inferredTypeKind: PythonInferredTypeKind;
  private inferenceEvidence: PythonInferenceEvidence;
  private inferenceConfidence: PythonInferenceConfidence;
  private serviceVersionLinkHash: string;
  private pyExpressionUniqueHash: string = '';

  private constructor(builder: PyExpressionRegistryBuilder) {
    this.kind = builder.kind;
    this.edgeRole = builder.edgeRole;
    this.rootContext = builder.rootContext;
    this.expressionOwnerKind = builder.expressionOwnerKind;
    this.pyTypeLinkHash = builder.pyTypeLinkHash;
    this.expressionOwnerHash = builder.expressionOwnerHash;
    this.parentExpressionHash = builder.parentExpressionHash;
    this.position = builder.position;
    this.depth = builder.depth;
    this.literalType = builder.literalType;
    this.literalValue = builder.literalValue;
    this.comprehensionKind = builder.comprehensionKind;
    this.unaryFixity = builder.unaryFixity;
    this.operatorString = builder.operatorString;
    this.referencedEntityKind = builder.referencedEntityKind;
    this.referencedEntityHash = builder.referencedEntityHash;
    this.lambdaScopeHash = builder.lambdaScopeHash;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.returnStatementIndex = builder.returnStatementIndex;
    this.startLine = builder.startLine;
    this.startColumn = builder.startColumn;
    this.endLine = builder.endLine;
    this.endColumn = builder.endColumn;
    this.pyScopeLinkHash = builder.pyScopeLinkHash;
    this.pyModuleLinkHash = builder.pyModuleLinkHash;
    this.bindingLinkHash = builder.bindingLinkHash;
    this.nameContext = builder.nameContext;
    this.isWrite = builder.nameContext !== PythonNameContext.LOAD;
    this.argumentKeywordName = builder.argumentKeywordName;
    this.isAwaited = builder.isAwaited;
    this.isStarred = builder.isStarred;
    this.dottedPath = builder.dottedPath;
    this.inferredTypeName = builder.inferredTypeName;
    this.inferredTypeKind = builder.inferredTypeKind;
    this.inferenceEvidence = builder.inferenceEvidence;
    this.inferenceConfidence = builder.inferenceConfidence;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    kind: PythonExpressionKind,
    edgeRole: PythonEdgeRole,
    rootContext: PythonRootContext,
    expressionOwnerKind: PythonExpressionOwnerKind,
    expressionOwnerHash: string,
    pyScopeLinkHash: string,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ): PyExpressionRegistryBuilder {
    return new PyExpressionRegistryBuilder(
      kind,
      edgeRole,
      rootContext,
      expressionOwnerKind,
      expressionOwnerHash,
      pyScopeLinkHash,
      pyModuleLinkHash,
      serviceVersionLinkHash
    );
  }

  getKind(): PythonExpressionKind {
    return this.kind;
  }

  getEdgeRole(): PythonEdgeRole {
    return this.edgeRole;
  }

  /** The name slot: callee name, attribute name, identifier, or literal text. */
  getLiteralValue(): string {
    return this.literalValue;
  }

  getPosition(): number {
    return this.position;
  }

  getDepth(): number {
    return this.depth;
  }

  getPyScopeLinkHash(): string {
    return this.pyScopeLinkHash;
  }

  getParentExpressionHash(): string {
    return this.parentExpressionHash;
  }

  /** FK→`py_type` — the class this expression sits inside, if any. */
  getPyTypeLinkHash(): string {
    return this.pyTypeLinkHash;
  }

  /** True when this node is an assignment or deletion TARGET, not a read. */
  getIsWrite(): boolean {
    return this.isWrite;
  }

  getIsAwaited(): boolean {
    return this.isAwaited;
  }

  /** `*x` / `**x` in a call or a literal. */
  getIsStarred(): boolean {
    return this.isStarred;
  }

  getDottedPath(): string {
    return this.dottedPath;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getStartColumn(): number {
    return this.startColumn;
  }

  getEndLine(): number {
    return this.endLine;
  }

  /**
   * The end column, in UTF-8 bytes.
   *
   * With `startColumn` it makes the BYTE RANGE, which is what identifies a node.
   * A start offset alone collides: in `super().f()` the outer call and the inner
   * `super()` share a start, so anything keyed on the start conflates them.
   */
  getEndColumn(): number {
    return this.endColumn;
  }

  getNameContext(): PythonNameContext {
    return this.nameContext;
  }

  getReferencedEntityKind(): PythonReferencedEntityKind {
    return this.referencedEntityKind;
  }

  getReferencedEntityHash(): string {
    return this.referencedEntityHash;
  }

  /** FK→the METHOD/TYPE that owns this expression, per `expressionOwnerKind`. */
  getExpressionOwnerHash(): string {
    return this.expressionOwnerHash;
  }

  getRootContext(): PythonRootContext {
    return this.rootContext;
  }

  getArgumentKeywordName(): string {
    return this.argumentKeywordName;
  }

  /** Back-patches the binding FK once name resolution has run. */
  /** FK→`py_binding` — the binding this name reference resolves to. */
  getBindingLinkHash(): string {
    return this.bindingLinkHash;
  }

  setBindingLinkHash(bindingLinkHash: string): void {
    this.bindingLinkHash = bindingLinkHash;
  }

  /** Back-patches the resolved-entity FK. */
  setReferencedEntity(
    referencedEntityKind: PythonReferencedEntityKind,
    referencedEntityHash: string
  ): void {
    this.referencedEntityKind = referencedEntityKind;
    this.referencedEntityHash = referencedEntityHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  /**
   * The type of THIS node, when the syntax alone settles it.
   *
   * Folded in from the deleted `py_type_inference` relation (schema v7 §2.21):
   * every inference a PARSER may make is 1:1 with one node, so it is a column,
   * not a relation. `x = 3; x = "hi"` is two singly-typed nodes, and the union is
   * a join over the binding rather than something to store.
   */
  getInferredTypeName(): string {
    return this.inferredTypeName;
  }

  getInferredTypeKind(): PythonInferredTypeKind {
    return this.inferredTypeKind;
  }

  /** The syntactic ground for the claim — the parser/engine tier boundary. */
  getInferenceEvidence(): PythonInferenceEvidence {
    return this.inferenceEvidence;
  }

  getInferenceConfidence(): PythonInferenceConfidence {
    return this.inferenceConfidence;
  }

  /**
   * Records a type derived after the row was minted.
   *
   * Annotation-based inference needs the resolved type reference, which does not
   * exist during the expression walk. None of these four columns is in the PK, so
   * patching one changes no hash.
   */
  setInference(
    inferredTypeName: string,
    inferredTypeKind: PythonInferredTypeKind,
    inferenceEvidence: PythonInferenceEvidence,
    inferenceConfidence: PythonInferenceConfidence
  ): void {
    this.inferredTypeName = inferredTypeName;
    this.inferredTypeKind = inferredTypeKind;
    this.inferenceEvidence = inferenceEvidence;
    this.inferenceConfidence = inferenceConfidence;
  }

  getPyExpressionUniqueHash(): string {
    return this.pyExpressionUniqueHash;
  }

  getHash(): string {
    return this.pyExpressionUniqueHash;
  }

  generateHash(): void {
    const content = [
      this.pyScopeLinkHash,
      this.expressionOwnerHash,
      this.expressionOwnerKind,
      this.rootContext,
      this.kind,
      this.edgeRole,
      this.parentExpressionHash,
      this.position,
      this.depth,
      this.literalValue,
      this.startLine,
      this.startColumn,
      this.endLine,
      this.endColumn,
    ].join('||');

    this.pyExpressionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_EXPRESSION,
      content
    );
  }

  getEntryCombined(): string {
    return `py_expression[kind=${this.kind}, role=${this.edgeRole}, value=${this.literalValue}, ${this.startLine}:${this.startColumn}-${this.endLine}:${this.endColumn}, hash=${this.pyExpressionUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      this.edgeRole,
      this.rootContext,
      this.expressionOwnerKind,
      this.pyTypeLinkHash,
      this.expressionOwnerHash,
      this.parentExpressionHash,
      this.position.toString(),
      this.depth.toString(),
      this.literalType,
      EntityUtils.escapeTsv(this.literalValue),
      this.comprehensionKind,
      this.unaryFixity,
      EntityUtils.escapeTsv(this.operatorString),
      this.referencedEntityKind,
      this.referencedEntityHash,
      this.lambdaScopeHash,
      EntityUtils.escapeTsv(this.potentialQualifiedName),
      this.isAmbiguous.toString(),
      this.returnStatementIndex,
      this.startLine.toString(),
      this.startColumn.toString(),
      this.endLine.toString(),
      this.endColumn.toString(),
      this.pyScopeLinkHash,
      this.pyModuleLinkHash,
      this.bindingLinkHash,
      this.nameContext,
      this.isWrite.toString(),
      this.argumentKeywordName,
      this.isAwaited.toString(),
      this.isStarred.toString(),
      EntityUtils.escapeTsv(this.dottedPath),
      this.inferredTypeName,
      this.inferredTypeKind,
      this.inferenceEvidence,
      this.inferenceConfidence,
      this.serviceVersionLinkHash,
      this.pyExpressionUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'kind',
      'edgeRole',
      'rootContext',
      'expressionOwnerKind',
      'pyTypeLinkHash',
      'expressionOwnerHash',
      'parentExpressionHash',
      'position',
      'depth',
      'literalType',
      'literalValue',
      'comprehensionKind',
      'unaryFixity',
      'operatorString',
      'referencedEntityKind',
      'referencedEntityHash',
      'lambdaScopeHash',
      'potentialQualifiedName',
      'isAmbiguous',
      'returnStatementIndex',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
      'pyScopeLinkHash',
      'pyModuleLinkHash',
      'bindingLinkHash',
      'nameContext',
      'isWrite',
      'argumentKeywordName',
      'isAwaited',
      'isStarred',
      'dottedPath',
      'inferredTypeName',
      'inferredTypeKind',
      'inferenceEvidence',
      'inferenceConfidence',
      'serviceVersionLinkHash',
      'pyExpressionUniqueHash',
    ].join('\t');
  }
}

/** Builder for PyExpressionRegistry. */
export class PyExpressionRegistryBuilder {
  kind: PythonExpressionKind;
  edgeRole: PythonEdgeRole;
  rootContext: PythonRootContext;
  expressionOwnerKind: PythonExpressionOwnerKind;
  pyTypeLinkHash: string = '';
  expressionOwnerHash: string;
  parentExpressionHash: string = '';
  position: number = 0;
  depth: number = 0;
  literalType: string = '';
  literalValue: string = '';
  comprehensionKind: PythonComprehensionKind = PythonComprehensionKind.NONE;
  unaryFixity: PythonUnaryFixity = PythonUnaryFixity.NONE;
  operatorString: string = '';
  referencedEntityKind: PythonReferencedEntityKind = PythonReferencedEntityKind.UNKNOWN;
  referencedEntityHash: string = '';
  lambdaScopeHash: string = '';
  potentialQualifiedName: string = '';
  isAmbiguous: boolean = false;
  returnStatementIndex: string = '';
  startLine: number = 0;
  startColumn: number = 0;
  endLine: number = 0;
  endColumn: number = 0;
  pyScopeLinkHash: string;
  pyModuleLinkHash: string;
  bindingLinkHash: string = '';
  nameContext: PythonNameContext = PythonNameContext.LOAD;
  argumentKeywordName: string = '';
  isAwaited: boolean = false;
  isStarred: boolean = false;
  dottedPath: string = '';
  inferredTypeName: string = '';
  inferredTypeKind: PythonInferredTypeKind = PythonInferredTypeKind.UNKNOWN;
  inferenceEvidence: PythonInferenceEvidence = PythonInferenceEvidence.NONE;
  inferenceConfidence: PythonInferenceConfidence = PythonInferenceConfidence.NONE;
  serviceVersionLinkHash: string;

  constructor(
    kind: PythonExpressionKind,
    edgeRole: PythonEdgeRole,
    rootContext: PythonRootContext,
    expressionOwnerKind: PythonExpressionOwnerKind,
    expressionOwnerHash: string,
    pyScopeLinkHash: string,
    pyModuleLinkHash: string,
    serviceVersionLinkHash: string
  ) {
    if (!expressionOwnerHash || expressionOwnerHash.trim().length === 0) {
      throw new Error('expressionOwnerHash is required');
    }
    if (!pyScopeLinkHash || pyScopeLinkHash.trim().length === 0) {
      throw new Error('pyScopeLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }

    this.kind = kind;
    this.edgeRole = edgeRole;
    this.rootContext = rootContext;
    this.expressionOwnerKind = expressionOwnerKind;
    this.expressionOwnerHash = expressionOwnerHash;
    this.pyScopeLinkHash = pyScopeLinkHash;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withParent(parentExpressionHash: string, position: number, depth: number): this {
    this.parentExpressionHash = parentExpressionHash;
    this.position = position;
    this.depth = depth;
    return this;
  }

  withSpan(startLine: number, startColumn: number, endLine: number, endColumn: number): this {
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    return this;
  }

  withLiteral(literalType: PythonLiteralType, literalValue: string): this {
    this.literalType = literalType;
    this.literalValue = literalValue;
    return this;
  }

  /** The name slot — used for callee, attribute and identifier names. */
  withName(literalValue: string): this {
    this.literalValue = literalValue;
    return this;
  }

  withOperator(operatorString: string, unaryFixity: PythonUnaryFixity): this {
    this.operatorString = operatorString;
    this.unaryFixity = unaryFixity;
    return this;
  }

  withComprehensionKind(comprehensionKind: PythonComprehensionKind): this {
    this.comprehensionKind = comprehensionKind;
    return this;
  }

  withPyTypeLinkHash(pyTypeLinkHash: string): this {
    this.pyTypeLinkHash = pyTypeLinkHash;
    return this;
  }

  /** The scope a lambda or comprehension node introduces. */
  withLambdaScopeHash(lambdaScopeHash: string): this {
    this.lambdaScopeHash = lambdaScopeHash;
    return this;
  }

  withReferencedEntity(
    referencedEntityKind: PythonReferencedEntityKind,
    referencedEntityHash: string
  ): this {
    this.referencedEntityKind = referencedEntityKind;
    this.referencedEntityHash = referencedEntityHash;
    return this;
  }

  withBindingLinkHash(bindingLinkHash: string): this {
    this.bindingLinkHash = bindingLinkHash;
    return this;
  }

  withNameContext(nameContext: PythonNameContext): this {
    this.nameContext = nameContext;
    return this;
  }

  withArgumentKeywordName(argumentKeywordName: string): this {
    this.argumentKeywordName = argumentKeywordName;
    return this;
  }

  withFlags(flags: { isAwaited?: boolean; isStarred?: boolean }): this {
    this.isAwaited = flags.isAwaited ?? this.isAwaited;
    this.isStarred = flags.isStarred ?? this.isStarred;
    return this;
  }

  withDottedPath(dottedPath: string): this {
    this.dottedPath = dottedPath;
    return this;
  }

  /** Sets the four inference columns (schema v7 §2.15 c33-c36). */
  withInference(
    inferredTypeName: string,
    inferredTypeKind: PythonInferredTypeKind,
    inferenceEvidence: PythonInferenceEvidence,
    inferenceConfidence: PythonInferenceConfidence
  ): this {
    this.inferredTypeName = inferredTypeName;
    this.inferredTypeKind = inferredTypeKind;
    this.inferenceEvidence = inferenceEvidence;
    this.inferenceConfidence = inferenceConfidence;
    return this;
  }

  withReturnStatementIndex(returnStatementIndex: number): this {
    this.returnStatementIndex = returnStatementIndex.toString();
    return this;
  }

  build(): PyExpressionRegistry {
    return new (PyExpressionRegistry as unknown as {
      new (builder: PyExpressionRegistryBuilder): PyExpressionRegistry;
    })(this);
  }
}
