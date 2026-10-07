import { WEB_TEXT_LIMIT } from '@/constants/web-constants';

import { WebRow, bool, boundedText, num, text } from '../web/web-row';

/**
 * One `property: value` pair.
 *
 * It belongs to exactly one of two owners, and the two are separate columns rather
 * than one polymorphic link: `ruleLinkHash` for a declaration inside a rule block,
 * `htmlAttributeLinkHash` for one written in a `style="…"` attribute. A polymorphic
 * key defeats a referential-integrity gate — "the hash exists in one of two tables"
 * is not integrity — so each column points at one relation and exactly one is set.
 * `property` is kept as written: a custom property is case-sensitive and a vendor
 * prefix is information.
 */
export class CssDeclaration extends WebRow {
  static readonly COLUMNS = [
    'property', 'valueText', 'isImportant', 'isCustomProperty', 'vendorPrefix', 'position',
    'startLine', 'startColumn', 'endLine', 'endColumn', 'ruleLinkHash', 'htmlAttributeLinkHash',
    'stylesheetLinkHash', 'serviceVersionLinkHash', 'cssDeclarationUniqueHash',
  ] as const;

  readonly relation = 'css_declaration';
  readonly columns = CssDeclaration.COLUMNS;

  readonly property: string;
  readonly valueText: string;
  readonly isImportant: boolean;
  readonly isCustomProperty: boolean;
  readonly vendorPrefix: string;
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly ruleLinkHash: string;
  readonly htmlAttributeLinkHash: string;
  readonly stylesheetLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    property: string; valueText: string; isImportant: boolean; isCustomProperty: boolean; vendorPrefix: string;
    position: number; startLine: number; startColumn: number; endLine: number; endColumn: number;
    ruleLinkHash: string; htmlAttributeLinkHash: string; stylesheetLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.property = props.property;
    this.valueText = props.valueText;
    this.isImportant = props.isImportant;
    this.isCustomProperty = props.isCustomProperty;
    this.vendorPrefix = props.vendorPrefix;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.endColumn = props.endColumn;
    this.ruleLinkHash = props.ruleLinkHash;
    this.htmlAttributeLinkHash = props.htmlAttributeLinkHash;
    this.stylesheetLinkHash = props.stylesheetLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_DECLARATION_md5(ruleLinkHash ‖ htmlAttributeLinkHash ‖ position)` — one owner is empty. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_DECLARATION', this.ruleLinkHash, this.htmlAttributeLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      text(this.property), boundedText(this.valueText, WEB_TEXT_LIMIT), bool(this.isImportant),
      bool(this.isCustomProperty), text(this.vendorPrefix), num(this.position), num(this.startLine),
      num(this.startColumn), num(this.endLine), num(this.endColumn), this.ruleLinkHash,
      this.htmlAttributeLinkHash, this.stylesheetLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
