import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  ExpressionKind,
  EdgeRole,
  RootContext,
  ExpressionOwnerKind,
  LiteralType,
  MethodReferenceKind,
  UnaryFixity,
  ReferencedEntityKind,
} from '@/enums/java/expressions';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents an expression node in a Java expression tree.
 *
 * ExpressionReference captures the structure and semantics of expressions in Java source code,
 * forming trees that can be analyzed for data flow, dependencies, and code patterns.
 *
 * ## Expression Tree Structure
 *
 * Expressions form trees where:
 * - **ROOT** is the outermost expression (depth 0, no parent)
 * - Children have increasing depth and reference their parent via parentExpressionHash
 * - Trees are stored "outside-in" (ROOT first, then children)
 *
 * ## Key Fields
 *
 * - **kind**: What type of expression (LITERAL, METHOD_INVOCATION, BINARY_EXPRESSION, etc.)
 * - **edgeRole**: Relationship to parent (ROOT, RECEIVER, LEFT_OPERAND, ARGUMENT, etc.)
 * - **rootContext**: Where this expression tree is rooted (FIELD_INITIALIZER, RETURN_VALUE, etc.)
 * - **expressionOwnerKind**: What kind of entity owns this expression tree
 *
 * ## Examples
 *
 * ```java
 * // Field initializer: "hello".toUpperCase()
 * // Tree structure:
 * //   ROOT: METHOD_INVOCATION (toUpperCase)
 * //     └─ RECEIVER: METHOD_INVOCATION (implicit receiver for String literal)
 * //          └─ RECEIVER: LITERAL "hello"
 *
 * private String greeting = "hello".toUpperCase();
 *
 * // Binary expression: 10 + 20
 * // Tree structure:
 * //   ROOT: BINARY_EXPRESSION (+)
 * //     ├─ LEFT_OPERAND: LITERAL 10
 * //     └─ RIGHT_OPERAND: LITERAL 20
 *
 * private int sum = 10 + 20;
 * ```
 */
export class ExpressionReference implements EntityIdentifiable {
  private typeRegistryLinkHash: string;
  private expressionOwnerHash: string;
  private expressionOwnerKind: ExpressionOwnerKind;
  private rootContext: RootContext;
  private kind: ExpressionKind;
  private edgeRole: EdgeRole;
  private parentExpressionHash?: string;
  private position: number;
  private depth: number;
  private literalType?: LiteralType;
  private literalValue?: string;
  private methodReferenceKind?: MethodReferenceKind;
  private unaryFixity?: UnaryFixity;
  private operatorString?: string;
  private referencedEntityKind?: ReferencedEntityKind;
  private referencedEntityHash?: string;
  private anonymousTypeHash?: string;
  private potentialQualifiedName?: string;
  private isAmbiguous?: boolean;
  private returnStatementIndex?: number;
  private startLine?: number;
  private startColumn?: number;
  private endLine?: number;
  private endColumn?: number;
  private expressionUniqueHash: string = '';

  constructor(builder: ExpressionReferenceBuilder) {
    this.typeRegistryLinkHash = builder.typeRegistryLinkHash;
    this.expressionOwnerHash = builder.expressionOwnerHash;
    this.expressionOwnerKind = builder.expressionOwnerKind;
    this.rootContext = builder.rootContext;
    this.kind = builder.kind;
    this.edgeRole = builder.edgeRole;
    this.parentExpressionHash = builder.parentExpressionHash;
    this.position = builder.position;
    this.depth = builder.depth;
    this.literalType = builder.literalType;
    this.literalValue = builder.literalValue;
    this.methodReferenceKind = builder.methodReferenceKind;
    this.unaryFixity = builder.unaryFixity;
    this.operatorString = builder.operatorString;
    this.referencedEntityKind = builder.referencedEntityKind;
    this.referencedEntityHash = builder.referencedEntityHash;
    this.anonymousTypeHash = builder.anonymousTypeHash;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.returnStatementIndex = builder.returnStatementIndex;
    this.startLine = builder.startLine;
    this.startColumn = builder.startColumn;
    this.endLine = builder.endLine;
    this.endColumn = builder.endColumn;
  }

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getExpressionOwnerHash(): string {
    return this.expressionOwnerHash;
  }

  getExpressionOwnerKind(): ExpressionOwnerKind {
    return this.expressionOwnerKind;
  }

  getRootContext(): RootContext {
    return this.rootContext;
  }

