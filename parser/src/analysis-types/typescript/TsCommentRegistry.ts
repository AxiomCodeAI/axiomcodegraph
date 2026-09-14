import { ABSENT, commaSet, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsCommentKind, TsDirectiveKind } from '@/enums/typescript/comments';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A comment, JSDoc block, triple-slash directive or ts-directive —
 * schema §4.17, 14 columns. Positions 0–9 mirror `java_comment`.
 *
 * ## Two of the five kinds are not commentary
 *
 * A `/// <reference />` is a MODULE EDGE — in ambient code it is often the only
 * edge a file has — and a `@ts-ignore` SUPPRESSES A DIAGNOSTIC. Both change what
 * the program means, so both are recorded with a `directiveKind` rather than as
 * prose. A fact base that treats them as text loses a dependency and a
 * suppression.
 *
 * ## JSDoc carries semantics even in `.ts`
 *
 * `@deprecated`, `@internal` and `@template` are read by tooling and by people,
 * and `@ts-expect-error` is read by the compiler. `jsDocTags` is a comma-set of
 * the tag names present so a rule can filter without re-parsing the text.
 */
export class TsCommentRegistry implements EntityIdentifiable {
  static readonly ARITY = 14;

  readonly commentKind: TsCommentKind;
  readonly commentText: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly ownerHash: string;
  readonly commentIndex: number;
  readonly filePath: string;
  readonly tsModuleLinkHash: string;
  readonly jsDocTags: ReadonlySet<string>;
  readonly directiveKind: TsDirectiveKind | '';
  readonly serviceVersionLinkHash: string;
  private tsCommentUniqueHash = ABSENT;

  constructor(props: {
    commentKind: TsCommentKind;
    commentText: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    ownerHash: string;
    commentIndex: number;
    filePath: string;
    tsModuleLinkHash: string;
    jsDocTags: ReadonlySet<string>;
    directiveKind: TsDirectiveKind | '';
    serviceVersionLinkHash: string;
  }) {
    this.commentKind = props.commentKind;
    this.commentText = props.commentText;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.ownerHash = props.ownerHash;
    this.commentIndex = props.commentIndex;
    this.filePath = props.filePath;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.jsDocTags = props.jsDocTags;
    this.directiveKind = props.directiveKind;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_COMMENT_md5(filePath ‖ startLine ‖ startColumn ‖ commentIndex)` */
  generateHash(): void {
    this.tsCommentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_COMMENT,
      keyOf(this.filePath, this.startLine, this.startColumn, this.commentIndex)
    );
  }

  getHash(): string {
    return this.tsCommentUniqueHash;
  }

  getEntryCombined(): string {
    return `ts_comment[kind=${this.commentKind}, line=${this.startLine}, directive=${this.directiveKind}, hash=${this.tsCommentUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.commentKind,
        text(this.commentText),
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        num(this.endColumn),
        this.ownerHash,
        num(this.commentIndex),
        text(this.filePath),
        this.tsModuleLinkHash,
        commaSet(this.jsDocTags),
        this.directiveKind,
        this.serviceVersionLinkHash,
        this.tsCommentUniqueHash,
      ],
      TsCommentRegistry.ARITY,
      'ts_comment'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'commentKind', 'commentText', 'startLine', 'startColumn', 'endLine', 'endColumn',
        'ownerHash', 'commentIndex', 'filePath', 'tsModuleLinkHash', 'jsDocTags',
        'directiveKind', 'serviceVersionLinkHash', 'tsCommentUniqueHash',
      ],
      TsCommentRegistry.ARITY,
      'ts_comment'
    );
  }
}
