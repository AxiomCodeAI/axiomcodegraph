import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { GradleDeclarationType } from '@/enums/gradle/declarations/GradleDeclarationType';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';

/**
 * Represents a single declaration/statement within a Gradle block.
 *
 * Uses `declarationType` as a discriminator — the meaning of `name`, `value`,
 * `notation`, and `qualifier` varies by type (see design doc §3.2.1).
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. declarationType, name, value, notation, qualifier
 * 2. hasConfigBlock, reason
 * 3. dslDialect
 * 4. parentBlockHash
 * 5. filePath, baseMservPath, startLine, endLine
 * 6. serviceVersionLinkHash
 * 7. gradleDeclarationUniqueHash (LAST)
 */
export class GradleDeclaration implements EntityIdentifiable {
  private declarationType: GradleDeclarationType;
  private name: string;
  private value: string;
  private notation: string;
  private qualifier: string;
  private hasConfigBlock: boolean;
  private reason: string;
  private dslDialect: GradleDSLDialect;
  private parentBlockHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private gradleDeclarationUniqueHash: string = '';

  private constructor(builder: GradleDeclarationBuilder) {
    this.declarationType = builder.declarationType;
    this.name = builder.name;
    this.value = builder.value;
    this.notation = builder.notation;
    this.qualifier = builder.qualifier;
    this.hasConfigBlock = builder.hasConfigBlock;
    this.reason = builder.reason;
    this.dslDialect = builder.dslDialect;
    this.parentBlockHash = builder.parentBlockHash;
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
    declarationType: GradleDeclarationType,
    name: string,
    dslDialect: GradleDSLDialect,
    parentBlockHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleDeclarationBuilder {
    return new GradleDeclarationBuilder(
      declarationType, name, dslDialect, parentBlockHash,
      filePath, baseMservPath, startLine, endLine,
      startColumn, endColumn, serviceVersionLinkHash
    );
  }

  getDeclarationType(): GradleDeclarationType { return this.declarationType; }
  getName(): string { return this.name; }
  getValue(): string { return this.value; }
  getNotation(): string { return this.notation; }
  getQualifier(): string { return this.qualifier; }
  getHasConfigBlock(): boolean { return this.hasConfigBlock; }
  getReason(): string { return this.reason; }
  getDslDialect(): GradleDSLDialect { return this.dslDialect; }
  getParentBlockHash(): string { return this.parentBlockHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  getHash(): string {
    return this.gradleDeclarationUniqueHash;
  }

  generateHash(): void {
    const content =
      this.declarationType +
      '||' + this.name +
      '||' + this.value +
      '||' + this.filePath +
      '||' + this.baseMservPath +
      '||' + this.startLine +
      '||' + this.endLine +
      '||' + this.serviceVersionLinkHash;

    this.gradleDeclarationUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_DECLARATION,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_declaration[type=${this.declarationType}, name=${this.name}, value=${this.value}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.declarationType,
      EntityUtils.escapeTsv(this.name),
      EntityUtils.escapeTsv(this.value),
      this.notation,
      EntityUtils.escapeTsv(this.qualifier),
      this.hasConfigBlock.toString(),
      EntityUtils.escapeTsv(this.reason),
      this.dslDialect,
      this.parentBlockHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.gradleDeclarationUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'declarationType',
      'name',
      'value',
      'notation',
      'qualifier',
      'hasConfigBlock',
      'reason',
      'dslDialect',
      'parentBlockHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'gradleDeclarationUniqueHash',
    ].join('\t');
  }
}

class GradleDeclarationBuilder {
  declarationType: GradleDeclarationType;
  name: string;
  value: string = '';
  notation: string = '';
  qualifier: string = '';
  hasConfigBlock: boolean = false;
  reason: string = '';
  dslDialect: GradleDSLDialect;
  parentBlockHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    declarationType: GradleDeclarationType,
    name: string,
    dslDialect: GradleDSLDialect,
    parentBlockHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.declarationType = declarationType;
    this.name = name;
    this.dslDialect = dslDialect;
    this.parentBlockHash = parentBlockHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withValue(value: string): GradleDeclarationBuilder {
    this.value = value;
    return this;
  }

  withNotation(notation: string): GradleDeclarationBuilder {
    this.notation = notation;
    return this;
  }

  withQualifier(qualifier: string): GradleDeclarationBuilder {
    this.qualifier = qualifier;
    return this;
  }

  withHasConfigBlock(hasConfigBlock: boolean): GradleDeclarationBuilder {
    this.hasConfigBlock = hasConfigBlock;
    return this;
  }

  withReason(reason: string): GradleDeclarationBuilder {
    this.reason = reason;
    return this;
  }

  build(): GradleDeclaration {
    return new (GradleDeclaration as any)(this);
  }
}
