import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { GradleParseGapReason } from '@/enums/gradle/parse-gaps/GradleParseGapReason';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A region of a Gradle script that is not fully represented in the other rows.
 *
 * The Gradle front end is the one place in this parser where the grammar does
 * not match the language. tree-sitter-groovy parses Groovy; it is handed
 * Kotlin DSL as well, plus Groovy constructs it has no rule for. To get a
 * usable tree the extractor rewrites the source first, and some of those
 * rewrites delete tokens.
 *
 * Every ERROR node, every MISSING node, and every lossy rewrite gets a row
 * here, with the ORIGINAL source text and the ORIGINAL offsets — not the
 * rewritten ones — so a consumer can go and read what was actually there.
 *
 * This relation is the difference between "this block declares no dependency"
 * and "this block was rewritten and the parser never saw inside it". Both
 * produce zero dependency rows. Only one of them is true.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. reason, nodeType, originalText
 * 2. enclosingBlockHash, scriptHash
 * 3. filePath, baseMservPath, startLine, endLine, startColumn, endColumn
 * 4. serviceVersionLinkHash
 * 5. gradleParseGapUniqueHash (LAST)
 */
export class GradleParseGap implements EntityIdentifiable {
  private reason: GradleParseGapReason;
  private nodeType: string;
  private originalText: string;
  private enclosingBlockHash: string;
  private scriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private gradleParseGapUniqueHash: string = '';

  private constructor(builder: GradleParseGapBuilder) {
    this.reason = builder.reason;
    this.nodeType = builder.nodeType;
    this.originalText = builder.originalText;
    this.enclosingBlockHash = builder.enclosingBlockHash;
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
    reason: GradleParseGapReason,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleParseGapBuilder {
    return new GradleParseGapBuilder(
      reason, scriptHash, filePath, baseMservPath,
      startLine, endLine, startColumn, endColumn, serviceVersionLinkHash
    );
  }

  getReason(): GradleParseGapReason { return this.reason; }
  getNodeType(): string { return this.nodeType; }
  getOriginalText(): string { return this.originalText; }
  getEnclosingBlockHash(): string { return this.enclosingBlockHash; }
  getScriptHash(): string { return this.scriptHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  setEnclosingBlockHash(hash: string): void { this.enclosingBlockHash = hash; }

  getHash(): string {
    return this.gradleParseGapUniqueHash;
  }

  generateHash(): void {
    const content =
      this.scriptHash +
      '||' + this.reason +
      '||' + this.startLine + ':' + this.startColumn +
      '||' + this.endLine + ':' + this.endColumn;

    this.gradleParseGapUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_PARSE_GAP,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_parse_gap[reason=${this.reason}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.reason,
      EntityUtils.escapeTsv(this.nodeType),
      EntityUtils.escapeTsv(this.originalText),
      this.enclosingBlockHash,
      this.scriptHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.gradleParseGapUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'reason',
      'nodeType',
      'originalText',
      'enclosingBlockHash',
      'scriptHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'gradleParseGapUniqueHash',
    ].join('\t');
  }
}

class GradleParseGapBuilder {
  reason: GradleParseGapReason;
  nodeType: string = '';
  originalText: string = '';
  enclosingBlockHash: string = '';
  scriptHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    reason: GradleParseGapReason,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.reason = reason;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withNodeType(v: string): GradleParseGapBuilder { this.nodeType = v; return this; }
  withOriginalText(v: string): GradleParseGapBuilder { this.originalText = v; return this; }
  withEnclosingBlockHash(v: string): GradleParseGapBuilder { this.enclosingBlockHash = v; return this; }

  build(): GradleParseGap {
    return new (GradleParseGap as any)(this);
  }
}
