import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a type parameter (generic parameter) declared on a method in Java.
 * 
 * Method type parameters appear in the method signature before the return type.
 * They can have bounds that constrain which types can be used as type arguments.
 * 
 * ## Examples
 * 
 * ```java
 * // Single unbounded type parameter
 * public <T> T process(T item) { ... }
 * // MethodTypeParameter: name=T, position=0, hasBounds=false
 * 
 * // Single bounded type parameter
 * public static <T extends Shape> double totalArea(List<T> shapes) { ... }
 * // MethodTypeParameter: name=T, position=0, hasBounds=true
 * // Bounds tracked in TypeReference with context=METHOD_TYPE_PARAM_BOUND
 * 
 * // Multiple type parameters with bounds
 * public <T extends Number, U extends Comparable<U>> void compare(T t, U u) { ... }
 * // MethodTypeParameter 1: name=T, position=0, hasBounds=true
 * // MethodTypeParameter 2: name=U, position=1, hasBounds=true
 * 
 * // Multiple bounds (intersection types)
 * public <T extends Runnable & Closeable> void execute(T task) { ... }
 * // MethodTypeParameter: name=T, position=0, hasBounds=true
 * // Multiple TypeReferences for Runnable and Closeable
 * 
 * // Recursive bounds
 * public <T extends Comparable<T>> T max(T a, T b) { ... }
 * // MethodTypeParameter: name=T, position=0, hasBounds=true
 * ```
 * 
 * ## Scope and Resolution
 * 
 * Method type parameters:
 * - Shadow class-level type parameters with the same name
 * - Are only in scope within the method they're declared on
 * - Can be referenced in: return type, parameter types, throws clauses, method body
 * 
 * Example of shadowing:
 * ```java
 * class Container<T> {
 *     // Method T shadows class T
 *     public <T> T process(T item) { 
 *         // T here refers to method's T, not Container's T
 *     }
 * }
 * ```
 * 
 * ## Bounds
 * 
 * Type parameter bounds are tracked separately as TypeReference entities:
 * - Single bound: `<T extends Shape>` → 1 TypeReference with kind=CLASS
 * - Multiple bounds: `<T extends Runnable & Closeable>` → 2 TypeReferences
 * - Parameterized bound: `<T extends List<String>>` → Nested TypeReferences
 * 
 * The `hasBounds` flag indicates whether bounds exist, and the bounds themselves
 * are linked via `methodTypeParameterLinkHash` in the TypeReference table.
 * 
 * ## CSV Export Format
 * 
 * Column order:
 * 1. paramName - The name of the type parameter (e.g., "T", "E", "K")
 * 2. position - Zero-based position in method's type parameter list
 * 3. ownerMethodName - Simple name of the method
 * 4. ownerMethodSignature - Full signature of the method
 * 5. ownerQualifiedMethodName - Fully qualified method name
 * 6. filePath - Source file path
 * 7. startLine - Line where type parameter is declared
 * 8. methodRegistryLinkHash - Links to owner method in all-methods.csv
 * 9. hasBounds - Whether this type parameter has any bounds
 * 10. methodTypeParameterUniqueHash - Unique identifier (LAST column)
 */
export class MethodTypeParameter implements EntityIdentifiable {
  private paramName: string;
  private position: number;
  private ownerMethodName: string;
  private ownerMethodSignature: string;
  private ownerQualifiedMethodName: string;
  private filePath: string;
  private startLine: number;
  private methodRegistryLinkHash: string;
  private hasBounds: boolean;
  private methodTypeParameterUniqueHash: string = '';

  constructor(
    paramName: string,
    position: number,
    ownerMethodName: string,
    ownerMethodSignature: string,
    ownerQualifiedMethodName: string,
    filePath: string,
    startLine: number,
    methodRegistryLinkHash: string,
    hasBounds: boolean
  ) {
    // Validate required fields
    if (!paramName || paramName.trim().length === 0) {
      throw new Error('paramName is required');
    }
    if (position < 0) {
      throw new Error('position must be >= 0');
    }
    if (!ownerMethodName || ownerMethodName.trim().length === 0) {
      throw new Error('ownerMethodName is required');
    }
    if (!ownerMethodSignature || ownerMethodSignature.trim().length === 0) {
      throw new Error('ownerMethodSignature is required');
    }
    if (!ownerQualifiedMethodName || ownerQualifiedMethodName.trim().length === 0) {
      throw new Error('ownerQualifiedMethodName is required');
    }
    if (!filePath || filePath.trim().length === 0) {
      throw new Error('filePath is required');
    }
    if (startLine <= 0) {
      throw new Error('startLine must be > 0');
    }
    if (!methodRegistryLinkHash || methodRegistryLinkHash.trim().length === 0) {
      throw new Error('methodRegistryLinkHash is required');
    }

    this.paramName = paramName;
    this.position = position;
    this.ownerMethodName = ownerMethodName;
    this.ownerMethodSignature = ownerMethodSignature;
    this.ownerQualifiedMethodName = ownerQualifiedMethodName;
    this.filePath = filePath;
    this.startLine = startLine;
    this.methodRegistryLinkHash = methodRegistryLinkHash;
    this.hasBounds = hasBounds;

    this.generateHash();
  }

  getParamName(): string {
    return this.paramName;
  }

  getPosition(): number {
    return this.position;
  }

  getOwnerMethodName(): string {
    return this.ownerMethodName;
  }

  getOwnerMethodSignature(): string {
    return this.ownerMethodSignature;
  }

  getOwnerQualifiedMethodName(): string {
    return this.ownerQualifiedMethodName;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getMethodRegistryLinkHash(): string {
    return this.methodRegistryLinkHash;
  }

  getHasBounds(): boolean {
    return this.hasBounds;
  }

  getMethodTypeParameterUniqueHash(): string {
    return this.methodTypeParameterUniqueHash;
  }

  getHash(): string {
    return this.methodTypeParameterUniqueHash;
  }

  generateHash(): void {
    const content = `${this.paramName}||${this.position}||${this.ownerQualifiedMethodName}||${this.methodRegistryLinkHash}`;
    this.methodTypeParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.METHOD_TYPE_PARAMETER,
      content
    );
  }

  getEntryCombined(): string {
    return `java_method_type_parameter[name=${this.paramName}, position=${this.position}, method=${this.ownerQualifiedMethodName}, hasBounds=${this.hasBounds}, hash=${this.methodTypeParameterUniqueHash}]`;
  }

  /**
   * Converts MethodTypeParameter to CSV row format
   */
  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.paramName),
      this.position.toString(),
      EntityUtils.escapeTsv(this.ownerMethodName),
      EntityUtils.escapeTsv(this.ownerMethodSignature),
      EntityUtils.escapeTsv(this.ownerQualifiedMethodName),
      this.filePath,
      this.startLine.toString(),
      this.methodRegistryLinkHash,
      this.hasBounds.toString(),
      this.methodTypeParameterUniqueHash,
    ].join('\t');
  }

  /**
   * Returns CSV header for MethodTypeParameter export
   */
  getCsvHeader(): string {
    return [
      'paramName',
      'position',
      'ownerMethodName',
      'ownerMethodSignature',
      'ownerQualifiedMethodName',
      'filePath',
      'startLine',
      'methodRegistryLinkHash',
      'hasBounds',
      'methodTypeParameterUniqueHash',
    ].join('\t');
  }
}
