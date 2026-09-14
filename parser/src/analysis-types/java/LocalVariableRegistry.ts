import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { LocalVariableScopeKind } from '@/enums/java/local-variables';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a local variable declaration in Java source code.
 *
 * LocalVariableRegistry captures local variable declarations across the codebase, including:
 * - Method body variables
 * - Constructor body variables
 * - Lambda body variables (including nested lambdas)
 * - Static/instance initializer block variables
 * - Loop variables (for, enhanced-for)
 * - Try-with-resources variables
 * - Catch clause exception variables
 * - Pattern binding variables (instanceof, switch, record patterns)
 *
 * ## Examples
 *
 * ```java
 * public class Example {
 *     static {
 *         int staticBlockVar = 10;  // STATIC_INITIALIZER scope
 *     }
 *
 *     public void method(String param) {
 *         // Basic declarations
 *         int count = 42;                    // METHOD_BODY scope
 *         final String name = "test";        // METHOD_BODY, isFinal=true
 *         var inferred = new ArrayList<>();  // METHOD_BODY, isVarInferred=true
 *
 *         // Lambda with nested scopes
 *         Supplier<Integer> s = () -> {
 *             int lambdaVar = 5;             // LAMBDA_BODY, scopeDepth=1
 *             return (() -> {
 *                 int nested = 10;           // LAMBDA_BODY, scopeDepth=2
 *                 return nested;
 *             }).get();
 *         };
 *
 *         // Loop variables
 *         for (int i = 0; i < 10; i++) {     // FOR_LOOP scope
 *             int loopBody = i * 2;          // METHOD_BODY (inside loop)
 *         }
 *
 *         for (String item : items) {        // ENHANCED_FOR_LOOP scope
 *             String processed = item.trim(); // METHOD_BODY (inside loop)
 *         }
 *
 *         // Exception handling
 *         try (var reader = getReader()) {   // TRY_WITH_RESOURCES scope
 *             String line = reader.readLine();
 *         } catch (IOException e) {          // CATCH_CLAUSE scope
 *             String msg = e.getMessage();
 *         }
 *
 *         // Pattern matching (Java 16+)
 *         if (obj instanceof String s) {     // INSTANCEOF_PATTERN scope
 *             int len = s.length();
 *         }
 *     }
 * }
 * ```
 *
 * ## Type Information
 *
 * - **variableTypeName**: The full type as written in source (e.g., "List<String>")
 * - **variableBaseType**: Base type without generics (e.g., "List")
 * - **potentialQualifiedName**: Resolved qualified name (e.g., "java.util.List")
 * - **isAmbiguous**: True if qualified name resolution is uncertain (star imports)
 *
 * ## Scope Information
 *
 * - **scopeKind**: Classification of where the variable is declared
 * - **scopeDepth**: Nesting level for lambdas (0 = not in lambda, 1+ = lambda depth)
 * - **methodRegistryLinkHash**: Links to the enclosing method (if applicable)
 * - **typeRegistryLinkHash**: Links to the enclosing type
 *
 * ## Modifiers
 *
 * - **isFinal**: True if declared with `final` keyword
 * - **isVarInferred**: True if using `var` type inference (Java 10+)
 *
 * ## Links
 *
 * - **typeRegistryLinkHash**: Links to the enclosing type
 * - **methodRegistryLinkHash**: Links to the enclosing method (null for initializer blocks)
 * - **localVariableRegistryUniqueHash**: Unique identifier for this variable
 *
 * ## CSV Export Format
 *
 * Column order optimized for readability:
 * 1. name, variableTypeName, variableBaseType, potentialQualifiedName, isAmbiguous
 * 2. filePath, startLine, endLine
 * 3. scopeKind, scopeDepth, isFinal, isVarInferred
 * 4. typeRegistryLinkHash, methodRegistryLinkHash
 * 5. ownerTypeName, ownerQualifiedName, ownerMethodName
 * 6. localVariableRegistryUniqueHash (LAST - for easy viewing)
 */
