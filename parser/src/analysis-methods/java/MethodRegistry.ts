import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { MethodAccess, MethodKind } from '@/enums/java/methods';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a method declaration in Java source code.
 *
 * MethodRegistry captures method declarations across the codebase, including:
 * - Regular instance and static methods
 * - Abstract methods (in abstract classes and interfaces)
 * - Constructors (regular and compact for records)
 * - Default interface methods (Java 8+)
 * - Static and instance initializers
 * - Annotation elements (@interface methods)
 *
 * ## Examples
 *
 * ```java
 * public class UserService {
 *     // INSTANCE_METHOD
 *     public User getUserById(String id) { ... }
 *     
 *     // STATIC_METHOD
 *     public static UserService getInstance() { ... }
 *     
 *     // CONSTRUCTOR
 *     public UserService(UserRepository repo) { ... }
 * }
 *
 * public interface PaymentGateway {
 *     // ABSTRACT_METHOD
 *     void process(Payment p);
 *     
 *     // DEFAULT_METHOD
 *     default void log(String msg) { ... }
 *     
 *     // STATIC_METHOD
 *     static void validate(Payment p) { ... }
 * }
 *
 * public record Point(int x, int y) {
 *     // COMPACT_CONSTRUCTOR
 *     public Point { ... }
 * }
 * 
 * // STATIC_INITIALIZER
 * static {
 *     loadConfig();
 * }
 * 
 * // INSTANCE_INITIALIZER
 * {
 *     this.id = UUID.randomUUID();
 * }
 * ```
 *
 * ## Return Type Conventions
 *
 * - **Regular methods**: returnTypeName contains the actual return type
 *   - `public User getUser()` → returnTypeName = "User", signature = "getUser():User"
 *   - `public void process()` → returnTypeName = "void", signature = "process():void"
 *   - `public List<String> getItems()` → returnTypeName = "List<String>", signature = "getItems():List"
 *
 * - **Constructors** (CONSTRUCTOR, COMPACT_CONSTRUCTOR): returnTypeName = `undefined`
 *   - Constructors have no return type in Java
 *   - The `returnTypeName` **field** is undefined/not set
 *   - The `signature` **string** still uses `:void` as a syntactic placeholder
 *   - Example: `UserService(String)` → returnTypeName = undefined, signature = "UserService(String):void"
 *   - This allows consistent signature parsing across all method types
 *
 * - **Initializers** (STATIC_INITIALIZER, INSTANCE_INITIALIZER): returnTypeName = `"void"`
 *   - Both the field AND signature use "void"
 *   - Static: name = "<clinit>", returnTypeName = "void", signature = "<clinit>():void"
 *   - Instance: name = "<init_block>", returnTypeName = "void", signature = "<init_block>():void"
 *
 * - **Annotation Elements** (ANNOTATION_ELEMENT): returnTypeName = **required**
 *   - Annotation elements ALWAYS have a return type (Java language requirement)
 *   - Valid types: primitives, String, Class, enums, annotations, or arrays thereof
 *   - Example: `String value()` → returnTypeName = "String", signature = "value():String"
 *   - Example: `int timeout()` → returnTypeName = "int", signature = "timeout():int"
 *   - Cannot be void or missing
 *
 * ## Signature vs DetailedSignature
 *
 * - **signature**: Canonical form with generics stripped, varargs normalized
 *   - `process(List,String[]):Map`
 *   - Used for method identity and overload resolution
 *
 * - **detailedSignature**: Preserves all type information as written
 *   - `process(List<User>,String...):Map<String, Result>`
 *   - Used for display and exact source matching
 *
 * ## Field Links
 *
 * - **typeRegistryLinkHash**: Always links to the enclosing type
 * - **methodRegistryUniqueHash**: Unique identifier for this method (last column in CSV)
 * - **serviceVersionLinkHash**: Links to the service version (stored internally, not in CSV)
 *
 * ## CSV Export Format
 *
 * The CSV output includes all method metadata in tab-separated format.
 * Column order optimized for readability:
 * 1. name, signature, detailedSignature, qualifiedName
 * 2. filePath, startLine, endLine
 * 3. typeRegistryLinkHash (owner type)
 * 4. ownerTypeName, ownerQualifiedName
 * 5. methodAccess, methodModifier, returnTypeName
 * 6. isVarArgs, hasReceiverParameter, defaultValueExpression
 * 7. methodKind
 * 8. parameterCount, hasTypeParameters, throwsExceptions
 * 9. methodRegistryUniqueHash (LAST - for easy viewing)
 *
 */
export class MethodRegistry implements EntityIdentifiable {
  private name: string;
  private signature: string;
  private detailedSignature: string;
  private qualifiedName: string;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private typeRegistryLinkHash: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private methodAccess: MethodAccess;
  private methodModifier?: string;
  private returnTypeName?: string;
  private isVarArgs: boolean;
  private hasReceiverParameter: boolean;
  private defaultValueExpression?: string;
  private methodKind: MethodKind;
  private serviceVersionLinkHash: string;
  private methodRegistryUniqueHash: string = '';
  private parameterCount: number;
  private hasTypeParameters: boolean;
  private throwsExceptions: boolean;
  private enclosingMemberLinkHash?: string;

