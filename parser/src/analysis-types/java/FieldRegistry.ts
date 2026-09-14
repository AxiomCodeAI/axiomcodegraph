import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { FieldModifier } from '@/enums/java/fields';
import { TypeAccess } from '@/enums/java/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a field declaration in Java source code.
 *
 * FieldRegistry captures field declarations across the codebase, including:
 * - Instance fields (regular object state)
 * - Static fields (class-level state)
 * - Final fields (immutable references)
 * - Volatile fields (thread-visible)
 * - Transient fields (excluded from serialization)
 * - Constants (static final)
 * - Interface constants (implicitly public static final)
 * - Enum instance fields
 *
 * ## Examples
 *
 * ```java
 * public class UserService {
 *     // Instance field
 *     private String name;
 *     
 *     // Static field
 *     private static int instanceCount;
 *     
 *     // Constant
 *     public static final String VERSION = "1.0";
 *     
 *     // Volatile field
 *     private volatile boolean running;
 *     
 *     // Transient field
 *     private transient Connection connection;
 *     
 *     // Generic field
 *     private List<String> items;
 *     
 *     // Wildcard field
 *     private List<? extends Number> numbers;
 * }
 *
 * public interface Constants {
 *     // Implicitly public static final
 *     String NAME = "value";
 *     int COUNT = 42;
 * }
 * ```
 *
 * ## Type Information
 *
 * - **fieldTypeName**: The full type as written in source (e.g., "List<String>")
 * - **fieldBaseType**: Base type without generics (e.g., "List")
 * - **potentialQualifiedName**: Resolved qualified name (e.g., "java.util.List")
 * - **isAmbiguous**: True if qualified name resolution is uncertain (star imports)
 *
 * ## Modifiers
 *
 * - **fieldAccess**: Access level (PUBLIC, PROTECTED, PRIVATE, PACKAGE)
 * - **modifiers**: Array of field modifiers (STATIC, FINAL, VOLATILE, TRANSIENT)
 *
 * ## Links
 *
 * - **typeRegistryLinkHash**: Links to the enclosing type
 * - **fieldRegistryUniqueHash**: Unique identifier for this field
 *
 * ## CSV Export Format
 *
 * Column order optimized for readability:
 * 1. name, fieldTypeName, fieldBaseType, potentialQualifiedName, isAmbiguous
 * 2. filePath, startLine, endLine
 * 3. typeRegistryLinkHash (owner type)
 * 4. ownerTypeName, ownerQualifiedName
 * 5. fieldAccess, fieldModifier
 * 6. fieldRegistryUniqueHash (LAST - for easy viewing)
 */
export class FieldRegistry implements EntityIdentifiable {
  private name: string;
  private fieldTypeName: string;
  private fieldBaseType: string;
  private potentialQualifiedName?: string;
  private isAmbiguous: boolean;
  private filePath: string;
  private startLine: number;
  private endLine: number;
  private typeRegistryLinkHash: string;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private fieldAccess: TypeAccess;
  private modifiers: Set<FieldModifier>;
  private serviceVersionLinkHash: string;
  private fieldRegistryUniqueHash: string = '';

  private constructor(builder: FieldRegistryBuilder) {
    this.name = builder.name;
    this.fieldTypeName = builder.fieldTypeName;
    this.fieldBaseType = builder.fieldBaseType;
    this.potentialQualifiedName = builder.potentialQualifiedName;
    this.isAmbiguous = builder.isAmbiguous;
    this.filePath = builder.filePath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.typeRegistryLinkHash = builder.typeRegistryLinkHash;
    this.ownerTypeName = builder.ownerTypeName;
    this.ownerQualifiedName = builder.ownerQualifiedName;
    this.fieldAccess = builder.fieldAccess;
    this.modifiers = builder.modifiers;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    name: string,
    fieldTypeName: string,
    fieldBaseType: string,
    filePath: string,
    startLine: number,
    endLine: number,
    typeRegistryLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    fieldAccess: TypeAccess,
    serviceVersionLinkHash: string
  ): FieldRegistryBuilder {
    return new FieldRegistryBuilder(
      name,
      fieldTypeName,
      fieldBaseType,
      filePath,
      startLine,
      endLine,
      typeRegistryLinkHash,
      ownerTypeName,
      ownerQualifiedName,
      fieldAccess,
      serviceVersionLinkHash
    );
  }

  getName(): string {
    return this.name;
  }

