import { WEB_COMMENT_TEXT_LIMIT } from '@/constants/web-constants';
import { HtmlParseGapKind } from '@/enums/html/HtmlParseGapKind';

import { WebRow, boundedText, num } from '../web/web-row';

/**
 * One thing the HTML front end could not read as the author meant it. Recorded as data
 * rather than a log line, so "this page has no handler calls" and "this page's handlers
 * did not parse" are different rows.
 */
export class HtmlParseGap extends WebRow {
  static readonly COLUMNS = [
    'gapKind', 'detail', 'startLine', 'startColumn', 'endLine', 'endColumn',
    'relatedElementLinkHash', 'documentLinkHash', 'serviceVersionLinkHash', 'htmlParseGapUniqueHash',
  ] as const;

  readonly relation = 'html_parse_gap';
  readonly columns = HtmlParseGap.COLUMNS;

  readonly gapKind: HtmlParseGapKind;
  readonly detail: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly relatedElementLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    gapKind: HtmlParseGapKind; detail: string; startLine: number; startColumn: number; endLine: number;
    endColumn: number; relatedElementLinkHash: string; documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.gapKind = props.gapKind;
    this.detail = props.detail;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.relatedElementLinkHash = props.relatedElementLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_PARSE_GAP_md5(documentLinkHash ‖ gapKind ‖ startLine ‖ startColumn ‖ detail)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_PARSE_GAP', this.documentLinkHash, this.gapKind, this.startLine, this.startColumn, this.detail);
  }

  protected values(): string[] {
    return [
      this.gapKind, boundedText(this.detail, WEB_COMMENT_TEXT_LIMIT), num(this.startLine),
      num(this.startColumn), num(this.endLine), num(this.endColumn), this.relatedElementLinkHash,
      this.documentLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
