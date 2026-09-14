import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CommentKind } from '@/enums/java/comments';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Represents a comment in Java source code, linked to the entity it documents.
 *
 * ## Comment Kinds
 *
 * - **LINE_COMMENT**: `// single line comment`
 * - **BLOCK_COMMENT**: `/* multi-line block comment *​/`
 * - **JAVADOC**: `/** documentation comment *​/`
 *
 * ## Association Rules
 *
 * Comments are associated with the nearest following declaration or statement:
 * - Comments in `class_body` → linked to the next field, method, or inner type
 * - Comments in `program` → linked to the next type declaration
 * - Comments in method `block` → linked to the next statement or variable
 * - End-of-line comments → linked to the entity on the same line
 *
 * ## Comment Index
 *
 * When multiple comments precede the same entity, `commentIndex` preserves
 * their order (0-based). For example:
 *
 * ```java
 * // Comment 0
 * /** Comment 1 *​/
 * // Comment 2
 * public void method() { ... }
 * ```
 *
 * All three comments have the same `ownerHash` (the method), with
 * `commentIndex` values 0, 1, 2 respectively.
 */
export class CommentRegistry implements EntityIdentifiable {
  private kind: CommentKind;
  private text: string;
  private startLine: number;
  private startColumn: number;
  private endLine: number;
  private endColumn: number;
  private ownerHash: string;
  private commentIndex: number;
  private filePath: string;
  private commentUniqueHash: string = '';

  private constructor(builder: CommentRegistryBuilder) {
    this.kind = builder.kind;
    this.text = builder.text;
    this.startLine = builder.startLine;
    this.startColumn = builder.startColumn;
    this.endLine = builder.endLine;
    this.endColumn = builder.endColumn;
    this.ownerHash = builder.ownerHash;
    this.commentIndex = builder.commentIndex;
    this.filePath = builder.filePath;

    this.generateHash();
  }

  static builder(
    kind: CommentKind,
    text: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    ownerHash: string,
    commentIndex: number
  ): CommentRegistryBuilder {
    return new CommentRegistryBuilder(
      kind, text, filePath,
      startLine, startColumn, endLine, endColumn,
      ownerHash, commentIndex
    );
  }

  // === Getters ===

  getKind(): CommentKind {
    return this.kind;
  }

  getText(): string {
    return this.text;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getStartColumn(): number {
    return this.startColumn;
  }

  getEndLine(): number {
    return this.endLine;
  }

  getEndColumn(): number {
    return this.endColumn;
  }

  getOwnerHash(): string {
    return this.ownerHash;
  }

  getCommentIndex(): number {
    return this.commentIndex;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getHash(): string {
    return this.commentUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.kind +
      '||' +
      this.startLine +
      '||' +
      this.startColumn +
      '||' +
      this.endLine +
      '||' +
      this.endColumn;

    this.commentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.COMMENT_REGISTRY,
      content
    );
  }

  getEntryCombined(): string {
    return `java_comment[kind=${this.kind}, owner=${this.ownerHash}, index=${this.commentIndex}, lines=${this.startLine}-${this.endLine}, hash=${this.commentUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      EntityUtils.escapeTsv(this.text),
      this.startLine.toString(),
      this.startColumn.toString(),
      this.endLine.toString(),
      this.endColumn.toString(),
      this.ownerHash,
      this.commentIndex.toString(),
      this.filePath,
      this.commentUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'commentKind',
      'commentText',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
      'ownerHash',
      'commentIndex',
      'filePath',
      'commentUniqueHash',
    ].join('\t');
  }

}

/**
 * Builder for CommentRegistry
 */
class CommentRegistryBuilder {
  kind: CommentKind;
  text: string;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  ownerHash: string;
  commentIndex: number;

  constructor(
    kind: CommentKind,
    text: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    ownerHash: string,
    commentIndex: number
  ) {
    this.kind = kind;
    this.text = text;
    this.filePath = filePath;
    this.startLine = startLine;
    this.startColumn = startColumn;
    this.endLine = endLine;
    this.endColumn = endColumn;
    this.ownerHash = ownerHash;
    this.commentIndex = commentIndex;
  }

  build(): CommentRegistry {
    return new (CommentRegistry as any)(this);
  }
}
