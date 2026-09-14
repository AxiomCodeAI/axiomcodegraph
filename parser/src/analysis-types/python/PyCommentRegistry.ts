import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { PythonCommentKind } from '@/enums/python/comments';
import { PythonExpressionOwnerKind } from '@/enums/python/expressions';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One comment or docstring.
 *
 * Positions 0–8 mirror `java_comment`. What makes this more than prose capture
 * is that in Python most of these are DIRECTIVES rather than commentary, and a
 * consumer treating them as text loses the instruction: an encoding cookie
 * decides how the file decodes, a `# type:` comment carries a real annotation
 * that `ast` will parse, and a `# noqa` is an explicit decision that a rule
 * reporting the suppressed thing is arguing with.
 *
 * Docstrings appear here AND in `py_expression` as a `LITERAL`. The duplication
 * is intentional — a docstring genuinely is a string expression and `ast` says
 * so — and §2.17 requires a recall check to whitelist it, or it reads as a
 * permanent recall failure.
 *
 * ## Column order (frozen — schema v7 §2.17, 15 columns)
 *
 * **PK** `PY_COMMENT_md5(filePath ‖ kind ‖ startLine ‖ startColumn ‖ endLine ‖ endColumn)`
 */
export class PyCommentRegistry implements EntityIdentifiable {
  private kind: PythonCommentKind;
  private text: string;
  private filePath: string;
  private startLine: number;
  private startColumn: number;
  private endLine: number;
  private endColumn: number;
  private ownerHash: string;
  private commentIndex: number;
  private ownerKind: PythonExpressionOwnerKind;
  private pyModuleLinkHash: string;
  private typeCommentPayload: string;
  private isDocstring: boolean;
  private serviceVersionLinkHash: string;
  private pyCommentUniqueHash: string = '';

  constructor(
    kind: PythonCommentKind,
    text: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    ownerHash: string,
    commentIndex: number,
    ownerKind: PythonExpressionOwnerKind,
    pyModuleLinkHash: string,
    typeCommentPayload: string,
    isDocstring: boolean,
    serviceVersionLinkHash: string
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
    this.ownerKind = ownerKind;
    this.pyModuleLinkHash = pyModuleLinkHash;
    this.typeCommentPayload = typeCommentPayload;
    this.isDocstring = isDocstring;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getKind(): PythonCommentKind {
    return this.kind;
  }

  getText(): string {
    return this.text;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getOwnerHash(): string {
    return this.ownerHash;
  }

  getTypeCommentPayload(): string {
    return this.typeCommentPayload;
  }

  getIsDocstring(): boolean {
    return this.isDocstring;
  }

  getHash(): string {
    return this.pyCommentUniqueHash;
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

    this.pyCommentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.PY_COMMENT,
      content
    );
  }

  getEntryCombined(): string {
    return `py_comment[kind=${this.kind}, line=${this.startLine}, text=${this.text.slice(0, 40)}]`;
  }

  toCsv(): string {
    return [
      this.kind,
      EntityUtils.escapeTsv(this.text),
      EntityUtils.escapeTsv(this.filePath),
      this.startLine,
      this.startColumn,
      this.endLine,
      this.endColumn,
      this.ownerHash,
      this.commentIndex,
      this.ownerKind,
      this.pyModuleLinkHash,
      EntityUtils.escapeTsv(this.typeCommentPayload),
      this.isDocstring,
      this.serviceVersionLinkHash,
      this.pyCommentUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'kind',
      'text',
      'filePath',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
      'ownerHash',
      'commentIndex',
      'ownerKind',
      'pyModuleLinkHash',
      'typeCommentPayload',
      'isDocstring',
      'serviceVersionLinkHash',
      'pyCommentUniqueHash',
    ].join('\t');
  }
}
