import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { GradleValueReferenceType } from '@/enums/gradle/value-references/GradleValueReferenceType';

/**
 * Represents a value reference found within a Gradle declaration or block.
 *
 * Captures every `${...}`, `$var`, `System.getenv()`, `findProperty()`,
 * provider call, ext property access, etc. Linked to both the owning
 * declaration AND owning block via hash.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. referenceExpression, referenceType, rawFragment, resolvedContext, defaultValue
 * 2. ownerDeclarationHash, ownerBlockHash
 * 3. filePath, baseMservPath, startLine, endLine
 * 4. serviceVersionLinkHash
 * 5. gradleValueReferenceUniqueHash (LAST)
 */
export class GradleValueReference implements EntityIdentifiable {
  private referenceExpression: string;
  private referenceType: GradleValueReferenceType;
  private rawFragment: string;
  private resolvedContext: string;
  private defaultValue: string;
  private ownerDeclarationHash: string;
  private ownerBlockHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private gradleValueReferenceUniqueHash: string = '';

  private constructor(builder: GradleValueReferenceBuilder) {
    this.referenceExpression = builder.referenceExpression;
    this.referenceType = builder.referenceType;
    this.rawFragment = builder.rawFragment;
    this.resolvedContext = builder.resolvedContext;
    this.defaultValue = builder.defaultValue;
    this.ownerDeclarationHash = builder.ownerDeclarationHash;
    this.ownerBlockHash = builder.ownerBlockHash;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.startColumn = builder.startColumn;
    this.endColumn = builder.endColumn;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    referenceExpression: string,
    referenceType: GradleValueReferenceType,
    rawFragment: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleValueReferenceBuilder {
    return new GradleValueReferenceBuilder(
      referenceExpression, referenceType, rawFragment,
      filePath, baseMservPath, startLine, endLine,
      startColumn, endColumn, serviceVersionLinkHash
    );
  }

  getReferenceExpression(): string { return this.referenceExpression; }
  getReferenceType(): GradleValueReferenceType { return this.referenceType; }
  getRawFragment(): string { return this.rawFragment; }
  getResolvedContext(): string { return this.resolvedContext; }
  getDefaultValue(): string { return this.defaultValue; }
  getOwnerDeclarationHash(): string { return this.ownerDeclarationHash; }
  getOwnerBlockHash(): string { return this.ownerBlockHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  setResolvedContext(context: string): void {
    this.resolvedContext = context;
  }

  getHash(): string {
    return this.gradleValueReferenceUniqueHash;
  }

  generateHash(): void {
    const content =
      this.referenceExpression +
      '||' + this.referenceType +
      '||' + this.rawFragment +
      '||' + this.ownerDeclarationHash +
      '||' + this.filePath +
      '||' + this.startLine +
      '||' + this.endLine +
      '||' + this.serviceVersionLinkHash;

    this.gradleValueReferenceUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_VALUE_REFERENCE,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_value_ref[expr=${this.referenceExpression}, type=${this.referenceType}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      EntityUtils.escapeTsv(this.referenceExpression),
      this.referenceType,
      EntityUtils.escapeTsv(this.rawFragment),
      this.resolvedContext,
      EntityUtils.escapeTsv(this.defaultValue),
      this.ownerDeclarationHash,
      this.ownerBlockHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.gradleValueReferenceUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'referenceExpression',
      'referenceType',
      'rawFragment',
      'resolvedContext',
      'defaultValue',
      'ownerDeclarationHash',
      'ownerBlockHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'gradleValueReferenceUniqueHash',
    ].join('\t');
  }
}

class GradleValueReferenceBuilder {
  referenceExpression: string;
  referenceType: GradleValueReferenceType;
  rawFragment: string;
  resolvedContext: string = '';
  defaultValue: string = '';
  ownerDeclarationHash: string = '';
  ownerBlockHash: string = '';
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    referenceExpression: string,
    referenceType: GradleValueReferenceType,
    rawFragment: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.referenceExpression = referenceExpression;
    this.referenceType = referenceType;
    this.rawFragment = rawFragment;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withResolvedContext(context: string): GradleValueReferenceBuilder {
    this.resolvedContext = context;
    return this;
  }

  withDefaultValue(defaultValue: string): GradleValueReferenceBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withOwnerDeclarationHash(hash: string): GradleValueReferenceBuilder {
    this.ownerDeclarationHash = hash;
    return this;
  }

  withOwnerBlockHash(hash: string): GradleValueReferenceBuilder {
    this.ownerBlockHash = hash;
    return this;
  }

  build(): GradleValueReference {
    return new (GradleValueReference as any)(this);
  }
}
