import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a method or constructor parameter in Java source code.
 * 
 * This entity captures parameter metadata and links to:
 * - The owning method via methodRegistryLinkHash
 * - Parameter type details via TypeReference entities (referenced by this parameter's hash)
 * 
 * ## Examples
 * 
 * ```java
 * // Regular parameters
 * public void process(String name, int count) { }
 * // - MethodParameter: name="name", position=0, isFinal=false
 * // - MethodParameter: name="count", position=1, isFinal=false
 * 
 * // Final parameter
 * public void handle(final User user) { }
 * // - MethodParameter: name="user", position=0, isFinal=true
 * 
 * // Varargs parameter
 * public void log(String... messages) { }
 * // - MethodParameter: name="messages", position=0, isVarArgs=true
 * 
 * // Receiver parameter (explicit 'this')
 * public void method(OuterClass.this, String param) { }
 * // - MethodParameter: name="this", position=0, isReceiverParameter=true
 * // - MethodParameter: name="param", position=1
 * 
 * // Complex generic parameter with wildcards
 * public void process(Map<String, List<? extends Number>> data) { }
 * // - MethodParameter: name="data", position=0
 * // - Multiple TypeReference entities linked to this parameter's hash:
 * //   - Map (PARAMETERIZED_TYPE, depth=0)
 * //   - String (CLASS_TYPE, depth=1, parent=Map)
 * //   - List (PARAMETERIZED_TYPE, depth=1, parent=Map)
 * //   - ? extends Number (WILDCARD, EXTENDS, depth=2, parent=List)
 * //   - Number (CLASS_TYPE, depth=3, parent=wildcard)
 * ```
 * 
 * ## CSV Export Format
 * 
 * Columns (tab-separated):
 * - paramName
 * - position
 * - methodRegistryLinkHash (owner method)
 * - isFinal
 * - isVarArgs
 * - isReceiverParameter
 * - startLine
 * - endLine
 * - methodParameterUniqueHash (LAST - for easy viewing)
 * 
 * ## Type Information Strategy
 * 
 * Parameter type details are NOT stored in this entity. Instead:
 * - Query TypeReference table with:
 *   - referenceOwnerKind = 'METHOD_PARAM'
 *   - typeReferenceOwnerHash = methodParameterUniqueHash
 *   - context = 'METHOD_PARAM'
 * - This leverages existing wildcard/generic extraction logic
 * - Supports complex nested types: Map<K, List<? extends V>>
 */
export class MethodParameter implements EntityIdentifiable {
  private paramName: string;
  private position: number;
  private methodRegistryLinkHash: string;
  private parameterBaseType: string;
  private parameterTypeName: string;
  private potentialQualifiedName: string | null;
  private isAmbiguous: boolean;
  private isFinal: boolean;
  private isVarArgs: boolean;
  private isReceiverParameter: boolean;
  private startLine: number;
  private endLine: number;
  private methodParameterUniqueHash: string = '';

  constructor(
    paramName: string,
    position: number,
    methodRegistryLinkHash: string,
    parameterBaseType: string,
    parameterTypeName: string,
    potentialQualifiedName: string | null,
    isAmbiguous: boolean,
    isFinal: boolean,
    isVarArgs: boolean,
    isReceiverParameter: boolean,
    startLine: number,
    endLine: number
  ) {
    // Validation
    if (!paramName || paramName.trim().length === 0) {
      throw new Error('paramName is required');
    }
    if (position < 0) {
      throw new Error('position must be >= 0');
    }
    if (!methodRegistryLinkHash || methodRegistryLinkHash.trim().length === 0) {
      throw new Error('methodRegistryLinkHash is required');
    }
    if (!parameterBaseType || parameterBaseType.trim().length === 0) {
      throw new Error('parameterBaseType is required');
    }
    if (!parameterTypeName || parameterTypeName.trim().length === 0) {
      throw new Error('parameterTypeName is required');
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

    this.paramName = paramName;
    this.position = position;
    this.methodRegistryLinkHash = methodRegistryLinkHash;
    this.parameterBaseType = parameterBaseType;
    this.parameterTypeName = parameterTypeName;
    this.potentialQualifiedName = potentialQualifiedName;
    this.isAmbiguous = isAmbiguous;
    this.isFinal = isFinal;
    this.isVarArgs = isVarArgs;
    this.isReceiverParameter = isReceiverParameter;
    this.startLine = startLine;
    this.endLine = endLine;

    this.generateHash();
  }

  getParamName(): string {
    return this.paramName;
  }

  getPosition(): number {
    return this.position;
  }

  getMethodRegistryLinkHash(): string {
    return this.methodRegistryLinkHash;
  }

  getParameterBaseType(): string {
    return this.parameterBaseType;
  }

  getParameterTypeName(): string {
    return this.parameterTypeName;
  }

  getPotentialQualifiedName(): string | null {
    return this.potentialQualifiedName;
  }

  getIsAmbiguous(): boolean {
    return this.isAmbiguous;
  }

  getIsFinal(): boolean {
    return this.isFinal;
  }

  getIsVarArgs(): boolean {
    return this.isVarArgs;
  }

  getIsReceiverParameter(): boolean {
    return this.isReceiverParameter;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getHash(): string {
    return this.methodParameterUniqueHash;
  }

  getEntityType(): string {
    return ENTITY_IDENTIFIERS.METHOD_PARAMETER;
  }

  generateHash(): void {
    const components = [
      this.methodRegistryLinkHash,
      this.position.toString(),
      this.paramName,
    ].join('|');
    this.methodParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.METHOD_PARAMETER,
      components
    );
  }

  getEntryCombined(): string {
    return `java_method_parameter[name=${this.paramName}, position=${this.position}, method=${this.methodRegistryLinkHash}, hash=${this.methodParameterUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.paramName,
      this.position.toString(),
      this.methodRegistryLinkHash,
      EntityUtils.escapeTsv(this.parameterBaseType),
      EntityUtils.escapeTsv(this.parameterTypeName),
      EntityUtils.escapeTsv(this.potentialQualifiedName ?? ''),
      this.isAmbiguous.toString(),
      this.isFinal.toString(),
      this.isVarArgs.toString(),
      this.isReceiverParameter.toString(),
      this.startLine.toString(),
      this.endLine.toString(),
      this.methodParameterUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'paramName',
      'position',
      'methodRegistryLinkHash',
      'parameterBaseType',
      'parameterTypeName',
      'potentialQualifiedName',
      'isAmbiguous',
      'isFinal',
      'isVarArgs',
      'isReceiverParameter',
      'startLine',
      'endLine',
      'methodParameterUniqueHash',
    ].join('\t');
  }
}