export class LocalVariableRegistry implements EntityIdentifiable {
  private name: string;
  private variableTypeName: string;
  private variableBaseType: string;
  private potentialQualifiedName?: string;
  private isAmbiguous: boolean;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private scopeKind: LocalVariableScopeKind;
  private scopeDepth: number;
  private isFinal: boolean;
  private isVarInferred: boolean;
  private typeRegistryLinkHash: string;
  private methodRegistryLinkHash?: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private ownerMethodName?: string;
  private serviceVersionLinkHash: string;
  private parentExpressionLinkHash?: string;
  private localVariableRegistryUniqueHash: string = '';

  private constructor(builder: LocalVariableRegistryBuilder) {
    this.name = builder.name;
    this.variableTypeName = builder.variableTypeName;
    this.variableBaseType = builder.variableBaseType;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.scopeKind = builder.scopeKind;
    this.scopeDepth = builder.scopeDepth;
    this.isFinal = builder.isFinal;
    this.isVarInferred = builder.isVarInferred;
    this.typeRegistryLinkHash = builder.typeRegistryLinkHash;
    this.methodRegistryLinkHash = builder.methodRegistryLinkHash;
    this.ownerTypeName = builder.ownerTypeName;
    this.ownerQualifiedName = builder.ownerQualifiedName;
    this.ownerMethodName = builder.ownerMethodName;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;
    this.parentExpressionLinkHash = builder.parentExpressionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    variableTypeName: string,
    variableBaseType: string,
    filePath: string,
    startLine: number,
    endLine: number,
    scopeKind: LocalVariableScopeKind,
    typeRegistryLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionLinkHash: string
  ): LocalVariableRegistryBuilder {
    return new LocalVariableRegistryBuilder(
      name,
      variableTypeName,
      variableBaseType,
      filePath,
      startLine,
      endLine,
      scopeKind,
      typeRegistryLinkHash,
      ownerTypeName,
      ownerQualifiedName,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  getVariableTypeName(): string {
    return this.variableTypeName;
  }

  getVariableBaseType(): string {
    return this.variableBaseType;
  }

  getPotentialQualifiedName(): string | undefined {
    return this.potentialQualifiedName;
  }

  getIsAmbiguous(): boolean {
    return this.isAmbiguous;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getScopeKind(): LocalVariableScopeKind {
    return this.scopeKind;
  }

  getScopeDepth(): number {
    return this.scopeDepth;
  }

  getIsFinal(): boolean {
    return this.isFinal;
  }

  getIsVarInferred(): boolean {
    return this.isVarInferred;
  }

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getMethodRegistryLinkHash(): string | undefined {
    return this.methodRegistryLinkHash;
  }

  getOwnerTypeName(): string {
    return this.ownerTypeName;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getOwnerMethodName(): string | undefined {
    return this.ownerMethodName;
  }

  getParentExpressionLinkHash(): string | undefined {
    return this.parentExpressionLinkHash;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getLocalVariableRegistryUniqueHash(): string {
    return this.localVariableRegistryUniqueHash;
  }

  getHash(): string {
    return this.localVariableRegistryUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.typeRegistryLinkHash +
      '||' +
      (this.methodRegistryLinkHash || 'NO_METHOD') +
      '||' +
      this.name +
      '||' +
      this.variableTypeName +
      '||' +
      this.startLine +
      '||' +
      this.scopeKind +
      '||' +
      this.scopeDepth;

    this.localVariableRegistryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.LOCAL_VARIABLE_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_local_var[name=${this.name}, type=${this.variableTypeName}, scope=${this.scopeKind}, depth=${this.scopeDepth}, method=${this.ownerMethodName || 'N/A'}, line ${this.startLine}, hash=${this.localVariableRegistryUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.name,
      EntityUtils.escapeTsv(this.variableTypeName),
      EntityUtils.escapeTsv(this.variableBaseType),
      EntityUtils.escapeTsv(this.potentialQualifiedName || ''),
      this.isAmbiguous.toString(),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.scopeKind,
      this.scopeDepth.toString(),
      this.isFinal.toString(),
      this.isVarInferred.toString(),
      this.typeRegistryLinkHash,
      this.methodRegistryLinkHash || '',
      this.ownerTypeName,
      this.ownerQualifiedName,
      this.ownerMethodName || '',
      this.parentExpressionLinkHash || '',
      this.localVariableRegistryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'variableTypeName',
      'variableBaseType',
      'potentialQualifiedName',
      'isAmbiguous',
      'filePath',
      'startLine',
      'endLine',
      'scopeKind',
      'scopeDepth',
      'isFinal',
      'isVarInferred',
      'typeRegistryLinkHash',
      'methodRegistryLinkHash',
      'ownerTypeName',
      'ownerQualifiedName',
      'ownerMethodName',
      'parentExpressionLinkHash',
      'localVariableRegistryUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for LocalVariableRegistry to handle optional parameters
 */
class LocalVariableRegistryBuilder {
  name: string;
  variableTypeName: string;
  variableBaseType: string;
  potentialQualifiedName?: string;
  isAmbiguous: boolean = false;
  filePath: string;
  startLine: number;
  endLine: number;
  scopeKind: LocalVariableScopeKind;
  scopeDepth: number = 0;
  isFinal: boolean = false;
  isVarInferred: boolean = false;
  typeRegistryLinkHash: string;
  methodRegistryLinkHash?: string;
  ownerTypeName: string;
  ownerQualifiedName: string;
  ownerMethodName?: string;
  serviceVersionLinkHash: string;
  parentExpressionLinkHash?: string;

  constructor(
    name: string,
    variableTypeName: string,
    variableBaseType: string,
    filePath: string,
    startLine: number,
    endLine: number,
    scopeKind: LocalVariableScopeKind,
    typeRegistryLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionLinkHash: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (!variableTypeName || variableTypeName.trim().length === 0) {
      throw new Error('variableTypeName is required');
    }
    if (!typeRegistryLinkHash || typeRegistryLinkHash.trim().length === 0) {
      throw new Error('typeRegistryLinkHash is required');
    }
    if (!serviceVersionLinkHash || serviceVersionLinkHash.trim().length === 0) {
      throw new Error('serviceVersionLinkHash is required');
    }
    if (!filePath || filePath.trim().length === 0) {
      throw new Error('filePath is required');
    }
    if (startLine <= 0) {
      throw new Error('startLine must be > 0');
    }
    if (endLine <= 0) {
      throw new Error('endLine must be > 0');
    }
    if (endLine < startLine) {
      throw new Error('endLine must be >= startLine');
    }

    this.name = name;
    this.variableTypeName = variableTypeName;
    this.variableBaseType = variableBaseType;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.scopeKind = scopeKind;
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withPotentialQualifiedName(qualifiedName: string): LocalVariableRegistryBuilder {
    this.potentialQualifiedName = qualifiedName;
    return this;
  }

  withIsAmbiguous(isAmbiguous: boolean): LocalVariableRegistryBuilder {
    this.isAmbiguous = isAmbiguous;
    return this;
  }

  withScopeDepth(depth: number): LocalVariableRegistryBuilder {
    this.scopeDepth = depth;
    return this;
  }

  withIsFinal(isFinal: boolean): LocalVariableRegistryBuilder {
    this.isFinal = isFinal;
    return this;
  }

  withIsVarInferred(isVarInferred: boolean): LocalVariableRegistryBuilder {
    this.isVarInferred = isVarInferred;
    return this;
  }

  withMethodRegistryLinkHash(methodHash: string): LocalVariableRegistryBuilder {
    this.methodRegistryLinkHash = methodHash;
    return this;
  }

  withOwnerMethodName(methodName: string): LocalVariableRegistryBuilder {
    this.ownerMethodName = methodName;
    return this;
  }

  withParentExpressionLinkHash(expressionHash: string): LocalVariableRegistryBuilder {
    this.parentExpressionLinkHash = expressionHash;
    return this;
  }

  build(): LocalVariableRegistry {
    return new (LocalVariableRegistry as any)(this);
  }
}
