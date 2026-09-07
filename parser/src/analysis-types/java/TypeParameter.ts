import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a type parameter (generic parameter) in Java
 * Example: In `class Box<T>`, T is a type parameter
 * Example: In `class Pair<K, V>`, K and V are type parameters at positions 0 and 1
 */
export class TypeParameter implements EntityIdentifiable {
  private name: string;
  private position: number;
  private ownerTypeName: string;
  private ownerQualifiedName: string;
  private filePath: string;
  private startLine: number;
  private typeRegistryLinkHash: string;
  private typeParameterUniqueHash: string = '';

  constructor(
    name: string,
    position: number,
    ownerTypeName: string,
    ownerQualifiedName: string,
    filePath: string,
    startLine: number,
    typeRegistryLinkHash: string
  ) {
    this.name = name;
    this.position = position;
    this.ownerTypeName = ownerTypeName;
    this.ownerQualifiedName = ownerQualifiedName;
    this.filePath = filePath;
    this.startLine = startLine;
    this.typeRegistryLinkHash = typeRegistryLinkHash;
  }

  getName(): string {
    return this.name;
  }

  getPosition(): number {
    return this.position;
  }

  getOwnerTypeName(): string {
    return this.ownerTypeName;
  }

  getOwnerQualifiedName(): string {
    return this.ownerQualifiedName;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getTypeRegistryLinkHash(): string {
    return this.typeRegistryLinkHash;
  }

  getTypeParameterUniqueHash(): string {
    return this.typeParameterUniqueHash;
  }

  getHash(): string {
    return this.typeParameterUniqueHash;
  }

  generateHash(): void {
    const content = `${this.name}||${this.position}||${this.ownerQualifiedName}||${this.typeRegistryLinkHash}`;
    this.typeParameterUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TYPE_PARAMETER,
      content
    );
  }

  getEntryCombined(): string {
    return `java_type_parameter[name=${this.name}, position=${this.position}, owner=${this.ownerQualifiedName}, hash=${this.typeParameterUniqueHash}]`;
  }

  /**
   * Converts TypeParameter to CSV row format
   */
  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      this.position.toString(),
      EntityUtils.escapeTsv(this.ownerTypeName),
      EntityUtils.escapeTsv(this.ownerQualifiedName),
      this.filePath,
      this.startLine.toString(),
      this.typeRegistryLinkHash,
      this.typeParameterUniqueHash,
    ].join('\t');
  }

  /**
   * Returns CSV header for TypeParameter export
   */
  getCsvHeader(): string {
    return [
      'paramName',
      'position',
      'ownerTypeName',
      'ownerQualifiedName',
      'filePath',
      'startLine',
      'typeRegistryLinkHash',
      'typeParameterUniqueHash',
    ].join('\t');
  }
}