  constructor(
    name: string,
    signature: string,
    detailedSignature: string,
    qualifiedName: string,
    filePath: string,
    startLine: number,
    endLine: number,
    typeRegistryLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    methodAccess: MethodAccess,
    methodKind: MethodKind,
    serviceVersionLinkHash: string,
    parameterCount: number,
    isVarArgs: boolean,
    hasReceiverParameter: boolean,
    hasTypeParameters: boolean,
    throwsExceptions: boolean,
    methodModifier?: string,
    returnTypeName?: string,
    defaultValueExpression?: string,
    enclosingMemberLinkHash?: string
  ) {
    // Validate required fields
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (!signature || signature.trim().length === 0) {
      throw new Error('signature is required');
    }
    if (!methodKind) {
      throw new Error('methodKind is required');
    }
    if (!methodAccess) {
      throw new Error('methodAccess is required');
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
    if (parameterCount < 0) {
      throw new Error('parameterCount must be >= 0');
    }

    // Validate return type conventions
    const constructorKinds = [MethodKind.CONSTRUCTOR, MethodKind.COMPACT_CONSTRUCTOR];
    if (constructorKinds.includes(methodKind) && returnTypeName) {
      throw new Error(`${methodKind} should not have a returnTypeName (must be undefined)`);
    }

    const initializerKinds = [MethodKind.STATIC_INITIALIZER, MethodKind.INSTANCE_INITIALIZER];
    if (initializerKinds.includes(methodKind)) {
      if (!returnTypeName) {
        throw new Error(`${methodKind} must have returnTypeName = "void"`);
      }
      if (returnTypeName !== 'void') {
        throw new Error(`${methodKind} must have returnTypeName = "void", got "${returnTypeName}"`);
      }
    }

    if (methodKind === MethodKind.ANNOTATION_ELEMENT) {
      if (!returnTypeName) {
        throw new Error('ANNOTATION_ELEMENT must have a returnTypeName');
      }
      if (returnTypeName === 'void') {
        throw new Error('ANNOTATION_ELEMENT cannot have returnTypeName = "void"');
      }
    }

    this.name = name;
    this.signature = signature;
    this.detailedSignature = detailedSignature;
    this.qualifiedName = qualifiedName;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.methodAccess = methodAccess;
    this.methodModifier = methodModifier;
    this.returnTypeName = returnTypeName;
    this.isVarArgs = isVarArgs;
    this.hasReceiverParameter = hasReceiverParameter;
    this.defaultValueExpression = defaultValueExpression;
    this.methodKind = methodKind;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
    this.parameterCount = parameterCount;
    this.hasTypeParameters = hasTypeParameters;
    this.throwsExceptions = throwsExceptions;
    this.enclosingMemberLinkHash = enclosingMemberLinkHash;

    this.generateHash();
  }

  getName(): string {
    return this.name;
  }

  getSignature(): string {
    return this.signature;
  }

  getDetailedSignature(): string {
    return this.detailedSignature;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
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

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getOwnerTypeName(): string {
    return this.ownerTypeName;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getMethodAccess(): MethodAccess {
    return this.methodAccess;
  }

  getMethodModifier(): string | undefined {
    return this.methodModifier;
  }

  getReturnTypeName(): string | undefined {
    return this.returnTypeName;
  }

  getIsVarArgs(): boolean {
    return this.isVarArgs;
  }

  getHasReceiverParameter(): boolean {
    return this.hasReceiverParameter;
  }

  getDefaultValueExpression(): string | undefined {
    return this.defaultValueExpression;
  }

  getMethodKind(): MethodKind {
    return this.methodKind;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getMethodRegistryUniqueHash(): string {
    return this.methodRegistryUniqueHash;
  }

  getHash(): string {
    return this.methodRegistryUniqueHash;
  }

  getParameterCount(): number {
    return this.parameterCount;
  }

  getHasTypeParameters(): boolean {
    return this.hasTypeParameters;
  }

  getThrowsExceptions(): boolean {
    return this.throwsExceptions;
  }

  getEnclosingMemberLinkHash(): string | undefined {
    return this.enclosingMemberLinkHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.typeRegistryLinkHash +
      '||' +
      this.methodKind +
      '||' +
      this.signature +
      '||' +
      this.startLine +
      '||' +
      this.endLine;

    this.methodRegistryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.METHOD_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_method[name=${this.name}, signature=${this.signature}, kind=${this.methodKind}, access=${this.methodAccess}, type=${this.ownerTypeName}, lines ${this.startLine}-${this.endLine}, hash=${this.methodRegistryUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.name,
      EntityUtils.escapeTsv(this.signature),
      EntityUtils.escapeTsv(this.detailedSignature),
      EntityUtils.escapeTsv(this.qualifiedName),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.typeRegistryLinkHash,
      this.ownerTypeName,
      this.ownerQualifiedName,
      this.methodAccess,
      this.methodModifier || '',
      EntityUtils.escapeTsv(this.returnTypeName || ''),
      this.isVarArgs.toString(),
      this.hasReceiverParameter.toString(),
      EntityUtils.escapeTsv(this.defaultValueExpression || ''),
      this.methodKind,
      this.parameterCount.toString(),
      this.hasTypeParameters.toString(),
      this.throwsExceptions.toString(),
      this.enclosingMemberLinkHash || '',
      this.methodRegistryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'signature',
      'detailedSignature',
      'qualifiedName',
      'filePath',
      'startLine',
      'endLine',
      'typeRegistryLinkHash',
      'ownerTypeName',
      'ownerQualifiedName',
      'methodAccess',
      'methodModifier',
      'returnTypeName',
      'isVarArgs',
      'hasReceiverParameter',
      'defaultValueExpression',
      'methodKind',
      'parameterCount',
      'hasTypeParameters',
      'throwsExceptions',
      'enclosingMemberLinkHash',
      'methodRegistryUniqueHash',
    ].join('\t');
  }

}