  getKind(): ExpressionKind {
    return this.kind;
  }

  getEdgeRole(): EdgeRole {
    return this.edgeRole;
  }

  getParentExpressionHash(): string | undefined {
    return this.parentExpressionHash;
  }

  getPosition(): number {
    return this.position;
  }

  getDepth(): number {
    return this.depth;
  }

  getLiteralType(): LiteralType | undefined {
    return this.literalType;
  }

  getLiteralValue(): string | undefined {
    return this.literalValue;
  }

  getMethodReferenceKind(): MethodReferenceKind | undefined {
    return this.methodReferenceKind;
  }

  getUnaryFixity(): UnaryFixity | undefined {
    return this.unaryFixity;
  }

  getOperatorString(): string | undefined {
    return this.operatorString;
  }

  getReferencedEntityKind(): ReferencedEntityKind | undefined {
    return this.referencedEntityKind;
  }

  getReferencedEntityHash(): string | undefined {
    return this.referencedEntityHash;
  }

  getAnonymousTypeHash(): string | undefined {
    return this.anonymousTypeHash;
  }

  getPotentialQualifiedName(): string | undefined {
    return this.potentialQualifiedName;
  }

  getIsAmbiguous(): boolean | undefined {
    return this.isAmbiguous;
  }

  getReturnStatementIndex(): number | undefined {
    return this.returnStatementIndex;
  }

  getStartLine(): number | undefined {
    return this.startLine;
  }

  getStartColumn(): number | undefined {
    return this.startColumn;
  }

  getEndLine(): number | undefined {
    return this.endLine;
  }

  getEndColumn(): number | undefined {
    return this.endColumn;
  }

  getExpressionUniqueHash(): string {
    return this.expressionUniqueHash;
  }

  getHash(): string {
    return this.expressionUniqueHash;
  }

