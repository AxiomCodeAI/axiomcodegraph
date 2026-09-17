import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './cs-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { CsParseGapKind } from '@/enums/csharp/parse-gaps';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A place the parser could not read — schema §3.21, **12 columns**.
 *
 * ## Why the losses are rows
 *
 * 3.01% of files in the measured corpus carry a parse error, and without rows
 * that population is anecdotal. Nobody can ask which files, which constructs, or
 * how much of each file went missing — and a regression from 3.01% to 5% would
 * appear as slightly fewer rows everywhere and nothing else. §7: a broken
 * measurement reports success.
 *
 * `coveragePercent` is the fraction of the FILE inside this gap, and it is what
 * makes the truncating population queryable rather than anecdotal. The buckets
 * it feeds were validated against Roslyn's declaration counts and are cleanly
 * monotonic — 98.0% / 50.6% / 22.7% recovery — so they mean what they say.
 */
export class CsParseGapRegistry implements EntityIdentifiable {
  static readonly ARITY = 12;
  static readonly RELATION = 'cs_parse_gap';

  readonly csModuleLinkHash: string;
  readonly gapKind: CsParseGapKind;
  readonly nodeType: string;
  readonly parentNodeType: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly byteLength: number;
  readonly coveragePercent: number;
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private csParseGapUniqueHash = ABSENT;

  constructor(props: {
    csModuleLinkHash: string;
    gapKind: CsParseGapKind;
    nodeType: string;
    parentNodeType: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    byteLength: number;
    coveragePercent: number;
    serviceVersionLinkHash: string;
  }) {
    this.csModuleLinkHash = props.csModuleLinkHash;
    this.gapKind = props.gapKind;
    this.nodeType = props.nodeType;
    this.parentNodeType = props.parentNodeType;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.startColumn = props.startColumn;
    this.byteLength = props.byteLength;
    this.coveragePercent = props.coveragePercent;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `CS_PARSE_GAP_md5(csModuleLinkHash ‖ startLine ‖ startColumn ‖
   * byteLength ‖ gapKind)`
   *
   * The byte length is in the key because a MISSING node has zero width: two of
   * them can share a line and a column, and only what they are differs.
   */
  generateHash(): void {
    this.csParseGapUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.CS_PARSE_GAP,
      keyOf(
        this.csModuleLinkHash,
        this.startLine,
        this.startColumn,
        this.byteLength,
        this.gapKind
      )
    );
  }

  getHash(): string {
    return this.csParseGapUniqueHash;
  }

  getEntryCombined(): string {
    return (
      `cs_parse_gap[kind=${this.gapKind}, node=${this.nodeType}, ` +
      `bytes=${this.byteLength}, coverage=${this.coveragePercent}%, ` +
      `hash=${this.csParseGapUniqueHash}]`
    );
  }

  toCsv(): string {
    return joinRow(
      [
        this.csModuleLinkHash,
        this.gapKind,
        text(this.nodeType),
        text(this.parentNodeType),
        num(this.startLine),
        num(this.endLine),
        num(this.startColumn),
        num(this.byteLength),
        num(this.coveragePercent),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.csParseGapUniqueHash,
      ],
      CsParseGapRegistry.ARITY,
      CsParseGapRegistry.RELATION
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'csModuleLinkHash', 'gapKind', 'nodeType', 'parentNodeType', 'startLine',
        'endLine', 'startColumn', 'byteLength', 'coveragePercent', 'isExternal',
        'serviceVersionLinkHash', 'csParseGapUniqueHash',
      ],
      CsParseGapRegistry.ARITY,
      CsParseGapRegistry.RELATION
    );
  }
}
