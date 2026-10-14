import { WEB_ATTRIBUTE_VALUE_LIMIT } from '@/constants/web-constants';
import { HtmlReferenceKind } from '@/enums/html/HtmlReferenceKind';
import { WebUrlKind } from '@/enums/web/WebUrlKind';

import { WebRow, bool, boundedText, num, text } from '../web/web-row';

/**
 * One URL a page names: a script, a stylesheet, a link, an image, a form target.
 *
 * `resolvedFilePath` is filled only when the URL is RELATIVE or ROOT_RELATIVE and the
 * file EXISTS where the text says; `isResolved` says which. A URL that resolves to
 * nothing is still a row — the reference is real, the file is not there — and the
 * engine joins `resolvedFilePath` to the module, stylesheet or document it names.
 * A `srcset` is several candidates in one attribute; `position` tells them apart.
 */
export class HtmlReference extends WebRow {
  static readonly COLUMNS = [
    'referenceKind', 'urlAsWritten', 'urlKind', 'path', 'query', 'fragment', 'resolvedFilePath',
    'isResolved', 'position', 'attributeName', 'startLine', 'startColumn', 'ownerElementLinkHash',
    'attributeLinkHash', 'documentLinkHash', 'serviceVersionLinkHash', 'htmlReferenceUniqueHash',
  ] as const;

  readonly relation = 'html_reference';
  readonly columns = HtmlReference.COLUMNS;

  readonly referenceKind: HtmlReferenceKind;
  readonly urlAsWritten: string;
  readonly urlKind: WebUrlKind;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly resolvedFilePath: string;
  readonly isResolved: boolean;
  readonly position: number;
  readonly attributeName: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly ownerElementLinkHash: string;
  readonly attributeLinkHash: string;
  readonly documentLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    referenceKind: HtmlReferenceKind; urlAsWritten: string; urlKind: WebUrlKind; path: string;
    query: string; fragment: string; resolvedFilePath: string; isResolved: boolean; position: number;
    attributeName: string; startLine: number; startColumn: number; ownerElementLinkHash: string;
    attributeLinkHash: string; documentLinkHash: string; serviceVersionLinkHash: string;
  }) {
    super();
    this.referenceKind = props.referenceKind;
    this.urlAsWritten = props.urlAsWritten;
    this.urlKind = props.urlKind;
    this.path = props.path;
    this.query = props.query;
    this.fragment = props.fragment;
    this.resolvedFilePath = props.resolvedFilePath;
    this.isResolved = props.isResolved;
    this.position = props.position;
    this.attributeName = props.attributeName;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.ownerElementLinkHash = props.ownerElementLinkHash;
    this.attributeLinkHash = props.attributeLinkHash;
    this.documentLinkHash = props.documentLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `HTML_REFERENCE_md5(attributeLinkHash ‖ position)`. An include written in text or a comment (INCLUDE, G22)
   * has no attribute: it is keyed by its page instead, or every page's first include would share one key.
   */
  generateHash(): void {
    this.hash = WebRow.key('HTML_REFERENCE', this.attributeLinkHash || `${this.documentLinkHash}#include`, this.position);
  }

  protected values(): string[] {
    return [
      this.referenceKind, boundedText(this.urlAsWritten, WEB_ATTRIBUTE_VALUE_LIMIT), this.urlKind,
      boundedText(this.path, WEB_ATTRIBUTE_VALUE_LIMIT), boundedText(this.query, WEB_ATTRIBUTE_VALUE_LIMIT),
      boundedText(this.fragment, WEB_ATTRIBUTE_VALUE_LIMIT), text(this.resolvedFilePath),
      bool(this.isResolved), num(this.position), text(this.attributeName), num(this.startLine),
      num(this.startColumn), this.ownerElementLinkHash, this.attributeLinkHash,
      this.documentLinkHash, this.serviceVersionLinkHash, this.hash,
    ];
  }
}