  generateHash(): void {
    const content =
      this.typeRegistryLinkHash +
      '||' +
      this.expressionOwnerHash +
      '||' +
      this.expressionOwnerKind +
      '||' +
      this.rootContext +
      '||' +
      this.kind +
      '||' +
      this.edgeRole +
      '||' +
      (this.parentExpressionHash ? this.parentExpressionHash + '||' : '') +
      this.position +
      '||' +
      this.depth +
      '||' +
      (this.literalType ? this.literalType + '||' : '') +
      (this.literalValue !== undefined ? this.literalValue + '||' : '') +
      (this.methodReferenceKind ? this.methodReferenceKind + '||' : '') +
      (this.unaryFixity ? this.unaryFixity + '||' : '') +
      (this.operatorString ? this.operatorString + '||' : '') +
      (this.referencedEntityKind ? this.referencedEntityKind + '||' : '') +
      (this.referencedEntityHash ? this.referencedEntityHash + '||' : '') +
      (this.anonymousTypeHash ? this.anonymousTypeHash + '||' : '') +
      (this.startLine !== undefined ? this.startLine + '||' : '') +
      (this.startColumn !== undefined ? this.startColumn + '||' : '') +
      (this.endLine !== undefined ? this.endLine + '||' : '') +
      (this.endColumn !== undefined ? this.endColumn : '');

    this.expressionUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.EXPRESSION_REFERENCE,
      content
    );
  }

  getEntryCombined(): string {
    const kindInfo = this.kind.toString();
    const roleInfo = this.edgeRole.toString();
    const contextInfo = this.rootContext.toString();

    const locationInfo =
      this.startLine !== undefined && this.endLine !== undefined
        ? `lines ${this.startLine}-${this.endLine}`
        : 'location unknown';

    const detailInfo = this.literalType
      ? `literal=${this.literalType}:${this.literalValue}`
      : this.operatorString
        ? `op=${this.operatorString}`
        : this.referencedEntityKind
          ? `ref=${this.referencedEntityKind}`
          : '';

    return `java_expression[kind=${kindInfo}, role=${roleInfo}, context=${contextInfo}, owner=${this.expressionOwnerKind}, depth=${this.depth}, pos=${this.position}, ${detailInfo ? detailInfo + ', ' : ''}${locationInfo}, hash=${this.expressionUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      this.edgeRole,
      this.rootContext,
      this.expressionOwnerKind,
      this.typeRegistryLinkHash,
      this.expressionOwnerHash,
      this.parentExpressionHash || '',
      this.position.toString(),
      this.depth.toString(),
      this.literalType || '',
      this.literalValue !== undefined ? EntityUtils.escapeTsv(this.literalValue) : '',
      this.methodReferenceKind || '',
      this.unaryFixity || '',
      this.operatorString || '',
      this.referencedEntityKind || '',
      this.referencedEntityHash || '',
      this.anonymousTypeHash || '',
      EntityUtils.escapeTsv(this.potentialQualifiedName || ''),
      this.isAmbiguous !== undefined ? this.isAmbiguous.toString() : '',
      this.returnStatementIndex !== undefined ? this.returnStatementIndex.toString() : '',
      this.startLine !== undefined ? this.startLine.toString() : '',
      this.startColumn !== undefined ? this.startColumn.toString() : '',
      this.endLine !== undefined ? this.endLine.toString() : '',
      this.endColumn !== undefined ? this.endColumn.toString() : '',
      this.expressionUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'kind',
      'edgeRole',
      'rootContext',
      'expressionOwnerKind',
      'typeRegistryLinkHash',
      'expressionOwnerHash',
      'parentExpressionHash',
      'position',
      'depth',
      'literalType',
      'literalValue',
      'methodReferenceKind',
      'unaryFixity',
      'operatorString',
      'referencedEntityKind',
      'referencedEntityHash',
      'anonymousTypeHash',
      'potentialQualifiedName',
      'isAmbiguous',
      'returnStatementIndex',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
      'expressionUniqueHash',
    ].join('\t');
  }

  static builder(
    typeRegistryLinkHash: string,
    expressionOwnerHash: string,
    expressionOwnerKind: ExpressionOwnerKind,
    rootContext: RootContext,
    kind: ExpressionKind,
    edgeRole: EdgeRole
  ): ExpressionReferenceBuilder {
    return new ExpressionReferenceBuilder(
      typeRegistryLinkHash,
      expressionOwnerHash,
      expressionOwnerKind,
      rootContext,
      kind,
      edgeRole
    );
  }
}

/**
 * Builder for ExpressionReference with comprehensive validation.
 */
export class ExpressionReferenceBuilder {
  typeRegistryLinkHash: string;
  expressionOwnerHash: string;
  expressionOwnerKind: ExpressionOwnerKind;
  rootContext: RootContext;
  kind: ExpressionKind;
  edgeRole: EdgeRole;
  parentExpressionHash?: string;
  position: number = 0;
  depth: number = 0;
  literalType?: LiteralType;
  literalValue?: string;
  methodReferenceKind?: MethodReferenceKind;
  unaryFixity?: UnaryFixity;
  operatorString?: string;
  referencedEntityKind?: ReferencedEntityKind;
  referencedEntityHash?: string;
  anonymousTypeHash?: string;
  potentialQualifiedName?: string;
  isAmbiguous?: boolean;
  returnStatementIndex?: number;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;

  constructor(
    typeRegistryLinkHash: string,
    expressionOwnerHash: string,
    expressionOwnerKind: ExpressionOwnerKind,
    rootContext: RootContext,
    kind: ExpressionKind,
    edgeRole: EdgeRole
  ) {
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.expressionOwnerHash = expressionOwnerHash;
    this.expressionOwnerKind = expressionOwnerKind;
    this.rootContext = rootContext;
    this.kind = kind;
    this.edgeRole = edgeRole;
  }

  parent(hash: string): this {
    this.parentExpressionHash = hash;
    return this;
  }

  positionAndDepth(position: number, depth: number): this {
    this.position = position;
    this.depth = depth;
    return this;
  }

  literal(type: LiteralType, value: string): this {
    this.literalType = type;
    this.literalValue = value;
    return this;
  }

  classLiteralTypeName(typeName: string): this {
    this.literalValue = typeName;
    return this;
  }

  qualifiedName(potentialQualifiedName: string, isAmbiguous: boolean): this {
    this.potentialQualifiedName = potentialQualifiedName;
    this.isAmbiguous = isAmbiguous;
    return this;
  }

  returnIndex(index: number): this {
    this.returnStatementIndex = index;
    return this;
  }

  methodReference(kind: MethodReferenceKind): this {
    this.methodReferenceKind = kind;
    return this;
  }

  unary(fixity: UnaryFixity): this {
    this.unaryFixity = fixity;
    return this;
  }

  operator(op: string): this {
    this.operatorString = op;
    return this;
  }

  referencesEntity(kind: ReferencedEntityKind, hash?: string): this {
    this.referencedEntityKind = kind;
    this.referencedEntityHash = hash;
    return this;
  }

  anonymousType(hash: string): this {
    this.anonymousTypeHash = hash;
    return this;
  }

  location(startLine: number, startColumn: number, endLine: number, endColumn: number): this {
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    return this;
  }

  build(): ExpressionReference {
    this.validate();
    const ref = new ExpressionReference(this);
    ref.generateHash();
    return ref;
  }

  private validate(): void {
    this.validateRequiredFields();
    this.validateTreeStructure();
    this.validateKindRequirements();
    this.validateEdgeRoleRequirements();
  }

  private validateRequiredFields(): void {
    if (!this.typeRegistryLinkHash || this.typeRegistryLinkHash.trim().length === 0) {
      throw new Error('typeRegistryLinkHash is required');
    }
    if (!this.expressionOwnerHash || this.expressionOwnerHash.trim().length === 0) {
      throw new Error('expressionOwnerHash is required');
    }
    if (!this.expressionOwnerKind) {
      throw new Error('expressionOwnerKind is required');
    }
    if (!this.rootContext) {
      throw new Error('rootContext is required');
    }
    if (!this.kind) {
      throw new Error('kind is required');
    }
    if (!this.edgeRole) {
      throw new Error('edgeRole is required');
    }
  }

  private validateTreeStructure(): void {
    if (this.edgeRole === EdgeRole.ROOT) {
      if (this.parentExpressionHash) {
        throw new Error('ROOT expressions cannot have a parent');
      }
      if (this.depth !== 0) {
        throw new Error('ROOT expressions must have depth = 0');
      }
    } else {
      if (!this.parentExpressionHash) {
        throw new Error('Non-ROOT expressions must have a parent');
      }
      if (this.depth === 0) {
        throw new Error('Non-ROOT expressions must have depth > 0');
      }
    }
  }

  private validateKindRequirements(): void {
    switch (this.kind) {
      case ExpressionKind.LITERAL:
        if (!this.literalType) {
          throw new Error('LITERAL expressions require literalType');
        }
        if (this.literalValue === undefined) {
          throw new Error('LITERAL expressions require literalValue');
        }
        break;

      case ExpressionKind.METHOD_REFERENCE:
        if (!this.methodReferenceKind) {
          throw new Error('METHOD_REFERENCE expressions require methodReferenceKind');
        }
        break;

      case ExpressionKind.UNARY_EXPRESSION:
        if (!this.unaryFixity) {
          throw new Error('UNARY_EXPRESSION requires unaryFixity');
        }
        if (!this.operatorString) {
          throw new Error('UNARY_EXPRESSION requires operatorString');
        }
        break;

      case ExpressionKind.BINARY_EXPRESSION:
        if (!this.operatorString) {
          throw new Error('BINARY_EXPRESSION requires operatorString');
        }
        break;

      case ExpressionKind.ASSIGNMENT_EXPRESSION:
      case ExpressionKind.COMPOUND_ASSIGNMENT:
        if (!this.operatorString) {
          throw new Error(`${this.kind} requires operatorString (=, +=, etc.)`);
        }
        break;

      case ExpressionKind.ANONYMOUS_CLASS_CREATION:
        if (!this.anonymousTypeHash) {
          throw new Error('ANONYMOUS_CLASS_CREATION requires anonymousTypeHash');
        }
        break;

      // IDENTIFIER_REFERENCE is intentionally excluded - it's ambiguous at extraction time
      // and cannot be resolved to TYPE vs FIELD without semantic analysis
      case ExpressionKind.FIELD_ACCESS:
      case ExpressionKind.METHOD_INVOCATION:
      case ExpressionKind.CONSTRUCTOR_INVOCATION:
        if (!this.referencedEntityKind) {
          throw new Error(`${this.kind} requires referencedEntityKind`);
        }
        break;
    }
  }

  private validateEdgeRoleRequirements(): void {
    switch (this.edgeRole) {
      case EdgeRole.ARGUMENT:
      case EdgeRole.ARRAY_ELEMENT:
      case EdgeRole.ARRAY_DIMENSION:
      case EdgeRole.SWITCH_CASE_LABEL:
        if (this.position < 0) {
          throw new Error(`${this.edgeRole} requires non-negative position`);
        }
        break;
    }
  }
}
