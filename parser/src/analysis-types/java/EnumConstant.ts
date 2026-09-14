import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents an enum constant declaration in Java source code.
 *
 * EnumConstant captures enum constant definitions, including:
 * - The constant name (e.g., ACTIVE, PENDING)
 * - Constructor arguments passed to the enum constant
 * - Position (ordinal) within the enum
 * - Whether it has an anonymous class body with overridden methods
 *
 * ## Examples
 *
 * ```java
 * public enum Status {
 *     // Simple constant (no arguments)
 *     UNKNOWN,
 *     
 *     // Constant with arguments
 *     ACTIVE("Active", 1),
 *     INACTIVE("Inactive", 0),
 *     
 *     // Constant with anonymous class body
 *     PENDING("Pending", 2) {
 *         @Override
 *         public boolean isTransient() {
 *             return true;
 *         }
 *     };
 *     
 *     private final String label;
 *     private final int code;
 *     
 *     Status(String label, int code) {
 *         this.label = label;
 *         this.code = code;
 *     }
 * }
 * ```
 *
 * For the above enum, three EnumConstant entities would be created:
 * - ACTIVE with arguments ["Active", 1], ordinal 0
 * - INACTIVE with arguments ["Inactive", 0], ordinal 1
 * - PENDING with arguments ["Pending", 2], ordinal 2, hasBody = true
 *
 * ## Anonymous Class Bodies
 *
 * When an enum constant has a body (e.g., PENDING above), the `hasBody` flag
 * is set to true. Methods within this body are extracted separately by the
 * TypeMethodExtractor and linked via the enum's TypeRegistry hash.
 *
 * ## Arguments
 *
 * The `arguments` field contains the raw text of each argument passed to the
 * enum constant's constructor. For complex expressions, the full expression
 * text is captured (e.g., "HttpMethod.GET", "new Date()", "1 + 2").
 *
 * ## Field Links
 *
 * - **typeRegistryLinkHash**: Links to the enclosing enum type
 * - **enumConstantUniqueHash**: Unique identifier for this enum constant
 *
 */
export class EnumConstant implements EntityIdentifiable {
  private name: string;
  private qualifiedName: string;
  private ordinal: number;
  private arguments: string[];
  private argumentsText: string;
  private hasBody: boolean;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private typeRegistryLinkHash: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private serviceVersionLinkHash: string;
  private enumConstantUniqueHash: string = '';

  constructor(
    name: string,
    qualifiedName: string,
    ordinal: number,
    args: string[],
    hasBody: boolean,
    filePath: string,
    startLine: number,
    endLine: number,
    typeRegistryLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    serviceVersionLinkHash: string
  ) {
    // Validate required fields
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (ordinal < 0) {
      throw new Error('ordinal must be >= 0');
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
    this.qualifiedName = qualifiedName;
    this.ordinal = ordinal;
    this.arguments = args;
    this.argumentsText = args.join(', ');
    this.hasBody = hasBody;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getName(): string {
    return this.name;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
  }

  getOrdinal(): number {
    return this.ordinal;
  }

  getArguments(): string[] {
    return this.arguments;
  }

  getArgumentsText(): string {
    return this.argumentsText;
  }

  getHasBody(): boolean {
    return this.hasBody;
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

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getEnumConstantUniqueHash(): string {
    return this.enumConstantUniqueHash;
  }

  getHash(): string {
    return this.enumConstantUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.typeRegistryLinkHash +
      '||' +
      this.name +
      '||' +
      this.ordinal +
      '||' +
      this.startLine +
      '||' +
      this.endLine;

    this.enumConstantUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.ENUM_CONSTANT,
      content
    );
  }

  getEntryCombined(): string {
    return `java_enum_constant[name=${this.name}, ordinal=${this.ordinal}, args=${this.argumentsText}, hasBody=${this.hasBody}, owner=${this.ownerTypeName}, lines ${this.startLine}-${this.endLine}, hash=${this.enumConstantUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.name,
      this.qualifiedName,
      this.ordinal.toString(),
      EntityUtils.escapeTsv(this.argumentsText),
      this.arguments.length.toString(),
      this.hasBody.toString(),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.typeRegistryLinkHash,
      this.ownerTypeName,
      this.ownerQualifiedName,
      this.enumConstantUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'qualifiedName',
      'ordinal',
      'arguments',
      'argumentCount',
      'hasBody',
      'filePath',
      'startLine',
      'endLine',
      'typeRegistryLinkHash',
      'ownerTypeName',
      'ownerQualifiedName',
      'enumConstantUniqueHash',
    ].join('\t');
  }
}
