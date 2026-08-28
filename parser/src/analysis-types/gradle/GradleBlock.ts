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
 * 3. parentBlockHash, tryStatementHash, caughtExceptionTypes, scriptHash
 * 4. filePath, baseMservPath, startLine, endLine, startColumn, endColumn
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
  private scriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
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
    this.scriptHash = builder.scriptHash;
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
    blockType: GradleBlockType,
    depth: number,
    dslDialect: GradleDSLDialect,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleBlockBuilder {
    return new GradleBlockBuilder(
      blockType, depth, dslDialect, scriptHash, filePath, baseMservPath,
      startLine, endLine, startColumn, endColumn, serviceVersionLinkHash
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
  getScriptHash(): string { return this.scriptHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  /**
   * Both counts are known only after the whole subtree has been walked, so
   * they are written back rather than passed to the builder. Neither re-keys
   * the row: a block that turned out to contain three declarations is the same
   * block it was before they were counted, and re-hashing would orphan every
   * child that already chained off the old key.
   */
  setChildBlockCount(count: number): void { this.childBlockCount = count; }
  setDeclarationCount(count: number): void { this.declarationCount = count; }

  getHash(): string {
    return this.gradleBlockUniqueHash;
  }

  generateHash(): void {
    // Chains off the parent block and the script, and uses the full byte range
    // rather than the start offset. Both matter here. Every subproject has a
    // `dependencies` block at some line, and `a.each { b.each { } }` puts two
    // closures on one line whose start positions differ but whose type and
    // name do not. A key derived from type + name + start alone collides in
    // both cases, and a collision in the block relation silently reparents
    // every declaration underneath it.
    const content =
      this.scriptHash +
      '||' + this.parentBlockHash +
      '||' + this.blockType +
      '||' + this.blockName +
      '||' + this.startLine + ':' + this.startColumn +
      '||' + this.endLine + ':' + this.endColumn;

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
      this.scriptHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
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
      'scriptHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
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
  scriptHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    blockType: GradleBlockType,
    depth: number,
    dslDialect: GradleDSLDialect,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.blockType = blockType;
    this.depth = depth;
    this.dslDialect = dslDialect;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
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
