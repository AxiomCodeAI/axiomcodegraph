import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { GradleCommentKind } from '@/enums/gradle/comments/GradleCommentKind';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A comment in a Gradle script.
 *
 * Java and Python both carry a comment relation; Gradle needs one more than
 * either. Build files put a disproportionate share of their meaning in
 * comments — a pinned version nearly always has a "// pinned: CVE-…" beside
 * it, an exclusion has the ticket that motivated it, and a commented-out
 * dependency is a deliberate statement about what the build does not have.
 * None of that survives if comments are dropped at the lexer.
 *
 * `isCommentedOutCode` is a structural guess, not a semantic one: it marks a
 * line comment whose body parses as something the extractor would otherwise
 * have recognised (a dependency configuration, an `apply`, an `id`). It is a
 * hint for a consumer, never used to emit a phantom declaration.
 *
 * ## CSV Export Format
 *
 * Column order:
 * 1. commentKind, text, isCommentedOutCode
 * 2. ownerBlockHash, nextDeclarationHash, scriptHash
 * 3. filePath, baseMservPath, startLine, endLine, startColumn, endColumn
 * 4. serviceVersionLinkHash
 * 5. gradleCommentUniqueHash (LAST)
 */
export class GradleComment implements EntityIdentifiable {
  private commentKind: GradleCommentKind;
  private text: string;
  private isCommentedOutCode: boolean;
  private ownerBlockHash: string;
  private nextDeclarationHash: string;
  private scriptHash: string;
  private filePath: string;
  private baseMservPath: string;
  private startLine: number;
  private endLine: number;
  private startColumn: number;
  private endColumn: number;
  private serviceVersionLinkHash: string;
  private gradleCommentUniqueHash: string = '';

  private constructor(builder: GradleCommentBuilder) {
    this.commentKind = builder.commentKind;
    this.text = builder.text;
    this.isCommentedOutCode = builder.isCommentedOutCode;
    this.ownerBlockHash = builder.ownerBlockHash;
    this.nextDeclarationHash = builder.nextDeclarationHash;
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
    commentKind: GradleCommentKind,
    text: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ): GradleCommentBuilder {
    return new GradleCommentBuilder(
      commentKind, text, scriptHash, filePath, baseMservPath,
      startLine, endLine, startColumn, endColumn, serviceVersionLinkHash
    );
  }

  getCommentKind(): GradleCommentKind { return this.commentKind; }
  getText(): string { return this.text; }
  getIsCommentedOutCode(): boolean { return this.isCommentedOutCode; }
  getOwnerBlockHash(): string { return this.ownerBlockHash; }
  getNextDeclarationHash(): string { return this.nextDeclarationHash; }
  getScriptHash(): string { return this.scriptHash; }
  getFilePath(): string { return this.filePath; }
  getBaseMservPath(): string { return this.baseMservPath; }
  getStartLine(): number { return this.startLine; }
  getEndLine(): number { return this.endLine; }
  getStartColumn(): number { return this.startColumn; }
  getEndColumn(): number { return this.endColumn; }
  getServiceVersionLinkHash(): string { return this.serviceVersionLinkHash; }

  setOwnerBlockHash(hash: string): void { this.ownerBlockHash = hash; }
  setNextDeclarationHash(hash: string): void { this.nextDeclarationHash = hash; }

  getHash(): string {
    return this.gradleCommentUniqueHash;
  }

  generateHash(): void {
    // Byte range, not start offset: two comments can begin on the same line
    // (`dep 'x' // a /* b */`) and a start-only key would collide.
    const content =
      this.scriptHash +
      '||' + this.startLine + ':' + this.startColumn +
      '||' + this.endLine + ':' + this.endColumn;

    this.gradleCommentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.GRADLE_COMMENT,
      content
    );
  }

  getEntryCombined(): string {
    return `gradle_comment[kind=${this.commentKind}, line=${this.startLine}, file=${this.filePath}]`;
  }

  toCsv(): string {
    return [
      this.commentKind,
      EntityUtils.escapeTsv(this.text),
      this.isCommentedOutCode.toString(),
      this.ownerBlockHash,
      this.nextDeclarationHash,
      this.scriptHash,
      this.filePath,
      this.baseMservPath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.startColumn.toString(),
      this.endColumn.toString(),
      this.serviceVersionLinkHash,
      this.gradleCommentUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'commentKind',
      'text',
      'isCommentedOutCode',
      'ownerBlockHash',
      'nextDeclarationHash',
      'scriptHash',
      'filePath',
      'baseMservPath',
      'startLine',
      'endLine',
      'startColumn',
      'endColumn',
      'serviceVersionLinkHash',
      'gradleCommentUniqueHash',
    ].join('\t');
  }
}

class GradleCommentBuilder {
  commentKind: GradleCommentKind;
  text: string;
  isCommentedOutCode: boolean = false;
  ownerBlockHash: string = '';
  nextDeclarationHash: string = '';
  scriptHash: string;
  filePath: string;
  baseMservPath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  serviceVersionLinkHash: string;

  constructor(
    commentKind: GradleCommentKind,
    text: string,
    scriptHash: string,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionLinkHash: string
  ) {
    this.commentKind = commentKind;
    this.text = text;
    this.scriptHash = scriptHash;
    this.filePath = filePath;
    this.baseMservPath = baseMservPath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.startColumn = startColumn;
    this.endColumn = endColumn;
    this.serviceVersionLinkHash = serviceVersionLinkHash;
  }

  withIsCommentedOutCode(v: boolean): GradleCommentBuilder { this.isCommentedOutCode = v; return this; }
  withOwnerBlockHash(v: string): GradleCommentBuilder { this.ownerBlockHash = v; return this; }
  withNextDeclarationHash(v: string): GradleCommentBuilder { this.nextDeclarationHash = v; return this; }

  build(): GradleComment {
    return new (GradleComment as any)(this);
  }
}
