import { WEB_COMMENT_TEXT_LIMIT } from '@/constants/web-constants';

import { WebRow, boundedText, num } from '../web/web-row';

/** A `/* … *\/` comment, with its text, for parity with the other front ends. */
export class CssComment extends WebRow {
  static readonly COLUMNS = [
    'text', 'startLine', 'startColumn', 'endLine', 'endColumn', 'stylesheetLinkHash',
    'serviceVersionLinkHash', 'cssCommentUniqueHash',
  ] as const;

  readonly relation = 'css_comment';
  readonly columns = CssComment.COLUMNS;

  readonly text: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly stylesheetLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    text: string; startLine: number; startColumn: number; endLine: number; endColumn: number;
    stylesheetLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.text = props.text;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.stylesheetLinkHash = props.stylesheetLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_COMMENT_md5(stylesheetLinkHash ‖ startLine ‖ startColumn)`. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_COMMENT', this.stylesheetLinkHash, this.startLine, this.startColumn);
  }

  protected values(): string[] {
    return [
      boundedText(this.text, WEB_COMMENT_TEXT_LIMIT), num(this.startLine), num(this.startColumn),
      num(this.endLine), num(this.endColumn), this.stylesheetLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
