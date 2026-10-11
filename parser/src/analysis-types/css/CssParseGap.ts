import { WEB_COMMENT_TEXT_LIMIT } from '@/constants/web-constants';
import { CssParseGapKind } from '@/enums/css/CssParseGapKind';

import { WebRow, boundedText, num } from '../web/web-row';

/** One region of a stylesheet whose rows are missing or suspect, recorded as data. */
export class CssParseGap extends WebRow {
  static readonly COLUMNS = [
    'gapKind', 'detail', 'startLine', 'startColumn', 'endLine', 'endColumn', 'relatedRuleLinkHash',
    'stylesheetLinkHash', 'serviceVersionLinkHash', 'cssParseGapUniqueHash',
  ] as const;

  readonly relation = 'css_parse_gap';
  readonly columns = CssParseGap.COLUMNS;

  readonly gapKind: CssParseGapKind;
  readonly detail: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly relatedRuleLinkHash: string;
  readonly stylesheetLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    gapKind: CssParseGapKind; detail: string; startLine: number; startColumn: number; endLine: number;
    endColumn: number; relatedRuleLinkHash: string; stylesheetLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.gapKind = props.gapKind;
    this.detail = props.detail;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.relatedRuleLinkHash = props.relatedRuleLinkHash;
    this.stylesheetLinkHash = props.stylesheetLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_PARSE_GAP_md5(stylesheetLinkHash ‖ gapKind ‖ startLine ‖ startColumn ‖ detail)`. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_PARSE_GAP', this.stylesheetLinkHash, this.gapKind, this.startLine, this.startColumn, this.detail);
  }

  protected values(): string[] {
    return [
      this.gapKind, boundedText(this.detail, WEB_COMMENT_TEXT_LIMIT), num(this.startLine), num(this.startColumn),
      num(this.endLine), num(this.endColumn), this.relatedRuleLinkHash, this.stylesheetLinkHash,
      this.serviceVersionLinkHash, this.hash,
    ];
  }
}
