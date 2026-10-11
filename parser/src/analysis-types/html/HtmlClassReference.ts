import { WebRow, num, text } from '../web/web-row';

/**
 * One token of a `class` attribute: the row `css_selector_part` (kind CLASS) joins on.
 * A class written twice on one element is two rows at two positions, as written.
 */
export class HtmlClassReference extends WebRow {
  static readonly COLUMNS = [
    'className', 'position', 'startLine', 'ownerElementLinkHash', 'attributeLinkHash',
    'documentLinkHash', 'serviceVersionLinkHash', 'htmlClassReferenceUniqueHash',
  ] as const;

  readonly relation = 'html_class_reference';
  readonly columns = HtmlClassReference.COLUMNS;

  readonly className: string;
  readonly position: number;
  readonly startLine: number;
  readonly ownerElementLinkHash: string;
  readonly attributeLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    className: string; position: number; startLine: number; ownerElementLinkHash: string;
    attributeLinkHash: string; documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.className = props.className;
    this.position = props.position;
    this.startLine = props.startLine;
    this.ownerElementLinkHash = props.ownerElementLinkHash;
    this.attributeLinkHash = props.attributeLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_CLASS_REFERENCE_md5(attributeLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_CLASS_REFERENCE', this.attributeLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      text(this.className), num(this.position), num(this.startLine), this.ownerElementLinkHash,
      this.attributeLinkHash, this.documentLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
