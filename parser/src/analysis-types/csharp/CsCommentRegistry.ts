import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsCommentKind } from '@/enums/csharp/comments';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A comment — schema §3.20 v1.4, **15 columns**.
 *
 * `directiveKind` was DELETED by ruling in v1.4. A directive is not a comment,
 * `cs_preproc_region` already holds it, and a column that can never vary is
 * worse than absent because a consumer reads it as evidence.
 *
 * ## XML doc is NOT a type channel here, and that is the port that does not carry
 *
 * In JavaScript, JSDoc is the ONLY place a type is written, so dropping it
 * loses the type outright. C# has declaration-site types, so `<param name="x">`
 * documents a parameter whose type is already a fact in `cs_method_parameter`.
 * Treating XML doc as a fallback annotation would introduce a second,
 * lower-confidence source for something already known — and a consumer would
 * have to decide which wins.
 *
 * So `xmlDocTags` is a comma-set of tag NAMES and nothing more: enough to
 * answer "is this documented" and "does it inherit its docs", which are the two
 * questions the tags can answer without parsing prose.
 *
 * ## The comma-SET is sorted; the tag list is not ordered information
 *
 * Unlike `cs_block.catchTypeNames`, where the first match wins at runtime and
 * order is semantic, `<summary>` before `<param>` means nothing. A set keeps
 * two files that document the same things in a different order from producing
 * two different cells.
 */
export class CsCommentRegistry implements EntityIdentifiable {
  static readonly ARITY = 15;
  static readonly RELATION = 'cs_comment';

  readonly commentKind: CsCommentKind;
  readonly commentText: string;
  readonly ownerHash: string;
  readonly ownerKind: CsDeclarationOwnerKind;
  readonly commentIndex: number;
  readonly csModuleLinkHash: string;
  readonly xmlDocTags: ReadonlySet<string>;
  readonly isDocumentation: boolean;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csCommentUniqueHash = ABSENT;

  constructor(props: {
    commentKind: CsCommentKind;
    commentText: string;
    ownerHash: string;
    ownerKind: CsDeclarationOwnerKind;
    commentIndex: number;
    csModuleLinkHash: string;
    xmlDocTags: ReadonlySet<string>;
    isDocumentation: boolean;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.commentKind = props.commentKind;
    this.commentText = props.commentText;
    this.ownerHash = props.ownerHash;
    this.ownerKind = props.ownerKind;
    this.commentIndex = props.commentIndex;
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.xmlDocTags = props.xmlDocTags;
    this.isDocumentation = props.isDocumentation;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_COMMENT_md5(csModuleLinkHash ‖ commentIndex ‖ startLine ‖
   * startColumn)`
   *
   * `commentIndex` is the ordinal within the FILE, in source order. Two
   * identical `// TODO` lines are two comments, and neither the text nor the
   * owner separates them — a file-wide ordinal does, and it does not depend on
   * which declaration a comment was attributed to.
   */
  generateHash(): void {
    this.csCommentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_COMMENT,
      keyOf(this.csModuleLinkHash, this.commentIndex, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.csCommentUniqueHash;
  }

  getEntryCombined(): string {
    return (
      `cs_comment[kind=${this.commentKind}, owner=${this.ownerKind}, ` +
      `index=${this.commentIndex}, doc=${this.isDocumentation}, ` +
      `hash=${this.csCommentUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.commentKind,
        text(this.commentText),
        this.ownerHash,
        this.ownerKind,
        num(this.commentIndex),
        this.csModuleLinkHash,
        text(commaSet(this.xmlDocTags)),
        bool(this.isDocumentation),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.endColumn),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csCommentUniqueHash,
      ],
      CsCommentRegistry.ARITY,
      CsCommentRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'commentKind', 'commentText', 'ownerHash', 'ownerKind', 'commentIndex',
        'csModuleLinkHash', 'xmlDocTags', 'isDocumentation',
        'startLine', 'endLine', 'startColumn', 'endColumn',
        'isExternal', 'serviceVersionLinkHash', 'csCommentUniqueHash',
      ],
      CsCommentRegistry.ARITY,
      CsCommentRegistry.RELATION
    );
  }
}
