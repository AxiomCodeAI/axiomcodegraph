import { WEB_TEXT_LIMIT } from '@/constants/web-constants';
import { CssCombinator, CssSelectorPartKind } from '@/enums/css/CssSelectorPartKind';

import { WebRow, boundedText, num, text } from '../web/web-row';

/**
 * One simple selector of a complex selector, in writing order.
 *
 * `compoundIndex` groups the parts between combinators; `combinatorBefore` is the
 * combinator written before this part's compound (NONE inside a compound and on the
 * first). A functional pseudo-class's argument selectors are child parts — `depth` 1,
 * `parentPartLinkHash` the `:not` / `:is` / `:has` part, `argumentIndex` which of its
 * comma-separated arguments the part belongs to — so `.nav:not(.open, .busy) a` is six
 * rows, the CLASS `open` is distinguishable as negated, and `open` and `busy` as two
 * alternatives rather than one compound. `position` is the pre-order ordinal over the
 * whole tree, and (selector, position) is the key.
 */
export class CssSelectorPart extends WebRow {
  static readonly COLUMNS = [
    'partKind', 'name', 'value', 'attributeMatcher', 'attributeFlags', 'combinatorBefore',
    'compoundIndex', 'position', 'depth', 'argumentIndex', 'startLine', 'startColumn', 'parentPartLinkHash',
    'selectorLinkHash', 'ruleLinkHash', 'serviceVersionLinkHash', 'cssSelectorPartUniqueHash',
  ] as const;

  readonly relation = 'css_selector_part';
  readonly columns = CssSelectorPart.COLUMNS;

  readonly partKind: CssSelectorPartKind;
  readonly name: string;
  readonly value: string;
  readonly attributeMatcher: string;
  readonly attributeFlags: string;
  readonly combinatorBefore: CssCombinator;
  readonly compoundIndex: number;
  readonly position: number;
  readonly depth: number;
  readonly argumentIndex: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly parentPartLinkHash: string;
  readonly selectorLinkHash: string;
  readonly ruleLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    partKind: CssSelectorPartKind; name: string; value: string; attributeMatcher: string; attributeFlags: string;
    combinatorBefore: CssCombinator; compoundIndex: number; position: number; depth: number; argumentIndex: number;
    startLine: number; startColumn: number; parentPartLinkHash: string; selectorLinkHash: string;
    ruleLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.partKind = props.partKind;
    this.name = props.name;
    this.value = props.value;
    this.attributeMatcher = props.attributeMatcher;
    this.attributeFlags = props.attributeFlags;
    this.combinatorBefore = props.combinatorBefore;
    this.compoundIndex = props.compoundIndex;
    this.position = props.position;
    this.depth = props.depth;
    this.argumentIndex = props.argumentIndex;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.parentPartLinkHash = props.parentPartLinkHash;
    this.selectorLinkHash = props.selectorLinkHash;
    this.ruleLinkHash = props.ruleLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_SELECTOR_PART_md5(selectorLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_SELECTOR_PART', this.selectorLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      this.partKind, text(this.name), boundedText(this.value, WEB_TEXT_LIMIT), text(this.attributeMatcher),
      text(this.attributeFlags), this.combinatorBefore, num(this.compoundIndex), num(this.position),
      num(this.depth), num(this.argumentIndex), num(this.startLine), num(this.startColumn), this.parentPartLinkHash,
      this.selectorLinkHash, this.ruleLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
