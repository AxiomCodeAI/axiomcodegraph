import { WEB_TEXT_LIMIT } from '@/constants/web-constants';

import { WebRow, bool, boundedText, num } from '../web/web-row';

/**
 * One complex selector of a style rule's selector list: `.a > b, #c` is two rows.
 *
 * Specificity is the (ids, classes, types) triple of the Selectors specification,
 * computed from the parts: `:is()`/`:not()`/`:has()` take the most specific argument,
 * `:where()` adds nothing, `&` adds the parent's. A nested rule's specificity here is
 * the selector's OWN; the parent's contribution is a join through `css_rule`.
 */
export class CssSelector extends WebRow {
  static readonly COLUMNS = [
    'selectorText', 'position', 'specificityA', 'specificityB', 'specificityC', 'compoundCount',
    'hasNesting', 'hasPseudoElement', 'startLine', 'startColumn', 'endLine', 'endColumn',
    'ruleLinkHash', 'stylesheetLinkHash', 'serviceVersionLinkHash', 'cssSelectorUniqueHash',
  ] as const;

  readonly relation = 'css_selector';
  readonly columns = CssSelector.COLUMNS;

  readonly selectorText: string;
  readonly position: number;
  readonly specificityA: number;
  readonly specificityB: number;
  readonly specificityC: number;
  readonly compoundCount: number;
  readonly hasNesting: boolean;
  readonly hasPseudoElement: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly ruleLinkHash: string;
  readonly stylesheetLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    selectorText: string; position: number; specificityA: number; specificityB: number; specificityC: number;
    compoundCount: number; hasNesting: boolean; hasPseudoElement: boolean; startLine: number;
    startColumn: number; endLine: number; endColumn: number; ruleLinkHash: string;
    stylesheetLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.selectorText = props.selectorText;
    this.position = props.position;
    this.specificityA = props.specificityA;
    this.specificityB = props.specificityB;
    this.specificityC = props.specificityC;
    this.compoundCount = props.compoundCount;
    this.hasNesting = props.hasNesting;
    this.hasPseudoElement = props.hasPseudoElement;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.ruleLinkHash = props.ruleLinkHash;
    this.stylesheetLinkHash = props.stylesheetLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_SELECTOR_md5(ruleLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_SELECTOR', this.ruleLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      boundedText(this.selectorText, WEB_TEXT_LIMIT), num(this.position), num(this.specificityA),
      num(this.specificityB), num(this.specificityC), num(this.compoundCount), bool(this.hasNesting),
      bool(this.hasPseudoElement), num(this.startLine), num(this.startColumn), num(this.endLine),
      num(this.endColumn), this.ruleLinkHash, this.stylesheetLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
