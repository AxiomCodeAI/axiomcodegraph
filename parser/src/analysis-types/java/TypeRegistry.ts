import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TypeAccess, TypeCategory, TypeModifier, TypePlacement } from '@/enums';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

export class TypeRegistry implements EntityIdentifiable {
  private name: string;
  private qualifiedName: string;
  private fileName: string;
  private typeCategory: TypeCategory;
  private typeAccess: TypeAccess;
  private typeModifier?: string;
  private typePlacement: TypePlacement;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private isExternal: boolean;
  private serviceVersionLinkHash: string;
  private typeRegistryUniqueHash?: string;

  constructor(
    name: string,
    qualifiedName: string,
    fileName: string,
    typeCategory: TypeCategory,
    typeAccess: TypeAccess,
    typePlacement: TypePlacement,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    isExternal: boolean,
    serviceVersionHash: string
  ) {
    this.name = name;
    this.qualifiedName = qualifiedName;
    this.fileName = fileName;
    this.typeCategory = typeCategory;
    this.typeAccess = typeAccess;
    this.typePlacement = typePlacement;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.isExternal = isExternal;
    this.serviceVersionLinkHash = serviceVersionHash;
  }

  getName(): string {
    return this.name;
  }

  getQualifiedName(): string {
    return this.qualifiedName;
  }

  getFileName(): string {
    return this.fileName;
  }

  getTypeCategory(): TypeCategory {
    return this.typeCategory;
  }

  getTypeAccess(): TypeAccess {
    return this.typeAccess;
  }

  getTypeModifier(): string | undefined {
    return this.typeModifier;
  }

  getTypePlacement(): TypePlacement {
    return this.typePlacement;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getBaseMservPath(): string {
    return this.baseMservPath;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getEndLine(): number {
    return this.endLine;
  }

  isExternalType(): boolean {
    return this.isExternal;
  }

  getServiceVersionLinkHash(): string {
    return this.serviceVersionLinkHash;
  }

  getTypeRegistryUniqueHash(): string | undefined {
    return this.typeRegistryUniqueHash;
  }

  addModifier(modifier: TypeModifier | null): void {
    if (modifier === null) return;

    if (!this.typeModifier || this.typeModifier.trim() === '') {
      this.typeModifier = modifier;
    } else {
      this.typeModifier += ',' + modifier;
    }
  }

  getHash(): string {
    return this.typeRegistryUniqueHash || '';
  }

  /**
   * Sets a pre-generated hash for this type registry entry.
   * Used for anonymous classes where the hash is generated during expression extraction.
   */
  setHash(hash: string): void {
    this.typeRegistryUniqueHash = hash;
  }

  generateHash(): void {
    const content = `${this.name}${this.qualifiedName}${this.fileName}${this.filePath.trim()}${this.baseMservPath.trim()}${this.startLine}${this.endLine}${this.isExternal}${this.serviceVersionLinkHash}`;
    this.typeRegistryUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TYPE_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_type_registry[name=${this.getName()}, qualified=${this.getQualifiedName()}, category=${this.getTypeCategory()}, access=${this.getTypeAccess()}, placement=${this.getTypePlacement()}, modifier=${this.getTypeModifier() || 'NONE'}, external=${this.isExternalType()}, file=${this.getFileName()}, lines=${this.getStartLine()}-${this.getEndLine()}, service=${this.getServiceVersionLinkHash()}, hash=${this.getTypeRegistryUniqueHash()}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.qualifiedName),
      this.fileName,
      this.typeCategory,
      this.typeAccess,
      this.typeModifier || '',
      this.typePlacement,
      this.filePath,
      this.baseMservPath,
      this.startLine,
      this.endLine,
      this.isExternal,
      this.serviceVersionLinkHash,
      this.typeRegistryUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return 'name\tqualifiedName\tfileName\ttypeCategory\ttypeAccess\ttypeModifier\ttypePlacement\tfilePath\tbaseMservPath\tstartLine\tendLine\tisExternal\tserviceVersionLinkHash\ttypeRegistryUniqueHash';
  }
}
