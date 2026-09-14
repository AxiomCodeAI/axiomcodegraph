import { ABSENT, bool, boundedText, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { JS_COMMENT_TEXT_LIMIT } from '@/constants/javascript-constants';
import {
  JsCommentAttachmentKind,
  JsCommentKind,
  JsDirectiveKind,
} from '@/enums/javascript/comments';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A comment — schema §3.15, 16 columns.
 *
 * Comments are **trivia**: not in the AST, so no tree walk reaches them and the
 * scan is separate by necessity.
 *
 * ## `declaresType` is what makes "a comment can be a declaration" checkable
 *
 * 1,825 `@typedef` and 103 `@callback` tags declare types with no declaration
 * syntax anywhere. The gate asserts that every `js_type` row with
 * `evidenceKind = COMMENT_ONLY` has a `jsdocCommentLinkHash` pointing at a
 * comment whose `declaresType` is true — so the two relations have to agree
 * about which comments are declarations, rather than each asserting it alone.
 *
 * `jsdocTagNames` is a comma **list**, ordered and with repeats —
 * `param,param,returns` — because the repetition and the order are both
 * information. It is not a sorted set.
 */
export class JsCommentRegistry implements EntityIdentifiable {
  static readonly ARITY = 16;

  readonly commentKind: JsCommentKind;
  readonly text: string;
  readonly isJsdoc: boolean;
  /** Comma-joined and ORDERED, with repeats: `param,param,returns`. Not a sorted set. */
  readonly jsdocTagNames: string;
  readonly jsdocTagCount: number;
  /** Carries `@typedef`/`@callback` — this comment IS a declaration. */
  readonly declaresType: boolean;
  readonly directiveKind: JsDirectiveKind;
  private attachedToKind: JsCommentAttachmentKind;
  private attachedToLinkHash = ABSENT;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsCommentUniqueHash = ABSENT;

  constructor(props: {
    commentKind: JsCommentKind;
    text: string;
    isJsdoc: boolean;
    jsdocTagNames: string;
    jsdocTagCount: number;
    declaresType: boolean;
    directiveKind: JsDirectiveKind;
    attachedToKind: JsCommentAttachmentKind;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    serviceVersionLinkHash: string;
  }) {
    this.commentKind = props.commentKind;
    this.text = props.text;
    this.isJsdoc = props.isJsdoc;
    this.jsdocTagNames = props.jsdocTagNames;
    this.jsdocTagCount = props.jsdocTagCount;
    this.declaresType = props.declaresType;
    this.directiveKind = props.directiveKind;
    this.attachedToKind = props.attachedToKind;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsCommentUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_COMMENT,
      keyOf(this.ownerModuleLinkHash, this.startLine, this.startColumn, this.endLine)
    );
  }

  getHash(): string {
    return this.jsCommentUniqueHash;
  }

  setAttachedToKind(value: JsCommentAttachmentKind): void {
    this.attachedToKind = value;
  }
  setAttachedToLinkHash(hash: string): void {
    this.attachedToLinkHash = hash;
  }
  /** Read when the declaration relations link back to the comment. */
  attachedToLinkHashValue(): string {
    return this.attachedToLinkHash;
  }

  getEntryCombined(): string {
    return `js_comment[hash=${this.jsCommentUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.commentKind,
        boundedText(this.text, JS_COMMENT_TEXT_LIMIT),
        bool(this.isJsdoc),
        text(this.jsdocTagNames),
        num(this.jsdocTagCount),
        bool(this.declaresType),
        this.directiveKind,
        this.attachedToKind,
        this.attachedToLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsCommentUniqueHash,
      ],
      JsCommentRegistry.ARITY,
      'js_comment'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'commentKind',
        'text',
        'isJsdoc',
        'jsdocTagNames',
        'jsdocTagCount',
        'declaresType',
        'directiveKind',
        'attachedToKind',
        'attachedToLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'endLine',
        'isExternal',
        'serviceVersionLinkHash',
        'jsCommentUniqueHash',
      ],
      JsCommentRegistry.ARITY,
      'js_comment'
    );
  }
}
