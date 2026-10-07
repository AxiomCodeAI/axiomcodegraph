import { WEB_ATTRIBUTE_VALUE_LIMIT } from '@/constants/web-constants';
import { HtmlAttributeKind } from '@/enums/html/HtmlAttributeKind';

import { WebRow, bool, boundedText, num, text } from '../web/web-row';

/**
 * One attribute of one element. The HTML algorithm keeps the FIRST of two attributes
 * with one name and reports the second as a parse error, so (element, prefix, name) is
 * unique and is the key. `hasValue` separates `disabled` from `disabled=""`, which the
 * tree does not: both reach the parser as the empty string.
 */
export class HtmlAttribute extends WebRow {
  static readonly COLUMNS = [
    'name', 'prefix', 'value', 'attributeKind', 'hasValue', 'startLine', 'startColumn',
    'ownerElementLinkHash', 'documentLinkHash', 'serviceVersionLinkHash', 'htmlAttributeUniqueHash',
  ] as const;

  readonly relation = 'html_attribute';
  readonly columns = HtmlAttribute.COLUMNS;

  readonly name: string;
  readonly prefix: string;
  readonly value: string;
  readonly attributeKind: HtmlAttributeKind;
  readonly hasValue: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  readonly ownerElementLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    name: string; prefix: string; value: string; attributeKind: HtmlAttributeKind; hasValue: boolean;
    startLine: number; startColumn: number; ownerElementLinkHash: string; documentLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    super();
    this.name = props.name;
    this.prefix = props.prefix;
    this.value = props.value;
    this.attributeKind = props.attributeKind;
    this.hasValue = props.hasValue;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.ownerElementLinkHash = props.ownerElementLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `HTML_ATTRIBUTE_md5(ownerElementLinkHash ‖ prefix ‖ name)`. */
  generateHash(): void {
    this.hash = WebRow.key('HTML_ATTRIBUTE', this.ownerElementLinkHash, this.prefix, this.name);
  }

  protected values(): string[] {
    return [
      text(this.name), text(this.prefix), boundedText(this.value, WEB_ATTRIBUTE_VALUE_LIMIT),
      this.attributeKind, bool(this.hasValue), num(this.startLine), num(this.startColumn),
      this.ownerElementLinkHash, this.documentLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
