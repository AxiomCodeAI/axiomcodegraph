import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';
import { GradleBlockType } from '@/enums/gradle/blocks/GradleBlockType';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';

/**
 * Represents a single block/closure in a Gradle build file.
 *
 * Blocks form a tree via `parentBlockHash`. Every nested `{ }` in a Gradle
 * file — DSL blocks, control flow, closures — gets a row.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. blockType, blockName, expression, depth, childBlockCount, declarationCount
 * 2. dslDialect
 * 3. parentBlockHash, tryStatementHash, caughtExceptionTypes
 * 4. filePath, baseMservPath, startLine, endLine
 * 5. serviceVersionLinkHash
 * 6. gradleBlockUniqueHash (LAST)
 */
export class GradleBlock implements EntityIdentifiable {
  private blockType: GradleBlockType;
  private blockName: string;
  private expression: string;
  private depth: number;
  private childBlockCount: number;
  private declarationCount: number;
  private dslDialect: GradleDSLDialect;
  private parentBlockHash: string;
  private tryStatementHash: string;
  private caughtExceptionTypes: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private serviceVersionLinkHash: string;
  private gradleBlockUniqueHash: string = '';

  private constructor(builder: GradleBlockBuilder) {
    this.blockType = builder.blockType;
    this.blockName = builder.blockName;
    this.expression = builder.expression;
    this.depth = builder.depth;
    this.childBlockCount = builder.childBlockCount;
    this.declarationCount = builder.declarationCount;
    this.dslDialect = builder.dslDialect;
    this.parentBlockHash = builder.parentBlockHash;
    this.tryStatementHash = builder.tryStatementHash;
    this.caughtExceptionTypes = builder.caughtExceptionTypes;
    this.filePath = builder.filePath;
    this.baseMservPath = builder.baseMservPath;
    this.startLine = builder.startLine;
    this.endLine = builder.endLine;
    this.serviceVersionLinkHash = builder.serviceVersionLinkHash;

    this.generateHash();
  }

  static builder(
    blockType: GradleBlockType,
    depth: number,
    dslDialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ): GradleBlockBuilder {
    return new GradleBlockBuilder(
      blockType, depth, dslDialect, filePath, baseMservPath,
      startLine, endLine, serviceVersionLinkHash
    );
  }

  getBlockType(): GradleBlockType { return this.blockType; }
  getBlockName(): string { return this.blockName; }
  getExpression(): string { return this.expression; }
  getDepth(): number { return this.depth; }
  getChildBlockCount(): number { return this.childBlockCount; }
  getDeclarationCount(): number { return this.declarationCount; }
  getDslDialect(): GradleDSLDialect { return this.dslDialect; }
  getParentBlockHash(): string { return this.parentBlockHash; }
  getTryStatementHash(): string { return this.tryStatementHash; }
  getCaughtExceptionTypes(): string { return this.caughtExceptionTypes; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  getHash(): string {
    return this.gradleBlockUniqueHash;
  }

  generateHash(): void {
    const content =
      this.blockType +
      '||' + this.blockName +
      '||' + this.filePath +
      '||' + this.baseMservPath +
      '||' + this.startLine +
      '||' + this.endLine +
      '||' + this.serviceVersionLinkHash;

    this.gradleBlockUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_BLOCK,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_block[type=${this.blockType}, name=${this.blockName}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.blockType,
      this.blockName,
      EntityUtils.escapeTsv(this.expression),
      this.depth.toString(),
      this.childBlockCount.toString(),
      this.declarationCount.toString(),
      this.dslDialect,
      this.parentBlockHash,
      this.tryStatementHash,
      this.caughtExceptionTypes,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.serviceVersionLinkHash,
      this.gradleBlockUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'blockType',
      'blockName',
      'expression',
      'depth',
      'childBlockCount',
      'declarationCount',
      'dslDialect',
      'parentBlockHash',
      'tryStatementHash',
      'caughtExceptionTypes',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'serviceVersionLinkHash',
      'gradleBlockUniqueHash',
    ].join('\t');
  }
}

class GradleBlockBuilder {
  blockType: GradleBlockType;
  blockName: string = '';
  expression: string = '';
  depth: number;
  childBlockCount: number = 0;
  declarationCount: number = 0;
  dslDialect: GradleDSLDialect;
  parentBlockHash: string = '';
  tryStatementHash: string = '';
  caughtExceptionTypes: string = '';
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  serviceVersionLinkHash: string;

  constructor(
    blockType: GradleBlockType,
    depth: number,
    dslDialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    this.blockType = blockType;
    this.depth = depth;
    this.dslDialect = dslDialect;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withBlockName(blockName: string): GradleBlockBuilder {
    this.blockName = blockName;
    return this;
  }

  withExpression(expression: string): GradleBlockBuilder {
    this.expression = expression;
    return this;
  }

  withChildBlockCount(count: number): GradleBlockBuilder {
    this.childBlockCount = count;
    return this;
  }

  withDeclarationCount(count: number): GradleBlockBuilder {
    this.declarationCount = count;
    return this;
  }

  withParentBlockHash(hash: string): GradleBlockBuilder {
    this.parentBlockHash = hash;
    return this;
  }

  withTryStatementHash(hash: string): GradleBlockBuilder {
    this.tryStatementHash = hash;
    return this;
  }

  withCaughtExceptionTypes(types: string): GradleBlockBuilder {
    this.caughtExceptionTypes = types;
    return this;
  }

  build(): GradleBlock {
    return new (GradleBlock as any)(this);
  }
}
