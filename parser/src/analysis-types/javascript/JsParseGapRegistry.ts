import { ABSENT, bool, boundedText, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { JS_COMMENT_TEXT_LIMIT } from '@/constants/javascript-constants';
import {
  JsParseGapKind,
} from '@/enums/javascript/parse-gaps';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * What the parser could not do — schema §3.16, 11 columns.
 *
 * Recorded as **data rather than a log line**. §9 of `BUILDING-A-PARSER.md`: if
 * the analyzer drops something for a structural reason it must say so, and on
 * one large framework checkout a nested config silently excluded 1,270 of 1,821 files because nothing
 * counted them — the run reported success with a fact base missing two thirds of
 * the project.
 *
 * A log line is not a count, and a count that is not in the fact base cannot be
 * joined against the rows that are. `relatedRelation` names the relation that
 * would have had the row, so a consumer can ask "what is missing from
 * `js_call_site` here" and get an answer.
 */
export class JsParseGapRegistry implements EntityIdentifiable {
  static readonly ARITY = 11;

  readonly gapKind: JsParseGapKind;
  readonly detail: string;
  /** Which relation would have had the row. */
  readonly relatedRelation: string;
  readonly relatedLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly isRecoverable: boolean;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsParseGapUniqueHash = ABSENT;

  constructor(props: {
    gapKind: JsParseGapKind;
    detail: string;
    relatedRelation: string;
    relatedLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    isRecoverable: boolean;
    serviceVersionLinkHash: string;
  }) {
    this.gapKind = props.gapKind;
    this.detail = props.detail;
    this.relatedRelation = props.relatedRelation;
    this.relatedLinkHash = props.relatedLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.isRecoverable = props.isRecoverable;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `JS_PARSE_GAP_md5(ownerModuleLinkHash ‖ gapKind ‖ startLine ‖ startColumn ‖ relatedLinkHash ‖ detail)`
   *
   * ## Why the position and the kind are not enough
   *
   * They were, on a 816-file corpus. On 4,561 files the key produced **121
   * duplicate primary keys**, and a duplicate does not collide — it DOUBLES,
   * which is the one failure shape that leaves nothing looking wrong.
   *
   * The cause is the compiler, not the walk. On an unterminated JSX element
   * `ts.createSourceFile` reports `1005: '</' expected.` **eleven times at the
   * same offset**, a recovery cascade rather than eleven problems. 194 of the
   * 196 duplicate rows were that.
   *
   * `relatedLinkHash` distinguishes gaps about different ROWS at one position —
   * a truncated call and its truncated callee share a start offset, which is
   * the whole of "identity is the byte range, not the start offset". `detail`
   * carries the diagnostic CODE, so two different diagnostics at one position
   * stay two facts.
   *
   * That makes the key discriminating. It does **not** deduplicate an identical
   * fact reported repeatedly — nothing about a key can — so the extractor drops
   * exact repeats, and the two halves are needed together.
   */
  generateHash(): void {
    this.jsParseGapUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_PARSE_GAP,
      keyOf(this.ownerModuleLinkHash, this.gapKind, this.startLine, this.startColumn,
        this.relatedLinkHash, this.detail)
    );
  }

  getHash(): string {
    return this.jsParseGapUniqueHash;
  }


  getEntryCombined(): string {
    return `js_parse_gap[hash=${this.jsParseGapUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.gapKind,
        boundedText(this.detail, JS_COMMENT_TEXT_LIMIT),
        text(this.relatedRelation),
        this.relatedLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        bool(this.isRecoverable),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsParseGapUniqueHash,
      ],
      JsParseGapRegistry.ARITY,
      'js_parse_gap'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'gapKind',
        'detail',
        'relatedRelation',
        'relatedLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'isRecoverable',
        'isExternal',
        'serviceVersionLinkHash',
        'jsParseGapUniqueHash',
      ],
      JsParseGapRegistry.ARITY,
      'js_parse_gap'
    );
  }
}
