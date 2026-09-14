import { ABSENT, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { TsParseGapKind } from '@/enums/typescript/parse-gaps';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One construct that could not be represented — schema §4.20, 10 columns.
 *
 * ## The relation exists BECAUSE it should always be empty
 *
 * Measured zero rows over 25.9 MB of real TypeScript with `ts.createSourceFile`.
 * That is the argument for emitting it, not against: an always-empty relation
 * that suddenly has rows is a SIGNAL, while a missing relation is a silence. On
 * the day a file starts failing to parse, one of those shows up as data and the
 * other as slightly fewer facts than yesterday.
 *
 * It RECORDS the gap and never rewrites source. Positions stay measured, so a
 * consumer can go and look at the construct rather than trusting a summary.
 */
export class TsParseGapRegistry implements EntityIdentifiable {
  static readonly ARITY = 10;

  readonly gapKind: TsParseGapKind;
  readonly diagnosticCode: string;
  readonly message: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly tsModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  private tsParseGapUniqueHash = ABSENT;

  constructor(props: {
    gapKind: TsParseGapKind;
    diagnosticCode: string;
    message: string;
    filePath: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    tsModuleLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    this.gapKind = props.gapKind;
    this.diagnosticCode = props.diagnosticCode;
    this.message = props.message;
    this.filePath = props.filePath;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `TS_PARSE_GAP_md5(filePath ‖ gapKind ‖ startLine ‖ startColumn ‖ diagnosticCode)` */
  generateHash(): void {
    this.tsParseGapUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_PARSE_GAP,
      keyOf(this.filePath, this.gapKind, this.startLine, this.startColumn, this.diagnosticCode)
    );
  }

  getHash(): string {
    return this.tsParseGapUniqueHash;
  }

  getEntryCombined(): string {
    return `ts_parse_gap[kind=${this.gapKind}, code=${this.diagnosticCode}, file=${this.filePath}, line=${this.startLine}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        this.gapKind,
        this.diagnosticCode,
        text(this.message),
        text(this.filePath),
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        this.tsModuleLinkHash,
        this.serviceVersionLinkHash,
        this.tsParseGapUniqueHash,
      ],
      TsParseGapRegistry.ARITY,
      'ts_parse_gap'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'gapKind', 'diagnosticCode', 'message', 'filePath', 'startLine', 'startColumn',
        'endLine', 'tsModuleLinkHash', 'serviceVersionLinkHash', 'tsParseGapUniqueHash',
      ],
      TsParseGapRegistry.ARITY,
      'ts_parse_gap'
    );
  }
}