  getFieldTypeName(): string {
    return this.fieldTypeName;
  }

  getFieldBaseType(): string {
    return this.fieldBaseType;
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

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getOwnerTypeName(): string {
    return this.ownerTypeName;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getFieldAccess(): TypeAccess {
    return this.fieldAccess;
  }

  getModifiers(): Set<FieldModifier> {
    return this.modifiers;
  }

  isStatic(): boolean {
    return this.modifiers.has(FieldModifier.STATIC);
  }

  isFinal(): boolean {
    return this.modifiers.has(FieldModifier.FINAL);
  }

  isVolatile(): boolean {
    return this.modifiers.has(FieldModifier.VOLATILE);
  }

  isTransient(): boolean {
    return this.modifiers.has(FieldModifier.TRANSIENT);
  }

  /**
   * Get modifiers as a comma-separated string for CSV output.
   * Returns empty string if no modifiers.
   * Example: "STATIC,FINAL" or "VOLATILE" or ""
   */
  getFieldModifier(): string {
    if (this.modifiers.size === 0) return '';
    return Array.from(this.modifiers).join(',');
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getFieldRegistryUniqueHash(): string {
    return this.fieldRegistryUniqueHash;
  }

  getHash(): string {
    return this.fieldRegistryUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.typeRegistryLinkHash +
      '||' +
      this.name +
      '||' +
      this.fieldTypeName +
      '||' +
      this.startLine;

    this.fieldRegistryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.FIELD_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_field[name=${this.name}, type=${this.fieldTypeName}, access=${this.fieldAccess}, owner=${this.ownerTypeName}, line ${this.startLine}, hash=${this.fieldRegistryUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.name,
      EntityUtils.escapeTsv(this.fieldTypeName),
      EntityUtils.escapeTsv(this.fieldBaseType),
      EntityUtils.escapeTsv(this.potentialQualifiedName || ''),
      this.isAmbiguous.toString(),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.typeRegistryLinkHash,
      this.ownerTypeName,
      this.ownerQualifiedName,
      this.fieldAccess,
      this.getFieldModifier(),
      this.fieldRegistryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'name',
      'fieldTypeName',
      'fieldBaseType',
      'potentialQualifiedName',
      'isAmbiguous',
      'filePath',
      'startLine',
      'endLine',
      'typeRegistryLinkHash',
      'ownerTypeName',
      'ownerQualifiedName',
      'fieldAccess',
      'fieldModifier',
      'fieldRegistryUniqueHash',
    ].join('\t');
  }
}

/**
 * Builder for FieldRegistry to handle optional parameters
 */
class FieldRegistryBuilder {
  name: string;
  fieldTypeName: string;
  fieldBaseType: string;
  potentialQualifiedName?: string;
  isAmbiguous: boolean = false;
  filePath: string;
  startLine: number;
  endLine: number;
  typeRegistryLinkHash: string;
  ownerTypeName: string;
  ownerQualifiedName: string;
  fieldAccess: TypeAccess;
  modifiers: Set<FieldModifier> = new Set();
  serviceVersionLinkHash: string;

  constructor(
    name: string,
    fieldTypeName: string,
    fieldBaseType: string,
    filePath: string,
    startLine: number,
    endLine: number,
    typeRegistryLinkHash: string,
    ownerTypeName: string,
    ownerQualifiedName: string,
    fieldAccess: TypeAccess,
    serviceVersionLinkHash: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new Error('name is required');
    }
    if (!fieldTypeName || fieldTypeName.trim().length === 0) {
      throw new Error('fieldTypeName is required');
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
    this.fieldTypeName = fieldTypeName;
    this.fieldBaseType = fieldBaseType;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.typeRegistryLinkHash = typeRegistryLinkHash;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.fieldAccess = fieldAccess;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withPotentialQualifiedName(qualifiedName: string): FieldRegistryBuilder {
    this.potentialQualifiedName = qualifiedName;
    return this;
  }

  withIsAmbiguous(isAmbiguous: boolean): FieldRegistryBuilder {
    this.isAmbiguous = isAmbiguous;
    return this;
  }

  withModifier(modifier: FieldModifier): FieldRegistryBuilder {
    this.modifiers.add(modifier);
    return this;
  }

  withModifiers(modifiers: FieldModifier[]): FieldRegistryBuilder {
    modifiers.forEach(m => this.modifiers.add(m));
    return this;
  }

  build(): FieldRegistry {
    return new (FieldRegistry as any)(this);
  }
}
